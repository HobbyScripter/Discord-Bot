import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { DiscordToolGateway } from '../src/core/discord-tools.js';

function setup(){
  const db=new CommunityDatabase(`/tmp/community-core-tool-${process.pid}-${Math.random().toString(16).slice(2)}.sqlite`);
  db.upsertCommunity({id:'g',name:'Test'});
  const events=new CoreEventBus(); const seen=[]; events.subscribe(e=>seen.push(e));
  const rbac={can:(g,u,p)=>['ai.tools.use','ai.tools.execute'].includes(p)};
  const guild={id:'g',roles:{everyone:{id:'g'}},channels:{cache:new Map([['c',{id:'c',name:'general',isTextBased:()=>true,send:async({content})=>({id:'m',content}),setRateLimitPerUser:async()=>{}}]])}};
  const client={guilds:{cache:new Map([['g',guild]])}};
  const gateway=new DiscordToolGateway({client,db,events,rbac,audit:{recordCore(){}}});
  return {db,gateway,seen};
}

test('destructive tools always require confirmation and execute only after confirmation',async()=>{
  const {db,gateway,seen}=setup();
  const requested=await gateway.request({guildId:'g',userId:'u',tool:'discord.send-message',args:{channelId:'c',content:'hello'},reason:'test'});
  assert.equal(requested.executed,false); assert.equal(requested.requiresConfirmation,true);
  const executed=await gateway.confirm({guildId:'g',confirmationId:requested.confirmation.id,actorId:'u'});
  assert.equal(executed.executed,true); assert.equal(executed.result.id,'m');
  assert.ok(seen.some(e=>e.type==='ai.tool.confirmation.requested'));
  assert.ok(seen.some(e=>e.type==='ai.tool.executed'));
  db.close();
});
