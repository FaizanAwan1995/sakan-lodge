import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
export async function verifyStayHistory({t,sql,rpc,STAFF,OTHER,applyMigration}) {
 await sql('reset role');
 const before=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p),'charges',(select jsonb_agg(to_jsonb(p) order by id) from charges p),'audit',(select jsonb_agg(to_jsonb(p) order by id) from audit p)) data")).rows[0].data;
 await applyMigration();
 await t.test('history migration preserves all prior tenants, payments, charges, balances and audit entries',async()=>{
  const after=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p)-'settlement_id' order by id) from payments p),'charges',(select jsonb_agg(to_jsonb(p) order by id) from charges p)) data")).rows[0].data;
  for(const key of ['people','payments','charges'])assert.deepEqual(after[key],before[key]);
  const audit=(await sql('select to_jsonb(a) a from audit a order by id')).rows.map(r=>r.a);for(const old of before.audit)assert.deepEqual(audit.find(a=>a.id===old.id),old);
 });
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('History synthetic',500,$1) returning id",[today])).rows[0].id;
 const person=(await sql("insert into people(name,property_id,stay_type,weekly_rate,start_date,end_date,paid_up_to,bond,bond_status) values('History synthetic',$1,'long',170,$2::date-10,$2::date-1,$2::date-2,300,'paid') returning id",[prop,today])).rows[0].id;
 const due=()=>sql('select sakan_private.person_due($1)::numeric due',[person]).then(r=>Number(r.rows[0].due));
 const base={kind:'bond',amount:300,date:today,method:'transfer',received_by:'Faizan'};
 await rpc('account_transaction',[randomUUID(),person,base]);
 // A separate positive charge makes the rent deduction case easy to reconcile.
 await rpc('account_transaction',[randomUUID(),person,{kind:'charge',amount:85,date:today},null,'Synthetic extra days already agreed']);
 const data={apply_amount:85,refund_amount:215,expected_held:300,expected_owed:await due(),reason:'Agreed extra days against bond',handled_by:'Faizan',method:'transfer'};
 let settlement;
 await t.test('bond settlement applies rent and refunds atomically, retry is exactly once and financial history cannot be overwritten',async()=>{
  const key=randomUUID();settlement=await rpc('settle_tenant_bond',[key,person,data]);
  assert.equal(+settlement.owed,data.expected_owed-85);assert.equal(+settlement.bond_held,0);
  assert.deepEqual(await rpc('settle_tenant_bond',[key,person,data]),settlement);
  assert.equal((await sql('select count(*)::int n from payments where settlement_id=$1',[key])).rows[0].n,2);
  await assert.rejects(()=>rpc('settle_tenant_bond',[key,person,{...data,refund_amount:214}]),/different details/);
  await assert.rejects(()=>sql('update payments set amount=10 where id=$1',[settlement.applied_id]),/cannot be overwritten/);
  await assert.rejects(()=>sql('delete from payments where id=$1',[settlement.refund_id]),/cannot be overwritten/);
  assert.equal(await due(),data.expected_owed-85);
  const old=(await sql("select to_jsonb(p) p from payments p where person_id=$1 and kind='bond'",[person])).rows[0].p;
  await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person,{...base,amount:100},old,'Unsafe receipt correction']),/more bond/);
 });
 await t.test('stale, overdrawn, missing-receipt and unauthorized settlements fail without partial writes',async()=>{
  await assert.rejects(()=>rpc('settle_tenant_bond',[randomUUID(),person,data]),/changed/);
  await assert.rejects(async()=>rpc('settle_tenant_bond',[randomUUID(),person,{...data,apply_amount:0,refund_amount:1,expected_held:0,expected_owed:await due()}]),/exceeds recorded/);
  const n=(await sql('select count(*)::int n from payments where person_id=$1',[person])).rows[0].n;
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
  await assert.rejects(()=>rpc('settle_tenant_bond',[randomUUID(),person,data]),/Staff/);
  await assert.rejects(()=>sql('select sakan_private.record_elapsed_checkouts()'),/permission denied/);
  await sql('reset role');await sql('set role anon');await assert.rejects(()=>rpc('settle_tenant_bond',[randomUUID(),person,data]),/permission denied/);
  await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  assert.equal((await sql('select count(*)::int n from payments where person_id=$1',[person])).rows[0].n,n);
 });
 await t.test('deduction-only action leaves the refundable remainder held and never records an unpaid refund',async()=>{
  await rpc('account_transaction',[randomUUID(),person,{...base,amount:300}]);
  await rpc('account_transaction',[randomUUID(),person,{kind:'charge',amount:85,date:today},null,'Synthetic final week rent']);
  const expected=await due(), key=randomUUID();
  const input={...data,expected_held:300,expected_owed:expected,apply_amount:85,refund_amount:0};
  const result=await rpc('settle_tenant_bond',[key,person,input]);
  assert.equal(+result.bond_held,215);assert.equal(+result.refunded,0);assert.equal(+result.owed,expected-85);
  assert.deepEqual(await rpc('settle_tenant_bond',[key,person,input]),result);
  const rows=(await sql('select kind,amount,method from payments where settlement_id=$1',[key])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].kind,'bond_applied');assert.equal(rows[0].method,'adjustment');
  // Complete the actual refund separately, keeping later concurrency fixtures unchanged.
  await rpc('settle_tenant_bond',[randomUUID(),person,{...data,expected_held:215,expected_owed:await due(),apply_amount:0,refund_amount:215}]);
 });
 await t.test('automatic scheduled checkout logs once, preserves original dates and records later schedule corrections',async()=>{
  await sql('select sakan_private.record_elapsed_checkouts()');await sql('select sakan_private.record_elapsed_checkouts()');
  const logs=await sql("select * from audit where tenant_id=$1 and action='scheduled_checkout_elapsed'",[person]);assert.equal(logs.rows.length,1);assert.equal(logs.rows[0].by,'system');assert.match(logs.rows[0].reason,/not been confirmed/);
  const p=(await sql('select to_jsonb(p) p from people p where id=$1',[person])).rows[0].p;assert.equal(p.checked_out_at,null);
  await rpc('amend_tenant_details',[person,p,{end_date:today},'Correct the scheduled departure']);
  await sql('select sakan_private.record_elapsed_checkouts()');assert.equal((await sql("select count(*)::int n from audit where tenant_id=$1 and action='scheduled_checkout_elapsed'",[person])).rows[0].n,2);
  await sql("insert into audit(\"by\",action) select 'system','Synthetic retained activity' from generate_series(1,310)");
  const snap=await rpc('ledger_snapshot',[]);assert.ok(snap.audit.length>300);assert.ok(snap.audit.some(a=>a.tenant_id===person&&a.action==='scheduled_checkout_elapsed'));
 });
 await t.test('competing bond settlements cannot consume the same bond twice',{skip:!process.env.SAKAN_TEST_DATABASE_URL},async()=>{
  await rpc('account_transaction',[randomUUID(),person,{...base,amount:100}]);
  const input={...data,expected_held:100,expected_owed:await due(),apply_amount:0,refund_amount:100};
  const clients=await Promise.all([0,1].map(async()=>{const c=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);return c;}));
  try{const out=await Promise.allSettled(clients.map(c=>c.query('select public.settle_tenant_bond($1,$2,$3)',[randomUUID(),person,JSON.stringify(input)])));assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.match(out.find(r=>r.status==='rejected').reason.message,/changed/);}finally{await Promise.all(clients.map(c=>c.end()));}
 });
}
