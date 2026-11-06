import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportOperations } from '../src/core/support-operations.js';

test('SupportOperations aggregates SLA metrics and staff load', () => {
  const db={
    supportMetrics:()=>({total:3,open:2,resolved:1,firstResponseAvgMinutes:22.5,resolutionAvgMinutes:300,firstResponseBreaches:1,resolutionBreaches:2,byCategory:{technical:2,general:1},byPriority:{high:2,normal:1},byStaff:{u1:2},sla:[{priority:'high',first_response_minutes:30,resolution_minutes:480,enabled:true}]}),
    supportSLA:()=>[{priority:'high',first_response_minutes:30,resolution_minutes:480,enabled:true}],
    saveSupportSLA:(_g,rows)=>rows,
    addKnowledgeFeedback:()=>({ok:true}),
    knowledgeFeedbackStats:()=>({total:1,helpful:1,unhelpful:0})
  };
  const tickets={staff:()=>[{userId:'u1',status:'available'}]}; const events=[];
  const op=new SupportOperations({db,tickets,events:{publish:(...a)=>events.push(a)},audit:{recordCore(){}}});
  const overview=op.overview('g'); assert.equal(overview.firstResponseBreaches,1); assert.equal(overview.staff[0].openTickets,2);
  const sla=op.saveSLA('g',[{priority:'high',firstResponseMinutes:10,resolutionMinutes:100}], 'actor'); assert.equal(sla[0].firstResponseMinutes,10); assert.ok(events.some(x=>x[0]==='support.sla.changed'));
});

test('SupportOperations records knowledge feedback',()=>{const db={addKnowledgeFeedback:()=>({documentId:3,helpful:true}),knowledgeFeedbackStats:()=>({total:1,helpful:1,unhelpful:0})};const op=new SupportOperations({db,events:{publish(){}}});assert.equal(op.knowledgeFeedback('g',{documentId:3,userId:'u',helpful:true}).documentId,3);assert.equal(op.knowledgeStats('g',3).helpful,1);});
