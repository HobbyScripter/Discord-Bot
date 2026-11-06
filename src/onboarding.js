import {
  GuildOnboardingMode,
  GuildOnboardingPromptType,
} from 'discord.js';
import { CHANNEL_DEFINITIONS } from './config.js';

const channelId = (channels, key) => channels.get(key)?.id;
const roleId = (roles, name) => roles.get(name)?.id;

export async function configureCommunityOnboarding(guild, { channels, roles, dryRun = false, logger = console } = {}) {
  const defaults = [
    'welcome',
    'rules',
    'general',
    'radio-chat',
    'bot-commands',
    'help',
    'suggestions',
  ].map((key) => channelId(channels, key)).filter(Boolean);

  if (defaults.length < 7) {
    logger.warn(`⚠ Onboarding: nur ${defaults.length}/7 Standardkanäle gefunden.`);
  }

  const option = (title, description, emoji, roleNames = [], channelKeys = []) => ({
    title,
    description,
    emoji,
    roles: roleNames.map((name) => roleId(roles, name)).filter(Boolean),
    channels: channelKeys.map((key) => channelId(channels, key)).filter(Boolean),
  });

  const prompts = [
    {
      title: 'Was möchtest du bei WebRadio machen?',
      type: GuildOnboardingPromptType.MultipleChoice,
      singleSelect: false,
      required: true,
      inOnboarding: true,
      options: [
        option('WebRadio entdecken', 'Radio hören, Neuigkeiten verfolgen und Teil der Community sein.', '🎵', ['WebRadio Community'], ['radio-chat', 'general']),
        option('Entwicklung', 'WebRadio entwickeln, testen oder zum Projekt beitragen.', '👨‍💻', ['WebRadio Community'], ['development-chat', 'testing']),
        option('Plugins entwickeln', 'Plugins bauen und mit anderen Entwicklern austauschen.', '🔌', ['WebRadio Plugin Creator', 'WebRadio Community'], ['plugins', 'development-chat']),
        option('Themes entwickeln', 'Themes gestalten und teilen.', '🎨', ['WebRadio Theme Creator', 'WebRadio Community'], ['themes', 'development-chat']),
        option('Support geben', 'Andere Nutzer unterstützen und Fehler nachvollziehen.', '🛠️', ['WebRadio Community'], ['help', 'bug-reports']),
      ],
    },
    {
      title: 'Welche Benachrichtigungen möchtest du?',
      type: GuildOnboardingPromptType.MultipleChoice,
      singleSelect: false,
      required: false,
      inOnboarding: true,
      options: [
        option('Stable Releases', 'Neue stabile WebRadio-Versionen.', '🚀', ['WebRadio Release Notifications'], ['stable-releases']),
        option('Beta Releases', 'Öffentliche Beta-Versionen testen.', '🧪', ['WebRadio Beta Tester'], ['beta-releases']),
        option('Alpha Releases', 'Frühe Entwicklungsstände testen.', '🧬', ['WebRadio Alpha Tester'], ['alpha-releases']),
        option('Release Candidates', 'Release Candidates vor Stable testen.', '🚧', [], ['rc-releases']),
      ],
    },
  ];

  // Discord requires every onboarding option to have at least one role or channel.
  for (const prompt of prompts) {
    prompt.options = prompt.options.filter((item) => item.roles.length || item.channels.length);
  }

  if (dryRun) {
    logger.log(`✓ Onboarding geplant: ${defaults.length} Standardkanäle, ${prompts.length} Fragen.`);
    return;
  }

  if (!guild.features.includes('COMMUNITY')) {
    logger.warn('⚠ Discord Community ist für diesen Server noch nicht aktiviert. Onboarding wird übersprungen.');
    return;
  }

  try {
    await guild.editOnboarding({
      enabled: true,
      mode: GuildOnboardingMode.OnboardingAdvanced,
      defaultChannels: defaults,
      prompts,
      reason: 'WebRadio Community Onboarding konfigurieren',
    });
    logger.log('✓ Community Onboarding konfiguriert.');
  } catch (error) {
    logger.warn(`⚠ Community Onboarding konnte nicht automatisch gespeichert werden: ${error?.message || error}`);
    logger.warn('  Prüfe die Onboarding-Voraussetzungen in Discord unter Servereinstellungen → Onboarding.');
  }
}
