export class ActivityTracker {
  constructor(database, logger = console, eventBus = null) {
    this.db = database;
    this.logger = logger;
    this.events = eventBus;
    this.lastCleanup = 0;
  }
  record(guild, type, userId = null, channelId = null, metadata = {}) {
    if (!guild?.id) return;
    try {
      if (userId) {
        const member = guild.members?.cache?.get?.(String(userId));
        const user = member?.user || (metadata.user ? metadata.user : null);
        if (user) this.db.upsertUser({ id: user.id, username: user.username, displayName: member?.displayName || user.globalName || user.username, avatarUrl: member?.displayAvatarURL?.({ size: 128 }) || null, bot: user.bot });
        this.db.upsertMembership(guild.id, userId, { nickname: member?.nickname || null, joinedAt: member?.joinedAt?.toISOString?.() || null, roles: member?.roles?.cache ? [...member.roles.cache.values()].filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name })) : [], lastActivityAt: new Date().toISOString() });
        this.db.touchMembershipActivity(guild.id, userId);
      }
      this.db.recordActivity(guild.id, type, userId, channelId, metadata);
      this.events?.publish?.(`activity.${type}`, { userId, channelId, metadata }, { source: 'discord', communityId: guild.id });
      if (Date.now() - this.lastCleanup > 6 * 60 * 60 * 1000) {
        this.db.cleanupActivity(30);
        this.lastCleanup = Date.now();
      }
    } catch (error) { this.logger.warn?.('⚠ Aktivität konnte nicht gespeichert werden:', error?.message || error); }
  }
  memberJoin(member) { this.record(member.guild, 'member_join', member.id, null, { bot: Boolean(member.user?.bot), accountCreatedAt: member.user?.createdAt?.toISOString?.() || null, accountAgeDays: member.user?.createdTimestamp ? Math.floor((Date.now()-member.user.createdTimestamp)/86400000) : null }); }
  memberLeave(member) { try { this.db.markMembershipLeft(member.guild.id, member.id); } catch {} this.record(member.guild, 'member_leave', member.id, null, { bot: Boolean(member.user?.bot) }); }
  message(message) {
    if (!message.guild || message.author?.bot) return;
    const content=String(message.content||''); const mentions=message.mentions?.users?.size||0; const links=(content.match(/https?:\/\//gi)||[]).length; this.record(message.guild, 'message', message.author.id, message.channelId, { channelName: message.channel?.name || null, mentions, links, length: content.length }); if(mentions>=5) this.events?.publish?.('security.signal',{kind:'mass_mention',userId:message.author.id,mentions},{source:'discord',communityId:message.guild.id}); if(links>=3) this.events?.publish?.('security.signal',{kind:'link_burst',userId:message.author.id,links},{source:'discord',communityId:message.guild.id});
  }
  reaction(reaction, user, added) {
    const guild = reaction.message?.guild;
    if (!guild || user?.bot) return;
    this.record(guild, added ? 'reaction_add' : 'reaction_remove', user.id, reaction.message.channelId, { emoji: reaction.emoji?.name || reaction.emoji?.id || null });
  }
  voice(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const oldChannel = oldState.channelId, newChannel = newState.channelId;
    if (!guild || oldChannel === newChannel) return;
    this.record(guild, 'voice_change', newState.id, newChannel, { from: oldChannel, to: newChannel });
  }
}
