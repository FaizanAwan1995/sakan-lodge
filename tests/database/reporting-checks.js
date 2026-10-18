import assert from 'node:assert/strict';
import pg from 'pg';

export async function verifyReportingSnapshot({ t, sql, rpc, STAFF, OTHER, applyMigration }) {
  const fingerprint = async () => (await sql("select (select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from people p) people,(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from payments p) payments")).rows[0];
  await t.test('report migration repairs missing property budget fields without changing resident or payment records',async()=>{
    const before=await fingerprint();
    await sql('alter table properties drop column bills_amount, drop column bills_frequency');
    await applyMigration();
    assert.deepEqual(await fingerprint(),before);
    const p=(await sql('select id,bills_amount,bills_frequency from properties limit 1')).rows[0];
    assert.equal(Number(p.bills_amount),0);
    assert.equal(p.bills_frequency,'monthly');
    await assert.rejects(()=>sql('update properties set bills_amount=-1 where id=$1',[p.id]),/constraint/);
    await assert.rejects(()=>sql('update properties set bills_amount=1.234 where id=$1',[p.id]),/constraint/);
    await assert.rejects(()=>sql("update properties set bills_frequency='weekly' where id=$1",[p.id]),/constraint/);
  });
  await t.test('staff snapshot returns every transaction above one thousand rows and is read-only',async()=>{
    const p=(await sql('select id,property_id from people limit 1')).rows[0];
    await sql("insert into payments(person_id,property_id,date,amount,method,received_by,kind) select $1,$2,'2026-10-18',1,'cash','Synthetic staff','rent' from generate_series(1,1005)",[p.id,p.property_id]);
    const count=(await sql('select count(*)::int n from payments')).rows[0].n;
    const before=await fingerprint();
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
    await sql('begin read only');
    try {
      await sql('set local role authenticated');
      const snapshot=await rpc('ledger_snapshot',[]);
      assert.equal(snapshot.payments.length,count);
      assert.ok(snapshot.payments.length>1000);
      assert.ok(snapshot.audit.length<=300);
      for(const table of ['properties','rooms','people','payments','charges','expenses','maintenance','audit']) assert.ok(Array.isArray(snapshot[table]));
    } finally { await sql('rollback'); }
    assert.deepEqual(await fingerprint(),before);
  });
  await t.test('non-staff and anonymous users cannot obtain a financial snapshot',async()=>{
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
    await sql('set role authenticated');
    try { await assert.rejects(()=>rpc('ledger_snapshot',[]),/Staff access/); }
    finally { await sql('reset role'); }
    await sql('set role anon');
    try { await assert.rejects(()=>rpc('ledger_snapshot',[]),/permission denied/); }
    finally { await sql('reset role'); }
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
    const fn=(await sql("select prosecdef,provolatile,proretset from pg_proc where oid='public.ledger_snapshot()'::regprocedure")).rows[0];
    assert.equal(fn.prosecdef,false);
    assert.equal(fn.provolatile,'s');
    assert.equal(fn.proretset,false);
  });
  await t.test('financial snapshot cannot mix tables from before and after another staff transaction', { skip: !process.env.SAKAN_TEST_DATABASE_URL },async()=>{
    const reader=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});
    const writer=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});
    await reader.connect();await writer.connect();
    let reading;
    try {
      const before=await rpc('ledger_snapshot',[]);
      const resident=before.people[0];
      await reader.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
      await reader.query('set role authenticated');
      const pid=(await reader.query('select pg_backend_pid() pid')).rows[0].pid;
      await writer.query('begin');
      await writer.query('select pg_advisory_xact_lock(75021891)');
      reading=reader.query('select pg_advisory_xact_lock(75021891),public.ledger_snapshot() snapshot');
      let waiting=false;
      for(let i=0;i<100;i++) {
        waiting=(await sql("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[pid])).rows[0].waiting;
        if(waiting) break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.ok(waiting,'Reader must hold its snapshot while waiting for the transaction lock');
      await writer.query("insert into payments(person_id,property_id,date,amount,method,received_by,kind) values($1,$2,'2026-10-18',2,'cash','Synthetic staff','rent')",[resident.id,resident.property_id]);
      await writer.query("insert into expenses(property_id,date,category,amount) values($1,'2026-10-18','Other',2)",[resident.property_id]);
      await writer.query('commit');
      const frozen=(await reading).rows[0].snapshot;
      assert.equal(frozen.payments.length,before.payments.length);
      assert.equal(frozen.expenses.length,before.expenses.length);
      const after=await rpc('ledger_snapshot',[]);
      assert.equal(after.payments.length,before.payments.length+1);
      assert.equal(after.expenses.length,before.expenses.length+1);
    } finally {
      await writer.query('rollback').catch(()=>{});
      await reading?.catch(()=>{});
      await reader.end();await writer.end();
    }
  });
  async function signedPrivateBooking(nights, suffix) {
    const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text today")).rows[0].today;
    const property=(await sql("insert into properties(name,lease_rent,lease_anchor,lease_start) values('Synthetic Billing',1000,$1,$1) returning id",[today])).rows[0];
    const room=(await sql("insert into rooms(property_id,label,capacity) values($1,'Billing test',1) returning id",[property.id])).rows[0];
    await sql("insert into room_profiles(room_id,ready,published) values($1,true,false)",[room.id]);
    const departure=(await sql('select ($1::date+$2::int)::text departure',[today,nights])).rows[0].departure;
    const created=await rpc('create_staff_reservation',[{room_id:room.id,full_name:'Synthetic Billing Guest',email:'billing@example.test',phone:'0400000000',arrival_date:today,departure_date:departure},crypto.randomUUID()]);
    let r=(await sql('select * from reservations where reservation_code=$1',[created.code])).rows[0];
    let c=await rpc('manage_contract',[r.id,'draft',{terms:'Synthetic approved terms for a billing regression with all utilities included.',template_reference:'synthetic-billing'}]);
    c=await rpc('manage_contract',[r.id,'approve',{id:c.id}]);
    const path='contracts/synthetic-billing/'+suffix+'.pdf';
    await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",[path]);
    await rpc('manage_contract',[r.id,'signed',{id:c.id,signature_verified:true,signed_by:r.full_name,signed_document_path:path}]);
    if(nights<7)return r;
    return rpc('manage_reservation',[r.id,r.revision,'confirm',{}]);
  }
  await t.test('short-term private pricing uses fortnightly ledger billing for stays of a week or more',async()=>{
    const r=await signedPrivateBooking(30,'multi-week');
    assert.equal(r.stay_type,'short');
    assert.equal(Number(r.weekly_rate),300);
    const checked=await rpc('manage_reservation',[r.id,r.revision,'check_in',{bond:600}]);
    const resident=(await sql('select stay_type,weekly_rate,nightly_rate from people where id=$1',[checked.checked_in_person_id])).rows[0];
    assert.equal(resident.stay_type,'long');
    assert.equal(Number(resident.weekly_rate),300);
    assert.equal(resident.nightly_rate,null);
  });
  await t.test('unapproved weekly-to-nightly conversion cannot create a ledger resident',async()=>{
    const r=await signedPrivateBooking(3,'nightly');
    await assert.rejects(()=>rpc('manage_reservation',[r.id,r.revision,'confirm',{}]),/approved nightly rate/);
    const after=(await sql('select status,checked_in_person_id from reservations where id=$1',[r.id])).rows[0];
    assert.equal(after.status,'pending');
    assert.equal(after.checked_in_person_id,null);
  });
}
