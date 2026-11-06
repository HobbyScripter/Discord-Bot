import test from 'node:test';
import assert from 'node:assert/strict';
import { SecurityEngine } from '../src/core/security.js';

function fakeDb() {
  const events=[]; const states=new Map();
  return {
    getSettings:()=>({}),
    activitySummary:(guild,minutes)=>({byType: minutes===5?{member_join:{count:12,users:12}}:{message:{count:80},reaction_add:{count:45}},recent:[]}),
    listAudit:()=>[],
    saveSecurityState:(g,s)=>states.set(g,s),
    getSecurityState:(g)=>states.get(g)||null,
    addAudit:(...a)=>{events.push(a);return events.length;},
  };
}
test('security engine detects a correlated burst without AI',()=>{
  const db=fakeDb(); const bus={subscribe:()=>()=>{},publish:(type,payload)=>{bus.last={type,payload};}};
  const engine=new SecurityEngine(db,bus);
  const result=engine.evaluate('guild');
  assert.equal(result.level,'critical');
  assert.ok(result.score >= 80);
  assert.ok(result.signals.some(s=>s.id==='join-burst'));
  assert.equal(bus.last.type,'security.risk.changed');
  engine.close();
});
