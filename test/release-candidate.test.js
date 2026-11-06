import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { AuditManager } from '../src/core/audit.js';
import { AutomationEngine } from '../src/core/automation-engine.js';
import { createCommunityCoreAPI } from '../src/core/api-v1.js';
import { backupDatabase, restoreDatabase } from '../src/core/database-backup.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-rc-')); }
function closeAndRemove(db, dir) { try { db.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }

 test('migration upgrades an older incident/ticket schema in place', () => {
  const dir = tempDir();
  const file = path.join(dir, 'legacy.sqlite');
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE communities (guild_id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'custom', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL, summary TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, support_mode TEXT NOT NULL, category TEXT NOT NULL, assigned_to TEXT, priority TEXT NOT NULL, subject TEXT, summary TEXT, channel_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  raw.close();
  const db = new CommunityDatabase(file);
  const incidentColumns = new Set(db.db.prepare('PRAGMA table_info(incidents)').all().map(x => x.name));
  const ticketColumns = new Set(db.db.prepare('PRAGMA table_info(tickets)').all().map(x => x.name));
  assert.equal(incidentColumns.has('assigned_to'), true);
  assert.equal(incidentColumns.has('resolved_at'), true);
  assert.equal(incidentColumns.has('resolved_by'), true);
  assert.equal(ticketColumns.has('first_response_at'), true);
  assert.equal(ticketColumns.has('resolved_at'), true);
  closeAndRemove(db, dir);
});

test('community-scoped data never leaks between communities', () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  db.upsertCommunity({ id: 'guild-b', name: 'B' });
  db.upsertUser({ id: 'user-1', username: 'one', displayName: 'One' });
  db.upsertUser({ id: 'user-2', username: 'two', displayName: 'Two' });
  db.upsertMembership('guild-a', 'user-1');
  db.upsertMembership('guild-b', 'user-2');
  db.recordActivity('guild-a', 'message', 'user-1');
  db.recordActivity('guild-b', 'message', 'user-2');
  db.createTicket('guild-a', { userId: 'user-1', subject: 'A ticket' });
  db.createTicket('guild-b', { userId: 'user-2', subject: 'B ticket' });
  assert.deepEqual(db.listUsers('guild-a').map(x => x.user_id), ['user-1']);
  assert.deepEqual(db.listUsers('guild-b').map(x => x.user_id), ['user-2']);
  assert.deepEqual(db.listTickets('guild-a').map(x => x.subject), ['A ticket']);
  assert.deepEqual(db.listTickets('guild-b').map(x => x.subject), ['B ticket']);
  closeAndRemove(db, dir);
});

test('event history supports ordered replay and reconnect filtering', () => {
  const bus = new CoreEventBus({ historySize: 10 });
  bus.publish('a', { n: 1 }, { communityId: 'guild-a' });
  bus.publish('b', { n: 2 }, { communityId: 'guild-b' });
  bus.publish('c', { n: 3 }, { communityId: 'guild-a' });
  const replay = bus.history({ after: 1, communityId: 'guild-a' });
  assert.deepEqual(replay.map(x => x.type), ['c']);
  assert.equal(replay[0].sequence, 3);
  assert.equal(bus.lastSequence, 3);
});

test('event subscriber failures remain isolated', () => {
  const bus = new CoreEventBus({ historySize: 3, logger: { warn() {} } });
  const seen = [];
  bus.subscribe(() => { throw new Error('broken subscriber'); });
  bus.subscribe(event => seen.push(event.type));
  const event = bus.publish('stable.event', { ok: true });
  assert.equal(event.type, 'stable.event');
  assert.deepEqual(seen, ['stable.event']);
});

test('automation survives an engine restart because jobs and run records are durable', async () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  const bus = new CoreEventBus();
  const audit = new AuditManager(db, bus);
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  db.saveAutomation('guild-a', { name: 'test', trigger: { type: 'release.test' }, actions: [{ type: 'audit' }] });
  const first = new AutomationEngine(db, bus, audit, {}, { warn() {} });
  bus.publish('release.test', { ok: true }, { communityId: 'guild-a' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(db.automationStats('guild-a').success, 1);
  first.close();
  const second = new AutomationEngine(db, bus, audit, {}, { warn() {} });
  bus.publish('release.test', { ok: true }, { communityId: 'guild-a' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(db.automationStats('guild-a').success, 2);
  second.close();
  closeAndRemove(db, dir);
});

test('SQLite backup and restore roundtrip preserves community data', () => {
  const dir = tempDir();
  const dbFile = path.join(dir, 'core.sqlite');
  const backupFile = path.join(dir, 'backups', 'core.sqlite');
  const restoredFile = path.join(dir, 'restored.sqlite');
  const db = new CommunityDatabase(dbFile);
  db.upsertCommunity({ id: 'guild-a', name: 'Backup Community' });
  db.setSetting('guild-a', 'theme', 'dark');
  backupDatabase(db, backupFile);
  db.close();
  restoreDatabase(backupFile, restoredFile);
  const restored = new CommunityDatabase(restoredFile);
  assert.equal(restored.getCommunity('guild-a').name, 'Backup Community');
  assert.equal(restored.db.prepare('SELECT value FROM community_settings WHERE guild_id=? AND key=?').get('guild-a', 'theme').value, 'dark');
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stable API v1 remains callable with minimal dependencies', () => {
  const api = createCommunityCoreAPI({ events: new CoreEventBus(), capabilities: { releaseCandidate: true } });
  const meta = api.meta();
  assert.equal(meta.version, '1.0');
  assert.equal(meta.capabilities.releaseCandidate, true);
  assert.equal(typeof api.events.history, 'function');
  assert.equal(typeof api.data.getSetting, 'function');
});


test('release announcements are atomic and isolated per community', () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  db.upsertCommunity({ id: 'guild-b', name: 'B' });
  const release = { id: 'release-1', tag_name: 'v9.9.9-beta.1', type: 'beta' };
  assert.equal(db.reserveReleaseAnnouncement('guild-a', release), true);
  assert.equal(db.reserveReleaseAnnouncement('guild-a', release), false);
  assert.equal(db.reserveReleaseAnnouncement('guild-b', release), true);
  db.setReleaseAnnouncement('guild-a', release, 'message-a');
  assert.equal(db.releaseAnnouncement('guild-a', release.id).status, 'sent');
  assert.equal(db.releaseAnnouncement('guild-a', release.id).message_id, 'message-a');
  assert.equal(db.releaseAnnouncement('guild-b', release.id).status, 'pending');
  db.cancelReleaseAnnouncement('guild-b', release.id);
  assert.equal(db.releaseAnnouncement('guild-b', release.id), null);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reaction-role state is isolated per community', () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  db.upsertCommunity({ id: 'guild-b', name: 'B' });
  db.setReactionRoleState('guild-a', { panelMessageId: 'panel-a', roleIds: { alpha: 'role-a' } });
  db.setReactionRoleState('guild-b', { panelMessageId: 'panel-b', roleIds: { alpha: 'role-b' } });
  assert.deepEqual(db.getReactionRoleState('guild-a'), { panelMessageId: 'panel-a', roleIds: { alpha: 'role-a' } });
  assert.deepEqual(db.getReactionRoleState('guild-b'), { panelMessageId: 'panel-b', roleIds: { alpha: 'role-b' } });
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stale pending release reservation can be recovered without duplicating sent releases', () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  const release = { id: 'release-stale', tag_name: 'v1.0.0-beta.1', type: 'beta' };
  assert.equal(db.reserveReleaseAnnouncement('guild-a', release), true);
  assert.equal(db.reserveReleaseAnnouncement('guild-a', release, 30_000), false);
  db.db.prepare("UPDATE release_announcements SET created_at=? WHERE guild_id=? AND release_id=?").run(new Date(Date.now() - 120_000).toISOString(), 'guild-a', release.id);
  assert.equal(db.reserveReleaseAnnouncement('guild-a', release, 30_000), true);
  db.setReleaseAnnouncement('guild-a', release, 'message-1');
  assert.equal(db.reserveReleaseAnnouncement('guild-a', release, 30_000), false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ticket and AI conversation messages are hard-scoped to their community', () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  db.upsertCommunity({ id: 'guild-b', name: 'B' });

  const ticketA = db.createTicket('guild-a', { userId: 'user-a', subject: 'A' });
  const ticketB = db.createTicket('guild-b', { userId: 'user-b', subject: 'B' });
  db.addTicketMessage('guild-a', ticketA, 'user-a', 'user', 'secret-a');
  db.addTicketMessage('guild-b', ticketB, 'user-b', 'user', 'secret-b');
  assert.deepEqual(db.listTicketMessages('guild-a', ticketA).map(x => x.content), ['secret-a']);
  assert.deepEqual(db.listTicketMessages('guild-b', ticketA), []);
  assert.deepEqual(db.listTicketMessages('guild-a', ticketB), []);

  const conversationA = db.addAIConversation('guild-a', 'user-a', 'A chat');
  const conversationB = db.addAIConversation('guild-b', 'user-b', 'B chat');
  db.addAIMessage('guild-a', conversationA, 'user', 'ai-secret-a');
  db.addAIMessage('guild-b', conversationB, 'user', 'ai-secret-b');
  assert.equal(db.getAIConversation('guild-a', conversationA).title, 'A chat');
  assert.equal(db.getAIConversation('guild-b', conversationA), null);
  assert.deepEqual(db.listAIMessages('guild-a', conversationA).map(x => x.content), ['ai-secret-a']);
  assert.deepEqual(db.listAIMessages('guild-b', conversationA), []);
  assert.deepEqual(db.listAIMessages('guild-a', conversationB), []);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cross-community relational writes are rejected', () => {
  const dir = tempDir();
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({ id: 'guild-a', name: 'A' });
  db.upsertCommunity({ id: 'guild-b', name: 'B' });
  const ticketA = db.createTicket('guild-a', { userId: 'a', subject: 'A ticket' });
  const ticketB = db.createTicket('guild-b', { userId: 'b', subject: 'B ticket' });
  const incidentA = db.createIncident('guild-a', { title: 'A incident' });
  const incidentB = db.createIncident('guild-b', { title: 'B incident' });
  db.upsertKnowledge('guild-a', null, 'A doc', 'A content', 'a');
  db.upsertKnowledge('guild-b', null, 'B doc', 'B content', 'b');
  const docB = db.listKnowledge('guild-b')[0].id;
  const sessionA = db.createAIAgentSession('guild-a', 'a').id;
  const sessionB = db.createAIAgentSession('guild-b', 'b').id;

  assert.throws(() => db.linkTicketIncident('guild-a', ticketA, incidentB), /Incident nicht gefunden/);
  assert.throws(() => db.linkTicketIncident('guild-a', ticketB, incidentA), /Ticket nicht gefunden/);
  assert.throws(() => db.addIncidentTimeline('guild-a', incidentB, { message: 'cross-community' }), /Incident nicht gefunden/);
  assert.throws(() => db.addTicketAIAnalysis('guild-a', ticketB, 'a', { content: 'cross-community' }), /Ticket nicht gefunden/);
  assert.throws(() => db.addKnowledgeFeedback('guild-a', docB, 'a', true), /Knowledge-Dokument nicht gefunden/);
  assert.throws(() => db.addKnowledgeFeedback('guild-a', db.listKnowledge('guild-a')[0].id, 'a', true, '', ticketB), /Ticket nicht gefunden/);
  assert.throws(() => db.addAIAgentRun('guild-a', { sessionId: sessionB, userId: 'a' }), /AI-Agent-Session nicht gefunden/);
  assert.doesNotThrow(() => db.addAIAgentRun('guild-a', { sessionId: sessionA, userId: 'a' }));
  closeAndRemove(db, dir);
});
