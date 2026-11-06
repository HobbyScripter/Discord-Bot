/**
 * Stable automation runtime.
 *
 * Contract: events enter through CoreEventBus; jobs are persisted in SQLite;
 * every execution has a durable run record; actions are delegated to explicit
 * handlers. Delayed/retried work never blocks the event publisher.
 */
export class AutomationEngine {
  constructor(db, events, audit, handlers = {}, logger = console, options = {}) {
    this.db = db;
    this.events = events;
    this.audit = audit;
    this.handlers = handlers;
    this.logger = logger;
    this.options = { maxConcurrent: 10, defaultRetries: 0, maxDelayMs: 15 * 60_000, ...options };
    this.running = true;
    this.active = 0;
    this.cooldowns = new Map();
    this.timers = new Set();
    this.unsubscribe = events?.subscribe((event) => {
      void this.#handle(event).catch((error) => this.#fatal(event, error));
    });
  }

  close() {
    this.running = false;
    this.unsubscribe?.();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  status() {
    return { running: this.running, active: this.active, scheduled: this.timers.size, maxConcurrent: this.options.maxConcurrent };
  }

  async #handle(event) {
    if (!this.running || !event?.communityId) return;
    const jobs = this.db.listAutomations(event.communityId);
    for (const job of jobs) {
      if (!job.enabled || !this.match(job.trigger, event)) continue;
      if (!this.conditions(job.trigger?.conditions, event)) continue;
      if (this.#onCooldown(job, event)) {
        this.#recordSkip(event.communityId, job, event, 'cooldown');
        continue;
      }
      const delay = Math.min(this.options.maxDelayMs, Math.max(0, Number(job.trigger?.delayMs || 0)));
      this.#setCooldown(job, event);
      if (delay) this.#schedule(delay, () => this.execute(event.communityId, job, event));
      else void this.execute(event.communityId, job, event).catch((error) => this.#fatal(event, error));
    }
  }

  match(trigger = {}, event) {
    if (trigger.type && trigger.type !== event.type) return false;
    if (trigger.source && trigger.source !== event.source) return false;
    if (trigger.communityId && String(trigger.communityId) !== String(event.communityId)) return false;
    if (trigger.level && event.payload?.level !== trigger.level) return false;
    if (Array.isArray(trigger.types) && trigger.types.length && !trigger.types.includes(event.type)) return false;
    return true;
  }

  conditions(conditions = [], event) {
    if (!conditions || (Array.isArray(conditions) && conditions.length === 0)) return true;
    const list = Array.isArray(conditions) ? conditions : [conditions];
    return list.every((condition) => {
      const actual = this.#value(event, condition.path);
      const expected = condition.value;
      switch (condition.operator || 'equals') {
        case 'equals': return actual === expected;
        case 'not_equals': return actual !== expected;
        case 'contains': return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').includes(String(expected));
        case 'starts_with': return String(actual ?? '').startsWith(String(expected));
        case 'ends_with': return String(actual ?? '').endsWith(String(expected));
        case 'gt': return Number(actual) > Number(expected);
        case 'gte': return Number(actual) >= Number(expected);
        case 'lt': return Number(actual) < Number(expected);
        case 'lte': return Number(actual) <= Number(expected);
        case 'exists': return actual !== undefined && actual !== null;
        case 'truthy': return Boolean(actual);
        default: return false;
      }
    });
  }

  async execute(guildId, job, event) {
    if (!this.running) return { status: 'skipped', reason: 'stopped' };
    if (this.active >= this.options.maxConcurrent) {
      this.#recordSkip(guildId, job, event, 'concurrency_limit');
      return { status: 'skipped', reason: 'concurrency_limit' };
    }
    this.active++;
    const started = Date.now();
    let runId = null;
    try {
      runId = this.#startRun(guildId, job, event);
      const actions = Array.isArray(job.actions) ? job.actions : [];
      for (const action of actions) await this.#executeAction(guildId, job, action, event);
      this.#finishRun(runId, 'success', null, Date.now() - started);
      this.audit?.recordCore(guildId, 'automation.executed', null, { jobId: job.id, eventType: event.type, runId });
      this.events?.publish('automation.executed', { jobId: job.id, eventType: event.type, runId }, { source: 'automation', communityId: guildId });
      return { status: 'success', runId };
    } catch (error) {
      this.#finishRun(runId, 'failed', error?.message || String(error), Date.now() - started);
      this.audit?.recordCore(guildId, 'automation.failed', null, { jobId: job.id, eventType: event.type, runId, error: error?.message || String(error) });
      this.events?.publish('automation.failed', { jobId: job.id, eventType: event.type, runId, error: error?.message || String(error) }, { source: 'automation', communityId: guildId });
      throw error;
    } finally {
      this.active = Math.max(0, this.active - 1);
    }
  }

  async #executeAction(guildId, job, action = {}, event) {
    const type = String(action.type || '').trim();
    if (!type) throw new Error(`Automation ${job.id}: action.type fehlt.`);
    if (type === 'audit') {
      this.audit?.recordCore(guildId, 'automation.action', null, { jobId: job.id, eventType: event.type, data: action });
      return;
    }
    if (type === 'notify') {
      this.events?.publish('automation.notification', { jobId: job.id, message: String(action.message || '') }, { source: 'automation', communityId: guildId });
      return;
    }
    const handler = this.handlers[type];
    if (!handler) throw new Error(`Unbekannte Automation-Aktion: ${type}`);
    const retries = Math.min(5, Math.max(0, Number(action.retries ?? this.options.defaultRetries) || 0));
    let attempt = 0;
    while (true) {
      try { return await handler(guildId, action, event); }
      catch (error) {
        if (attempt >= retries) throw error;
        attempt++;
        const delay = Math.min(30_000, Math.max(100, Number(action.retryDelayMs || 500) * (2 ** (attempt - 1))));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  #value(event, path) {
    if (!path) return undefined;
    return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], event);
  }

