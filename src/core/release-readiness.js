/**
 * Release Readiness checks for the stable Community Core control plane.
 *
 * This module is deliberately dependency-free and read-only. It validates the
 * invariants that matter for an RC without changing the public Core API v1.
 */
export const RELEASE_READINESS_VERSION = '1.0';

const REQUIRED_TABLES = [
  'meta', 'communities', 'community_settings', 'modules', 'audit_events',
  'activity_events', 'core_users', 'community_memberships', 'release_announcements', 'issue_announcements', 'tickets',
  'incidents', 'automation_jobs', 'automation_runs', 'tool_confirmations',
  'ai_agent_sessions', 'ai_agent_runs',
];

export function runReleaseReadiness({ database, events, api, moduleManager } = {}) {
  const checks = [];
  const check = (id, name, ok, detail = '') => checks.push({ id, name, ok: Boolean(ok), detail: detail || null });

  check('api-version', 'Stable API v1', api?.version === '1.0', `version=${api?.version || 'missing'}`);
  check('event-bus', 'Event Bus', Boolean(events?.publish && events?.subscribe && events?.history), 'publish/subscribe/history verfügbar');
  check('database', 'SQLite', Boolean(database?.db?.isOpen), 'Datenbank geöffnet');

  if (database?.db?.isOpen) {
    const tables = new Set(database.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const missing = REQUIRED_TABLES.filter(name => !tables.has(name));
    check('schema', 'Core-Datenbankschema', missing.length === 0, missing.length ? `Fehlt: ${missing.join(', ')}` : `${REQUIRED_TABLES.length} Kern-Tabellen vorhanden`);
    const journal = database.db.prepare('PRAGMA journal_mode').get()?.journal_mode;
    check('wal', 'SQLite WAL', String(journal || '').toLowerCase() === 'wal', `journal_mode=${journal || 'unknown'}`);
    const fk = database.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
    check('foreign-keys', 'Foreign Keys', Number(fk) === 1, `foreign_keys=${fk}`);
  } else {
    check('schema', 'Core-Datenbankschema', false, 'Datenbank nicht geöffnet');
    check('wal', 'SQLite WAL', false, 'Datenbank nicht geöffnet');
    check('foreign-keys', 'Foreign Keys', false, 'Datenbank nicht geöffnet');
  }

  const modules = moduleManager?.list?.() || [];
  check('modules', 'Module Registry', Array.isArray(modules), `${modules.length} Modul(e)`);

  const result = {
    version: RELEASE_READINESS_VERSION,
    ok: checks.every(item => item.ok),
    timestamp: new Date().toISOString(),
    checks,
  };
  return Object.freeze(result);
}
