import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { AIProviderManager } from '../src/ai/provider-manager.js';

test('AI provider fallback survives a primary provider failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-ai-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({id:'g1',name:'AI Test'});
  db.setAIProvider('g1',{provider:'openai-compatible',model:'primary',baseUrl:'http://primary/v1',apiKey:''});
  db.saveAIProviderSlot('g1',{slotId:'local',label:'Local fallback',provider:'ollama',model:'fallback',baseUrl:'http://ollama:11434',priority:10,enabled:true,secret:''});
  const events=new CoreEventBus(); const seen=[]; events.subscribe(e=>seen.push(e));
  const manager=new AIProviderManager(db,events,null);
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async (url,opts)=>{
    if(String(url).includes('primary')) return new Response(JSON.stringify({error:'down'}),{status:503});
    return new Response(JSON.stringify({message:{content:'fallback works'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const result=await manager.chatWithMeta('g1',[{role:'user',content:'hello'}]);
    assert.equal(result.content,'fallback works');
    assert.equal(result.slotId,'local');
    assert.equal(result.fallbackUsed,true);
    assert.ok(seen.some(e=>e.type==='ai.provider.failed'));
    assert.ok(seen.some(e=>e.type==='ai.provider.fallback.used'));
  } finally { globalThis.fetch=oldFetch; db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('knowledge retrieval ranks title and tags above weak content matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-kb-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  db.upsertCommunity({id:'g1',name:'KB Test'});
  db.upsertKnowledge('g1',null,'Raid protection','Generic operational notes','');
  db.upsertKnowledge('g1',null,'Security guide','This document discusses other topics.','raid security');
  const results=db.searchKnowledgeRanked('g1','raid security',2);
  assert.equal(results.length,2);
  assert.equal(results[0].title,'Security guide');
  assert.ok(results[0].score>results[1].score);
  db.close(); fs.rmSync(dir,{recursive:true,force:true});
});
