import { ROLE_DEFINITIONS } from './config.js';

export async function ensureRoles(guild, { dryRun = false, logger = console }) {
  const roles = new Map();
  const existing = await guild.roles.fetch();

  for (const definition of ROLE_DEFINITIONS) {
    let role = existing.find((candidate) => candidate.name === definition.name);

    if (role) {
      roles.set(definition.name, role);
      logger.info(`  ✓ Rolle vorhanden: ${definition.name}`);

      if (!dryRun && (role.color !== definition.color || role.hoist !== definition.hoist || role.mentionable !== definition.mentionable)) {
        await role.edit({
          color: definition.color,
          hoist: definition.hoist,
          mentionable: definition.mentionable,
          reason: 'WebRadio Discord Setup: managed role sync',
        });
        logger.info(`    ↳ Rolle aktualisiert: ${definition.name}`);
      }
      continue;
    }

    if (dryRun) {
      logger.info(`  + Rolle würde erstellt: ${definition.name}`);
      continue;
    }

    role = await guild.roles.create({
      name: definition.name,
      color: definition.color,
      hoist: definition.hoist,
      mentionable: definition.mentionable,
      reason: 'WebRadio Discord Setup',
    });

    roles.set(definition.name, role);
    logger.info(`  + Rolle erstellt: ${definition.name}`);
  }

  if (dryRun) {
    for (const definition of ROLE_DEFINITIONS) {
      if (!roles.has(definition.name)) {
        roles.set(definition.name, null);
      }
    }
  }

  return roles;
}
