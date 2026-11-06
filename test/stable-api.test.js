import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityCoreAPI } from '../src/core/api-v1.js';
import { ExternalModuleLoader } from '../src/core/module-loader.js';

test('stable API exposes versioned, isolated module surface', () => {
  const events = { publish: () => ({ type: 'x' }), subscribe: () => () => {}, history: () => [] };
  const api = createCommunityCoreAPI({ events, capabilities: { security: true } });
  assert.equal(api.version, '1.0');
  assert.equal(api.meta().version, '1.0');
  assert.equal(api.meta().capabilities.security, true);
  assert.equal(typeof api.events.publish, 'function');
  assert.equal(typeof api.modules.list, 'function');
});

test('external module manifest is API-version compatible', async () => {
  const loader = new ExternalModuleLoader(new URL('../modules', import.meta.url).pathname);
  const list = await loader.discover();
  const example = list.find(x => x.id === 'example');
  assert.ok(example);
  assert.equal(example.apiVersion, '1.0');
});
