import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunityDatabase } from '../src/core/database.js';
import { RBACManager } from '../src/core/rbac.js';
import { SecurityResponseManager } from '../src/core/security-response.js';

function db() { return new CommunityDatabase(':memory:'); }

test('RBAC prevents non-owner from granting owner or defining wildcard roles', () => {
  const database = db();
  const rbac = new RBACManager(database, null, null);
  const guild = 'guild-a';
  database.upsertCommunity({ id: guild, name: 'A' });
  database.setCoreRole(guild, 'admin-1', 'admin');
  assert.throws(() => rbac.setRole(guild, 'user-1', 'owner', 'admin-1'), /Owner/);
  assert.throws(() => rbac.saveRole(guild, { role: 'super-admin', label: 'Super', permissions: ['*'] }, 'admin-1'), /Owner/);
  assert.doesNotThrow(() => rbac.setRole(guild, 'user-1', 'moderator', 'admin-1'));
  assert.doesNotThrow(() => rbac.saveRole(guild, { role: 'limited', label: 'Limited', permissions: ['tickets.read'] }, 'admin-1'));
  database.setCoreRole(guild, 'owner-1', 'owner');
  assert.doesNotThrow(() => rbac.setRole(guild, 'user-2', 'owner', 'owner-1'));
  assert.doesNotThrow(() => rbac.saveRole(guild, { role: 'super-admin', label: 'Super', permissions: ['*'] }, 'owner-1'));
  database.close();
});

test('security quarantine rejects privileged roles and requires an editable role', async () => {
  const database = db();
  const guild = 'guild-a';
  database.upsertCommunity({ id: guild, name: 'A' });
  database.setCoreRole(guild, 'security-1', 'security');
  const guildObj = {
    id: guild,
    roles: { cache: new Map([
      ['everyone', { id:'everyone' }],
      ['admin-role', { id:'admin-role', editable:true, permissions:{ has: bit => bit === 8n } }],
      ['quarantine', { id:'quarantine', editable:true, permissions:{ has: () => false } }],
    ]), everyone: { id:'everyone' } },
    members: { fetch: async () => ({ roles: { cache: new Map([['base',{id:'base',editable:true}]]), remove: async()=>{}, add: async()=>{} } }) }
  };
  const client = { guilds: { cache: new Map([[guild, guildObj]]) } };
  const security = new SecurityResponseManager({ client, db: database, rbac: new RBACManager(database, null, null) });
  const request = await security.request({ guildId:guild, actorId:'security-1', action:'member.quarantine', args:{ userId:'user-1', roleId:'admin-role' } });
  await assert.rejects(() => security.confirm({ guildId:guild, confirmationId:request.confirmation.id, actorId:'security-1' }), /privilegierten Verwaltungsrechte/);
  database.close();
});
