import assert from 'node:assert/strict';
export async function verifyPastFortnights({t,sql,rpc,STAFF,OTHER}){
 await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const dates=(await sql("select ((now() at time zone 'Australia/Adelaide')::date-27)::text start,((now() at time zone 'Australia/Adelaide')::date-13)::text next")).rows[0];
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor,invoice_address) values('Past fortnight test',500,$1,'1 Synthetic Street') returning id",[dates.start])).rows[0].id;
 const person=(await sql("insert into people(name,email,property_id,stay_type,weekly_rate,start_date,paid_up_to) values('Past Guest','past@example.test',$1,'long',165,$2,$2::date+13) returning id",[prop,dates.start])).rows[0].id;
 const args=[person,dates.start,330,'Previously paid; admin verified'];
 const count=async()=>Number((await sql('select last_number from sakan_private.invoice_counter')).rows[0].last_number);
 let issued;
 await t.test('past invoice previews consume no number; issuance and duplicate requests preserve numbering and ledger',async()=>{
  const n=await count(),before=(await sql('select to_jsonb(p) data from people p where id=$1',[person])).rows[0].data;
  const preview=await rpc('staff_past_fortnight_invoice',args);assert.equal(preview.number,'DRAFT');assert.equal(await count(),n);
  await assert.rejects(()=>rpc('staff_past_fortnight_invoice',[...args,'issue',{}]),/Review the preview/);
  issued=await rpc('staff_past_fortnight_invoice',[...args,'issue',preview.snapshot]);assert.equal(Number(issued.number),n+1);assert.equal(issued.payment_id,null);
  const duplicate=await rpc('staff_past_fortnight_invoice',[...args,'issue',preview.snapshot]);assert.equal(duplicate.id,issued.id);assert.equal(await count(),n+1);
  assert.equal(Number((await sql('select count(*) n from payments where person_id=$1',[person])).rows[0].n),0);
  assert.deepEqual((await sql('select to_jsonb(p) data from people p where id=$1',[person])).rows[0].data,before);
  const next=await rpc('staff_past_fortnight_invoice',[person,dates.next,330,'Admin confirmation']);const second=await rpc('staff_past_fortnight_invoice',[person,dates.next,330,'Admin confirmation','issue',next.snapshot]);assert.equal(Number(second.number),n+2);
 });
 await t.test('past invoice validates periods, amounts, overlaps and staff access',async()=>{
  await assert.rejects(()=>rpc('staff_past_fortnight_invoice',[person,'2099-01-01',330,'Confirmed paid']),/completed fortnight/);
  await assert.rejects(()=>rpc('staff_past_fortnight_invoice',[person,dates.start,-1,'Confirmed paid']),/valid rent amount/);
  const overlap=new Date(Date.parse(dates.start)+86400000).toISOString().slice(0,10);await assert.rejects(()=>rpc('staff_past_fortnight_invoice',[person,overlap,330,'Confirmed paid']),/already covers/);
  await sql('set role anon');await assert.rejects(()=>rpc('staff_past_fortnight_invoice',args),/permission denied/);await sql('reset role');
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('staff_past_fortnight_invoice',args),/Staff/);await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 });
 await t.test('worker can prepare admin-confirmed invoices without inventing a payment',async()=>{
  await sql('set role service_role');const claim=await rpc('rent_invoice_worker',['prepare',issued.id,'00000000-0000-4000-8000-000000000099',{}]);assert.equal(claim.status,'preparing');assert.equal(claim.snapshot.admin_confirmed_period,true);await sql('reset role');
 });
}
