import assert from 'node:assert/strict';
export async function verifyAgreements({t,sql,rpc,STAFF,OTHER,applyMigration}){
 await applyMigration();
 await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const source={title:'Synthetic private agreement v1',terms:'Reviewed synthetic terms. Electricity, water, gas and internet are included without additional charges.',proprietor:{name:'Synthetic Lodge',address:'Synthetic management address',phone:'0400000000'},confirmation:'APPROVE_REUSABLE_TEMPLATE'};
 let template,r,c;
 await t.test('template approval rejects unresolved and obsolete source wording',async()=>{
  for(const terms of [source.terms+' [VERIFY DATE]',source.terms+' Electricity threshold $800 per quarter',source.terms+' evacuation without any notice']) await assert.rejects(()=>rpc('approve_agreement_template',[{...source,terms}]),/placeholders|obsolete/);
  template=await rpc('approve_agreement_template',[source]);
 });
 await t.test('private reusable templates are immutable and staff-only',async()=>{
  await sql('set role authenticated');
  assert.equal((await sql('select count(*)::int n from agreement_templates')).rows[0].n,1);
  await assert.rejects(()=>sql("update agreement_templates set terms='changed'"),/permission denied/);
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
  assert.equal((await sql('select count(*)::int n from agreement_templates')).rows[0].n,0);
  await assert.rejects(()=>rpc('approve_agreement_template',[source]),/staff|Staff|Administrator/);
  await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 });
 await t.test('structured agreement requires all residents, bond, term, and explicit nightly rate',async()=>{
  const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
  const prop=(await sql("insert into properties(name,lease_rent,lease_anchor,lease_start) values('Synthetic agreement property',1000,$1,$1) returning id",[today])).rows[0];
  const room=(await sql("insert into rooms(property_id,label,capacity) values($1,'Synthetic room',1) returning id",[prop.id])).rows[0];
  await sql('insert into room_profiles(room_id,ready,published) values($1,true,false)',[room.id]);
  const departure=(await sql('select ($1::date+3)::text d',[today])).rows[0].d;
  const created=await rpc('create_staff_reservation',[{room_id:room.id,full_name:'Fresh Synthetic Applicant',email:'new@example.test',phone:'0400000001',arrival_date:today,departure_date:departure},crypto.randomUUID()]);
  r=(await sql('select * from reservations where reservation_code=$1',[created.code])).rows[0];
  const data={revision:r.revision,template_id:template.id,premises_address:'Verified synthetic premises',resident_names:['Fresh Synthetic Applicant'],term_description:'Agreed three-night stay',first_rent_due:today,bond:120,nightly_rate:55};
  for(const patch of [{nightly_rate:null},{nightly_rate:'NaN'},{nightly_rate:55.001},{bond:-1},{resident_names:[]},{revision:r.revision+1}])await assert.rejects(()=>rpc('create_template_contract',[r.id,{...data,...patch}]),/nightly|bond|resident|changed/i);
  c=await rpc('create_template_contract',[r.id,data]);
  assert.equal(c.fields.full_name,r.full_name);assert.equal(c.fields.email,'new@example.test');assert.equal(c.fields.billing_type,'nightly');assert.equal(c.fields.nightly_rate,55);assert.equal(c.fields.bond,120);assert.deepEqual(c.fields.resident_names,['Fresh Synthetic Applicant']);assert.equal(c.fields.proprietor.name,'Synthetic Lodge');
 });
 await t.test('new template versions cannot mutate issued snapshots and signed nightly check-in uses the approved rate',async()=>{
  await rpc('approve_agreement_template',[{...source,title:'Synthetic revised template',terms:source.terms+' Revised future terms.'}]);
  const frozen=(await sql('select fields from contracts where id=$1',[c.id])).rows[0].fields;assert.equal(frozen.terms,source.terms);
  await rpc('manage_contract',[r.id,'approve',{id:c.id}]);
  const path='contracts/synthetic-agreement/signed.pdf';await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",[path]);
  await rpc('manage_contract',[r.id,'signed',{id:c.id,signature_verified:true,signed_by:r.full_name,signed_document_path:path}]);
  r=await rpc('manage_reservation',[r.id,r.revision,'confirm',{}]);
  await assert.rejects(()=>rpc('manage_reservation',[r.id,r.revision,'check_in',{bond:600}]),/Bond must match/);
  await assert.rejects(()=>rpc('manage_reservation',[r.id,r.revision,'check_in',{bond:120,residents:[{name:'Different Applicant'}]}]),/names must match/);
  const checked=await rpc('manage_reservation',[r.id,r.revision,'check_in',{bond:120}]);
  const person=(await sql('select stay_type,nightly_rate,bond from people where id=$1',[checked.checked_in_person_id])).rows[0];assert.equal(person.stay_type,'short');assert.equal(Number(person.nightly_rate),55);assert.equal(Number(person.bond),120);
  assert.equal((await sql("select count(*)::int n from payments where person_id=$1",[checked.checked_in_person_id])).rows[0].n,0);
 });
}
