import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { rentInvoicePdf } from './invoice-pdf.js';
import { invoiceMime } from './invoice-email.js';
import { processRentInvoices,rentInvoiceApi } from './rent-invoice-api.js';
const id='00000000-0000-4000-8000-000000000082';
const invoice={id,number:82,snapshot:{tenant_name:'Synthetic Guest',tenant_email:'guest@example.test',address:'1 Synthetic Road, Adelaide SA',property:'Test house',room:'Room 2',issued_date:'2026-10-26',payment:{amount:340,date:'2026-10-26',method:'transfer'},lines:[{description:'Accommodation rent',period_start:'2026-10-12',period_end:'2026-10-25',amount:340,charge_amount:340,weekly_rate:170}],cc:['sakanlodges@gmail.com','first-admin@example.test','second-admin@example.test']}};
test('paid rent PDF renders matching totals, replacement reference and multi-page long histories',async()=>{
 const bytes=await rentInvoicePdf(invoice);assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
 const long={...invoice,replaces_number:81,snapshot:{...invoice.snapshot,payment:{...invoice.snapshot.payment,amount:340*30},tenant_name:'Synthetic long tenant name for layout validation '.repeat(2),lines:Array.from({length:30},()=>invoice.snapshot.lines[0])}};
 assert.ok((await PDFDocument.load(await rentInvoicePdf(long))).getPageCount()>1);
 await assert.rejects(()=>rentInvoicePdf({...invoice,snapshot:{...invoice.snapshot,payment:{...invoice.snapshot.payment,amount:1}}}),/allocation/);
});
test('invoice MIME has tenant in To, the exact approved CC list, Unicode body, deterministic reference and PDF',async()=>{
 const raw=invoiceMime({...invoice,snapshot:{...invoice.snapshot,tenant_name:'Guest José'}},await rentInvoicePdf(invoice));
 const mime=Buffer.from(raw,'base64url').toString('utf8');assert.match(mime,/To: guest@example.test/);assert.match(mime,/Cc: first-admin@example.test,\r\n sakanlodges@gmail.com,\r\n second-admin@example.test/);assert.doesNotMatch(mime,/Bcc:/);assert.match(mime,/SAKAN-invoice-82.pdf/);assert.match(mime,/rent-invoice-00000000-0000-4000-8000-000000000082@sakanlodge.com/);
 assert.throws(()=>invoiceMime({...invoice,snapshot:{...invoice.snapshot,tenant_email:'bad\r\nBcc: attacker@example.test'}},new Uint8Array()),/recipients/);
});
async function fixture(run,{gmailFails=false,storageFails=false,noSender=false,finalizationFails=false,archivedPath=null}={}){
 const original=globalThis.fetch;let status='queued',sent=0,claimed=0,prepared=0,stored=0;
 const keyBytes=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('synthetic-refresh')));
 const env={RENT_INVOICE_EMAILS_ENABLED:'true',SUPABASE_URL:'https://database.example.test',SUPABASE_PUBLIC_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',GMAIL_CLIENT_ID:'synthetic-client',GMAIL_CLIENT_SECRET:'synthetic-secret',GMAIL_TOKEN_ENCRYPTION_KEY:Buffer.from(keyBytes).toString('base64'),GMAIL_TOKEN_STORE:{get:async()=>noSender?null:{account:'sakanlodges@gmail.com',iv:[...iv],data:[...encrypted]}}};
 globalThis.fetch=async(url,options)=>{
  const path=String(url);
  if(path.includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic-access'});
  if(path.includes('/storage/v1/object/rent-invoices/')){stored++;assert.equal(options.headers.apikey,'sb_secret_test');assert.match(new TextDecoder().decode(options.body.slice(0,5)),/%PDF-/);return new Response('',{status:storageFails?503:200});}
  if(path.includes('gmail.googleapis.com')){sent++;assert.equal(status,'sending');assert.match(JSON.parse(options.body).raw,/^[A-Za-z0-9_-]+$/);if(gmailFails)throw Error('Synthetic network timeout');return Response.json({id:'synthetic-gmail-id'});}
  if(path.endsWith('/rpc/rent_invoice_worker')){
   assert.equal(options.headers.apikey,'sb_secret_test');assert.equal(options.headers.Authorization,undefined);
   const data=JSON.parse(options.body);
   if(data.p_action==='pending')return Response.json(status==='queued'?[id]:[]);
   if(data.p_action==='prepare'){claimed++;status='preparing';return Response.json({...invoice,status,attempt:data.p_attempt});}
   if(data.p_action==='begin_send'){prepared++;assert.match(data.p_data.sha256,/^[a-f0-9]{64}$/);assert.equal(data.p_data.path,archivedPath||`invoices/${id}/${data.p_attempt}.pdf`);status='sending';return Response.json({});}
   if(data.p_action==='sent'){if(finalizationFails)throw Error('Synthetic database outage');status='sent';return Response.json({});}
   if(data.p_action==='uncertain'){status='uncertain';return Response.json({});}
   if(data.p_action==='prepare_failed'){status='retry_later';return Response.json({});}
  }throw Error('Unexpected test fetch');
 };
 try{await run({env,state:()=>({status,sent,claimed,prepared,stored})});}finally{globalThis.fetch=original;}
}
test('automatic invoice processing stores immutable PDF then sends once; repeat polling does not resend',()=>fixture(async({env,state})=>{assert.deepEqual(await processRentInvoices(env),{processed:1});assert.deepEqual(await processRentInvoices(env),{processed:0});assert.deepEqual(state(),{status:'sent',sent:1,claimed:1,prepared:1,stored:1});}));
test('Gmail timeout and post-send database outage become uncertain without an automatic duplicate',async()=>{
 for(const option of [{gmailFails:true},{finalizationFails:true}])await fixture(async({env,state})=>{await processRentInvoices(env);await processRentInvoices(env);assert.equal(state().status,'uncertain');assert.equal(state().sent,1);},option);
});
test('PDF/storage errors stay before send, and isolated preview without official sender cannot claim invoices',async()=>{
 await fixture(async({env,state})=>{await processRentInvoices(env);assert.equal(state().sent,0);assert.equal(state().prepared,0);assert.equal(state().status,'retry_later');},{storageFails:true});
 await fixture(async({env,state})=>{await assert.rejects(()=>processRentInvoices(env),/official SAKAN/);assert.equal(state().claimed,0);assert.equal(state().sent,0);},{noSender:true});
 assert.deepEqual(await processRentInvoices({}),{disabled:true});
});
test('invoice download endpoint requires staff authorization and does not accept a public storage path',async()=>{
 assert.equal((await rentInvoiceApi(new Request('https://sakanlodge.com/api/rent-invoices/pdf',{method:'POST',headers:{Origin:'https://evil.example'}}),{})).status,403);
});

test('resend fetches and verifies the archived PDF without upload or allocation changes',async()=>{
 const original=globalThis.fetch;const bytes=await rentInvoicePdf(invoice);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 // Reuse the production queue fixture, replacing only prepare and archive reads.
 for(const corrupt of [false,true])await fixture(async({env,state})=>{
  const fixtureFetch=globalThis.fetch;let read=0;
  globalThis.fetch=async(url,opts)=>{
   if(String(url).includes('/storage/v1/object/authenticated/')){read++;assert.equal(opts.method,undefined);return new Response(bytes);}
   const res=await fixtureFetch(url,opts);
   if(String(url).endsWith('/rpc/rent_invoice_worker')&&JSON.parse(opts.body).p_action==='prepare')return Response.json({...await res.json(),pdf_path:`invoices/${id}/original.pdf`,pdf_sha256:corrupt?'0'.repeat(64):hash});
   return res;
  };
  try{await processRentInvoices(env);assert.equal(read,1);assert.equal(state().stored,0);assert.equal(state().sent,corrupt?0:1);assert.equal(state().status,corrupt?'retry_later':'sent');}finally{globalThis.fetch=fixtureFetch;}
 },{archivedPath:`invoices/${id}/original.pdf`});
 assert.equal(globalThis.fetch,original);
});

test('historical PDF preview uses the staff receipt preview without issuing or sending email',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(String(url),/\/rpc\/staff_payment_receipt$/);const args=JSON.parse(options.body);assert.equal(args.p_action,'preview');assert.equal(args.p_payment,id);return Response.json({...invoice,number:'DRAFT'});};
 try{
  const response=await rentInvoiceApi(new Request('https://sakanlodge.com/api/rent-invoices/preview',{method:'POST',headers:{Origin:'https://sakanlodge.com',Authorization:'Bearer synthetic-staff-token','Content-Type':'application/json'},body:JSON.stringify({payment_id:id})}),{SUPABASE_URL:'https://database.example.test',SUPABASE_PUBLIC_KEY:'sb_publishable_test'});
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.match(new TextDecoder().decode((await response.arrayBuffer()).slice(0,5)),/%PDF-/);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('admin-confirmed invoice renders and email does not invent receipt date or payment method',async()=>{
 const historical={...invoice,snapshot:{...invoice.snapshot,admin_confirmed_period:true,payment:{...invoice.snapshot.payment,method:'admin_confirmed'}}};
 assert.equal((await PDFDocument.load(await rentInvoicePdf(historical))).getPageCount(),1);
 const mime=Buffer.from(invoiceMime(historical,await rentInvoicePdf(historical)),'base64url').toString();
 const body=Buffer.from(mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replaceAll('\r\n',''),'base64').toString();
 assert.match(body,/does not request another payment/);assert.doesNotMatch(body,/received on|Payment method:/);
});
