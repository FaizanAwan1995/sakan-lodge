import { databaseRpc } from './public-site.js';
import { invoiceGmailToken, sendInvoiceMime } from './invoice-email.js';
const worker=(env,action,id=null,attempt=null,message=null)=>databaseRpc(env,'incoming_alert_worker',{p_action:action,p_id:id,p_attempt:attempt,p_message:message},{admin:true});
const encode=text=>{const bytes=new TextEncoder().encode(text);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
export function alertMime(alert){
  const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
  if(!validEmail(alert.recipient)||!validEmail(alert.reply_to)||!/^[-a-f0-9]{36}$/i.test(alert.id)||typeof alert.subject!=='string'||/[\r\n]/.test(alert.subject)||typeof alert.body!=='string')throw Error('Invalid alert');
  const raw=[ 'From: SAKAN Lodge <sakanlodges@gmail.com>',`To: ${alert.recipient}`,`Reply-To: ${alert.reply_to}`,`Subject: =?UTF-8?B?${encode(alert.subject)}?=`,`Message-ID: <incoming-${alert.id}@sakanlodge.com>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',encode(alert.body).match(/.{1,76}/g).join('\r\n'),''].join('\r\n');
  return encode(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function processIncomingAlerts(env){
  if(env.INCOMING_ALERT_EMAILS_ENABLED!=='true')return {disabled:true};
  const ids=await worker(env,'pending');if(!ids?.length)return {processed:0};
  const token=await invoiceGmailToken(env);let processed=0;
  for(const id of ids){const attempt=crypto.randomUUID();let claimed=false;
    try {const alert=await worker(env,'claim',id,attempt);if(!alert)continue;claimed=true;
      const messageId=await sendInvoiceMime(token,alertMime(alert));await worker(env,'sent',id,attempt,messageId);processed++;
    }catch{if(claimed)try{await worker(env,'uncertain',id,attempt);}catch{/* Preserve the claim; a stale claim is flagged for staff review. */}}
  }return {processed};
}
