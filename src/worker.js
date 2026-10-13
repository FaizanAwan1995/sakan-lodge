const landingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="SAKAN Lodge offers calm, well-managed rooming and subletting spaces built for comfortable living." />
    <title>SAKAN Lodge | Rooming & Subletting</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/landing.css" />
    <style>
      :root { --bg:#f5e9cb; --bg-strong:#e8c46b; --paper:#fffaf3; --ink:#1b1a17; --muted:#4f453d; --forest:#2d4b43; --forest-soft:#f6f0e3; --gold:#d7aa57; --gold-deep:#9b6b2b; --line:rgba(45,75,67,0.16); --shadow:0 18px 36px rgba(49,39,26,0.08);} 
      *{box-sizing:border-box;} html{scroll-behavior:smooth;} body{margin:0;min-height:100vh;font-family:"Inter","Segoe UI",sans-serif;background:var(--bg);color:var(--ink);} .page-shell{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px 18px 48px;} .topbar{width:min(1100px,100%);display:flex;align-items:center;justify-content:space-between;gap:18px;} .brand-wrap{display:inline-flex;align-items:center;gap:12px;padding:8px 14px 8px 10px;border-radius:999px;background:rgba(255,255,255,0.6);border:1px solid var(--line);box-shadow:0 8px 20px rgba(36,32,27,0.04);} .brand-image{width:54px;height:54px;object-fit:cover;border-radius:50%;box-shadow:0 8px 18px rgba(185,139,58,0.2);} .brand-name{font-size:1.08rem;font-weight:800;letter-spacing:-0.05em;color:var(--forest);} .top-links{display:flex;align-items:center;gap:12px;} .top-links a{color:var(--forest);text-decoration:none;font-weight:700;font-size:0.95rem;padding:10px 16px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,0.28);transition:background 0.18s ease, transform 0.18s ease;} .top-links a:hover{background:rgba(215,170,87,0.12);transform:translateY(-1px);} .hero{width:min(980px,100%);margin-top:36px;padding:44px 24px 28px;text-align:center;border:1px solid var(--line);border-radius:30px;background:rgba(255,255,255,0.46);backdrop-filter:blur(10px);box-shadow:var(--shadow);} .badge-row{display:flex;justify-content:center;} .badge{display:inline-flex;align-items:center;justify-content:center;padding:8px 18px;border-radius:999px;background:rgba(215,170,87,0.14);border:1px solid rgba(155,107,43,0.22);color:var(--forest);text-transform:uppercase;letter-spacing:0.08em;font-size:0.72rem;font-weight:800;} h1{margin:24px auto 18px;max-width:820px;font-size:clamp(3rem,5vw,6rem);letter-spacing:-0.08em;line-height:0.9;font-weight:800;color:var(--forest);} .subtitle{max-width:700px;margin:0 auto;color:var(--muted);font-size:1.12rem;line-height:1.7;} .cta-row{margin-top:30px;display:flex;justify-content:center;gap:18px;flex-wrap:wrap;} .primary,.secondary{display:inline-flex;align-items:center;justify-content:center;min-width:180px;padding:16px 28px;border-radius:14px;text-decoration:none;font-weight:700;transition:transform 0.18s ease, box-shadow 0.18s ease;} .primary{background:var(--gold);color:var(--forest);box-shadow:0 12px 22px rgba(155,107,43,0.14);} .secondary{background:rgba(255,255,255,0.4);border:1px solid var(--line);color:var(--forest);} .primary:hover,.secondary:hover{transform:translateY(-2px);} .info-grid{margin-top:42px;display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:18px;text-align:left;} .feature-card{padding:20px 18px;border-radius:22px;border:1px solid var(--line);background:rgba(255,255,255,0.48);} .feature-spotlight{background:rgba(215,170,87,0.1);} .eyebrow{display:inline-block;margin-bottom:10px;color:var(--forest);font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;font-weight:800;} .feature-card h2{margin:0 0 10px;font-size:clamp(1.4rem,2vw,2.1rem);letter-spacing:-0.06em;line-height:1.08;color:var(--forest);} .feature-card p,.feature-card li{margin:0;color:var(--muted);font-size:1rem;line-height:1.65;} .feature-card ul{margin:0;padding-left:1.1rem;} @media (max-width:760px){.topbar{flex-direction:column;align-items:flex-start;}.info-grid{grid-template-columns:1fr;}.hero{padding:32px 18px 24px;}}";` @keyframes floatLogo {0%,100% { transform:rotate(45deg) translateY(0);} 50% { transform:rotate(45deg) translateY(-2px);} } @media (max-width:760px){ .feature-strip{grid-template-columns:1fr;} }
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
