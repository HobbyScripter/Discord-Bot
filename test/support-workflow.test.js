import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportWorkflow } from '../src/core/support-workflow.js';

test('support workflow creates conversation ticket and emits handoff safely', async () => {
  const events=[]; const audit=[];
  const state={id:7,status:'open',support_mode:'ai',category:'general',priority:'normal'};
  const tickets={
    create:(_g,d)=>({id:7,...d}),
    addMessage:()=>[],
    list:()=>[state],
    update:(_g,_id,p)=>Object.assign(state,p),
  };
  const rbac={can:()=>true};
  const aiAgent={analyzeTicket:async()=>({content:'technical bug and crash',provider:'test',model:'test'})};
  const wf=new SupportWorkflow({tickets,rbac,aiAgent,audit:{recordCore:(...x)=>audit.push(x)},events:{publish:(...x)=>events.push(x)}});
  const ticket=wf.createFromConversation('g','u',{subject:'Crash',content:'It crashes'});
  assert.equal(ticket.id,7);
  const triage=await wf.triage('g','u',7);
  assert.equal(triage.recommendation.mode,'technical');
  const handoff=wf.handoff('g','u',7,{mode:'technical',reason:'needs developer'});
  assert.equal(handoff.support_mode,'technical');
  assert.ok(events.some(e=>e[0]==='support.handoff.completed'));
  assert.ok(audit.some(e=>e[1]==='support.handoff.completed'));
});