  #cooldownKey(job, event) { return `${event.communityId}:${job.id}`; }
  #onCooldown(job, event) { const until = this.cooldowns.get(this.#cooldownKey(job, event)) || 0; return until > Date.now(); }
  #setCooldown(job, event) { const ms = Math.max(0, Math.min(24 * 60 * 60_000, Number(job.trigger?.cooldownMs || 0))); if (ms) this.cooldowns.set(this.#cooldownKey(job, event), Date.now() + ms); }

  #schedule(delay, fn) {
    const timer = setTimeout(() => { this.timers.delete(timer); void Promise.resolve().then(fn).catch((error) => this.logger.warn?.('⚠ Verzögerte Automation fehlgeschlagen:', error?.message || error)); }, delay);
    this.timers.add(timer);
  }

  #startRun(guildId, job, event) {
    const row = this.db.db.prepare('INSERT INTO automation_runs(guild_id,job_id,event_type,status,attempt,started_at) VALUES(?,?,?,?,?,?)').run(guildId, Number(job.id), event.type, 'running', 1, new Date().toISOString());
    return Number(row.lastInsertRowid);
  }
  #finishRun(runId, status, error, duration) { if (!runId) return; this.db.db.prepare('UPDATE automation_runs SET status=?,finished_at=?,duration_ms=?,error=? WHERE id=?').run(status, new Date().toISOString(), Number(duration) || 0, error || null, runId); }
  #recordSkip(guildId, job, event, reason) {
    try { this.db.db.prepare('INSERT INTO automation_runs(guild_id,job_id,event_type,status,attempt,started_at,finished_at,duration_ms,error) VALUES(?,?,?,?,?,?,?,?,?)').run(guildId, Number(job.id), event.type, 'skipped', 1, new Date().toISOString(), new Date().toISOString(), 0, reason); } catch {}
    this.events?.publish('automation.skipped', { jobId: job.id, eventType: event.type, reason }, { source: 'automation', communityId: guildId });
  }
  #fatal(event, error) { try { this.logger.warn?.('⚠ Automation fehlgeschlagen:', error?.stack || error); } catch {} }
}
