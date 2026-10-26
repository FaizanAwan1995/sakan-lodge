import assert from 'node:assert/strict';
export async function verifyRoomPhotos({t,sql,rpc,STAFF,OTHER}){
 await sql('reset role');await sql('grant usage on schema storage to authenticated');await sql('grant select,insert,delete on storage.objects to authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Photo test house',500,'2026-10-01') returning id")).rows[0].id;
 const room=(await sql("insert into rooms(property_id,label,capacity) values($1,'Photo test room',2) returning id",[prop])).rows[0].id;
 let profile;
 await t.test('room photo updates create a draft without publishing or changing occupancy',async()=>{
  profile=await rpc('save_room_photos',[room,['https://images.example.test/main.jpg'],null]);assert.equal(profile.published,false);assert.equal(profile.ready,false);assert.equal(profile.offer_type,'shared');assert.equal(profile.photos.length,1);
 });
 await t.test('stale photo updates and unsafe URLs are rejected',async()=>{
  await assert.rejects(()=>rpc('save_room_photos',[room,[],null]),/changed/);
  await assert.rejects(()=>rpc('save_room_photos',[room,['javascript:alert(1)'],profile.revision]),/HTTPS/);
  await assert.rejects(()=>rpc('save_room_photos',[room,Array(21).fill('https://images.example.test/a.jpg'),profile.revision]),/20/);
 });
 await t.test('gallery updates preserve published listing metadata and support cover selection and removal',async()=>{
  await sql("update room_profiles set published=true,ready=true,approved_at=now(),approved_by=$2,description='Verified original description' where room_id=$1",[room,STAFF]);
  const updated=await rpc('save_room_photos',[room,['https://images.example.test/cover.jpg','https://images.example.test/main.jpg'],profile.revision]);
  assert.equal(updated.published,true);assert.equal(updated.ready,true);assert.equal(updated.description,'Verified original description');assert.equal(updated.approved_by,STAFF);assert.equal(updated.photos[0],'https://images.example.test/cover.jpg');
  const removed=await rpc('save_room_photos',[room,[],updated.revision]);assert.deepEqual(removed.photos,[]);assert.equal(removed.published,true);
 });
 await t.test('photo editing and storage uploads require staff permissions',async()=>{
  await sql('set role anon');await assert.rejects(()=>rpc('save_room_photos',[room,[],1]),/permission denied/);await sql('reset role');
  await sql('set role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('save_room_photos',[room,[],1]),/Staff/);await assert.rejects(()=>sql("insert into storage.objects(bucket_id,name) values('room-photos',$1)",[room+'/test.jpg']),/row-level security|permission denied/);await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  await sql('set role authenticated');await sql("insert into storage.objects(bucket_id,name) values('room-photos',$1)",[room+'/test.jpg']);await sql('reset role');
 });
}
