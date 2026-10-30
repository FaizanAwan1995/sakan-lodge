import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('incoming alerts are atomic, idempotent, service-only, staff-readable and claim once',async()=>{
 const db=new PGlite();const staff='00000000-0000-4000-8000-000000000001';
 try{
 await db.exec(await readFile(new URL('./database/foundation.sql',import.meta.url),'utf8'));
 await db.exec(`create schema sakan_private;create function public.is_sakan_staff() returns boolean language sql stable security definer as $$select auth.uid()='${staff}'::uuid$$;create function sakan_private.staff_emails() returns text[] language sql as $$select array['staff@example.test','staff2@example.test']$$;create table properties(id uuid,name text);create table rooms(id uuid,property_id uuid,label text);create table property_profiles(property_id uuid,public_name text);create table reservations(id uuid default gen_random_uuid(),reservation_code text,email text,full_name text,phone text,room_id uuid,arrival_date date,departure_date date,spaces_requested int,introduction text);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261030215006_incoming_staff_alerts.sql',import.meta.url),'utf8'));
 const role=async(name,uid='')=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
 const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).rows[0].result;
 const payload={full_name:'Synthetic Guest',email:'guest@example.test',phone:'0400000000',location:'Fulham',accommodation:'Private room',occupants:'2',message:'Granny flat'};const key=crypto.randomUUID(),fingerprint='a'.repeat(64);
 await role('anon');await assert.rejects(()=>rpc('submit_enquiry',[payload,key,fingerprint]),/permission denied/);await assert.rejects(()=>db.query('select * from website_enquiries'),/permission denied/);
 await role('service_role');const result=await rpc('submit_enquiry',[payload,key,fingerprint]);assert.match(result.reference,/^ENQ-/);assert.deepEqual(await rpc('submit_enquiry',[payload,key,fingerprint]),result);
 await assert.rejects(()=>rpc('submit_enquiry',[{...payload,message:'changed'},key,fingerprint]),/Request changed/);
 assert.equal((await db.query('select count(*)::int n from website_enquiries')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from incoming_alert_deliveries')).rows[0].n,3);
 const ids=await rpc('incoming_alert_worker',['pending']);const attempt=crypto.randomUUID();const claimed=await rpc('incoming_alert_worker',['claim',ids[0],attempt]);assert.equal(claimed.status,'sending');assert.equal(await rpc('incoming_alert_worker',['claim',ids[0],crypto.randomUUID()]),null);
 await rpc('incoming_alert_worker',['sent',ids[0],crypto.randomUUID(),'wrong']);assert.equal((await db.query('select status from incoming_alert_deliveries where id=$1',[ids[0]])).rows[0].status,'sending');
 await rpc('incoming_alert_worker',['sent',ids[0],attempt,'gmail-id']);assert.equal((await db.query('select status from incoming_alert_deliveries where id=$1',[ids[0]])).rows[0].status,'sent');
 await db.exec('reset role');await db.exec(`insert into reservations(reservation_code,email,full_name,phone,arrival_date,departure_date,spaces_requested) values('SK-TEST','guest@example.test','Guest','0400000000','2027-01-01','2027-02-01',1)`);
 assert.equal((await db.query("select count(*)::int n from incoming_alert_deliveries where kind='reservation'")).rows[0].n,3);
 await role('authenticated');assert.equal((await db.query('select * from website_enquiries')).rows.length,0);await assert.rejects(()=>rpc('incoming_alert_worker',['pending']),/permission denied/);
 await role('authenticated',staff);assert.equal((await db.query('select * from website_enquiries')).rows.length,1);await assert.rejects(()=>db.query('delete from website_enquiries'),/permission denied/);
 await role('service_role');for(let i=1;i<5;i++)await rpc('submit_enquiry',[payload,crypto.randomUUID(),fingerprint]);await assert.rejects(()=>rpc('submit_enquiry',[payload,crypto.randomUUID(),fingerprint]),/Too many enquiries/);
 }finally{await db.close();}
});
