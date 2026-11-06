# Community Core 6.0.0 — Stable

Community Core 6.0.0 is the first Stable release of the current multi-community architecture.

## Highlights

- **Stable Core API v1** — modules and integrations have a durable versioned boundary.
- **Multi-community isolation** — community-owned relational data is validated at the database layer.
- **Security operations** — RBAC, security response, confirmations, audit and incident workflows are integrated.
- **Support operations** — tickets, SLA/workflow state, knowledge and escalation paths are persisted.
- **AI operations** — provider-independent AI, durable agent sessions/runs and confirmation-gated Discord tools.
- **Live Control Center** — authenticated dashboard with SSE live events and persistent changes.
- **Automation** — durable jobs, runs, retries, cooldowns and bounded concurrency.
- **Release safety** — release announcements are idempotent and isolated per community.

## Security hardening

6.0.0 specifically closes the final release-candidate class of issues around privilege escalation and cross-community relational writes. Administrators cannot promote themselves to `owner` or create wildcard (`*`) roles; dangerous Discord permissions cannot be used for quarantine roles; and cross-community ticket/incident/knowledge/AI relationships are rejected.

## Upgrade

Community Core uses the existing SQLite migration layer. Stop the running bot, back up the database, replace the application files with 6.0.0, install dependencies, and start the bot again. Do not delete the SQLite database during an upgrade.

See `MIGRATION.md` for the complete upgrade checklist.

## Release status

**Stable / production release**

No new breaking Core API v1 changes are introduced by 6.0.0.
