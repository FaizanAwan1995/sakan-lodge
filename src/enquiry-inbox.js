import {databaseRpc,json,limitedJson} from './public-site.js';
import {invoiceGmailToken} from './invoice-email.js';
const SENDER='sakanlodges@gmail.com';
const READ_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const worker=(env,action,data={})=>databaseRpc(env,'enquiry_inbox_worker',{p_action:action,p_data:data},{admin:true});
const validEmail=s=>typeof s==='string'&&s.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);
const encode=s=>{const bytes=new TextEncoder().encode(s);let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return btoa(raw);};
function decode(data){try{const raw=atob(String(data||'').replace(/-/g,'+').replace(/_/g,'/'));return new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));}catch{return '';}}
const header=(message,name)=>String((message.payload?.headers||[]).find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(_,charset,mode,value)=>{try{const raw=mode.toLowerCase()==='b'?atob(value):value.replace(/_/g,' ').replace(/=([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));return new TextDecoder(charset).decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));}catch{return value;}});
export function emailAddress(value){
 const text=String(value||'');if(/[\r\n]/.test(text))return '';
 const match=/^[^<>]*<([^<>]+)>\s*$/.exec(text);const address=(match?match[1]:text).trim().toLowerCase();return validEmail(address)?address:'';
}
function bodyParts(payload){
 if(!payload||payload.filename)return {plain:[],html:[],attachments:payload?.filename?[{name:payload.filename,size:payload.body?.size||0}]:[]};
 let plain=payload.mimeType==='text/plain'?[decode(payload.body?.data)]:[],html=payload.mimeType==='text/html'?[decode(payload.body?.data)]:[],attachments=[];
 for(const part of payload.parts||[]){const p=bodyParts(part);plain.push(...p.plain);html.push(...p.html);attachments.push(...p.attachments);}
 return {plain,html,attachments};
}
export function normalizeThread(thread,admins=[]){
 if(!/^[a-f0-9]+$/i.test(thread?.id||''))throw Error('Invalid Gmail thread');
 const internal=new Set([SENDER,...admins.map(x=>x.toLowerCase())]);
 const all=(thread.messages||[]).slice(-100).sort((a,b)=>Number(a.internalDate)-Number(b.internalDate));
 const human=all.filter(m=>{const sender=emailAddress(header(m,'From'));return sender&&!internal.has(sender)&&!/(^|[._-])(no-?reply|mailer-daemon|notifications?)([._@-]|$)/i.test(sender)&&!header(m,'List-Unsubscribe')&&!/^(auto-generated|auto-replied)$/i.test(header(m,'Auto-Submitted'));});
 const latest=human.at(-1);if(!latest)return null;
 const contact=emailAddress(header(latest,'Reply-To'))||emailAddress(header(latest,'From'));
 if(internal.has(contact))return null;
 return {gmail_thread_id:thread.id,subject:header(all[0],'Subject').replace(/[\r\n]/g,' ').slice(0,250)||'(No subject)',contact_email:contact,contact_name:header(latest,'From').replace(/<[^>]*>/g,'').replace(/^"|"$/g,'').trim().slice(0,120),messages:all.map(m=>{
  const parts=bodyParts(m.payload);const text=parts.plain.join('\n')||parts.html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/(p|div)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  const sender=emailAddress(header(m,'From'));
  return {id:m.id,direction:internal.has(sender)?'outgoing':'incoming',sender:sender||'Unknown sender',body:(text||m.snippet||'(No text body)').slice(0,60000),rfc_message_id:/^<[^<>\r\n\s]+>$/.test(header(m,'Message-ID'))?header(m,'Message-ID'):null,attachments:parts.attachments,sent_at:new Date(Number(m.internalDate)).toISOString()};
 })};
}
async function gmail(token,path,options={}){
 const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 if(r.status===403)throw Error('Reconnect SAKAN Gmail and approve inbox reading.');if(!r.ok)throw Error('Gmail is temporarily unavailable.');return r.json();
}
export async function syncEnquiryInbox(env){
 if(env.INCOMING_ALERT_EMAILS_ENABLED!=='true')return {disabled:true};
 await worker(env,'website');
 const stored=await env.GMAIL_TOKEN_STORE?.get('gmail:sender:encrypted-refresh-token','json');
 if(stored?.account!==SENDER||!stored.scopes?.includes(READ_SCOPE))return {needsReconnect:true};
 const token=await invoiceGmailToken(env),admins=await worker(env,'admins');
 const saved=await env.GMAIL_TOKEN_STORE.get('gmail:enquiry-sync','json')||{};
 const now=Math.floor(Date.now()/1000),after=saved.after||now-90*86400;
 const params=new URLSearchParams({maxResults:'15',q:`after:${after-300} -in:spam -in:trash -category:promotions -category:social -category:forums`});if(saved.pageToken)params.set('pageToken',saved.pageToken);
 const list=await gmail(token,'threads?'+params);let imported=0;
 for(const item of list.threads||[]){const thread=normalizeThread(await gmail(token,'threads/'+item.id+'?format=full'),admins);if(thread){await worker(env,'import',thread);imported++;}}
 // Reconcile uncertain sends by stable RFC Message-ID; never resend automatically.
 for(const reply of await worker(env,'unconfirmed')){
  const found=await gmail(token,'messages?'+new URLSearchParams({maxResults:'2',q:`in:sent rfc822msgid:enquiry-${reply.id}@sakanlodge.com`}));
  if(found.messages?.length===1)await worker(env,'sent',{reply_id:reply.id,message_id:found.messages[0].id,thread_id:found.messages[0].threadId});
 }
 await env.GMAIL_TOKEN_STORE.put('gmail:enquiry-sync',JSON.stringify(list.nextPageToken?{after,pageToken:list.nextPageToken,scanStarted:saved.scanStarted||now}:{after:saved.scanStarted||now}));
 return {imported,more:!!list.nextPageToken};
}
function encodedSubject(subject){
 const chunks=[];let part='';for(const c of subject){if(new TextEncoder().encode(part+c).length>42){chunks.push(part);part='';}part+=c;}if(part)chunks.push(part);return chunks.map(s=>'=?UTF-8?B?'+encode(s)+'?=').join('\r\n ');
}
export function enquiryReplyMime(reply){
 if(!validEmail(reply.recipient)||!Array.isArray(reply.cc)||reply.cc.length!==2||reply.cc.some(x=>!validEmail(x))||!/^[-a-f0-9]{36}$/i.test(reply.id)||typeof reply.subject!=='string'||/[\r\n]/.test(reply.subject)||typeof reply.body!=='string')throw Error('Invalid reply snapshot');
 const refs=reply.rfc_reply_to&&/^<[^<>\r\n\s]+>$/.test(reply.rfc_reply_to)?['In-Reply-To: '+reply.rfc_reply_to,'References: '+reply.rfc_reply_to]:[];
 const raw=[`From: SAKAN Lodge <${SENDER}>`,`To: ${reply.recipient}`,`Cc: ${reply.cc.join(', ')}`,`Subject: ${encodedSubject(reply.subject)}`,`Message-ID: <enquiry-${reply.id}@sakanlodge.com>`,...refs,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',encode(reply.body).match(/.{1,76}/g).join('\r\n'),''].join('\r\n');
 return encode(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function enquiryInboxApi(request,env){
 if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
 if(request.method==='POST'&&request.headers.get('Origin')!=='https://sakanlodge.com')return json({error:'Invalid origin'},403);
 const auth=request.headers.get('Authorization')||'';if(!/^Bearer \S+$/.test(auth))return json({error:'Staff sign-in required'},401);
 let claimed;
 try{
  const admins=await databaseRpc(env,'staff_notification_emails',{},auth);if(!Array.isArray(admins)||admins.length!==2)throw Error('Verify both administrator accounts.');
  const path=new URL(request.url).pathname.split('/').at(-1);
  if(path==='status'&&request.method==='GET'){
   const stored=await env.GMAIL_TOKEN_STORE?.get('gmail:sender:encrypted-refresh-token','json');return json({sender:SENDER,readConnected:stored?.account===SENDER&&!!stored.scopes?.includes(READ_SCOPE),admins});
  }
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(path==='sync')return json(await syncEnquiryInbox(env));
  const input=await limitedJson(request,18000);
  if(path==='preview')return json(await databaseRpc(env,'enquiry_action',{p_action:'prepare',p_data:input},auth));
  if(path==='update')return json(await databaseRpc(env,'enquiry_action',{p_action:'update',p_data:input},auth));
  if(path!=='send'||input.confirmation!=='SEND_REVIEWED_REPLY')return json({error:'Review the reply before sending'},400);
  const token=await invoiceGmailToken(env); // Do not claim if the sender cannot connect.
  claimed=await databaseRpc(env,'enquiry_action',{p_action:'claim',p_data:{reply_id:input.reply_id}},auth);
  const sent=await gmail(token,'messages/send',{method:'POST',body:JSON.stringify({raw:enquiryReplyMime(claimed),...(claimed.gmail_thread_id?{threadId:claimed.gmail_thread_id}:{})})});
  if(!sent.id||!sent.threadId)throw Error('Delivery not confirmed');
  await worker(env,'sent',{reply_id:claimed.id,message_id:sent.id,thread_id:sent.threadId});return json({sent:true,messageId:sent.id});
 }catch(e){
  if(claimed){try{await worker(env,'uncertain',{reply_id:claimed.id});}catch{}return json({error:'Delivery is not confirmed. Sync the inbox to reconcile Sent Mail before trying again.'},409);}
  return json({error:e.message||'Unable to load the shared inbox.'},409);
 }
}
