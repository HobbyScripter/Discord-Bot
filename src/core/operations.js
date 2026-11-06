/**
 * Unified operations boundary. Read-only aggregation for the dashboard and
 * operator tooling. It intentionally depends on Core services, never HTTP/DOM.
 */
export class OperationsManager {
  constructor({ db, events, security, tickets, incidents, logger = console } = {}) {
    this.db = db;
    this.events = events;
    this.security = security;
    this.tickets = tickets;
    this.incidents = incidents;
    this.logger = logger;
    this.invalidate = new Map();
    this.unsubscribe = events?.subscribe((event) => {
      if (!event.communityId || !this.#relevant(event.type)) return;
      this.publishSnapshot(event.communityId, event.type);
    });
  }

  close() { this.unsubscribe?.(); this.unsubscribe = null; for (const timer of this.invalidate.values()) clearTimeout(timer); this.invalidate.clear(); }

  #relevant(type) {
    return /^(security\.|ticket\.|incident\.|staff\.|ai\.|member\.|activity\.|automation\.|support\.|knowledge\.|rbac\.|discord\.tool\.)/.test(String(type));
  }

  snapshot(guildId) {
    const key = String(guildId);
    const security = this.security?.snapshot(key) || this.db.securitySnapshot(key);
    const tickets = this.tickets?.queue(key) || {};
    const incidents = this.incidents?.list(key) || this.db.listIncidents(key);
    const staff = this.tickets?.staff(key) || this.db.listStaffStatus(key);
    const confirmations = this.db.listToolConfirmations(key, 'pending').filter((x) => Date.parse(x.expires_at) > Date.now());
    const activity = this.db.activitySummary(key, 60);
    return {
      communityId: key,
      generatedAt: new Date().toISOString(),
      security,
      tickets,
      incidents: {
        open: incidents.filter((x) => !['resolved', 'closed'].includes(x.status)).length,
        highRisk: incidents.filter((x) => ['high', 'critical'].includes(x.severity) && !['resolved', 'closed'].includes(x.status)).length,
        unresolved: incidents.filter((x) => !['resolved', 'closed'].includes(x.status)).length,
      },
      staff: {
        total: staff.length,
        available: staff.filter((x) => x.status === 'available').length,
        busy: staff.filter((x) => x.status === 'busy').length,
        dnd: staff.filter((x) => x.status === 'dnd').length,
      },
      confirmations: { pending: confirmations.length },
      activity: activity?.summary || activity || {},
      analytics: {
        trend: this.db.activityTrend?.(key, 1440, 60) || { windowMinutes: 1440, bucketMinutes: 60, buckets: [] },
        leaderboard: this.db.activityLeaderboard?.(key, 1440, 10) || [],
      },
    };
  }

  commandCenter(guildId) {
    const key = String(guildId);
    const snapshot = this.snapshot(key);
    const support = this.db.supportMetrics ? this.db.supportMetrics(key) : {};
    const automation = this.db.automationStats ? this.db.automationStats(key) : {};
    const staff = this.db.listStaffStatus(key);
    const pendingTools = this.db.listToolConfirmations(key, 'pending').filter((x) => Date.parse(x.expires_at) > Date.now());
    const pendingSecurity = this.db.listSecurityActionConfirmations?.(key, 'pending')?.filter((x) => Date.parse(x.expires_at) > Date.now()) || [];
    const timeline = this.timeline(key, { limit: 40 });
    return {
      ...snapshot,
      generatedAt: new Date().toISOString(),
      support,
      automation,
      staffWorkload: staff.map((s) => ({ ...s, openTickets: (this.db.listTickets(key) || []).filter((t) => t.assigned_to === s.user_id && !['resolved', 'closed'].includes(t.status)).length })),
      confirmations: { pending: pendingTools.length + pendingSecurity.length, discordTools: pendingTools.length, security: pendingSecurity.length },
      timeline,
    };
  }

  timeline(guildId, { limit = 40, sinceMinutes = 1440 } = {}) {
    const key = String(guildId);
    return this.db.operationsTimeline?.(key, { limit, sinceMinutes }) || [];
  }

  search(guildId, query, { limit = 30 } = {}) {
    const key = String(guildId);
    const q = String(query || '').trim().slice(0, 120);
    if (!q) return [];
    return this.db.operationsSearch?.(key, q, { limit }) || [];
  }

  publishSnapshot(guildId, reason = 'change') {
    const key = String(guildId);
    if (this.invalidate.get(key)) return;
    const timer = setTimeout(() => this.invalidate.delete(key), 25);
    this.invalidate.set(key, timer);
    try {
      const snapshot = this.snapshot(key);
      this.events?.publish('operations.snapshot.changed', { reason, snapshot }, { source: 'operations', communityId: key });
      return snapshot;
    } catch (error) {
      this.logger.warn?.('⚠ Operations-Snapshot fehlgeschlagen:', error?.message || error);
      return null;
    }
  }
}
