import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';

test('user center aggregates identity, staff, activity, tickets and audit context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-1', name: 'Test' });
  db.upsertUser({ id: 'u1', username: 'alice', displayName: 'Alice' });
  db.upsertMembership('guild-1', 'u1', { roles: [{ id: 'r1', name: 'Support' }], staff: true, riskScore: 42, warningCount: 2 });
  db.setCoreRole('guild-1', 'u1', 'support');
  db.setStaffStatus('guild-1', 'u1', 'available', 'On duty');
  db.recordActivity('guild-1', 'message', 'u1', 'c1', {});
  db.createTicket('guild-1', { userId: 'u1', subject: 'Help', category: 'technical' });
  db.addAudit('guild-1', 'user.updated', 'u1', { userId: 'u1' });

  const profile = db.getUserProfile('guild-1', 'u1');
  assert.equal(profile.displayName, 'Alice');
  assert.equal(profile.staff, true);
  assert.equal(profile.staffStatus, 'available');
  assert.equal(profile.coreRole, 'support');
  assert.equal(profile.riskScore, 42);
  assert.equal(profile.warningCount, 2);
  assert.equal(profile.activity[0].event_type, 'message');
  assert.equal(profile.tickets.length, 1);
  assert.equal(profile.audit.length, 1);

  const overview = db.staffOverview('guild-1');
  assert.equal(overview.total, 1);
  assert.equal(overview.counts.available, 1);
  assert.equal(overview.staff[0].displayName, 'Alice');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
