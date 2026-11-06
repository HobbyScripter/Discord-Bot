import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { fetchLatestRelease, fetchOpenIssues, fetchRepository, fetchReleases, projectLinks } from './github.js';

const RELEASE_CHANNELS = {
  alpha: '🧬・alpha-releases',
  beta: '🧪・beta-releases',
  rc: '🚧・rc-releases',
  stable: '🚀・stable-releases',
};
const issueChannelName = '🐛・bug-reports';
const MAX_DISCORD_DESCRIPTION = 3900;

function findTextChannel(guild, name) {
  return guild.channels.cache.find((channel) => channel.isTextBased() && channel.name === name);
}

function trim(text, max) {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function releaseType(release) {
  const tag = String(release.tag_name || release.name || '').toLowerCase();
  const prerelease = Boolean(release.prerelease);
  if (!prerelease) return 'stable';
  if (/(^|[-_.])alpha(?:[-_.]|$)|(^|[-_.])a\d/.test(tag)) return 'alpha';
  if (/(^|[-_.])beta(?:[-_.]|$)|(^|[-_.])b\d/.test(tag)) return 'beta';
  if (/(^|[-_.])(?:rc|releasecandidate)(?:[-_.]|$)|(^|[-_.])rc\d/.test(tag)) return 'rc';
  return 'beta';
}

function releaseLabel(type) {
  return {
    alpha: '🧬 Alpha',
    beta: '🧪 Beta',
    rc: '🚧 Release Candidate',
    stable: '🚀 Stable',
  }[type];
}

function releaseDescription(release) {
  const body = String(release.body || '').trim();
  return trim(body || 'Dieses Release enthält keine zusätzlichen Changelog-Notizen.', MAX_DISCORD_DESCRIPTION);
}

function releaseTimestamp(release) {
  const value = new Date(release.published_at || release.created_at).getTime();
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

function releaseEmbed(release) {
  const type = releaseType(release);
  const timestamp = releaseTimestamp(release);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const totalDownloads = assets.reduce((sum, asset) => sum + Number(asset.download_count || 0), 0);

  const embed = new EmbedBuilder()
    .setTitle(`${releaseLabel(type)} • WebRadio ${release.tag_name}`)
    .setURL(release.html_url)
    .setDescription(releaseDescription(release))
    .addFields(
      { name: 'Version', value: `\`${release.tag_name}\``, inline: true },
      { name: 'Typ', value: releaseLabel(type), inline: true },
      { name: 'Assets', value: `${assets.length} Datei${assets.length === 1 ? '' : 'en'}${totalDownloads ? ` • ${totalDownloads.toLocaleString('de-DE')} Downloads` : ''}`, inline: true },
    )
    .setFooter({ text: 'WebRadio • GitHub Release' });

  if (timestamp) embed.addFields({ name: 'Veröffentlicht', value: `<t:${timestamp}:F>`, inline: true });
  if (release.author?.login) embed.addFields({ name: 'Erstellt von', value: `[@${release.author.login}](${release.author.html_url})`, inline: true });
  return embed;
}

function releaseAssetRows(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const rows = [];
  for (let i = 0; i < assets.length && rows.length < 5; i += 5) {
    const row = new ActionRowBuilder();
    for (const asset of assets.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel(trim(asset.name || 'Download', 80))
          .setStyle(ButtonStyle.Link)
          .setURL(asset.browser_download_url),
      );
    }
    if (row.components.length) rows.push(row);
  }
  return rows;
}

function releaseMessage(release) {
  const rows = releaseAssetRows(release);
  return {
    content: `📢 **WebRadio ${release.tag_name}** — ${releaseLabel(releaseType(release))}`,
    embeds: [releaseEmbed(release)],
    components: rows,
  };
}

function issueEmbed(issue) {
  return new EmbedBuilder()
    .setTitle(`🐛 ${trim(issue.title, 240)}`)
    .setURL(issue.html_url)
    .setDescription(trim(issue.body || 'Keine Beschreibung.', 3500))
    .addFields(
      { name: 'Issue', value: `#${issue.number}`, inline: true },
      { name: 'Autor', value: issue.user?.login || 'unbekannt', inline: true },
    )
    .setFooter({ text: 'WebRadio • GitHub Issue' });
}

export function buildCommands() {
  return [
    new SlashCommandBuilder().setName('status').setDescription('Zeigt den aktuellen WebRadio-GitHub-Status.'),
    new SlashCommandBuilder().setName('release').setDescription('Zeigt das aktuellste WebRadio-Release.'),
    new SlashCommandBuilder().setName('releases').setDescription('Zeigt die letzten WebRadio-Releases inklusive Alpha/Beta/RC/Stable.'),
    new SlashCommandBuilder().setName('issues').setDescription('Zeigt die zuletzt aktualisierten offenen GitHub-Issues.'),
    new SlashCommandBuilder().setName('github').setDescription('Zeigt die wichtigsten WebRadio-GitHub-Links.'),
    new SlashCommandBuilder()
      .setName('sync')
      .setDescription('Synchronisiert GitHub-Releases und Issues sofort.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()),
    new SlashCommandBuilder()
      .setName('reactionroles')
      .setDescription('Erstellt oder aktualisiert das Reaction-Role-Panel.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()),
  ].map((command) => command.toJSON());
}

export async function registerCommands(client, guild) {
  await guild.commands.set(buildCommands());
  console.log(`✓ ${buildCommands().length} Slash-Commands registriert.`);
}

export async function handleCommand(interaction, { sync, reactionRoles }) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'status') {
    await interaction.deferReply();
    const repo = await fetchRepository();
    const embed = new EmbedBuilder()
      .setTitle('📊 WebRadio Status')
      .setURL(repo.html_url)
      .setDescription(repo.description || 'WebRadio')
      .addFields(
        { name: '⭐ Stars', value: String(repo.stargazers_count), inline: true },
        { name: '🍴 Forks', value: String(repo.forks_count), inline: true },
        { name: '🐛 Offene Issues', value: String(repo.open_issues_count), inline: true },
        { name: '🌿 Default Branch', value: `\`${repo.default_branch}\``, inline: true },
        { name: '🕒 Aktualisiert', value: `<t:${Math.floor(new Date(repo.updated_at).getTime() / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: 'WebRadio • GitHub' });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (interaction.commandName === 'release') {
    await interaction.deferReply();
    const release = await fetchLatestRelease();
    await interaction.editReply(releaseMessage(release));
    return;
  }

  if (interaction.commandName === 'releases') {
    await interaction.deferReply();
    const releases = await fetchReleases(8);
    if (!releases.length) return interaction.editReply('Keine GitHub-Releases gefunden.');
    const lines = releases.map((release) => `${releaseLabel(releaseType(release))} **[${release.tag_name}](${release.html_url})**${release.prerelease ? ' — Pre-release' : ''}`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📦 WebRadio Releases').setDescription(lines)] });
    return;
  }

  if (interaction.commandName === 'issues') {
    await interaction.deferReply();
    const issues = (await fetchOpenIssues(5)).filter((item) => !item.pull_request);
    if (!issues.length) return interaction.editReply('Keine offenen Issues gefunden.');
    const embed = new EmbedBuilder().setTitle('🐛 Offene WebRadio-Issues');
    embed.setDescription(issues.map((issue) => `• [#${issue.number} ${trim(issue.title, 100)}](${issue.html_url}) — ${issue.user?.login || 'unbekannt'}`).join('\n'));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (interaction.commandName === 'github') {
    const links = projectLinks();
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('🔗 WebRadio Links').setDescription([
        `**Repository:** ${links.github}`,
        `**Releases:** ${links.releases}`,
        `**Issues:** ${links.issues}`,
        `**Roadmap:** ${links.roadmap}`,
      ].join('\n'))],
    });
    return;
  }

  if (interaction.commandName === 'sync') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await sync(interaction.guild);
    await interaction.editReply('✅ GitHub-Synchronisation abgeschlossen.');
    return;
  }

  if (interaction.commandName === 'reactionroles') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await reactionRoles(interaction.guild);
    await interaction.editReply('✅ Reaction-Role-Panel wurde aktualisiert.');
  }
}

