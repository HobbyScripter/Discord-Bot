import test from 'node:test';
import assert from 'node:assert/strict';
import { HARDENING_VERSION, clampLimit, redactSecrets, sanitizeError } from '../src/core/production-hardening.js';

test('production hardening helpers are bounded and redact secrets', () => {
  assert.equal(HARDENING_VERSION, '1.0');
  assert.equal(clampLimit('999', { max: 100 }), 100);
  assert.equal(clampLimit('-4', { min: 1, max: 100 }), 1);
  assert.deepEqual(redactSecrets({ apiKey: 'x', nested: { token: 'y', ok: true } }), { apiKey: '********', nested: { token: '********', ok: true } });
  assert.equal(sanitizeError(new Error('secret internals')), 'Interner Fehler. Details wurden im Server-Log erfasst.');
});
