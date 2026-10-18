import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
const source=await readFile(new URL('../../src/gmail-oauth-state.js',import.meta.url),'utf8');
const options={modules:true,script:source+'\nexport default {fetch(){return new Response("test-only")}}',compatibilityDate:'2026-10-13',durableObjects:{GMAIL_OAUTH_STATE:{className:'GmailOAuthState',useSQLite:true}}};
const call=(stub,method,data)=>stub.fetch('https://state/email-review',{method,body:JSON.stringify(data)});
const value=()=>({owner:'synthetic-staff',expires:Date.now()+60000,message:{recipients:['guest@example.test'],subject:'Reviewed',body:'Synthetic private notice'}});
test('workerd SQLite transaction allows exactly one of 24 concurrent claims and retains the claim after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sakan-runtime-'));
 let mf=new Miniflare({...options,durableObjectsPersist:directory});
 try{
  let ns=await mf.getDurableObjectNamespace('GMAIL_OAUTH_STATE');
  let stub=ns.get(ns.idFromName('review-one'));
  assert.equal((await call(stub,'PUT',value())).status,200);
  assert.equal((await call(stub,'POST',{owner:'other-staff'})).status,409);
  const responses=await Promise.all(Array.from({length:24},()=>call(stub,'POST',{owner:'synthetic-staff'})));
  assert.equal(responses.filter(r=>r.status===200).length,1);
  assert.equal(responses.filter(r=>r.status===409).length,23);
  const claimed=await responses.find(r=>r.status===200).json();
  assert.equal(claimed.message.body,'Synthetic private notice');
  await mf.dispose();
  mf=new Miniflare({...options,durableObjectsPersist:directory});
  ns=await mf.getDurableObjectNamespace('GMAIL_OAUTH_STATE');stub=ns.get(ns.idFromName('review-one'));
  assert.equal((await call(stub,'POST',{owner:'synthetic-staff'})).status,409);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
test('workerd alarm cleans expired review storage and expired reviews cannot be claimed',async()=>{
 const mf=new Miniflare(options);
 try{
  const ns=await mf.getDurableObjectNamespace('GMAIL_OAUTH_STATE');const stub=ns.get(ns.idFromName('expiry'));
  assert.equal((await call(stub,'PUT',{...value(),expires:Date.now()+2000})).status,200);
  await new Promise(resolve=>setTimeout(resolve,2100));
  assert.equal((await call(stub,'POST',{owner:'synthetic-staff'})).status,409);
  let cleared=false;
  for(let attempt=0;attempt<40;attempt++){
   if((await call(stub,'PUT',value())).status===200){cleared=true;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(cleared,true,'scheduled alarm must remove the expired review, not merely reject its claim');
 }finally{await mf.dispose();}
});
