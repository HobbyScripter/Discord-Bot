import { ensureRoles } from './roles.js';
import { ensureCategories, ensureChannels } from './channels.js';
import { ensureManagedMessages } from './messages.js';
import { ensureReactionRolePanel } from './reaction-roles.js';
import { configureCommunityOnboarding } from './onboarding.js';

export async function runSetup(guild, options) {
  const { dryRun = false, force = false, logger = console } = options;

  logger.info('');
  logger.info('=== WebRadio Discord Setup ===');
  logger.info(`Server: ${guild.name} (${guild.id})`);
  logger.info(`Modus: ${dryRun ? 'DRY-RUN' : force ? 'FORCE' : 'NORMAL'}`);
  logger.info('');

  logger.info('1/6 Rollen');
  const roles = await ensureRoles(guild, { dryRun, logger });

  if (dryRun) {
    logger.info('');
    logger.info('2/6 Kategorien');
    await ensureCategories(guild, roles, { dryRun, force, logger });
    logger.info('');
    logger.info('3/6 Channels');
    await ensureChannels(guild, roles, new Map(), { dryRun, force, logger });
    logger.info('');
    logger.info('4/6 Nachrichten');
    logger.info('  ~ Nachrichten werden im Dry-Run nur angekündigt.');
    logger.info('');
    logger.info('5/6 Reaction Roles');
    logger.info('  ~ Reaction-Role-Panel wird im Dry-Run nur angekündigt.')
    logger.info('');
    logger.info('\n6/6 Community Onboarding');
    await configureCommunityOnboarding(guild, { channels: new Map(), roles, dryRun: true, logger });
    logger.info('\nDry-Run abgeschlossen. Es wurden keine Änderungen vorgenommen.');
    return;
  }

  logger.info('');
  logger.info('2/6 Kategorien');
  const categories = await ensureCategories(guild, roles, { dryRun, force, logger });

  logger.info('');
  logger.info('3/6 Channels');
  const channels = await ensureChannels(guild, roles, categories, { dryRun, force, logger });

  logger.info('');
  logger.info('4/6 Nachrichten');
  await ensureManagedMessages(channels, { dryRun, force, logger });

  logger.info('');
  logger.info('5/6 Reaction Roles');
  const panel = await ensureReactionRolePanel(guild, { dryRun, force, logger });

  logger.info('\n6/6 Community Onboarding');
  await configureCommunityOnboarding(guild, { channels, roles, dryRun, logger });

  logger.info('');
  logger.info('=== Setup abgeschlossen ===');
  logger.info('Alle von diesem Tool verwalteten WebRadio-Ressourcen wurden geprüft.');
  logger.info('Es wurden keine fremden Channels, Rollen oder Nachrichten gelöscht.');
}
