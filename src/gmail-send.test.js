import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailSend } from './gmail-send.js';
import { GmailOAuthState } from './gmail-oauth-state.js';

const request = (path, data, token = 'staff') => new Request('https://sakanlodge.com/api/gmail/' + path, {
  method: 'POST', headers: { Origin: 'https://sakanlodge.com', Authorization: 'Bearer ' + token }, body: JSON.stringify(data),
});
const draft = { recipients: ['Guest@Example.test', 'guest@example.test'], subject: 'Reviewed notice', body: 'Inspection is scheduled for tomorrow.' };
async function fixture(run) {
  const original = globalThis.fetch;
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('synthetic-refresh'));
  const objects = new Map();
  const state = { sends: 0, tokens: 0, raw: '', fail: false, auditFail: false, cc: ['staff@example.test'], sender: 'sender@example.test' };
  const env = {
    SUPABASE_URL: 'https://database.test', SUPABASE_PUBLIC_KEY: 'public', GMAIL_CLIENT_ID: 'test', GMAIL_CLIENT_SECRET: 'test',
    GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.from(rawKey).toString('base64'),
    GMAIL_TOKEN_STORE: { get: async () => ({ account: state.sender, iv: [...iv], data: [...new Uint8Array(encrypted)] }) },
    GMAIL_OAUTH_STATE: {
      idFromName: name => name,
      get(name) {
        if (!objects.has(name)) {
          const values = new Map();
          // Serialises transactions like the real transactional store. This is a unit fixture,
          // not a substitute for a Cloudflare runtime concurrency test.
          let pending = Promise.resolve();
          const storage = { get: async k => values.get(k), put: async (k,v) => values.set(k,v), setAlarm: async () => {}, deleteAll: async () => values.clear() };
          storage.transaction = callback => {
            const result = pending.then(() => callback(storage));
            pending = result.catch(() => {}); return result;
          };
          objects.set(name, new GmailOAuthState({ storage }));
        }
        return objects.get(name);
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    url = String(url);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: options.headers.Authorization, email_confirmed_at: '2026-01-01' });
    if (url.endsWith('/staff_notification_emails')) return Response.json(state.cc);
    if (url.includes('oauth2.googleapis.com')) { state.tokens++; return Response.json({ access_token: 'synthetic-access' }); }
    if (url.includes('gmail.googleapis.com')) {
      state.sends++; state.raw = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString();
      if (state.fail) throw new Error('Simulated lost response');
      return Response.json({ id: 'synthetic-message-id' });
    }
    if (url.endsWith('/log_sent_email')) {
      if (state.auditFail) throw new Error('Audit unavailable');
      return new Response('null');
    }
    throw new Error('Unexpected call: ' + url);
  };
  try { await run({ env, state, objects }); } finally { globalThis.fetch = original; }
}

test('preview makes no Gmail calls; send uses immutable reviewed sender, BCC, CC and content', () => fixture(async ({ env, state }) => {
  const response = await gmailSend(request('preview', draft), env);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.deepEqual(preview.recipients, ['guest@example.test']);
  assert.deepEqual(preview.cc, ['staff@example.test']);
  assert.equal(state.tokens, 0); assert.equal(state.sends, 0);
  const sent = await gmailSend(request('send', { reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL', recipients: ['attacker@example.test'], body: 'replacement', copyAdministrators: false }), env);
  assert.equal(sent.status, 200);
  assert.ok(state.raw.includes('Bcc: guest@example.test'));
  assert.ok(state.raw.includes('Cc: staff@example.test'));
  assert.ok(!state.raw.includes('attacker'));
  assert.equal(Buffer.from(state.raw.split('\r\n\r\n')[1], 'base64').toString(), draft.body);
}));

test('one review permits one attempt, including concurrent submissions and uncertain Gmail outcome', () => fixture(async ({ env, state }) => {
  const preview = await (await gmailSend(request('preview', draft), env)).json();
  state.fail = true;
  const payload = { reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL' };
  const results = await Promise.all([gmailSend(request('send', payload), env), gmailSend(request('send', payload), env)]);
  assert.deepEqual(results.map(x => x.status).sort(), [409, 503]);
  assert.equal(state.sends, 1);
  assert.equal((await gmailSend(request('send', payload), env)).status, 409);
  assert.equal(state.sends, 1);
}));

test('another staff account cannot claim review; changed staff copy addresses require new review', () => fixture(async ({ env, state }) => {
  const preview = await (await gmailSend(request('preview', draft), env)).json();
  const payload = { reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL' };
  assert.equal((await gmailSend(request('send', payload, 'other-staff'), env)).status, 409);
  state.cc = ['replacement@example.test'];
  assert.equal((await gmailSend(request('send', payload), env)).status, 409);
  assert.equal(state.sends, 0);
}));

test('missing preview, subject/body placeholders and header injection are rejected before Gmail', () => fixture(async ({ env, state }) => {
  assert.equal((await gmailSend(request('send', { ...draft, confirmation: 'SEND_REVIEWED_EMAIL' }), env)).status, 400);
  for (const change of [{ subject: '[VERIFY DATE]' }, { body: '{{TENANT_NAME}}' }, { subject: 'Notice\r\nBcc: attacker@example.test' }, { recipients: ['bad,header@example.test'] }]) {
    assert.equal((await gmailSend(request('preview', { ...draft, ...change }), env)).status, 400);
  }
  assert.equal(state.tokens, 0); assert.equal(state.sends, 0);
}));

test('delivery success remains success if audit logging fails', () => fixture(async ({ env, state }) => {
  const preview = await (await gmailSend(request('preview', draft), env)).json();
  state.auditFail = true;
  const result = await gmailSend(request('send', { reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL' }), env);
  const body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.sent, true); assert.equal(body.logged, false);
  assert.equal(state.sends, 1);
}));

test('expired review cannot be claimed and preview payload is removed after claim', () => fixture(async ({ env, objects }) => {
  const preview = await (await gmailSend(request('preview', draft), env)).json();
  const object = objects.get('email-review:' + preview.reviewId);
  const stored = await object.storage.get('email-review');
  await object.storage.put('email-review', { ...stored, expires: Date.now() - 1 });
  assert.equal((await gmailSend(request('send', { reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL' }), env)).status, 409);
  await object.alarm();
  assert.equal(await object.storage.get('email-review'), undefined);
}));


test('long Unicode messages preserve content and MIME lines stay within the transport limit', () => fixture(async ({ env, state }) => {
  const body = 'Welcome 🌏 '.repeat(200);
  const subject = '🏡'.repeat(100);
  const preview = await (await gmailSend(request('preview', { ...draft, body, subject }), env)).json();
  const response = await gmailSend(request('send', { reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL' }), env);
  assert.equal(response.status, 200);
  assert.ok(state.raw.split('\r\n').every(line => Buffer.byteLength(line) <= 998));
  assert.equal(Buffer.from(state.raw.split('\r\n\r\n')[1], 'base64').toString(), body.trim());
}));
