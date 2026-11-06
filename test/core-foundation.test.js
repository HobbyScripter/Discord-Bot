import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { AuditManager } from '../src/core/audit.js';

test('identity, membership and unified audit foundation is durable and deduplicated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  const bus = new CoreEventBus();
  const events = [];
  bus.subscribe(event => events.push(event));
  db.upsertCommunity({ id: 'guild-1', name: 'Test Community' });
  db.upsertUser({ id: 'user-1', username: 'alice', displayName: 'Alice', bot: false });
  db.upsertMembership('guild-1', 'user-1', { roles: [{ id: 'role-1', name: 'Staff' }], staff: true });
  assert.equal(db.listUsers('guild-1')[0].user_id, 'user-1');
  const audit = new AuditManager(db, bus);
  assert.equal(audit.recordCore('guild-1', 'test.action', 'user-1', { ok: true }, 'event-1'), 1);
  assert.equal(audit.recordCore('guild-1', 'test.action', 'user-1', { ok: true }, 'event-1'), null);
  assert.equal(db.listAudit('guild-1')[0].payload.auditSource, 'core');
  assert.equal(events.at(-1).type, 'audit.recorded');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
