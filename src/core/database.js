import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class CommunityDatabase {
  constructor(file = process.env.DATABASE_PATH || './data/community-core.sqlite') {
    this.file = path.resolve(file);
    this._db = null;
    this.open();
  }
  open() {
    if (this._db?.isOpen) return this._db;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this._db = new DatabaseSync(this.file);
    this._db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
    return this._db;
  }
  get db() {
    // The dashboard can intentionally outlive a Discord connection restart.
    // Re-open SQLite transparently if another lifecycle path closed it.
    return this.open();
  }
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS communities (
        guild_id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'custom',
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_settings (
        guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (guild_id,key),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS release_announcements (
        guild_id TEXT NOT NULL, release_id TEXT NOT NULL, tag_name TEXT NOT NULL, type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, created_at TEXT NOT NULL, sent_at TEXT,
        PRIMARY KEY (guild_id, release_id),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_release_announcements_guild_time ON release_announcements(guild_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS issue_announcements (
        guild_id TEXT NOT NULL, issue_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        message_id TEXT, created_at TEXT NOT NULL, sent_at TEXT,
        PRIMARY KEY (guild_id, issue_id),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_issue_announcements_guild_time ON issue_announcements(guild_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS community_rules (
        guild_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Community-Regeln', content TEXT NOT NULL DEFAULT '',
        rules_channel_id TEXT, published_message_id TEXT, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS modules (
        guild_id TEXT NOT NULL, module_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (guild_id,module_id),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT,
        title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, type TEXT NOT NULL,
        actor_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_sources (
        source TEXT NOT NULL, event_id TEXT NOT NULL, guild_id TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY (source,event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_audit_guild_time ON audit_events(guild_id,created_at);
      CREATE TABLE IF NOT EXISTS ai_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'community',
        memory_key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(guild_id, scope, memory_key),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, title TEXT NOT NULL,
        content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, event_type TEXT NOT NULL,
        user_id TEXT, channel_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS core_users (
        user_id TEXT PRIMARY KEY, username TEXT, display_name TEXT, avatar_url TEXT, bot INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_memberships (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT, joined_at TEXT, left_at TEXT,
        roles_json TEXT NOT NULL DEFAULT '[]', staff INTEGER NOT NULL DEFAULT 0, risk_score INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0, last_activity_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id,user_id), FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS staff_status (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline', note TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id,user_id), FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS staff_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(guild_id,name),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS staff_group_members (
        guild_id TEXT NOT NULL, group_id INTEGER NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (guild_id,group_id,user_id),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES staff_groups(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memberships_user ON community_memberships(user_id);
      CREATE INDEX IF NOT EXISTS idx_memberships_activity ON community_memberships(guild_id,last_activity_at);
      CREATE INDEX IF NOT EXISTS idx_activity_guild_time ON activity_events(guild_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_guild_type_time ON activity_events(guild_id, event_type, created_at);
      CREATE TABLE IF NOT EXISTS security_state (
        guild_id TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 0, level TEXT NOT NULL DEFAULT 'normal',
        snapshot_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_security_state_level ON security_state(level, updated_at);
      CREATE TABLE IF NOT EXISTS security_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, score INTEGER NOT NULL, level TEXT NOT NULL,
        snapshot_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_security_history_guild_time ON security_history(guild_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS security_action_confirmations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, requested_by TEXT, action TEXT NOT NULL,
        args_json TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
        expires_at TEXT NOT NULL, confirmed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_security_action_confirmations_guild_status ON security_action_confirmations(guild_id,status,created_at);
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', support_mode TEXT NOT NULL DEFAULT 'ai', category TEXT NOT NULL DEFAULT 'general',
        assigned_to TEXT, priority TEXT NOT NULL DEFAULT 'normal', subject TEXT, summary TEXT,
        channel_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status, updated_at);
      CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, user_id TEXT, role TEXT NOT NULL,
        content TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS support_sla (
        guild_id TEXT NOT NULL, priority TEXT NOT NULL, first_response_minutes INTEGER NOT NULL, resolution_minutes INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY (guild_id,priority),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS knowledge_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, document_id INTEGER NOT NULL, user_id TEXT,
        ticket_id INTEGER, helpful INTEGER NOT NULL, query TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_feedback_doc ON knowledge_feedback(guild_id,document_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS ticket_incident_links (
        guild_id TEXT NOT NULL, ticket_id INTEGER NOT NULL, incident_id INTEGER NOT NULL,
        linked_by TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY (guild_id,ticket_id,incident_id),
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_incident_links_ticket ON ticket_incident_links(guild_id,ticket_id);
      CREATE INDEX IF NOT EXISTS idx_ticket_incident_links_incident ON ticket_incident_links(guild_id,incident_id);
      CREATE TABLE IF NOT EXISTS ticket_ai_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, ticket_id INTEGER NOT NULL, user_id TEXT,
        provider TEXT, model TEXT, content TEXT NOT NULL, recommendation_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_ai_analyses_ticket ON ticket_ai_analyses(guild_id,ticket_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS automation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, trigger_json TEXT NOT NULL DEFAULT '{}', actions_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS automation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, job_id INTEGER NOT NULL,
        event_type TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
        started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, error TEXT,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE,
        FOREIGN KEY (job_id) REFERENCES automation_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_automation_runs_guild_started ON automation_runs(guild_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_job_started ON automation_runs(job_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS tool_confirmations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT, tool TEXT NOT NULL,
        args_json TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
        expires_at TEXT NOT NULL, confirmed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tool_confirmations_guild_status ON tool_confirmations(guild_id,status,created_at);
      CREATE TABLE IF NOT EXISTS core_roles (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(guild_id,user_id), FOREIGN KEY(guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS core_role_definitions (
        guild_id TEXT NOT NULL, role TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        permissions_json TEXT NOT NULL DEFAULT '[]', built_in INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(guild_id,role), FOREIGN KEY(guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_core_role_definitions_guild ON core_role_definitions(guild_id,role);
      CREATE TABLE IF NOT EXISTS ai_providers (
        guild_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '',
        api_key TEXT, updated_at TEXT NOT NULL, FOREIGN KEY(guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        severity TEXT NOT NULL DEFAULT 'medium', type TEXT NOT NULL DEFAULT 'security', summary TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_guild_status ON incidents(guild_id,status,updated_at);
      CREATE TABLE IF NOT EXISTS incident_timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER NOT NULL, guild_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'note', actor_id TEXT, message TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident ON incident_timeline(incident_id,created_at);
      CREATE TABLE IF NOT EXISTS ai_secrets (
        guild_id TEXT PRIMARY KEY, secret TEXT, updated_at TEXT NOT NULL,
        FOREIGN KEY(guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_provider_slots (
        guild_id TEXT NOT NULL, slot_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '',
        secret TEXT, priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL, PRIMARY KEY(guild_id,slot_id),
        FOREIGN KEY(guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_provider_slots_priority ON ai_provider_slots(guild_id,enabled,priority);
      CREATE TABLE IF NOT EXISTS ai_agent_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT, title TEXT NOT NULL DEFAULT 'AI Agent Session',
        status TEXT NOT NULL DEFAULT 'active', context_json TEXT NOT NULL DEFAULT '{}', message_count INTEGER NOT NULL DEFAULT 0,
        tool_count INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_guild_updated ON ai_agent_sessions(guild_id,updated_at DESC);
      CREATE TABLE IF NOT EXISTS ai_agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, session_id INTEGER, user_id TEXT, kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started', tool TEXT, confirmation_id INTEGER, request_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL, completed_at TEXT,
        FOREIGN KEY (guild_id) REFERENCES communities(guild_id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES ai_agent_sessions(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_guild_time ON ai_agent_runs(guild_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_session ON ai_agent_runs(session_id,created_at DESC);
    `);
    // Forward-compatible incident migrations for databases created by older Core versions.
    const columns = new Set(this.db.prepare('PRAGMA table_info(incidents)').all().map((row) => row.name));
    if (!columns.has('assigned_to')) this.db.exec('ALTER TABLE incidents ADD COLUMN assigned_to TEXT');
    if (!columns.has('resolved_at')) this.db.exec('ALTER TABLE incidents ADD COLUMN resolved_at TEXT');
    if (!columns.has('resolved_by')) this.db.exec('ALTER TABLE incidents ADD COLUMN resolved_by TEXT');
    for (const sql of [
      'ALTER TABLE tickets ADD COLUMN first_response_at TEXT',
      'ALTER TABLE tickets ADD COLUMN resolved_at TEXT'
    ]) { try { this.db.exec(sql); } catch (error) { if (!String(error?.message || error).includes('duplicate column')) throw error; } }
  }

  now() { return new Date().toISOString(); }
  upsertCommunity(guild, profileId = 'custom') {
    const now = this.now();
    this.db.prepare(`INSERT INTO communities(guild_id,name,profile_id,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`).run(guild.id, guild.name, profileId, now, now);
    return this.getCommunity(guild.id);
  }
  getCommunity(guildId) { return this.db.prepare('SELECT * FROM communities WHERE guild_id=?').get(guildId) || null; }
  listCommunities() { return this.db.prepare('SELECT * FROM communities ORDER BY name COLLATE NOCASE').all(); }
  getRules(guildId) {
    const row = this.db.prepare('SELECT * FROM community_rules WHERE guild_id=?').get(guildId);
    return row || { guild_id: guildId, title: 'Community-Regeln', content: '', rules_channel_id: null, published_message_id: null, updated_at: null };
  }
  setRules(guildId, { title = 'Community-Regeln', content = '', rulesChannelId = null, publishedMessageId = null } = {}) {
    this.db.prepare(`INSERT INTO community_rules(guild_id,title,content,rules_channel_id,published_message_id,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(guild_id) DO UPDATE SET title=excluded.title,content=excluded.content,rules_channel_id=excluded.rules_channel_id,published_message_id=excluded.published_message_id,updated_at=excluded.updated_at`)
      .run(guildId, String(title), String(content), rulesChannelId || null, publishedMessageId || null, this.now());
    return this.getRules(guildId);
  }
  setProfile(guildId, profileId) { this.db.prepare('UPDATE communities SET profile_id=?,updated_at=? WHERE guild_id=?').run(profileId, this.now(), guildId); }
  isAIEnabled(guildId) { return this.getSettings(guildId)['ai.enabled'] === true; }
  setAIEnabled(guildId, enabled) { this.setSetting(guildId, 'ai.enabled', Boolean(enabled)); }
  setSetting(guildId, key, value) { this.db.prepare(`INSERT INTO community_settings(guild_id,key,value) VALUES(?,?,?) ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value`).run(guildId,key,typeof value==='string'?value:JSON.stringify(value)); }
  getSettings(guildId) { const rows=this.db.prepare('SELECT key,value FROM community_settings WHERE guild_id=?').all(guildId); return Object.fromEntries(rows.map(r=>{try{return [r.key,JSON.parse(r.value)]}catch{return [r.key,r.value]}})); }
  getSetting(guildId, key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM community_settings WHERE guild_id=? AND key=?').get(guildId, key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }
  setReleaseAnnouncement(guildId, release, messageId = null) {
    const now = this.now();
    this.db.prepare(`UPDATE release_announcements SET status='sent',message_id=?,sent_at=? WHERE guild_id=? AND release_id=?`).run(messageId || null, now, guildId, String(release.id));
    return this.db.prepare('SELECT * FROM release_announcements WHERE guild_id=? AND release_id=?').get(guildId, String(release.id));
  }
  reserveReleaseAnnouncement(guildId, release, leaseMs = 5 * 60_000) {
    const now = this.now();
    const id = String(release.id);
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO release_announcements(guild_id,release_id,tag_name,type,status,created_at) VALUES(?,?,?,?, 'pending',?)`).run(guildId, id, String(release.tag_name || release.name || ''), String(release.type || 'beta'), now);
    if (Number(inserted.changes) === 1) return true;
    const cutoff = new Date(Date.now() - Math.max(30_000, Number(leaseMs) || 300_000)).toISOString();
    const reclaimed = this.db.prepare(`UPDATE release_announcements SET status='pending',created_at=?,message_id=NULL,sent_at=NULL WHERE guild_id=? AND release_id=? AND status='pending' AND created_at<?`).run(now, guildId, id, cutoff);
    return Number(reclaimed.changes) === 1;
  }
  releaseAnnouncement(guildId, releaseId) { return this.db.prepare('SELECT * FROM release_announcements WHERE guild_id=? AND release_id=?').get(guildId, String(releaseId)) || null; }
  releaseAnnouncements(guildId, limit = 100) { return this.db.prepare('SELECT * FROM release_announcements WHERE guild_id=? ORDER BY created_at DESC LIMIT ?').all(guildId, Math.min(500, Math.max(1, Number(limit) || 100))); }
  cancelReleaseAnnouncement(guildId, releaseId) { this.db.prepare("DELETE FROM release_announcements WHERE guild_id=? AND release_id=? AND status='pending'").run(guildId, String(releaseId)); }
  setIssueAnnouncement(guildId, issueId, messageId = null) {
    const now = this.now();
    this.db.prepare(`UPDATE issue_announcements SET status='sent',message_id=?,sent_at=? WHERE guild_id=? AND issue_id=?`).run(messageId || null, now, guildId, String(issueId));
    return this.db.prepare('SELECT * FROM issue_announcements WHERE guild_id=? AND issue_id=?').get(guildId, String(issueId));
  }
  reserveIssueAnnouncement(guildId, issueId, leaseMs = 5 * 60_000) {
    const now = this.now();
    const id = String(issueId);
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO issue_announcements(guild_id,issue_id,status,created_at) VALUES(?,?, 'pending',?)`).run(guildId, id, now);
    if (Number(inserted.changes) === 1) return true;
    const cutoff = new Date(Date.now() - Math.max(30_000, Number(leaseMs) || 300_000)).toISOString();
    const reclaimed = this.db.prepare(`UPDATE issue_announcements SET status='pending',created_at=?,message_id=NULL,sent_at=NULL WHERE guild_id=? AND issue_id=? AND status='pending' AND created_at<?`).run(now, guildId, id, cutoff);
    return Number(reclaimed.changes) === 1;
  }
  cancelIssueAnnouncement(guildId, issueId) { this.db.prepare("DELETE FROM issue_announcements WHERE guild_id=? AND issue_id=? AND status='pending'").run(guildId, String(issueId)); }
  issueAnnouncements(guildId, limit = 50) { return this.db.prepare('SELECT * FROM issue_announcements WHERE guild_id=? ORDER BY created_at DESC LIMIT ?').all(guildId, Math.min(500, Math.max(1, Number(limit) || 50))); }
  getReactionRoleState(guildId) {
    return {
      panelMessageId: this.getSetting(guildId, 'reactionRoles.panelMessageId', null),
      roleIds: this.getSetting(guildId, 'reactionRoles.roleIds', {}),
    };
  }
  setReactionRoleState(guildId, { panelMessageId = null, roleIds = {} } = {}) {
    this.setSetting(guildId, 'reactionRoles.panelMessageId', panelMessageId);
    this.setSetting(guildId, 'reactionRoles.roleIds', roleIds);
    return this.getReactionRoleState(guildId);
  }
  setModule(guildId,moduleId,enabled,config={}) { this.db.prepare(`INSERT INTO modules(guild_id,module_id,enabled,config_json) VALUES(?,?,?,?) ON CONFLICT(guild_id,module_id) DO UPDATE SET enabled=excluded.enabled,config_json=excluded.config_json`).run(guildId,moduleId,enabled?1:0,JSON.stringify(config)); }
  listModules(guildId) { return this.db.prepare('SELECT module_id,enabled,config_json FROM modules WHERE guild_id=?').all(guildId).map(r=>({moduleId:r.module_id,enabled:Boolean(r.enabled),config:JSON.parse(r.config_json||'{}')})); }
  addAudit(guildId,type,actorId,payload={}, { source='core', eventId=null } = {}) {
    const id = eventId ? String(eventId) : null;
    if (id && !this.db.prepare('SELECT 1 FROM audit_sources WHERE source=? AND event_id=?').get(source,id)) {
      this.db.prepare('INSERT INTO audit_sources(source,event_id,guild_id,created_at) VALUES(?,?,?,?)').run(source,id,guildId||null,this.now());
    } else if (id) return null;
    const r = this.db.prepare('INSERT INTO audit_events(guild_id,type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?)').run(guildId,type,actorId||null,JSON.stringify({ ...payload, auditSource: source }),this.now());
    return Number(r.lastInsertRowid);
  }
  listAudit(guildId, limit=100, source=null) {
    const rows=this.db.prepare('SELECT id,guild_id,type,actor_id,payload_json,created_at FROM audit_events WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(guildId,Math.min(500,Math.max(1,Number(limit)||100)));
    return rows.filter(r=>!source || (()=>{try{return JSON.parse(r.payload_json||'{}').auditSource===source}catch{return false}})()).map(r=>({...r,payload:JSON.parse(r.payload_json||'{}')}));
  }
  upsertUser(user={}) {
    if(!user.id) return null; const now=this.now();
    this.db.prepare(`INSERT INTO core_users(user_id,username,display_name,avatar_url,bot,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url,bot=excluded.bot,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
      .run(String(user.id),user.username||null,user.displayName||null,user.avatarUrl||null,user.bot?1:0,now,now,now);
  }
  upsertMembership(guildId,userId,data={}) {
    if(!guildId||!userId) return; const now=this.now();
    this.db.prepare(`INSERT INTO community_memberships(guild_id,user_id,nickname,joined_at,left_at,roles_json,staff,risk_score,warning_count,last_activity_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET nickname=COALESCE(excluded.nickname,community_memberships.nickname),joined_at=COALESCE(excluded.joined_at,community_memberships.joined_at),left_at=excluded.left_at,roles_json=excluded.roles_json,staff=excluded.staff,risk_score=excluded.risk_score,warning_count=excluded.warning_count,last_activity_at=COALESCE(excluded.last_activity_at,community_memberships.last_activity_at),updated_at=excluded.updated_at`)
      .run(String(guildId),String(userId),data.nickname||null,data.joinedAt||null,data.leftAt||null,JSON.stringify(data.roles||[]),data.staff?1:0,Number(data.riskScore||0),Number(data.warningCount||0),data.lastActivityAt||null,now);
  }
  touchMembershipActivity(guildId,userId,at=this.now()) { this.db.prepare('UPDATE community_memberships SET last_activity_at=?,updated_at=? WHERE guild_id=? AND user_id=?').run(at,at,guildId,userId); }
  markMembershipLeft(guildId,userId,at=this.now()) { this.db.prepare('UPDATE community_memberships SET left_at=?,updated_at=? WHERE guild_id=? AND user_id=?').run(at,at,guildId,userId); }
  listUsers(guildId, limit=200) {
    const rows=this.db.prepare(`SELECT u.*,m.nickname,m.joined_at,m.left_at,m.roles_json,m.staff,m.risk_score,m.warning_count,m.last_activity_at,m.updated_at membership_updated_at
      FROM community_memberships m JOIN core_users u ON u.user_id=m.user_id WHERE m.guild_id=? ORDER BY COALESCE(m.last_activity_at,u.last_seen_at) DESC LIMIT ?`).all(guildId,Math.min(1000,Math.max(1,Number(limit)||200)));
    return rows.map(r=>({...r,roles:JSON.parse(r.roles_json||'[]'),staff:Boolean(r.staff)}));
  }
  getUserProfile(guildId, userId) {
    const user = this.db.prepare(`SELECT u.*,m.nickname,m.joined_at,m.left_at,m.roles_json,m.staff,m.risk_score,m.warning_count,m.last_activity_at,m.updated_at membership_updated_at,
      s.status staff_status,s.note staff_note,s.updated_at staff_updated_at,
      cr.role core_role,cr.updated_at core_role_updated_at
      FROM core_users u
      LEFT JOIN community_memberships m ON m.user_id=u.user_id AND m.guild_id=?
      LEFT JOIN staff_status s ON s.user_id=u.user_id AND s.guild_id=?
      LEFT JOIN core_roles cr ON cr.user_id=u.user_id AND cr.guild_id=?
      WHERE u.user_id=?`).get(guildId,guildId,guildId,String(userId));
    if (!user) return null;
    const roles=JSON.parse(user.roles_json||'[]');
    const activity=this.db.prepare(`SELECT event_type,COUNT(*) count,MAX(created_at) last_at FROM activity_events WHERE guild_id=? AND user_id=? GROUP BY event_type ORDER BY count DESC`).all(guildId,String(userId));
    const tickets=this.db.prepare(`SELECT id,status,support_mode,category,assigned_to,priority,subject,created_at,updated_at FROM tickets WHERE guild_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 25`).all(guildId,String(userId));
    const audit=this.db.prepare(`SELECT id,type,actor_id,payload_json,created_at FROM audit_events WHERE guild_id=? AND (actor_id=? OR payload_json LIKE ?) ORDER BY id DESC LIMIT 25`).all(guildId,String(userId),`%\"userId\":\"${String(userId).replace(/\"/g,'')}\"%`);
    return { id:user.user_id, username:user.username, displayName:user.display_name, avatarUrl:user.avatar_url, bot:Boolean(user.bot),
      nickname:user.nickname, joinedAt:user.joined_at, leftAt:user.left_at, roles, staff:Boolean(user.staff), riskScore:Number(user.risk_score||0),
      warningCount:Number(user.warning_count||0), lastActivityAt:user.last_activity_at||user.last_seen_at, firstSeenAt:user.first_seen_at, lastSeenAt:user.last_seen_at,
      staffStatus:user.staff_status||'offline', staffNote:user.staff_note||null, staffUpdatedAt:user.staff_updated_at||null,
      coreRole:user.core_role||null, coreRoleUpdatedAt:user.core_role_updated_at||null, activity, tickets,
      audit:audit.map(r=>({...r,payload:JSON.parse(r.payload_json||'{}')})) };
  }
  staffOverview(guildId) {
    const rows=this.db.prepare(`SELECT m.user_id,u.username,u.display_name,u.avatar_url,m.roles_json,m.risk_score,m.warning_count,m.last_activity_at,
      COALESCE(s.status,'offline') status,s.note,s.updated_at status_updated_at,cr.role core_role
      FROM community_memberships m JOIN core_users u ON u.user_id=m.user_id
      LEFT JOIN staff_status s ON s.guild_id=m.guild_id AND s.user_id=m.user_id
      LEFT JOIN core_roles cr ON cr.guild_id=m.guild_id AND cr.user_id=m.user_id
      WHERE m.guild_id=? AND m.staff=1 ORDER BY CASE COALESCE(s.status,'offline') WHEN 'available' THEN 0 WHEN 'busy' THEN 1 WHEN 'dnd' THEN 2 ELSE 3 END,u.display_name`).all(guildId);
    const counts={available:0,busy:0,dnd:0,offline:0};
    for(const r of rows) counts[r.status]=(counts[r.status]||0)+1;
    return {counts,total:rows.length,staff:rows.map(r=>({userId:r.user_id,username:r.username,displayName:r.display_name,avatarUrl:r.avatar_url,roles:JSON.parse(r.roles_json||'[]'),riskScore:Number(r.risk_score||0),warningCount:Number(r.warning_count||0),lastActivityAt:r.last_activity_at,status:r.status,note:r.note||null,statusUpdatedAt:r.status_updated_at,coreRole:r.core_role||null}))};
  }
  setStaffStatus(guildId,userId,status,note='') { const allowed=new Set(['available','busy','dnd','offline']); const value=allowed.has(status)?status:'offline'; const now=this.now(); this.db.prepare(`INSERT INTO staff_status(guild_id,user_id,status,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=excluded.updated_at`).run(guildId,userId,value,note||null,now); return {guildId,userId,status:value,note:note||null,updatedAt:now}; }
  listStaffStatus(guildId) { return this.db.prepare('SELECT * FROM staff_status WHERE guild_id=? ORDER BY updated_at DESC').all(guildId); }
  setStaffMember(guildId,userId,isStaff=true) { const now=this.now(); const m=this.db.prepare('SELECT user_id FROM community_memberships WHERE guild_id=? AND user_id=?').get(String(guildId),String(userId)); if(!m) throw new Error('Nutzer ist in dieser Community nicht synchronisiert.'); this.db.prepare('UPDATE community_memberships SET staff=?,updated_at=? WHERE guild_id=? AND user_id=?').run(isStaff?1:0,now,String(guildId),String(userId)); if(!isStaff) this.db.prepare('DELETE FROM staff_group_members WHERE guild_id=? AND user_id=?').run(String(guildId),String(userId)); return {guildId:String(guildId),userId:String(userId),staff:Boolean(isStaff)}; }
  listStaffGroups(guildId) { return this.db.prepare(`SELECT g.*,COUNT(m.user_id) member_count FROM staff_groups g LEFT JOIN staff_group_members m ON m.guild_id=g.guild_id AND m.group_id=g.id WHERE g.guild_id=? GROUP BY g.id ORDER BY g.name COLLATE NOCASE`).all(String(guildId)).map(g=>({...g,memberCount:Number(g.member_count),members:this.db.prepare('SELECT m.user_id,u.username,u.display_name FROM staff_group_members m LEFT JOIN core_users u ON u.user_id=m.user_id WHERE m.guild_id=? AND m.group_id=? ORDER BY COALESCE(u.display_name,u.username,m.user_id)').all(String(guildId),g.id)})); }
  saveStaffGroup(guildId,{id=null,name,description=''}) { const n=String(name||'').trim(); if(!n||n.length>64) throw new Error('Gruppenname ist erforderlich (max. 64 Zeichen).'); const d=String(description||'').trim().slice(0,500); const now=this.now(); if(id){const r=this.db.prepare('UPDATE staff_groups SET name=?,description=?,updated_at=? WHERE guild_id=? AND id=?').run(n,d,now,String(guildId),Number(id)); if(!r.changes) throw new Error('Staff-Gruppe nicht gefunden.'); return Number(id);} const r=this.db.prepare('INSERT INTO staff_groups(guild_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)').run(String(guildId),n,d,now,now); return Number(r.lastInsertRowid); }
  deleteStaffGroup(guildId,id) { this.db.prepare('DELETE FROM staff_groups WHERE guild_id=? AND id=?').run(String(guildId),Number(id)); }
  setStaffGroupMember(guildId,groupId,userId,add=true) { const db=this.db; const group=db.prepare('SELECT id FROM staff_groups WHERE guild_id=? AND id=?').get(String(guildId),Number(groupId)); if(!group) throw new Error('Staff-Gruppe nicht gefunden.'); const member=db.prepare('SELECT staff FROM community_memberships WHERE guild_id=? AND user_id=?').get(String(guildId),String(userId)); if(!member) throw new Error('Nutzer ist in dieser Community nicht synchronisiert.'); if(!member.staff) throw new Error('Nutzer zuerst als Staff hinzufügen.'); if(add) db.prepare('INSERT OR IGNORE INTO staff_group_members(guild_id,group_id,user_id,created_at) VALUES(?,?,?,?)').run(String(guildId),Number(groupId),String(userId),this.now()); else db.prepare('DELETE FROM staff_group_members WHERE guild_id=? AND group_id=? AND user_id=?').run(String(guildId),Number(groupId),String(userId)); return {guildId:String(guildId),groupId:Number(groupId),userId:String(userId),member:Boolean(add)}; }

  listMemories(guildId, scope='community') { return this.db.prepare('SELECT id,memory_key,value,created_at,updated_at FROM ai_memories WHERE guild_id=? AND scope=? ORDER BY updated_at DESC').all(guildId,scope); }
  setMemory(guildId,key,value,scope='community') { const now=this.now(); this.db.prepare(`INSERT INTO ai_memories(guild_id,scope,memory_key,value,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,scope,memory_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(guildId,scope,key,String(value),now,now); }
  deleteMemory(guildId,key,scope='community') { this.db.prepare('DELETE FROM ai_memories WHERE guild_id=? AND scope=? AND memory_key=?').run(guildId,scope,key); }
  listKnowledge(guildId) { return this.db.prepare('SELECT id,title,content,tags,created_at,updated_at FROM knowledge_documents WHERE guild_id=? ORDER BY updated_at DESC').all(guildId); }
  upsertKnowledge(guildId,id,title,content,tags='') { const now=this.now(); if(id) { this.db.prepare('UPDATE knowledge_documents SET title=?,content=?,tags=?,updated_at=? WHERE id=? AND guild_id=?').run(title,content,tags,now,id,guildId); return id; } const r=this.db.prepare('INSERT INTO knowledge_documents(guild_id,title,content,tags,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(guildId,title,content,tags,now,now); return Number(r.lastInsertRowid); }
  deleteKnowledge(guildId,id) { this.db.prepare('DELETE FROM knowledge_documents WHERE id=? AND guild_id=?').run(id,guildId); }
  listAutomations(guildId) { return this.db.prepare('SELECT id,name,enabled,trigger_json,actions_json,created_at,updated_at FROM automation_jobs WHERE guild_id=? ORDER BY id DESC').all(guildId).map(r=>({id:r.id,name:r.name,enabled:Boolean(r.enabled),trigger:JSON.parse(r.trigger_json||'{}'),actions:JSON.parse(r.actions_json||'[]'),createdAt:r.created_at,updatedAt:r.updated_at})); }
  saveAutomation(guildId,{id,name,enabled=true,trigger={},actions=[]}) { const now=this.now(); if(id) { this.db.prepare('UPDATE automation_jobs SET name=?,enabled=?,trigger_json=?,actions_json=?,updated_at=? WHERE id=? AND guild_id=?').run(name,enabled?1:0,JSON.stringify(trigger),JSON.stringify(actions),now,id,guildId); return id; } const r=this.db.prepare('INSERT INTO automation_jobs(guild_id,name,enabled,trigger_json,actions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(guildId,name,enabled?1:0,JSON.stringify(trigger),JSON.stringify(actions),now,now); return Number(r.lastInsertRowid); }
  deleteAutomation(guildId,id) { this.db.prepare('DELETE FROM automation_jobs WHERE id=? AND guild_id=?').run(id,guildId); }
  automationRuns(guildId, { jobId=null, limit=100 } = {}) {
    const n=Math.min(500,Math.max(1,Number(limit)||100));
    const sql=jobId ? 'SELECT * FROM automation_runs WHERE guild_id=? AND job_id=? ORDER BY id DESC LIMIT ?' : 'SELECT * FROM automation_runs WHERE guild_id=? ORDER BY id DESC LIMIT ?';
    return (jobId ? this.db.prepare(sql).all(guildId,Number(jobId),n) : this.db.prepare(sql).all(guildId,n));
  }
  automationStats(guildId) {
    const totals=this.db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped FROM automation_runs WHERE guild_id=?`).get(guildId);
    const active=this.db.prepare(`SELECT COUNT(*) count FROM automation_jobs WHERE guild_id=? AND enabled=1`).get(guildId);
    return {total:Number(totals?.total||0),success:Number(totals?.success||0),failed:Number(totals?.failed||0),skipped:Number(totals?.skipped||0),enabledJobs:Number(active?.count||0)};
  }
  cleanupAutomationRuns(days=30) { this.db.prepare("DELETE FROM automation_runs WHERE started_at < datetime('now', ?)").run(`-${Math.max(1,Number(days)||30)} days`); }
  operationsTimeline(guildId, { limit = 40, sinceMinutes = 1440 } = {}) {
    const max = Math.min(200, Math.max(1, Number(limit) || 40));
    const minutes = Math.min(43200, Math.max(1, Number(sinceMinutes) || 1440));
    const rows = [];
    const audits = this.db.prepare(`SELECT id AS source_id, 'audit' AS source, type, actor_id, payload_json AS payload, created_at FROM audit_events WHERE guild_id=? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT ?`).all(guildId, `-${minutes} minutes`, max);
    for (const r of audits) rows.push({ id:`audit:${r.source_id}`, source:r.source, type:r.type, actorId:r.actor_id, payload:(()=>{try{return JSON.parse(r.payload||'{}')}catch{return {}}})(), timestamp:r.created_at });
    const activity = this.db.prepare(`SELECT id AS source_id, 'activity' AS source, event_type AS type, user_id AS actor_id, metadata_json AS payload, created_at FROM activity_events WHERE guild_id=? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT ?`).all(guildId, `-${minutes} minutes`, max);
    for (const r of activity) rows.push({ id:`activity:${r.source_id}`, source:r.source, type:r.type, actorId:r.actor_id, payload:(()=>{try{return JSON.parse(r.payload||'{}')}catch{return {}}})(), timestamp:r.created_at });
    return rows.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,max);
  }
  operationsSearch(guildId, query, { limit = 30 } = {}) {
    const max=Math.min(100,Math.max(1,Number(limit)||30)); const q=`%${String(query).replace(/[%_]/g,'') }%`; const out=[];
    const users=this.db.prepare(`SELECT u.user_id,u.username,u.display_name,u.last_seen_at FROM core_users u JOIN community_memberships m ON m.user_id=u.user_id AND m.guild_id=? WHERE u.username LIKE ? OR u.display_name LIKE ? OR u.user_id LIKE ? ORDER BY u.last_seen_at DESC LIMIT ?`).all(guildId,q,q,q,max);
    users.forEach(x=>out.push({kind:'user',id:x.user_id,title:x.display_name||x.username||x.user_id,subtitle:`Zuletzt aktiv ${x.last_seen_at}` ,data:x}));
    const tickets=this.db.prepare(`SELECT id,subject,status,priority,updated_at FROM tickets WHERE guild_id=? AND (subject LIKE ? OR summary LIKE ?) ORDER BY updated_at DESC LIMIT ?`).all(guildId,q,q,max);
    tickets.forEach(x=>out.push({kind:'ticket',id:String(x.id),title:x.subject||`Ticket #${x.id}`,subtitle:`${x.status} · ${x.priority}`,data:x}));
    const incidents=this.db.prepare(`SELECT id,title,status,severity,updated_at FROM incidents WHERE guild_id=? AND (title LIKE ? OR summary LIKE ?) ORDER BY updated_at DESC LIMIT ?`).all(guildId,q,q,max);
    incidents.forEach(x=>out.push({kind:'incident',id:String(x.id),title:x.title,subtitle:`${x.status} · ${x.severity}`,data:x}));
    const knowledge=this.db.prepare(`SELECT id,title,tags,updated_at FROM knowledge_documents WHERE guild_id=? AND (title LIKE ? OR content LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC LIMIT ?`).all(guildId,q,q,q,max);
    knowledge.forEach(x=>out.push({kind:'knowledge',id:String(x.id),title:x.title,subtitle:x.tags||'Knowledge',data:x}));
    return out.slice(0,max);
  }
  recordActivity(guildId, eventType, userId=null, channelId=null, metadata={}) {
    this.db.prepare('INSERT INTO activity_events(guild_id,event_type,user_id,channel_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)').run(guildId,eventType,userId||null,channelId||null,JSON.stringify(metadata),this.now());
  }
  cleanupActivity(days=30) { this.db.prepare("DELETE FROM activity_events WHERE created_at < datetime('now', ?)").run(`-${Math.max(1,Number(days)||30)} days`); }
  activityTrend(guildId, windowMinutes=1440, bucketMinutes=60) {
    const minutes=Math.min(10080,Math.max(15,Number(windowMinutes)||1440));
    const bucket=Math.min(1440,Math.max(5,Number(bucketMinutes)||60));
    const sinceMs=Date.now()-minutes*60000;
    const since=new Date(sinceMs).toISOString();
    const rows=this.db.prepare(`SELECT event_type,COUNT(*) count,COUNT(DISTINCT user_id) users,created_at
      FROM activity_events WHERE guild_id=? AND created_at>=? GROUP BY event_type,CAST(strftime('%s',created_at)/(?) AS INTEGER) ORDER BY created_at`).all(guildId,since,bucket*60);
    const buckets=new Map();
    for(const r of rows){
      const ts=Math.floor(Date.parse(r.created_at)/(bucket*60000))*bucket*60000;
      const key=new Date(ts).toISOString();
      const b=buckets.get(key)||{timestamp:key,total:0,users:0,types:{}};
      b.total+=Number(r.count)||0; b.users=Math.max(b.users,Number(r.users)||0); b.types[r.event_type]={count:Number(r.count)||0,users:Number(r.users)||0};
      buckets.set(key,b);
    }
    return {windowMinutes:minutes,bucketMinutes:bucket,since,buckets:[...buckets.values()]};
  }
  activityLeaderboard(guildId, windowMinutes=1440, limit=10) {
    const minutes=Math.min(10080,Math.max(1,Number(windowMinutes)||1440));
    const since=new Date(Date.now()-minutes*60000).toISOString();
    return this.db.prepare(`SELECT user_id,COUNT(*) count,MAX(created_at) last_activity_at FROM activity_events
      WHERE guild_id=? AND created_at>=? AND user_id IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT ?`).all(guildId,since,Math.min(100,Math.max(1,Number(limit)||10)));
  }
  activitySummary(guildId, windowMinutes=60) {
    const since=new Date(Date.now()-Math.max(1,Number(windowMinutes)||60)*60000).toISOString();
    const rows=this.db.prepare('SELECT event_type,COUNT(*) count,COUNT(DISTINCT user_id) users FROM activity_events WHERE guild_id=? AND created_at>=? GROUP BY event_type').all(guildId,since);
    const byType=Object.fromEntries(rows.map(r=>[r.event_type,{count:Number(r.count),users:Number(r.users)}]));
    const recent=this.db.prepare('SELECT id,event_type,user_id,channel_id,metadata_json,created_at FROM activity_events WHERE guild_id=? AND created_at>=? ORDER BY id DESC LIMIT 100').all(guildId,since).map(r=>({...r,metadata:JSON.parse(r.metadata_json||'{}')}));
    return {windowMinutes:Number(windowMinutes),since,byType,recent};
  }
  saveSecurityState(guildId, snapshot={}) {
    const now=this.now();
    this.db.prepare(`INSERT INTO security_state(guild_id,score,level,snapshot_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id) DO UPDATE SET score=excluded.score,level=excluded.level,snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at`)
      .run(guildId,Math.min(100,Math.max(0,Number(snapshot.score)||0)),String(snapshot.level||'normal'),JSON.stringify(snapshot),now);
  }
  getSecurityState(guildId) {
    const row=this.db.prepare('SELECT score,level,snapshot_json,updated_at FROM security_state WHERE guild_id=?').get(guildId);
    if(!row) return null;
    try { return {...JSON.parse(row.snapshot_json||'{}'),score:Number(row.score),level:row.level,updatedAt:row.updated_at}; } catch { return {score:Number(row.score),level:row.level,signals:[],metrics:{},updatedAt:row.updated_at}; }
  }
  securitySnapshot(guildId) {
    const stored=this.getSecurityState(guildId);
    if(stored) return stored;
    const five=this.activitySummary(guildId,5).byType; const one=this.activitySummary(guildId,1).byType;
    const joins=five.member_join?.count||0, messages=one.message?.count||0;
    return {score:0,level:'normal',signals:[],metrics:{joins5m:joins,messages1m:messages},evaluatedAt:null};
  }
  addSecurityHistory(guildId, snapshot={}) {
    const now=this.now();
    const r=this.db.prepare('INSERT INTO security_history(guild_id,score,level,snapshot_json,created_at) VALUES(?,?,?,?,?)')
      .run(guildId, Math.min(100,Math.max(0,Number(snapshot.score)||0)), String(snapshot.level||'normal'), JSON.stringify(snapshot), now);
    return Number(r.lastInsertRowid);
  }
  securityHistory(guildId,{limit=100,sinceMinutes=10080}={}) {
    const limitN=Math.min(500,Math.max(1,Number(limit)||100));
    const since=new Date(Date.now()-Math.max(1,Number(sinceMinutes)||10080)*60000).toISOString();
    return this.db.prepare('SELECT id,score,level,snapshot_json,created_at FROM security_history WHERE guild_id=? AND created_at>=? ORDER BY id DESC LIMIT ?')
      .all(guildId,since,limitN).map(r=>{try{return {...r,snapshot:JSON.parse(r.snapshot_json||'{}')}}catch{return {...r,snapshot:{}}}});
  }
  cleanupSecurityHistory(days=30) {
    this.db.prepare("DELETE FROM security_history WHERE created_at < datetime('now', ?)").run(`-${Math.max(1,Number(days)||30)} days`);
  }
  createSecurityActionConfirmation(guildId,{requestedBy=null,action,args={},reason='',expiresAt}) {
    const now=this.now(); const r=this.db.prepare('INSERT INTO security_action_confirmations(guild_id,requested_by,action,args_json,reason,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(guildId,requestedBy||null,String(action),JSON.stringify(args),String(reason||''),'pending',expiresAt,now,now);
    return this.getSecurityActionConfirmation(guildId,Number(r.lastInsertRowid));
  }
  getSecurityActionConfirmation(guildId,id) {
    const r=this.db.prepare('SELECT * FROM security_action_confirmations WHERE guild_id=? AND id=?').get(guildId,Number(id));
    return r?{...r,args:JSON.parse(r.args_json||'{}')}:null;
  }
  listSecurityActionConfirmations(guildId,status=null) {
    const rows=status?this.db.prepare('SELECT * FROM security_action_confirmations WHERE guild_id=? AND status=? ORDER BY id DESC LIMIT 100').all(guildId,status):this.db.prepare('SELECT * FROM security_action_confirmations WHERE guild_id=? ORDER BY id DESC LIMIT 100').all(guildId);
    return rows.map(r=>({...r,args:JSON.parse(r.args_json||'{}')}));
  }
  updateSecurityActionConfirmation(guildId,id,{status,confirmedBy=null}) {
    const now=this.now(); this.db.prepare('UPDATE security_action_confirmations SET status=?,confirmed_by=?,updated_at=? WHERE guild_id=? AND id=?').run(status,confirmedBy||null,now,guildId,Number(id));
    return this.getSecurityActionConfirmation(guildId,id);
  }

  createTicket(guildId,data={}) { const now=this.now(); const r=this.db.prepare('INSERT INTO tickets(guild_id,user_id,status,support_mode,category,assigned_to,priority,subject,summary,channel_id,created_at,updated_at,first_response_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(guildId,data.userId,data.status||'open',data.supportMode||'ai',data.category||'general',data.assignedTo||null,data.priority||'normal',data.subject||null,data.summary||null,data.channelId||null,now,now,data.firstResponseAt||null,data.resolvedAt||null); return Number(r.lastInsertRowid); }
  listTickets(guildId,status=null) { const q=status?'SELECT * FROM tickets WHERE guild_id=? AND status=? ORDER BY updated_at DESC':'SELECT * FROM tickets WHERE guild_id=? ORDER BY updated_at DESC'; return this.db.prepare(q).all(...(status?[guildId,status]:[guildId])); }
  updateTicket(guildId,id,data={}) { const allowed=['status','support_mode','category','assigned_to','priority','subject','summary','channel_id','first_response_at','resolved_at']; const sets=[]; const vals=[]; for(const k of allowed) if(data[k]!==undefined){sets.push(`${k}=?`);vals.push(data[k]);} if(!sets.length)return; sets.push('updated_at=?');vals.push(this.now(),Number(id),guildId); this.db.prepare(`UPDATE tickets SET ${sets.join(',')} WHERE id=? AND guild_id=?`).run(...vals); }
  addTicketMessage(guildId,ticketId,userId,role,content) { const now=this.now(); const ticket=this.db.prepare('SELECT id FROM tickets WHERE guild_id=? AND id=?').get(guildId,Number(ticketId)); if(!ticket) throw new Error('Ticket nicht gefunden.'); this.db.prepare('INSERT INTO ticket_messages(ticket_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)').run(Number(ticketId),userId||null,role,String(content),now); if(['staff','assistant','agent'].includes(String(role).toLowerCase())) this.db.prepare('UPDATE tickets SET first_response_at=COALESCE(first_response_at,?),updated_at=? WHERE guild_id=? AND id=?').run(now,now,guildId,Number(ticketId)); }
  listTicketMessages(guildId,ticketId) { return this.db.prepare('SELECT m.user_id,m.role,m.content,m.created_at FROM ticket_messages m JOIN tickets t ON t.id=m.ticket_id WHERE t.guild_id=? AND t.id=? ORDER BY m.id').all(guildId,Number(ticketId)); }
  supportSLA(guildId) {
    const rows=this.db.prepare("SELECT priority,first_response_minutes,resolution_minutes,enabled,updated_at FROM support_sla WHERE guild_id=? ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END").all(guildId);
    if(rows.length) return rows.map(r=>({...r,enabled:Boolean(r.enabled)}));
    return [{priority:'urgent',first_response_minutes:15,resolution_minutes:240,enabled:true},{priority:'high',first_response_minutes:30,resolution_minutes:480,enabled:true},{priority:'normal',first_response_minutes:120,resolution_minutes:1440,enabled:true},{priority:'low',first_response_minutes:240,resolution_minutes:2880,enabled:true}];
  }
  saveSupportSLA(guildId,rows=[]) { const now=this.now(); const allowed=new Set(['urgent','high','normal','low']); for(const item of Array.isArray(rows)?rows:[]) { const priority=String(item.priority||'normal').toLowerCase(); if(!allowed.has(priority)) continue; const fr=Math.max(1,Math.min(10080,Number(item.firstResponseMinutes??item.first_response_minutes)||120)); const rr=Math.max(1,Math.min(43200,Number(item.resolutionMinutes??item.resolution_minutes)||1440)); this.db.prepare(`INSERT INTO support_sla(guild_id,priority,first_response_minutes,resolution_minutes,enabled,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,priority) DO UPDATE SET first_response_minutes=excluded.first_response_minutes,resolution_minutes=excluded.resolution_minutes,enabled=excluded.enabled,updated_at=excluded.updated_at`).run(guildId,priority,fr,rr,item.enabled===false?0:1,now); } return this.supportSLA(guildId); }
  supportMetrics(guildId, nowMs=Date.now()) {
    const tickets=this.listTickets(guildId); const sla=new Map(this.supportSLA(guildId).map(x=>[x.priority,x])); const now=Number(nowMs);
    let firstSamples=0,resolutionSamples=0,firstTotal=0,resolutionTotal=0,firstBreaches=0,resolutionBreaches=0; const byCategory={},byPriority={},byStaff={};
    for(const t of tickets){ const created=Date.parse(t.created_at); const first=t.first_response_at?Date.parse(t.first_response_at):null; const resolved=t.resolved_at?Date.parse(t.resolved_at):(['resolved','closed'].includes(t.status)?Date.parse(t.updated_at):null); const rule=sla.get(t.priority)||sla.get('normal'); const ageMin=Math.max(0,(now-created)/60000); if(first){const m=Math.max(0,(first-created)/60000);firstSamples++;firstTotal+=m;if(rule?.enabled&&m>rule.first_response_minutes)firstBreaches++;} else if(rule?.enabled&&ageMin>rule.first_response_minutes&&!['closed','resolved'].includes(t.status)) firstBreaches++; if(resolved){const m=Math.max(0,(resolved-created)/60000);resolutionSamples++;resolutionTotal+=m;if(rule?.enabled&&m>rule.resolution_minutes)resolutionBreaches++;} else if(rule?.enabled&&ageMin>rule.resolution_minutes&&!['closed','resolved'].includes(t.status)) resolutionBreaches++; byCategory[t.category]=(byCategory[t.category]||0)+1; byPriority[t.priority]=(byPriority[t.priority]||0)+1; if(t.assigned_to) byStaff[t.assigned_to]=(byStaff[t.assigned_to]||0)+1; }
    return {total:tickets.length,open:tickets.filter(t=>!['resolved','closed'].includes(t.status)).length,resolved:tickets.filter(t=>['resolved','closed'].includes(t.status)).length,firstResponseAvgMinutes:firstSamples?Number((firstTotal/firstSamples).toFixed(1)):null,resolutionAvgMinutes:resolutionSamples?Number((resolutionTotal/resolutionSamples).toFixed(1)):null,firstResponseBreaches:firstBreaches,resolutionBreaches,byCategory,byPriority,byStaff,sla:this.supportSLA(guildId)};
  }
  addKnowledgeFeedback(guildId,documentId,userId,helpful,query='',ticketId=null) {
    const document=this.db.prepare('SELECT id FROM knowledge_documents WHERE guild_id=? AND id=?').get(guildId,Number(documentId));
    if(!document) throw new Error('Knowledge-Dokument nicht gefunden.');
    if(ticketId!==null && ticketId!==undefined) {
      const ticket=this.db.prepare('SELECT id FROM tickets WHERE guild_id=? AND id=?').get(guildId,Number(ticketId));
      if(!ticket) throw new Error('Ticket nicht gefunden.');
    }
    const now=this.now();
    this.db.prepare('INSERT INTO knowledge_feedback(guild_id,document_id,user_id,ticket_id,helpful,query,created_at) VALUES(?,?,?,?,?,?,?)').run(guildId,Number(documentId),userId||null,ticketId?Number(ticketId):null,helpful?1:0,String(query||'').slice(0,500),now);
    return {guildId,documentId:Number(documentId),helpful:Boolean(helpful),createdAt:now};
  }
  knowledgeFeedbackStats(guildId,documentId=null) { const q=documentId?'SELECT COUNT(*) total,SUM(CASE WHEN helpful=1 THEN 1 ELSE 0 END) helpful,SUM(CASE WHEN helpful=0 THEN 1 ELSE 0 END) unhelpful FROM knowledge_feedback WHERE guild_id=? AND document_id=?':'SELECT COUNT(*) total,SUM(CASE WHEN helpful=1 THEN 1 ELSE 0 END) helpful,SUM(CASE WHEN helpful=0 THEN 1 ELSE 0 END) unhelpful FROM knowledge_feedback WHERE guild_id=?'; const row=documentId?this.db.prepare(q).get(guildId,Number(documentId)):this.db.prepare(q).get(guildId); return {total:Number(row?.total||0),helpful:Number(row?.helpful||0),unhelpful:Number(row?.unhelpful||0)}; }

  addAIConversation(guildId,userId,title='AI Chat') { const now=this.now(); const r=this.db.prepare('INSERT INTO ai_conversations(guild_id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(guildId,userId||null,title,now,now); return Number(r.lastInsertRowid); }
  addAIMessage(guildId,conversationId,role,content) { const now=this.now(); const conversation=this.db.prepare('SELECT id FROM ai_conversations WHERE guild_id=? AND id=?').get(guildId,Number(conversationId)); if(!conversation) throw new Error('AI-Konversation nicht gefunden.'); this.db.prepare('INSERT INTO ai_messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)').run(Number(conversationId),role,content,now); this.db.prepare('UPDATE ai_conversations SET updated_at=? WHERE guild_id=? AND id=?').run(now,guildId,Number(conversationId)); }
  listAIConversations(guildId) { return this.db.prepare('SELECT id,user_id,title,created_at,updated_at FROM ai_conversations WHERE guild_id=? ORDER BY updated_at DESC LIMIT 50').all(guildId); }
  getAIConversation(guildId,conversationId) { return this.db.prepare('SELECT id,user_id,title,created_at,updated_at FROM ai_conversations WHERE guild_id=? AND id=?').get(guildId,Number(conversationId)) || null; }
  listAIMessages(guildId,conversationId) { return this.db.prepare('SELECT m.role,m.content,m.created_at FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.guild_id=? AND c.id=? ORDER BY m.id').all(guildId,Number(conversationId)); }

  isAdministrator(guildId,userId) { const m=this.db.prepare('SELECT staff,roles_json FROM community_memberships WHERE guild_id=? AND user_id=?').get(guildId,userId); return Boolean(m?.staff || String(m?.roles_json||'').includes('Administrator')); }
  getCoreRole(guildId,userId) { return this.db.prepare('SELECT * FROM core_roles WHERE guild_id=? AND user_id=?').get(guildId,userId)||null; }
  setCoreRole(guildId,userId,role) { const now=this.now(); this.db.prepare(`INSERT INTO core_roles(guild_id,user_id,role,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`).run(guildId,userId,role,now); return {guildId,userId,role,updatedAt:now}; }
  listCoreRoles(guildId) { return this.db.prepare('SELECT * FROM core_roles WHERE guild_id=? ORDER BY updated_at DESC').all(guildId); }
  listRoleDefinitions(guildId) { return this.db.prepare('SELECT guild_id,role,label,description,permissions_json,built_in,updated_at FROM core_role_definitions WHERE guild_id=? ORDER BY built_in DESC, role COLLATE NOCASE').all(guildId).map(r=>({...r,permissions:JSON.parse(r.permissions_json||'[]'),builtIn:Boolean(r.built_in)})); }
  upsertRoleDefinition(guildId,{role,label,description='',permissions=[],builtIn=false}) { const now=this.now(); const normalized=String(role||'').trim().toLowerCase(); if(!/^[a-z][a-z0-9._-]{1,48}$/.test(normalized)) throw new Error('Ungültiger Rollenname.'); const clean=[...new Set((Array.isArray(permissions)?permissions:[]).map(String).filter(Boolean))].slice(0,200); this.db.prepare(`INSERT INTO core_role_definitions(guild_id,role,label,description,permissions_json,built_in,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(guild_id,role) DO UPDATE SET label=excluded.label,description=excluded.description,permissions_json=excluded.permissions_json,updated_at=excluded.updated_at`).run(guildId,normalized,String(label||normalized).slice(0,100),String(description||'').slice(0,500),JSON.stringify(clean),builtIn?1:0,now); return this.listRoleDefinitions(guildId).find(r=>r.role===normalized); }
  deleteRoleDefinition(guildId,role) { const normalized=String(role||'').trim().toLowerCase(); const row=this.db.prepare('SELECT built_in FROM core_role_definitions WHERE guild_id=? AND role=?').get(guildId,normalized); if(!row) return false; if(row.built_in) throw new Error('Integrierte Rollen können nicht gelöscht werden.'); this.db.prepare('DELETE FROM core_role_definitions WHERE guild_id=? AND role=?').run(guildId,normalized); this.db.prepare('DELETE FROM core_roles WHERE guild_id=? AND role=?').run(guildId,normalized); return true; }
  getAIProvider(guildId) { const r=this.db.prepare('SELECT provider,model,base_url,updated_at FROM ai_providers WHERE guild_id=?').get(guildId); if(!r)return null; return {...r,baseUrl:r.base_url,apiKey:this.getAISecret(guildId)}; }
  setAIProvider(guildId,{provider,model,baseUrl,apiKey}) { const now=this.now(); this.db.prepare(`INSERT INTO ai_providers(guild_id,provider,model,base_url,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,updated_at=excluded.updated_at`).run(guildId,provider,model||'',baseUrl||'',now); if(apiKey!==undefined)this.db.prepare(`INSERT INTO ai_secrets(guild_id,secret,updated_at) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET secret=excluded.secret,updated_at=excluded.updated_at`).run(guildId,apiKey||null,now); }
  listAIProviderSlots(guildId) {
    return this.db.prepare('SELECT guild_id,slot_id,label,provider,model,base_url,priority,enabled,updated_at FROM ai_provider_slots WHERE guild_id=? ORDER BY priority ASC, slot_id ASC').all(guildId).map(r=>({...r,enabled:Boolean(r.enabled)}));
  }
  getAIProviderSlot(guildId, slotId) {
    const r=this.db.prepare('SELECT * FROM ai_provider_slots WHERE guild_id=? AND slot_id=?').get(guildId,String(slotId));
    return r?{...r,enabled:Boolean(r.enabled)}:null;
  }
  getAIProviderSlotSecret(guildId, slotId) { return this.db.prepare('SELECT secret FROM ai_provider_slots WHERE guild_id=? AND slot_id=?').get(guildId,String(slotId))?.secret || ''; }
  saveAIProviderSlot(guildId, data={}) {
    const now=this.now(); const slotId=String(data.slotId||data.id||'').trim();
    if(!/^[a-z0-9._-]{1,64}$/i.test(slotId)) throw new Error('Ungültige Provider-Slot-ID.');
    const existing=this.getAIProviderSlot(guildId,slotId); const secret=data.secret===undefined?(existing?.secret??null):String(data.secret||'');
    this.db.prepare(`INSERT INTO ai_provider_slots(guild_id,slot_id,label,provider,model,base_url,secret,priority,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(guild_id,slot_id) DO UPDATE SET label=excluded.label,provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,secret=excluded.secret,priority=excluded.priority,enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run(guildId,slotId,String(data.label||slotId),String(data.provider||'none').toLowerCase(),String(data.model||''),String(data.baseUrl||''),secret,Number.isFinite(Number(data.priority))?Number(data.priority):100,data.enabled===false?0:1,now);
    return this.getAIProviderSlot(guildId,slotId);
  }
  deleteAIProviderSlot(guildId,slotId) { this.db.prepare('DELETE FROM ai_provider_slots WHERE guild_id=? AND slot_id=?').run(guildId,String(slotId)); }
  createAIAgentSession(guildId,userId,title='AI Agent Session',context={}) { const now=this.now(); const r=this.db.prepare('INSERT INTO ai_agent_sessions(guild_id,user_id,title,status,context_json,message_count,tool_count,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(guildId,userId||null,String(title||'AI Agent Session').slice(0,200),'active',JSON.stringify(context||{}),0,0,now,now); return this.getAIAgentSession(guildId,Number(r.lastInsertRowid)); }
  getAIAgentSession(guildId,id) { const r=this.db.prepare('SELECT * FROM ai_agent_sessions WHERE guild_id=? AND id=?').get(guildId,Number(id)); return r ? {...r,context:JSON.parse(r.context_json||'{}')} : null; }
  listAIAgentSessions(guildId,{status=null,limit=50}={}) { const n=Math.min(200,Math.max(1,Number(limit)||50)); const rows=status?this.db.prepare('SELECT * FROM ai_agent_sessions WHERE guild_id=? AND status=? ORDER BY updated_at DESC LIMIT ?').all(guildId,status,n):this.db.prepare('SELECT * FROM ai_agent_sessions WHERE guild_id=? ORDER BY updated_at DESC LIMIT ?').all(guildId,n); return rows.map(r=>({...r,context:JSON.parse(r.context_json||'{}')})); }
  updateAIAgentSession(guildId,id,{status,title,context,messageDelta=0,toolDelta=0}={}) { const current=this.getAIAgentSession(guildId,id); if(!current) throw new Error('AI-Agent-Session nicht gefunden.'); const now=this.now(); this.db.prepare('UPDATE ai_agent_sessions SET status=?,title=?,context_json=?,message_count=message_count+?,tool_count=tool_count+?,updated_at=? WHERE guild_id=? AND id=?').run(status||current.status,title===undefined?current.title:String(title).slice(0,200),JSON.stringify(context===undefined?current.context:context||{}),Number(messageDelta)||0,Number(toolDelta)||0,now,guildId,Number(id)); return this.getAIAgentSession(guildId,id); }
  addAIAgentRun(guildId,{sessionId=null,userId=null,kind,status='started',tool=null,confirmationId=null,request={},result={},error=null,completedAt=null}={}) {
    if(sessionId!==null && sessionId!==undefined) {
      const session=this.db.prepare('SELECT id FROM ai_agent_sessions WHERE guild_id=? AND id=?').get(guildId,Number(sessionId));
      if(!session) throw new Error('AI-Agent-Session nicht gefunden.');
    }
    const now=this.now();
    const r=this.db.prepare('INSERT INTO ai_agent_runs(guild_id,session_id,user_id,kind,status,tool,confirmation_id,request_json,result_json,error,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(guildId,sessionId||null,userId||null,String(kind||'unknown'),String(status||'started'),tool||null,confirmationId||null,JSON.stringify(request||{}),JSON.stringify(result||{}),error?String(error).slice(0,4000):null,now,completedAt||null);
    return this.getAIAgentRun(guildId,Number(r.lastInsertRowid));
  }
  getAIAgentRun(guildId,id) { const r=this.db.prepare('SELECT * FROM ai_agent_runs WHERE guild_id=? AND id=?').get(guildId,Number(id)); return r?{...r,request:JSON.parse(r.request_json||'{}'),result:JSON.parse(r.result_json||'{}')}:null; }
  listAIAgentRuns(guildId,{sessionId=null,limit=100}={}) { const n=Math.min(500,Math.max(1,Number(limit)||100)); const rows=sessionId?this.db.prepare('SELECT * FROM ai_agent_runs WHERE guild_id=? AND session_id=? ORDER BY id DESC LIMIT ?').all(guildId,Number(sessionId),n):this.db.prepare('SELECT * FROM ai_agent_runs WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(guildId,n); return rows.map(r=>({...r,request:JSON.parse(r.request_json||'{}'),result:JSON.parse(r.result_json||'{}')})); }
  agentMetrics(guildId) { const sessions=this.db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active FROM ai_agent_sessions WHERE guild_id=?`).get(guildId); const runs=this.db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN kind='tool-request' THEN 1 ELSE 0 END) tool_requests FROM ai_agent_runs WHERE guild_id=?`).get(guildId); const pending=this.db.prepare("SELECT COUNT(*) count FROM tool_confirmations WHERE guild_id=? AND status='pending' AND expires_at>datetime('now')").get(guildId); return {sessions:Number(sessions?.total||0),activeSessions:Number(sessions?.active||0),runs:Number(runs?.total||0),successfulRuns:Number(runs?.success||0),failedRuns:Number(runs?.failed||0),toolRequests:Number(runs?.tool_requests||0),pendingConfirmations:Number(pending?.count||0)}; }
  searchKnowledgeRanked(guildId,query,limit=8) {
    const raw=String(query||'').trim().toLowerCase(); if(!raw) return this.listKnowledge(guildId).slice(0,limit);
    const terms=[...new Set(raw.split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>=2))];
    const now=Date.now();
    return this.listKnowledge(guildId).map(d=>{
      const title=String(d.title||'').toLowerCase(), content=String(d.content||'').toLowerCase(), tags=String(d.tags||'').toLowerCase();
      let score=0; if(title.includes(raw)) score+=12; if(content.includes(raw)) score+=6; if(tags.includes(raw)) score+=8;
      for(const term of terms){ if(title.includes(term)) score+=4; if(tags.includes(term)) score+=3; if(content.includes(term)) score+=1; }
      const age=Math.max(0,now-Date.parse(d.updated_at||d.created_at||now)); score += Math.max(0,2-Math.min(2,age/31557600000));
      return {...d,score:Number(score.toFixed(3))};
    }).filter(d=>d.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.min(50,Math.max(1,Number(limit)||8)));
  }
  getAISecret(guildId) { return this.db.prepare('SELECT secret FROM ai_secrets WHERE guild_id=?').get(guildId)?.secret||null; }
  createIncident(guildId,{title='Security Incident',status='open',severity='medium',type='security',summary='',payload={},assignedTo=null}={}) { const now=this.now(); const r=this.db.prepare('INSERT INTO incidents(guild_id,title,status,severity,type,summary,payload_json,assigned_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(guildId,title,status,severity,type,summary,JSON.stringify(payload),assignedTo||null,now,now); return this.getIncident(guildId,Number(r.lastInsertRowid)); }
  getIncident(guildId,id) { const r=this.db.prepare('SELECT * FROM incidents WHERE id=? AND guild_id=?').get(Number(id),guildId); return r?{...r,payload:JSON.parse(r.payload_json||'{}')}:null; }
  listIncidents(guildId) { return this.db.prepare('SELECT * FROM incidents WHERE guild_id=? ORDER BY updated_at DESC').all(guildId).map(r=>({...r,payload:JSON.parse(r.payload_json||'{}')})); }
  updateIncident(guildId,id,data={}) { const allowed=['title','status','severity','type','summary','payload_json','assigned_to','resolved_at','resolved_by']; const sets=[];const vals=[];for(const k of allowed)if(data[k]!==undefined){sets.push(`${k}=?`);vals.push(k==='payload_json'?JSON.stringify(data[k]):data[k]);}if(!sets.length)return this.getIncident(guildId,id);sets.push('updated_at=?');vals.push(this.now(),Number(id),guildId);this.db.prepare(`UPDATE incidents SET ${sets.join(',')} WHERE id=? AND guild_id=?`).run(...vals);return this.getIncident(guildId,id); }
  addIncidentTimeline(guildId,incidentId,{kind='note',actorId=null,message='',payload={}}={}) {
    if(!this.getIncident(guildId,incidentId)) throw new Error('Incident nicht gefunden.');
    const now=this.now();
    const r=this.db.prepare('INSERT INTO incident_timeline(incident_id,guild_id,kind,actor_id,message,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(Number(incidentId),guildId,String(kind),actorId||null,String(message),JSON.stringify(payload),now);
    return this.getIncidentTimeline(guildId,incidentId).find(x=>x.id===Number(r.lastInsertRowid));
  }
  getIncidentTimeline(guildId,incidentId) { return this.db.prepare('SELECT id,incident_id,guild_id,kind,actor_id,message,payload_json,created_at FROM incident_timeline WHERE guild_id=? AND incident_id=? ORDER BY id').all(guildId,Number(incidentId)).map(r=>({...r,payload:JSON.parse(r.payload_json||'{}')})); }
  searchKnowledge(guildId,query,limit=8) { const q=String(query||'').toLowerCase(); return this.listKnowledge(guildId).filter(d=>`${d.title} ${d.content} ${d.tags}`.toLowerCase().includes(q)).slice(0,limit); }
  linkTicketIncident(guildId,ticketId,incidentId,linkedBy=null) {
    const ticket=this.db.prepare('SELECT id FROM tickets WHERE guild_id=? AND id=?').get(guildId,Number(ticketId));
    if(!ticket) throw new Error('Ticket nicht gefunden.');
    const incident=this.db.prepare('SELECT id FROM incidents WHERE guild_id=? AND id=?').get(guildId,Number(incidentId));
    if(!incident) throw new Error('Incident nicht gefunden.');
    const now=this.now();
    this.db.prepare(`INSERT OR IGNORE INTO ticket_incident_links(guild_id,ticket_id,incident_id,linked_by,created_at) VALUES(?,?,?,?,?)`).run(guildId,Number(ticketId),Number(incidentId),linkedBy||null,now);
    return this.db.prepare('SELECT guild_id,ticket_id,incident_id,linked_by,created_at FROM ticket_incident_links WHERE guild_id=? AND ticket_id=? AND incident_id=?').get(guildId,Number(ticketId),Number(incidentId));
  }
  listTicketIncidents(guildId,ticketId) { return this.db.prepare(`SELECT l.guild_id,l.ticket_id,l.incident_id,l.linked_by,l.created_at,i.title,i.status,i.severity,i.type,i.summary FROM ticket_incident_links l JOIN incidents i ON i.id=l.incident_id AND i.guild_id=l.guild_id WHERE l.guild_id=? AND l.ticket_id=? ORDER BY l.created_at DESC`).all(guildId,Number(ticketId)); }
  addTicketAIAnalysis(guildId,ticketId,userId,{provider='',model='',content='',recommendation={}}={}) {
    const ticket=this.db.prepare('SELECT id FROM tickets WHERE guild_id=? AND id=?').get(guildId,Number(ticketId));
    if(!ticket) throw new Error('Ticket nicht gefunden.');
    const r=this.db.prepare(`INSERT INTO ticket_ai_analyses(guild_id,ticket_id,user_id,provider,model,content,recommendation_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(guildId,Number(ticketId),userId||null,String(provider||''),String(model||''),String(content||'').slice(0,20000),JSON.stringify(recommendation||{}),this.now());
    return this.db.prepare('SELECT * FROM ticket_ai_analyses WHERE id=?').get(Number(r.lastInsertRowid));
  }
  listTicketAIAnalyses(guildId,ticketId) { return this.db.prepare('SELECT id,guild_id,ticket_id,user_id,provider,model,content,recommendation_json,created_at FROM ticket_ai_analyses WHERE guild_id=? AND ticket_id=? ORDER BY created_at DESC LIMIT 50').all(guildId,Number(ticketId)).map(r=>({...r,recommendation:JSON.parse(r.recommendation_json||'{}')})); }
  createToolConfirmation(guildId,{userId,tool,args={},reason='',expiresAt}) { const now=this.now(); const r=this.db.prepare('INSERT INTO tool_confirmations(guild_id,user_id,tool,args_json,reason,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(guildId,userId||null,tool,JSON.stringify(args),String(reason||''), 'pending', expiresAt, now, now); return this.getToolConfirmation(guildId,Number(r.lastInsertRowid)); }
  getToolConfirmation(guildId,id) { const r=this.db.prepare('SELECT * FROM tool_confirmations WHERE guild_id=? AND id=?').get(guildId,Number(id)); return r ? {...r,args:JSON.parse(r.args_json||'{}')} : null; }
  listToolConfirmations(guildId,status=null) { const rows=status?this.db.prepare('SELECT * FROM tool_confirmations WHERE guild_id=? AND status=? ORDER BY id DESC LIMIT 100').all(guildId,status):this.db.prepare('SELECT * FROM tool_confirmations WHERE guild_id=? ORDER BY id DESC LIMIT 100').all(guildId); return rows.map(r=>({...r,args:JSON.parse(r.args_json||'{}')})); }
  updateToolConfirmation(guildId,id,{status,confirmedBy=null}) { const now=this.now(); this.db.prepare('UPDATE tool_confirmations SET status=?,confirmed_by=?,updated_at=? WHERE guild_id=? AND id=?').run(status,confirmedBy,now,guildId,Number(id)); return this.getToolConfirmation(guildId,id); }
  close() { if (this._db?.isOpen) this._db.close(); }
}
