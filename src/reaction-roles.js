import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { CHANNEL_DEFINITIONS, REACTION_ROLE_DEFINITIONS } from './config.js';

const PANEL_MARKER = 'WEBRADIO-REACTION-ROLES';

function findChannel(guild) {
  const definition = CHANNEL_DEFINITIONS.find((item) => item.key === 'roles');
  return guild.channels.cache.find((channel) => channel.name === definition?.name && channel.isTextBased());
}

function buildPanelEmbed() {
  const lines = REACTION_ROLE_DEFINITIONS.map((item) => `${item.emoji}  **${item.name}**\n${item.description}`).join('\n\n');
  return new EmbedBuilder()
    .setTitle('🎭 WebRadio Rollen')
    .setDescription('Wähle deine optionalen Community-Rollen, indem du auf die passende Reaktion klickst. Du kannst eine Rolle jederzeit durch erneutes Klicken entfernen.\n\n' + lines)
    .setColor(0x5865F2)
    .setFooter({ text: `${PANEL_MARKER} • Nur freiwillige Community-/Benachrichtigungsrollen` });
}

async function findExistingPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 50 });
  return messages.find((message) =>
    message.author?.bot && message.embeds?.some((embed) => embed.footer?.text?.includes(PANEL_MARKER)),
  ) ?? null;
}

export async function ensureReactionRolePanel(guild, { database, dryRun = false, force = false, logger = console } = {}) {
  const channel = findChannel(guild);
  if (!channel) {
    logger.warn('Kein Reaction-Role-Channel gefunden. Führe zuerst das Setup aus.');
    return null;
  }

  const existing = await findExistingPanel(channel);
  if (existing && !force) {
    const roleIds = Object.fromEntries(REACTION_ROLE_DEFINITIONS.map((definition) => {
      const role = guild.roles.cache.find((candidate) => candidate.name === definition.roleName);
      return role ? [definition.key, role.id] : [];
    }).filter((entry) => entry.length));
    database?.setReactionRoleState(guild.id, { panelMessageId: existing.id, roleIds });
    logger.info(`  ✓ Reaction-Role-Panel vorhanden: ${existing.id}`);
    return existing;
  }

  if (dryRun) {
    logger.info(`  + Reaction-Role-Panel würde ${existing ? 'aktualisiert' : 'erstellt'}: ${channel.name}`);
    return existing;
  }

  let message = existing;
  if (message && force) {
    await message.edit({ embeds: [buildPanelEmbed()] });
    await message.reactions.removeAll().catch(() => {});
  } else {
    message = await channel.send({ embeds: [buildPanelEmbed()] });
  }

  for (const definition of REACTION_ROLE_DEFINITIONS) {
    await message.react(definition.emoji);
  }

  const roleIds = Object.fromEntries(REACTION_ROLE_DEFINITIONS.map((definition) => {
    const role = guild.roles.cache.find((candidate) => candidate.name === definition.roleName);
    return [definition.key, role?.id].filter(Boolean);
  }));
  database?.setReactionRoleState(guild.id, { panelMessageId: message.id, roleIds });
  logger.info(`  ${existing ? '↻' : '+'} Reaction-Role-Panel ${existing ? 'aktualisiert' : 'erstellt'}: ${channel.name}`);
  return message;
}

export async function handleReactionRole(reaction, user, added, { database } = {}) {
  if (user.bot) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const message = reaction.message;
  const guild = message.guild;
  if (!guild) return;

  const state = database?.getReactionRoleState(guild.id) || { panelMessageId: null, roleIds: {} };
  if (!state.panelMessageId || message.id !== state.panelMessageId) return;

  const definition = REACTION_ROLE_DEFINITIONS.find((item) => item.emoji === reaction.emoji.name || item.emoji === reaction.emoji.toString());
  if (!definition) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const role = guild.roles.cache.get(state.roleIds?.[definition.key]);
  if (!role) return;

  if (role.position >= guild.members.me.roles.highest.position) return;

  if (added) {
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'WebRadio reaction role');
  } else if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role, 'WebRadio reaction role');
  }

  await reaction.users.remove(user.id).catch(() => {});
}

export async function initializeReactionRoles(guild, { database, force = false, logger = console } = {}) {
  const state = database?.getReactionRoleState(guild.id) || { roleIds: {} };
  const roleIds = { ...(state.roleIds || {}) };

  for (const definition of REACTION_ROLE_DEFINITIONS) {
    const role = guild.roles.cache.find((candidate) => candidate.name === definition.roleName);
    if (role) roleIds[definition.key] = role.id;
  }

  database?.setReactionRoleState(guild.id, { panelMessageId: state.panelMessageId || null, roleIds });

  const panel = await ensureReactionRolePanel(guild, { database, force, logger });
  return panel;
}

export { PANEL_MARKER };
