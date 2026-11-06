/**
 * Deterministic community security engine.
 *
 * This layer never performs destructive Discord actions. It observes Core/Discord
 * events, calculates a bounded risk score and emits recommendations. Optional AI
 * interpretation can be attached later without making security dependent on AI.
 */
export class SecurityEngine {
  constructor(database, eventBus, logger = console) {
    this.db = database;
    this.events = eventBus;
    this.logger = logger;
    this.state = new Map();
    this.pending = new Map();
    this.signalWindows = new Map();
    this.unsubscribe = eventBus?.subscribe?.((event) => this.#onEvent(event));
  }

  close() {
    try { this.unsubscribe?.(); } catch {}
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.state.clear();
    this.signalWindows.clear();
  }

  #onEvent(event) {
    const guildId = event?.communityId;
    if (!guildId) return;
    if (event.type.startsWith('activity.') || event.type === 'audit.recorded' || event.type === 'security.signal') {
      if (event.type === 'security.signal') this.#rememberSignal(guildId, event.payload);
      this.schedule(guildId);
    }
  }


  #rememberSignal(guildId, payload = {}) {
    const list = this.signalWindows.get(guildId) || [];
    list.push({ at: Date.now(), ...payload });
    const cutoff = Date.now() - 10 * 60 * 1000;
    this.signalWindows.set(guildId, list.filter((item) => item.at >= cutoff).slice(-500));
  }

  schedule(guildId) {
    if (this.pending.has(guildId)) return;
    const timer = setTimeout(() => {
      this.pending.delete(guildId);
      try { this.evaluate(guildId); } catch (error) { this.logger.warn?.('⚠ Security-Auswertung fehlgeschlagen:', error?.message || error); }
    }, 250);
    this.pending.set(guildId, timer);
  }

  thresholds(guildId) {
    const settings = this.db.getSettings(guildId);
    const n = (key, fallback) => {
      const value = Number(settings[`security.${key}`]);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return {
      joins5m: n('joins5m', 5),
      joinsCritical5m: n('joinsCritical5m', 12),
      messages1m: n('messages1m', 30),
      messagesHigh1m: n('messagesHigh1m', 60),
      reactions1m: n('reactions1m', 40),
      uniqueJoiners5m: n('uniqueJoiners5m', 5),
      permissionChanges10m: n('permissionChanges10m', 3),
      massMentions10m: n('massMentions10m', 3),
      linkBursts10m: n('linkBursts10m', 3),
    };
  }

  evaluate(guildId) {
    const t = this.thresholds(guildId);
    const five = this.db.activitySummary(guildId, 5).byType;
    const one = this.db.activitySummary(guildId, 1).byType;
    const ten = this.db.listAudit(guildId, 200, null).filter((entry) => Date.now() - Date.parse(entry.created_at) <= 10 * 60 * 1000);
    const permissionChanges = ten.filter((entry) => /permission|role\.update|role\.create|role\.delete|channel\.update/i.test(entry.type)).length;
    const joins = Number(five.member_join?.count || 0);
    const uniqueJoiners = Number(five.member_join?.users || 0);
    const messages = Number(one.message?.count || 0);
    const reactions = Number(one.reaction_add?.count || 0) + Number(one.reaction_remove?.count || 0);
    const signals10m = (this.signalWindows.get(guildId) || []).filter((item) => item.at >= Date.now() - 10 * 60 * 1000);
    const roleChanges = signals10m.filter((item) => item.kind === 'role_change').length;
    const recentJoins = (this.db.activitySummary(guildId, 5).recent || []).filter((e) => e.event_type === 'member_join');
    const youngAccounts = recentJoins.filter((e) => Number(e.metadata?.accountAgeDays) >= 0 && Number(e.metadata?.accountAgeDays) < 7).length;
    const bans = signals10m.filter((item) => item.kind === 'member_banned').length;
    const massMentions = signals10m.filter((item) => item.kind === 'mass_mention').length;
    const linkBursts = signals10m.filter((item) => item.kind === 'link_burst').length;

    let score = 0;
    const signals = [];
    const add = (id, label, value, weight, detail) => {
      score += weight;
      signals.push({ id, label, value, weight, detail: detail || null });
    };

    if (joins >= t.joins5m) add('join-spike', 'Join-Spike', joins, Math.min(25, 10 + Math.floor(joins / 2)), `${joins} Beitritte in 5 Minuten`);
    if (joins >= t.joinsCritical5m) add('join-burst', 'Starker Join-Burst', joins, 20, `${joins} Beitritte in 5 Minuten`);
    if (uniqueJoiners >= t.uniqueJoiners5m && joins >= t.joins5m) add('unique-join-pattern', 'Viele neue Accounts', uniqueJoiners, 10, `${uniqueJoiners} eindeutige neue Nutzer`);
    if (messages >= t.messages1m) add('message-burst', 'Message-Burst', messages, Math.min(25, 8 + Math.floor(messages / 10)), `${messages} Nachrichten in 1 Minute`);
    if (messages >= t.messagesHigh1m) add('message-flood', 'Starker Message-Flood', messages, 15, `${messages} Nachrichten in 1 Minute`);
    if (reactions >= t.reactions1m) add('reaction-burst', 'Reaction-Burst', reactions, 8, `${reactions} Reaktionen in 1 Minute`);
    if (permissionChanges >= t.permissionChanges10m) add('permission-changes', 'Viele Rechteänderungen', permissionChanges, 20, `${permissionChanges} relevante Änderungen in 10 Minuten`);
    if (joins > 0 && messages >= t.messagesHigh1m) add('join-message-correlation', 'Join/Message-Korrelation', messages, 12, 'Neue Nutzer und hohe Nachrichtenlast treten gleichzeitig auf');
    if (roleChanges >= t.permissionChanges10m) add('role-change-burst', 'Rollenänderungs-Burst', roleChanges, 15, `${roleChanges} Rollenänderungen in 10 Minuten`);
    if (youngAccounts >= 3) add('young-account-pattern', 'Sehr junge Accounts', youngAccounts, Math.min(20, 6 + youngAccounts), `${youngAccounts} Beitritte von Accounts unter 7 Tagen`);
    if (bans >= 3) add('mass-ban-signal', 'Mehrere Bann-Ereignisse', bans, 18, `${bans} Bann-Ereignisse in 10 Minuten`);
    if (massMentions >= t.massMentions10m) add('mass-mentions', 'Mass-Mention-Muster', massMentions, 15, `${massMentions} Mass-Mention-Signale in 10 Minuten`);
    if (linkBursts >= t.linkBursts10m) add('link-burst', 'Link-Burst-Muster', linkBursts, 12, `${linkBursts} Link-Burst-Signale in 10 Minuten`);

    score = Math.min(100, Math.max(0, score));
    const level = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'elevated' : score >= 15 ? 'watch' : 'normal';
    const previous = this.state.get(guildId) || this.db.getSecurityState(guildId) || { score: 0, level: 'normal' };
    const snapshot = {
      score, level, previousScore: Number(previous.score || 0), previousLevel: previous.level || 'normal',
      signals, metrics: { joins5m: joins, uniqueJoiners5m: uniqueJoiners, messages1m: messages, reactions1m: reactions, permissionChanges10m: permissionChanges, roleChanges10m: roleChanges, bans10m: bans, youngAccounts5m: youngAccounts, massMentions10m: massMentions, linkBursts10m: linkBursts },
      recommendation: level === 'critical' ? 'lockdown_review' : level === 'high' ? 'enhanced_verification_review' : level === 'elevated' ? 'watch' : 'observe',
      evaluatedAt: new Date().toISOString(),
    };
    this.state.set(guildId, snapshot);
    this.db.saveSecurityState(guildId, snapshot);
    const changed = snapshot.level !== previous.level || snapshot.score !== previous.score || signals.length !== (previous.signals?.length || 0);
    if (changed) {
      this.db.addSecurityHistory?.(guildId, snapshot);
      this.db.cleanupSecurityHistory?.(30);
      this.db.addAudit(guildId, 'security.risk.changed', null, { score, level, previousScore: previous.score || 0, previousLevel: previous.level || 'normal', signals, recommendation: snapshot.recommendation }, { source: 'security', eventId: `security:${guildId}:${snapshot.evaluatedAt}` });
      this.events?.publish?.('security.risk.changed', snapshot, { source: 'security', communityId: guildId });
    }
    return snapshot;
  }

  snapshot(guildId) {
    return this.state.get(guildId) || this.db.getSecurityState(guildId) || this.evaluate(guildId);
  }
}
