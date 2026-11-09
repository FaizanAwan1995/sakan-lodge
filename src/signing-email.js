const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function signingEmailHtml(subject,body){
 const content=body.split(/\n\s*\n/).map(part=>'<p style="margin:0 0 20px;line-height:1.65">'+part.split('\n').map(line=>{
  const url=line.trim();if(/^https:\/\/sakanlodge\.com\/ledger\/reservations\?reservation=[a-f0-9-]{36}$/i.test(url)||/^https:\/\/sakanlodge\.com\/sign#[a-f0-9]{64}$/.test(url))return '<a href="'+escape(url)+'" style="display:inline-block;padding:13px 20px;background:#173d32;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">'+(url.includes('/ledger/')?'Review agreement in Ledger':'Open your agreement')+'</a>';
  return escape(line);
 }).join('<br>')+'</p>').join('');
 return '<!doctype html><html><body style="margin:0;background:#f4f3ee;color:#243c32;font:16px Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #dce4de;border-radius:12px"><tr><td style="padding:24px;background:#173d32;color:#fff;font-size:20px;font-weight:bold">SAKAN Lodge</td></tr><tr><td style="padding:28px"><h1 style="font-size:23px;line-height:1.35;margin:0 0 24px">'+escape(subject)+'</h1>'+content+'</td></tr></table></td></tr></table></body></html>';
}
export function alternativeEmailParts(boundary,plain,html,encode){
 const fold=s=>encode(s).match(/.{1,76}/g)?.join('\r\n')||'';
 return ['Content-Type: multipart/alternative; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',fold(plain),'--'+boundary,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',fold(html),'--'+boundary+'--',''];
}
