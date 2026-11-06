import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';
function makeDb(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'staff-management-'));const db=new CommunityDatabase(path.join(dir,'core.sqlite'));db.upsertCommunity({id:'guild-a',name:'A'});db.upsertCommunity({id:'guild-b',name:'B'});db.upsertUser({id:'u1',username:'Alice',displayName:'Alice'});db.upsertMembership('guild-a','u1',{staff:true});return {db,dir};}
test('staff membership and groups are durable and isolated per community',()=>{const {db,dir}=makeDb();const id=db.saveStaffGroup('guild-a',{name:'Support',description:'Tickets'});db.setStaffGroupMember('guild-a',id,'u1',true);assert.equal(db.staffOverview('guild-a').total,1);assert.equal(db.listStaffGroups('guild-a')[0].members[0].user_id,'u1');assert.deepEqual(db.listStaffGroups('guild-b'),[]);assert.throws(()=>db.setStaffGroupMember('guild-b',id,'u1',true),/Staff-Gruppe nicht gefunden/);db.setStaffMember('guild-a','u1',false);assert.equal(db.staffOverview('guild-a').total,0);assert.equal(db.listStaffGroups('guild-a')[0].memberCount,0);db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('staff groups validate names and reject assigning non-staff users',()=>{const {db,dir}=makeDb();assert.throws(()=>db.saveStaffGroup('guild-a',{name:' '}),/Gruppenname/);const id=db.saveStaffGroup('guild-a',{name:'Moderation'});db.upsertUser({id:'u2',username:'Bob'});db.upsertMembership('guild-a','u2',{staff:false});assert.throws(()=>db.setStaffGroupMember('guild-a',id,'u2',true),/zuerst als Staff hinzufügen/);db.close();fs.rmSync(dir,{recursive:true,force:true});});
