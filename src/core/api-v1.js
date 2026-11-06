/**
 * Community Core stable module interface.
 *
 * This facade is intentionally small and versioned. Modules should depend on
 * this contract instead of importing internal managers or database internals.
 */
export const CORE_API_VERSION = '1.0';

function safeCall(fn, fallback = null) {
  return typeof fn === 'function' ? fn : () => fallback;
}

export class CommunityCoreAPIv1 {
  constructor({ database, events, communityManager, moduleManager, logger = console, capabilities = {} } = {}) {
    this.version = CORE_API_VERSION;
    this.logger = logger;
    this._database = database;
    this._events = events;
    this._communityManager = communityManager;
    this._moduleManager = moduleManager;
    this.capabilities = Object.freeze({
      events: Boolean(events),
      communities: Boolean(communityManager),
      modules: Boolean(moduleManager),
      database: Boolean(database),
      ...capabilities,
    });
  }

  meta() {
    return { version: this.version, capabilities: { ...this.capabilities } };
  }

  events = Object.freeze({
    publish: (type, payload = {}, meta = {}) => this._events?.publish(type, payload, meta) ?? null,
    subscribe: (handler) => this._events?.subscribe(handler) ?? (() => {}),
    history: (options = {}) => this._events?.history(options) ?? [],
  });

  communities = Object.freeze({
    get: (guildId) => this._communityManager?.get?.(guildId) ?? this._database?.getCommunity?.(guildId) ?? null,
    all: () => this._communityManager?.list?.() ?? this._database?.listCommunities?.() ?? [],
  });

  modules = Object.freeze({
    list: (guildId) => this._moduleManager?.list?.(guildId) ?? [],
    set: (guildId, moduleId, enabled, config = {}) => this._moduleManager?.set?.(guildId, moduleId, enabled, config),
  });

  data = Object.freeze({
    getSetting: safeCall(this._database?.getSetting?.bind(this._database)),
    setSetting: safeCall(this._database?.setSetting?.bind(this._database)),
  });
}

export function createCommunityCoreAPI(options) {
  return new CommunityCoreAPIv1(options);
}
