import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionOverwrites,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
  GatewayIntentBits,
  EmbedBuilder,
} from 'discord.js';

const PUBLIC_DIR = path.resolve('dashboard');
const DATA_DIR = path.resolve('data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const logBuffer = [];
const clients = new Set();
let liveBus = null;
let liveUnsubscribe = null;
const sessions = new Set();
const startedAt = Date.now();
let botState = { ready: false, guild: null, user: null, lastAction: null };

// Lightweight in-process protection for the local control plane. The dashboard
// is intentionally bound to loopback, but a burst of requests must never be
// allowed to starve the bot process. Entries expire automatically.
const requestBuckets = new Map();
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = 240;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_LIMIT = 8;
function clientKey(req) { return String(req.socket?.remoteAddress || 'local'); }
function allowRequest(req, { limit = REQUEST_LIMIT, windowMs = REQUEST_WINDOW_MS, bucket = 'api' } = {}) {
  const now = Date.now();
  const key = `${bucket}:${clientKey(req)}`;
  let entry = requestBuckets.get(key);
  if (!entry || now - entry.startedAt >= windowMs) entry = { startedAt: now, count: 0 };
  entry.count += 1;
  requestBuckets.set(key, entry);
  if (requestBuckets.size > 256) for (const [k, v] of requestBuckets) if (now - v.startedAt >= Math.max(windowMs, LOGIN_WINDOW_MS)) requestBuckets.delete(k);
  return entry.count <= limit;
}
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

function timestamp() { return new Date().toISOString(); }
export function configureDashboardEvents(eventBus) {
  if (liveUnsubscribe) { try { liveUnsubscribe(); } catch {} }
  liveBus = eventBus || null;
  liveUnsubscribe = liveBus?.subscribe?.((event) => {
    const payload = `event: core\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) { try { res.write(payload); } catch {} }
  }) || null;
}
function publishLive(type, payload = {}, meta = {}) {
  try { liveBus?.publish?.(type, payload, meta); } catch (error) { console.warn('⚠ Live Event konnte nicht veröffentlicht werden:', error?.message || error); }
}
function pushLog(level, args) {
  const message = args.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' ');
  const entry = { time: timestamp(), level, message };
  logBuffer.push(entry);
  while (logBuffer.length > 500) logBuffer.shift();
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch {} }
  publishLive('dashboard.log', entry, { source: 'dashboard' });
}
export const dashboardLogger = {
  log: (...args) => { console.log(...args); pushLog('info', args); },
  info: (...args) => { console.info(...args); pushLog('info', args); },
  warn: (...args) => { console.warn(...args); pushLog('warn', args); },
  error: (...args) => { console.error(...args); pushLog('error', args); },
  debug: (...args) => { console.debug(...args); pushLog('debug', args); },
};
function json(res, status, data) {
  const body = JSON.stringify(data);
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  if (Buffer.byteLength(raw) > 5 * 1024 * 1024) throw new Error('Request zu groß (max. 5 MB).');
  return JSON.parse(raw);
}
async function readEnvFile() { try { return await fs.readFile('.env', 'utf8'); } catch { return ''; } }
function setEnvValue(text, key, value) {
  const line = `${key}=${String(value).replace(/\n/g, '')}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}
async function saveSettings(values) {
  let env = await readEnvFile();
  const allowed = ['GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_POLL_INTERVAL_MS', 'WELCOME_CHANNEL_NAME', 'WELCOME_MENTION', 'WELCOME_INCLUDE_BOTS', 'WELCOME_MESSAGES_JSON', 'DASHBOARD_HOST', 'DASHBOARD_PORT', 'AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY'];
  for (const key of allowed) if (values[key] !== undefined) env = setEnvValue(env, key, typeof values[key] === 'object' ? JSON.stringify(values[key]) : values[key]);
  await fs.writeFile('.env', env, 'utf8');
}
function settings() {
  const e = process.env;
  let templates = [];
  try { templates = e.WELCOME_MESSAGES_JSON ? JSON.parse(e.WELCOME_MESSAGES_JSON) : []; } catch { templates = []; }
  return {
    AI_PROVIDER: e.AI_PROVIDER || 'none', AI_BASE_URL: e.AI_BASE_URL || 'http://127.0.0.1:11434', AI_MODEL: e.AI_MODEL || '', AI_API_KEY: e.AI_API_KEY ? '********' : '',
    GITHUB_OWNER: e.GITHUB_OWNER || 'YourEliteSystems', GITHUB_REPO: e.GITHUB_REPO || 'WebRadio',
    GITHUB_POLL_INTERVAL_MS: e.GITHUB_POLL_INTERVAL_MS || '300000', WELCOME_CHANNEL_NAME: e.WELCOME_CHANNEL_NAME || '📜・welcome',
    WELCOME_MENTION: e.WELCOME_MENTION !== 'false', WELCOME_INCLUDE_BOTS: e.WELCOME_INCLUDE_BOTS === 'true',
    WELCOME_MESSAGES: templates, DASHBOARD_HOST: e.DASHBOARD_HOST || '127.0.0.1', DASHBOARD_PORT: e.DASHBOARD_PORT || '5177',
  };
}
export function setDashboardState(patch) {
  botState = { ...botState, ...patch };
  publishLive('core.state.changed', botState, { source: 'core', communityId: botState.guild?.id || null });
}

const channelTypeNames = {
  [ChannelType.GuildText]: 'Text', [ChannelType.GuildVoice]: 'Voice', [ChannelType.GuildCategory]: 'Kategorie',
  [ChannelType.GuildAnnouncement]: 'Announcement', [ChannelType.GuildForum]: 'Forum', [ChannelType.GuildStageVoice]: 'Stage',
  [ChannelType.GuildMedia]: 'Media',
};
function channelDTO(c) {
  return { id: c.id, name: c.name, type: c.type, typeName: channelTypeNames[c.type] || String(c.type), parentId: c.parentId,
    position: c.rawPosition, nsfw: Boolean(c.nsfw), topic: c.topic || '', slowmode: c.rateLimitPerUser || 0,
    manageable: Boolean(c.manageable), url: c.url || null, isThread: Boolean(c.isThread?.()) };
}
function roleDTO(r) { return { id: r.id, name: r.name, color: r.hexColor, position: r.position, hoist: r.hoist, mentionable: r.mentionable, managed: r.managed, permissions: r.permissions.bitfield.toString(), manageable: Boolean(r.editable) }; }
function memberDTO(m) { return { id: m.id, username: m.user.username, displayName: m.displayName, tag: m.user.tag, bot: m.user.bot, avatar: m.displayAvatarURL({ size: 64 }), joinedAt: m.joinedTimestamp ? new Date(m.joinedTimestamp).toISOString() : null, roles: m.roles.cache.filter(r => r.id !== m.guild.id).map(r => ({ id: r.id, name: r.name })), communicationDisabledUntil: m.communicationDisabledUntilTimestamp ? new Date(m.communicationDisabledUntilTimestamp).toISOString() : null }; }
function getChannel(guild, id) { return guild.channels.cache.get(String(id)); }
function getRole(guild, id) { return guild.roles.cache.get(String(id)); }
function requireManage(guild) { const me = guild.members.me; if (!me?.permissions.has(PermissionFlagsBits.Administrator)) throw new Error('Der Bot benötigt Administrator-Rechte für das Control Center.'); }
function parseBitfield(value) { return BigInt(String(value || '0')); }
function cpuSnapshot() { return { load: os.loadavg(), cpus: os.cpus().length, memory: process.memoryUsage(), totalMemory: os.totalmem(), freeMemory: os.freemem() }; }
function permissionNames() { return Object.entries(PermissionFlagsBits).filter(([k]) => !k.startsWith('Use') || true).map(([name, bit]) => ({ name, bit: bit.toString() })); }
function overwriteDTO(o) { return { id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString(), role: o.type === 0 }; }
function safeName(value) { return String(value || 'backup').replace(/[^a-zA-Z0-9._-]+/g, '_'); }

async function makeBackup(guild) {
  const channels = [...guild.channels.cache.values()].filter(c => !c.isThread()).map(c => ({
    id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition, topic: c.topic || '', nsfw: Boolean(c.nsfw), slowmode: c.rateLimitPerUser || 0,
    permissionOverwrites: c.permissionOverwrites?.cache ? [...c.permissionOverwrites.cache.values()].map(overwriteDTO) : [],
  }));
  const roles = [...guild.roles.cache.values()].filter(r => !r.managed && r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, position: r.position, permissions: r.permissions.bitfield.toString() }));
  return { version: 1, createdAt: timestamp(), guild: { id: guild.id, name: guild.name, description: guild.description || '', verificationLevel: guild.verificationLevel, defaultMessageNotifications: guild.defaultMessageNotifications, explicitContentFilter: guild.explicitContentFilter, afkTimeout: guild.afkTimeout }, roles, channels };
}
async function writeBackup(guild) { await fs.mkdir(BACKUP_DIR, { recursive: true }); const data = await makeBackup(guild); const file = path.join(BACKUP_DIR, `${safeName(guild.name)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8'); return { file, data }; }

function authEnabled() { return Boolean(process.env.DASHBOARD_PASSWORD); }
function sessionFrom(req) { const m = /(?:^|; )wrb_session=([^;]+)/.exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]) : null; }
function authorized(req) { return !authEnabled() || sessions.has(sessionFrom(req)); }
function authPage() { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WebRadio Control Center Login</title><style>body{font-family:system-ui;background:#0b1020;color:#fff;display:grid;place-items:center;height:100vh;margin:0}.box{background:#121a2b;border:1px solid #293650;padding:25px;border-radius:14px;width:min(360px,90%)}input,button{width:100%;padding:11px;margin-top:10px;border-radius:8px;border:1px solid #293650;background:#0c1425;color:#fff}button{background:#5865f2;border:0;cursor:pointer}</style><div class="box"><h2>📻 WebRadio Control Center</h2><p>Dashboard-Passwort</p><form method="post" action="/login"><input type="password" name="password" autofocus><button>Einloggen</button></form></div>`; }

export function startDashboard({ client, guild: initialGuild, database = null, host = process.env.DASHBOARD_HOST || '127.0.0.1', port = Number(process.env.DASHBOARD_PORT || 5177), actions = {}, eventBus = null } = {}) {
  if (eventBus) configureDashboardEvents(eventBus);
  let guild = initialGuild;
  const server = http.createServer(async (req, res) => {
    try {
      securityHeaders(res);
      if (!allowRequest(req)) { res.setHeader('Retry-After', '60'); return json(res, 429, { ok: false, error: 'Zu viele Anfragen. Bitte kurz warten.' }); }
      const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); const p = u.pathname;
      // Authentication must happen before every control-plane endpoint. Only
      // login/logout and the intentionally public health probe are reachable
      // without a dashboard session when password protection is enabled.
      if (p === '/login' && req.method === 'POST') {
        if (!allowRequest(req, { limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS, bucket: 'login' })) {
          res.setHeader('Retry-After', '600');
          return json(res, 429, { ok: false, error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
        }
        let raw=''; for await (const chunk of req) raw += chunk;
        const params=new URLSearchParams(raw);
        if(params.get('password') !== process.env.DASHBOARD_PASSWORD){
          res.writeHead(401,{'Content-Type':'text/html; charset=utf-8'});
          return res.end(authPage().replace('</form>','<p style=\"color:#ff7275\">Falsches Passwort.</p></form>'));
        }
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.add(token);
        while (sessions.size > 256) sessions.delete(sessions.values().next().value);
        res.writeHead(302,{Location:'/', 'Set-Cookie':`wrb_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`});
        return res.end();
      }
      if (p === '/logout') {
        const token=sessionFrom(req);
        if(token)sessions.delete(token);
        res.writeHead(302,{Location:'/', 'Set-Cookie':'wrb_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'});
        return res.end();
      }
      if (authEnabled() && !authorized(req) && p !== '/api/health') {
        if(p==='/'||p==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(authPage());}
        return json(res,401,{ok:false,error:'Dashboard-Anmeldung erforderlich.'});
      }
      if (p === '/api/ai/state' && req.method === 'GET') return json(res,200,actions.aiState?await actions.aiState(guild.id):{configured:false,enabled:false,canEnable:false});
      if (p === '/api/ai/state' && req.method === 'POST') { const v=await body(req); if(!actions.setAIEnabled) throw new Error('KI-Aktivierung nicht verfügbar.'); return json(res,200,{ok:true,state:await actions.setAIEnabled(guild.id,Boolean(v.enabled))}); }
      if (p === '/api/ai/provider' && req.method === 'GET') return json(res,200,actions.aiProviderConfig?await actions.aiProviderConfig():{provider:process.env.AI_PROVIDER||'none',baseUrl:process.env.AI_BASE_URL||'http://127.0.0.1:11434',model:process.env.AI_MODEL||'',apiKeyConfigured:Boolean(process.env.AI_API_KEY)});
      if (p === '/api/ai/provider' && req.method === 'POST') { const v=await body(req); if(!actions.setAIProvider) throw new Error('KI-Provider-Konfiguration nicht verfügbar.'); return json(res,200,{ok:true,config:await actions.setAIProvider(v)}); }
      if (p === '/api/ai/provider-test' && req.method === 'POST') return json(res,200,{ok:true,result:actions.aiProviderTest?await actions.aiProviderTest():{ok:false,error:'Provider-Test nicht verfügbar.'}});
      if (p === '/api/ai/providers' && req.method === 'GET') return json(res,200,{providers:actions.aiProviders?await actions.aiProviders():[]});
      if (p === '/api/ai/provider-config' && req.method === 'GET') return json(res,200,{config:actions.aiProviderConfigs?await actions.aiProviderConfigs(guild.id):{}});
      if (p === '/api/ai/provider-config' && req.method === 'POST') { const v=await body(req); return json(res,200,{ok:true,config:await actions.saveAIProvider(guild.id,v)}); }
      if (p === '/api/ai/provider-fallbacks' && req.method === 'GET') return json(res,200,{fallbacks:actions.aiProviderFallbacks?await actions.aiProviderFallbacks(guild.id):[]});
      if (p === '/api/ai/provider-fallbacks' && req.method === 'POST') { const v=await body(req); if(!v.slotId) throw new Error('slotId fehlt.'); return json(res,200,{ok:true,fallback:await actions.saveAIProviderFallback(guild.id,v)}); }
      if (p.startsWith('/api/ai/provider-fallbacks/') && req.method === 'DELETE') { const id=decodeURIComponent(p.split('/').pop()); return json(res,200,{ok:true,config:await actions.deleteAIProviderFallback(guild.id,id)}); }
      if (p === '/api/ai/features' && req.method === 'GET') return json(res,200,{features:actions.aiFeatures?await actions.aiFeatures(guild.id):{}});
      if (p === '/api/ai/features' && req.method === 'POST') { const v=await body(req); if(!v.feature) throw new Error('feature fehlt.'); return json(res,200,{ok:true,features:await actions.setAIFeature(guild.id,String(v.feature),Boolean(v.enabled),String(v.actorId||''))}); }
      if (p === '/api/ai/models' && req.method === 'GET') return json(res,200,{models:await actions.aiModels(guild.id)});
      if (p === '/api/ai/agent' && req.method === 'POST') { const v=await body(req); if(!Array.isArray(v.messages)) throw new Error('messages muss ein Array sein.'); return json(res,200,{ok:true,content:await actions.aiAgentChat(guild.id,String(v.userId||''),v.messages.slice(-30),v.sessionId?Number(v.sessionId):null)}); }
      if (p === '/api/ai/agent/sessions' && req.method === 'GET') return json(res,200,{sessions:actions.aiAgentSessions?await actions.aiAgentSessions(guild.id,{status:u.searchParams.get('status')||null,limit:Number(u.searchParams.get('limit')||50)}):[]});
      if (p === '/api/ai/agent/sessions' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,session:await actions.aiAgentCreateSession(guild.id,String(v.userId),String(v.title||'AI Agent Session'))}); }
      if (p.startsWith('/api/ai/agent/sessions/') && req.method === 'GET') { const id=p.split('/').pop(); return json(res,200,{session:actions.aiAgentSession?await actions.aiAgentSession(guild.id,Number(id)):null,runs:actions.aiAgentRuns?await actions.aiAgentRuns(guild.id,{sessionId:Number(id),limit:200}):[]}); }
      if (p === '/api/ai/agent/runs' && req.method === 'GET') return json(res,200,{runs:actions.aiAgentRuns?await actions.aiAgentRuns(guild.id,{sessionId:u.searchParams.get('sessionId')?Number(u.searchParams.get('sessionId')):null,limit:Number(u.searchParams.get('limit')||100)}):[]});
      if (p === '/api/ai/agent/metrics' && req.method === 'GET') return json(res,200,{metrics:actions.aiAgentMetrics?await actions.aiAgentMetrics(guild.id):{}});
      if (p === '/api/ai/agent/context' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,...await actions.aiAgentContext(guild.id,String(v.userId),String(v.query||''),v.sessionId?Number(v.sessionId):null)}); }
      if (p === '/api/ai/agent/tools' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,...await actions.aiAgentTools(guild.id,String(v.userId))}); }
      if (p === '/api/ai/agent/tool-request' && req.method === 'POST') { const v=await body(req); if(!v.userId||!v.tool) throw new Error('userId und tool sind erforderlich.'); return json(res,200,{ok:true,result:await actions.aiAgentToolRequest(guild.id,String(v.userId),String(v.tool),v.args||{},String(v.reason||''),v.sessionId?Number(v.sessionId):null)}); }
      if (p === '/api/ai/tools' && req.method === 'GET') return json(res,200,{tools:actions.discordTools?await actions.discordTools():[]});
      if (p === '/api/ai/tool-confirmations' && req.method === 'GET') return json(res,200,{confirmations:actions.toolConfirmations?await actions.toolConfirmations(guild.id):[]});
      if (p.startsWith('/api/ai/tool-confirmations/') && req.method === 'GET') { const id=p.split('/').pop(); return json(res,200,{confirmation:actions.toolConfirmation?await actions.toolConfirmation(guild.id,Number(id)):null}); }
      if (p === '/api/ai/tool-request' && req.method === 'POST') { const v=await body(req); if(!v.userId||!v.tool) throw new Error('userId und tool sind erforderlich.'); return json(res,200,{ok:true,result:await actions.requestDiscordTool(guild.id,String(v.userId),String(v.tool),v.args||{},String(v.reason||''))}); }
      if (p === '/api/ai/tool-confirm' && req.method === 'POST') { const v=await body(req); if(!v.confirmationId||!v.actorId) throw new Error('confirmationId und actorId sind erforderlich.'); return json(res,200,{ok:true,result:await actions.confirmDiscordTool(guild.id,Number(v.confirmationId),String(v.actorId))}); }
      if (p === '/api/ai/tool-reject' && req.method === 'POST') { const v=await body(req); if(!v.confirmationId||!v.actorId) throw new Error('confirmationId und actorId sind erforderlich.'); return json(res,200,{ok:true,result:await actions.rejectDiscordTool(guild.id,Number(v.confirmationId),String(v.actorId))}); }
      if (p === '/api/ai/chat' && req.method === 'POST') { if(!actions.ai) throw new Error('KI-Schnittstelle nicht verfügbar.'); const v=await body(req); if(!Array.isArray(v.messages)) throw new Error('messages muss ein Array sein.'); const result=await actions.ai(guild.id,v.messages.slice(-30),{conversationId:v.conversationId,userId:v.userId,title:v.title}); return json(res,200,{ok:true,...result}); }
      if (p === '/api/ai/conversations' && req.method === 'GET') return json(res,200,{conversations:actions.aiConversations?await actions.aiConversations(guild.id):[]});
      if (p.startsWith('/api/ai/conversations/') && req.method === 'GET') { const id=p.split('/').pop(); return json(res,200,{conversation:actions.aiConversation?await actions.aiConversation(guild.id,Number(id)):null,messages:actions.aiMessages?await actions.aiMessages(guild.id,id):[]}); }
      if (p === '/api/ai/memories' && req.method === 'GET') return json(res,200,{memories:actions.memories?await actions.memories(guild.id):[]});
      if (p === '/api/ai/memories' && req.method === 'POST') { const v=await body(req); if(!v.key) throw new Error('Memory-Key fehlt.'); return json(res,200,{ok:true,memories:await actions.setMemory(guild.id,v.key,v.value)}); }
      if (p.startsWith('/api/ai/memories/') && req.method === 'DELETE') { const key=decodeURIComponent(p.split('/').pop()); return json(res,200,{ok:true,memories:await actions.deleteMemory(guild.id,key)}); }
      if (p === '/api/ai/knowledge' && req.method === 'GET') return json(res,200,{documents:actions.knowledge?await actions.knowledge(guild.id):[]});
      if (p === '/api/ai/knowledge' && req.method === 'POST') { const v=await body(req); if(!v.title||!v.content) throw new Error('Titel und Inhalt fehlen.'); return json(res,200,{ok:true,documents:await actions.saveKnowledge(guild.id,v)}); }
      if (p.startsWith('/api/ai/knowledge/') && req.method === 'DELETE') { const id=p.split('/').pop(); return json(res,200,{ok:true,documents:await actions.deleteKnowledge(guild.id,id)}); }
      if (p === '/api/activity' && req.method === 'GET') { const minutes=Math.min(1440,Math.max(1,Number(u.searchParams.get('minutes')||60))); return json(res,200,actions.activity?await actions.activity(guild.id,minutes):{windowMinutes:minutes,byType:{},recent:[]}); }
      if (p === '/api/activity/trend' && req.method === 'GET') { const minutes=Math.min(10080,Math.max(15,Number(u.searchParams.get('minutes')||1440))); const bucket=Math.min(1440,Math.max(5,Number(u.searchParams.get('bucket')||60))); return json(res,200,{trend:actions.activityTrend?await actions.activityTrend(guild.id,minutes,bucket):{}}); }
      if (p === '/api/activity/leaderboard' && req.method === 'GET') { const minutes=Math.min(10080,Math.max(1,Number(u.searchParams.get('minutes')||1440))); const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||10))); return json(res,200,{users:actions.activityLeaderboard?await actions.activityLeaderboard(guild.id,minutes,limit):[]}); }
      if (p === '/api/users' && req.method === 'GET') { const limit=Math.min(1000,Math.max(1,Number(u.searchParams.get('limit')||200))); return json(res,200,{users:actions.users?await actions.users(guild.id,limit):[]}); }
      if (p === '/api/identity/users' && req.method === 'GET') { const limit=Math.min(1000,Math.max(1,Number(u.searchParams.get('limit')||200))); const q=(u.searchParams.get('q')||'').trim().toLowerCase(); const users=actions.users?await actions.users(guild.id,limit):[]; const filtered=q?users.filter(x=>`${x.user_id||''} ${x.username||''} ${x.display_name||''} ${x.nickname||''}`.toLowerCase().includes(q)):users; return json(res,200,{users:filtered.slice(0,limit)}); }
      if (p.startsWith('/api/identity/users/') && req.method === 'GET') { const id=decodeURIComponent(p.split('/').pop()); return json(res,200,{user:actions.userProfile?await actions.userProfile(guild.id,id):null}); }
      if (p === '/api/staff/overview' && req.method === 'GET') return json(res,200,{overview:actions.staffOverview?await actions.staffOverview(guild.id):{total:0,counts:{},staff:[]}});
      if (p === '/api/staff/groups' && req.method === 'GET') return json(res,200,{groups:actions.staffGroups?await actions.staffGroups(guild.id):[]});
      if (p === '/api/staff/groups' && req.method === 'POST') { const v=await body(req); if(!v.name) throw new Error('Gruppenname fehlt.'); return json(res,200,{ok:true,groups:await actions.saveStaffGroup(guild.id,{id:v.id||null,name:String(v.name),description:String(v.description||'')})}); }
      if (p.startsWith('/api/staff/groups/') && p.endsWith('/members') && req.method === 'POST') { const id=Number(p.split('/')[4]); const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,result:await actions.setStaffGroupMember(guild.id,id,String(v.userId),v.add!==false),groups:await actions.staffGroups(guild.id)}); }
      if (p.startsWith('/api/staff/groups/') && req.method === 'DELETE') { const id=Number(p.split('/')[4]); return json(res,200,{ok:true,groups:await actions.deleteStaffGroup(guild.id,id)}); }
      if (p === '/api/staff/members' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('Discord User-ID fehlt.'); return json(res,200,{ok:true,member:await actions.addStaffMember(guild.id,String(v.userId))}); }
      if (p.startsWith('/api/staff/members/') && req.method === 'DELETE') { const id=decodeURIComponent(p.split('/').pop()); return json(res,200,{ok:true,member:await actions.removeStaffMember(guild.id,id)}); }

      if (p === '/api/staff/status' && req.method === 'GET') return json(res,200,{staff:actions.staffStatus?await actions.staffStatus(guild.id):[]});
      if (p === '/api/staff/status' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); const result=actions.setStaffStatus?await actions.setStaffStatus(guild.id,String(v.userId),String(v.status||'offline'),String(v.note||'')):null; publishLive('staff.status.changed',result||{}, {source:'dashboard',communityId:guild.id}); return json(res,200,{ok:true,status:result}); }
      if (p === '/api/security' && req.method === 'GET') return json(res,200,actions.security?await actions.security(guild.id):{score:0,level:'normal',signals:[],metrics:{}});
      if (p === '/api/security/history' && req.method === 'GET') { const limit=Math.min(500,Math.max(1,Number(u.searchParams.get('limit')||100))); const sinceMinutes=Math.min(43200,Math.max(1,Number(u.searchParams.get('sinceMinutes')||10080))); return json(res,200,{history:actions.securityHistory?await actions.securityHistory(guild.id,{limit,sinceMinutes}):[]}); }
      if (p === '/api/security/actions' && req.method === 'GET') return json(res,200,{actions:actions.securityActions?await actions.securityActions(guild.id,u.searchParams.get('status')||null):[],catalog:actions.securityActionCatalog?await actions.securityActionCatalog():[]});
      if (p === '/api/security/actions' && req.method === 'POST') { const v=await body(req); if(!v.actorId||!v.action) throw new Error('actorId und action sind erforderlich.'); return json(res,200,{ok:true,...await actions.requestSecurityAction(guild.id,String(v.actorId),String(v.action),v.args||{},String(v.reason||''))}); }
      if (p.startsWith('/api/security/actions/') && p.endsWith('/confirm') && req.method === 'POST') { const id=p.split('/')[4]; const v=await body(req); if(!v.actorId) throw new Error('actorId ist erforderlich.'); return json(res,200,{ok:true,...await actions.confirmSecurityAction(guild.id,Number(id),String(v.actorId))}); }
      if (p.startsWith('/api/security/actions/') && p.endsWith('/reject') && req.method === 'POST') { const id=p.split('/')[4]; const v=await body(req); if(!v.actorId) throw new Error('actorId ist erforderlich.'); return json(res,200,{ok:true,confirmation:await actions.rejectSecurityAction(guild.id,Number(id),String(v.actorId))}); }
      if (p === '/api/operations' && req.method === 'GET') return json(res,200,{snapshot:actions.operationsSnapshot?await actions.operationsSnapshot(guild.id):null});
      if (p === '/api/operations/center' && req.method === 'GET') return json(res,200,{center:actions.operationsCenter?await actions.operationsCenter(guild.id):null});
      if (p === '/api/operations/timeline' && req.method === 'GET') { const limit=Math.min(200,Math.max(1,Number(u.searchParams.get('limit')||40))); const sinceMinutes=Math.min(43200,Math.max(1,Number(u.searchParams.get('sinceMinutes')||1440))); return json(res,200,{timeline:actions.operationsTimeline?await actions.operationsTimeline(guild.id,{limit,sinceMinutes}):[]}); }
      if (p === '/api/operations/search' && req.method === 'GET') { const q=u.searchParams.get('q')||''; const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||30))); return json(res,200,{results:actions.operationsSearch?await actions.operationsSearch(guild.id,q,{limit}):[]}); }
      if (p === '/api/tickets' && req.method === 'GET') return json(res,200,{tickets:actions.tickets?await actions.tickets(guild.id):[],queue:actions.ticketQueue?await actions.ticketQueue(guild.id):null});
      if (p === '/api/support/overview' && req.method === 'GET') return json(res,200,{overview:actions.supportOverview?await actions.supportOverview(guild.id):null});
      if (p === '/api/support/sla/evaluate' && req.method === 'POST') return json(res,200,{ok:true,...(actions.supportSLAEvaluate?await actions.supportSLAEvaluate(guild.id):{checked:0,breaches:[]})});
      if (p.startsWith('/api/support/tickets/') && p.endsWith('/case') && req.method === 'GET') { const id=p.split('/')[4]; return json(res,200,{case:actions.supportCase?await actions.supportCase(guild.id,Number(id)):null}); }
      if (p.startsWith('/api/support/tickets/') && p.endsWith('/triage-route') && req.method === 'POST') { const id=p.split('/')[4]; const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,result:await actions.supportTriageRoute(guild.id,String(v.userId),Number(id))}); }
      if (p === '/api/support/link-incident' && req.method === 'POST') { const v=await body(req); if(!v.ticketId||!v.incidentId) throw new Error('ticketId und incidentId fehlen.'); return json(res,200,{ok:true,link:await actions.supportLinkIncident(guild.id,Number(v.ticketId),Number(v.incidentId),v.actorId||null)}); }
      if (p === '/api/support/sla' && req.method === 'GET') return json(res,200,{sla:actions.supportSLA?await actions.supportSLA(guild.id):[]});
      if (p === '/api/support/sla' && req.method === 'POST') { const v=await body(req); if(!Array.isArray(v.sla)) throw new Error('sla muss ein Array sein.'); return json(res,200,{ok:true,sla:await actions.saveSupportSLA(guild.id,v.sla,String(v.actorId||''))}); }
      if (p === '/api/tickets' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,tickets:await actions.createTicket(guild.id,v)}); }
      if (p === '/api/support/ticket-from-conversation' && req.method === 'POST') { const v=await body(req); if(!v.userId) throw new Error('userId fehlt.'); return json(res,200,{ok:true,ticket:await actions.createSupportTicket(guild.id,String(v.userId),v)}); }
      if (p.startsWith('/api/tickets/') && req.method === 'GET') { const id=p.split('/').pop(); return json(res,200,{messages:actions.ticketMessages?await actions.ticketMessages(id):[]}); }
      if (p.startsWith('/api/tickets/') && p.endsWith('/ai-analysis') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,analysis:await actions.aiTicketAnalysis(guild.id,String(v.userId||''),Number(id))}); }
      if (p.startsWith('/api/tickets/') && p.endsWith('/ai-triage') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,triage:await actions.supportTriage(guild.id,String(v.userId||''),Number(id))}); }
      if (p.startsWith('/api/tickets/') && p.endsWith('/handoff') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); if(!v.actorId) throw new Error('actorId fehlt.'); return json(res,200,{ok:true,ticket:await actions.supportHandoff(guild.id,String(v.actorId),Number(id),v)}); }
      if (p.startsWith('/api/tickets/') && req.method === 'POST') { const id=p.split('/').pop(); const v=await body(req); if(v.action==='message') return json(res,200,{ok:true,messages:actions.addTicketMessage?await actions.addTicketMessage(guild.id,id,v):[]}); return json(res,200,{ok:true,ticket:actions.updateTicket?await actions.updateTicket(guild.id,id,v):null}); }
      if (p === '/api/automations/status' && req.method === 'GET') return json(res,200,actions.automationStatus?await actions.automationStatus():{running:false});
      if (p === '/api/automations/stats' && req.method === 'GET') return json(res,200,actions.automationStats?await actions.automationStats(guild.id):{});
      if (p === '/api/automations/runs' && req.method === 'GET') { const jobId=u.searchParams.get('jobId'); const limit=Math.min(500,Math.max(1,Number(u.searchParams.get('limit')||100))); return json(res,200,{runs:actions.automationRuns?await actions.automationRuns(guild.id,{jobId:jobId?Number(jobId):null,limit}):[]}); }
      if (p === '/api/incidents' && req.method === 'GET') return json(res,200,{incidents:actions.incidents?await actions.incidents(guild.id):[]});
      if (p === '/api/incidents' && req.method === 'POST') { const v=await body(req); return json(res,200,{ok:true,incident:await actions.createIncident(guild.id,v,v.actorId||null)}); }
      if (p.startsWith('/api/incidents/') && p.endsWith('/timeline') && req.method === 'GET') { const id=p.split('/')[3]; return json(res,200,{timeline:actions.incidentTimeline?await actions.incidentTimeline(guild.id,id):[]}); }
      if (p.startsWith('/api/incidents/') && p.endsWith('/timeline') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,item:await actions.addIncidentNote(guild.id,id,String(v.actorId||''),String(v.message||''),String(v.kind||'note'),v.payload||{})}); }
      if (p.startsWith('/api/incidents/') && p.endsWith('/assign') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,incident:await actions.assignIncident(guild.id,id,String(v.userId||''),v.actorId||null)}); }
      if (p.startsWith('/api/incidents/') && p.endsWith('/resolve') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,incident:await actions.resolveIncident(guild.id,id,v.actorId||null,String(v.resolution||''))}); }
      if (p.startsWith('/api/incidents/') && p.endsWith('/close') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,incident:await actions.closeIncident(guild.id,id,v.actorId||null)}); }
      if (p.startsWith('/api/incidents/') && p.endsWith('/ai-analysis') && req.method === 'POST') { const id=p.split('/')[3]; const v=await body(req); return json(res,200,{ok:true,analysis:await actions.aiIncidentAnalysis(guild.id,String(v.userId||''),Number(id))}); }
      if (p.startsWith('/api/incidents/') && req.method === 'GET') { const id=p.split('/').pop(); return json(res,200,{incident:actions.incident?await actions.incident(guild.id,id):null,timeline:actions.incidentTimeline?await actions.incidentTimeline(guild.id,id):[]}); }
      if (p.startsWith('/api/incidents/') && req.method === 'POST') { const id=p.split('/').pop(); const v=await body(req); return json(res,200,{ok:true,incident:await actions.updateIncident(guild.id,id,v,v.actorId||null)}); }
      if (p === '/api/rbac/roles' && req.method === 'GET') return json(res,200,{roles:actions.rbacDefinitions?await actions.rbacDefinitions(guild.id):(actions.rbacRoles?await actions.rbacRoles(guild.id):[])});
      if (p === '/api/rbac/catalog' && req.method === 'GET') return json(res,200,{permissions:actions.rbacCatalog?await actions.rbacCatalog():[]});
      if (p === '/api/rbac/permissions' && req.method === 'GET') return json(res,200,actions.rbacPermissions?await actions.rbacPermissions(guild.id,u.searchParams.get('userId')):{});
      if (p === '/api/rbac/roles' && req.method === 'POST') { const v=await body(req); if(!v.userId||!v.role||!v.actorId) throw new Error('userId, role und actorId sind erforderlich.'); return json(res,200,{ok:true,role:await actions.setCoreRole(guild.id,String(v.userId),String(v.role),String(v.actorId))}); }
      if (p === '/api/rbac/definitions' && req.method === 'POST') { const v=await body(req); if(!v.role||!v.label||!v.actorId) throw new Error('role, label und actorId sind erforderlich.'); return json(res,200,{ok:true,role:await actions.saveRBACRole(guild.id,v,String(v.actorId))}); }
      if (p.startsWith('/api/rbac/definitions/') && req.method === 'DELETE') { const role=decodeURIComponent(p.split('/').pop()); const v=await body(req).catch(()=>({})); if(!v.actorId) throw new Error('actorId ist erforderlich.'); return json(res,200,{ok:true,...await actions.deleteRBACRole(guild.id,role,String(v.actorId))}); }
      if (p === '/api/ai/knowledge/search' && req.method === 'GET') return json(res,200,{documents:actions.knowledgeSearch?await actions.knowledgeSearch(guild.id,u.searchParams.get('q')||''):[]});
      if (p === '/api/ai/knowledge/feedback' && req.method === 'POST') { const v=await body(req); if(!v.documentId||v.helpful===undefined) throw new Error('documentId und helpful sind erforderlich.'); return json(res,200,{ok:true,feedback:await actions.knowledgeFeedback(guild.id,v),stats:actions.knowledgeFeedbackStats?await actions.knowledgeFeedbackStats(guild.id,Number(v.documentId)):null}); }
      if (p === '/api/automations' && req.method === 'GET') return json(res,200,{automations:actions.automations?await actions.automations(guild.id):[]});
      if (p === '/api/automations' && req.method === 'POST') { const v=await body(req); if(!v.name) throw new Error('Automationsname fehlt.'); return json(res,200,{ok:true,automations:await actions.saveAutomation(guild.id,v)}); }
      if (p.startsWith('/api/automations/') && req.method === 'DELETE') { const id=p.split('/').pop(); const v=await body(req).catch(()=>({})); return json(res,200,{ok:true,automations:await actions.deleteAutomation(guild.id,id,v.actorId||null)}); }
      if (p === '/api/core/identity' && req.method === 'GET') return json(res, 200, botState.identity || { name: process.env.BOT_NAME || 'Community Bot', profile: process.env.DEFAULT_COMMUNITY_PROFILE || 'custom' });
      if (p === '/api/communities' && req.method === 'GET') { const result = actions.listCommunities ? await actions.listCommunities() : [guild].filter(Boolean).map(g=>({id:g.id,name:g.name,memberCount:g.memberCount})); return json(res,200,{communities:result,activeGuildId:guild?.id||null}); }
      if (p === '/api/communities' && req.method === 'POST') { const v=await body(req); if(!actions.addCommunity) throw new Error('Community-Verwaltung nicht verfügbar.'); const result=await actions.addCommunity(String(v.guildId||''), v.profileId || null); return json(res,200,{ok:true,community:result}); }
      if (p.startsWith('/api/communities/') && req.method === 'DELETE') { const id=p.split('/').pop(); if(!actions.removeCommunity) throw new Error('Community-Verwaltung nicht verfügbar.'); const result=await actions.removeCommunity(id); return json(res,200,{ok:true,community:result}); }
      if (p === '/api/communities/select' && req.method === 'POST') { const v=await body(req); if(!v.guildId || !client.guilds.cache.has(v.guildId)) throw new Error('Community nicht gefunden.'); guild=client.guilds.cache.get(v.guildId); setDashboardState({guild:{id:guild.id,name:guild.name,memberCount:guild.memberCount},community:actions.getCommunity?((await actions.getCommunity(guild.id)).config):botState.community}); publishLive('community.selected', { id: guild.id, name: guild.name }, { source: 'dashboard', communityId: guild.id }); return json(res,200,{ok:true,guild:{id:guild.id,name:guild.name},community:botState.community||null}); }
      if (p === '/api/rules' && req.method === 'GET') {
        const stored = actions.getRules ? await actions.getRules(guild.id) : null;
        let channelMessages = [];
        const rulesChannel = guild.rulesChannel || (stored?.rules_channel_id ? getChannel(guild, stored.rules_channel_id) : null);
        if (rulesChannel?.isTextBased()) { try { const msgs = await rulesChannel.messages.fetch({ limit: 20 }); channelMessages = [...msgs.values()].reverse().map(m=>({id:m.id,author:m.author?.tag||m.author?.username||'–',content:m.content||'',createdAt:m.createdAt?.toISOString()||null,isBot:Boolean(m.author?.bot)})); } catch {} }
        return json(res,200,{rules:stored||{title:'Community-Regeln',content:'',rules_channel_id:rulesChannel?.id||null,published_message_id:null},discordChannel:rulesChannel?{id:rulesChannel.id,name:rulesChannel.name}:null,channelMessages});
      }
      if (p === '/api/rules' && req.method === 'POST') {
        requireManage(guild); const v=await body(req); if(!actions.setRules) throw new Error('Regelverwaltung nicht verfügbar.');
        const title=String(v.title||'Community-Regeln').trim(); const content=String(v.content||'').trim(); if(!content) throw new Error('Die Regeln dürfen nicht leer sein.');
        const channelId=String(v.rulesChannelId||'').trim(); const channel=channelId?getChannel(guild,channelId):(guild.rulesChannel||null);
        let publishedMessageId=v.publishedMessageId||null;
        if(v.publish && (!channel || !channel.isTextBased())) throw new Error('Regelkanal nicht gefunden oder nicht textbasiert.');
        if(v.publish) {
          const embed=new EmbedBuilder().setTitle(title).setDescription(content).setColor(0x5865f2).setFooter({text:'Community Core • Community-Regeln'}).setTimestamp();
          let msg=null; if(publishedMessageId) { try { msg=await channel.messages.fetch(publishedMessageId); } catch {} }
          if(!msg) { try { const recent=await channel.messages.fetch({limit:50}); msg=[...recent.values()].find(m=>m.author?.id===client.user?.id && m.embeds?.[0]?.footer?.text==='Community Core • Community-Regeln'); } catch {} }
          if(msg) await msg.edit({embeds:[embed]}); else { const sent=await channel.send({embeds:[embed]}); publishedMessageId=sent.id; }
        }
        const rules=await actions.setRules(guild.id,{title,content,rulesChannelId:channel?.id||channelId||guild.rulesChannel?.id||null,publishedMessageId});
        return json(res,200,{ok:true,rules});
      }
      if (p === '/api/communities/profiles' && req.method === 'GET') return json(res,200,{profiles:[{id:'webradio',name:'WebRadio'},{id:'gaming',name:'Gaming Community'},{id:'developer',name:'Developer Community'},{id:'custom',name:'Custom Community'}]});
      if (p === '/api/communities/profile' && req.method === 'POST') { const v=await body(req); if(!actions.setCommunityProfile) throw new Error('Profilverwaltung nicht verfügbar.'); const result=await actions.setCommunityProfile(v.guildId||guild.id,v.profileId); return json(res,200,{ok:true,result}); }
      if (p === '/api/external-modules' && req.method === 'GET') return json(res,200,{modules:actions.externalModules?await actions.externalModules():[]});
      if (p === '/api/readiness' && req.method === 'GET') return json(res,200,actions.releaseReadiness?await actions.releaseReadiness():{ok:false,error:'Release-Readiness nicht verfügbar.'});
      if (p === '/api/v1/meta' && req.method === 'GET') return json(res,200,{api:actions.coreApiMeta?await actions.coreApiMeta():{version:'1.0',capabilities:{}}});
      if (p === '/api/v1/modules' && req.method === 'GET') return json(res,200,{api:'1.0',modules:actions.externalModules?await actions.externalModules():[]});
      if (p === '/api/modules' && req.method === 'GET') { if(!actions.getCommunity) throw new Error('Modulverwaltung nicht verfügbar.'); const result=await actions.getCommunity(guild.id); return json(res,200,{modules:result.modules,profile:result.profile}); }
      if (p === '/api/modules' && req.method === 'POST') { const v=await body(req); if(!actions.setModule) throw new Error('Modulverwaltung nicht verfügbar.'); const result=await actions.setModule(v.guildId||guild.id,v.moduleId,Boolean(v.enabled),v.config||{}); return json(res,200,{ok:true,modules:result}); }
      if (p === '/events') {
        const lastEventId = Number(req.headers['last-event-id'] || u.searchParams.get('after') || 0);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        if (liveBus) for (const event of liveBus.history({ after: lastEventId, communityId: guild?.id, limit: 100 })) res.write(`id: ${event.sequence}\nevent: core\ndata: ${JSON.stringify(event)}\n\n`);
        for (const e of logBuffer.slice(-100)) res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`);
        const heartbeat = setInterval(() => { try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch {} }, 15000);
        clients.add(res);
        req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
        return;
      }
      if (p === '/api/live/history' && req.method === 'GET') return json(res, 200, { sequence: liveBus?.lastSequence || 0, events: liveBus?.history({ after: Number(u.searchParams.get('after') || 0), communityId: guild?.id, limit: Number(u.searchParams.get('limit') || 100) }) || [] });
      if (p === '/api/status' && req.method === 'GET') return json(res, 200, { uptime: Math.floor((Date.now() - startedAt) / 1000), node: process.version, pid: process.pid, ready: client?.isReady?.() ?? false, user: client?.user ? { id: client.user.id, tag: client.user.tag } : null, guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount, icon: guild.iconURL({ size: 128 }), ownerId: guild.ownerId } : null, state: botState, system: cpuSnapshot() });
      if (p === '/api/health' && req.method === 'GET') { const me=guild?.members?.me; const perms=me?.permissions; const checks=[{id:'gateway',name:'Discord Gateway',ok:Boolean(client?.isReady?.())},{id:'guild',name:'Community',ok:Boolean(guild?.id)},{id:'admin',name:'Administrator',ok:Boolean(perms?.has(PermissionFlagsBits.Administrator))},{id:'database',name:'SQLite',ok:true},{id:'dashboard',name:'Dashboard',ok:true},{id:'auth',name:'Dashboard Auth',ok:authEnabled(),detail:authEnabled()?'Passwortschutz aktiv.':'WARNUNG: DASHBOARD_PASSWORD ist nicht gesetzt.'},{id:'ai',name:'AI Provider',ok:Boolean(botState.ai?.enabled || process.env.AI_PROVIDER && process.env.AI_PROVIDER!=='none')}]; return json(res,200,{ok:checks.every(x=>x.ok),checks,system:cpuSnapshot(),uptime:Math.floor((Date.now()-startedAt)/1000)}); }
      if (p === '/api/logs' && req.method === 'GET') return json(res, 200, logBuffer);
      if (p === '/api/settings' && req.method === 'GET') return json(res, 200, settings());
      if (p === '/api/settings' && req.method === 'POST') { const values = await body(req); await saveSettings(values); Object.assign(process.env, Object.fromEntries(Object.entries(values).filter(([key]) => ['GITHUB_OWNER','GITHUB_REPO','GITHUB_POLL_INTERVAL_MS','WELCOME_CHANNEL_NAME','WELCOME_MENTION','WELCOME_INCLUDE_BOTS','WELCOME_MESSAGES_JSON','DASHBOARD_PORT'].includes(key)).map(([key,value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]))); if (actions.auditAction && guild?.id) await actions.auditAction(guild.id,'settings.saved',null,{keys:Object.keys(values).filter(key=>key!=='AI_API_KEY')}); publishLive('settings.saved', { keys: Object.keys(values).filter(key => key !== 'AI_API_KEY'), restartRequired: true }, { source: 'dashboard', communityId: guild?.id || null }); return json(res, 200, { ok: true, restartRequired: true }); }
      if (p === '/api/diagnostics' && req.method === 'GET') {
        const me = guild.members.me;
        const checks = [
          ['Discord Gateway', client?.isReady?.(), 'Bot ist mit Discord verbunden.'],
          ['Guild erreichbar', Boolean(guild?.id), 'Zielserver ist geladen.'],
          ['Administrator', Boolean(me?.permissions.has(PermissionFlagsBits.Administrator)), 'Administrator-Recht für die Dashboard-Aktionen.'],
          ['Manage Channels', Boolean(me?.permissions.has(PermissionFlagsBits.ManageChannels)), 'Channels erstellen/bearbeiten.'],
          ['Manage Roles', Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles)), 'Rollen verwalten.'],
          ['Manage Messages', Boolean(me?.permissions.has(PermissionFlagsBits.ManageMessages)), 'Nachrichtenmoderation.'],
          ['Kick Members', Boolean(me?.permissions.has(PermissionFlagsBits.KickMembers)), 'Mitglieder kicken.'],
          ['Ban Members', Boolean(me?.permissions.has(PermissionFlagsBits.BanMembers)), 'Mitglieder bannen.'],
          ['Moderate Members', Boolean(me?.permissions.has(PermissionFlagsBits.ModerateMembers)), 'Timeouts.'],
          ['Manage Webhooks', Boolean(me?.permissions.has(PermissionFlagsBits.ManageWebhooks)), 'Webhooks verwalten.'],
          ['Manage Guild', Boolean(me?.permissions.has(PermissionFlagsBits.ManageGuild)), 'Server- und Event-Einstellungen.'],
          ['Gateway: Guild Members', client?.options?.intents?.has?.(GatewayIntentBits.GuildMembers) ?? true, 'Mitglieder-Events.'],
        ];
        return json(res, 200, { checks: checks.map(([name, ok, detail]) => ({ name, ok: Boolean(ok), detail })), process: cpuSnapshot(), env: { tokenConfigured: Boolean(process.env.DISCORD_TOKEN), guildConfigured: Boolean(process.env.DISCORD_GUILD_ID), githubConfigured: Boolean(process.env.GITHUB_OWNER && process.env.GITHUB_REPO) } });
      }
      if (p === '/api/server' && req.method === 'GET') { return json(res, 200, { id: guild.id, name: guild.name, description: guild.description || '', icon: guild.iconURL({ size: 256 }), banner: guild.bannerURL({ size: 512 }), ownerId: guild.ownerId, memberCount: guild.memberCount, verificationLevel: guild.verificationLevel, defaultMessageNotifications: guild.defaultMessageNotifications, explicitContentFilter: guild.explicitContentFilter, afkTimeout: guild.afkTimeout, afkChannelId: guild.afkChannelId, systemChannelId: guild.systemChannelId, rulesChannelId: guild.rulesChannelId, publicUpdatesChannelId: guild.publicUpdatesChannelId, features: guild.features }); }
      if (p === '/api/server' && req.method === 'POST') { requireManage(guild); const v = await body(req); const patch = {}; for (const k of ['name', 'description', 'verificationLevel', 'defaultMessageNotifications', 'explicitContentFilter', 'afkTimeout']) if (v[k] !== undefined) patch[k] = v[k]; for (const k of ['afkChannelId', 'systemChannelId', 'rulesChannelId', 'publicUpdatesChannelId']) if (v[k] !== undefined) patch[k] = v[k] || null; await guild.edit(patch); dashboardLogger.info('Server-Einstellungen aktualisiert.'); return json(res, 200, { ok: true }); }
      if (p === '/api/channels' && req.method === 'GET') return json(res, 200, { channels: [...guild.channels.cache.values()].sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0)).map(channelDTO) });
      if (p === '/api/channels' && req.method === 'POST') { requireManage(guild); const v = await body(req); if (!v.name) throw new Error('Channel-Name fehlt.'); const created = await guild.channels.create({ name: String(v.name), type: Number(v.type ?? ChannelType.GuildText), parent: v.parentId || undefined, topic: v.topic || undefined, nsfw: Boolean(v.nsfw), rateLimitPerUser: Number(v.slowmode || 0) }); dashboardLogger.info(`Channel erstellt: ${created.name}`); return json(res, 200, { ok: true, channel: channelDTO(created) }); }
      if (p.startsWith('/api/channels/') && !p.endsWith('/permissions') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const c = getChannel(guild, id); if (!c) throw new Error('Channel nicht gefunden.'); const v = await body(req); if (v.action === 'delete') { await c.delete(v.reason || 'Dashboard'); dashboardLogger.warn(`Channel gelöscht: ${c.name}`); return json(res, 200, { ok: true }); } const patch = {}; for (const k of ['name', 'topic', 'nsfw', 'rateLimitPerUser', 'parent']) if (v[k] !== undefined) patch[k] = k === 'parent' ? (v[k] || null) : v[k]; if (v.position !== undefined) patch.position = Number(v.position); await c.edit(patch); return json(res, 200, { ok: true, channel: channelDTO(c) }); }
      if (p === '/api/channels/permissions' && req.method === 'GET') { const c = getChannel(guild, u.searchParams.get('channelId')); if (!c) throw new Error('Channel nicht gefunden.'); return json(res, 200, { permissions: [...c.permissionOverwrites.cache.values()].map(overwriteDTO), names: { ...Object.fromEntries([...guild.roles.cache.values()].map(r => [r.id, r.name])), [guild.id]: '@everyone' } }); }
      if (p === '/api/channels/permissions' && req.method === 'POST') { requireManage(guild); const v = await body(req); const c = getChannel(guild, v.channelId); if (!c) throw new Error('Channel nicht gefunden.'); if (v.action === 'delete') await c.permissionOverwrites.delete(String(v.id), 'Dashboard'); else await c.permissionOverwrites.edit(String(v.id), { allow: parseBitfield(v.allow), deny: parseBitfield(v.deny) }, { reason: 'Dashboard' }); return json(res, 200, { ok: true }); }
      if (p === '/api/roles' && req.method === 'GET') return json(res, 200, { roles: [...guild.roles.cache.values()].sort((a, b) => b.position - a.position).map(roleDTO) });
      if (p === '/api/roles' && req.method === 'POST') { requireManage(guild); const v = await body(req); if (!v.name) throw new Error('Rollenname fehlt.'); const role = await guild.roles.create({ name: String(v.name), color: v.color || undefined, hoist: Boolean(v.hoist), mentionable: Boolean(v.mentionable), permissions: v.permissions ? parseBitfield(v.permissions) : undefined, reason: v.reason || 'Dashboard' }); if (v.position !== undefined) await role.setPosition(Number(v.position)); return json(res, 200, { ok: true, role: roleDTO(role) }); }
      if (p.startsWith('/api/roles/') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const r = getRole(guild, id); if (!r) throw new Error('Rolle nicht gefunden.'); const v = await body(req); if (v.action === 'delete') { if (!r.editable) throw new Error('Rolle kann nicht verwaltet werden.'); await r.delete(v.reason || 'Dashboard'); return json(res, 200, { ok: true }); } const patch = {}; for (const k of ['name', 'color', 'hoist', 'mentionable']) if (v[k] !== undefined) patch[k] = v[k]; if (v.permissions !== undefined) patch.permissions = parseBitfield(v.permissions); if (Object.keys(patch).length) await r.edit(patch); if (v.position !== undefined) await r.setPosition(Number(v.position)); return json(res, 200, { ok: true, role: roleDTO(r) }); }
      if (p === '/api/members' && req.method === 'GET') { const q = (u.searchParams.get('q') || '').toLowerCase(); const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 100))); const members = await guild.members.fetch({ limit: Math.min(limit, 1000) }); let arr = [...members.values()]; if (q) arr = arr.filter(m => `${m.user.username} ${m.displayName} ${m.id}`.toLowerCase().includes(q)); return json(res, 200, { members: arr.slice(0, limit).map(memberDTO) }); }
      if (p.startsWith('/api/members/') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const m = await guild.members.fetch(id); const v = await body(req); if (v.action === 'timeout') await m.timeout(v.duration === 0 ? null : Number(v.duration), v.reason || 'Dashboard'); else if (v.action === 'kick') await m.kick(v.reason || 'Dashboard'); else if (v.action === 'ban') await m.ban({ deleteMessageSeconds: Number(v.deleteMessageSeconds || 0), reason: v.reason || 'Dashboard' }); else if (v.action === 'nickname') await m.setNickname(v.nickname || null, v.reason || 'Dashboard'); else if (v.action === 'role') { const r = getRole(guild, v.roleId); if (!r) throw new Error('Rolle nicht gefunden.'); if (v.mode === 'remove') await m.roles.remove(r, v.reason || 'Dashboard'); else await m.roles.add(r, v.reason || 'Dashboard'); } else throw new Error('Unbekannte Mitglieder-Aktion.'); return json(res, 200, { ok: true, member: memberDTO(m) }); }
      if (p === '/api/bans' && req.method === 'GET') { const bans = await guild.bans.fetch(); return json(res, 200, { bans: [...bans.values()].map(b => ({ id: b.user.id, username: b.user.username, tag: b.user.tag, reason: b.reason || '' })) }); }
      if (p === '/api/bans' && req.method === 'POST') { requireManage(guild); const v = await body(req); if (v.action === 'unban') { await guild.members.unban(String(v.userId), v.reason || 'Dashboard'); return json(res, 200, { ok: true }); } throw new Error('Unbekannte Ban-Aktion.'); }
      if (p === '/api/messages' && req.method === 'POST') { requireManage(guild); const v = await body(req); const c = getChannel(guild, v.channelId); if (!c?.isTextBased()) throw new Error('Textkanal nicht gefunden.'); const payload = { content: String(v.content || '').slice(0, 2000), allowedMentions: { parse: v.mentionEveryone ? ['users', 'roles', 'everyone'] : ['users'] } }; if (v.embedTitle || v.embedDescription) payload.embeds = [{ title: v.embedTitle || undefined, description: v.embedDescription || undefined, url: v.embedUrl || undefined }]; const msg = await c.send(payload); return json(res, 200, { ok: true, messageId: msg.id, url: msg.url }); }
      if (p === '/api/messages/recent' && req.method === 'GET') { const c = getChannel(guild, u.searchParams.get('channelId')); if (!c?.isTextBased() || !c.messages) throw new Error('Textkanal nicht gefunden.'); const messages = await c.messages.fetch({ limit: Math.min(100, Number(u.searchParams.get('limit') || 50)) }); return json(res, 200, { messages: [...messages.values()].map(m => ({ id: m.id, author: m.author?.tag, content: m.content, createdAt: m.createdAt, url: m.url, pinned: m.pinned, bot: m.author?.bot })) }); }
      if (p.startsWith('/api/messages/') && req.method === 'POST') { requireManage(guild); const v = await body(req); const parts = p.split('/'); const id = parts[3]; const c = getChannel(guild, v.channelId); if (!c?.isTextBased()) throw new Error('Textkanal fehlt.'); const m = await c.messages.fetch(id); if (v.action === 'delete') await m.delete(); else if (v.action === 'pin') await m.pin(); else if (v.action === 'unpin') await m.unpin(); else throw new Error('Unbekannte Nachrichten-Aktion.'); return json(res, 200, { ok: true }); }
      if (p === '/api/invites' && req.method === 'POST') { requireManage(guild); const v = await body(req); const c = getChannel(guild, v.channelId); if (!c?.isTextBased()) throw new Error('Textkanal nicht gefunden.'); const invite = await c.createInvite({ maxAge: Number(v.maxAge || 0), maxUses: Number(v.maxUses || 0), unique: true, reason: 'Dashboard' }); return json(res, 200, { ok: true, code: invite.code, url: invite.url }); }
      if (p === '/api/invites' && req.method === 'GET') { const invites = await guild.invites.fetch(); return json(res, 200, { invites: [...invites.values()].map(i => ({ code: i.code, url: i.url, channel: i.channel?.name || '', channelId: i.channelId, uses: i.uses, maxUses: i.maxUses, maxAge: i.maxAge, expiresAt: i.expiresAt })) }); }
      if (p.startsWith('/api/invites/') && req.method === 'POST') { requireManage(guild); const code = p.split('/').pop(); const v = await body(req); const invite = await client.fetchInvite(code); if (v.action === 'delete') await invite.delete('Dashboard'); return json(res, 200, { ok: true }); }
      if (p === '/api/audit' && req.method === 'GET') { const limit=Math.min(500,Math.max(1,Number(u.searchParams.get('limit')||100))); const source=u.searchParams.get('source')||null; return json(res,200,{entries:actions.audit?await actions.audit(guild.id,limit,source):[]}); }
      if (p === '/api/analytics' && req.method === 'GET') { const members = guild.memberCount; const bots = guild.members.cache.filter(m => m.user.bot).size; const online = guild.presences?.cache?.filter(pres => pres.status && pres.status !== 'offline').size || 0; return json(res, 200, { members, cachedMembers: guild.members.cache.size, bots, online, channels: guild.channels.cache.size, roles: guild.roles.cache.size, boosts: guild.premiumSubscriptionCount, boostTier: guild.premiumTier, features: guild.features }); }
      if (p === '/api/permissions' && req.method === 'GET') return json(res, 200, { permissions: permissionNames(), roles: [...guild.roles.cache.values()].map(roleDTO), channels: [...guild.channels.cache.values()].filter(c => !c.isThread()).map(channelDTO) });
      if (p === '/api/permissions/role' && req.method === 'POST') { requireManage(guild); const v = await body(req); const r = getRole(guild, v.roleId); if (!r?.editable) throw new Error('Rolle kann nicht verwaltet werden.'); await r.setPermissions(parseBitfield(v.permissions), 'Dashboard'); return json(res, 200, { ok: true, role: roleDTO(r) }); }
      if (p === '/api/webhooks' && req.method === 'GET') { const hooks = await guild.fetchWebhooks(); return json(res, 200, { webhooks: [...hooks.values()].map(w => ({ id: w.id, name: w.name, channelId: w.channelId, type: w.type, owner: w.owner?.tag || null, url: w.url || null })) }); }
      if (p === '/api/webhooks' && req.method === 'POST') { requireManage(guild); const v = await body(req); const c = getChannel(guild, v.channelId); if (!c?.isTextBased() || !c.createWebhook) throw new Error('Kanal unterstützt keine Webhooks.'); const w = await c.createWebhook({ name: String(v.name || 'WebRadio Webhook'), avatar: v.avatarBase64 ? Buffer.from(v.avatarBase64, 'base64') : undefined, reason: 'Dashboard' }); return json(res, 200, { ok: true, webhook: { id: w.id, name: w.name, url: w.url, token: w.token } }); }
      if (p.startsWith('/api/webhooks/') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const v = await body(req); const hooks = await guild.fetchWebhooks(); const w = hooks.get(id); if (!w) throw new Error('Webhook nicht gefunden.'); if (v.action === 'delete') await w.delete('Dashboard'); else await w.edit({ name: v.name, channel: v.channelId || undefined, reason: 'Dashboard' }); return json(res, 200, { ok: true }); }
      if (p === '/api/events' && req.method === 'GET') { const events = await guild.scheduledEvents.fetch(); return json(res, 200, { events: [...events.values()].map(e => ({ id: e.id, name: e.name, description: e.description, status: e.status, entityType: e.entityType, start: e.scheduledStartAt, end: e.scheduledEndAt, channelId: e.channelId, location: e.entityMetadata?.location || null, url: e.url })) }); }
      if (p === '/api/events' && req.method === 'POST') { requireManage(guild); const v = await body(req); const event = await guild.scheduledEvents.create({ name: v.name, description: v.description || undefined, scheduledStartTime: new Date(v.start), scheduledEndTime: v.end ? new Date(v.end) : undefined, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, entityType: Number(v.entityType || GuildScheduledEventEntityType.External), entityMetadata: Number(v.entityType || GuildScheduledEventEntityType.External) === GuildScheduledEventEntityType.External ? { location: v.location || 'WebRadio Community' } : undefined, reason: 'Dashboard' }); return json(res, 200, { ok: true, id: event.id }); }
      if (p.startsWith('/api/events/') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const e = await guild.scheduledEvents.fetch(id); const v = await body(req); if (v.action === 'delete') await e.delete('Dashboard'); else if (v.action === 'start') await e.setStatus(GuildScheduledEventStatus.Active, 'Dashboard'); else if (v.action === 'end') await e.setStatus(GuildScheduledEventStatus.Completed, 'Dashboard'); else await e.edit({ name: v.name, description: v.description, scheduledStartTime: v.start ? new Date(v.start) : undefined, scheduledEndTime: v.end ? new Date(v.end) : undefined, reason: 'Dashboard' }); return json(res, 200, { ok: true }); }
      if (p === '/api/automod' && req.method === 'GET') { const rules = await guild.autoModerationRules.fetch(); return json(res, 200, { rules: [...rules.values()].map(r => ({ id: r.id, name: r.name, enabled: r.enabled, eventType: r.eventType, triggerType: r.triggerType, triggerMetadata: r.triggerMetadata, actions: r.actions?.toJSON?.() || r.actions })) }); }
      if (p === '/api/automod' && req.method === 'POST') { requireManage(guild); const v = await body(req); const rule = await guild.autoModerationRules.create({ name: v.name, eventType: Number(v.eventType || AutoModerationRuleEventType.MessageSend), triggerType: Number(v.triggerType || AutoModerationRuleTriggerType.Keyword), triggerMetadata: v.triggerMetadata || {}, actions: v.actions || [{ type: AutoModerationActionType.BlockMessage }], enabled: v.enabled !== false, exemptRoles: v.exemptRoles || [], exemptChannels: v.exemptChannels || [], reason: 'Dashboard' }); return json(res, 200, { ok: true, id: rule.id }); }
      if (p.startsWith('/api/automod/') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const v = await body(req); if (v.action === 'delete') await guild.autoModerationRules.delete(id, 'Dashboard'); else await guild.autoModerationRules.edit(id, v, 'Dashboard'); return json(res, 200, { ok: true }); }
      if (p === '/api/emojis' && req.method === 'GET') return json(res, 200, { emojis: [...guild.emojis.cache.values()].map(e => ({ id: e.id, name: e.name, animated: e.animated, url: e.imageURL(), managed: e.managed })) });
      if (p === '/api/emojis' && req.method === 'POST') { requireManage(guild); const v = await body(req); if (!v.name || !v.imageBase64) throw new Error('Name und Base64-Bild fehlen.'); const e = await guild.emojis.create({ attachment: Buffer.from(v.imageBase64, 'base64'), name: v.name, reason: 'Dashboard' }); return json(res, 200, { ok: true, emoji: { id: e.id, name: e.name, url: e.imageURL() } }); }
      if (p.startsWith('/api/emojis/') && req.method === 'POST') { requireManage(guild); const e = guild.emojis.cache.get(p.split('/').pop()); if (!e) throw new Error('Emoji nicht gefunden.'); await e.delete('Dashboard'); return json(res, 200, { ok: true }); }
      if (p === '/api/stickers' && req.method === 'GET') return json(res, 200, { stickers: [...guild.stickers.cache.values()].map(s => ({ id: s.id, name: s.name, description: s.description, tags: s.tags, url: s.url, format: s.format })) });
      if (p === '/api/stickers' && req.method === 'POST') { requireManage(guild); const v = await body(req); if (!v.name || !v.fileBase64 || !v.tags) throw new Error('Name, Base64-Datei und Tags fehlen.'); const sticker = await guild.stickers.create({ file: Buffer.from(v.fileBase64, 'base64'), name: v.name, description: v.description || undefined, tags: v.tags, reason: 'Dashboard' }); return json(res, 200, { ok: true, sticker: { id: sticker.id, name: sticker.name, url: sticker.url } }); }
      if (p.startsWith('/api/stickers/') && req.method === 'POST') { requireManage(guild); const s = guild.stickers.cache.get(p.split('/').pop()); if (!s) throw new Error('Sticker nicht gefunden.'); await s.delete('Dashboard'); return json(res, 200, { ok: true }); }
      if (p === '/api/threads' && req.method === 'GET') { const threads = []; for (const c of guild.channels.cache.values()) if (c.isTextBased?.() && c.threads?.cache) threads.push(...c.threads.cache.values()); return json(res, 200, { threads: threads.map(t => ({ id: t.id, name: t.name, parentId: t.parentId, archived: t.archived, locked: t.locked, members: t.memberCount, url: t.url })) }); }
      if (p === '/api/threads' && req.method === 'POST') { requireManage(guild); const v = await body(req); const c = getChannel(guild, v.channelId); if (!c?.threads) throw new Error('Kanal unterstützt keine Threads.'); const t = await c.threads.create({ name: v.name, autoArchiveDuration: Number(v.autoArchiveDuration || 1440), message: v.message ? { content: v.message } : undefined, reason: 'Dashboard' }); return json(res, 200, { ok: true, id: t.id }); }
      if (p.startsWith('/api/threads/') && req.method === 'POST') { requireManage(guild); const id = p.split('/').pop(); const v = await body(req); const t = guild.channels.cache.get(id); if (!t?.isThread?.()) throw new Error('Thread nicht gefunden.'); if (v.action === 'archive') await t.setArchived(true, 'Dashboard'); else if (v.action === 'unarchive') await t.setArchived(false, 'Dashboard'); else if (v.action === 'lock') await t.setLocked(true, 'Dashboard'); else if (v.action === 'unlock') await t.setLocked(false, 'Dashboard'); else if (v.action === 'delete') await t.delete('Dashboard'); return json(res, 200, { ok: true }); }
      if (p === '/api/welcome' && req.method === 'GET') return json(res, 200, settings());
      if (p === '/api/welcome' && req.method === 'POST') { const v = await body(req); await saveSettings({ WELCOME_CHANNEL_NAME: v.channelName, WELCOME_MENTION: v.mention, WELCOME_INCLUDE_BOTS: v.includeBots, WELCOME_MESSAGES_JSON: v.templates || [] }); process.env.WELCOME_CHANNEL_NAME = v.channelName; process.env.WELCOME_MENTION = String(v.mention); process.env.WELCOME_INCLUDE_BOTS = String(v.includeBots); process.env.WELCOME_MESSAGES_JSON = JSON.stringify(v.templates || []); return json(res, 200, { ok: true }); }
      if (p === '/api/welcome/test' && req.method === 'POST') { requireManage(guild); const v = await body(req); const c = getChannel(guild, v.channelId || process.env.WELCOME_CHANNEL_NAME); if (!c?.isTextBased()) throw new Error('Welcome-Kanal nicht gefunden.'); await c.send({ content: v.content || '👋 Willkommen in der WebRadio Community!' }); return json(res, 200, { ok: true }); }
      if (p === '/api/reaction-roles' && req.method === 'GET') { return json(res, 200, database?.getReactionRoleState?.(guild.id) || { panelMessageId: null, roleIds: {} }); }
      if (p === '/api/reaction-roles' && req.method === 'POST') { const v = await body(req); if (v.action === 'sync' && actions.reactionRoles) { const result = await actions.reactionRoles(guild); return json(res, 200, { ok: true, result: result?.id || null }); } throw new Error('Unbekannte Reaction-Role-Aktion.'); }
      if (p === '/api/onboarding' && req.method === 'POST') { if (!actions.onboarding) throw new Error('Onboarding-Aktion nicht verfügbar.'); const result = await actions.onboarding(guild); return json(res, 200, { ok: true, result: result || null }); }
      if (p === '/api/integrations' && req.method === 'GET') { const integrations = await guild.fetchIntegrations().catch(() => null); return json(res, 200, { supported: Boolean(integrations), integrations: integrations ? [...integrations.values()].map(i => ({ id: i.id, name: i.name, type: i.type, enabled: i.enabled, account: i.account ? { id: i.account.id, name: i.account.name } : null })) : [] }); }
      if (p === '/api/backups' && req.method === 'GET') { await fs.mkdir(BACKUP_DIR, { recursive: true }); const files = await fs.readdir(BACKUP_DIR); return json(res, 200, { backups: (await Promise.all(files.filter(f => f.endsWith('.json')).map(async f => ({ file: f, size: (await fs.stat(path.join(BACKUP_DIR, f))).size })))).sort((a,b) => a.file.localeCompare(b.file)).reverse() }); }
      if (p === '/api/backups' && req.method === 'POST') { requireManage(guild); const result = await writeBackup(guild); dashboardLogger.info(`Backup erstellt: ${path.basename(result.file)}`); return json(res, 200, { ok: true, file: path.basename(result.file), data: result.data }); }
      if (p === '/api/backups/file' && req.method === 'GET') { const name=u.searchParams.get('name'); if(!name||name.includes('..')||path.basename(name)!==name) throw new Error('Ungültiger Backup-Name.'); const file=path.join(BACKUP_DIR,name); const data=await fs.readFile(file); res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename=\"${name}\"`,'Content-Length':data.length}); return res.end(data); }
      if (p === '/api/backups' && req.method === 'DELETE') { const name=u.searchParams.get('name'); if(!name||name.includes('..')||path.basename(name)!==name) throw new Error('Ungültiger Backup-Name.'); await fs.unlink(path.join(BACKUP_DIR,name)); return json(res,200,{ok:true}); }
      if (p === '/api/backups/restore' && req.method === 'POST') { requireManage(guild); const v = await body(req); const data = v.data; if (!data?.roles || !data?.channels) throw new Error('Ungültiges Backup.'); const roleMap = new Map(); for (const r of data.roles) { let role = guild.roles.cache.find(x => x.name === r.name && !x.managed); if (!role) role = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: parseBitfield(r.permissions), reason: 'Dashboard Backup Restore' }); else await role.edit({ color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: parseBitfield(r.permissions), reason: 'Dashboard Backup Restore' }); roleMap.set(r.id, role.id); }
        const categoryMap = new Map(); for (const c of data.channels.filter(x => x.type === ChannelType.GuildCategory)) { let existing = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name === c.name); if (!existing) existing = await guild.channels.create({ name: c.name, type: ChannelType.GuildCategory, reason: 'Dashboard Backup Restore' }); categoryMap.set(c.id, existing.id); }
        for (const c of data.channels.filter(x => x.type !== ChannelType.GuildCategory)) { let existing = guild.channels.cache.find(x => x.type === c.type && x.name === c.name); if (!existing) existing = await guild.channels.create({ name: c.name, type: c.type, parent: categoryMap.get(c.parentId), topic: c.topic || undefined, nsfw: c.nsfw, rateLimitPerUser: c.slowmode || 0, reason: 'Dashboard Backup Restore' }); else await existing.edit({ parent: categoryMap.get(c.parentId) || null, topic: c.topic || undefined, nsfw: c.nsfw, rateLimitPerUser: c.slowmode || 0, reason: 'Dashboard Backup Restore' }); }
        dashboardLogger.info('Backup-Wiederherstellung abgeschlossen.'); return json(res, 200, { ok: true }); }
      if (p === '/api/bot/control' && req.method === 'POST') { const { action } = await body(req); if (!['botRestart', 'botStop', 'botStart'].includes(action) || !actions[action]) return json(res, 400, { ok: false, error: 'Unbekannte Bot-Aktion.' }); dashboardLogger.info(`Bot-Steuerung: ${action}`); botState.lastAction = { action, time: timestamp() }; const result = await actions[action](guild); if(actions.auditAction && guild?.id) await actions.auditAction(guild.id,`dashboard.bot.${action}`,null,{}); publishLive('bot.action.completed',{action,result:result??null},{source:'dashboard',communityId:guild?.id||null}); return json(res, 200, { ok: true, result: result ?? null }); }
      if (p === '/api/action' && req.method === 'POST') { const { action } = await body(req); const allowedActions = new Set(['sync','reactionRoles','setup','onboarding']); if (!allowedActions.has(action) || !actions[action]) return json(res, 400, { ok: false, error: 'Unbekannte Aktion.' }); dashboardLogger.info(`Dashboard-Aktion: ${action}`); botState.lastAction = { action, time: timestamp() }; const result = await actions[action](guild); if(actions.auditAction && guild?.id) await actions.auditAction(guild.id,`dashboard.action.${action}`,null,{}); publishLive('dashboard.action.completed',{action},{source:'dashboard',communityId:guild?.id||null}); return json(res, 200, { ok: true, result: result ?? null }); }
      if (p === '/' || p === '/index.html') { const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html); }
      return json(res, 404, { error: 'Not found' });
    } catch (error) { dashboardLogger.error('Dashboard-Fehler:', error); return json(res, 500, { ok: false, error: error?.message || String(error) }); }
  });
  const bindHost = String(host || '127.0.0.1').trim() || '127.0.0.1';
  let boundPort = port;
  const bind = () => server.listen(boundPort, bindHost, () => {
    botState.dashboardPort = boundPort;
    const wildcard = bindHost === '0.0.0.0' || bindHost === '::';
    dashboardLogger.info(`✓ Dashboard lauscht auf ${bindHost}:${boundPort}${wildcard ? ' (alle Netzwerk-Interfaces)' : ''}`);
    if (wildcard && !authEnabled()) dashboardLogger.warn('⚠ Dashboard ist ohne Passwort im Netzwerk erreichbar. Zugriff unbedingt per Firewall auf das private LAN begrenzen; keine Router-Portfreigabe einrichten.');
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && boundPort < port + 20) { dashboardLogger.warn(`⚠ Dashboard-Port ${boundPort} ist belegt – versuche ${boundPort + 1}.`); boundPort += 1; setTimeout(bind, 50); return; }
    dashboardLogger.error('Dashboard-Serverfehler:', error);
  });
  bind();
  return server;
}
