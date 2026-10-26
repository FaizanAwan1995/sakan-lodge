import { databaseRpc, json, limitedJson } from './public-site.js';
import { rentInvoicePdf } from './invoice-pdf.js';
import { invoiceGmailToken, invoiceMime, sendInvoiceMime } from './invoice-email.js';
const worker=(env,action,id=null,attempt=null,data={})=>databaseRpc(env,'rent_invoice_worker',{p_action:action,p_id:id,p_attempt:attempt,p_data:data},{admin:true});
function storageHeaders(env){const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('Invoice storage unavailable');return {apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/pdf','x-upsert':'false'};}
export async function processRentInvoices(env){
 if(env.RENT_INVOICE_EMAILS_ENABLED!=='true')return {disabled:true};
 const ids=await worker(env,'pending');if(!Array.isArray(ids)||!ids.length)return {processed:0};
 // Preview workers use isolated Gmail KV without the production sender token.
 // Establish the official sender before claiming any queued financial document.
 const token=await invoiceGmailToken(env);let count=0;
 for(const id of ids){const attempt=crypto.randomUUID();let invoice,started=false;try{
  invoice=await worker(env,'prepare',id,attempt);if(invoice.skipped)continue;
  let pdf,path,sha;
  if(invoice.pdf_path){
   path=invoice.pdf_path;
   const archived=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/authenticated/rent-invoices/'+path,{headers:storageHeaders(env),signal:AbortSignal.timeout(15000)});
   if(!archived.ok)throw Error('Archived invoice unavailable');
   pdf=new Uint8Array(await archived.arrayBuffer());
   sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pdf))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(sha!==invoice.pdf_sha256)throw Error('Archived invoice integrity check failed');
  }else{
   pdf=await rentInvoicePdf(invoice);path=`invoices/${id}/${attempt}.pdf`;
   const upload=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/rent-invoices/'+path,{method:'POST',headers:storageHeaders(env),body:pdf,signal:AbortSignal.timeout(15000)});
   if(!upload.ok)throw Error('Invoice storage failed');
   sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pdf))].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  const raw=invoiceMime(invoice,pdf,attempt);
  await worker(env,'begin_send',id,attempt,{path,sha256:sha});started=true;
  const messageId=await sendInvoiceMime(token,raw);
  await worker(env,'sent',id,attempt,{message_id:messageId});count++;
 }catch{
  if(invoice&&!invoice.skipped)try{await worker(env,started?'uncertain':'prepare_failed',id,attempt);}catch{/* Claim or Gmail outcome is retained for reconciliation; never re-send here. */}
 }}return {processed:count};
}
export async function rentInvoiceApi(request,env){
 const authorization=request.headers.get('Authorization')||'';
 if(request.method!=='POST'||request.headers.get('Origin')!=='https://sakanlodge.com'||!/^Bearer \S+$/.test(authorization))return json({error:'Staff sign-in required'},403);
 try{
  const input=await limitedJson(request,1000);
  if(new URL(request.url).pathname==='/api/rent-invoices/preview'){
   const draft=await databaseRpc(env,'staff_payment_receipt',{p_payment:input.payment_id,p_action:'preview',p_start:input.start||null,p_end:input.end||null},authorization);
   if(draft.existing)return json({error:'This payment already has an invoice. Open invoice history.'},409);
   return new Response(await rentInvoicePdf(draft),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="SAKAN-receipt-preview.pdf"','Cache-Control':'no-store'}});
  }
  const invoice=await databaseRpc(env,'staff_rent_invoice_action',{p_id:input.id,p_action:'get'},authorization);
  if(!invoice.pdf_path)return json({error:'The invoice PDF is not yet prepared. Check invoice status.'},409);
  const response=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/authenticated/rent-invoices/'+invoice.pdf_path,{headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLIC_KEY},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Private PDF unavailable');
  return new Response(response.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="SAKAN-invoice-${invoice.number}.pdf"`,'Cache-Control':'no-store'}});
 }catch{return json({error:'Unable to open this invoice. Refresh and check staff access.'},403);}
}
