import { CORE_API_VERSION } from './api-v1.js';

/** Stable SDK surface supplied to external modules. */
export function createModuleSDK({ api, module, guildId, logger = console }) {
  if (!api || api.version !== CORE_API_VERSION) throw new Error(`Unsupported Community Core API: ${api?.version || 'unknown'}`);
  const moduleId = String(module?.id || 'unknown');
  return Object.freeze({
    apiVersion: CORE_API_VERSION,
    module: Object.freeze({ id: moduleId, name: module?.name || moduleId, version: module?.version || '0.0.0' }),
    communityId: guildId ? String(guildId) : null,
    logger,
    events: api.events,
    communities: api.communities,
    modules: api.modules,
    data: api.data,
    meta: () => api.meta(),
  });
}
