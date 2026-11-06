import { getProfile } from './profiles.js';

export class CommunityManager {
  constructor(db) { this.db = db; }
  register(guild, profileId = null) {
    let community = this.db.getCommunity(guild.id);
    if (!community) {
      const selectedProfile = getProfile(profileId || process.env.DEFAULT_COMMUNITY_PROFILE || (guild.name.toLowerCase().includes('webradio') ? 'webradio' : 'custom'));
      this.db.upsertCommunity(guild, selectedProfile.id);
      for (const [id, enabled] of Object.entries(selectedProfile.modules)) this.db.setModule(guild.id, id, enabled);
    } else {
      this.db.upsertCommunity(guild, community.profile_id);
    }
    return this.db.getCommunity(guild.id);
  }
  get(guildId) { return this.db.getCommunity(guildId); }
  list() { return this.db.listCommunities(); }
  add(guild, profileId = null) { return this.register(guild, profileId); }
  all(client) { return [...client.guilds.cache.values()].map(guild => ({ guild, config: this.register(guild) })); }
}
