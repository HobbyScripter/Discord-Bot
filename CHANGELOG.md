# Changelog

All notable changes to Community Core are documented here.

## [6.0.0] — Stable

### Added
- Stable release of the multi-community Discord Community Core.
- Stable Core API v1 boundary for modules and control-plane integrations.
- Persistent, community-scoped Event Bus history and live dashboard SSE flow.
- Durable identity, activity, audit, security, support, ticket, incident, automation and AI-agent operations.
- Release announcement state that is persisted per community and per release channel/version.

### Security
- Enforced cross-community ownership checks for relational writes involving tickets, incidents, knowledge feedback and AI-agent sessions.
- Hardened RBAC against privilege escalation through unauthorized `owner` grants and wildcard (`*`) permission roles.
- Restricted security quarantine roles from dangerous Discord permissions.
- Destructive Discord tools remain protected by RBAC and explicit confirmation.
- Dashboard control-plane routes use authenticated operator access and explicit action allowlists.

### Reliability
- SQLite uses WAL and foreign-key enforcement.
- Event consumers are isolated so one failing subscriber cannot break event publication.
- Durable automation and AI-agent run state survives process restarts.
- Release reservations recover from stale/pending state without duplicate announcements.
- Backup/restore, readiness and production-hardening checks are covered by the release test suite.

### Compatibility
- Node.js 22.5+.
- Discord.js 14.27.0.
- Core API v1 remains unchanged for the 6.0.0 release.
- Existing community data is migrated forward by the built-in SQLite migration layer.

## [5.9.0-rc.5]

Final release candidate before 6.0.0 Stable. This release focused on cross-community isolation, permission escalation prevention and release hardening.

[6.0.0]: https://github.com/YourEliteSystems/WebRadio-community-core/releases/tag/v6.0.0
[5.9.0-rc.5]: https://github.com/YourEliteSystems/WebRadio-community-core/releases/tag/v5.9.0-rc.5
