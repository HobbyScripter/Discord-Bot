import fs from 'node:fs/promises';
import path from 'node:path';
import { CORE_API_VERSION } from './api-v1.js';
import { createModuleSDK } from './module-sdk.js';

export class ExternalModuleLoader {
  constructor(directory = path.resolve('modules'), { logger = console } = {}) {
    this.directory = directory;
    this.logger = logger;
    this.modules = new Map();
    this.instances = new Map();
  }

  async discover() {
    await fs.mkdir(this.directory, { recursive: true });
    for (const e of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.js') || e.name.startsWith('_')) continue;
      try {
        const m = await import(`file://${path.join(this.directory, e.name)}?v=${Date.now()}`);
        const d = m.default || m.module;
        this.#validate(d, e.name);
        this.modules.set(d.id, d);
      } catch (err) {
        this.logger.warn?.(`⚠ Modul ${e.name} konnte nicht geladen werden:`, err?.message || err);
      }
    }
    return this.list();
  }

  #validate(d, fileName = 'module') {
    if (!d || typeof d !== 'object') throw new Error(`${fileName}: Modul-Manifest fehlt.`);
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(String(d.id || ''))) throw new Error(`${fileName}: ungültige Modul-ID.`);
    if (d.apiVersion && String(d.apiVersion) !== CORE_API_VERSION) throw new Error(`${fileName}: API ${d.apiVersion} wird nicht unterstützt; erwartet ${CORE_API_VERSION}.`);
    if (d.setup && typeof d.setup !== 'function') throw new Error(`${fileName}: setup muss eine Funktion sein.`);
    if (d.destroy && typeof d.destroy !== 'function') throw new Error(`${fileName}: destroy muss eine Funktion sein.`);
  }

  list() { return [...this.modules.values()].map(d => ({ id: d.id, name: d.name || d.id, version: d.version || '0.0.0', apiVersion: d.apiVersion || CORE_API_VERSION, description: d.description || '', permissions: Array.isArray(d.permissions) ? d.permissions : [] })); }
  get(id) { return this.modules.get(id); }

  async initialize({ api, guildIds = [], logger = this.logger } = {}) {
    for (const descriptor of this.modules.values()) {
      if (!descriptor.setup) continue;
      const instances = [];
      for (const guildId of guildIds) {
        const sdk = createModuleSDK({ api, module: descriptor, guildId, logger });
        await descriptor.setup(sdk);
        instances.push({ guildId: String(guildId), sdk });
      }
      this.instances.set(descriptor.id, instances);
    }
    return this.list();
  }

  async destroy({ logger = this.logger } = {}) {
    for (const descriptor of this.modules.values()) {
      if (!descriptor.destroy) continue;
      const instances = this.instances.get(descriptor.id) || [];
      for (const instance of instances) {
        try { await descriptor.destroy(instance.sdk); } catch (error) { logger.warn?.(`⚠ Modul ${descriptor.id} konnte nicht beendet werden:`, error?.message || error); }
      }
    }
    this.instances.clear();
  }
}
