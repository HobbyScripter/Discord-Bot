# Community Core 6.0.0 — Stable

Reusable, multi-community Discord platform with a stable Core API v1, live dashboard, identity, RBAC, security operations, support workflows, automation and resilient AI tooling.

> **Stable:** 6.0.0 is the production release. The Core API v1 boundary is kept stable for this major release.

## Release documentation

- `CHANGELOG.md` — version history
- `RELEASE_NOTES.md` — 6.0.0 release summary
- `MIGRATION.md` — upgrade and rollback checklist

## 5.6.0 — AI Agent Command Center

AI Agent sessions, durable run history, live tool activity and a central confirmation workflow are now persisted in SQLite and exposed through stable dashboard APIs. Destructive Discord tools remain protected by Core RBAC and explicit operator confirmation. The existing Event Bus/SSE boundary remains unchanged.

- AI Agent sessions and session detail
- durable AI Agent run history
- Agent metrics and live run events
- central confirmation view for pending Discord tool actions
- session-aware Agent context, chat and tool requests
- community-scoped storage and APIs

## 5.5.0 — Community Operations Center

Unified Operations Center with live security/support/AI/staff/automation metrics, audit + activity timeline, staff workload and community-scoped central search. The stable Event Bus/SSE boundary remains unchanged.

# Community Core 5.1.0

Community Core is a reusable, multi-community Discord platform with a stable event interface, live dashboard, identity, security, tickets, AI and operations tooling.

## 5.1.0 — Automation Engine

- Event-driven Automation Runtime with durable execution history
- Trigger matching by event type/source/community/level and payload conditions
- Conditions: equals, contains, starts_with, ends_with, numeric comparisons, exists, truthy
- Cooldowns and delayed execution with bounded scheduling
- Retry handling with exponential backoff for action handlers
- Concurrency protection so one automation burst cannot overload the Core
- Persistent `automation_runs` history and aggregate statistics
- Live `automation.executed`, `automation.failed`, `automation.skipped`, `automation.changed` and `automation.deleted` events
- Dashboard APIs: `/api/automations/status`, `/api/automations/stats`, `/api/automations/runs`
- Existing automation storage and stable Event Bus contract remain backward compatible

## 4.9.0 — Core RBAC

- stable built-in Core roles with granular permission catalog
- persistent per-community role definitions
- custom roles with auditable permission changes
- RBAC enforcement for role assignment and role administration
- protected built-in roles
- live `rbac.role.changed` / `rbac.role.definition.changed` / `rbac.role.definition.deleted` events
- dashboard RBAC management with actor identity requirement
- backward-compatible role/permission APIs

## Core principles

- Core remains generic; community-specific behavior belongs in modules.
- Dashboard changes persist immediately and emit versioned live events.
- Destructive Discord actions require explicit permissions and confirmation where applicable.
- One module failure must not break the Core event bus.

## 4.3 Operations Layer

Community Core 4.3 adds the next integrated operations layer while preserving the stable Core Event API:

- incident lifecycle: open → investigating → contained/resolved → closed
- incident ownership and staff assignment
- persistent incident timeline with audit entries
- AI incident analysis as a recommendation-only operation
- live incident updates through the existing Event Bus/SSE dashboard channel
- dashboard Incident Operations Center with details, timeline, assignment, AI analysis and resolution controls
- forward-compatible SQLite migration for older incident tables
- all destructive Discord actions remain confirmation-gated and RBAC-controlled

The dashboard and Core continue to communicate through the versioned internal event interface; individual UI failures cannot stop Core event processing.


## 3.2.0 – AI Activation, Activity & Security Foundation

- Global AI master switch per community: a configured provider is **not active automatically**.
- User activity tracking independent of AI (messages, joins/leaves, reactions and voice changes).
- Hybrid security foundation with activity-based raid-risk scoring.
- Security and activity views in the dashboard.
- Persistent ticket data model and dashboard API foundation for AI → Staff → Dev escalation.
- AI can only be enabled when an AI provider/model is configured.

The security layer deliberately starts with deterministic activity signals. AI analysis can be layered on top later without making the LLM the sole authority.

# Community Core — WebRadio Community Bot

Modular, multi-community Discord platform with local SQLite storage, web Control Center and AI-ready architecture.

## Architecture
- **Core** — Discord client, database, permissions, scheduler, dashboard and module registry
- **SQLite** — `./data/community-core.sqlite`
- **Profiles** — `webradio`, `gaming`, `developer`, `custom`
- **Modules** — per-community enable/disable configuration
- **External modules** — `.js` modules in `modules/`
- **AI adapter** — provider-independent interface in `src/ai/`
- **Dashboard** — community switcher and profile/module administration

