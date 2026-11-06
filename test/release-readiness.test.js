import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { createCommunityCoreAPI } from '../src/core/api-v1.js';
import { ModuleManager } from '../src/core/module-manager.js';
import { runReleaseReadiness } from '../src/core/release-readiness.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-rc-'));
  return { dir, file: path.join(dir, 'core.sqlite') };
}

test('release readiness validates a fresh core database', () => {
  const tmp = tempDb();
  const db = new CommunityDatabase(tmp.file);
  const events = new CoreEventBus();
  const api = createCommunityCoreAPI({ database: db, events });
  const moduleManager = { list: () => [] };
  const result = runReleaseReadiness({ database: db, events, api, moduleManager });
  assert.equal(result.version, '1.0');
  assert.equal(result.ok, true);
  assert.ok(result.checks.every(check => check.ok));
  db.close();
  fs.rmSync(tmp.dir, { recursive: true, force: true });
});

test('release readiness catches a broken stable invariant', () => {
  const tmp = tempDb();
  const db = new CommunityDatabase(tmp.file);
  const events = new CoreEventBus();
  const api = createCommunityCoreAPI({ database: db, events });
  const result = runReleaseReadiness({ database: db, events: {}, api });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(x => x.id === 'event-bus').ok, false);
  db.close();
  fs.rmSync(tmp.dir, { recursive: true, force: true });
});

test('older incident/ticket schemas migrate forward without data loss', () => {
  const tmp = tempDb();
  const legacy = new DatabaseSync(tmp.file);
  legacy.exec('PRAGMA foreign_keys = ON;');
  legacy.exec(`
    CREATE TABLE communities (
      guild_id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'custom',
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', support_mode TEXT NOT NULL DEFAULT 'ai', category TEXT NOT NULL DEFAULT 'general',
      assigned_to TEXT, priority TEXT NOT NULL DEFAULT 'normal', subject TEXT, summary TEXT,
      channel_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
    );
    CREATE TABLE incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      severity TEXT NOT NULL DEFAULT 'medium', type TEXT NOT NULL DEFAULT 'security', summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
    );
  `);
  const now = new Date().toISOString();
  legacy.prepare("INSERT INTO communities(guild_id,name,profile_id,created_at,updated_at) VALUES(?,?,?,?,?)").run('legacy', 'Legacy', 'custom', now, now);
  legacy.prepare("INSERT INTO tickets(guild_id,user_id,subject,created_at,updated_at) VALUES(?,?,?,?,?)").run('legacy', 'u1', 'keep me', now, now);
  legacy.prepare("INSERT INTO incidents(guild_id,title,created_at,updated_at) VALUES(?,?,?,?)").run('legacy', 'keep incident', now, now);
  legacy.close();

  const migrated = new CommunityDatabase(tmp.file);
  const ticket = migrated.db.prepare('SELECT subject,first_response_at,resolved_at FROM tickets WHERE guild_id=?').get('legacy');
  const incident = migrated.db.prepare('SELECT title,assigned_to,resolved_at,resolved_by FROM incidents WHERE guild_id=?').get('legacy');
  assert.equal(ticket.subject, 'keep me');
  assert.equal(ticket.first_response_at, null);
  assert.equal(incident.title, 'keep incident');
  assert.equal(incident.assigned_to, null);
  migrated.close();
  fs.rmSync(tmp.dir, { recursive: true, force: true });
});
