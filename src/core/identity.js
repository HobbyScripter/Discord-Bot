export function botIdentity() {
  return {
    name: process.env.BOT_NAME || 'WebRadio Community',
    description: process.env.BOT_DESCRIPTION || 'Community Core Bot',
    profile: process.env.DEFAULT_COMMUNITY_PROFILE || 'webradio',
  };
}

export function memberIdentity(member) {
  if (!member?.user) return null;
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName || member.user.globalName || member.user.username,
    avatarUrl: member.displayAvatarURL?.({ size: 128 }) || null,
    bot: Boolean(member.user.bot),
    nickname: member.nickname || null,
    joinedAt: member.joinedAt?.toISOString?.() || null,
    roles: member.roles?.cache ? [...member.roles.cache.values()].filter(r => r.id !== member.guild.id).map(r => ({ id: r.id, name: r.name })) : [],
  };
}
