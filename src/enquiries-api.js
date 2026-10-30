import { databaseRpc, json, limitedJson } from './public-site.js';
export function validateEnquiry(input) {
  const limits={full_name:120,email:254,phone:30,location:40,accommodation:40,move_in:10,occupants:2,message:1500};
  const data={};
  for(const [key,max] of Object.entries(limits)) {
    if(input[key]!=null && typeof input[key]!=='string') throw Error('Invalid details');
    data[key]=(input[key]||'').trim();
    if(data[key].length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data[key]))throw Error('Invalid details');
  }
  data.email=data.email.toLowerCase();
  if(data.full_name.length<2 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(data.email) || /[\r\n]/.test(data.email) || data.phone.length<6 ||
    !['Fulham','Clapham','Oaklands Park','Flexible / any location'].includes(data.location) ||
    !['Private room','Shared accommodation','Not sure'].includes(data.accommodation) || !['1','2','3+'].includes(data.occupants) ||
    (data.move_in && (!/^\d{4}-\d{2}-\d{2}$/.test(data.move_in) || !Number.isFinite(Date.parse(data.move_in)) || new Date(data.move_in).toISOString().slice(0,10)!==data.move_in)) || input.website) throw Error('Invalid details');
  return data;
}
export async function enquiriesApi(request,env) {
  const enabled=env.INCOMING_ALERT_EMAILS_ENABLED==='true' && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY;
  if(request.method==='GET')return json({enabled:!!enabled,site_key:enabled?env.TURNSTILE_SITE_KEY:null});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(request.headers.get('Origin')!=='https://sakanlodge.com')return json({error:'Invalid origin'},403);
  if(!enabled)return json({error:'Please contact us by email or WhatsApp while enquiries are unavailable.'},503);
  let input,data;const key=request.headers.get('Idempotency-Key');
  try {
    input=await limitedJson(request,8000);data=validateEnquiry(input);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key||'') || typeof input.turnstile_token!=='string' || !input.turnstile_token || input.turnstile_token.length>2048)throw Error('Verification required');
  }catch{return json({error:'Check your contact details and complete verification.'},400);}
  try {
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:input.turnstile_token,remoteip:request.headers.get('CF-Connecting-IP')||''}),signal:AbortSignal.timeout(8000)});
    const verified=await response.json();
    if(!response.ok || !verified.success || verified.hostname!=='sakanlodge.com' || verified.action!=='enquiry')return json({error:'Verification failed. Please try again.'},400);
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.TURNSTILE_SECRET_KEY+':'+(request.headers.get('CF-Connecting-IP')||'unknown')));
    const fingerprint=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
    const result=await databaseRpc(env,'submit_enquiry',{p_data:data,p_key:key,p_fingerprint:fingerprint},{admin:true});
    return json({received:true,reference:result.reference,message:'Enquiry received. Our team will contact you soon.'},202);
  }catch(e){const status=[400,409,429].includes(e.status)?e.status:503;return json({error:status===429?'Too many enquiries. Please try again later.':'We could not confirm receipt. Keep your details and try again.'},status);}
}
