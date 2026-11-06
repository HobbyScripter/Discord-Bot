import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { RBACManager } from '../src/core/rbac.js';
import { IncidentManager } from '../src/core/incidents.js';
import { AutomationEngine } from '../src/core/automation-engine.js';

function db(){return new CommunityDatabase(`/tmp/community-core-${process.pid}-${Math.random().toString(16).slice(2)}.sqlite`)}
test('RBAC, incidents and automation are persistent and event-driven', async()=>{
 const d=db();d.upsertCommunity({id:'g',name:'Test'});const e=new CoreEventBus();const seen=[];e.subscribe(x=>seen.push(x));const audit={recordCore:()=>{}};const r=new RBACManager(d,e,audit);r.setRole('g','u','security');assert.equal(r.can('g','u','security.read'),true);assert.equal(r.can('g','u','automation.manage'),false);
 const i=new IncidentManager(d,e,audit);const incident=i.create('g',{title:'Raid',severity:'high'});assert.equal(i.list('g')[0].title,'Raid');i.update('g',incident.id,{status:'resolved'});assert.equal(i.list('g')[0].status,'resolved');
 d.saveAutomation('g',{name:'test',enabled:true,trigger:{type:'incident.created'},actions:[{type:'audit'}]});const a=new AutomationEngine(d,e,audit);e.publish('incident.created',{id:incident.id},{source:'incident',communityId:'g'});await new Promise(r=>setTimeout(r,20));assert.ok(seen.some(x=>x.type==='automation.executed'));a.close();d.close();
});
