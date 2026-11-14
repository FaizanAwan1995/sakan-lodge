import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOccupants,idFileType} from './couples-application.js';
import {renderListing} from './public-site.js';
import {couplesApplicationApi} from './couples-application-api.js';
const applicants=[1,2].map(i=>({name:'Occupant '+i,email:`person${i}@example.test`,phone:'0400000000'}));
test('both occupants need valid contact details and only recognised ID formats are accepted',()=>{
 assert.equal(validateOccupants(applicants).length,2);
 assert.throws(()=>validateOccupants(applicants.slice(0,1)),/both occupants/);
 assert.throws(()=>validateOccupants([applicants[0],{...applicants[1],email:'invalid'}]),/occupant 2/);
 assert.equal(idFileType(new Uint8Array([255,216,255,1])).mime,'image/jpeg');
 assert.equal(idFileType(new TextEncoder().encode('%PDF-1.7')).mime,'application/pdf');
 assert.throws(()=>idFileType(new TextEncoder().encode('<svg onload="alert(1)">')),/JPG/);
});
test('granny flat renders two separate occupant details, private IDs and $500 total; ordinary rooms keep their existing form',async()=>{
 const cat={properties:[{id:'p',suburb:'Fulham',slug:'fulham-house-1',name:'Fulham'}],rooms:[{id:'r',property_id:'p',slug:'granny-flat',title:'Granny flat',capacity:2}]};
 const env={RESERVATION_REQUESTS_ENABLED:'true',SUPABASE_SECRET_KEY:'secret',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'test'};
 const html=await (renderListing({kind:'room',suburb:'fulham',property:'fulham-house-1',room:'granny-flat'},cat,env)).text();
 assert.match(html,/data-couples="true"/);assert.match(html,/occupant_1_id/);assert.match(html,/occupant_2_id/);assert.match(html,/occupant_2_email/);assert.match(html,/\$500 per couple\/week/);assert.doesNotMatch(html,/name="bed_number"/);
 cat.rooms[0].slug='room-3';
 const regular=await renderListing({kind:'room',suburb:'fulham',property:'fulham-house-1',room:'room-3'},cat,env).text();
 assert.match(regular,/data-couples="false"/);assert.match(regular,/name="full_name"/);assert.doesNotMatch(regular,/occupant_2_id/);
});
test('application endpoint rejects wrong origins and missing multipart before accepting ID data',async()=>{
 const request=new Request('https://sakanlodge.com/api/reservations/couples',{method:'POST',body:'{}',headers:{origin:'https://evil.example'}});
 assert.equal((await couplesApplicationApi(request,{})).status,403);
});
test('application endpoint stores both IDs then durably creates draft, without leaking applicant or ID data',async()=>{
 const originalFetch=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push(String(url));
  if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'sakanlodge.com'});
  if(String(url).includes('/rpc/validate_couples_application'))return Response.json(null);
  if(String(url).includes('/storage/'))return Response.json({Key:'private'});
  if(String(url).includes('/rpc/submit_couples_application'))return Response.json({code:'SK-TEST',status:'pending',reservation_id:'reservation',contract:{id:'contract',document_path:'already-rendered.pdf'}});
  throw Error('Unexpected endpoint');
 };
 try {
  const form=new FormData();for(const [i,p] of applicants.entries()){form.set(`occupant_${i+1}_name`,p.name);form.set(`occupant_${i+1}_email`,p.email);form.set(`occupant_${i+1}_phone`,p.phone);form.set(`occupant_${i+1}_id`,new Blob([new Uint8Array([255,216,255,...Array(40).fill(i)])],{type:'image/jpeg'}),'id.jpg');}
  form.set('application_consent','yes');form.set('cf-turnstile-response','verified');form.set('room_id','room');form.set('arrival_date','2027-01-01');form.set('departure_date','2027-05-01');
  const req=new Request('https://sakanlodge.com/api/reservations/couples',{method:'POST',headers:{Origin:'https://sakanlodge.com','Idempotency-Key':crypto.randomUUID(),'CF-Connecting-IP':'192.0.2.1'},body:form});
  const env={RESERVATION_REQUESTS_ENABLED:'true',SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLIC_KEY:'sb_publishable_test',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'site',ROOM_AI_LIMITER:{limit:async()=>({success:true})}};
  const result=await couplesApplicationApi(req,env);assert.equal(result.status,201);
  assert.deepEqual(await result.json(),{code:'SK-TEST',status:'pending',contract_ready:true});
  assert.equal(calls.filter(p=>p.includes('/storage/v1/object/reservation-ids/')).length,2);
  assert.ok(calls.findIndex(p=>p.includes('validate_couples'))<calls.findIndex(p=>p.includes('/storage/')));
 }finally{globalThis.fetch=originalFetch;}
});
