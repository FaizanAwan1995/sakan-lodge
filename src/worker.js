function normalizeLedgerPath(pathname) {
  if (pathname === '/ledger' || pathname === '/ledger/') return '/';
  if (pathname.startsWith('/ledger/')) return pathname.slice('/ledger'.length) || '/';
  return pathname;
}

async function fetchFromAssets(env, request, assetPath) {
  try {
    return await env.ASSETS.fetch(new Request(new URL(assetPath, request.url).toString(), request));
  } catch {
    return null;
  }
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/landing.html') {
      const response = await fetchFromAssets(env, request, '/landing.html');
      if (response && response.status !== 404) {
        return new Response(await response.text(), {
          status: response.status,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      return new Response('<!doctype html><html><head><meta charset="utf-8"><title>SAKAN Lodge</title></head><body style="margin:0;background:#f3efe6;color:#1b1a17;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh;"><main style="text-align:center;padding:2rem"><h1 style="font-size:2.5rem;letter-spacing:-0.05em;margin:0 0 1rem;">SAKAN Lodge</h1><p style="margin:0;color:#58534d;">The landing page is loading.</p></main></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (pathname === '/landing.css') {
      const response = await fetchFromAssets(env, request, '/landing.css');
      if (response && response.status !== 404) {
        return new Response(await response.text(), {
          status: response.status,
          headers: {
            'content-type': 'text/css; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }
      return new Response('', { status: 204, headers: { 'content-type': 'text/css; charset=utf-8' } });
    }

    if (pathname === '/ledger' || pathname.startsWith('/ledger/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = normalizeLedgerPath(pathname);

      const assetResponse = await env.ASSETS.fetch(new Request(rewritten, request));
      if (assetResponse.status === 404) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }
      return assetResponse;
    }

    if (
      pathname === '/favicon.ico' ||
      pathname === '/sakan-logo.jpg' ||
      pathname === '/sakan-logo-circle-main.png' ||
      pathname === '/sakan-logo-circle-trimmed.svg' ||
      pathname === '/sakan-logo-cropped.png' ||
      pathname === '/sakan-logo-trimmed.svg' ||
      pathname === '/shared-room-1.png' ||
      pathname === '/private-room-1.png' ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/manifest') ||
      pathname === '/icon.svg' ||
      pathname.startsWith('/sakan-') ||
      pathname.startsWith('/shared-') ||
      pathname.startsWith('/private-')
    ) {
      return env.ASSETS.fetch(request);
    }

    if (pathname.includes('.')) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
}

export default {
  async fetch(request, env) {
    const response = await handleRequest(request, env);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (new URL(request.url).protocol === 'https:') {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
