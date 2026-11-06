import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommunityDatabase } from '../src/core/database.js';
import { CoreEventBus } from '../src/core/event-bus.js';
import { createCommunityCoreAPI } from '../src/core/api-v1.js';
import { backupDatabase, restoreDatabase } from '../src/core/database-backup.js';
import { runReleaseReadiness } from '../src/core/release-readiness.js';
function tempDir(){return fs.mkdtempSync(path.join(os.tmpdir(),'community-core-6-'));}
test('stable API v1 exposes its documented additive module surface',()=>{const events=new CoreEventBus();const api=createCommunityCoreAPI({events,capabilities:{stableRelease:true}});assert.equal(api.meta().version,'1.0');assert.equal(api.meta().capabilities.stableRelease,true);assert.equal(typeof api.events.publish,'function');assert.equal(typeof api.communities.all,'function');assert.equal(typeof api.modules.list,'function');});
test('release readiness passes a healthy core database',()=>{const dir=tempDir();const db=new CommunityDatabase(path.join(dir,'core.sqlite'));const events=new CoreEventBus();db.upsertCommunity({id:'guild-a',name:'A'});const api=createCommunityCoreAPI({database:db,events});const result=runReleaseReadiness({database:db,events,api,moduleManager:{list:()=>[]}});assert.equal(result.ok,true,JSON.stringify(result.checks.filter(x=>!x.ok)));assert.equal(result.checks.every(c=>c.ok),true);db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('SQLite backup and restore preserve community data',()=>{const dir=tempDir();const db=new CommunityDatabase(path.join(dir,'core.sqlite'));db.upsertCommunity({id:'guild-a',name:'A'});const backup=path.join(dir,'backup.sqlite');assert.ok(backupDatabase(db,backup).bytes>0);const restored=path.join(dir,'restored.sqlite');restoreDatabase(backup,restored);const copy=new CommunityDatabase(restored);assert.equal(copy.getCommunity('guild-a').name,'A');copy.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
