const sender='sakanlodges@gmail.com';
const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(s);}
const encoded=text=>base64(new TextEncoder().encode(text));
const folded=b64=>b64.match(/.{1,76}/g)?.join('\r\n')||'';
export async function invoiceGmailToken(env){
 if(!env.GMAIL_TOKEN_STORE||!env.GMAIL_TOKEN_ENCRYPTION_KEY||!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET)throw Error('Invoice Gmail configuration unavailable');
 const stored=await env.GMAIL_TOKEN_STORE.get('gmail:sender:encrypted-refresh-token','json');
 if(stored?.account?.toLowerCase()!==sender)throw Error('Connect the official SAKAN Lodge Gmail sender');
 const bytes=Uint8Array.from(atob(env.GMAIL_TOKEN_ENCRYPTION_KEY),c=>c.charCodeAt(0));if(bytes.length!==32)throw Error('Invoice token encryption configuration invalid');
 const key=await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(stored.iv)},key,new Uint8Array(stored.data));
 const refresh=new TextDecoder().decode(plain);
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Reconnect Gmail before sending invoices');
 const token=await response.json();if(!token.access_token)throw Error('Gmail access unavailable');return token.access_token;
}
export function invoiceMime(invoice,pdf,deliveryId=null){
 const s=invoice.snapshot,recipient=s.tenant_email;
 const cc=[...new Set(s.cc||[])].sort();
 if(!validEmail(recipient)||recipient.toLowerCase()===sender||!cc.includes(sender)||cc.some(e=>!validEmail(e))||cc.length!==3)throw Error('Invalid invoice recipients');
 if(!Number.isSafeInteger(Number(invoice.number))||Number(invoice.number)<82)throw Error('Invalid invoice number');
 if(deliveryId!==null&&!/^[a-f0-9-]{36}$/i.test(deliveryId))throw Error('Invalid delivery identifier');
 const boundary='sakan-invoice-'+invoice.id;
 if(!/^[a-f0-9-]{36}$/i.test(invoice.id))throw Error('Invalid invoice identifier');
 const subject=`SAKAN Lodge - paid rent invoice #${invoice.number}`;
 const periods=s.lines.filter(l=>l.period_start).map(l=>`${l.period_start} to ${l.period_end}`).join('; ');
 const body=`Hello ${s.tenant_name},\n\nThank you. We have recorded your rent payment of AUD $${Number(s.payment.amount).toFixed(2)} received on ${s.payment.date}.\n\nInvoice: #${invoice.number}${invoice.replaces_number ? ` (replaces invoice #${invoice.replaces_number})` : ''}\nProperty: ${s.address}\nRoom: ${s.room || 'As agreed'}\n${periods ? 'Allocated periods: '+periods+'\n' : ''}Payment method: ${s.payment.method}\n\nYour paid invoice is attached. This confirms the amount received; a partial payment does not mark the whole rent period paid.\n\nKind regards,\nSAKAN Lodge\n${sender}\n0426 721 787`;
 const raw=[`From: SAKAN Lodge <${sender}>`,`To: ${recipient}`,`Cc: ${cc.join(',\r\n ')}`,`Subject: ${subject}`,`Message-ID: <rent-invoice-${invoice.id}${deliveryId?'-'+deliveryId:''}@sakanlodge.com>`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',folded(encoded(body)),`--${boundary}`,`Content-Type: application/pdf; name="SAKAN-invoice-${invoice.number}.pdf"`,`Content-Disposition: attachment; filename="SAKAN-invoice-${invoice.number}.pdf"`,'Content-Transfer-Encoding: base64','',folded(base64(pdf)),`--${boundary}--`,''].join('\r\n');
 return encoded(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function sendInvoiceMime(token,raw){
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Gmail delivery not confirmed');const result=await response.json();if(!result.id)throw Error('Gmail delivery confirmation missing');return result.id;
}
