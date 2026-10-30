import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnquiry, enquiriesApi } from './enquiries-api.js';
import { alertMime, processIncomingAlerts } from './incoming-alerts.js';
const data={full_name:'Synthetic Guest',email:'guest@example.test',phone:'0400000000',location:'Fulham',accommodation:'Private room',move_in:'2027-01-01',occupants:'2',message:'Couples granny flat enquiry'};
const env={INCOMING_ALERT_EMAILS_ENABLED:'true',TURNSTILE_SITE_KEY:'public',TURNSTILE_SECRET_KEY:'secret',SUPABASE_URL:'https://db.test',SUPABASE_PUBLIC_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test'};
const req=(input=data,origin='https://sakanlodge.com')=>new Request('https://sakanlodge.com/api/enquiries',{method:'POST',headers:{Origin:origin,'Idempotency-Key':'00000000-0000-4000-8000-000000000001','Content-Type':'application/json'},body:JSON.stringify({...input,turnstile_token:'token'})});
test('enquiries validate fields and reject header injection, arrays and impossible dates',()=>{
 assert.equal(validateEnquiry({...data,email:'GUEST@example.test'}).email,data.email);
 for(const invalid of [{email:'bad\r\nBcc: attacker@test.test'},{phone:[]},{location:'Unknown'},{occupants:'12'},{move_in:'2027-02-30'},{website:'spam'}])assert.throws(()=>validateEnquiry({...data,...invalid}));
});
test('enquiry verifies action and origin before queuing an idempotent submission',async()=>{
 const original=globalThis.fetch;let stored;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'sakanlodge.com',action:'enquiry'});
  stored=JSON.parse(options.body);assert.equal(options.headers.apikey,'sb_secret_test');return Response.json({reference:'ENQ-TEST'});
 };
 try{assert.equal((await enquiriesApi(req(data,'https://evil.test'),env)).status,403);assert.equal(stored,undefined);
 const response=await enquiriesApi(req(),env);assert.equal(response.status,202);assert.equal((await response.json()).received,true);assert.deepEqual(stored.p_data,data);assert.equal(stored.p_fingerprint.length,64);
 globalThis.fetch=async()=>Response.json({success:true,hostname:'sakanlodge.com',action:'reservation'});assert.equal((await enquiriesApi(req(),env)).status,400);
 }finally{globalThis.fetch=original;}
});
test('staff alert includes reply-to guest, one trusted recipient and stable message ID',()=>{
 const raw=Buffer.from(alertMime({id:'00000000-0000-4000-8000-000000000001',recipient:'staff@example.test',reply_to:data.email,subject:'New reservation',body:'New request\nReview in Ledger'}),'base64url').toString();
 assert.match(raw,/To: staff@example.test/);assert.match(raw,/Reply-To: guest@example.test/);assert.match(raw,/Message-ID: <incoming-/);assert.doesNotMatch(raw,/Bcc:|Cc:/);
 assert.throws(()=>alertMime({recipient:'staff@example.test\r\nCc: attacker@test.test'}));
});
test('email processing stays disabled in preview and leaves queue unclaimed when sender is unavailable',async()=>{
 assert.deepEqual(await processIncomingAlerts({}),{disabled:true});
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(['00000000-0000-4000-8000-000000000001']);};
 try{await assert.rejects(()=>processIncomingAlerts(env));assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
async function deliveryFixture(run,{timeout=false,finalizeFails=false}={}){
 const original=globalThis.fetch;let status='pending',sent=0;
 const bytes=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('synthetic-refresh')));
 const configured={...env,GMAIL_CLIENT_ID:'client',GMAIL_CLIENT_SECRET:'secret',GMAIL_TOKEN_ENCRYPTION_KEY:Buffer.from(bytes).toString('base64'),GMAIL_TOKEN_STORE:{get:async()=>({account:'sakanlodges@gmail.com',iv:[...iv],data:[...encrypted]})}};
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic'});
  if(String(url).includes('gmail.googleapis.com')){assert.equal(status,'sending');sent++;if(timeout)throw Error('Timeout');return Response.json({id:'test-message-id'});}
  const input=JSON.parse(options.body);
  if(input.p_action==='pending')return Response.json(status==='pending'?['00000000-0000-4000-8000-000000000001']:[]);
  if(input.p_action==='claim'){status='sending';return Response.json({id:input.p_id,recipient:'staff@example.test',reply_to:'guest@example.test',subject:'New enquiry',body:'Synthetic enquiry'});}
  if(input.p_action==='sent'){if(finalizeFails)throw Error('Database unavailable');status='sent';return Response.json({});}
  if(input.p_action==='uncertain'){status='uncertain';return Response.json({});}
  throw Error('Unexpected fetch');
 };
 try{await run(configured,()=>({status,sent}));}finally{globalThis.fetch=original;}
}
test('automatic alerts send once and retain uncertain Gmail outcomes without duplicate retries',async()=>{
 for(const options of [{},{timeout:true},{finalizeFails:true}])await deliveryFixture(async(configured,state)=>{await processIncomingAlerts(configured);await processIncomingAlerts(configured);assert.equal(state().sent,1);assert.equal(state().status,options.timeout||options.finalizeFails?'uncertain':'sent');},options);
});
