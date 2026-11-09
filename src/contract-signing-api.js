import {databaseRpc,limitedJson} from './public-site.js';
import {sha256,validateSignatures,signedAgreementPdf,SIGNING_CONSENT_VERSION} from './contract-signing.js';
const ORIGIN='https://sakanlodge.com';
const PRIVATE_HEADERS={'cache-control':'no-store, private','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'};
const reply=(body,status=200)=>Response.json(body,{status,headers:PRIVATE_HEADERS});
async function storage(env,path,{bytes,authorization}={}) {
  const key=authorization?env.SUPABASE_PUBLIC_KEY:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key||!env.SUPABASE_URL)throw Error('Signing storage is unavailable.');
  const headers={apikey:key};
  if(authorization)headers.Authorization=authorization;
  else if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
  if(bytes){headers['Content-Type']='application/pdf';headers['x-upsert']='false';}
  return fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/'+(bytes?'':'authenticated/')+'reservation-contracts/'+path,{method:bytes?'POST':'GET',headers,body:bytes,signal:AbortSignal.timeout(20000)});
}
async function readPdf(env,path,authorization) {
  const r=await storage(env,path,{authorization});
  if(!r.ok)throw Error('The private agreement could not be opened. Please retry.');
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length>10485760||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('The agreement PDF could not be verified.');
  return bytes;
}
function publicReceipt(snapshot) {
  const {request:s,contract:c,code}=snapshot;
  const f=c.fields;
  return {reference:code,request:{id:s.id,status:s.status,expires_at:s.expires_at,submitted_at:s.submitted_at,reviewed_at:s.reviewed_at,review_reason:s.review_reason,document_hash:s.document_hash,can_download_signed:!!s.signed_document_path,signatures:s.status==='processing'?s.signatures:undefined},agreement:{version:c.version,resident_names:f.resident_names,proprietor:{name:f.proprietor?.name,address:f.proprietor?.address,phone:f.proprietor?.phone},premises_address:f.premises_address,room_label:f.room_label,email:f.email,phone:f.phone,payment_instructions:f.billing_type==='nightly'?'Bond via PayID 0426721787. Remaining rent payable on arrival; agreed nightly rent applies.':'Bond via PayID 0426721787. Remaining rent payable on arrival. Subsequent rent fortnightly in advance.',arrival_date:f.arrival_date,departure_date:f.departure_date,term_description:f.term_description,weekly_rate:f.weekly_rate,nightly_rate:f.nightly_rate,billing_type:f.billing_type,offer_type:f.offer_type,bond:f.bond,first_rent_due:f.first_rent_due,utilities:f.utilities,terms:f.terms}};
}
export async function contractSigningApi(request,env) {
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  if(request.headers.get('Origin')!==ORIGIN)return reply({error:'Invalid origin'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'JSON required'},415);
  const path=new URL(request.url).pathname;
  try {
    if(path==='/api/reservations/signing-link') {
      const authorization=request.headers.get('Authorization')||'';
      if(!/^Bearer \S+$/.test(authorization))return reply({error:'Staff sign-in required'},401);
      const input=await limitedJson(request,2000);
      if(!/^[a-f0-9-]{36}$/i.test(input.contract_id||'')||!Number.isInteger(input.revision)||input.revision<1||!Number.isInteger(input.days)||input.days<1||input.days>14)return reply({error:'Choose the current agreement and a 1-14 day expiry.'},400);
      const snapshot=await databaseRpc(env,'booking_contract_document',{p_id:input.contract_id},authorization);
      const bytes=await readPdf(env,snapshot.contract.document_path,authorization);
      const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const url=ORIGIN+'/sign#'+token;
      const out=await databaseRpc(env,'prepare_contract_signing',{p_contract:input.contract_id,p_revision:input.revision,p_token_hash:await sha256(token),p_document_hash:await sha256(bytes),p_days:input.days,p_url:url},authorization);
      return reply({...out,url});
    }
    if(!['/api/contract-signing/access','/api/contract-signing/document','/api/contract-signing/submit'].includes(path))return reply({error:'Not found'},404);
    const token=request.headers.get('X-Signing-Token')||'';
    if(!/^[0-9a-f]{64}$/.test(token))return reply({error:'This signing link is unavailable. Ask SAKAN for a new link.'},403);
    const ip=request.headers.get('CF-Connecting-IP');
    if(!ip||!env.ROOM_AI_LIMITER?.limit)return reply({error:'Signing is temporarily unavailable. Please try again later.'},503);
    if(!(await env.ROOM_AI_LIMITER.limit({key:'contract-signing:'+ip})).success)return reply({error:'Too many attempts. Please wait a minute before retrying.'},429);
    const hash=await sha256(token);
    let snapshot=await databaseRpc(env,'contract_signing_public',{p_hash:hash,p_action:'access'},{admin:true});
    if(path.endsWith('/access'))return reply(publicReceipt(snapshot));
    if(path.endsWith('/document')) {
      const input=await limitedJson(request,1000);
      const signed=input.signed===true;
      const file=signed?snapshot.request.signed_document_path:snapshot.contract.document_path;
      if(!file)return reply({error:'This agreement copy is not available.'},409);
      const bytes=await readPdf(env,file);
      const expected=signed?snapshot.request.signed_document_hash:snapshot.request.document_hash;
      if(await sha256(bytes)!==expected)throw Error('The agreement copy could not be verified. Please contact SAKAN.');
      return new Response(bytes,{headers:{...PRIVATE_HEADERS,'content-type':'application/pdf','content-disposition':`attachment; filename="SAKAN-${signed?'signed-':''}agreement.pdf"`}});
    }
    const input=await limitedJson(request,240000);
    if(input.consent_version!==SIGNING_CONSENT_VERSION||input.document_hash!==snapshot.request.document_hash)return reply({error:'Reload and review the current agreement before signing.'},409);
    const signatures=validateSignatures(input.signatures,snapshot.contract.fields.resident_names);
    const submission_hash=await sha256(JSON.stringify({document_hash:input.document_hash,consent_version:SIGNING_CONSENT_VERSION,signatures}));
    if(['signed','approved','rejected','superseded'].includes(snapshot.request.status)) {
      if(snapshot.request.submission_hash===submission_hash)return reply(publicReceipt(snapshot));
      return reply({error:'This agreement has already been submitted or replaced. Contact SAKAN for changes.'},409);
    }
    const original=await readPdf(env,snapshot.contract.document_path);
    if(await sha256(original)!==snapshot.request.document_hash)throw Error('The agreement has changed. Please ask SAKAN for a new signing link.');
    snapshot=await databaseRpc(env,'contract_signing_public',{p_hash:hash,p_action:'begin',p_data:{document_hash:input.document_hash,consent_version:SIGNING_CONSENT_VERSION,submission_hash,signatures,network_fingerprint:await sha256(hash+'|'+ip),user_agent:request.headers.get('User-Agent')||''}},{admin:true});
    if(['signed','approved'].includes(snapshot.request.status))return reply(publicReceipt(snapshot));
    const signed=await signedAgreementPdf(original,snapshot);
    const file=`contracts/${snapshot.contract.reservation_id}/${snapshot.contract.id}/signed-${snapshot.request.id}.pdf`;
    const upload=await storage(env,file,{bytes:signed});
    let signedHash;
    if(upload.ok)signedHash=await sha256(signed);
    else if(upload.status===409||upload.status===400) {
      // A prior identical submission may have stored the file before its response was lost.
      signedHash=await sha256(await readPdf(env,file));
    } else throw Error('Your signed copy could not be saved. Retry the same submission.');
    snapshot=await databaseRpc(env,'contract_signing_public',{p_hash:hash,p_action:'complete',p_data:{path:file,signed_hash:signedHash,submission_hash}},{admin:true});
    return reply(publicReceipt(snapshot));
  } catch(error) {
    const unavailable=error.status===401||error.status===403;
    return reply({error:unavailable?'This signing link is unavailable, expired or revoked. Ask SAKAN for a new link.':error.status===400||error.status===409?'This agreement changed or could not be processed. Reload the page or ask SAKAN for help.':error.message||'Unable to complete signing. Retry the same submission.'},unavailable?403:409);
  }
}
