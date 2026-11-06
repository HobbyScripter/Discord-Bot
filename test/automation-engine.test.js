import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreEventBus } from '../src/core/event-bus.js';
import { AutomationEngine } from '../src/core/automation-engine.js';

function dbStub() {
  let next=1; const jobs=[]; const runs=[];
  return {
    jobs, runs,
    listAutomations: () => jobs,
    db: { prepare(sql) { return { run(...args) { if(sql.includes('INSERT INTO automation_runs')) { const id=next++; runs.push({id,args,status:args[3] || 'running'}); return {lastInsertRowid:id}; } if(sql.includes('UPDATE automation_runs')) { const id=args.at(-1); const row=runs.find(x=>x.id===id); if(row) row.status=args[0]; return {}; } return {}; } }; } }
  };
}

test('automation supports conditions, cooldown and durable run records', async () => {
  const db=dbStub(); db.jobs.push({id:1,name:'test',enabled:true,trigger:{type:'demo',conditions:[{path:'payload.score',operator:'gte',value:10}],cooldownMs:1000},actions:[{type:'custom'}]});
  const bus=new CoreEventBus(); let count=0; const engine=new AutomationEngine(db,bus,{recordCore(){}},{custom:async()=>{count++;}});
  bus.publish('demo',{score:5},{source:'test',communityId:'g'});
  await new Promise(r=>setTimeout(r,10)); assert.equal(count,0);
  bus.publish('demo',{score:10},{source:'test',communityId:'g'});
  bus.publish('demo',{score:20},{source:'test',communityId:'g'});
  await new Promise(r=>setTimeout(r,20)); assert.equal(count,1); assert.ok(db.runs.some(r=>r.status==='success')); assert.ok(db.runs.some(r=>r.status==='skipped'));
  engine.close();
});

test('automation retries failed handlers', async () => {
  const db=dbStub(); db.jobs.push({id:2,name:'retry',enabled:true,trigger:{type:'retry'},actions:[{type:'custom',retries:2,retryDelayMs:100}]});
  const bus=new CoreEventBus(); let attempts=0; const engine=new AutomationEngine(db,bus,{recordCore(){}},{custom:async()=>{attempts++; if(attempts<3) throw new Error('temporary');}});
  bus.publish('retry',{}, {source:'test',communityId:'g'}); await new Promise(r=>setTimeout(r,350)); assert.equal(attempts,3); assert.ok(db.runs.some(r=>r.status==='success')); engine.close();
});
