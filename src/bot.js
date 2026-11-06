import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials, MessageFlags } from 'discord.js';
import { registerCommands, handleCommand, startGitHubPolling, syncGitHub } from './discord-bot.js';
import { initializeReactionRoles, handleReactionRole } from './reaction-roles.js';
import { sendWelcomeMessage } from './welcome.js';
import { dashboardLogger, startDashboard, setDashboardState } from './dashboard.js';
import { runSetup } from './setup.js';
import { ensureRoles } from './roles.js';
import { ensureChannels, ensureCategories } from './channels.js';
import { configureCommunityOnboarding } from './onboarding.js';
import { CommunityDatabase } from './core/database.js';
import { CommunityManager } from './core/community-manager.js';
import { ModuleManager } from './core/module-manager.js';
import { getProfile } from './core/profiles.js';
import { botIdentity, memberIdentity } from './core/identity.js';
import { AuditManager } from './core/audit.js';
import { ExternalModuleLoader } from './core/module-loader.js';
import { createAIProvider } from './ai/provider.js';
import { ActivityTracker } from './core/activity.js';
import { CoreEventBus } from './core/event-bus.js';
import { SecurityEngine } from './core/security.js';
import { SecurityResponseManager } from './core/security-response.js';
import { TicketManager } from './core/tickets.js';
import { RBACManager } from './core/rbac.js';
import { IncidentManager } from './core/incidents.js';
import { AutomationEngine } from './core/automation-engine.js';
import { AIProviderManager } from './ai/provider-manager.js';
import { AIAgent } from './ai/agent.js';
import { AIAgentOperations } from './ai/agent-operations.js';
import { SupportWorkflow } from './core/support-workflow.js';
import { DiscordToolGateway } from './core/discord-tools.js';
import { CoreOrchestrator } from './core/orchestrator.js';
import { OperationsManager } from './core/operations.js';
import { SupportOperations } from './core/support-operations.js';
import { SupportIntelligence } from './core/support-intelligence.js';
import { createCommunityCoreAPI } from './core/api-v1.js';
import { runReleaseReadiness } from './core/release-readiness.js';

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN muss gesetzt sein. DISCORD_GUILD_ID ist optional; ohne Angabe werden alle erreichbaren Communities verwaltet.');
const database = new CommunityDatabase();
const events = new CoreEventBus({ logger: dashboardLogger });
const communityManager = new CommunityManager(database);
const moduleManager = new ModuleManager(database);
const externalModules = new ExternalModuleLoader(undefined, { logger: dashboardLogger });
await externalModules.discover();
const coreApi = createCommunityCoreAPI({ database, events, communityManager, moduleManager, logger: dashboardLogger, capabilities: { identity: true, rbac: true, security: true, support: true, ai: true, automation: true, operations: true } });
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});
let aiProvider = await createAIProvider();
const activity = new ActivityTracker(database, dashboardLogger, events);
const audit = new AuditManager(database, events, dashboardLogger);
const security = new SecurityEngine(database, events, dashboardLogger);
const securityResponse = new SecurityResponseManager({ client, db: database, events, audit, rbac: null, logger: dashboardLogger });
const tickets = new TicketManager(database, events, dashboardLogger);
const rbac = new RBACManager(database, events, audit, dashboardLogger);
securityResponse.rbac = rbac;
const incidents = new IncidentManager(database, events, audit, dashboardLogger);
const aiProviders = new AIProviderManager(database, events, audit, dashboardLogger);
const discordTools = new DiscordToolGateway({ client, db: database, events, audit, rbac, logger: dashboardLogger });
const agentOperations = new AIAgentOperations({ db: database, events, audit, logger: dashboardLogger });
const aiAgent = new AIAgent(database, events, audit, aiProviders, rbac, dashboardLogger, discordTools, agentOperations);
const supportWorkflow = new SupportWorkflow({ db: database, tickets, aiAgent, rbac, audit, events, logger: dashboardLogger });
const orchestrator = new CoreOrchestrator({ events, incidents, tickets, audit, logger: dashboardLogger });
const operations = new OperationsManager({ db: database, events, security, tickets, incidents, logger: dashboardLogger });
const supportOperations = new SupportOperations({ db: database, tickets, events, audit, logger: dashboardLogger });
const supportIntelligence = new SupportIntelligence({ db: database, tickets, incidents, supportWorkflow, aiAgent, rbac, events, audit, logger: dashboardLogger });
const automationEngine = new AutomationEngine(database, events, audit, {
  'incident.create': async (guildId, action) => incidents.create(guildId, action.data || {}, null),
  'ticket.create': async (guildId, action) => tickets.create(guildId, action.data || {}),
  'security.evaluate': async (guildId) => security.evaluate(guildId),
  'security.create-incident': async (guildId, action) => {
    const current = security.snapshot(guildId);
    return incidents.create(guildId, {
      title: action.title || `Security ${String(current.level).toUpperCase()}`,
      severity: action.severity || current.level, type: 'security',
      summary: action.summary || current.recommendation || 'Security-Risiko erkannt',
      payload: { score: current.score, signals: current.signals || [], metrics: current.metrics || {} }
    }, null);
  },
}, dashboardLogger);
const securityIncidentCooldown = new Map();

