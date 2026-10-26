import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { rentCharges } from '../../src/ledger.js';
export async function verifyRentInvoices({t,sql,rpc,STAFF,OTHER,applyMigration}){
 await sql('reset role');
 const before=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p),'properties',(select jsonb_agg(to_jsonb(p) order by id) from properties p),'audit',(select count(*) from audit)) data")).rows[0].data;
 await applyMigration();
 await t.test('invoice migration preserves historical records, creates no retrospective invoices and starts counter at 81',async()=>{
  const after=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p),'properties',(select jsonb_agg(to_jsonb(p)-'invoice_address' order by id) from properties p),'audit',(select count(*) from audit)) data")).rows[0].data;assert.deepEqual(after,before);
  assert.equal((await sql('select count(*)::int n from sakan_private.rent_invoices')).rows[0].n,0);assert.equal(Number((await sql('select last_number from sakan_private.invoice_counter')).rows[0].last_number),81);
 });
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Invoice test house',500,$1::date-28) returning to_jsonb(properties) p",[today])).rows[0].p;
 await sql("insert into contract_defaults(property_id,premises_address) values($1,'1 Synthetic Avenue, Test SA')",[prop.id]);
 const person=(await sql("insert into people(name,email,property_id,stay_type,weekly_rate,start_date) values('Invoice Synthetic','tenant@example.test',$1,'long',170,$2::date-28) returning to_jsonb(people) p",[prop.id,today])).rows[0].p;
 const data={kind:'rent',date:today,amount:100,method:'transfer',received_by:'Faizan'};
 const readInvoice=async n=>(await sql('select to_jsonb(i) i from sakan_private.rent_invoices i where number=$1',[n])).rows[0].i;
 const work=async(action,id=null,key=null,payload={})=>{await sql('set role service_role');try{return await rpc('rent_invoice_worker',[action,id,key,payload]);}finally{await sql('reset role');}};
 let payment,first,second;
 await t.test('new rent payments allocate sequential invoice 82 exactly once, with private address and verified CC snapshots',async()=>{
  const key=randomUUID();payment=await rpc('account_transaction',[key,person.id,data]);first=await readInvoice(82);
  assert.equal(first.snapshot.address,'1 Synthetic Avenue, Test SA');assert.equal(first.snapshot.tenant_email,'tenant@example.test');assert.ok(first.snapshot.cc.includes('sakanlodges@gmail.com'));assert.ok(first.snapshot.cc.includes('staff@example.test'));
  assert.equal(+first.snapshot.lines[0].amount,100);assert.equal(+first.snapshot.lines[0].charge_amount,340);
  assert.equal(first.snapshot.lines[0].period_start,person.start_date);assert.deepEqual(await rpc('account_transaction',[key,person.id,data]),payment);
  assert.equal((await sql('select count(*)::int n from sakan_private.rent_invoices')).rows[0].n,1);
  await rpc('account_transaction',[randomUUID(),person.id,{...data,kind:'bond',amount:300}]);assert.equal((await sql('select count(*)::int n from sakan_private.rent_invoices')).rows[0].n,1);
 });
 await t.test('partial receipts resume the oldest unpaid fortnight; SQL schedule equals frontend agreed billing',async()=>{
  await rpc('account_transaction',[randomUUID(),person.id,{...data,amount:240}]);second=await readInvoice(83);
  assert.equal(second.snapshot.lines[0].period_start,person.start_date);assert.equal(+second.snapshot.lines[0].amount,240);
  const schedule=(await sql('select * from sakan_private.invoice_rent_periods($1,$2)',[person.id,today])).rows;
  const expected=rentCharges(person,prop,today);assert.deepEqual(schedule.map(r=>Number(r.amount)),expected.map(r=>r.amount));
 });
 await t.test('only worker credentials can claim sends, and competing preparation attempts cannot both send',async()=>{
  await sql('set role authenticated');await assert.rejects(()=>rpc('rent_invoice_worker',['pending']),/permission denied/);await sql('reset role');
  const attempt=randomUUID();const prepared=await work('prepare',first.id,attempt);assert.equal(prepared.status,'preparing');assert.equal((await work('prepare',first.id,randomUUID())).skipped,true);
  await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person.id,{...data,amount:95},payment,'Correction during send']),/active or uncertain/);
  await assert.rejects(()=>work('begin_send',first.id,attempt,{}),/Invalid immutable PDF/);
  await work('begin_send',first.id,attempt,{path:`invoices/${first.id}/${attempt}.pdf`,sha256:'a'.repeat(64)});
  await work('uncertain',first.id,attempt);assert.equal((await readInvoice(82)).status,'uncertain');
  assert.ok(!(await work('pending')).includes(first.id));
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('staff_rent_invoice_action',[first.id,'confirmed_not_sent','Invalid nonstaff retry']),/Staff/);await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  await rpc('staff_rent_invoice_action',[first.id,'confirmed_sent','Checked Gmail Sent Mail','gmail-synthetic-id']);assert.equal((await readInvoice(82)).status,'sent');
 });
 await t.test('intentional corrections retain the old invoice and create a new numbered replacement',async()=>{
  await rpc('account_transaction',[randomUUID(),person.id,{...data,amount:105},payment,'Corrected receipt amount']);
  const old=await readInvoice(82),replacement=await readInvoice(84);assert.equal(old.status,'void');assert.equal(old.gmail_id,'gmail-synthetic-id');assert.equal(+old.snapshot.payment.amount,100);assert.equal(+replacement.snapshot.payment.amount,105);assert.equal(Number(replacement.replaces_number),82);
  await assert.rejects(()=>sql('delete from payments where id=$1',[payment.id]),/invoiced|foreign key/i);
 });
 await t.test('missing details hold delivery and staff can complete details without changing historical receipts',async()=>{
  const p=(await sql("insert into people(name,property_id,stay_type,weekly_rate,start_date) values('Missing Email Synthetic',$1,'long',170,$2) returning id",[prop.id,today])).rows[0].id;
  await rpc('account_transaction',[randomUUID(),p,data]);let invoice=await readInvoice(85);assert.equal((await work('prepare',invoice.id,randomUUID())).skipped,true);assert.equal((await readInvoice(85)).status,'needs_details');
  await sql("update people set email='fixed@example.test' where id=$1",[p]);await rpc('staff_rent_invoice_action',[invoice.id,'retry_pending','Added verified email']);
  const prepared=await work('prepare',invoice.id,randomUUID());assert.equal(prepared.snapshot.tenant_email,'fixed@example.test');assert.equal(prepared.status,'preparing');
 });
 await t.test('private invoice history and PDFs are not readable by anonymous or nonstaff users',async()=>{
  await sql('set role anon');await assert.rejects(()=>rpc('staff_rent_invoices',[person.id,0]),/permission denied/);await assert.rejects(()=>sql('select * from sakan_private.rent_invoices'),/permission denied/);await sql('reset role');
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('staff_rent_invoices',[person.id,0]),/Staff/);await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  const invoices=await rpc('staff_rent_invoices',[person.id,0]);assert.equal(invoices.length,3);
 });
 await t.test('concurrent same-request rent payments issue one invoice and use one number',{skip:!process.env.SAKAN_TEST_DATABASE_URL},async()=>{
  const key=randomUUID(),clients=await Promise.all([0,1].map(async()=>{const c=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);return c;}));
  try{const results=await Promise.all(clients.map(c=>c.query('select public.account_transaction($1,$2,$3) p',[key,person.id,JSON.stringify(data)])));assert.deepEqual(results[0].rows[0],results[1].rows[0]);assert.equal((await sql('select count(*)::int n from sakan_private.rent_invoices where payment_id=$1',[results[0].rows[0].p.id])).rows[0].n,1);}finally{await Promise.all(clients.map(c=>c.end()));}
 });
}
