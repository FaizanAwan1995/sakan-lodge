export class GmailOAuthState {
  constructor(state) { this.storage = state.storage; }
  async fetch(request) {
    const url = new URL(request.url);
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
