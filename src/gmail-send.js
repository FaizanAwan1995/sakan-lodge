const SENDER = 'sakanlodges@gmail.com';
const ADMINS = ['faizanasif117@gmail.com', 'danish.mihm@gmail.com'];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const validEmail = value => typeof value === 'string' && value.length < 255 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
function encode64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(binary);
}
export async function gmailSend(request, env) {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== 'https://sakanlodge.com') return reply({ error: 'Invalid origin' }, 403);
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLIC_KEY || !env.GMAIL_TOKEN_STORE || !env.GMAIL_TOKEN_ENCRYPTION_KEY || !env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) return reply({ error: 'Gmail is not configured' }, 503);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(authorization)) return reply({ error: 'Sign in required' }, 401);
  try {
    const identity = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', { headers: { Authorization: authorization, apikey: env.SUPABASE_PUBLIC_KEY } });
    if (!identity.ok) return reply({ error: 'Session expired' }, 401);
    const user = await identity.json();
    if (!user.email_confirmed_at || !ADMINS.includes((user.email || '').toLowerCase())) return reply({ error: 'Administrator access required' }, 403);
    const data = await request.json();
    const { recipients, subject, body, confirmation } = data || {};
    if (confirmation !== 'SEND_REVIEWED_EMAIL' || !Array.isArray(recipients) || recipients.length < 1 || recipients.length > 100 || typeof subject !== 'string' || !subject.trim() || subject.length > 250 || typeof body !== 'string' || !body.trim() || body.length > 60000 || /\[[^\]\r\n]{2,100}\]/.test(body)) return reply({ error: 'Review all recipients and message details' }, 400);
    const addresses = [...new Set(recipients.map(x => String(x).trim().toLowerCase()))];
    if (addresses.some(x => !validEmail(x) || ADMINS.includes(x) || x === SENDER)) return reply({ error: 'Invalid recipient' }, 400);
    const stored = await env.GMAIL_TOKEN_STORE.get('gmail:sender:encrypted-refresh-token', 'json');
    if (!stored || stored.account !== SENDER) return reply({ error: 'Reconnect Gmail in settings' }, 409);
    const keyBytes = Uint8Array.from(atob(env.GMAIL_TOKEN_ENCRYPTION_KEY), x => x.charCodeAt(0));
    if (keyBytes.length !== 32) return reply({ error: 'Invalid encryption configuration' }, 503);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const refreshToken = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(stored.iv) }, key, new Uint8Array(stored.data)));
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
    if (!tokenResponse.ok) return reply({ error: 'Gmail authorization expired. Reconnect Gmail.' }, 409);
    const token = await tokenResponse.json();
    if (!token.access_token) return reply({ error: 'Gmail access unavailable' }, 502);
    const lines = ['From: Sakan Lodge <' + SENDER + '>', 'To: ' + SENDER, 'Cc: ' + ADMINS.join(', '), 'Bcc: ' + addresses.join(', '), 'Subject: =?UTF-8?B?' + encode64(subject.replace(/[\r\n]/g, ' ').trim()) + '?=', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encode64(body)];
    const encoded = encode64(lines.join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + token.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ raw: encoded }) });
    if (!result.ok) return reply({ error: 'Gmail did not confirm sending. Check Sent Mail before retrying.' }, 502);
    const sent = await result.json();
    if (!sent.id) return reply({ error: 'Sending confirmation missing. Check Sent Mail.' }, 502);
    return reply({ sent: true, recipientCount: addresses.length, messageId: sent.id });
  } catch {
    return reply({ error: 'Unable to confirm sending. Check Sent Mail before retrying.' }, 503);
  }
}