## Requirements
Node.js **22.5+** because the project uses the built-in `node:sqlite` API.

## Setup
```powershell
npm install
copy .env.example .env
npm run bot
```
Dashboard: `http://127.0.0.1:5177`

`DISCORD_TOKEN` is required. `DISCORD_GUILD_ID` is optional: if empty, every guild the bot is installed in is registered as an isolated community.

## Identity
The default project identity is **WebRadio Community**, but the bot identity is configurable:
```env
BOT_NAME=WebRadio Community
DEFAULT_COMMUNITY_PROFILE=webradio
SYNC_BOT_USERNAME=false
```
The profile and Discord bot identity remain separate. `SYNC_BOT_USERNAME=true` optionally requests a Discord username update at startup.

## Profiles
- WebRadio — official WebRadio setup/release profile
- Gaming — generic gaming defaults
- Developer — developer-community defaults
- Custom — neutral profile

## External modules
Create `modules/my-module.js`:
```js
export default {
  id: 'my-module', name: 'My Module', version: '1.0.0',
  description: 'My community feature',
  async setup(context) {},
  async destroy(context) {}
};
```
The Core discovers `.js` files in `modules/` on startup.

## Database
SQLite replaces MySQL and requires no database server. Community data, settings, module state, AI conversation storage and audit events are isolated by guild ID. The Discord token is never stored in SQLite.

## AI
The project includes a provider-neutral AI adapter. Providers can be implemented under `src/ai/providers/` without changing the Community Core. Destructive Discord actions should always go through explicit confirmation gates.

## Security
The dashboard binds to `127.0.0.1` by default and does not require a password. Set `DASHBOARD_PASSWORD` only if you want dashboard login protection.

For access from other devices on your private LAN, set `DASHBOARD_HOST=0.0.0.0` and allow TCP port `5177` only from your trusted local subnet in the host firewall. Do not create a router port-forward. Binding to `0.0.0.0` without a password makes the full dashboard control plane available to devices that can reach that port, so the firewall restriction is essential. You can instead set `DASHBOARD_HOST` to a specific LAN IP address.

## Control Center 3.1

- Community-Switcher für mehrere Discord-Server
- Dashboard Health Monitor und automatische Port-Fallbacks
- `Ctrl+K` Command Palette
- zentraler AI Assistant
- SQLite-basierte AI Conversations, Community Memory und Knowledge Base
- Automation-Speicher für zukünftige Trigger/Actions
- Backup-Dateien können heruntergeladen und verwaltet werden
- verständliche Token-Fehlermeldungen beim Start

### Sicherheit

Das Dashboard bindet standardmäßig ausschließlich an `127.0.0.1`. Für einen Zugriff aus anderen Netzen muss zusätzlich ein Authentifizierungs-/Reverse-Proxy-Konzept eingesetzt werden. Destruktive Discord-Aktionen bleiben bestätigungspflichtig. Secrets werden nicht in der SQLite-Datenbank gespeichert.


## AI Provider Architektur

Community Core 3.3 unterstützt bewusst mehrere AI-Betriebsarten:

- **Ollama lokal** auf dem Bot-System
- **Ollama remote** auf einem NAS oder AI-Server im LAN
- **OpenAI-kompatible APIs** für lokale, selbst gehostete oder externe Inference-Server
- **Cloud Provider** über kompatible APIs

Die KI ist **nicht automatisch aktiv**, nur weil ein Provider konfiguriert wurde. Pro Community muss sie im Dashboard ausdrücklich aktiviert werden.

Beispiel für ein eigenes NAS:

```env
AI_PROVIDER=ollama
AI_BASE_URL=http://192.168.178.50:11434
AI_MODEL=qwen3:8b
```

Im AI Assistant kann anschließend die Verbindung getestet werden. Der Provider-Test zeigt Erreichbarkeit, Modell und – soweit die API es meldet – verfügbare Modelle.

Die Community-Aktivität und die hybride Security-Grundlage funktionieren unabhängig von der KI. Dadurch bleibt Monitoring aktiv, wenn die KI deaktiviert ist.

## 3.3.2 – Dashboard/SQLite lifecycle fix

- SQLite is now lifecycle-safe: if the dashboard survives a Discord reconnect/restart after the database handle was closed, the database is reopened automatically.
- `CommunityDatabase.close()` is idempotent.
- This prevents `ERR_INVALID_STATE: database is not open` from the dashboard community switcher/list endpoint.


## 3.4.0

