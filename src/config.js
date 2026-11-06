import { ChannelType, PermissionFlagsBits } from 'discord.js';

export const PROJECT = {
  name: 'WebRadio',
  github: 'https://github.com/YourEliteSystems/WebRadio',
  website: 'https://github.com/YourEliteSystems/WebRadio',
};

export const ROLE_DEFINITIONS = [
  {
    name: 'WebRadio Admin',
    color: 0xED4245,
    hoist: true,
    mentionable: true,
  },
  {
    name: 'WebRadio Moderator',
    color: 0xFEE75C,
    hoist: true,
    mentionable: true,
  },
  {
    name: 'WebRadio Developer',
    color: 0x5865F2,
    hoist: true,
    mentionable: true,
  },
  {
    name: 'WebRadio Contributor',
    color: 0x57F287,
    hoist: true,
    mentionable: true,
  },
  {
    name: 'WebRadio Community',
    color: 0xEB459E,
    hoist: false,
    mentionable: true,
  },
  {
    name: 'Bots',
    color: 0x95A5A6,
    hoist: false,
    mentionable: true,
  },
  { name: 'WebRadio Alpha Tester', color: 0xE67E22, hoist: false, mentionable: true },
  { name: 'WebRadio Beta Tester', color: 0x3498DB, hoist: false, mentionable: true },
  { name: 'WebRadio Release Notifications', color: 0x57F287, hoist: false, mentionable: true },
  { name: 'WebRadio Plugin Creator', color: 0x9B59B6, hoist: false, mentionable: true },
  { name: 'WebRadio Theme Creator', color: 0xE91E63, hoist: false, mentionable: true },
];

export const CATEGORY_DEFINITIONS = [
  { key: 'information', name: '📢 INFORMATION' },
  { key: 'community', name: '💬 COMMUNITY' },
  { key: 'support', name: '🛠️ SUPPORT' },
  { key: 'development', name: '👨‍💻 DEVELOPMENT' },
  { key: 'voice', name: '🔊 VOICE' },
  { key: 'staff', name: '🔒 STAFF' },
];

export const CHANNEL_DEFINITIONS = [
  { key: 'welcome', name: '📜・welcome', type: ChannelType.GuildText, category: 'information', managedMessage: 'welcome' },
  { key: 'announcements', name: '📢・announcements', type: ChannelType.GuildText, category: 'information', managedMessage: 'announcements' },
  { key: 'releases', name: '📰・releases', type: ChannelType.GuildText, category: 'information', managedMessage: 'releases' },
  { key: 'alpha-releases', name: '🧬・alpha-releases', type: ChannelType.GuildText, category: 'information' },
  { key: 'beta-releases', name: '🧪・beta-releases', type: ChannelType.GuildText, category: 'information' },
  { key: 'rc-releases', name: '🚧・rc-releases', type: ChannelType.GuildText, category: 'information' },
  { key: 'stable-releases', name: '🚀・stable-releases', type: ChannelType.GuildText, category: 'information' },
  { key: 'roadmap', name: '🗺️・roadmap', type: ChannelType.GuildText, category: 'information', managedMessage: 'roadmap' },
  { key: 'rules', name: '📌・rules', type: ChannelType.GuildText, category: 'information', managedMessage: 'rules' },

  { key: 'general', name: '💬・general', type: ChannelType.GuildText, category: 'community' },
  { key: 'radio-chat', name: '🎵・radio-chat', type: ChannelType.GuildText, category: 'community' },
  { key: 'bot-commands', name: '🤖・bot-commands', type: ChannelType.GuildText, category: 'community' },
  { key: 'suggestions', name: '💡・suggestions', type: ChannelType.GuildText, category: 'community' },
  { key: 'roles', name: '🎭・roles', type: ChannelType.GuildText, category: 'community' },

  { key: 'help', name: '🆘・help', type: ChannelType.GuildText, category: 'support' },
  { key: 'bug-reports', name: '🐛・bug-reports', type: ChannelType.GuildText, category: 'support' },
  { key: 'feature-requests', name: '💭・feature-requests', type: ChannelType.GuildText, category: 'support' },

  { key: 'development-chat', name: '💻・development', type: ChannelType.GuildText, category: 'development' },
  { key: 'plugins', name: '🔌・plugins', type: ChannelType.GuildText, category: 'development' },
  { key: 'themes', name: '🎨・themes', type: ChannelType.GuildText, category: 'development' },
  { key: 'testing', name: '🧪・testing', type: ChannelType.GuildText, category: 'development' },
  { key: 'builds', name: '📦・builds', type: ChannelType.GuildText, category: 'development' },

  { key: 'radio-lounge', name: '🎧・Radio Lounge', type: ChannelType.GuildVoice, category: 'voice' },
  { key: 'community-voice', name: '💬・Community', type: ChannelType.GuildVoice, category: 'voice' },
  { key: 'development-voice', name: '👨‍💻・Development', type: ChannelType.GuildVoice, category: 'voice' },

  { key: 'staff', name: '🛡️・staff', type: ChannelType.GuildText, category: 'staff' },
  { key: 'mod-logs', name: '📋・mod-logs', type: ChannelType.GuildText, category: 'staff' },
  { key: 'reports', name: '🚨・reports', type: ChannelType.GuildText, category: 'staff' },
];

export const MANAGED_CHANNEL_KEYS = new Set(CHANNEL_DEFINITIONS.map((channel) => channel.key));

export const PERMISSIONS = PermissionFlagsBits;

export const REACTION_ROLE_DEFINITIONS = [
  { key: 'alpha-tester', emoji: '🧬', name: 'Alpha Tester', roleName: 'WebRadio Alpha Tester', description: 'Erhalte Hinweise auf Alpha-Releases und frühe Testversionen.' },
  { key: 'beta-tester', emoji: '🧪', name: 'Beta Tester', roleName: 'WebRadio Beta Tester', description: 'Erhalte Hinweise auf Beta-Releases und öffentliche Testversionen.' },
  { key: 'release-notifications', emoji: '🚀', name: 'Release Notifications', roleName: 'WebRadio Release Notifications', description: 'Erhalte Benachrichtigungen über neue WebRadio-Releases.' },
  { key: 'plugin-creator', emoji: '🔌', name: 'Plugin Creator', roleName: 'WebRadio Plugin Creator', description: 'Zeige, dass du Plugins für WebRadio entwickelst.' },
  { key: 'theme-creator', emoji: '🎨', name: 'Theme Creator', roleName: 'WebRadio Theme Creator', description: 'Zeige, dass du Themes für WebRadio entwickelst.' },
];
