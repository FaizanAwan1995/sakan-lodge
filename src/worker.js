function normalizeLedgerPath(pathname) {
  if (pathname === '/ledger' || pathname === '/ledger/') return '/';
  if (pathname.startsWith('/ledger/')) return pathname.slice('/ledger'.length) || '/';
  return pathname;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/') {
      const landingPage = await env.ASSETS.fetch(new Request(new URL('/landing.html', url), request));
      return new Response(landingPage.body, {
        status: landingPage.status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
        },
      });
    }

    if (pathname === '/ledger' || pathname.startsWith('/ledger/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = normalizeLedgerPath(pathname);

      const assetResponse = await env.ASSETS.fetch(new Request(rewritten, request));
      if (assetResponse.status === 404) {
        return env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), request));
      }
      return assetResponse;
    }

    if (
      pathname === '/landing.css' ||
      pathname === '/landing.html' ||
      pathname === '/sakan-logo.jpg' ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/manifest')
    ) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
