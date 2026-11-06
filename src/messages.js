import { EmbedBuilder } from 'discord.js';
import { PROJECT, CHANNEL_DEFINITIONS } from './config.js';

const MARKER_PREFIX = 'WEBRADIO-SETUP';

const MESSAGES = {
  welcome: {
    title: '🎵 Willkommen bei WebRadio!',
    description: 'Willkommen in der offiziellen Community rund um **WebRadio** – dem offenen, erweiterbaren Desktop-Radioplayer von Your Elite Systems.',
    color: 0x5865F2,
    fields: [
      { name: '📻 Was ist WebRadio?', value: 'WebRadio ermöglicht die Suche und Wiedergabe von Radiostationen aus aller Welt und setzt dabei auf Electron, React und FFmpeg.' },
      { name: '💬 Community', value: 'Tausche dich über Radiostationen, Plugins, Themes, Entwicklung und neue Ideen aus.' },
      { name: '🛠️ Support', value: 'Fehler gefunden? Nutze `#🐛・bug-reports`. Ideen und Wünsche gehören nach `#💭・feature-requests`.' },
      { name: '💻 Open Source', value: `[GitHub Repository](${PROJECT.github})` },
    ],
    footer: 'WebRadio • One World — One Signal',
  },
  announcements: {
    title: '📢 WebRadio Announcements',
    description: 'Hier erscheinen wichtige Neuigkeiten, Community-Ankündigungen und Projektinformationen.',
    color: 0x5865F2,
    footer: 'WebRadio Announcements',
  },
  releases: {
    title: '📰 WebRadio Releases',
    description: 'Neue Releases, Versionen und wichtige Release-Hinweise werden hier veröffentlicht.',
    color: 0x57F287,
    fields: [
      { name: '📦 Releases', value: `[GitHub Releases](${PROJECT.github}/releases)` },
      { name: '🧪 Testing', value: 'Beta-/Testbuilds und Hinweise zur Verifikation können in `#🧪・testing` besprochen werden.' },
    ],
    footer: 'WebRadio Releases',
  },
  roadmap: {
    title: '🗺️ WebRadio Roadmap',
    description: 'Hier findest du Informationen über geplante Arbeiten, technische Ziele und die weitere Entwicklung von WebRadio.',
    color: 0xFEE75C,
    fields: [
      { name: '💡 Ideen', value: 'Community-Ideen können in `#💭・feature-requests` diskutiert werden.' },
      { name: '💻 Entwicklung', value: 'Technische Themen gehören nach `#💻・development`.' },
    ],
    footer: 'WebRadio Roadmap',
  },
  rules: {
    title: '📌 WebRadio Community Regeln',
    description: 'Damit die Community für alle angenehm bleibt, gelten einige einfache Grundregeln.',
    color: 0xED4245,
    fields: [
      { name: '1. 🤝 Respekt', value: 'Behandle andere Mitglieder respektvoll. Keine persönlichen Angriffe, Belästigung oder Diskriminierung.' },
      { name: '2. 🚫 Kein Spam', value: 'Kein Flooding, unnötiger Spam, unerwünschte Werbung oder schädliche Inhalte.' },
      { name: '3. 🐛 Bugs', value: 'Für Fehler bitte `#🐛・bug-reports` nutzen und möglichst reproduzierbare Informationen angeben.' },
      { name: '4. 💡 Vorschläge', value: 'Feature-Ideen bitte in `#💭・feature-requests` sammeln, damit sie nachvollziehbar bleiben.' },
      { name: '5. 🔐 Sicherheit', value: 'Keine Tokens, Passwörter, Zugangsdaten oder andere Geheimnisse veröffentlichen.' },
      { name: '6. ⚖️ Moderation', value: 'Moderatoren können bei Regelverstößen Maßnahmen ergreifen, um die Community zu schützen.' },
    ],
    footer: 'WebRadio Community • Bitte respektvoll bleiben',
  },
};

function buildEmbed(key) {
  const data = MESSAGES[key];
  if (!data) return null;

  const embed = new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(data.description)
    .setColor(data.color)
    .setFooter({ text: `${data.footer} • ${MARKER_PREFIX}:${key}` })
    .setTimestamp();

  if (data.fields) embed.addFields(data.fields);
  return embed;
}

async function hasManagedMessage(channel, key) {
  if (!channel?.isTextBased()) return false;

  const messages = await channel.messages.fetch({ limit: 50 });
  const marker = `${MARKER_PREFIX}:${key}`;

  return messages.some((message) =>
    message.author?.bot && message.embeds?.some((embed) => embed.footer?.text?.includes(marker)),
  );
}

export async function ensureManagedMessages(channels, { dryRun = false, force = false, logger = console }) {
  for (const definition of CHANNEL_DEFINITIONS) {
    if (!definition.managedMessage) continue;

    const channel = channels.get(definition.key);
    if (!channel?.isTextBased()) continue;

    const exists = await hasManagedMessage(channel, definition.managedMessage);

    if (exists && !force) {
      logger.info(`  ✓ Startnachricht vorhanden: ${definition.name}`);
      continue;
    }

    if (dryRun) {
      logger.info(`  + Startnachricht würde ${exists ? 'aktualisiert' : 'erstellt'}: ${definition.name}`);
      continue;
    }

    const embed = buildEmbed(definition.managedMessage);
    if (!embed) continue;

    if (exists && force) {
      const messages = await channel.messages.fetch({ limit: 50 });
      const marker = `${MARKER_PREFIX}:${definition.managedMessage}`;
      const old = messages.find((message) =>
        message.author?.bot && message.embeds?.some((candidate) => candidate.footer?.text?.includes(marker)),
      );

      if (old) {
        await old.edit({ embeds: [embed] });
        logger.info(`  ↻ Startnachricht aktualisiert: ${definition.name}`);
        continue;
      }
    }

    await channel.send({ embeds: [embed] });
    logger.info(`  + Startnachricht erstellt: ${definition.name}`);
  }
}
