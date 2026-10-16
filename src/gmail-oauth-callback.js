// Gmail OAuth callback implementation for Sakan Lodge.
// This module is deliberately not enabled until an encrypted token store is configured.
// Never return OAuth codes, access tokens, or refresh tokens to the browser.
const REDIRECT = 'https://sakanlodge.com/api/gmail/callback';
const SENDER = 'sakanlodges@gmail.com';
const utf8 = new TextEncoder();
const toHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const reply = (message, status = 200) => new Response(message, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
});
async function signature(secret, value) {
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, utf8.encode(value)));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
const ADMINS = new Set(['faizanasif117@gmail.com', 'danish.mihm@gmail.com']);
export async function gmailStart(request, env) {
  if (request.method !== 'POST') return reply('Method not allowed', 405);
  if (request.headers.get('Origin') !== 'https://sakanlodge.com') return reply('Invalid origin', 403);
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_OAUTH_STATE_SECRET || !env.GMAIL_TOKEN_STORE ||
      !env.SUPABASE_URL || !env.SUPABASE_PUBLIC_KEY) return reply('Gmail connection not configured', 503);
  const bearer = request.headers.get('Authorization') || '';
  if (!/^Bearer [^\\s]+$/.test(bearer)) return reply('Sign in required', 401);
  const userResponse = await fetch(env.SUPABASE_URL.replace(/\\/$/, '') + '/auth/v1/user', {
    headers: { Authorization: bearer, apikey: env.SUPABASE_PUBLIC_KEY }
  });
  if (!userResponse.ok) return reply('Session expired', 401);
  const user = await userResponse.json();
  if (!user.email_confirmed_at || !ADMINS.has((user.email || '').toLowerCase())) return reply('Administrator access required', 403);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const expiryText = String(Date.now() + 300000);
  const mac = await signature(env.GMAIL_OAUTH_STATE_SECRET, nonce + '.' + expiryText);
  await env.GMAIL_TOKEN_STORE.put('oauth-state:' + nonce, expiryText, { expirationTtl: 300 });
  const oauth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [k,v] of Object.entries({
    client_id: env.GMAIL_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline', prompt: 'consent select_account',
    login_hint: SENDER, state: nonce + '.' + expiryText + '.' + mac
  })) oauth.searchParams.set(k,v);
  return new Response(JSON.stringify({ url: oauth.toString() }), {
    status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
      'Access-Control-Allow-Origin': 'https://sakanlodge.com', 'Vary': 'Origin' }
  });
}
export async function gmailCallback(request, env) {
  if (request.method !== 'GET') return reply('Method not allowed', 405);
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_OAUTH_STATE_SECRET || !env.GMAIL_TOKEN_ENCRYPTION_KEY || !env.GMAIL_TOKEN_STORE) {
    return reply('Gmail connection is not configured yet.', 503);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || code.length > 4096 || state.length > 1024) return reply('Invalid authorisation response.', 400);
  const parts = state.split('.');
  if (parts.length !== 3) return reply('Invalid authorisation state.', 400);
  const [nonce, expiryText, mac] = parts;
  const expiry = Number(expiryText);
  if (!/^[a-f0-9]{32}$/.test(nonce) || !/^\d{13}$/.test(expiryText) ||
      !Number.isSafeInteger(expiry) || expiry < Date.now() || expiry > Date.now() + 600000 ||
      !/^[a-f0-9]{64}$/.test(mac)) return reply('Authorisation expired or invalid.', 400);
  const expected = await signature(env.GMAIL_OAUTH_STATE_SECRET, nonce + '.' + expiryText);
  if (!equal(expected, mac)) return reply('Invalid authorisation state.', 403);
  // Consume the state once to prevent callback replay.
  const stateKey = 'oauth-state:' + nonce;
  const stored = await env.GMAIL_TOKEN_STORE.get(stateKey);
  if (stored !== expiryText) return reply('Authorisation already used or expired.', 403);
  await env.GMAIL_TOKEN_STORE.delete(stateKey);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
  });
  if (!tokenResponse.ok) return reply('Google could not complete authorisation.', 502);
  const tokens = await tokenResponse.json();
  if (!tokens.access_token || !tokens.refresh_token) return reply('No offline authorisation granted. Reconnect with consent.', 400);
  const identityResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: 'Bearer ' + tokens.access_token }
  });
  if (!identityResponse.ok) return reply('Could not verify the Gmail sender.', 502);
  const profile = await identityResponse.json();
  if ((profile.emailAddress || '').toLowerCase() !== SENDER) return reply('Please authorise only sakanlodges@gmail.com.', 403);
  // The refresh token is encrypted at rest using the Web Crypto API, with a key
  // stored separately as a Cloudflare secret; never persist plaintext in KV.
  if (!env.GMAIL_TOKEN_ENCRYPTION_KEY) return reply('Secure token storage is not configured.', 503);
  const keyBytes = Uint8Array.from(atob(env.GMAIL_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) return reply('Invalid token encryption configuration.', 503);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(tokens.refresh_token)));
  await env.GMAIL_TOKEN_STORE.put('gmail:sender:encrypted-refresh-token', JSON.stringify({
    iv: Array.from(iv), data: Array.from(ciphertext), account: SENDER
  }));
  return reply('SAKAN Lodge Gmail sender connected successfully. You may close this page.');
}
