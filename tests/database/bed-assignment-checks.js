import assert from 'node:assert/strict';
export async function verifyBeds({t,sql,rpc,STAFF,applyMigration,assertSingleAllocation}) {
 const before=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p) order by id) from people p),'contracts',(select jsonb_agg(to_jsonb(c) order by id) from contracts c)) value")).rows[0].value;
 await applyMigration();
 const after=(await sql("select jsonb_build_object('people',(select jsonb_agg(to_jsonb(p)-'bed_number' order by id) from people p),'contracts',(select jsonb_agg(to_jsonb(c) order by id) from contracts c)) value")).rows[0].value;
 assert.deepEqual(after,before,'migration preserves every existing tenant, financial field and contract');
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Bed synthetic',1000,current_date) returning id")).rows[0].id;
 const room=(await sql("insert into rooms(property_id,label,capacity) values($1,'Room 5',2) returning id",[prop])).rows[0].id;
 const d=(await sql("select (current_date+2)::text arrival,(current_date+95)::text departure")).rows[0];
 await rpc('save_listing',['property',prop,{slug:'bed-synthetic',public_name:'Bed test house',suburb:'Clapham',description:'Synthetic house for bed allocation checks.',published:true}]);
 await rpc('save_listing',['room',room,{slug:'room-5',title:'Synthetic shared room',description:'Synthetic bed allocation room.',ready:true,published:true}]);
 const person=async(bed,start=d.arrival,end=d.departure)=>(await sql("insert into people(name,property_id,room_id,start_date,end_date,weekly_rate,bond,bed_number) values('Synthetic bed resident',$1,$2,$3,$4,185,370,$5) returning *",[prop,room,start,end,bed])).rows[0];
 const availability=()=>rpc('room_availability',[room,d.arrival,d.departure]);
 let first;
 await t.test('named beds reject overlapping occupancy, preserve aggregate limits and allow adjacent stays',async()=>{
  first=await person(1);assert.deepEqual((await availability()).beds,[2]);assert.equal((await availability()).spaces,1);
  await assert.rejects(()=>person(1),/bed is unavailable/);
  await assert.rejects(()=>person(3),/valid, different bed/);
  const next=await person(1,d.departure,'2099-01-01');assert.equal(next.bed_number,1);
  const auto=await person(null);assert.equal(auto.bed_number,2);assert.equal((await availability()).spaces,0);
  await assert.rejects(()=>person(null),/available|availability/);
  await sql('delete from people where id=$1',[auto.id]);await sql('delete from people where id=$1',[next.id]);
 });
 let reservation;
 await t.test('public requests retain selected bed and idempotent retries cannot change it',async()=>{
  const key=crypto.randomUUID();const data={room_id:room,full_name:'Bed Applicant',email:'bed@example.test',phone:'0400000000',arrival_date:d.arrival,departure_date:d.departure,spaces_requested:1,bed_number:2};
  const made=await rpc('create_staff_reservation',[data,key]);assert.deepEqual(await rpc('create_staff_reservation',[data,key]),made);
  await assert.rejects(()=>rpc('create_staff_reservation',[{...data,bed_number:1},key]),/identifier already used/);
  reservation=(await sql('select * from reservations where reservation_code=$1',[made.code])).rows[0];assert.deepEqual(reservation.bed_numbers,[2]);
  const held=await rpc('manage_reservation',[reservation.id,reservation.revision,'hold',{expires_at:new Date(Date.now()+3600000).toISOString()}]);assert.equal((await availability()).spaces,0);
  await assert.rejects(()=>person(2),/bed is unavailable/);
  reservation=await rpc('manage_reservation',[held.id,held.revision,'edit',{bed_numbers:[2]}]);assert.deepEqual(reservation.bed_numbers,[2]);
 });
 await t.test('agreement records R5-B2 and manual approval transfers the exact bed into the ledger',async()=>{
  const template=await rpc('approve_agreement_template',[{title:'Bed test agreement',terms:'Synthetic reviewed bed sharing agreement terms.',proprietor:{name:'Synthetic Owner',address:'Synthetic address',phone:'0400000000'},confirmation:'APPROVE_REUSABLE_TEMPLATE'}]);
  const out=await rpc('generate_booking_contract',[reservation.id,reservation.revision,{full_name:reservation.full_name,email:reservation.email,phone:reservation.phone,room_id:room,arrival_date:d.arrival,departure_date:d.departure,template_id:template.id,premises_address:'Synthetic test address',term_description:'Fixed term agreed stay',resident_names:[reservation.full_name],first_rent_due:d.arrival,bond:370}]);
  assert.equal(out.contract.fields.room_label,'R5-B2');assert.deepEqual(out.contract.fields.bed_numbers,[2]);
  await sql("update contracts set document_path='contracts/synthetic-bed-test.pdf' where id=$1",[out.contract.id]);
  const confirmed=await rpc('confirm_manual_booking',[out.reservation.id,out.reservation.revision,out.contract.id]);
  const assigned=(await sql('select bed_number from people where id=$1',[confirmed.checked_in_person_id])).rows[0];assert.equal(assigned.bed_number,2);
  await assert.rejects(()=>sql('update rooms set capacity=1 where id=$1',[room]),/Reassign beds/);
 });
 await t.test('tenant corrections support bed assignment with stale checks and preserve other fields',async()=>{
  const old=(await sql('select to_jsonb(p) value from people p where id=$1',[first.id])).rows[0].value;
  const updated=await rpc('amend_tenant_details',[old.id,old,{bed_number:1},'Confirm bed assignment']);assert.equal(updated.bed_number,1);assert.equal(updated.name,old.name);
  await assert.rejects(()=>rpc('amend_tenant_details',[old.id,old,{bed_number:2},'Reassign occupied bed']),/bed is unavailable/);
 });
 await t.test('two concurrent writers cannot allocate the same named bed',async(t)=>{
  if(!process.env.SAKAN_TEST_DATABASE_URL){t.skip('Requires separate PostgreSQL connections');return;}
  const concurrent=(await sql("insert into rooms(property_id,label,capacity) values($1,'Room 8',2) returning id",[prop])).rows[0].id;
  await assertSingleAllocation([1,2].map(i=>({sql:"insert into people(name,property_id,room_id,start_date,end_date,weekly_rate,bed_number) values($1,$2,$3,$4,$5,185,1)",args:['Concurrent '+i,prop,concurrent,d.arrival,d.departure]})));
 });
}
