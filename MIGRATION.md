# Migration Guide — 5.9.x to 6.0.0

## Before upgrading

1. Stop Community Core cleanly.
2. Create a backup of `./data/community-core.sqlite` and keep it outside the application directory.
3. Keep your existing `.env` file and Discord credentials out of source control.
4. Verify that the runtime is Node.js 22.5 or newer.

## Upgrade

1. Replace the application files with the 6.0.0 release.
2. Keep the existing `data/community-core.sqlite` database.
3. Run `npm install`.
4. Start with `npm run bot` (or your existing service command).
5. Allow the built-in SQLite migration layer to complete before using the dashboard.

Do **not** delete or recreate the SQLite database as part of a normal upgrade.

## What changes automatically

The database migration layer preserves existing community, module, ticket, incident, automation, AI and audit data while applying required schema updates.

6.0.0 also enforces stricter ownership validation for cross-community relationships. Existing valid data is unaffected; inconsistent cross-community relationships will be rejected when a write is attempted.

## Permissions

RBAC is stricter in 6.0.0:

- only `owner` may grant the `owner` role;
- only `owner` may define wildcard (`*`) permissions;
- quarantine roles may not carry dangerous Discord management permissions.

Review any custom security/quarantine role configuration after upgrading.

## Dashboard

The dashboard remains a local control plane by default and binds to `127.0.0.1`. Existing dashboard authentication settings remain applicable.

If you expose the dashboard through a reverse proxy, keep authentication and TLS controls in place.

## Rollback

If a rollback is required, stop the application first and restore the pre-upgrade database backup together with the previous application version. Do not mix a newer migrated database with an older binary unless the older version explicitly supports that schema.

## Post-upgrade verification

Confirm:

- the bot connects to Discord;
- all expected communities are visible;
- dashboard authentication works;
- modules retain their enabled/disabled state;
- open tickets/incidents are present;
- automation jobs and AI sessions remain available;
- the Event Bus/dashboard live feed receives new events.
