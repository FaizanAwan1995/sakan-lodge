import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailStart, gmailCallback } from './gmail-oauth-callback.js';

const request = (url, method = 'GET', headers = {}) => new Request(url, { method, headers });
const base = 'https://sakanlodge.com/api/gmail/callback';
const env = {
  GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret',
  GMAIL_OAUTH_STATE_SECRET: 'test-state-secret',
  GMAIL_TOKEN_ENCRYPTION_KEY: btoa('12345678901234567890123456789012'),
  GMAIL_TOKEN_STORE: { get: async () => null, put: async () => {}, delete: async () => {} },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLIC_KEY: 'test-publishable'
};
test('start requires POST and same-site origin', async () => {
  assert.equal((await gmailStart(request('https://sakanlodge.com/api/gmail/start'), env)).status, 405);
  assert.equal((await gmailStart(request('https://sakanlodge.com/api/gmail/start', 'POST', { Origin: 'https://evil.example' }), env)).status, 403);
});
test('start rejects absent and malformed authentication', async () => {
  const url = 'https://sakanlodge.com/api/gmail/start';
  assert.equal((await gmailStart(request(url, 'POST', { Origin: 'https://sakanlodge.com' }), env)).status, 401);
  assert.equal((await gmailStart(request(url, 'POST', { Origin: 'https://sakanlodge.com', Authorization: 'Bearer' }), env)).status, 401);
});
test('start fails closed if required configuration is absent', async () => {
  const response = await gmailStart(request('https://sakanlodge.com/api/gmail/start', 'POST', { Origin: 'https://sakanlodge.com' }), { ...env, GMAIL_TOKEN_STORE: null });
  assert.equal(response.status, 503);
});
test('callback rejects cancellation and malformed OAuth responses', async () => {
  assert.equal((await gmailCallback(request(base + '?error=access_denied'), env)).status, 400);
  assert.equal((await gmailCallback(request(base + '?code=test&state=invalid'), env)).status, 400);
  assert.equal((await gmailCallback(request(base), env)).status, 400);
});
test('callback fails closed without secure token storage', async () => {
  assert.equal((await gmailCallback(request(base + '?code=test&state=invalid'), { ...env, GMAIL_TOKEN_STORE: null })).status, 503);
});

test('start accepts confirmed administrator and generates scoped Google consent URL', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ email: 'faizanasif117@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' });
  let stored;
  const response = await gmailStart(request('https://sakanlodge.com/api/gmail/start', 'POST', {
    Origin: 'https://sakanlodge.com', Authorization: 'Bearer valid-test-token'
  }), { ...env, GMAIL_TOKEN_STORE: { put: async (...args) => { stored = args; } } });
  assert.equal(response.status, 200);
  const { url } = await response.json();
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://accounts.google.com');
  assert.equal(parsed.searchParams.get('login_hint'), 'sakanlodges@gmail.com');
  assert.match(parsed.searchParams.get('scope'), /gmail\.send/);
  assert.match(parsed.searchParams.get('scope'), /openid email/);
  assert.ok(stored[0].startsWith('oauth-state:'));
});
test('start denies unconfirmed and non-admin accounts', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const user of [
    { email: 'other@example.com', email_confirmed_at: '2026-01-01' },
    { email: 'faizanasif117@gmail.com', email_confirmed_at: null }
  ]) {
    globalThis.fetch = async () => Response.json(user);
    const response = await gmailStart(request('https://sakanlodge.com/api/gmail/start', 'POST', {
      Origin: 'https://sakanlodge.com', Authorization: 'Bearer valid-test-token'
    }), env);
    assert.equal(response.status, 403);
  }
});
test('start handles authentication network and storage errors without exposing tokens', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const req = request('https://sakanlodge.com/api/gmail/start', 'POST', {
    Origin: 'https://sakanlodge.com', Authorization: 'Bearer secret-test-token'
  });
  globalThis.fetch = async () => { throw new Error('secret-test-token'); };
  let response = await gmailStart(req, env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret-test-token/);
  globalThis.fetch = async () => Response.json({ email: 'danish.mihm@gmail.com', email_confirmed_at: '2026-01-01' });
  response = await gmailStart(req, { ...env, GMAIL_TOKEN_STORE: { put: async () => { throw new Error('storage error'); } } });
  assert.equal(response.status, 503);
});
test('callback rejects tampered and expired state before exchanging tokens', async () => {
  const state = 'a'.repeat(32) + '.1000000000000.' + 'b'.repeat(64);
  assert.equal((await gmailCallback(request(base + '?code=abc&state=' + state), env)).status, 400);
  const future = String(Date.now() + 120000);
  const forged = 'a'.repeat(32) + '.' + future + '.' + 'b'.repeat(64);
  assert.equal((await gmailCallback(request(base + '?code=abc&state=' + forged), env)).status, 403);
});
