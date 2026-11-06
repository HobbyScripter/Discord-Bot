import test from 'node:test';
import assert from 'node:assert/strict';
import { AIAgent } from '../src/ai/agent.js';

test('AI Agent exposes unified context and keeps Discord actions behind gateway', async () => {
  const events=[]; const audit=[]; const requested=[];
  const db={
    isAIEnabled:()=>true,
    getSettings:()=>({ 'ai.feature.discord_tools': true }),
    getSecurityState:()=>({score:12,level:'normal'}),
    listTickets:()=>[{id:1,status:'open'}],
    searchKnowledgeRanked:()=>[{id:2,title:'FAQ'}],
    listKnowledge:()=>[],
    listAudit:()=>[{type:'login'}],
  };
  const rbac={can:()=>true};
  const discordTools={
    catalog:()=>[{name:'discord.get-member',destructive:false,requiresConfirmation:false},{name:'discord.send-message',destructive:true,requiresConfirmation:true}],
    request:async args=>{requested.push(args);return args.tool==='discord.send-message'?{executed:false,requiresConfirmation:true,confirmation:{id:7}}:{executed:true,result:{id:'m'}};}
  };
  const agent=new AIAgent(db,{publish:(...a)=>events.push(a)},{recordCore:(...a)=>audit.push(a)},{},rbac,console,discordTools);
  const ctx=await agent.inspect('g','u','ticket');
  assert.equal(ctx.context.tickets.length,1);
  const tools=await agent.toolCatalog('g','u');
  assert.equal(tools.discord.length,2);
  const result=await agent.requestTool('g','u','discord.send-message',{channelId:'c',content:'hello'},'support');
  assert.equal(result.requiresConfirmation,true);
  assert.equal(requested[0].tool,'discord.send-message');
  assert.ok(events.some(e=>e[0]==='ai.agent.tool.requested'));
  assert.ok(audit.some(e=>e[1]==='ai.agent.tool.requested'));
});
