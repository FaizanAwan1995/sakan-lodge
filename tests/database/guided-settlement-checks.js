import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
export async function verifyGuidedSettlement({t,sql,rpc,STAFF,OTHER,applyMigration}) {
 await sql('reset role');
 const snapshot=async()=> (await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p),'charges',(select jsonb_agg(to_jsonb(c) order by id) from charges c),'audit',(select jsonb_agg(to_jsonb(a) order by id) from audit a)) data")).rows[0].data;
 const before=await snapshot();await applyMigration();
 await t.test('guided settlement migration preserves all tenant, payment, charge and audit records',async()=>assert.deepEqual(await snapshot(),before));
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
 const property=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Guided synthetic',0,$1) returning id",[today])).rows[0].id;
 const make=async()=>{
  const id=(await sql("insert into people(name,property_id,stay_type,weekly_rate,start_date,paid_up_to,bond) values('Guided synthetic',$1,'long',0,$2,$2,300) returning id",[property,today])).rows[0].id;
  await rpc('account_transaction',[randomUUID(),id,{kind:'bond',amount:300,date:today,method:'transfer',received_by:'Faizan'}]);
  await rpc('account_transaction',[randomUUID(),id,{kind:'charge',amount:85,date:today},null,'Agreed final rent charge']);
  return id;
 };
 const input={apply_amount:85,retain_amount:20,retain_reason:'Agreed cleaning deduction',refund_amount:195,expected_held:300,expected_owed:85,reason:'Final bond settlement',handled_by:'Faizan',method:'transfer'};
 await t.test('rent, other deduction and paid remainder post together exactly once',async()=>{
  const person=await make(),key=randomUUID();
  const result=await rpc('settle_tenant_bond',[key,person,input]);
  assert.equal(+result.owed,0);assert.equal(+result.bond_held,0);assert.equal(+result.retained,20);assert.equal(+result.refunded,195);
  assert.deepEqual(await rpc('settle_tenant_bond',[key,person,input]),result);
  const rows=(await sql('select kind,amount,method,note from payments where settlement_id=$1 order by kind',[key])).rows;
  assert.equal(rows.length,3);assert.equal(+rows.find(r=>r.kind==='bond_applied').amount,85);
  const other=rows.find(r=>r.kind==='bond_deducted');assert.equal(other.method,'adjustment');assert.equal(other.note,input.retain_reason);
  await assert.rejects(()=>rpc('settle_tenant_bond',[key,person,{...input,retain_amount:21}]),/different details/);
  await assert.rejects(()=>sql("update payments set amount=1 where settlement_id=$1",[key]),/cannot be overwritten/);
 });
 await t.test('refund later retains the remainder and later refund does not deduct rent again',async()=>{
  const person=await make();
  const result=await rpc('settle_tenant_bond',[randomUUID(),person,{...input,refund_amount:0}]);
  assert.equal(+result.bond_held,195);assert.equal(+result.owed,0);assert.equal(+result.refunded,0);
  const later=await rpc('settle_tenant_bond',[randomUUID(),person,{...input,apply_amount:0,retain_amount:0,refund_amount:195,expected_held:195,expected_owed:0}]);
  assert.equal(+later.bond_held,0);assert.equal(+later.applied,0);
  assert.equal((await sql("select count(*)::int n from payments where person_id=$1 and kind='bond_applied'",[person])).rows[0].n,1);
 });
 await t.test('combined overdraw, missing reason, invalid precision and stale balances leave no partial writes',async()=>{
  const person=await make(), count=async()=> (await sql('select count(*)::int n from payments where person_id=$1',[person])).rows[0].n,n=await count();
  for(const changes of [{refund_amount:196},{retain_reason:' '},{retain_amount:-1},{retain_amount:0.001},{retain_amount:'NaN'},{expected_held:299},{apply_amount:86,refund_amount:194}])
   await assert.rejects(()=>rpc('settle_tenant_bond',[randomUUID(),person,{...input,...changes}]));
  assert.equal(await count(),n);
 });
 await t.test('anonymous and non-staff users cannot settle bonds',async()=>{
  const person=await make();
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
  await assert.rejects(()=>rpc('settle_tenant_bond',[randomUUID(),person,input]),/Staff/);
  await sql('reset role');await sql('set role anon');
  await assert.rejects(()=>rpc('settle_tenant_bond',[randomUUID(),person,input]),/permission denied/);
  await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 });
 await t.test('older callers may omit other deductions and keep the original refund behavior',async()=>{
  const person=await make(),{retain_amount,retain_reason,...old}=input;
  const result=await rpc('settle_tenant_bond',[randomUUID(),person,{...old,refund_amount:215}]);
  assert.equal(+result.bond_held,0);assert.equal(+result.retained,0);assert.equal(+result.refunded,215);
 });
 await t.test('competing guided settlements cannot consume the same bond twice',{skip:!process.env.SAKAN_TEST_DATABASE_URL},async()=>{
  const person=await make();
  const clients=await Promise.all([0,1].map(async()=>{const c=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);return c;}));
  try {const results=await Promise.allSettled(clients.map(c=>c.query('select public.settle_tenant_bond($1,$2,$3)',[randomUUID(),person,JSON.stringify(input)])));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/changed/);}finally{await Promise.all(clients.map(c=>c.end()));}
 });
}
