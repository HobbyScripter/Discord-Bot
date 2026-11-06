import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import { runSetup } from './setup.js';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    help: argv.includes('--help') || argv.includes('-h'),
    bot: argv.includes('--bot'),
  };
}

function printHelp() {
  console.log(`
WebRadio Discord Setup

Usage:
  npm run setup
  npm run setup -- --dry-run
  npm run setup -- --force
  npm run bot

Options:
  --dry-run   Zeigt geplante Änderungen, ohne Discord zu verändern.
  --force     Wendet verwaltete Berechtigungen und Startnachrichten erneut an.
  --bot       Startet den dauerhaften WebRadio Discord Bot.
  --help      Zeigt diese Hilfe.
`);
}

function requireEnvironment() {
  const missing = [];
  if (!process.env.DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
  if (!process.env.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID');

  if (missing.length) {
    throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}. Kopiere .env.example nach .env und trage die Werte ein.`);
  }
}

async function validateBotPermissions(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe();
  const permissions = me.permissions;
  const required = [
    [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
    [PermissionFlagsBits.ManageGuild, 'Manage Server'],
    [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
    [PermissionFlagsBits.ViewChannel, 'View Channels'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
    [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
    [PermissionFlagsBits.AddReactions, 'Add Reactions'],
  ];

  const missing = required
    .filter(([permission]) => !permissions.has(permission))
    .map(([, name]) => name);

  if (missing.length) {
    throw new Error(`Der Bot besitzt nicht alle benötigten Server-Berechtigungen: ${missing.join(', ')}.`);
  }

  const botRole = me.roles.highest;
  const managedRoleNames = [
    'WebRadio Admin',
    'WebRadio Moderator',
    'WebRadio Developer',
    'WebRadio Contributor',
    'WebRadio Community',
    'Bots',
    'WebRadio Alpha Tester',
    'WebRadio Beta Tester',
    'WebRadio Release Notifications',
    'WebRadio Plugin Creator',
    'WebRadio Theme Creator',
  ];

  const tooHigh = managedRoleNames
    .map((name) => guild.roles.cache.find((role) => role.name === name))
    .filter(Boolean)
    .filter((role) => role.position >= botRole.position);

  if (tooHigh.length) {
    throw new Error(
      `Die Bot-Rolle muss über diesen WebRadio-Rollen stehen: ${tooHigh.map((role) => role.name).join(', ')}.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  requireEnvironment();

  if (args.bot) {
    await import('./bot.js');
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  try {
    try { await client.login(process.env.DISCORD_TOKEN); }
    catch (error) {
      if (error?.name === 'TokenInvalid' || error?.code === 'TokenInvalid') throw new Error('Ungültiger Discord-Bot-Token. Öffne Discord Developer Portal → Bot → Token → Reset Token und aktualisiere DISCORD_TOKEN in .env.');
      throw error;
    }
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    await guild.fetch();

    console.log(`Angemeldet als: ${client.user.tag}`);
    console.log(`Zielserver: ${guild.name} (${guild.id})`);

    if (!args.dryRun) {
      await validateBotPermissions(guild);
    }

    await runSetup(guild, {
      dryRun: args.dryRun,
      force: args.force,
      logger: console,
    });
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error('');
  console.error('❌ Discord Setup fehlgeschlagen');
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