events.subscribe((event) => {
  if (event.type !== 'security.risk.changed' || !event.communityId) return;
  if (!['high','critical'].includes(event.payload?.level)) return;
  const key = event.communityId;
  const now = Date.now();
  if ((securityIncidentCooldown.get(key) || 0) > now) return;
  securityIncidentCooldown.set(key, now + 5 * 60_000);
  try {
    incidents.create(key, {
      title: `Security ${String(event.payload.level).toUpperCase()}`,
      severity: event.payload.level,
      type: 'security',
      summary: event.payload.recommendation || 'Security-Risiko erkannt',
      payload: { score: event.payload.score, signals: event.payload.signals || [], metrics: event.payload.metrics || {} }
    });
  } catch (error) { dashboardLogger.warn('⚠ Security-Incident konnte nicht erstellt werden:', error?.message || error); }
});


let targetGuild = null;
let dashboardStarted = false;
const githubPolling = new Map();
client.on(Events.ClientDestroyed, () => { githubPolling.clear(); setDashboardState({ ready: false }); events.publish('bot.connection.changed', { ready: false }, { source: 'discord', communityId: targetGuild?.id || null }); });

async function initializeGuild(readyClient, guildId = null) {
  const guild = guildId ? await readyClient.guilds.fetch(guildId) : null;
  if (!guild) return;
  targetGuild = guild;
  const community = communityManager.register(guild);
  try {
    const members = guild.members?.cache ? [...guild.members.cache.values()] : [];
    for (const member of members) {
      const identity = memberIdentity(member);
      if (identity) { database.upsertUser(identity); database.upsertMembership(guild.id, member.id, { nickname: identity.nickname, joinedAt: identity.joinedAt, roles: identity.roles, staff: Boolean(member.permissions?.has?.('Administrator')) }); }
    }
  } catch (error) { dashboardLogger.warn('⚠ Benutzer-Snapshot konnte nicht vollständig synchronisiert werden:', error?.message || error); }
  await audit.syncGuild(guild, { pages: Number(process.env.DISCORD_AUDIT_SYNC_PAGES || 5) });
  const profile = getProfile(community.profile_id);
  security.schedule(guild.id);
  await registerCommands(readyClient, guild);
  if (moduleManager.list(guild.id).find(m => m.moduleId === 'reactionRoles')?.enabled) await initializeReactionRoles(guild, { database, logger: dashboardLogger });
  if (profile.modules.releases && !githubPolling.has(guild.id)) {
    githubPolling.set(guild.id, startGitHubPolling(readyClient, guild, { database, logger: dashboardLogger }));
  }
  setDashboardState({ ready: readyClient.isReady(), guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount }, community, identity: { ...botIdentity(), aiProvider: aiProvider.provider, aiConfigured: aiProvider.enabled, aiEnabled: database.isAIEnabled(guild.id) }, ai: { provider: aiProvider.provider, configured: aiProvider.enabled, enabled: database.isAIEnabled(guild.id) }, user: { id: readyClient.user.id, tag: readyClient.user.tag } });
  await externalModules.initialize({ api: coreApi, guildIds: [guild.id], logger: dashboardLogger });

  if (!dashboardStarted) {
    dashboardStarted = true;
    startDashboard({
      client: readyClient,
      eventBus: events,
      guild,
      database,
      actions: {
        releaseReadiness: async () => runReleaseReadiness({ database, events, api: coreApi, moduleManager }),
        sync: async (selectedGuild = guild) => syncGitHub(selectedGuild, { database, logger: dashboardLogger }),
        reactionRoles: async (selectedGuild = guild) => initializeReactionRoles(selectedGuild, { database, force: true, logger: dashboardLogger }),
        setup: async (selectedGuild = guild) => runSetup(selectedGuild, { force: true, logger: dashboardLogger }),
        onboarding: async (selectedGuild = guild) => {
          const roles = await ensureRoles(selectedGuild, { logger: dashboardLogger });
          const categories = await ensureCategories(selectedGuild, roles, { logger: dashboardLogger });
          const channels = await ensureChannels(selectedGuild, roles, categories, { logger: dashboardLogger });
          return configureCommunityOnboarding(selectedGuild, { channels, roles, logger: dashboardLogger });
        },
        botStart: async () => {
          if (client.isReady()) return { started: false, reason: 'already-online' };
          dashboardLogger.info('▶ Bot-Verbindung wird wiederhergestellt.');
          try { await client.login(process.env.DISCORD_TOKEN); return { started: true }; }
          catch (error) { dashboardLogger.error('❌ Bot-Start fehlgeschlagen:', error?.name === 'TokenInvalid' ? 'Ungültiger Discord-Token.' : error?.message || error); throw error; }
        },
        botRestart: async () => {
          dashboardLogger.warn('↻ Bot-Neustart über Control Center angefordert.');
          try { client.destroy(); } catch {}
          setTimeout(async () => {
            try { await client.login(process.env.DISCORD_TOKEN); dashboardLogger.info('✓ Bot-Neustart abgeschlossen.'); }
            catch (error) { dashboardLogger.error('❌ Bot-Neustart fehlgeschlagen:', error?.name === 'TokenInvalid' ? 'Ungültiger Discord-Token.' : error?.message || error); }
          }, 1200);
          return { scheduled: true, action: 'restart' };
        },
        listCommunities: async () => communityManager.all(readyClient).map(({guild,config}) => ({ id:guild.id,name:guild.name,memberCount:guild.memberCount,profileId:config.profile_id,enabled:Boolean(config.enabled),features:guild.features })),
        addCommunity: async (guildId, profileId) => {
          const g = readyClient.guilds.cache.get(String(guildId));
          if (!g) throw new Error('Community nicht gefunden. Der Bot muss bereits Mitglied des Servers sein.');
          const config = communityManager.add(g, profileId);
          return { id:g.id, name:g.name, memberCount:g.memberCount, profileId:config.profile_id, enabled:Boolean(config.enabled) };
        },
        removeCommunity: async (guildId) => {
          const g = readyClient.guilds.cache.get(String(guildId));
          if (!g) throw new Error('Community nicht gefunden.');
          database.setSetting(g.id, 'community.enabled', false);
          return database.getCommunity(g.id);
        },
        getCommunity: async (guildId) => { const g=readyClient.guilds.cache.get(guildId); if(!g) throw new Error('Community nicht gefunden.'); return { guild:{id:g.id,name:g.name,memberCount:g.memberCount}, config:communityManager.register(g), modules:moduleManager.list(g.id), profile:getProfile(communityManager.register(g).profile_id) }; },
        setCommunityProfile: async (guildId, profileId) => { const g=readyClient.guilds.cache.get(guildId); if(!g) throw new Error('Community nicht gefunden.'); communityManager.register(g); const profile=getProfile(profileId); database.setProfile(g.id,profile.id); for(const [id,enabled] of Object.entries(profile.modules)) database.setModule(g.id,id,enabled); return {config:database.getCommunity(g.id),modules:moduleManager.list(g.id),profile}; },
        getRules: async (guildId) => database.getRules(guildId),
        setRules: async (guildId, rules) => { communityManager.register(readyClient.guilds.cache.get(guildId)); return database.setRules(guildId, rules); },
        setModule: async (guildId,moduleId,enabled,config={}) => moduleManager.set(guildId,moduleId,enabled,config),
        externalModules: async () => externalModules.list(),
        coreApiMeta: async () => coreApi.meta(),
        aiProviderConfig: async () => aiProviders.config(targetGuild?.id || null),
        audit: async (guildId, limit=100, source=null) => database.listAudit(guildId, limit, source),
        auditAction: async (guildId, type, actorId, payload={}) => audit.recordCore(guildId, type, actorId, payload),
        users: async (guildId, limit=200) => database.listUsers(guildId, limit),
        userProfile: async (guildId, userId) => database.getUserProfile(guildId, userId),
        staffOverview: async (guildId) => database.staffOverview(guildId),
        staffStatus: async (guildId) => database.listStaffStatus(guildId),
        setStaffStatus: async (guildId, userId, status, note='') => { const result=database.setStaffStatus(guildId,userId,status,note); audit.recordCore(guildId,'staff.status.changed',userId,{status:result.status,note:result.note}); return result; },
        staffGroups: async (guildId) => database.listStaffGroups(guildId),
        saveStaffGroup: async (guildId,data) => { const id=database.saveStaffGroup(guildId,data); audit.recordCore(guildId,'staff.group.saved',null,{id,name:data.name}); events.publish('staff.group.changed',{id,name:data.name},{source:'dashboard',communityId:guildId}); return database.listStaffGroups(guildId); },
        deleteStaffGroup: async (guildId,id) => { database.deleteStaffGroup(guildId,id); audit.recordCore(guildId,'staff.group.deleted',null,{id:Number(id)}); events.publish('staff.group.changed',{id:Number(id),deleted:true},{source:'dashboard',communityId:guildId}); return database.listStaffGroups(guildId); },
        addStaffMember: async (guildId,userId) => { const g=await readyClient.guilds.fetch(String(guildId)); const member=await g.members.fetch(String(userId)).catch(()=>null); if(!member) throw new Error('Discord-Mitglied nicht gefunden. Prüfe die User-ID und ob der Nutzer auf diesem Server ist.'); const identity=memberIdentity(member); if(identity){database.upsertUser(identity);database.upsertMembership(g.id,member.id,{nickname:identity.nickname,joinedAt:identity.joinedAt,roles:identity.roles,staff:true});} else database.setStaffMember(g.id,member.id,true); const result=database.setStaffMember(g.id,member.id,true); audit.recordCore(g.id,'staff.member.added',null,{userId:member.id}); events.publish('staff.member.changed',result,{source:'dashboard',communityId:g.id}); return result; },
        removeStaffMember: async (guildId,userId) => { const result=database.setStaffMember(guildId,userId,false); audit.recordCore(guildId,'staff.member.removed',null,{userId:String(userId)}); events.publish('staff.member.changed',result,{source:'dashboard',communityId:guildId}); return result; },
        setStaffGroupMember: async (guildId,groupId,userId,add=true) => { const result=database.setStaffGroupMember(guildId,groupId,userId,add); events.publish('staff.group.member.changed',result,{source:'dashboard',communityId:guildId}); return result; },
        setAIProvider: async (config) => {
          const provider = String(config.provider || 'none').toLowerCase();
          const baseUrl = String(config.baseUrl || '').trim();
          const model = String(config.model || '').trim();
          const apiKey = config.apiKey === undefined || config.apiKey === '********' ? (process.env.AI_API_KEY || '') : String(config.apiKey || '');
          process.env.AI_PROVIDER = provider; process.env.AI_BASE_URL = baseUrl; process.env.AI_MODEL = model; process.env.AI_API_KEY = apiKey;
          await (async()=>{
            const fs = await import('node:fs/promises');
            let env=''; try { env=await fs.readFile('.env','utf8'); } catch {}
            const set=(text,key,value)=>{ const line=`${key}=${String(value).replace(/\n/g,'')}`; const re=new RegExp(`^${key}=.*$`,'m'); return re.test(text)?text.replace(re,line):`${text.trimEnd()}\n${line}\n`; };
            for (const [k,v] of [['AI_PROVIDER',provider],['AI_BASE_URL',baseUrl],['AI_MODEL',model],['AI_API_KEY',apiKey]]) env=set(env,k,v);
            await fs.writeFile('.env',env,'utf8');
          })();
          aiProvider = await createAIProvider({provider,baseUrl,model,apiKey});
          if (targetGuild?.id) aiProviders.save(targetGuild.id, { provider, baseUrl, model, apiKey });
          if (targetGuild?.id) audit.recordCore(targetGuild.id, 'ai.provider.changed', null, { provider, baseUrl, model, apiKeyConfigured: Boolean(apiKey) });
          setDashboardState({ ai: { provider: aiProvider.provider, configured: aiProvider.enabled, enabled: targetGuild ? database.isAIEnabled(targetGuild.id) : false } });
          return { provider: aiProvider.provider, baseUrl: aiProvider.baseUrl || '', model: aiProvider.model || '', apiKeyConfigured: Boolean(aiProvider.apiKey), configured: aiProvider.enabled };
        },
        aiState: async (guildId) => ({ configured: aiProvider.enabled, provider: aiProvider.provider, model: aiProvider.model || null, endpoint: aiProvider.baseUrl || null, supportsTools: Boolean(aiProvider.supportsTools), enabled: database.isAIEnabled(guildId), canEnable: aiProvider.enabled }),
        aiProviderTest: async () => aiProvider.health(),
        setAIEnabled: async (guildId, enabled) => {
          if (enabled && !aiProvider.enabled) throw new Error('KI ist noch nicht konfiguriert. Erst AI_PROVIDER und AI_MODEL einrichten.');
          database.setAIEnabled(guildId, enabled);
          audit.recordCore(guildId, 'ai.enabled.changed', null, { enabled: Boolean(enabled), provider: aiProvider.provider });
          const state = { configured: aiProvider.enabled, provider: aiProvider.provider, model: aiProvider.model || null, endpoint: aiProvider.baseUrl || null, supportsTools: Boolean(aiProvider.supportsTools), enabled: database.isAIEnabled(guildId), canEnable: aiProvider.enabled };
          setDashboardState({ ai: state, identity: { ...botIdentity(), aiProvider: aiProvider.provider, aiConfigured: aiProvider.enabled, aiEnabled: state.enabled } });
          return state;
        },
        ai: async (guildId, messages, meta = {}) => {
          if (!database.isAIEnabled(guildId)) return { provider: aiProvider.provider, configured: aiProvider.enabled, enabled: false, conversationId: null, content: 'Die Community-KI ist für diese Community derzeit deaktiviert. Aktiviere sie zuerst im Dashboard unter AI Assistant.' };
          const conversation = messages?.map(m=>({role:m.role,content:m.content})) || [];
          let conversationId = meta.conversationId ? Number(meta.conversationId) : null;
          if (!conversationId) conversationId = database.addAIConversation(guildId, meta.userId || null, meta.title || 'AI Chat');
          const last = conversation.at(-1);
          if (last?.role === 'user') database.addAIMessage(guildId, conversationId, 'user', last.content);
          const result = { provider: aiProvider.provider, enabled: aiProvider.enabled, conversationId };
          result.content = aiProviders.config(guildId).configured ? await aiProviders.chat(guildId, conversation) : 'Kein KI-Provider konfiguriert. Konfiguriere einen Provider für diese Community.';
          if (result.content) database.addAIMessage(guildId, conversationId, 'assistant', result.content);
          return result;
        },
        activity: async (guildId, windowMinutes=60) => database.activitySummary(guildId, windowMinutes),
        activityTrend: async (guildId,minutes=1440,bucket=60) => database.activityTrend(guildId,minutes,bucket),
        activityLeaderboard: async (guildId,minutes=1440,limit=10) => database.activityLeaderboard(guildId,minutes,limit),
        security: async (guildId) => security.snapshot(guildId),
        securityHistory: async (guildId, options={}) => database.securityHistory(guildId, options),
        securityActions: async (guildId, status=null) => securityResponse.list(guildId, status),
        securityActionCatalog: async () => securityResponse.catalog(),
        requestSecurityAction: async (guildId, actorId, action, args, reason='') => securityResponse.request({guildId,actorId,action,args,reason}),
        confirmSecurityAction: async (guildId, confirmationId, actorId) => securityResponse.confirm({guildId,confirmationId,actorId}),
        rejectSecurityAction: async (guildId, confirmationId, actorId) => securityResponse.reject({guildId,confirmationId,actorId}),
        tickets: async (guildId) => tickets.list(guildId),
        rbacRoles: async (guildId) => rbac.list(guildId),
        rbacDefinitions: async (guildId) => rbac.listRoleDefinitions(guildId),
        rbacCatalog: async () => rbac.permissionCatalog(),
        rbacPermissions: async (guildId,userId) => rbac.permissionsFor(guildId,userId),
        setCoreRole: async (guildId,userId,role,actorId=null) => rbac.setRole(guildId,userId,role,actorId),
        saveRBACRole: async (guildId,data,actorId=null) => rbac.saveRole(guildId,data,actorId),
        deleteRBACRole: async (guildId,role,actorId=null) => rbac.deleteRole(guildId,role,actorId),
        incidents: async (guildId) => incidents.list(guildId),
        incident: async (guildId,id) => incidents.get(guildId,id),
        incidentTimeline: async (guildId,id) => incidents.timeline(guildId,id),
        createIncident: async (guildId,data,actorId=null) => incidents.create(guildId,data,actorId),
        updateIncident: async (guildId,id,data,actorId=null) => incidents.update(guildId,id,data,actorId),
        assignIncident: async (guildId,id,userId,actorId=null) => incidents.assign(guildId,id,userId,actorId),
        resolveIncident: async (guildId,id,actorId=null,resolution='') => incidents.resolve(guildId,id,actorId,resolution),
        closeIncident: async (guildId,id,actorId=null) => incidents.close(guildId,id,actorId),
        addIncidentNote: async (guildId,id,actorId,message,kind='note',payload={}) => incidents.addNote(guildId,id,actorId,message,kind,payload),
        aiIncidentAnalysis: async (guildId,userId,incidentId) => aiAgent.analyzeIncident(guildId,userId,incidentId),
        automationStatus: async () => automationEngine.status(),
        automations: async (guildId) => database.listAutomations(guildId),
        automationRuns: async (guildId, options={}) => database.automationRuns(guildId, options),
        automationStats: async (guildId) => database.automationStats(guildId),
        saveAutomation: async (guildId, data) => { database.saveAutomation(guildId, data); audit.recordCore(guildId, 'automation.changed', data.actorId || null, { jobId: data.id || null, name: data.name, enabled: Boolean(data.enabled) }); events.publish('automation.changed', { jobId: data.id || null, name: data.name, enabled: Boolean(data.enabled) }, { source: 'dashboard', communityId: guildId }); return database.listAutomations(guildId); },
        deleteAutomation: async (guildId, id, actorId=null) => { database.deleteAutomation(guildId, Number(id)); audit.recordCore(guildId, 'automation.deleted', actorId, { jobId: Number(id) }); events.publish('automation.deleted', { jobId: Number(id) }, { source: 'dashboard', communityId: guildId }); return database.listAutomations(guildId); },
        aiProviders: async () => aiProviders.catalog(),
        aiProviderConfigs: async (guildId) => aiProviders.config(guildId),
        saveAIProvider: async (guildId,data) => aiProviders.save(guildId,data),
        aiProviderFallbacks: async (guildId) => aiProviders.config(guildId).fallbacks || [],
        saveAIProviderFallback: async (guildId,data) => aiProviders.saveFallback(guildId,data),
        deleteAIProviderFallback: async (guildId,slotId) => aiProviders.deleteFallback(guildId,slotId),
        aiModels: async (guildId) => aiProviders.models(guildId),
        aiFeatures: async (guildId) => { const defaults={assistant:true,ticket_analysis:true,incident_analysis:true,knowledge:true,security_analysis:true,discord_tools:true}; const settings=database.getSettings(guildId); return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,settings[`ai.feature.${k}`]===undefined?v:Boolean(settings[`ai.feature.${k}`])])); },
        setAIFeature: async (guildId,key,enabled,actorId=null) => { const allowed=new Set(['assistant','ticket_analysis','incident_analysis','knowledge','security_analysis','discord_tools']); if(!allowed.has(String(key))) throw new Error('Unbekanntes AI-Feature.'); if(!database.isAIEnabled(guildId) && enabled) throw new Error('Globale Community-KI ist deaktiviert.'); database.setSetting(guildId,`ai.feature.${key}`,Boolean(enabled)); audit.recordCore(guildId,'ai.feature.changed',actorId,{feature:key,enabled:Boolean(enabled)}); events.publish('ai.feature.changed',{feature:key,enabled:Boolean(enabled)},{source:'ai',communityId:guildId}); return Object.fromEntries(['assistant','ticket_analysis','incident_analysis','knowledge','security_analysis','discord_tools'].map(k=>[k,database.getSettings(guildId)[`ai.feature.${k}`] !== false])); },
        aiAgentChat: async (guildId,userId,messages,sessionId=null) => aiAgent.chat(guildId,userId,messages,sessionId),
        aiAgentContext: async (guildId,userId,query='',sessionId=null) => aiAgent.inspect(guildId,userId,query,sessionId),
        aiAgentTools: async (guildId,userId) => aiAgent.toolCatalog(guildId,userId),
        aiAgentToolRequest: async (guildId,userId,tool,args={},reason='',sessionId=null) => aiAgent.requestTool(guildId,userId,tool,args,reason,sessionId),
        aiAgentSessions: async (guildId,options={}) => agentOperations.listSessions(guildId,options),
        aiAgentSession: async (guildId,id) => agentOperations.session(guildId,id),
        aiAgentRuns: async (guildId,options={}) => agentOperations.runs(guildId,options),
        aiAgentMetrics: async (guildId) => agentOperations.metrics(guildId),
        aiAgentCreateSession: async (guildId,userId,title='AI Agent Session') => agentOperations.createSession(guildId,userId,title),
        aiTicketAnalysis: async (guildId,userId,ticketId) => aiAgent.analyzeTicket(guildId,userId,ticketId),
        supportTriage: async (guildId,userId,ticketId) => supportWorkflow.triage(guildId,userId,ticketId),
        createSupportTicket: async (guildId,userId,data) => supportWorkflow.createFromConversation(guildId,userId,data),
        supportHandoff: async (guildId,actorId,ticketId,data) => supportWorkflow.handoff(guildId,actorId,ticketId,data),
        supportOverview: async (guildId) => supportOperations.overview(guildId),
        supportSLA: async (guildId) => supportOperations.sla(guildId),
        saveSupportSLA: async (guildId,rows,actorId=null) => supportOperations.saveSLA(guildId,rows,actorId),
        knowledgeFeedback: async (guildId,data) => supportOperations.knowledgeFeedback(guildId,data),
        knowledgeFeedbackStats: async (guildId,documentId=null) => supportOperations.knowledgeStats(guildId,documentId),
        supportCase: async (guildId,ticketId) => supportIntelligence.caseOverview(guildId,Number(ticketId)),
        supportSLAEvaluate: async (guildId) => supportIntelligence.evaluateSLA(guildId),
        supportLinkIncident: async (guildId,ticketId,incidentId,actorId=null) => supportIntelligence.linkTicketIncident(guildId,Number(ticketId),Number(incidentId),actorId),
        supportTriageRoute: async (guildId,userId,ticketId) => supportIntelligence.triageAndRoute(guildId,String(userId),Number(ticketId)),
        discordTools: async () => discordTools.catalog(),
        toolConfirmations: async (guildId) => discordTools.list(guildId),
        toolConfirmation: async (guildId,id) => database.getToolConfirmation(guildId,Number(id)),
        requestDiscordTool: async (guildId,userId,tool,args,reason='') => discordTools.request({guildId,userId,tool,args,reason}),
        confirmDiscordTool: async (guildId,confirmationId,actorId) => discordTools.confirm({guildId,confirmationId,actorId}),
        rejectDiscordTool: async (guildId,confirmationId,actorId) => discordTools.reject({guildId,confirmationId,actorId}),
        knowledgeSearch: async (guildId,q) => database.searchKnowledgeRanked(guildId,q),
        ticketQueue: async (guildId) => tickets.queue(guildId),
        operationsSnapshot: async (guildId) => operations.snapshot(guildId),
        operationsCenter: async (guildId) => operations.commandCenter(guildId),
        operationsTimeline: async (guildId, options={}) => operations.timeline(guildId, options),
        operationsSearch: async (guildId, query, options={}) => operations.search(guildId, query, options),
        staffStatus: async (guildId) => database.listStaffStatus(guildId),
        setStaffStatus: async (guildId,userId,status,note='') => { const result=database.setStaffStatus(guildId,userId,status,note); audit.recordCore(guildId,'staff.status.changed',userId,result); events.publish('staff.status.changed',result,{source:'staff',communityId:guildId}); return result; },
        createTicket: async (guildId, data) => tickets.create(guildId,data),
        updateTicket: async (guildId,id,data) => tickets.update(guildId,id,data),
        ticketMessages: async (guildId,id) => database.listTicketMessages(guildId,id),
        addTicketMessage: async (guildId,id,data) => tickets.addMessage(guildId,id,data.userId||null,data.role||'staff',data.content||''),
        aiConversations: async (guildId) => database.listAIConversations(guildId),
        aiConversation: async (guildId,conversationId) => database.getAIConversation(guildId,Number(conversationId)),
        aiMessages: async (guildId,conversationId) => database.listAIMessages(guildId,Number(conversationId)),
        memories: async (guildId) => database.listMemories(guildId),
        setMemory: async (guildId, key, value) => { database.setMemory(guildId, key, value); return database.listMemories(guildId); },
        deleteMemory: async (guildId, key) => { database.deleteMemory(guildId, key); return database.listMemories(guildId); },
        knowledge: async (guildId) => database.listKnowledge(guildId),
        saveKnowledge: async (guildId, data) => { database.upsertKnowledge(guildId, data.id, data.title, data.content, data.tags || ''); return database.listKnowledge(guildId); },
        deleteKnowledge: async (guildId, id) => { database.deleteKnowledge(guildId, Number(id)); return database.listKnowledge(guildId); },
        botStop: async () => {
          dashboardLogger.warn('■ Bot-Verbindung über Control Center getrennt. Dashboard bleibt aktiv.');
          try { client.destroy(); } catch {}
          setDashboardState({ ready: false });
          return { stopped: true, dashboard: true };
        },
      },
    });
  }

  setDashboardState({ ready: true });
  events.publish('bot.connection.changed', { ready: true, user: { id: readyClient.user.id, tag: readyClient.user.tag } }, { source: 'discord', communityId: guild.id });
  dashboardLogger.info(`✓ WebRadio Discord Bot online als ${readyClient.user.tag}`);
  dashboardLogger.info(`✓ Server: ${guild.name}`);
  dashboardLogger.info(`✓ GitHub Polling: Aktiviert für ${githubPolling.has(guild.id) ? 'Releases' : 'keine Repos'}`);
}

