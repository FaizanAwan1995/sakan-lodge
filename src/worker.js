const landingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="SAKAN Lodge helps property managers run a smoother, more transparent accommodation business." />
    <title>SAKAN Lodge | Coming Soon</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/landing.css" />
    <style>
      :root { --bg:#f5efe5; --panel:rgba(255,255,255,0.68); --ink:#1d1d1d; --muted:#5d5d5d; --primary:#1d7ae0; --primary-strong:#155fb1; --border:rgba(17,17,17,0.11); --shadow:0 20px 50px rgba(27,31,35,0.12);} 
      *{box-sizing:border-box;} html{scroll-behavior:smooth;} body{margin:0;min-height:100vh;font-family:"Inter","Segoe UI",sans-serif;background:radial-gradient(circle at top,#fdf9f2 0%,#f5efe5 42%,#efe7dd 100%);color:var(--ink);} .page-shell{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:26px 20px 40px;} .topbar{width:min(1100px,100%);display:flex;justify-content:flex-start;} .brand-wrap{display:inline-flex;align-items:center;gap:12px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,0.38);border:1px solid var(--border);} .brand-mark{position:relative;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,rgba(44,102,201,0.18),rgba(44,102,201,0.04));border:1px solid rgba(31,122,224,0.25);overflow:hidden;transform:rotate(45deg);animation:floatLogo 4s ease-in-out infinite;} .mark-core{position:absolute;inset:7px;border-radius:6px;background:linear-gradient(135deg,#1d7ae0,#6cb0ff);box-shadow:inset -8px -8px 12px rgba(15,65,130,0.15);} .brand-name{font-size:1.05rem;font-weight:700;letter-spacing:-0.04em;} .hero{width:min(900px,100%);margin-top:40px;padding:54px 36px 28px;text-align:center;border:1px solid var(--border);border-radius:28px;background:rgba(255,255,255,0.42);backdrop-filter:blur(10px);box-shadow:var(--shadow);} .badge-row{display:flex;justify-content:center;} .badge{display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(29,122,224,0.08);border:1px solid rgba(29,122,224,0.18);color:var(--primary-strong);text-transform:uppercase;letter-spacing:0.08em;font-size:0.72rem;font-weight:700;} h1{margin:24px auto 16px;max-width:720px;font-size:clamp(2.8rem,5vw,5rem);letter-spacing:-0.07em;line-height:0.98;} .subtitle{margin:0 auto;max-width:610px;color:var(--muted);font-size:1.08rem;line-height:1.7;} .cta-row{margin-top:30px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap;} .primary,.secondary{display:inline-flex;align-items:center;justify-content:center;min-width:160px;padding:14px 22px;border-radius:12px;font-weight:700;text-decoration:none;transition:transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;} .primary{background:linear-gradient(135deg,var(--primary),#4b9cff);color:white;box-shadow:0 14px 26px rgba(29,122,224,0.2);} .secondary{background:rgba(255,255,255,0.35);color:var(--ink);border:1px solid var(--border);} .primary:hover,.secondary:hover{transform:translateY(-2px);} .feature-strip{margin-top:36px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;text-align:left;} .feature-card{padding:20px 18px;border-radius:18px;background:rgba(255,255,255,0.38);border:1px solid var(--border);} .feature-label{display:inline-block;margin-bottom:8px;font-size:0.78rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--primary-strong);} .feature-card strong{display:block;font-size:1.02rem;line-height:1.45;} @keyframes floatLogo {0%,100% { transform:rotate(45deg) translateY(0);} 50% { transform:rotate(45deg) translateY(-2px);} } @media (max-width:760px){ .feature-strip{grid-template-columns:1fr;} }
    </style>
  </head>
  <body>
    <div class="page-shell">
      <header class="topbar">
        <div class="brand-wrap" aria-label="SAKAN Lodge brand">
          <div class="brand-mark">
            <span class="mark-core"></span>
          </div>
          <span class="brand-name">SAKAN Lodge</span>
        </div>
      </header>

      <main class="hero">
        <div class="badge-row">
          <span class="badge">Coming soon</span>
        </div>

        <h1>Smarter property operations,<br />built for calm, consistent hosting.</h1>

        <p class="subtitle">
          A hospitality-first ledger for managing rent, rooms, expenses, repairs, and landlord
          reporting — all in one place.
        </p>

        <div class="cta-row">
          <a class="primary" href="/ledger/">Open Ledger</a>
          <a class="secondary" href="#info">Learn more</a>
        </div>

        <div class="feature-strip" id="info">
          <div class="feature-card">
            <span class="feature-label">Rent</span>
            <strong>Track weekly cycles</strong>
          </div>
          <div class="feature-card">
            <span class="feature-label">Rooms</span>
            <strong>Know occupancy instantly</strong>
          </div>
          <div class="feature-card">
            <span class="feature-label">Reports</span>
            <strong>See what matters fast</strong>
          </div>
        </div>
      </main>
    </div>
  </body>
</html>`;

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
      return new Response(landingHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
        },
      });
    }

    if (pathname === '/ledger' || pathname.startsWith('/ledger/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = normalizeLedgerPath(pathname);

      const assetRequest = new Request(rewritten, request);
      const assetResponse = await env.ASSETS.fetch(assetRequest);
      if (assetResponse.status === 404) {
        return env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), request));
      }
      return assetResponse;
    }

    if (pathname === '/landing.css' || pathname === '/landing.html' || pathname === '/sakan-logo.jpg' || pathname.startsWith('/assets/') || pathname.startsWith('/manifest')) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
