import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyBondReceipts({t,sql,rpc,STAFF,OTHER,applyMigration}){
 await sql('reset role');
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
 const property=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Bond receipt synthetic property',500,$1::date-28) returning id",[today])).rows[0].id;
 await sql("insert into contract_defaults(property_id,premises_address) values($1,'10 Synthetic Bond Road, Test SA')",[property]);
 const person=(await sql("insert into people(name,email,property_id,stay_type,weekly_rate,start_date,bond) values('Bond Receipt Synthetic','bond@example.test',$1,'long',255,$2::date-7,510) returning id",[property,today])).rows[0].id;
 const original={kind:'bond',date:today,amount:255,method:'transfer',received_by:'Faizan'};
 const historical=await rpc('account_transaction',[randomUUID(),person,original]);
 assert.equal(Number((await sql('select count(*) n from sakan_private.rent_invoices where payment_id=$1',[historical.id])).rows[0].n),0);
 await applyMigration();
 await t.test('only verified bond transactions can receive historic numbered receipts',async()=>{
  const draft=await rpc('staff_bond_payment_receipt',[historical.id,'preview',null]);
  assert.equal(draft.snapshot.document_type,'bond_receipt');
  assert.equal(Number(draft.snapshot.payment.amount),255);
  assert.equal(draft.snapshot.lines[0].description,'Refundable accommodation bond received');
  await assert.rejects(()=>rpc('staff_bond_payment_receipt',[historical.id,'issue',{}]),/Review the receipt again/);
  const issued=await rpc('staff_bond_payment_receipt',[historical.id,'issue',draft.snapshot]);
  assert.equal(issued.status,'queued');
  assert.equal((await rpc('staff_bond_payment_receipt',[historical.id,'issue',draft.snapshot])).existing,true);
  assert.equal(Number((await sql('select count(*) n from sakan_private.rent_invoices where payment_id=$1 and status<>\'void\'',[historical.id])).rows[0].n),1);
 });
 await t.test('a new bond payment queues its own document without touching rent income',async()=>{
  const id=randomUUID();
  const payment=await rpc('account_transaction',[id,person,{...original,amount:255}]);
  const row=(await sql('select snapshot,status from sakan_private.rent_invoices where payment_id=$1',[payment.id])).rows[0];
  assert.equal(row.snapshot.document_type,'bond_receipt');
  assert.equal(row.status,'queued');
  assert.equal(Number(row.snapshot.payment.amount),255);
  assert.deepEqual(await rpc('account_transaction',[id,person,{...original,amount:255}]),payment);
  assert.equal(Number((await sql('select count(*) n from sakan_private.rent_invoices where payment_id=$1',[payment.id])).rows[0].n),1);
  assert.equal(Number((await sql("select coalesce(sum(amount),0) total from payments where person_id=$1 and kind='rent'",[person])).rows[0].total),0);
 });
 await t.test('nonstaff cannot issue or read a historical bond receipt',async()=>{
  await sql('set role authenticated');
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
  await assert.rejects(()=>rpc('staff_bond_payment_receipt',[historical.id,'preview',null]),/Staff/);
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 });
}
