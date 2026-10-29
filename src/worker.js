import {publicMapProperties} from './public-map-config.js';
import { rentInvoiceApi, processRentInvoices } from './rent-invoice-api.js';
import { reviewsApi, reviewsEnabled } from './reviews-api.js';
import { renderReviewSection } from './reviews.js';
import { databaseRpc } from './public-site.js';
import { bookingContractApi } from './booking-contract-api.js';
export { GmailOAuthState } from './gmail-oauth-state.js';
import { gmailCallback, gmailStart } from './gmail-oauth-callback.js';
import { gmailSend } from './gmail-send.js';
import {reservationEmail} from './reservation-email.js';
import {handlePublicSite} from './public-site.js';

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

    // Keep the conventional favicon URL usable for browsers and crawlers.
    if(pathname==='/favicon.ico') return Response.redirect(new URL('/sakan-logo-circle-main.png', url).href,301);

    if(pathname==='/api/rent-invoices/pdf'||pathname==='/api/rent-invoices/preview')return rentInvoiceApi(request,env);
    if(pathname==='/api/public/maps-config') {
      if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{allow:'GET'}});
      // This deliberately publishes only the website-restricted browser key.
      // Never substitute any server, Gmail, Supabase or unrestricted key here.
      const key=String(env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
      return Response.json({key:/^AIza[\w-]{30,50}$/.test(key)?key:null,properties:publicMapProperties(env.PUBLIC_PROPERTY_MAP_POINTS)},{headers:{'cache-control':'no-store'}});
    }
    if(pathname==='/api/reviews')return reviewsApi(request,env);
    if(pathname==='/api/reservations/contract-pdf')return bookingContractApi(request,env);
    if(pathname==='/api/reservations/email')return reservationEmail(request,env);
    const publicResponse=await handlePublicSite(request,env);
    if(publicResponse)return publicResponse;

    if (pathname === '/api/gmail/start') return gmailStart(request, env);
    if (pathname === '/api/gmail/callback') return gmailCallback(request, env);
    if (pathname === '/api/gmail/preview' || pathname === '/api/gmail/send') return gmailSend(request, env);

    if(pathname==='/landing.html')return Response.redirect(new URL('/'+url.search,url.origin),301);
    if (pathname === '/') {
      const response = await fetchFromAssets(env, request, '/landing.html');
      if (response && response.status !== 404) {
        let reviews = [], reviewsUnavailable = false;
        try { reviews = await databaseRpc(env, 'published_testimonials'); } catch { reviewsUnavailable = true; }
        const page = (await response.text()).replace('<!--SAKAN_REVIEWS-->', renderReviewSection(Array.isArray(reviews) ? reviews : [], { siteKey: env.TURNSTILE_SITE_KEY, enabled: reviewsEnabled(env), unavailable: reviewsUnavailable }));
        return new Response(page, {
          status: response.status,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      return new Response('<!doctype html><html><head><meta charset="utf-8"><title>SAKAN Lodge</title></head><body style="margin:0;background:#f3efe6;color:#1b1a17;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh;"><main style="text-align:center;padding:2rem"><h1 style="font-size:2.5rem;letter-spacing:-0.05em;margin:0 0 1rem;">SAKAN Lodge</h1><p style="margin:0;color:#58534d;">The landing page is loading.</p></main></body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after':'300', 'cache-control':'no-store' },
      });
    }

    if (pathname === '/privacy' || pathname === '/privacy/' || pathname === '/terms' || pathname === '/terms/') {
      const page = pathname.startsWith('/privacy') ? '/privacy.html' : '/terms.html';
      const response = await fetchFromAssets(env, request, page);
      if (response && response.status === 200) {
        return new Response(response.body, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
        });
      }
      return new Response('Page unavailable', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
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
  async scheduled(controller,env,ctx){ctx.waitUntil(processRentInvoices(env).catch(()=>{console.error('Invoice queue processing unavailable; recorded payments remain saved.');}));},
  async fetch(request, env) {
    let response;
    try { response = await handleRequest(request, env); } catch { response = new Response('Service temporarily unavailable', {status:503,headers:{'cache-control':'no-store'}}); }
    const headers = new Headers(response.headers);
    if (new URL(request.url).pathname.startsWith('/ledger') || new URL(request.url).pathname.startsWith('/api/')) headers.set('X-Robots-Tag','noindex, nofollow');
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
