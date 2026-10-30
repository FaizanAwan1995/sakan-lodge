import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import{readFile}from'node:fs/promises';
test('segment galleries are public-read, staff-write, revision-protected and restricted to uploaded images',async()=>{
 const db=new PGlite(),staff='00000000-0000-4000-8000-000000000001';
 try{
 await db.exec(await readFile(new URL('./database/foundation.sql',import.meta.url),'utf8'));
 await db.exec(`grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;create schema sakan_private;grant usage on schema sakan_private to authenticated;create table public.audit(id bigserial primary key,"by" text,action text,entity_table text,entity_id text,reason text);create function public.is_sakan_staff() returns boolean language sql stable security definer set search_path='' as $$select auth.uid()='${staff}'::uuid$$;create function sakan_private.require_staff() returns void language plpgsql security definer set search_path='' as $$begin if not coalesce(public.is_sakan_staff(),false) then raise exception 'Staff access required';end if;end$$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261030222323_segment_photo_management.sql',import.meta.url),'utf8'));
 const role=async(name,uid='')=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
 const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).rows[0].result;
 await role('anon');const galleries=await rpc('public_segment_photos');assert.equal(galleries.women.length,2);assert.equal(galleries.men.length,1);await assert.rejects(()=>rpc('save_segment_photos',['women',[],1]),/permission denied/);await assert.rejects(()=>db.query("update accommodation_segment_photos set photos='[]'"),/permission denied/);
 await role('authenticated');await assert.rejects(()=>rpc('save_segment_photos',['women',[],1]),/Staff access required/);
 await role('authenticated',staff);const changed=await rpc('save_segment_photos',['women',[...galleries.women].reverse(),1]);assert.equal(changed.revision,2);assert.equal(changed.photos[0],galleries.women[1]);await assert.rejects(()=>rpc('save_segment_photos',['women',[],1]),/Photos changed/);
 for(const invalid of [['javascript:alert(1)'],['https://evil.test/photo.jpg'],['/property-photos/other.jpg'],[galleries.women[0],galleries.women[0]],Array(21).fill(galleries.women[0])])await assert.rejects(()=>rpc('save_segment_photos',['women',invalid,2]));
 const object='women/00000000-0000-4000-8000-000000000001.jpg',url='https://gpohuctqsmmoikupyfvi.supabase.co/storage/v1/object/public/segment-photos/'+object;
 await assert.rejects(()=>rpc('save_segment_photos',['women',[url],2]),/Uploaded photo not found/);
 await role('authenticated');await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('segment-photos',$1)",[object]),/row-level security/);await role('authenticated',staff);await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('segment-photos','unknown/photo.jpg')"),/row-level security/);await db.query("insert into storage.objects(bucket_id,name) values('segment-photos',$1)",[object]);
 const uploaded=await rpc('save_segment_photos',['women',[url],2]);assert.equal(uploaded.photos[0],url);await assert.rejects(()=>rpc('save_segment_photos',['men',[url],1]),/Upload a photo to this segment/);
 await rpc('save_segment_photos',['women',[],3]);await role('anon');assert.deepEqual((await rpc('public_segment_photos')).women,[]);
 }finally{await db.close();}
});
