function normalizeLedgerPath(pathname) {
  if (pathname === '/ledger' || pathname === '/ledger/') return '/';
  if (pathname.startsWith('/ledger/')) return pathname.slice('/ledger'.length) || '/';
  return pathname;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/landing.html') {
      const landingHtml = await env.ASSETS.fetch(new Request(new URL('/landing.html', request.url), request));
      return new Response(await landingHtml.text(), {
        status: landingHtml.status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    if (pathname === '/landing.css') {
      const landingCss = await env.ASSETS.fetch(new Request(new URL('/landing.css', request.url), request));
      return new Response(await landingCss.text(), {
        status: landingCss.status,
        headers: {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'no-store',
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
      pathname === '/sakan-logo.jpg' ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/manifest') ||
      pathname === '/icon.svg'
    ) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
