export class GmailOAuthState {
  constructor(state) { this.storage = state.storage; }
  async alarm() { await this.storage.deleteAll(); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/email-review') {
      const input = await request.json();
      const result = await this.storage.transaction(async txn => {
        const stored = await txn.get('email-review');
        if (request.method === 'PUT') {
          if (stored || !input.owner || !input.message || input.expires <= Date.now()) return null;
          await txn.put('email-review', input);
          return input;
        }
        if (request.method !== 'POST' || !stored || stored.claimed || stored.owner !== input.owner || stored.expires <= Date.now()) return null;
        await txn.put('email-review', { owner: stored.owner, expires: stored.expires, claimed: true });
        return stored;
      });
      if (result && request.method === 'PUT') await this.storage.setAlarm(result.expires);
      return result ? Response.json(result) : new Response('Review expired or already used', { status: 409 });
    }
    const nonce = url.pathname.slice(1);
    if (!/^[a-f0-9]{32}$/.test(nonce)) return new Response('Invalid state', { status: 400 });
    if (request.method === 'PUT') {
      const value = await request.text();
      let data;
      try { data = JSON.parse(value); } catch { return new Response('Invalid state', { status: 400 }); }
      if (!/^\d{13}$/.test(data?.expiryText || '') || !/^[A-Za-z0-9_-]{43}$/.test(data?.verifier || '')) return new Response('Invalid state', { status: 400 });
      await this.storage.put('state', value);
      return new Response('Stored');
    }
    if (request.method === 'POST') {
      const expiryText = await request.text();
      const claimed = await this.storage.transaction(async txn => {
        const value = await txn.get('state');
        if (!value) return null;
        const data = JSON.parse(value);
        if (data.expiryText !== expiryText || Number(expiryText) < Date.now()) return null;
        await txn.delete('state');
        return value;
      });
      return claimed ? new Response(claimed) : new Response('Already used or expired', { status: 403 });
    }
    return new Response('Method not allowed', { status: 405 });
  }
}
