import assert from 'node:assert/strict';
import {sha256} from '../../src/contract-signing.js';
export async function verifySigning({t,sql,rpc,STAFF,OTHER,applyMigration,assertSingleAllocation}) {
  await applyMigration();
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  const prop=crypto.randomUUID(),room=crypto.randomUUID();
  await sql("insert into properties(id,name,lease_rent,lease_anchor) values($1,'Signing Synthetic',500,'2035-01-01')",[prop]);
  await sql("insert into rooms(id,property_id,label,capacity) values($1,$2,'Signing Room',1)",[room,prop]);
  await sql("insert into room_profiles(room_id,slug,title,description,ready,published,offer_type) values($1,'signing-room','Synthetic Room','Synthetic signing room',true,false,'private')",[room]);
  const template=await rpc('approve_agreement_template',[{title:'Signing synthetic template',terms:'Synthetic agreement for isolated signing tests only. No real tenancy is created.',proprietor:{name:'Synthetic Owner',address:'1 Synthetic Road',phone:'0400000000'},confirmation:'APPROVE_REUSABLE_TEMPLATE'}]);
  let offset=0;
  async function make({sameDates=false,spaces=1,weeklyRate=255}={}) {
    const dates=(await sql("select (date '2035-01-01'+$1::int)::text arrival,(date '2035-05-01'+$1::int)::text departure",[sameDates?8000:(offset+=200)])).rows[0];
    const made=await rpc('create_staff_reservation',[{room_id:room,full_name:'Synthetic Signer',email:'synthetic@example.test',phone:'0400000000',spaces_requested:spaces,arrival_date:dates.arrival,departure_date:dates.departure},crypto.randomUUID()]);
    const r=(await sql('select * from reservations where reservation_code=$1',[made.code])).rows[0];
    const out=await rpc('generate_booking_contract',[r.id,r.revision,{...r,template_id:template.id,premises_address:'2 Synthetic Road',term_description:'Synthetic fixed stay',resident_names:['Synthetic Signer'],first_rent_due:r.arrival_date,bond:510,weekly_rate:weeklyRate}]);
    const path=`contracts/${r.id}/${out.contract.id}/original.pdf`;
    await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",[path]);
    out.contract=(await rpc('booking_contract_document',[out.contract.id,path])).contract;
    const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    const hash=await sha256(token),docHash='a'.repeat(64);
    const invitation=await rpc('prepare_contract_signing',[out.contract.id,out.reservation.revision,hash,docHash,7,'https://sakanlodge.com/sign#'+token]);
    return {...out,token,hash,docHash,...invitation};
  }
  const payload=(s,name='Synthetic Signer')=>({document_hash:s.docHash,submission_hash:'b'.repeat(64),consent_version:'sakan-sign-v1',signatures:[{name,mode:'typed',consent:true,strokes:[]}]});
  const access=s=>rpc('contract_signing_public',[s.hash,'access',{}]);
  async function sign(s) {
    const begin=await rpc('contract_signing_public',[s.hash,'begin',payload(s)]);
    const path=`contracts/${s.reservation.id}/${s.contract.id}/signed-${s.request.id}.pdf`;
    await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1) on conflict do nothing",[path]);
    const data={path,signed_hash:'c'.repeat(64),submission_hash:'b'.repeat(64)};
    const signed=await rpc('contract_signing_public',[s.hash,'complete',data]);
    return {...s,signed,begin,data};
  }
  await t.test('signing creates only a private invitation draft and anonymous users cannot access its rows or RPCs',async()=>{
    const s=await make();assert.equal(s.request.status,'awaiting_signature');assert.equal(s.notification.kind,'contract_signing');assert.equal(s.notification.status,'pending');assert.ok(s.notification.payload.body.includes('/sign#'+s.token));assert.equal(s.request.token_hash,undefined);assert.ok(!s.notification.payload.subject.includes(s.reservation.reservation_code));assert.match(s.notification.payload.body,/Check-in: [A-Z][a-z]+, \d+ [A-Z][a-z]+ \d{4}/);
    for(const role of ['anon','authenticated'])assert.equal((await sql("select has_function_privilege($1,'public.contract_signing_public(text,text,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
    assert.equal((await sql("select has_function_privilege('service_role','public.contract_signing_public(text,text,jsonb)','execute') allowed")).rows[0].allowed,true);
    await sql('set role anon');try{await assert.rejects(()=>sql('select * from contract_signing_requests'),/permission denied/);}finally{await sql('reset role');}
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await sql('set role authenticated');try{assert.equal(Number((await sql('select count(*) n from contract_signing_requests')).rows[0].n),0);await assert.rejects(()=>rpc('review_contract_signing',[s.request.id,s.reservation.revision,'approve',null]),/Staff/);}finally{await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);}
  });
  await t.test('invalid token, missing consent, mismatched signer and changed document cannot sign or allocate',async()=>{
    const s=await make();await assert.rejects(()=>rpc('contract_signing_public',['0'.repeat(64),'access',{}]),/unavailable/);
    await assert.rejects(()=>rpc('contract_signing_public',[s.hash,'begin',payload(s,'Different Signer')]),/resident/);
    await assert.rejects(()=>rpc('contract_signing_public',[s.hash,'begin',{...payload(s),signatures:[{name:'Synthetic Signer',mode:'typed',consent:false}]}]),/resident/);
    await assert.rejects(()=>rpc('contract_signing_public',[s.hash,'begin',{...payload(s),document_hash:'d'.repeat(64)}]),/current agreement/);
    await assert.rejects(()=>rpc('confirm_manual_booking',[s.reservation.id,s.reservation.revision,s.contract.id]),/online signature/);
    assert.equal((await sql('select checked_in_person_id from reservations where id=$1',[s.reservation.id])).rows[0].checked_in_person_id,null);
  });
  await t.test('signature receipt is immutable and retryable without duplicate events or room allocation',async()=>{
    const s=await make();const begin=await rpc('contract_signing_public',[s.hash,'begin',payload(s)]);const again=await rpc('contract_signing_public',[s.hash,'begin',payload(s)]);assert.equal(begin.request.submitted_at,again.request.submitted_at);
    await assert.rejects(()=>rpc('contract_signing_public',[s.hash,'begin',{...payload(s),submission_hash:'d'.repeat(64)}]),/already processing/);
    const signed=await sign(s);assert.equal(signed.signed.request.status,'signed');assert.ok(Date.parse(signed.signed.request.expires_at)-Date.now()>29*86400000);assert.ok(Number((await sql("select count(*) n from incoming_alert_deliveries where source_id=$1 and kind='signing_received'",[s.request.id])).rows[0].n)>0);assert.equal(signed.signed.contract.status,'signed');assert.equal((await sql('select status from reservations where id=$1',[s.reservation.id])).rows[0].status,'review');
    await rpc('contract_signing_public',[s.hash,'complete',signed.data]);
    assert.equal(Number((await sql("select count(*) n from reservation_events where reservation_id=$1 and action='tenant_signature_received'",[s.reservation.id])).rows[0].n),1);
    await assert.rejects(()=>rpc('confirm_manual_booking',[s.reservation.id,s.reservation.revision,s.contract.id]),/online signature/);
  });
  await t.test('approval allocates once and the signed agreement links to the created tenant profile without payments',async()=>{
    const s=await sign(await make());const out=await rpc('review_contract_signing',[s.request.id,s.reservation.revision,'approve',null]);assert.equal(out.status,'assigned');assert.equal(out.assigned_people.length,1);
    const person=(await sql('select * from people where id=$1',[out.checked_in_person_id])).rows[0];assert.equal(person.name,'Synthetic Signer');assert.equal(person.room_id,room);assert.equal(Number(person.weekly_rate),255);assert.equal(person.bond_status,'not_paid');
    assert.equal(Number((await sql('select count(*) n from payments where person_id=$1',[person.id])).rows[0].n),0);
    assert.equal((await sql('select signed_document_path from contracts where reservation_id=$1',[out.id])).rows[0].signed_document_path,s.signed.contract.signed_document_path);
    await assert.rejects(()=>rpc('review_contract_signing',[s.request.id,out.revision,'approve',null]),/already been handled/);
    assert.equal((await access(s)).request.status,'approved');const notices=(await sql("select * from incoming_alert_deliveries where source_id=$1 and kind='signing_approved'",[s.request.id])).rows;assert.equal(notices.length,1);assert.equal(notices[0].recipient,'synthetic@example.test');assert.ok(notices[0].body.includes('/sign#'+s.token));assert.ok(notices[0].body.includes('Payment confirmations are sent separately.'));
  });
  await t.test('rejection releases a hold, retains the signed artifact and creates no tenant',async()=>{
    const s=await sign(await make());await assert.rejects(()=>rpc('manage_reservation',[s.reservation.id,s.reservation.revision,'hold',{expires_at:new Date(Date.now()+3600000).toISOString()}]),/online signing review/);const held=await rpc('manage_reservation',[s.reservation.id,s.reservation.revision,'edit',{admin_notes:'Replacement needed'}]);
    // A material edit requires fresh signatures; reject a separate unchanged signed request below.
    await assert.rejects(()=>rpc('review_contract_signing',[s.request.id,held.revision,'reject','Not proceeding']),/changed|already been handled/);
    const s2=await sign(await make());await sql("update reservations set status='held',hold_expires_at=now()+interval '1 hour' where id=$1",[s2.reservation.id]);await assert.rejects(()=>rpc('review_contract_signing',[s2.request.id,s2.reservation.revision,'reject','']),/reason/);
    const out=await rpc('review_contract_signing',[s2.request.id,s2.reservation.revision,'reject','Applicant withdrew the request']);assert.equal(out.status,'cancelled');assert.equal(out.checked_in_person_id,null);assert.equal(out.hold_expires_at,null);
    const saved=await access(s2);assert.equal(saved.request.status,'rejected');assert.ok(saved.request.signed_document_path);assert.equal(saved.request.review_reason,'Applicant withdrew the request');const notice=(await sql("select * from incoming_alert_deliveries where source_id=$1 and kind='signing_rejected'",[s2.request.id])).rows;assert.equal(notice.length,1);assert.ok(notice[0].body.includes('Applicant withdrew the request'));assert.equal(Number((await sql("select count(*) n from notification_outbox where reservation_id=$1 and kind='cancel' and status='pending'",[s2.reservation.id])).rows[0].n),0);
  });
  await t.test('expiry, revocation and replacement immediately invalidate outstanding links',async()=>{
    const expired=await make();await sql("update contract_signing_requests set expires_at=now()-interval '1 minute' where id=$1",[expired.request.id]);await assert.rejects(()=>access(expired),/expired/);
    const revoked=await make();await rpc('review_contract_signing',[revoked.request.id,revoked.reservation.revision,'revoke',null]);await assert.rejects(()=>access(revoked),/revoked/);
    const changed=await make();await rpc('manage_reservation',[changed.reservation.id,changed.reservation.revision,'edit',{admin_notes:'Replacement required'}]);assert.equal((await access(changed)).request.status,'superseded');await assert.rejects(()=>rpc('contract_signing_public',[changed.hash,'begin',payload(changed)]),/changed/);
  });
  await t.test('approval preserves administrator-agreed rent rather than forcing the public quote',async()=>{
    const s=await sign(await make({weeklyRate:275.50}));
    const out=await rpc('review_contract_signing',[s.request.id,s.reservation.revision,'approve',null]);
    assert.equal(Number((await sql('select weekly_rate from people where id=$1',[out.checked_in_person_id])).rows[0].weekly_rate),275.5);
  });
  await t.test('two signed requests for the same room cannot both be approved',async()=>{
    const one=await sign(await make({sameDates:true})),two=await sign(await make({sameDates:true}));
    if(process.env.SAKAN_TEST_DATABASE_URL)await assertSingleAllocation([one,two].map(s=>({sql:'select public.review_contract_signing($1,$2,$3,$4)',args:[s.request.id,s.reservation.revision,'approve',null]})));
    else {await rpc('review_contract_signing',[one.request.id,one.reservation.revision,'approve',null]);await assert.rejects(()=>rpc('review_contract_signing',[two.request.id,two.reservation.revision,'approve',null]),/available|insufficient/);}
    assert.equal(Number((await sql("select count(*) n from contract_signing_requests where id=any($1::uuid[]) and status='approved'",[[one.request.id,two.request.id]])).rows[0].n),1);assert.equal(Number((await sql("select count(*) n from incoming_alert_deliveries where source_id=any($1::uuid[]) and kind='signing_approved'",[[one.request.id,two.request.id]])).rows[0].n),1);
  });
  await t.test('new agreements remove legacy return-by-email instructions without modifying frozen terms',async()=>{
    const old='Pay the agreed bond using PayID 0426721787 and reply to sakanlodges@gmail.com with the signed agreement and payment receipt. Rent is payable fortnightly.';
    const normalized=(await sql('select sakan_private.online_signing_terms($1) terms',[old])).rows[0].terms;
    assert.ok(normalized.includes('private SAKAN online signing link'));assert.ok(normalized.includes('Pay the agreed bond using PayID 0426721787'));assert.ok(normalized.endsWith('Rent is payable fortnightly.'));
    const s=await make();await sql("update contracts set fields=jsonb_set(fields,'{terms}',to_jsonb($2::text)) where id=$1",[s.contract.id,old]);
    const token='f'.repeat(64);await assert.rejects(async()=>rpc('prepare_contract_signing',[s.contract.id,s.reservation.revision,await sha256(token),'a'.repeat(64),7,'https://sakanlodge.com/sign#'+token]),/replacement agreement/);
    assert.equal((await sql("select fields->>'terms' terms from contracts where id=$1",[s.contract.id])).rows[0].terms,old);
    const fresh=(await sql("insert into contracts(reservation_id,version,fields,reservation_revision) select reservation_id,version+100,fields,reservation_revision from contracts where id=$1 returning fields",[s.contract.id])).rows[0];assert.equal(fresh.fields.terms,normalized);
  });
  await t.test('legacy status actions cannot bypass online review and cancelling an unsigned request revokes its link',async()=>{
    const s=await sign(await make());for(const action of ['hold','confirm','check_in'])await assert.rejects(()=>rpc('manage_reservation',[s.reservation.id,s.reservation.revision,action,{}]),/online signing review/);
    await assert.rejects(()=>rpc('manage_reservation',[s.reservation.id,s.reservation.revision,'cancel',{}]),/Reject request/);
    const unsigned=await make();await rpc('manage_reservation',[unsigned.reservation.id,unsigned.reservation.revision,'cancel',{}]);await assert.rejects(()=>access(unsigned),/revoked/);
  });
  await t.test('staff can reconcile uncertain outcome emails only after explicit Sent Mail verification',async()=>{
    const s=await sign(await make());await rpc('review_contract_signing',[s.request.id,s.reservation.revision,'approve',null]);
    const n=(await sql("select * from incoming_alert_deliveries where source_id=$1 and kind='signing_approved'",[s.request.id])).rows[0];
    await sql("update incoming_alert_deliveries set status='uncertain' where id=$1",[n.id]);
    await assert.rejects(()=>rpc('reconcile_signing_email',[n.id,'requeue','unchecked']),/Check Gmail/);
    const out=await rpc('reconcile_signing_email',[n.id,'requeue','CHECKED_SENT_MAIL_NOT_SENT']);assert.equal(out.status,'pending');
    await assert.rejects(()=>rpc('reconcile_signing_email',[n.id,'requeue','CHECKED_SENT_MAIL_NOT_SENT']),/Check Gmail/);
    await sql("update incoming_alert_deliveries set status='uncertain' where id=$1",[n.id]);
    const sent=await rpc('reconcile_signing_email',[n.id,'sent','synthetic-message-id']);assert.equal(sent.status,'sent');
    assert.equal((await sql("select has_function_privilege('anon','public.reconcile_signing_email(uuid,text,text)','execute') allowed")).rows[0].allowed,false);
  });

  await t.test('signed requests can be rejected and archived atomically without deleting their evidence',async()=>{
    const s=await sign(await make());const out=await rpc('archive_reservation_request',[s.reservation.id,s.reservation.revision,'Duplicate test request','ARCHIVE_REQUEST']);assert.equal(out.status,'archived');assert.equal(out.checked_in_person_id,null);
    assert.equal((await access(s)).request.status,'rejected');assert.ok((await access(s)).request.signed_document_path);
    assert.equal(Number((await sql("select count(*) n from incoming_alert_deliveries where source_id=$1 and kind='signing_rejected'",[s.request.id])).rows[0].n),1);
    assert.equal(Number((await sql("select count(*) n from notification_outbox where reservation_id=$1 and kind='archive' and status='pending'",[s.reservation.id])).rows[0].n),0);
  });
  await t.test('unsigned archive revokes the link, denies stale requests and protects allocated tenants',async()=>{
    const s=await make();await assert.rejects(()=>rpc('archive_reservation_request',[s.reservation.id,s.reservation.revision,'','ARCHIVE_REQUEST']),/reason/);
    const out=await rpc('archive_reservation_request',[s.reservation.id,s.reservation.revision,'Duplicate request','ARCHIVE_REQUEST']);assert.equal(out.status,'archived');await assert.rejects(()=>access(s),/revoked/);
    await assert.rejects(()=>rpc('archive_reservation_request',[s.reservation.id,s.reservation.revision,'Duplicate request','ARCHIVE_REQUEST']),/changed/);
    const approved=await sign(await make());const assigned=await rpc('review_contract_signing',[approved.request.id,approved.reservation.revision,'approve',null]);await assert.rejects(()=>rpc('archive_reservation_request',[assigned.id,assigned.revision,'Duplicate request','ARCHIVE_REQUEST']),/allocated tenant/);
    assert.equal((await sql("select has_function_privilege('anon','public.archive_reservation_request(uuid,integer,text,text)','execute') allowed")).rows[0].allowed,false);
  });

  await t.test('archive refuses nonstaff and a sending email leaves a signed request unchanged',async()=>{
    const s=await sign(await make());await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('archive_reservation_request',[s.reservation.id,s.reservation.revision,'Duplicate request','ARCHIVE_REQUEST']),/Staff/);await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
    await sql("update notification_outbox set status='sending' where id=$1",[s.notification.id]);await assert.rejects(()=>rpc('archive_reservation_request',[s.reservation.id,s.reservation.revision,'Duplicate request','ARCHIVE_REQUEST']),/message is being sent/);
    const saved=await access(s);assert.equal(saved.request.status,'signed');assert.equal(saved.request.reviewed_at,null);assert.equal((await sql('select status from reservations where id=$1',[s.reservation.id])).rows[0].status,'review');
  });

}
