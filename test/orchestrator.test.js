import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreEventBus } from '../src/core/event-bus.js';
import { CoreOrchestrator } from '../src/core/orchestrator.js';

test('security incident creates one security ticket and does not duplicate it', async () => {
  const events = new CoreEventBus();
  const tickets = { items: [], list(){ return this.items; }, create(guildId, data){ const t={id:1,guildId,...data,status:data.status||'waiting_staff'}; this.items.push(t); return t; } };
  const incidents = { list(){ return []; }, create(){ throw new Error('not expected'); } };
  const audit = { recordCore(){} };
  const orchestrator = new CoreOrchestrator({events,incidents,tickets,audit});
  events.publish('incident.created',{id:42,type:'security',severity:'critical',summary:'Raid'},{communityId:'g'});
  await new Promise(r=>setImmediate(r));
  assert.equal(tickets.items.length,1);
  events.publish('incident.created',{id:42,type:'security',severity:'critical',summary:'Raid'},{communityId:'g'});
  await new Promise(r=>setImmediate(r));
  assert.equal(tickets.items.length,1);
  orchestrator.close();
});

test('ticket escalation creates a support incident', async () => {
  const events = new CoreEventBus();
  const incidents = { items:[], list(){return this.items;}, create(guildId,data){const i={id:7,guildId,...data,status:'open'};this.items.push(i);return i;} };
  const tickets = { list(){return [];} };
  const orchestrator = new CoreOrchestrator({events,incidents,tickets,audit:{recordCore(){}}});
  events.publish('ticket.updated',{id:9,status:'escalated',priority:'high',subject:'API issue'},{communityId:'g'});
  await new Promise(r=>setImmediate(r));
  assert.equal(incidents.items.length,1);
  assert.match(incidents.items[0].summary,/ticket:9/);
  orchestrator.close();
});