client.on(Events.ClientReady, async (readyClient) => {
  try {
    if (process.env.SYNC_BOT_USERNAME === 'true' && process.env.BOT_NAME && readyClient.user.username !== process.env.BOT_NAME) { try { await readyClient.user.setUsername(process.env.BOT_NAME); } catch (error) { dashboardLogger.warn('⚠ Discord-Botname konnte nicht automatisch gesetzt werden:', error?.message || error); } }
    const ids = process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : [...readyClient.guilds.cache.keys()];
    for (const id of ids) await initializeGuild(readyClient, id);
    dashboardLogger.info(`✓ ${ids.length} Community(s) initialisiert.`);
  } catch (error) { dashboardLogger.error('❌ Bot-Initialisierung fehlgeschlagen:', error?.stack || error); }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const identity = memberIdentity(member);
  if (identity) { database.upsertUser(identity); database.upsertMembership(member.guild.id, member.id, { nickname: identity.nickname, joinedAt: identity.joinedAt, roles: identity.roles }); }
  audit.recordCore(member.guild.id, 'member.joined', member.id, { username: member.user.username, bot: Boolean(member.user.bot) });
  activity.memberJoin(member);
  try { await sendWelcomeMessage(member, { logger: console }); }
  catch (error) { dashboardLogger.error('❌ Willkommensnachricht fehlgeschlagen:', error?.message || error); }
});

