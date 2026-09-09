import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {initializeWorkspace,readWorkspace,writeShipping,testShipping,makePatch,validateShipping} from '../agent/src/workspace.ts';
test('the sample reproduces the bug and the approved correction passes all tests',async()=>{
  const root=await mkdtemp(join(tmpdir(),'poc-test-'));
  try{
    await initializeWorkspace(root,resolve('sample'));
    const original=(await readWorkspace(root))['shipping.json'];
    assert.equal(testShipping(original).passed,false);
    assert.deepEqual(testShipping(original).results.filter(r=>!r.passed).map(r=>r.name),['Standard shipping on $50','Standard shipping on $75']);
    const corrected=JSON.stringify({...JSON.parse(original),freeShippingThreshold:50});
    await writeShipping(root,corrected);
    const after=await readFile(join(root,'shipping.json'),'utf8');
    assert.equal(testShipping(after).passed,true);
    assert.match(makePatch(original,after),/^-  "freeShippingThreshold": 100,/m);
    assert.match(makePatch(original,after),/^\+  "freeShippingThreshold": 50,/m);
    await initializeWorkspace(root,resolve('sample'));
    assert.equal(await readFile(join(root,'shipping.json'),'utf8'),after,'initialization does not overwrite approved changes');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('tool schema rejects code, extra fields, malformed JSON, and invalid prices',()=>{
  for(const input of ['process.env','null','[]','{"__proto__":{"polluted":true}}',JSON.stringify({currency:'USD',standardShipping:-1,freeShippingThreshold:50,expressShipping:15}),JSON.stringify({currency:'USD',standardShipping:7,freeShippingThreshold:50,expressShipping:15,command:'env'})]) assert.throws(()=>validateShipping(input));
});
test('separate conversations get independent filesystems',async()=>{
  const a=await mkdtemp(join(tmpdir(),'poc-a-')),b=await mkdtemp(join(tmpdir(),'poc-b-'));
  try{
    await Promise.all([initializeWorkspace(a,resolve('sample')),initializeWorkspace(b,resolve('sample'))]);
    await writeShipping(a,JSON.stringify({currency:'USD',standardShipping:7,freeShippingThreshold:50,expressShipping:15}));
    assert.equal(testShipping((await readWorkspace(a))['shipping.json']).passed,true);
    assert.equal(testShipping((await readWorkspace(b))['shipping.json']).passed,false);
  }finally{await Promise.all([rm(a,{recursive:true,force:true}),rm(b,{recursive:true,force:true})]);}
});