### Multi-Community & Regeln
- Mehrere Discord-Communities können über das Dashboard registriert und gewechselt werden.
- Eine Community kann über ihre Guild-ID hinzugefügt werden, sofern der Bot bereits Mitglied ist.
- Zentrale Community-Regeln pro Guild mit Speicherung in SQLite.
- Regeln können im Dashboard eingesehen und bearbeitet werden.
- Optional können Regeln direkt in den Discord-Regelkanal als Community-Core-Nachricht veröffentlicht bzw. aktualisiert werden.
- Die Community-Auswahl bleibt von der einzelnen Bot-Verbindung getrennt.

## Stable Core Interface & Live Events

Seit 3.5 ist die interne Live-Schnittstelle als versionierter `CoreEventBus` zentralisiert. Module, Discord-Handler und Dashboard kommunizieren für Echtzeit-Zustände über Events statt über direkte Dashboard-Abhängigkeiten.

### Event contract

Jedes Event besitzt mindestens:

- `version` – Event-Schema-Version
- `sequence` – monotone Core-Sequenz
- `type` – stabiler Eventname, z. B. `activity.message`
- `source` – Ursprung (`core`, `discord`, `dashboard`, Modulname, …)
- `communityId` – betroffene Community oder `null`
- `timestamp` – ISO-8601 UTC
- `payload` – JSON-sicherer Inhalt

Subscriber werden isoliert. Ein fehlerhafter Consumer darf weder den Publisher noch andere Consumer unterbrechen. Payloads werden vor Veröffentlichung serialisiert, zirkuläre Daten und `BigInt` abgefangen und übergroße Payloads begrenzt.

Das Dashboard verwendet SSE für Server→Browser-Live-Events. Die Schnittstelle bleibt vom Dashboard-Design unabhängig und kann später von weiteren Clients genutzt werden.

### Dashboard live

- Bot-/Connection-Status
- Benutzeraktivität
- Community-Wechsel
- gespeicherte Einstellungen
- Dashboard-Aktionen
- Live-Console
- Event-History für Reconnects
- Heartbeats und automatische SSE-Reconnects

Das Dashboard pollt nicht mehr ausschließlich den Live-Zustand. Ein periodischer Refresh bleibt nur als Fallback für vollständige Snapshots bestehen.

## 3.6 Core identity & audit foundation

Community Core 3.6 introduces the stable foundation for central user management and unified auditing:

- central user identities and per-community memberships
- staff availability (`available`, `busy`, `dnd`, `offline`)
- activity-driven last-seen data
- durable Core audit records
- durable Discord audit imports with source/event de-duplication
- bounded initial Discord audit synchronization
- live audit events through the Core Event Bus
- dashboard APIs for users, staff status and unified audit data

Discord audit history remains subject to the permissions and history exposed by Discord. The Core therefore never claims to have access to unavailable historical data.


## Security Core

Community Core 3.7 introduces a deterministic security engine that remains independent of AI. It observes activity and audit events, calculates a bounded 0–100 risk score and emits `NORMAL`, `WATCH`, `ELEVATED`, `HIGH` or `CRITICAL` states.

The security layer is deliberately non-destructive: it recommends observation, enhanced verification review or lockdown review, but does not automatically ban members, delete content or change permissions. Future AI analysis can interpret the same security context without becoming a single point of failure.

Security changes are persisted and published through the stable Core Event Bus as `security.risk.changed`.

## 4.2.0 – Security Signals & Ticket Center

3.8 adds the next layer on top of the stable Core Event Bus:

- Discord role-change and ban signals feed the deterministic Security Engine.
- Security risk snapshots expose additional role-change and ban metrics.
- TicketManager provides validated ticket workflow, queue metrics and least-loaded staff assignment.
- Staff availability remains explicit (`available`, `busy`, `dnd`, `offline`).
- Ticket and staff changes are emitted through the stable live event interface.
- Dashboard Ticket Center updates without a page reload.

Destructive moderation actions are still deliberately outside this layer and require an explicit action/confirmation path.

## 4.0.0 – Platform Core

4.0 keeps the stable Core Event Bus and extends the Community Core into a reusable operations platform.

### Stable internal interface
- Versioned Core Events with sequence numbers and isolated subscribers.
- Dashboard clients receive events through SSE with reconnect/history support.
- Core failures are isolated from dashboard subscribers.
- Mutations are designed as explicit command/save operations followed by audit + live events.

### Central RBAC
Core roles are independent from Discord roles:
`owner`, `admin`, `security`, `moderator`, `support`, `developer`, `viewer`.
Permissions are evaluated by the Core before AI and operational features are used.

### Incident Center
- Persistent incidents with status, severity, type, summary and payload.
- Incident changes are audited and published live.

### Automation Engine
- Stored automation jobs can react to Core Event types.
- Matching supports event type/source and selected payload level.
- Safe built-in actions are audit/notification oriented; destructive Discord actions are not executed implicitly.