client.on(Events.GuildMemberRemove, (member) => { audit.recordCore(member.guild.id, 'member.left', member.id, { username: member.user?.username || null }); activity.memberLeave(member); });
client.on(Events.MessageCreate, (message) => activity.message(message));
client.on(Events.VoiceStateUpdate, (oldState, newState) => activity.voice(oldState, newState));

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  activity.reaction(reaction, user, true);
  try { await handleReactionRole(reaction, user, true, { database }); }
  catch (error) { dashboardLogger.error('❌ Reaction Role (Add) fehlgeschlagen:', error?.message || error); }
});
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  activity.reaction(reaction, user, false);
  try { await handleReactionRole(reaction, user, false, { database }); }
  catch (error) { dashboardLogger.error('❌ Reaction Role (Remove) fehlgeschlagen:', error?.message || error); }
});

client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => { audit.recordDiscord(guild.id, entry); });
client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  const oldRoles = new Set(oldMember.roles.cache.keys()); const newRoles = new Set(newMember.roles.cache.keys());
  const added = [...newRoles].filter((id) => !oldRoles.has(id)); const removed = [...oldRoles].filter((id) => !newRoles.has(id));
  if (added.length || removed.length) { audit.recordCore(newMember.guild.id, 'member.roles.changed', newMember.id, { added, removed }); events.publish('security.signal', { kind:'role_change', userId:newMember.id, added, removed }, { source:'discord', communityId:newMember.guild.id }); security.schedule(newMember.guild.id); }
});
client.on(Events.GuildBanAdd, (ban) => { events.publish('security.signal', { kind:'member_banned', userId:ban.user?.id||null }, { source:'discord', communityId:ban.guild.id }); security.schedule(ban.guild.id); });
client.on(Events.GuildCreate, (guild) => { events.publish('security.signal', { kind:'guild_available', name:guild.name }, { source:'discord', communityId:guild.id }); });
client.on(Events.WebhooksUpdate, (channel) => { if(channel.guild?.id) { audit.recordCore(channel.guild.id,'webhooks.updated',null,{channelId:channel.id}); events.publish('security.signal',{kind:'webhook_change',channelId:channel.id},{source:'discord',communityId:channel.guild.id}); security.schedule(channel.guild.id); } });

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleCommand(interaction, {
      sync: async (guild) => syncGitHub(guild, { database, logger: dashboardLogger }),
      reactionRoles: async (guild) => initializeReactionRoles(guild, { database, force: true, logger: dashboardLogger }),
    });
  } catch (error) {
    dashboardLogger.error('❌ Interaction fehlgeschlagen:', error?.stack || error);
    if (interaction.isRepliable()) {
      const content = '❌ Die Anfrage konnte nicht verarbeitet werden.';
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

const shutdown = () => { try { operations.close(); } catch {} try { security.close(); } catch {} try { automationEngine.close(); } catch {} try { orchestrator.close(); } catch {} try { client.destroy(); } finally { try { database.close(); } catch {} } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (error) {
  if (error?.name === 'TokenInvalid' || error?.code === 'TokenInvalid') {
    console.error('❌ Discord-Authentifizierung fehlgeschlagen: Der Bot-Token ist ungültig.');
    console.error('   → Discord Developer Portal → Bot → Token → Reset Token');
    console.error('   → Den neuen Token in .env als DISCORD_TOKEN eintragen.');
  } else {
    console.error('❌ Discord-Verbindung fehlgeschlagen:', error?.stack || error);
  }
  try { database.close(); } catch {}
  process.exitCode = 1;
}
