import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { AIAgentOperations } from '../src/ai/agent-operations.js';

test('AI Agent sessions and run history are durable and isolated per community', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-core-agent-'));
  const db = new CommunityDatabase(path.join(dir, 'core.sqlite'));
  const bus = new CoreEventBus();
  const events=[]; bus.subscribe(e=>events.push(e));
  db.upsertCommunity({id:'guild-1',name:'One'});
  db.upsertCommunity({id:'guild-2',name:'Two'});
  const ops = new AIAgentOperations({db,events:bus});
  const session=ops.createSession('guild-1','user-1','Operator Session');
  assert.equal(session.status,'active');
  const run=ops.recordRun('guild-1',{sessionId:session.id,userId:'user-1',kind:'tool-request',status:'pending-confirmation',tool:'discord.send-message',confirmationId:4,request:{channelId:'c'},result:{requiresConfirmation:true}});
  assert.equal(ops.runs('guild-1',{sessionId:session.id})[0].confirmation_id,4);
  assert.equal(ops.runs('guild-2').length,0);
  assert.equal(ops.metrics('guild-1').toolRequests,1);
  assert.ok(events.some(e=>e.type==='ai.agent.session.created'));
  assert.ok(events.some(e=>e.type==='ai.agent.run.changed' && e.payload.runId===run.id));
  db.close(); fs.rmSync(dir,{recursive:true,force:true});
});
