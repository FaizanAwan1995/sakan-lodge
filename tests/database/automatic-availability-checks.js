import assert from 'node:assert/strict';
export async function verifyAutomaticAvailability({t,sql,rpc,STAFF,OTHER,applyMigration}) {
 await applyMigration();
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const prop=crypto.randomUUID(), room=crypto.randomUUID(), resident=crypto.randomUUID();
 const d=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text today,((now() at time zone 'Australia/Adelaide')::date-30)::text past,((now() at time zone 'Australia/Adelaide')::date+1)::text tomorrow,((now() at time zone 'Australia/Adelaide')::date+interval '3 months')::date::text finish")).rows[0];
 const catalog=()=>rpc('public_catalog',[]);
 const visible=async()=>(await catalog()).rooms.some(r=>r.id===room);
 const available=()=>rpc('room_availability',[room,d.today,d.finish]);
 async function profile(changes={}) {const p=(await sql('select * from room_profiles where room_id=$1',[room])).rows[0]||{};return rpc('save_listing',['room',room,{slug:'automatic',title:'Verified private room',description:'Private room. All utilities are included.',photos:[],...p,ready:true,published:true,...changes}]);}
 await t.test('existing empty rooms need no synthetic checkout or manual release',async()=>{
  await sql("insert into properties(id,name,lease_rent,lease_anchor) values($1,'Automatic synthetic',1000,$2)",[prop,d.today]);
  await sql("insert into rooms(id,property_id,label,capacity) values($1,$2,'Automatic',1)",[room,prop]);
  await rpc('save_listing',['property',prop,{slug:'automatic-test',suburb:'Fulham',public_name:'Synthetic property',description:'Synthetic verified property description.',published:true}]);
  await profile({published:false}); assert.equal(await visible(),false);
  await profile(); assert.equal(await visible(),true);assert.equal((await available()).spaces,1);
  assert.equal((await sql('select count(*)::int n from room_listing_releases where room_id=$1',[room])).rows[0].n,0);
 });
 await t.test('check-in hides vacancy; future checkout does not advertise it early',async()=>{
  await sql("insert into people(id,name,property_id,room_id,start_date,end_date,weekly_rate,bond) values($1,'Synthetic private name',$2,$3,$4,$5,175,350)",[resident,prop,room,d.past,d.tomorrow]);
  assert.equal(await visible(),false); assert.equal((await available()).spaces,0);
 });
 await t.test('completed checkout appears automatically without changing approved content',async()=>{
  const revision=(await sql('select revision from room_profiles where room_id=$1',[room])).rows[0].revision;
  await sql('update people set end_date=$1 where id=$2',[d.today,resident]);
  assert.equal(await visible(),true);assert.equal((await available()).spaces,1);
  assert.equal((await sql('select revision from room_profiles where room_id=$1',[room])).rows[0].revision,revision);
  const person=(await sql('select weekly_rate::text,bond::text from people where id=$1',[resident])).rows[0];assert.equal(Number(person.weekly_rate),175);assert.equal(Number(person.bond),350);
 });
 await t.test('checkout reversal immediately withdraws vacancy',async()=>{
  await sql('update people set end_date=null where id=$1',[resident]);assert.equal(await visible(),false);
  await sql('update people set end_date=$1 where id=$2',[d.today,resident]);assert.equal(await visible(),true);
 });
 await t.test('maintenance and readiness still prevent public availability',async()=>{
  const block=(await sql("insert into room_blocks(room_id,starts_on,ends_on,spaces,reason) values($1,$2,$3,1,'Synthetic repair') returning id",[room,d.today,d.finish])).rows[0];assert.equal(await visible(),false);assert.equal((await available()).spaces,0);
  await sql('delete from room_blocks where id=$1',[block.id]);
  await profile({published:false,ready:false});assert.equal(await visible(),false);
  await assert.rejects(()=>profile({published:true,ready:false}),/readiness/);
  await profile({published:true,ready:true});assert.equal(await visible(),true);
 });
 await t.test('holds consume vacancies and cancellation restores them automatically',async()=>{
  await sql('update booking_settings set requests_enabled=true');
  const made=await rpc('create_staff_reservation',[{room_id:room,full_name:'Synthetic Guest',email:'auto@example.test',phone:'0400000000',arrival_date:d.today,departure_date:d.finish},crypto.randomUUID()]);
  let r=(await sql('select * from reservations where reservation_code=$1',[made.code])).rows[0];
  r=await rpc('manage_reservation',[r.id,r.revision,'hold',{expires_at:new Date(Date.now()+3600000).toISOString()}]);assert.equal(await visible(),false);
  await rpc('manage_reservation',[r.id,r.revision,'cancel',{}]);assert.equal(await visible(),true);
 });
 await t.test('anonymous catalog exposes approved public fields only and nonstaff cannot approve',async()=>{
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await sql('set role authenticated');
  try {await assert.rejects(()=>profile(),/Staff access/);}finally {await sql('reset role');}
  await sql('set role anon');try {const cat=JSON.stringify(await catalog());assert.ok(!cat.includes('Synthetic private name'));assert.ok(!cat.includes(resident));assert.equal(await visible(),true);}finally {await sql('reset role');}
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 });
}
