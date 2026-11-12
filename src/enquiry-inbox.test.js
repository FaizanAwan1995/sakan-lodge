import test from 'node:test';
import assert from 'node:assert/strict';
import {emailAddress,normalizeThread,enquiryReplyMime,syncEnquiryInbox,enquiryInboxApi} from './enquiry-inbox.js';
import {checkoutEmailHtml,REVIEW_LINKS} from './checkout-email.js';
import {alertMime} from './incoming-alerts.js';
const data=s=>Buffer.from(s).toString('base64url');
const message=(id,from,body,extra=[])=>({id,internalDate:'1794470000000',payload:{mimeType:'text/plain',headers:[{name:'From',value:from},{name:'Subject',value:'Room enquiry'},{name:'Message-ID',value:`<${id}@example.test>`},...extra],body:{data:data(body)}}});
test('Gmail parsing preserves the sender and safe text while filtering automated and internal-only threads',()=>{
 assert.equal(emailAddress('Guest Person <guest@example.test>'),'guest@example.test');assert.equal(emailAddress('guest@example.test\r\nBcc: bad@example.test'),'');assert.equal(emailAddress('a@example.test,b@example.test'),'');
 const t=normalizeThread({id:'abc123',messages:[message('a12','Guest <guest@example.test>','Room availability?'),message('b12','sakanlodges@gmail.com','We have a room.')]});assert.equal(t.contact_email,'guest@example.test');assert.equal(t.messages[1].direction,'outgoing');assert.equal(t.messages[0].rfc_message_id,'<a12@example.test>');
 assert.equal(normalizeThread({id:'abc123',messages:[message('a12','noreply@example.test','An automated receipt')]}),null);
 assert.equal(normalizeThread({id:'abc123',messages:[message('a12','admin@example.test','Admin message')]},['admin@example.test']),null);
 const html=message('c12','Guest <guest@example.test>','');html.payload.mimeType='text/html';html.payload.body.data=data('<script>evil()</script><p>Hello<img src="https://tracker.test"></p>');assert.equal(normalizeThread({id:'abc123',messages:[html]}).messages[0].body.trim(),'Hello');
});
test('replies target the customer, copy exactly both admins and retain Gmail threading headers',()=>{
 const reply={id:'00000000-0000-4000-8000-000000000001',recipient:'guest@example.test',cc:['faizan@example.test','danish@example.test'],subject:'Re: Room enquiry',body:'Thank you for your enquiry.',rfc_reply_to:'<original@example.test>'};
 const raw=Buffer.from(enquiryReplyMime(reply),'base64url').toString();assert.match(raw,/To: guest@example.test/);assert.match(raw,/Cc: faizan@example.test, danish@example.test/);assert.match(raw,/In-Reply-To: <original@example.test>/);assert.match(raw,/References: <original@example.test>/);assert.match(raw,/Message-ID: <enquiry-/);assert.doesNotMatch(raw,/Bcc:/);assert.throws(()=>enquiryReplyMime({...reply,recipient:'guest@example.test\r\nBcc: bad@test.test'}));
});
test('checkout emails have all review buttons and escape the guest name',()=>{
 const body='Hi <script>guest</script>\n\n'+Object.values(REVIEW_LINKS).join('\n\n');const html=checkoutEmailHtml('Thank you for staying',body);for(const url of Object.values(REVIEW_LINKS))assert.ok(html.includes(`href="${url}"`));assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 const mime=Buffer.from(alertMime({id:'00000000-0000-4000-8000-000000000001',kind:'checkout_thanks',recipient:'guest@example.test',reply_to:'sakanlodges@gmail.com',subject:'Thank you',body}),'base64url').toString();assert.match(mime,/multipart\/alternative/);assert.match(mime,/To: guest@example.test/);
});
test('mailbox read waits for Gmail consent while website enquiries can sync, and anonymous callers cannot access the API',async()=>{
 const original=globalThis.fetch;let calls=[];globalThis.fetch=async(url,options)=>{calls.push(String(url));assert.ok(String(url).endsWith('/rpc/enquiry_inbox_worker'));return Response.json({});};
 try{assert.deepEqual(await syncEnquiryInbox({}),{disabled:true});const r=await syncEnquiryInbox({INCOMING_ALERT_EMAILS_ENABLED:'true',SUPABASE_URL:'https://db.test',SUPABASE_PUBLIC_KEY:'public',SUPABASE_SECRET_KEY:'secret',GMAIL_TOKEN_STORE:{get:async()=>({account:'sakanlodges@gmail.com'})}});assert.equal(r.needsReconnect,true);assert.equal(calls.length,1);
 assert.equal((await enquiryInboxApi(new Request('https://sakanlodge.com/api/enquiry-inbox/status'),{})).status,401);assert.equal((await enquiryInboxApi(new Request('https://sakanlodge.com/api/enquiry-inbox/send',{method:'POST',headers:{Origin:'https://evil.test'}}),{})).status,403);
 }finally{globalThis.fetch=original;}
});

test('app sends one reviewed reply in the original Gmail thread and records both admin copies',async()=>{
 const original=globalThis.fetch,bytes=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('synthetic-refresh'));
 const env={SUPABASE_URL:'https://db.test',SUPABASE_PUBLIC_KEY:'public',SUPABASE_SECRET_KEY:'secret',GMAIL_CLIENT_ID:'client',GMAIL_CLIENT_SECRET:'secret',GMAIL_TOKEN_ENCRYPTION_KEY:Buffer.from(bytes).toString('base64'),GMAIL_TOKEN_STORE:{get:async()=>({account:'sakanlodges@gmail.com',iv:[...iv],data:[...new Uint8Array(encrypted)]})}};
 let sent=0,claimed=false,logged=false;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic'});
  const input=JSON.parse(options.body);
  if(String(url).endsWith('staff_notification_emails'))return Response.json(['faizan@example.test','danish@example.test']);
  if(String(url).endsWith('enquiry_action')){
   if(claimed)return Response.json({message:'Preview already used'},{status:409});claimed=true;
   return Response.json({id:'00000000-0000-4000-8000-000000000001',recipient:'guest@example.test',cc:['faizan@example.test','danish@example.test'],subject:'Re: Room enquiry',body:'A reviewed reply.',gmail_thread_id:'abc123',rfc_reply_to:'<original@example.test>'});
  }
  if(String(url).includes('gmail.googleapis.com')){sent++;assert.equal(input.threadId,'abc123');const raw=Buffer.from(input.raw,'base64url').toString();assert.match(raw,/To: guest@example.test/);assert.match(raw,/Cc: faizan@example.test, danish@example.test/);return Response.json({id:'b123',threadId:'abc123'});}
  if(String(url).endsWith('enquiry_inbox_worker')){assert.equal(input.p_action,'sent');logged=true;return Response.json({});}
  throw Error('Unexpected fetch');
 };
 const request=()=>new Request('https://sakanlodge.com/api/enquiry-inbox/send',{method:'POST',headers:{Origin:'https://sakanlodge.com',Authorization:'Bearer staff'},body:JSON.stringify({reply_id:'00000000-0000-4000-8000-000000000001',confirmation:'SEND_REVIEWED_REPLY',recipient:'attacker@example.test',body:'Not reviewed'})});
 try{assert.equal((await enquiryInboxApi(request(),env)).status,200);assert.equal(logged,true);assert.equal((await enquiryInboxApi(request(),env)).status,409);assert.equal(sent,1);}finally{globalThis.fetch=original;}
});
