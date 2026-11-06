import { EmbedBuilder } from 'discord.js';
import { PROJECT } from './config.js';

const DEFAULT_TEMPLATES = [
  {
    title: '👋 Willkommen bei WebRadio, {username}!',
    description: 'Schön, dass du da bist, {mention}! Du bist jetzt Mitglied der **WebRadio Community**.',
    color: 0x5865F2,
  },
  {
    title: '🎵 Willkommen, {username}!',
    description: 'Hey {mention} — schön, dich hier zu sehen! Entdecke WebRadio, tausche dich mit der Community aus und viel Spaß auf dem Server.',
    color: 0x57F287,
  },
  {
    title: '📻 Neues Signal empfangen: {username}',
    description: 'Willkommen {mention}! Dein Signal ist angekommen. Schau dich in der Community um und entdecke WebRadio.',
    color: 0xEB459E,
  },
];

function channelByName(guild, name) {
  return guild.channels.cache.find((channel) => channel.isTextBased() && channel.name === name);
}

function replaceTokens(text, member) {
  const guild = member.guild;
  const rulesChannel = channelByName(guild, '📌・rules');
  const rolesChannel = channelByName(guild, '🎭・roles');
  const values = {
    '{user}': member.user.tag,
    '{username}': member.user.username,
    '{mention}': `<@${member.id}>`,
    '{server}': guild.name,
    '{memberCount}': String(guild.memberCount),
    '{rules}': rulesChannel ? `<#${rulesChannel.id}>` : 'die Regeln',
    '{roles}': rolesChannel ? `<#${rolesChannel.id}>` : 'den Rollen-Kanal',
    '{github}': PROJECT.github,
  };
  return String(text ?? '').replace(/\{user\}|\{username\}|\{mention\}|\{server\}|\{memberCount\}|\{rules\}|\{roles\}|\{github\}/g, (token) => values[token] ?? token);
}

function templatesFromEnvironment() {
  const raw = process.env.WELCOME_MESSAGES_JSON;
  if (!raw) return DEFAULT_TEMPLATES;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('WELCOME_MESSAGES_JSON muss ein nicht-leeres Array sein.');
    return parsed;
  } catch (error) {
    console.warn(`⚠ WELCOME_MESSAGES_JSON ist ungültig: ${error.message}. Standardnachrichten werden verwendet.`);
    return DEFAULT_TEMPLATES;
  }
}

function selectTemplate(member) {
  const templates = templatesFromEnvironment();
  const index = Math.abs(Number(BigInt(member.id) % BigInt(templates.length)));
  return templates[index] ?? templates[0];
}

export async function sendWelcomeMessage(member, { logger = console } = {}) {
  if (!member?.guild) return;
  if (member.user?.bot && process.env.WELCOME_INCLUDE_BOTS !== 'true') return;

  const channelName = process.env.WELCOME_CHANNEL_NAME || '📜・welcome';
  const channel = channelByName(member.guild, channelName);
  if (!channel?.isTextBased()) {
    logger.warn(`Kein Welcome-Channel gefunden: ${channelName}`);
    return;
  }

  const template = selectTemplate(member);
  const embed = new EmbedBuilder()
    .setTitle(replaceTokens(template.title || '👋 Willkommen bei WebRadio!', member))
    .setDescription(replaceTokens(template.description || 'Willkommen in der WebRadio Community!', member))
    .setColor(Number(template.color ?? 0x5865F2))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '👥 Mitglied', value: `<@${member.id}>`, inline: true },
      { name: '📊 Community', value: `${member.guild.memberCount} Mitglieder`, inline: true },
    )
    .setFooter({ text: 'WebRadio Community • One World — One Signal' })
    .setTimestamp();

  if (template.fields && Array.isArray(template.fields)) {
    embed.addFields(template.fields.slice(0, 10).map((field) => ({
      name: replaceTokens(field.name, member),
      value: replaceTokens(field.value, member),
      inline: Boolean(field.inline),
    })));
  }

  const content = process.env.WELCOME_MENTION !== 'false' ? `<@${member.id}>` : undefined;
  await channel.send({ content, embeds: [embed] });
  logger.info(`✓ Willkommen für ${member.user.tag} gesendet.`);
}
