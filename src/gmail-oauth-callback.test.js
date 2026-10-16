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
