import assert from 'node:assert/strict';
import pg from 'pg';
export async function verifyHistoricalReceipts({t,sql,rpc,STAFF,OTHER}){
 await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Historical receipt test',500,$1::date-27) returning id",[today])).rows[0].id;
 await sql("insert into contract_defaults(property_id,premises_address) values($1,'1 Synthetic Test Road, Adelaide SA')",[prop]);
 const person=(await sql("insert into people(name,email,property_id,stay_type,weekly_rate,start_date,paid_up_to,rent_cycle_anchor) values('Historical Guest','history@example.test',$1,'long',170,$2::date-35,$2::date-28,$2::date-27) returning id",[prop,today])).rows[0].id;
 let first,last;
 await sql('alter table public.payments disable trigger queue_rent_invoice');
 try{
  first=(await sql("insert into payments(person_id,property_id,date,kind,amount,method,note,received_by) values($1,$2,$3::date-14,'rent',340,'cash','Earlier receipt','Faizan') returning id",[person,prop,today])).rows[0].id;
  last=(await sql("insert into payments(person_id,property_id,date,kind,amount,method,note,received_by) values($1,$2,$3,'rent',340,'cash','Last recorded payment','Faizan') returning id",[person,prop,today])).rows[0].id;
 }finally{await sql('alter table public.payments enable trigger queue_rent_invoice');}
 const before=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p)) data")).rows[0].data;
 const counter=async()=>Number((await sql('select last_number from sakan_private.invoice_counter')).rows[0].last_number);
 let draft;
 await t.test('historical preview allocates at the payment date and excludes later receipts without issuing',async()=>{
  const n=await counter();const early=await rpc('staff_payment_receipt',[first]);draft=await rpc('staff_payment_receipt',[last]);
  assert.equal(early.existing,false);assert.equal(early.number,'DRAFT');assert.equal(early.snapshot.lines[0].amount,340);
  const expected=(await sql("select ($1::date-27)::text a,($1::date-14)::text b,($1::date-13)::text c",[today])).rows[0];
  assert.equal(early.snapshot.lines[0].period_start,expected.a);assert.equal(early.snapshot.lines[0].period_end,expected.b);assert.equal(draft.snapshot.lines[0].period_start,expected.c);assert.equal(draft.snapshot.lines[0].period_end,today);
  assert.equal(await counter(),n);assert.equal(draft.snapshot.payment.method,'cash');
 });
 await t.test('historical issue requires unchanged reviewed details, numbers once and preserves the payment',async()=>{
  await assert.rejects(()=>rpc('staff_payment_receipt',[last,'issue']),/Review the preview/);
  const changed=structuredClone(draft.snapshot);changed.payment.amount=1;
  await assert.rejects(()=>rpc('staff_payment_receipt',[last,'issue',null,null,changed]),/Review the preview/);
  const n=await counter();const issued=await rpc('staff_payment_receipt',[last,'issue',null,null,draft.snapshot]);
  assert.equal(Number(issued.number),n+1);assert.equal(issued.status,'queued');assert.equal(+issued.snapshot.payment.amount,340);
  const duplicate=await rpc('staff_payment_receipt',[last,'issue',null,null,draft.snapshot]);assert.equal(duplicate.id,issued.id);assert.equal(duplicate.existing,true);assert.equal(await counter(),n+1);
  const after=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payments p)) data")).rows[0].data;assert.deepEqual(after,before);
 });
 await t.test('historical period overrides validate dates and require a fresh preview',async()=>{
  await assert.rejects(()=>rpc('staff_payment_receipt',[first,'preview',today,null]),/both rent period/);
  const date=(await sql("select ($1::date-20)::text a,($1::date-7)::text b",[today])).rows[0];
  const preview=await rpc('staff_payment_receipt',[first,'preview',date.a,date.b]);assert.equal(preview.snapshot.lines[0].period_start,date.a);assert.equal(+preview.snapshot.lines[0].amount,340);
  await assert.rejects(()=>rpc('staff_payment_receipt',[first,'issue',date.a,date.b,draft.snapshot]),/Review the preview/);
 });
 await t.test('historical receipts are restricted to staff and rent transactions',async()=>{
  await sql('set role anon');await assert.rejects(()=>rpc('staff_payment_receipt',[first]),/permission denied/);await sql('reset role');
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('staff_payment_receipt',[first]),/Staff/);await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  const bond=(await sql("insert into payments(person_id,property_id,date,kind,amount,method,received_by) values($1,$2,$3,'bond',340,'cash','Faizan') returning id",[person,prop,today])).rows[0].id;
  await assert.rejects(()=>rpc('staff_payment_receipt',[bond]),/recorded rent payment/);
 });
 await t.test('concurrent historical issue requests create one invoice and consume one number',{skip:!process.env.SAKAN_TEST_DATABASE_URL},async()=>{
  const preview=await rpc('staff_payment_receipt',[first]);const n=await counter();
  const clients=await Promise.all([0,1].map(async()=>{const c=new pg.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);return c;}));
  try{const results=await Promise.all(clients.map(c=>c.query("select public.staff_payment_receipt($1,'issue',null,null,$2::jsonb) d",[first,JSON.stringify(preview.snapshot)])));assert.equal(results[0].rows[0].d.id,results[1].rows[0].d.id);assert.equal(await counter(),n+1);}finally{await Promise.all(clients.map(c=>c.end()));}
 });

}