### AI Provider Layer
Supported provider profiles:
- OpenAI
- Anthropic / Claude
- Mistral
- Ollama
- OpenAI-Compatible
- Custom

Provider configuration is community-specific. API keys are stored separately and are never returned by the dashboard API.

### AI Agent foundation
The agent can read Core security, ticket, audit and knowledge context. It requires the Core AI permission and does not claim destructive actions were executed without a confirmed Core tool result.

### Knowledge search
Knowledge documents can be searched through the Core API and are available as context for the AI layer.

### Security additions
- very young account patterns are included as a deterministic signal;
- role/banning signals remain independent from AI;
- security continues to operate when AI is globally disabled.

### Dashboard
The dashboard adds dedicated Incident, Core-RBAC and AI Provider views while preserving the existing live event UI and SSE interface.


## 4.1 Safety & AI tool gateway

Version 4.1 adds a confirmation-gated Discord tool layer. Read-only tools can be executed directly when permitted; destructive Discord operations create a durable confirmation request first. Confirmations expire, are audited and emit live Core events. The gateway is intentionally independent from the AI provider so future providers cannot bypass Core permissions.

Security also consumes mass-mention, link-burst and webhook-change signals, while the AI agent performs targeted Knowledge Base search before building its context.

## 4.5 AI Reliability Layer

- Primary AI provider plus persistent per-community fallback providers
- Automatic failover with live events and audit metadata
- Ranked knowledge retrieval for title/tag/content relevance
- AI feature switches remain subordinate to the global AI enable switch
- Provider secrets are never returned by dashboard configuration endpoints
- Existing Discord tool confirmation and RBAC boundaries remain intact

## 4.8.0 — Identity & Staff Center

- Central User Center aggregating Discord identity, community membership, Core-RBAC, activity, risk, warnings, tickets and audit context.
- Staff Center with availability states (`available`, `busy`, `dnd`, `offline`) and persistent notes.
- New identity APIs: `/api/identity/users`, `/api/identity/users/:id`, `/api/staff/overview`.
- Dashboard live refresh for user/staff changes.
- Existing Event Bus and internal interfaces remain backward compatible.


## Security Operations

Community Core 5.1 adds a deterministic Security Response layer on top of the risk engine. Security history is retained separately from the current snapshot, and destructive responses require `security.respond` plus an explicit confirmation. Supported response actions include channel slowmode, channel lock, member timeout and quarantine-role assignment.

Automation can safely trigger `security.evaluate` and `security.create-incident`; destructive Discord security responses are never executed automatically by an automation.

## 5.3 Support Intelligence

The 5.3 release connects Support, Security, Incidents, AI and Knowledge through a stable Core boundary. Ticket/incident links are persisted, AI ticket analyses are retained, SLA breaches can be evaluated, and security-oriented AI triage can escalate a ticket into an auditable incident. Destructive Discord actions remain outside this workflow and continue to require the existing RBAC/confirmation boundaries.

## Stable Module API v1

Community Core 5.7 introduces a versioned module boundary. External modules should use the SDK supplied to `setup(context)` instead of importing internal Core managers or SQLite internals.

- API version: `1.0`
- manifest fields: `id`, `name`, `version`, optional `apiVersion`, `permissions`
- stable surfaces: `events`, `communities`, `modules`, `data`, `meta()`
- incompatible API versions are rejected during module discovery
- module lifecycle: `setup(context)` / `destroy(context)`
- dashboard metadata: `/api/v1/meta` and `/api/v1/modules`

The Core may evolve internally without requiring modules to depend on implementation details.
## 5.8.0 — Production Hardening & Dashboard UX

- Security headers for the local control plane (CSP, frame/resource policy, MIME sniffing protection).
- In-process request throttling and stricter login throttling.
- Health diagnostics now report whether dashboard password protection is actually enabled.
- Stable production-hardening helpers for bounded limits, secret redaction and safe error responses.
- Dashboard accessibility/UX polish: focus states, responsive layouts, reduced-motion support, improved cards/navigation and scrollbar treatment.
- Existing API v1 and Event Bus contracts remain backward compatible.

## 5.9.0-rc.2 — Release Candidate Cleanup

- Added a dependency-free Release Readiness validator for the stable control plane.
- Added fresh-install schema checks, SQLite WAL/foreign-key checks and stable API/Event Bus checks.
- Added forward-migration coverage for older ticket and incident schemas without data loss.
- Kept Core API v1 backward compatible; the release-readiness layer is additive and read-only.
- Added regression coverage for broken runtime invariants so RC validation fails early instead of cascading into dashboard/runtime errors.

This release candidate intentionally focuses on stability rather than adding another feature subsystem.
