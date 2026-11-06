import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';
import { RBACManager } from '../src/core/rbac.js';
import { CoreEventBus } from '../src/core/event-bus.js';

test('RBAC provides stable built-in roles, custom roles and permission enforcement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-rbac-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-rbac', name: 'RBAC Test' });
  const events = new CoreEventBus();
  const audit = { recordCore() {} };
  const rbac = new RBACManager(db, events, audit);

  const roles = rbac.list('guild-rbac');
  assert.ok(roles.some((r) => r.role === 'admin'));
  assert.ok(roles.some((r) => r.role === 'viewer'));
  assert.ok(rbac.permissionCatalog().some((p) => p.id === 'rbac.manage'));

  db.upsertUser({ id: 'admin-user', username: 'admin', displayName: 'Admin' });
  db.upsertMembership('guild-rbac', 'admin-user', { staff: true });
  assert.equal(rbac.can('guild-rbac', 'admin-user', 'rbac.manage'), true);

  rbac.saveRole('guild-rbac', {
    role: 'community-manager', label: 'Community Manager', description: 'Community operations',
    permissions: ['community.read', 'users.read', 'tickets.read']
  }, 'admin-user');
  const custom = rbac.list('guild-rbac').find((r) => r.role === 'community-manager');
  assert.deepEqual(custom.permissions, ['community.read', 'users.read', 'tickets.read']);

  db.upsertUser({ id: 'member-user', username: 'member', displayName: 'Member' });
  db.upsertMembership('guild-rbac', 'member-user', {});
  rbac.setRole('guild-rbac', 'member-user', 'community-manager', 'admin-user');
  assert.equal(rbac.can('guild-rbac', 'member-user', 'users.read'), true);
  assert.equal(rbac.can('guild-rbac', 'member-user', 'rbac.manage'), false);
  assert.throws(() => rbac.setRole('guild-rbac', 'member-user', 'admin', 'member-user'), /Keine Berechtigung/);

  assert.throws(() => rbac.deleteRole('guild-rbac', 'admin', 'admin-user'), /Integrierte Rollen/);
  assert.equal(rbac.deleteRole('guild-rbac', 'community-manager', 'admin-user').deleted, true);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
