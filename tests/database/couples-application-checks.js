import assert from 'node:assert/strict';
import {sha256} from '../../src/contract-signing.js';
export async function verifyCouplesApplication({t,sql,rpc,STAFF,OTHER,applyMigration}) {
 await applyMigration();
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Couples synthetic',1000,current_date) returning id")).rows[0].id;
 const room=(await sql("insert into rooms(property_id,label,capacity) values($1,'Granny flat',2) returning id",[prop])).rows[0].id;
 await rpc('save_listing',['property',prop,{slug:'couples-synthetic',public_name:'Couples test house',suburb:'Fulham',description:'Synthetic house for couples checks.',published:true}]);
 await rpc('save_listing',['room',room,{slug:'granny-flat',title:'Synthetic granny flat',description:'Whole flat for two occupants.',ready:true,published:true}]);
 await sql("insert into contract_defaults(property_id,premises_address,proprietor,draft_terms) values($1,'Synthetic premises address','{\"name\":\"Synthetic proprietor\",\"address\":\"Synthetic contact address\",\"phone\":\"0400000000\"}','Synthetic reviewed agreement terms for an accommodation stay. Both occupants sign individually.')",[prop]);
 await sql('update booking_settings set requests_enabled=true');
 const dates=(await sql("select (current_date+3)::text arrival,(current_date+130)::text departure")).rows[0];
 const key=crypto.randomUUID();
 const occupants=[1,2].map(i=>({name:`Synthetic Occupant ${i}`,email:`couple${i}@example.test`,phone:`040000000${i}`,occupation:'Synthetic',id_path:`applications/${key}/${i}-${String(i).repeat(64)}.jpg`}));
 const data={room_id:room,arrival_date:dates.arrival,departure_date:dates.departure,introduction:'Synthetic couple application',occupants,consent_version:'couples-application-v1'};
 let result;
 await t.test('couples require two complete applicants, both private IDs and more than three months',async()=>{
  await assert.rejects(()=>rpc('submit_couples_application',[{...data,occupants:occupants.slice(0,1)},key]),/both occupants/);
  await assert.rejects(()=>rpc('submit_couples_application',[{...data,occupants:[occupants[0],{...occupants[1],phone:''}]},key]),/contact details/);
  await assert.rejects(()=>rpc('submit_couples_application',[{...data,consent_version:''},key]),/consent/);
  await assert.rejects(()=>rpc('submit_couples_application',[data,key]),/photo IDs/);
  await assert.rejects(()=>rpc('room_availability',[room,dates.arrival,dates.arrival]),/dates/);
  const boundary=(await sql("select ($1::date+interval '3 months')::date::text d",[dates.arrival])).rows[0].d;
  await assert.rejects(()=>rpc('room_availability',[room,dates.arrival,boundary]),/longer than three/);
  await assert.rejects(()=>rpc('submit_reservation',[{room_id:room,arrival_date:dates.arrival,departure_date:dates.departure,full_name:'Bypass Applicant',email:'bypass@example.test',phone:'0400000000',spaces_requested:2},crypto.randomUUID()]),/couples application form/);
 });
 await t.test('couples application creates one reservation and immutable draft naming both, split rent and bond, with safe retries',async()=>{
  for(const p of occupants)await sql("insert into storage.objects(bucket_id,name) values('reservation-ids',$1)",[p.id_path]);
  result=await rpc('submit_couples_application',[data,key]);
  assert.equal(result.status,'pending');assert.deepEqual(result.contract.fields.resident_names,occupants.map(p=>p.name));
  assert.equal(result.contract.fields.weekly_rate,250);assert.equal(result.contract.fields.bond,500);assert.equal(result.contract.fields.couples_total_weekly,500);assert.equal(result.contract.fields.couples_total_bond,1000);
  assert.equal(JSON.stringify(result.contract.fields).includes('id_path'),false);
  const again=await rpc('submit_couples_application',[data,key]);assert.equal(again.reservation_id,result.reservation_id);assert.equal(again.contract.id,result.contract.id);
  await assert.rejects(()=>rpc('submit_couples_application',[{...data,occupants:[occupants[0],{...occupants[1],name:'Changed applicant'}]},key]),/identifier already used/);
 });
 await t.test('IDs and applicant records are unavailable to anonymous and nonstaff users',async()=>{
  for(const role of ['anon','authenticated']){
   await sql('begin');try{await sql(`set local role ${role}`);await sql("select set_config('request.jwt.claim.sub',$1,true)",[OTHER]);
    await assert.rejects(()=>rpc('submit_couples_application',[data,key]),/permission denied/);
   }finally{await sql('rollback');}
  }
  await sql('begin');try{await sql('set local role authenticated');await sql("select set_config('request.jwt.claim.sub',$1,true)",[OTHER]);assert.equal((await sql('select * from reservation_applicants')).rows.length,0);}finally{await sql('rollback');}
  assert.equal((await sql("select public from storage.buckets where id='reservation-ids'")).rows[0].public,false);
 });
 await t.test('approval allocates both tenants with separate contacts and IDs and charges only $500/week total',async()=>{
  const c=result.contract,path=`contracts/${result.reservation_id}/${c.id}/application.pdf`;
  await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",[path]);
  await rpc('complete_application_contract',[key,c.id,path]);
  const r=(await sql('select * from reservations where id=$1',[result.reservation_id])).rows[0];
  const token='e'.repeat(64),hash=await sha256(token),docHash='a'.repeat(64);
  const invitation=await rpc('prepare_contract_signing',[c.id,r.revision,hash,docHash,7,'https://sakanlodge.com/sign#'+token]);
  const signatures=occupants.map(p=>({name:p.name,mode:'typed',consent:true,strokes:[]}));
  await assert.rejects(()=>rpc('contract_signing_public',[hash,'begin',{document_hash:docHash,submission_hash:'b'.repeat(64),consent_version:'sakan-sign-v1',signatures:signatures.slice(0,1)}]),/signature|resident/i);
  await rpc('contract_signing_public',[hash,'begin',{document_hash:docHash,submission_hash:'b'.repeat(64),consent_version:'sakan-sign-v1',signatures}]);
  const signedPath=`contracts/${r.id}/${c.id}/signed-${invitation.request.id}.pdf`;
  await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",[signedPath]);
  await rpc('contract_signing_public',[hash,'complete',{path:signedPath,signed_hash:'c'.repeat(64),submission_hash:'b'.repeat(64)}]);
  const allocated=await rpc('review_contract_signing',[invitation.request.id,r.revision,'approve',null]);
  const people=(await sql('select p.name,p.email,p.phone,p.weekly_rate,p.bond,a.person_id from reservation_applicants a join people p on p.id=a.person_id where a.reservation_id=$1 order by a.occupant_number',[r.id])).rows;
  assert.equal(people.length,2);assert.deepEqual(people.map(p=>p.email),occupants.map(p=>p.email));assert.equal(people.reduce((s,p)=>s+Number(p.weekly_rate),0),500);assert.equal(people.reduce((s,p)=>s+Number(p.bond),0),1000);
  assert.equal(allocated.assigned_people.length,2);assert.equal((await rpc('room_availability',[room,dates.arrival,dates.departure])).spaces,0);
  await assert.rejects(()=>rpc('confirm_manual_booking',[r.id,r.revision,c.id]),/changed|confirmed again/);
 });
}
