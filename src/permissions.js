import { PermissionFlagsBits } from 'discord.js';

const P = PermissionFlagsBits;

export function buildPermissionOverwrites(guild, roles, channelKey) {
  const everyone = guild.roles.everyone.id;
  const admin = roles.get('WebRadio Admin')?.id;
  const moderator = roles.get('WebRadio Moderator')?.id;
  const developer = roles.get('WebRadio Developer')?.id;
  const contributor = roles.get('WebRadio Contributor')?.id;
  const community = roles.get('WebRadio Community')?.id;
  const bots = roles.get('Bots')?.id;
  const reactionRoles = roles.get('WebRadio Release Notifications')?.id;

  const overwrites = [];

  const add = (id, allow = [], deny = []) => {
    if (!id) return;
    overwrites.push({ id, allow, deny });
  };

  const readOnly = [P.ViewChannel, P.ReadMessageHistory];
  const staffAllow = [
    P.ViewChannel,
    P.ReadMessageHistory,
    P.SendMessages,
    P.EmbedLinks,
    P.AttachFiles,
  ];

  if (channelKey === 'staff' || channelKey === 'mod-logs' || channelKey === 'reports') {
    add(everyone, [], [P.ViewChannel]);
    add(admin, staffAllow);
    add(moderator, staffAllow);
    add(bots, staffAllow);
    return overwrites;
  }

  if (channelKey === 'roles') {
    add(everyone, [P.ViewChannel, P.ReadMessageHistory, P.AddReactions]);
    add(admin, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages, P.EmbedLinks, P.AddReactions]);
    add(moderator, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages, P.EmbedLinks, P.AddReactions]);
    add(bots, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages, P.EmbedLinks, P.AddReactions]);
    return overwrites;
  }

  if (['welcome', 'announcements', 'releases', 'roadmap', 'rules'].includes(channelKey)) {
    add(everyone, readOnly);
    add(admin, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages, P.EmbedLinks, P.AttachFiles]);
    add(moderator, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages, P.EmbedLinks, P.AttachFiles]);
    add(developer, [P.ViewChannel, P.ReadMessageHistory]);
    add(bots, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
    return overwrites;
  }

  if (channelKey === 'builds') {
    add(everyone, readOnly);
    add(community, [P.ViewChannel, P.ReadMessageHistory]);
    add(contributor, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
    add(developer, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
    add(admin, staffAllow);
    add(moderator, staffAllow);
    add(bots, staffAllow);
    return overwrites;
  }

  if (['development-chat', 'plugins', 'themes', 'testing'].includes(channelKey)) {
    add(everyone, [P.ViewChannel, P.ReadMessageHistory]);
    add(contributor, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
    add(developer, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
    add(admin, staffAllow);
    add(moderator, staffAllow);
    add(bots, staffAllow);
    return overwrites;
  }

  add(everyone, [
    P.ViewChannel,
    P.ReadMessageHistory,
    P.SendMessages,
    P.EmbedLinks,
    P.AttachFiles,
  ]);
  add(admin, staffAllow);
  add(moderator, staffAllow);
  add(developer, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles]);
  add(bots, staffAllow);

  return overwrites;
}

export function buildCategoryOverwrites(guild, roles, categoryKey) {
  if (categoryKey !== 'staff') return [];

  const everyone = guild.roles.everyone.id;
  const admin = roles.get('WebRadio Admin')?.id;
  const moderator = roles.get('WebRadio Moderator')?.id;
  const bots = roles.get('Bots')?.id;
  const reactionRoles = roles.get('WebRadio Release Notifications')?.id;

  return [
    { id: everyone, deny: [P.ViewChannel] },
    { id: admin, allow: [P.ViewChannel, P.ReadMessageHistory] },
    { id: moderator, allow: [P.ViewChannel, P.ReadMessageHistory] },
    { id: bots, allow: [P.ViewChannel, P.ReadMessageHistory] },
  ].filter((entry) => entry.id);
}
