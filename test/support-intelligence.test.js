import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportIntelligence } from '../src/core/support-intelligence.js';

test('support intelligence links security triage to an incident without destructive actions', async () => {
  const events=[]; const audit=[]; let nextIncident=41;
  const ticket={id:7,status:'open',support_mode:'ai',category:'security',priority:'normal',subject:'Phishing',summary:'suspicious link'};
  const tickets={
    list:()=>[ticket],
    update:(_g,_id,p)=>Object.assign(ticket,p),
  };
  const incidents={create:(_g,data)=>({id:nextIncident++,...data})};
  const db={
    linkTicketIncident:(_g,t,i,a)=>({ticket_id:t,incident_id:i,linked_by:a}),
    listTicketIncidents:()=>[], listTicketAIAnalyses:()=>[], listTicketMessages:()=>[],
    searchKnowledgeRanked:()=>[], supportSLA:()=>[{priority:'urgent',first_response_minutes:1,resolution_minutes:2,enabled:true}]
  };
  const rbac={can:()=>true};
  const supportWorkflow={triage:async()=>({ticketId:7,recommendation:{mode:'security',priority:'urgent',confidence:'rule-assisted'},analysis:{content:'security'}})};
  const svc=new SupportIntelligence({db,tickets,incidents,supportWorkflow,aiAgent:{},rbac,events:{publish:(...e)=>events.push(e)},audit:{recordCore:(...e)=>audit.push(e)}});
  const result=await svc.triageAndRoute('g','u',7);
  assert.equal(result.routed,true);
  assert.equal(result.incident.id,41);
  assert.equal(ticket.status,'escalated');
  assert.ok(events.some(e=>e[0]==='support.ticket.incident.linked'));
  assert.ok(audit.some(e=>e[1]==='support.ticket.incident.linked'));
});
