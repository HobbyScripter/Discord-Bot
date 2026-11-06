import test from 'node:test';
import assert from 'node:assert/strict';
import { SecurityResponseManager } from '../src/core/security-response.js';

function fakeDb(){
  const rows=new Map(); let next=1;
  return {
    createSecurityActionConfirmation(guildId,data){const id=next++;const row={id,guild_id:guildId,requested_by:data.requestedBy,action:data.action,args:data.args,reason:data.reason,status:'pending',expires_at:data.expiresAt};rows.set(id,row);return row;},
    getSecurityActionConfirmation(_g,id){return rows.get(Number(id))||null;},
    listSecurityActionConfirmations(){return [...rows.values()];},
    updateSecurityActionConfirmation(_g,id,data){const r=rows.get(Number(id));Object.assign(r,{status:data.status,confirmed_by:data.confirmedBy});return r;},
  };
}

test('security response requests require RBAC and explicit confirmation', async()=>{
  const db=fakeDb(); const audit={recordCore(){}}; const events={publish(){}};
  const rbac={can(_g,_u,p){return p==='security.respond';}};
  const client={guilds:{cache:new Map([['g',{channels:{cache:new Map()},roles:{everyone:{id:'everyone'}}}]])}};
  const manager=new SecurityResponseManager({client,db,audit,events,rbac});
  const request=await manager.request({guildId:'g',actorId:'u',action:'channel.lock',args:{channelId:'c'},reason:'test'});
  assert.equal(request.requiresConfirmation,true); assert.equal(request.confirmation.status,'pending');
  await assert.rejects(()=>manager.request({guildId:'g',actorId:null,action:'channel.lock',args:{channelId:'c'}}),/Keine Berechtigung/);
  await assert.rejects(()=>manager.confirm({guildId:'g',confirmationId:request.confirmation.id,actorId:'u'}),/Kanal konnte nicht gesperrt werden/);
  assert.equal(db.getSecurityActionConfirmation('g',request.confirmation.id).status,'pending');
});
