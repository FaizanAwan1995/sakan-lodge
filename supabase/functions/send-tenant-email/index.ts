// Sakan Lodge shared Gmail sender. Deploy only after configuring secure secrets.
// Secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// This function is staff-only, manually invoked, and never sends on a schedule.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED = new Set(['faizanasif117@gmail.com', 'danish.mihm@gmail.com']);
const SENDER = 'sakanlodges@gmail.com';
const MAX_RECIPIENTS = 100;
const cors = {
  'Access-Control-Allow-Origin': 'https://sakanlodge.com',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function validEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\\.[^\s@]+$/.test(v.trim());
}
function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function header(value: string) {
  // Prevent header injection; MIME encode UTF-8 subject safely.
  if (/[\r\n]/.test(value)) throw new Error('Invalid header');
  return '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(value))) + '?=';
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (req.headers.get('origin') !== 'https://sakanlodge.com') return json(403, { error: 'Origin not allowed' });
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in required' });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const client = createClient(supabaseUrl, publicKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user || !user.email_confirmed_at || !ALLOWED.has((user.email || '').toLowerCase())) {
    return json(403, { error: 'Only authorised Sakan Lodge administrators may send email' });
  }
  let input: any;
  try { input = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { propertyId, tenantIds, subject, message, cc } = input || {};
  if (!Array.isArray(tenantIds) || tenantIds.length < 1 || tenantIds.length > MAX_RECIPIENTS ||
      !tenantIds.every((id) => typeof id === 'string' && id.length < 150) ||
      typeof propertyId !== 'string' || !propertyId || typeof subject !== 'string' || !subject.trim() || subject.length > 180 ||
      typeof message !== 'string' || !message.trim() || message.length > 20000 ||
      /[\r\n]/.test(subject) || /\[(?:ENTER|VERIFY|ADD|CONFIRM|FORM TEMPLATE)[^\]]*\]/i.test(message)) {
    return json(400, { error: 'Invalid message or recipients' });
  }
  const ccEmails = Array.isArray(cc) ? cc : [];
  if (ccEmails.length > 5 || !ccEmails.every(validEmail)) return json(400, { error: 'Invalid CC' });
  // Resolve recipients on the server, never trust client-supplied tenant email addresses.
  const ids = [...new Set(tenantIds)];
  const { data: tenants, error: dbError } = await client.from('people')
    .select('id,name,email,property_id,end_date').eq('property_id', propertyId).in('id', ids);
  if (dbError) return json(500, { error: 'Could not verify tenant records' });
  const today = new Date().toISOString().slice(0, 10);
  if (!tenants || tenants.length !== ids.length ||
      tenants.some((t) => (t.end_date && t.end_date <= today) || !validEmail(t.email))) {
    return json(400, { error: 'Some recipients are inactive, missing or have invalid email addresses. Refresh the tenant list.' });
  }
  const recipients = [...new Set(tenants.map((t) => t.email.trim().toLowerCase()))];
  const clientId = Deno.env.get('GMAIL_CLIENT_ID');
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return json(503, { error: 'Official Gmail sender is not connected yet' });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) return json(503, { error: 'Gmail authorisation expired. Reconnect the official sender.' });
  const to = recipients.length === 1 ? recipients[0] : SENDER;
  const lines = [
    'From: SAKAN Lodge <' + SENDER + '>',
    'To: ' + to,
    ...(recipients.length > 1 ? ['Bcc: ' + recipients.join(', ')] : []),
    ...(ccEmails.length ? ['Cc: ' + [...new Set(ccEmails.map((e: string) => e.trim().toLowerCase()))].join(', ')] : []),
    'Subject: ' + header(subject.trim()),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(String.fromCharCode(...new TextEncoder().encode(message))),
  ];
  const sent = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token.access_token, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: encodeBase64Url(lines.join('\r\n')) }),
  });
  if (!sent.ok) return json(502, { error: 'Gmail rejected the message. Check the official sender connection.' });
  const result = await sent.json();
  return json(200, { sent: true, messageId: result.id, recipientCount: recipients.length });
});
