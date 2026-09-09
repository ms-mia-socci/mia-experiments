import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createThread,beginRun,getItem,putItem,decideApproval,updateMeta,appendEvent,getEvents} from '../shared/store.js';
const directory=mkdtempSync(join(tmpdir(),'agui-lab-test-'));
process.env.LAB_DB=join(directory,'test.sqlite');
after(()=>rmSync(directory,{recursive:true,force:true}));
test('run ownership and active-run lease prevent overlapping or cross-user runs',()=>{
  const t=createThread('mia');
  assert.throws(()=>beginRun(t.id,'tim','hello'),/NOT_FOUND/);
  const run=beginRun(t.id,'mia','hello');
  assert.throws(()=>beginRun(t.id,'mia','again'),/BUSY/);
  assert.equal(getItem(t.id)?.activeRun,run.activeRun);
});
test('approval is owner-bound, single-use, current-run-bound and expires',()=>{
  const t=createThread('mia');const run=beginRun(t.id,'mia','fix');
  const request=(id:string,extra={})=>putItem(t.id,`APPROVAL#${id}`,{id,runId:run.activeRun,status:'pending',expiresAt:Date.now()+10000,...extra});
  request('valid');
  assert.throws(()=>decideApproval(t.id,'tim','valid','approved'),/NOT_FOUND/);
  assert.throws(()=>decideApproval(t.id,'mia','valid','anything'),/INVALID/);
  decideApproval(t.id,'mia','valid','approved');
  assert.throws(()=>decideApproval(t.id,'mia','valid','denied'),/EXPIRED/);
  assert.equal(getItem(t.id,'APPROVAL#valid')?.status,'approved');
  request('old',{runId:'old-run'});assert.throws(()=>decideApproval(t.id,'mia','old','approved'),/EXPIRED/);
  request('expired',{expiresAt:Date.now()-1});assert.throws(()=>decideApproval(t.id,'mia','expired','approved'),/EXPIRED/);
  request('cancelled');updateMeta(t.id,{cancelRequested:true});assert.throws(()=>decideApproval(t.id,'mia','cancelled','approved'),/EXPIRED/);
});
test('event replay preserves ordering and filters thread and run',()=>{
  appendEvent('a','1',{type:'RUN_STARTED'});appendEvent('b','1',{type:'OTHER'});appendEvent('a','2',{type:'OTHER'});appendEvent('a','1',{type:'RUN_FINISHED'});
  assert.deepEqual(getEvents('a','1').map(e=>e.type),['RUN_STARTED','RUN_FINISHED']);
});
