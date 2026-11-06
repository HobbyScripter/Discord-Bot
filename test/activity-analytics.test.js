import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';

test('activity analytics exposes trend buckets and leaderboard', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-analytics-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-1', name: 'Analytics' });
  db.recordActivity('guild-1', 'message', 'user-a', 'channel-1', {});
  db.recordActivity('guild-1', 'message', 'user-a', 'channel-1', {});
  db.recordActivity('guild-1', 'reaction_add', 'user-b', 'channel-1', {});
  const trend = db.activityTrend('guild-1', 1440, 60);
  const leaderboard = db.activityLeaderboard('guild-1', 1440, 10);
  assert.ok(Array.isArray(trend.buckets));
  assert.equal(leaderboard[0].user_id, 'user-a');
  assert.equal(leaderboard[0].count, 2);
  assert.equal(leaderboard[1].user_id, 'user-b');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
