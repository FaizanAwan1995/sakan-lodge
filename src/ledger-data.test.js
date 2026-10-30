import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLedgerSnapshot, LEDGER_TABLES } from './ledger-data.js';

test('ledger loads complete transaction arrays above the table row limit in one snapshot',async()=>{
  const data=Object.fromEntries([...LEDGER_TABLES,'audit'].map(table=>[table,[]]));
  data.payments=Array.from({length:1501},(_,id)=>({id}));
  let calls=0;
  const result=await loadLedgerSnapshot({rpc:async(name)=>{calls++;assert.equal(name,'ledger_snapshot');return {data,error:null};}});
  assert.equal(result.payments.length,1501);
  assert.equal(calls,1);
});
test('missing ledger arrays fail instead of becoming a partial zero report',async()=>{
  await assert.rejects(()=>loadLedgerSnapshot({rpc:async()=>({data:{people:[]},error:null})}),/complete ledger snapshot/);
});
test('snapshot permission and network failures preserve errors for the ledger error screen',async()=>{
  const failure=new Error('Staff access required');
  await assert.rejects(()=>loadLedgerSnapshot({rpc:async()=>({data:null,error:failure})}),error=>error===failure);
});
test('missing snapshot migration fails with an actionable message and never falls back to partial tables',async()=>{
  await assert.rejects(()=>loadLedgerSnapshot({rpc:async()=>({data:null,error:{code:'PGRST202'}})}),/database update is pending/);
});

test('snapshot fetch has a bounded wait and propagates timeout to the retry screen',async()=>{
 let signal;const failure={message:'TimeoutError: request timed out'};
 await assert.rejects(()=>loadLedgerSnapshot({rpc:()=>({abortSignal(value){signal=value;return Promise.resolve({data:null,error:failure});}})}),error=>error===failure);assert.ok(signal instanceof AbortSignal);
});
