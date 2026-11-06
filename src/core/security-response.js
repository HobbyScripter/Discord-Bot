const PRIVILEGED_ROLE_PERMISSION_BITS = Object.freeze([8n, 32n, 268435456n, 16n, 4n, 2n]);

const ACTIONS = Object.freeze({
  'channel.slowmode': { destructive: true, permission: 'security.respond' },
  'channel.lock': { destructive: true, permission: 'security.respond' },
  'member.quarantine': { destructive: true, permission: 'security.respond' },
  'member.timeout': { destructive: true, permission: 'security.respond' },
});

function clean(value, depth = 0) {
  if (depth > 4) throw new Error('Security-Aktionsdaten sind zu tief verschachtelt.');
  if (value === null || ['string','number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(v => clean(v, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k,v]) => [String(k).slice(0,80), clean(v, depth + 1)]));
  return String(value);
}

export class SecurityResponseManager {
  constructor({ client, db, events, audit, rbac, logger = console, confirmationsTtlMs = 10 * 60_000 } = {}) {
    this.client = client; this.db = db; this.events = events; this.audit = audit; this.rbac = rbac; this.logger = logger; this.confirmationsTtlMs = confirmationsTtlMs;
  }
  catalog() { return Object.entries(ACTIONS).map(([action,meta]) => ({ action, destructive: meta.destructive, requiresConfirmation: true, permission: meta.permission })); }
  #validate(action,args={}) {
    if (!ACTIONS[action]) throw new Error('Unbekannte Security-Aktion.');
    if (!args || typeof args !== 'object') throw new Error('Security-Aktionsdaten müssen ein Objekt sein.');
    if (action.startsWith('channel.') && !args.channelId) throw new Error('channelId ist erforderlich.');
    if (action.startsWith('member.') && !args.userId) throw new Error('userId ist erforderlich.');
    if (action === 'channel.slowmode' && (!Number.isInteger(Number(args.seconds)) || Number(args.seconds) < 0 || Number(args.seconds) > 21600)) throw new Error('seconds muss zwischen 0 und 21600 liegen.');
    if (action === 'member.timeout' && (!Number.isInteger(Number(args.durationSeconds)) || Number(args.durationSeconds) < 1 || Number(args.durationSeconds) > 2419200)) throw new Error('durationSeconds muss zwischen 1 und 2419200 liegen.');
    return clean(args);
  }
  async request({ guildId, actorId, action, args={}, reason='' }) {
    if (!actorId || !this.rbac?.can(guildId, actorId, 'security.respond')) throw new Error('Keine Berechtigung für Security-Reaktionen.');
    const safeArgs=this.#validate(action,args);
    const confirmation=this.db.createSecurityActionConfirmation(guildId,{requestedBy:actorId,action,args:safeArgs,reason:String(reason).slice(0,500),expiresAt:new Date(Date.now()+this.confirmationsTtlMs).toISOString()});
    this.audit?.recordCore(guildId,'security.response.requested',actorId,{confirmationId:confirmation.id,action,reason});
    this.events?.publish('security.response.requested',confirmation,{source:'security',communityId:guildId});
    return {executed:false,requiresConfirmation:true,confirmation};
  }
  async #execute(guildId, action, args, actorId) {
    const guild=this.client.guilds.cache.get(String(guildId));
    if(!guild) throw new Error('Community ist nicht verfügbar.');
    if(action==='channel.slowmode') {
      const channel=guild.channels.cache.get(String(args.channelId)); if(!channel?.isTextBased?.() || typeof channel.setRateLimitPerUser!=='function') throw new Error('Kanal ist nicht für Slowmode geeignet.');
      await channel.setRateLimitPerUser(Number(args.seconds),'Community Core Security Response');
      return {channelId:channel.id,seconds:Number(args.seconds)};
    }
    if(action==='channel.lock') {
      const channel=guild.channels.cache.get(String(args.channelId)); if(!channel?.permissionOverwrites?.edit) throw new Error('Kanal konnte nicht gesperrt werden.');
      await channel.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:false},{reason:'Community Core Security Response'});
      return {channelId:channel.id,locked:true};
    }
    const member=await guild.members.fetch(String(args.userId)).catch(()=>null); if(!member) throw new Error('Mitglied nicht gefunden.');
    if(action==='member.timeout') { await member.timeout(Number(args.durationSeconds)*1000,'Community Core Security Response'); return {userId:member.id,durationSeconds:Number(args.durationSeconds)}; }
    if(action==='member.quarantine') {
      const roleId=String(args.roleId||''); if(!roleId) throw new Error('roleId der Quarantäne-Rolle ist erforderlich.');
      const role=guild.roles.cache.get(roleId); if(!role) throw new Error('Quarantäne-Rolle nicht gefunden.');
      if(!role.editable) throw new Error('Quarantäne-Rolle kann vom Bot nicht verwaltet werden.');
      const elevated=PRIVILEGED_ROLE_PERMISSION_BITS;
      if(elevated.some(bit=>role.permissions.has(bit))) throw new Error('Die Quarantäne-Rolle darf keine privilegierten Verwaltungsrechte besitzen.');
      const removable=member.roles.cache.filter(r=>r.id!==guild.id && r.editable && r.id!==role.id).map(r=>r.id);
      if(removable.length) await member.roles.remove(removable,'Community Core Security Response');
      await member.roles.add(role,'Community Core Security Response');
      return {userId:member.id,roleId:role.id,removedRoles:removable.length};
    }
    throw new Error('Security-Aktion nicht implementiert.');
  }
  async confirm({ guildId, confirmationId, actorId }) {
    if(!this.rbac?.can(guildId,actorId,'security.respond')) throw new Error('Keine Berechtigung für Security-Reaktionen.');
    const request=this.db.getSecurityActionConfirmation(guildId,confirmationId); if(!request) throw new Error('Security-Bestätigung nicht gefunden.');
    if(request.status!=='pending') throw new Error('Security-Bestätigung ist nicht mehr offen.');
    if(Date.parse(request.expires_at)<=Date.now()){this.db.updateSecurityActionConfirmation(guildId,confirmationId,{status:'expired'});throw new Error('Security-Bestätigung ist abgelaufen.');}
    const result=await this.#execute(guildId,request.action,request.args,actorId);
    const updated=this.db.updateSecurityActionConfirmation(guildId,confirmationId,{status:'confirmed',confirmedBy:actorId});
    this.audit?.recordCore(guildId,'security.response.executed',actorId,{confirmationId:Number(confirmationId),action:request.action,result});
    this.events?.publish('security.response.executed',{confirmationId:Number(confirmationId),action:request.action,result,confirmedBy:actorId},{source:'security',communityId:guildId});
    return {executed:true,confirmation:updated,result};
  }
  reject({guildId,confirmationId,actorId}) {
    if(!this.rbac?.can(guildId,actorId,'security.respond')) throw new Error('Keine Berechtigung für Security-Reaktionen.');
    const request=this.db.getSecurityActionConfirmation(guildId,confirmationId); if(!request) throw new Error('Security-Bestätigung nicht gefunden.');
    if(request.status!=='pending') throw new Error('Security-Bestätigung ist nicht mehr offen.');
    const updated=this.db.updateSecurityActionConfirmation(guildId,confirmationId,{status:'rejected',confirmedBy:actorId});
    this.audit?.recordCore(guildId,'security.response.rejected',actorId,{confirmationId:Number(confirmationId),action:request.action});
    this.events?.publish('security.response.rejected',{confirmationId:Number(confirmationId),action:request.action,confirmedBy:actorId},{source:'security',communityId:guildId});
    return updated;
  }
  list(guildId,status=null){return this.db.listSecurityActionConfirmations(guildId,status);}
}
