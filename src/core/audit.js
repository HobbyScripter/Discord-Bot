/**
 * Discord + Core audit bridge. Discord's audit API is finite and permission-bound;
 * this module deliberately records only what Discord exposes to the bot.
 */
export class AuditManager {
  constructor(database, eventBus, logger = console) {
    this.db = database;
    this.events = eventBus;
    this.logger = logger;
  }
  recordCore(guildId, type, actorId, payload = {}, eventId = null) {
    try {
      const id = this.db.addAudit(guildId, type, actorId, payload, { source: 'core', eventId });
      if (id) this.events?.publish?.('audit.recorded', { id, type, actorId, payload, source: 'core' }, { source: 'audit', communityId: guildId });
      return id;
    } catch (error) { this.logger.warn?.('⚠ Core-Audit konnte nicht gespeichert werden:', error?.message || error); return null; }
  }
  recordDiscord(guildId, entry) {
    if (!entry?.id) return null;
    const payload = {
      action: entry.action,
      actionType: entry.actionType,
      executor: entry.executor ? { id: entry.executor.id, tag: entry.executor.tag } : null,
      target: entry.target ? { id: entry.target.id, name: entry.target.name || entry.target.tag || null } : null,
      reason: entry.reason || null,
      createdAt: entry.createdAt?.toISOString?.() || null,
      changes: entry.changes || [],
      source: 'discord',
    };
    const id = this.db.addAudit(guildId, `discord.${entry.action}`, entry.executor?.id || null, payload, { source: 'discord', eventId: entry.id });
    if (id) this.events?.publish?.('audit.recorded', { id, type: `discord.${entry.action}`, actorId: entry.executor?.id || null, payload, source: 'discord' }, { source: 'audit', communityId: guildId });
    return id;
  }
  async syncGuild(guild, { pages = 10, pageSize = 100 } = {}) {
    if (!guild?.id) return { ok: false, reason: 'guild-missing', imported: 0 };
    let before;
    let imported = 0;
    try {
      for (let page = 0; page < Math.max(1, Number(pages) || 1); page++) {
        const logs = await guild.fetchAuditLogs({ limit: Math.min(100, pageSize), ...(before ? { before } : {}) });
        const entries = [...logs.entries.values()];
        if (!entries.length) break;
        for (const entry of entries) if (this.recordDiscord(guild.id, entry)) imported++;
        const oldest = entries.at(-1);
        if (!oldest || entries.length < Math.min(100, pageSize)) break;
        before = oldest.id;
      }
      this.recordCore(guild.id, 'audit.discord.initial_sync', null, { imported, pages });
      return { ok: true, imported, pages };
    } catch (error) {
      this.logger.warn?.(`⚠ Discord-Audit-Synchronisierung für ${guild.name} fehlgeschlagen:`, error?.message || error);
      this.recordCore(guild.id, 'audit.discord.sync_failed', null, { error: error?.message || String(error) });
      return { ok: false, imported, error: error?.message || String(error) };
    }
  }
}
