import assert from 'node:assert/strict';
export async function verifyGuestCommunications({t,sql,rpc,STAFF,OTHER,applyMigrations}){
 await applyMigrations();await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const prop=(await sql('select id from properties limit 1')).rows[0].id;
 const person=async(name,email)=>(await sql("insert into people(name,email,property_id,start_date,end_date,weekly_rate) values($1,$2,$3,current_date-30,current_date+2,185) returning id",[name,email,prop])).rows[0].id;
 await t.test('checkout thanks queue once, use the tenant email, and never backfill old departures',async()=>{
  const p=await person('Thank You Resident','thankyou@example.test');
  await sql('update people set checked_out_at=now() where id=$1',[p]);
  let rows=(await sql("select * from incoming_alert_deliveries where kind='checkout_thanks' and source_id=$1",[p])).rows;assert.equal(rows.length,1);assert.equal(rows[0].recipient,'thankyou@example.test');
  for(const link of ['https://maps.app.goo.gl/GYqfd7BsjgCmsMdy9?g_st=ic','https://www.facebook.com/SakanLodge/reviews/','https://sakanlodge.com/#leave-review'])assert.ok(rows[0].body.includes(link));
  await sql("update people set name='Thank You Resident Updated' where id=$1",[p]);assert.equal((await sql("select count(*)::int n from incoming_alert_deliveries where source_id=$1 and kind='checkout_thanks'",[p])).rows[0].n,1);
  await sql('update people set checked_out_at=null where id=$1',[p]);assert.equal((await sql('select status from incoming_alert_deliveries where id=$1',[rows[0].id])).rows[0].status,'cancelled');
  const old=await person('Past Resident','old@example.test');await sql('update people set checked_out_at=now()-interval \'10 days\',end_date=current_date-10 where id=$1',[old]);assert.equal((await sql("select count(*)::int n from incoming_alert_deliveries where source_id=$1 and kind='checkout_thanks'",[old])).rows[0].n,0);
  const missing=await person('No Email Resident',null);await sql('update people set checked_out_at=now() where id=$1',[missing]);assert.equal((await sql("select count(*)::int n from incoming_alert_deliveries where source_id=$1 and kind='checkout_thanks'",[missing])).rows[0].n,0);
  await sql('update people set checked_out_at=now() where id=$1',[p]);await sql("update incoming_alert_deliveries set status='sent' where id=$1",[rows[0].id]);await sql("update people set name='Later correction' where id=$1",[p]);assert.equal((await sql('select status from incoming_alert_deliveries where id=$1',[rows[0].id])).rows[0].status,'sent');
 });
 await t.test('scheduled departures wait until the next day and queued emails honour delay and address corrections',async()=>{
  const p=await person('Scheduled departure','scheduled@example.test');
  await sql("update booking_settings set checkout_emails_enabled_at=now()-interval '1 day'");
  await sql('update people set end_date=current_date where id=$1',[p]);
  await sql('select sakan_private.queue_due_checkout_thanks()');
  assert.equal((await sql("select count(*)::int n from incoming_alert_deliveries where kind='checkout_thanks' and source_id=$1",[p])).rows[0].n,0);
  await sql('update people set end_date=current_date-1 where id=$1',[p]);
  const row=(await sql("select * from incoming_alert_deliveries where kind='checkout_thanks' and source_id=$1",[p])).rows[0];assert.ok(row);
  await sql('set role service_role');try{assert.equal(await rpc('incoming_alert_worker',['claim',row.id,crypto.randomUUID(),null]),null);}finally{await sql('reset role');}
  await sql("update people set email='corrected@example.test' where id=$1",[p]);assert.equal((await sql('select recipient from incoming_alert_deliveries where id=$1',[row.id])).rows[0].recipient,'corrected@example.test');
  await sql("update incoming_alert_deliveries set not_before=now()-interval '1 second',created_at=now()-interval '100 years' where id=$1",[row.id]);await sql('set role service_role');try{const ids=await rpc('incoming_alert_worker',['pending',null,null,null]);assert.ok(ids.includes(row.id));const claimed=await rpc('incoming_alert_worker',['claim',row.id,crypto.randomUUID(),null]);assert.equal(claimed.recipient,'corrected@example.test');}finally{await sql('reset role');}
 });
 let thread;
 const imported={gmail_thread_id:'abc123',subject:'Room enquiry',contact_email:'guest@example.test',contact_name:'Guest',messages:[{id:'a123',direction:'incoming',sender:'guest@example.test',body:'Is a shared bed available?',rfc_message_id:'<original@example.test>',sent_at:new Date().toISOString()}]};
 const service=async(action,data={})=>{await sql('set role service_role');try{return await rpc('enquiry_inbox_worker',[action,data]);}finally{await sql('reset role');}};
 await t.test('shared enquiry history imports idempotently and is invisible to anonymous and nonstaff users',async()=>{
  const web=(await sql("insert into website_enquiries(request_key,fingerprint,details) values(gen_random_uuid(),repeat('a',64),'{\"full_name\":\"Website Guest\",\"email\":\"web@example.test\",\"message\":\"Can I book a room?\"}'::jsonb) returning id")).rows[0].id;
  await service('website');await service('website');assert.equal((await sql('select count(*)::int n from enquiry_threads where website_enquiry_id=$1',[web])).rows[0].n,1);assert.deepEqual(await service('unconfirmed'),[]);assert.equal((await service('admins')).length,2);
  thread=(await service('import',imported)).thread_id;await service('import',imported);
  assert.equal((await sql('select count(*)::int n from enquiry_messages where thread_id=$1',[thread])).rows[0].n,1);
  await sql('set role anon');try{await assert.rejects(()=>sql('select * from enquiry_threads'),/permission denied/);}finally{await sql('reset role');}
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await sql('set role authenticated');try{assert.equal((await sql('select * from enquiry_threads')).rows.length,0);await assert.rejects(()=>rpc('enquiry_action',['prepare',{thread_id:thread,revision:1,body:'Reply'}]),/Staff access/);}finally{await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);}
 });
 await t.test('reply snapshots use the thread contact, copy both admins and permit only one send attempt',async()=>{
  const current=(await sql('select * from enquiry_threads where id=$1',[thread])).rows[0];
  const preview=await rpc('enquiry_action',['prepare',{thread_id:thread,revision:current.revision,body:'Yes, please share your dates.',recipient:'attacker@example.test'}]);assert.equal(preview.recipient,'guest@example.test');assert.equal(preview.cc.length,2);assert.equal(preview.rfc_reply_to,'<original@example.test>');
  const claim=await rpc('enquiry_action',['claim',{reply_id:preview.id}]);assert.equal(claim.status,'sending');await assert.rejects(()=>rpc('enquiry_action',['claim',{reply_id:preview.id}]),/expired|changed/);
  await service('sent',{reply_id:preview.id,message_id:'b123',thread_id:'abc123'});
  assert.equal((await sql('select status from enquiry_threads where id=$1',[thread])).rows[0].status,'waiting');
  const message=(await sql("select * from enquiry_messages where thread_id=$1 and direction='outgoing'",[thread])).rows[0];assert.equal(message.body,preview.body);assert.ok(message.author_email);
  const latest=(await sql('select revision from enquiry_threads where id=$1',[thread])).rows[0].revision;
  const stale=await rpc('enquiry_action',['prepare',{thread_id:thread,revision:latest,body:'Another reply'}]);
  await service('import',{...imported,messages:[...imported.messages,{...imported.messages[0],id:'c123',body:'My dates are next month',sent_at:new Date(Date.now()+1000).toISOString()}]});
  await assert.rejects(()=>rpc('enquiry_action',['claim',{reply_id:stale.id}]),/changed/);
 });
}