export async function syncGitHub(guild, { database, logger = console } = {}) {
  if (!database) throw new Error('CommunityDatabase wird für den GitHub-Sync benötigt.');
  const channels = {};
  for (const [type, name] of Object.entries(RELEASE_CHANNELS)) channels[type] = findTextChannel(guild, name);
  const issueChannel = findTextChannel(guild, issueChannelName);

  if (!Object.values(channels).some(Boolean) && !issueChannel) {
    logger.warn('Keine verwalteten GitHub-Kanäle gefunden. Führe zuerst das Setup aus.');
    return { guildId: guild.id, lastPoll: new Date().toISOString(), releases: [], issues: [] };
  }

  const releases = await fetchReleases(20);
  for (const release of [...releases].reverse()) {
    const type = releaseType(release);
    const channel = channels[type];
    if (!channel) {
      logger.warn(`Kein Channel für ${type} vorhanden: ${release.tag_name}`);
      continue;
    }
    if (!database.reserveReleaseAnnouncement(guild.id, { ...release, type })) continue;
    try {
      const message = await channel.send(releaseMessage(release));
      database.setReleaseAnnouncement(guild.id, release, message.id);
    } catch (error) {
      database.cancelReleaseAnnouncement(guild.id, release.id);
      throw error;
    }
    logger.log(`✓ ${releaseLabel(type)} angekündigt: ${release.tag_name}`);
  }

  if (issueChannel) {
    const issues = (await fetchOpenIssues(10)).filter((item) => !item.pull_request);
    for (const issue of issues.reverse()) {
      if (!issue.labels?.some((label) => String(label.name).toLowerCase().includes('discord'))) continue;
      if (!database.reserveIssueAnnouncement(guild.id, issue.id)) continue;
      try {
        const message = await issueChannel.send({ content: '🐛 **Neues GitHub Issue markiert für Discord**', embeds: [issueEmbed(issue)] });
        database.setIssueAnnouncement(guild.id, issue.id, message.id);
      } catch (error) {
        database.cancelIssueAnnouncement(guild.id, issue.id);
        throw error;
      }
    }
  }

  return {
    guildId: guild.id,
    lastPoll: new Date().toISOString(),
    releases: database.releaseAnnouncements(guild.id, 20),
    issues: database.issueAnnouncements(guild.id, 20),
  };
}

export function startGitHubPolling(client, guild, intervalMs, { database, logger = console } = {}) {
  let running = false;
  let lastReportedError = null;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await syncGitHub(guild, { database, logger });
      if (lastReportedError) {
        logger.info?.(`GitHub-Sync für Community ${guild.id} funktioniert wieder.`);
        lastReportedError = null;
      }
    } catch (error) {
      const message = String(error?.message || error);
      // Polling can run for days: don't flood logs with the same configuration error
      // on every interval. Report it once, then report again only after recovery or
      // when the underlying error changes.
      if (message !== lastReportedError) {
        logger.error(`GitHub-Sync fehlgeschlagen: ${message}`);
        lastReportedError = message;
      }
    } finally {
      running = false;
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  client.once(Events.ClientDestroyed, () => clearInterval(timer));
  return timer;
}

export { releaseType, releaseLabel, releaseMessage };
