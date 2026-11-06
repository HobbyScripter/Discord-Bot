const TOOL_DEFS = Object.freeze({
  'discord.get-channel': { destructive: false },
  'discord.get-member': { destructive: false },
  'discord.send-message': { destructive: true },
  'discord.set-slowmode': { destructive: true },
  'discord.lock-channel': { destructive: true },
});

function clean(value, depth = 0) {
  if (depth > 5) throw new Error('Tool payload too deeply nested.');
  if (value === null || ['string','number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => clean(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value).slice(0, 50)) out[String(k).slice(0,100)] = clean(v, depth + 1);
    return out;
  }
  return String(value);
}

export class DiscordToolGateway {
  constructor({ client, db, events, audit, rbac, logger = console, confirmationsTtlMs = 10 * 60_000 }) {
    this.client = client; this.db = db; this.events = events; this.audit = audit; this.rbac = rbac; this.logger = logger; this.confirmationsTtlMs = confirmationsTtlMs;
  }
  catalog() { return Object.entries(TOOL_DEFS).map(([name, meta]) => ({ name, destructive: meta.destructive, requiresConfirmation: meta.destructive })); }
  #allowed(guildId, userId, tool) {
    if (!this.rbac?.can(guildId, userId, 'ai.tools.use')) return false;
    if (TOOL_DEFS[tool]?.destructive && !this.rbac?.can(guildId, userId, 'ai.tools.execute')) return false;
    return true;
  }
  #validate(tool, args = {}) {
    if (!TOOL_DEFS[tool]) throw new Error('Unbekanntes Discord-Tool.');
    if (!args || typeof args !== 'object') throw new Error('Tool-Argumente müssen ein Objekt sein.');
    if (tool === 'discord.send-message' && (!args.channelId || !String(args.content || '').trim())) throw new Error('channelId und content sind erforderlich.');
    if (['discord.set-slowmode','discord.lock-channel'].includes(tool) && !args.channelId) throw new Error('channelId ist erforderlich.');
    if (tool === 'discord.set-slowmode' && (!Number.isInteger(Number(args.seconds)) || Number(args.seconds) < 0 || Number(args.seconds) > 21600)) throw new Error('seconds muss zwischen 0 und 21600 liegen.');
    return clean(args);
  }
  async #execute(guildId, tool, args) {
    const guild = this.client.guilds.cache.get(String(guildId));
    if (!guild) throw new Error('Community ist nicht verfügbar.');
    if (tool === 'discord.get-channel') { const c = guild.channels.cache.get(String(args.channelId)); if (!c) throw new Error('Kanal nicht gefunden.'); return { id:c.id,name:c.name,type:c.type,rateLimitPerUser:c.rateLimitPerUser||0 }; }
    if (tool === 'discord.get-member') { const m = guild.members.cache.get(String(args.userId)); if (!m) throw new Error('Mitglied nicht im Cache.'); return { id:m.id,username:m.user.username,displayName:m.displayName,roles:m.roles.cache.filter(r=>r.id!==guild.id).map(r=>({id:r.id,name:r.name})) }; }
    const channel = guild.channels.cache.get(String(args.channelId));
    if (!channel?.isTextBased?.()) throw new Error('Kanal nicht gefunden oder nicht textbasiert.');
    if (tool === 'discord.send-message') { const content = String(args.content).slice(0, 4000); const msg = await channel.send({ content }); return { id:msg.id, channelId:channel.id }; }
    if (tool === 'discord.set-slowmode') { await channel.setRateLimitPerUser(Number(args.seconds), 'Community Core tool'); return { channelId:channel.id, seconds:Number(args.seconds) }; }
    if (tool === 'discord.lock-channel') { const everyone = guild.roles.everyone; await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason:'Community Core tool' }); return { channelId:channel.id, locked:true }; }
    throw new Error('Tool execution not implemented.');
  }
  async request({ guildId, userId, tool, args = {}, reason = '' }) {
    if (!this.#allowed(guildId,userId,tool)) throw new Error('Keine Berechtigung für dieses Discord-Tool.');
    const safeArgs = this.#validate(tool,args); const destructive = TOOL_DEFS[tool].destructive;
    if (!destructive) return { executed:true, result:await this.#execute(guildId,tool,safeArgs) };
    const request = this.db.createToolConfirmation(guildId,{ userId, tool, args:safeArgs, reason:String(reason).slice(0,500), expiresAt:new Date(Date.now()+this.confirmationsTtlMs).toISOString() });
    this.audit?.recordCore(guildId,'ai.tool.confirmation.requested',userId,{confirmationId:request.id,tool,reason});
    this.events?.publish('ai.tool.confirmation.requested',request,{source:'ai',communityId:guildId});
    return { executed:false, requiresConfirmation:true, confirmation:request };
  }
  async confirm({ guildId, confirmationId, actorId }) {
    const request = this.db.getToolConfirmation(guildId,confirmationId);
    if (!request) throw new Error('Bestätigungsanfrage nicht gefunden.');
    if (request.status !== 'pending') throw new Error(`Bestätigungsanfrage ist bereits ${request.status}.`);
    if (Date.parse(request.expires_at) <= Date.now()) { this.db.updateToolConfirmation(guildId,confirmationId,{status:'expired'}); throw new Error('Bestätigungsanfrage ist abgelaufen.'); }
    if (!this.rbac?.can(guildId,actorId,'ai.tools.execute')) throw new Error('Keine Berechtigung zur Ausführung von Discord-Tools.');
    const result = await this.#execute(guildId,request.tool,request.args);
    this.db.updateToolConfirmation(guildId,confirmationId,{status:'executed',confirmedBy:actorId});
    this.audit?.recordCore(guildId,'ai.tool.executed',actorId,{confirmationId,tool:request.tool,args:request.args});
    this.events?.publish('ai.tool.executed',{confirmationId,tool:request.tool,actorId,result},{source:'ai',communityId:guildId});
    return { executed:true,result,confirmation:this.db.getToolConfirmation(guildId,confirmationId) };
  }
  async reject({ guildId, confirmationId, actorId }) {
    const request=this.db.getToolConfirmation(guildId,confirmationId); if(!request) throw new Error('Bestätigungsanfrage nicht gefunden.');
    if(!this.rbac?.can(guildId,actorId,'ai.tools.execute')) throw new Error('Keine Berechtigung.');
    this.db.updateToolConfirmation(guildId,confirmationId,{status:'rejected',confirmedBy:actorId});
    this.audit?.recordCore(guildId,'ai.tool.confirmation.rejected',actorId,{confirmationId,tool:request.tool});
    this.events?.publish('ai.tool.confirmation.rejected',{confirmationId,tool:request.tool,actorId},{source:'ai',communityId:guildId});
    return this.db.getToolConfirmation(guildId,confirmationId);
  }
  list(guildId) { return this.db.listToolConfirmations(guildId); }
}
