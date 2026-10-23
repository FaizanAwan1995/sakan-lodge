import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { rentCharges, d2n, n2d } from '../../src/ledger.js';
export async function verifyTenantAccount({t,sql,rpc,STAFF,OTHER,applyMigration}) {
  await sql('reset role');
  const snapshot=async()=> (await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p)-'billing_schedule' order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p),'charges',(select jsonb_agg(to_jsonb(c) order by id) from charges c),'audit',(select jsonb_agg(to_jsonb(a)-'before_values'-'after_values'-'reason' order by id) from audit a)) data")).rows[0].data;
  const before=await snapshot();
  await applyMigration();
  await t.test('additive account migration retains every existing tenant, transaction, charge and audit value',async()=>assert.deepEqual(await snapshot(),before));
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
  const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Account synthetic',500,$1) returning *",[today])).rows[0];
  const person=(await sql("insert into people(name,property_id,stay_type,weekly_rate,start_date) values('Account synthetic',$1,'long',170,$2) returning to_jsonb(people) p",[prop.id,today])).rows[0].p;
  const readPerson=async()=> (await sql('select to_jsonb(p) p from people p where id=$1',[person.id])).rows[0].p;
  const payload={kind:'rent',amount:10,date:today,method:'transfer',received_by:'Faizan',note:'Synthetic'};
  let payment;
  await t.test('payment retries write exactly once; changed request input is rejected',async()=>{
    const key=randomUUID();payment=await rpc('account_transaction',[key,person.id,payload]);
    assert.deepEqual(await rpc('account_transaction',[key,person.id,payload]),payment);
    assert.equal((await sql('select count(*)::int n from payments where person_id=$1',[person.id])).rows[0].n,1);
    await assert.rejects(()=>rpc('account_transaction',[key,person.id,{...payload,amount:20}]),/different details/);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[person.id])).rows[0].due),330);
  });
  await t.test('simultaneous same-key payments return one receipt across PostgreSQL sessions',{skip:!process.env.SAKAN_TEST_DATABASE_URL},async()=>{
    const key=randomUUID();
    const clients=await Promise.all([0,1].map(async()=>{const c=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);return c;}));
    try {
      const results=await Promise.all(clients.map(c=>c.query('select public.account_transaction($1,$2,$3) receipt',[key,person.id,JSON.stringify({...payload,amount:1})])));
      assert.deepEqual(results[0].rows[0],results[1].rows[0]);
      assert.equal((await sql('select count(*)::int n from payments where id=$1',[results[0].rows[0].receipt.id])).rows[0].n,1);
      // Remove this disposable fixture only, restoring the following test balance.
      await sql('delete from payments where id=$1',[results[0].rows[0].receipt.id]);
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await t.test('payment correction is optimistic and preserves old values and reason',async()=>{
    const corrected=await rpc('account_transaction',[randomUUID(),person.id,{...payload,amount:20},payment,'Correct bank receipt']);
    assert.equal(+corrected.amount,20);
    const audit=(await sql("select * from audit where entity_id=$1 and before_values is not null order by id desc limit 1",[payment.id])).rows[0];
    assert.equal(+audit.before_values.amount,10);assert.equal(+audit.after_values.amount,20);assert.equal(audit.reason,'Correct bank receipt');
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,payload,payment,'Stale correction']),/changed/);
  });
  await t.test('bond is separate; backdated or excessive refund cannot consume later receipts',async()=>{
    await rpc('account_transaction',[randomUUID(),person.id,{...payload,kind:'bond',amount:100}]);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[person.id])).rows[0].due),320);
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,{...payload,kind:'bond_refund',amount:101}]),/more bond/);
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,{...payload,kind:'bond_refund',amount:10,date:n2d(d2n(today)-1)}]),/more bond/);
    await rpc('account_transaction',[randomUUID(),person.id,{...payload,kind:'bond_refund',amount:40}]);
  });
  await t.test('positive charge is audited, dated, and added without changing receipts',async()=>{
    await rpc('account_transaction',[randomUUID(),person.id,{...payload,kind:'charge',amount:15},null,'Replacement key charge']);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[person.id])).rows[0].due),335);
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,{...payload,amount:-10}]),/positive/);
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,{...payload,date:n2d(d2n(today)+1)}]),/future/);
  });
  await t.test('future billing retains earlier cycles and baseline; rejects past, mid-cycle, and stale changes',async()=>{
    const expected=await readPerson();const effective=n2d(d2n(today)+14);
    const changed=await rpc('schedule_tenant_billing',[person.id,expected,effective,200,effective,'Agreed future increase']);
    assert.equal(+changed.weekly_rate,170);
    assert.deepEqual(rentCharges(changed,prop,today),rentCharges(expected,prop,today));
    assert.equal(rentCharges(changed,prop,effective).at(-1).amount,400);
    await assert.rejects(()=>rpc('schedule_tenant_billing',[person.id,expected,n2d(d2n(today)+28),210,null,'Stale schedule']),/changed/);
    await assert.rejects(()=>rpc('schedule_tenant_billing',[person.id,changed,today,210,null,'Invalid date']),/future/);
    await assert.rejects(()=>rpc('schedule_tenant_billing',[person.id,changed,n2d(d2n(today)+29),210,null,'Mid cycle change']),/boundary/);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[person.id])).rows[0].due),335);
  });
  await t.test('profile corrections require a reason and keep before/after',async()=>{
    const expected=await readPerson();
    await assert.rejects(()=>rpc('amend_tenant_details',[person.id,expected,{name:'Synthetic corrected'},'']),/reason/);
    await rpc('amend_tenant_details',[person.id,expected,{name:'Synthetic corrected'},'Name spelling correction']);
    const audit=(await sql("select * from audit where tenant_id=$1 and reason='Name spelling correction' order by id desc limit 1",[person.id])).rows[0];
    assert.equal(audit.before_values.name,'Account synthetic');assert.equal(audit.after_values.name,'Synthetic corrected');
  });
  await t.test('nonstaff and anonymous cannot write account transactions or schedules',async()=>{
    await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,payload]),/Staff/);
    await assert.rejects(()=>rpc('schedule_tenant_billing',[person.id,person,today,200,null,'Unauthorized']),/Staff/);
    await sql('reset role');await sql('set role anon');
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,payload]),/permission denied/);
    await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  });
}
