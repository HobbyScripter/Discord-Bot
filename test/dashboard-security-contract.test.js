import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');

test('dashboard auth guard is placed before control-plane routes', () => {
  const marker = "if (authEnabled() && !authorized(req) && p !== '/api/health')";
  const guard = source.indexOf(marker);
  assert.notEqual(guard, -1, 'authentication guard missing');
  const firstControlRoute = source.indexOf("if (p === '/api/ai/state'");
  assert.ok(guard < firstControlRoute, 'control-plane route appears before auth guard');
  assert.ok(source.indexOf("if (p === '/login' && req.method === 'POST')") < guard, 'login route must remain reachable');
  assert.ok(source.includes("if (p === '/api/health' && req.method === 'GET')"), 'health probe should remain explicitly public');
  assert.ok(!source.includes('Math.random().toString(36)'), 'session token must not use Math.random');
  assert.ok(source.includes("crypto.randomBytes(32).toString('base64url')"), 'session token must use a cryptographic random source');
});

test('generic dashboard actions use an explicit allowlist', () => {
  const route = "if (p === '/api/action' && req.method === 'POST')";
  const index = source.indexOf(route);
  assert.notEqual(index, -1, 'generic action route missing');
  const snippet = source.slice(index, index + 900);
  for (const action of ['sync', 'reactionRoles', 'setup', 'onboarding']) assert.match(snippet, new RegExp(`['\\"]${action}['\\"]`));
  assert.match(snippet, /Unknown|Unbekannte Aktion/);
});
