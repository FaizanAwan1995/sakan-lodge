import {databaseRpc,bookingEnabled} from './public-site.js';
import {validateOccupants,idFileType} from './couples-application.js';
import {sha256} from './contract-signing.js';
import {contractPdf} from './contract-pdf.js';
const headers={'cache-control':'no-store, private','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'};
const reply=(body,status=200)=>Response.json(body,{status,headers});
async function boundedForm(request) {
  const reader=request.body?.getReader();if(!reader)throw Error('Application details required.');
  let size=0;const chunks=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>11*1024*1024)throw Error('Each photo ID must be under 5 MB.');chunks.push(value);}}finally{await reader.cancel();}
  return new Response(new Blob(chunks),{headers:{'content-type':request.headers.get('content-type')}}).formData();
}
async function putPrivate(env,bucket,path,bytes,mime) {
  const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  const h={apikey:key,'content-type':mime,'x-upsert':'false'};if(key.startsWith('eyJ'))h.Authorization='Bearer '+key;
  const r=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:h,body:bytes,signal:AbortSignal.timeout(20000)});
  if(!r.ok){const e=await r.json().catch(()=>({}));if(r.status!==409&&e.statusCode!=='409')throw Error('Your photo IDs could not be saved privately. Retry with the same details.');}
}
export async function couplesApplicationApi(request,env) {
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  if(request.headers.get('Origin')!=='https://sakanlodge.com')return reply({error:'Invalid origin'},403);
  if(!bookingEnabled(env))return reply({error:'Online applications are temporarily unavailable.'},503);
  if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))return reply({error:'Upload the application using the reservation form.'},415);
  const key=request.headers.get('Idempotency-Key')||'';
  if(!/^[a-f0-9-]{36}$/i.test(key))return reply({error:'Reload the application form and retry.'},400);
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip||!env.ROOM_AI_LIMITER?.limit)return reply({error:'Applications are temporarily unavailable. Try again later.'},503);
  if(!(await env.ROOM_AI_LIMITER.limit({key:'couples-application:'+ip})).success)return reply({error:'Please wait a minute before retrying.'},429);
  let submitted=false;
  try {
    const form=await boundedForm(request);
    if(form.get('application_consent')!=='yes')throw Error('Both occupants must consent to this application.');
    const occupants=validateOccupants([1,2].map(i=>({name:form.get(`occupant_${i}_name`),email:form.get(`occupant_${i}_email`),phone:form.get(`occupant_${i}_phone`),occupation:form.get(`occupant_${i}_occupation`)})));
    const files=[];
    for(let i=1;i<=2;i++) {
      const f=form.get(`occupant_${i}_id`);if(!f||typeof f.arrayBuffer!=='function'||f.size<32||f.size>5*1024*1024)throw Error(`Upload occupant ${i}’s photo ID, up to 5 MB.`);
      const bytes=new Uint8Array(await f.arrayBuffer()),type=idFileType(bytes),hash=await sha256(bytes);
      files.push({bytes,...type,path:`applications/${key}/${i}-${hash}.${type.ext}`});
    }
    const token=form.get('cf-turnstile-response');if(!token)throw Error('Complete the security check and retry.');
    const check=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:ip}),signal:AbortSignal.timeout(8000)});
    const verification=await check.json();if(!verification.success||verification.hostname!=='sakanlodge.com')throw Error('Security check expired. Please retry.');
    const data={room_id:form.get('room_id'),arrival_date:form.get('arrival_date'),departure_date:form.get('departure_date'),introduction:String(form.get('introduction')||''),occupants:occupants.map((p,i)=>({...p,id_path:files[i].path})),consent_version:'couples-application-v1'};
    // Verify dates, room and both applicants before accepting any ID uploads.
    await databaseRpc(env,'validate_couples_application',{p_data:data,p_key:key},{admin:true});
    for(const f of files)await putPrivate(env,'reservation-ids',f.path,f.bytes,f.mime);
    const result=await databaseRpc(env,'submit_couples_application',{p_data:data,p_key:key},{admin:true});
    submitted=true;
    // The durable draft exists even if rendering/storage is interrupted. Admin can
    // open it through the existing contract PDF action; no duplicate application.
    let pdfReady=!!result.contract.document_path;
    if(!pdfReady)try {
      const bytes=await contractPdf(result.contract,result.code);
      const path=`contracts/${result.reservation_id}/${result.contract.id}/application.pdf`;
      await putPrivate(env,'reservation-contracts',path,bytes,'application/pdf');
      await databaseRpc(env,'complete_application_contract',{p_key:key,p_contract:result.contract.id,p_path:path},{admin:true});
      pdfReady=true;
    }catch{/* Staff PDF recovery uses the saved draft and existing staff API. */}
    return reply({code:result.code,status:result.status,contract_ready:pdfReady},201);
  }catch(e){
    return reply({error:submitted?'Your application was saved. Contact SAKAN if you need help.':e.status===409?'Availability changed. Check your dates again.':e.status===503?'The application service could not connect. Retry with the same details.':e.message||'Unable to save the application. Retry with the same details.'},e.status===409?409:400);
  }
}
