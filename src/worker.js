const landingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="SAKAN Lodge offers calm, well-managed rooming and subletting spaces built for comfortable living."
    />
    <title>SAKAN Lodge | Rooming & Subletting</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #f3efe6;
        --bg-strong: #e7dcc0;
        --paper: #fffdf9;
        --ink: #1b1a17;
        --muted: #58534d;
        --forest: #2f524d;
        --forest-soft: #edf4f1;
        --gold: #d4ad5f;
        --gold-deep: #b98b3a;
        --line: rgba(47, 82, 77, 0.12);
        --shadow: 0 22px 52px rgba(46, 41, 32, 0.1);
      }

      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Inter", "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f8f4ee 0%, var(--bg) 38%, var(--bg-strong) 100%);
        color: var(--ink);
      }
      img { max-width: 100%; display: block; }
      .page-shell {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 20px 18px 48px;
      }
      .topbar {
        width: min(1100px, 100%);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
      }
      .brand-wrap {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 8px 14px 8px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.54);
        border: 1px solid var(--line);
        box-shadow: 0 8px 20px rgba(36, 32, 27, 0.05);
      }
      .brand-image {
        width: 54px;
        height: 54px;
        object-fit: cover;
        border-radius: 50%;
        box-shadow: 0 8px 18px rgba(185, 139, 58, 0.2);
      }
      .brand-name {
        font-size: 1.08rem;
        font-weight: 800;
        letter-spacing: -0.05em;
        color: var(--ink);
      }
      .top-links {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .top-links a {
        color: var(--ink);
        text-decoration: none;
        font-weight: 700;
        font-size: 0.95rem;
        padding: 10px 16px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.32);
        transition: background 0.18s ease, transform 0.18s ease;
      }
      .top-links a:hover {
        background: rgba(212, 173, 95, 0.12);
        transform: translateY(-1px);
      }
      .hero {
        width: min(980px, 100%);
        margin-top: 36px;
        padding: 44px 24px 28px;
        text-align: center;
        border: 1px solid var(--line);
        border-radius: 30px;
        background: rgba(255, 255, 255, 0.38);
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow);
      }
      .badge-row { display: flex; justify-content: center; }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 18px;
        border-radius: 999px;
        background: rgba(212, 173, 95, 0.12);
        border: 1px solid rgba(185, 139, 58, 0.22);
        color: var(--gold-deep);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.72rem;
        font-weight: 800;
      }
      h1 {
        margin: 24px auto 18px;
        max-width: 820px;
        font-size: clamp(3rem, 5vw, 6rem);
        letter-spacing: -0.08em;
        line-height: 0.9;
        font-weight: 800;
      }
      .subtitle {
        max-width: 700px;
        margin: 0 auto;
        color: var(--muted);
        font-size: 1.12rem;
        line-height: 1.7;
      }
      .cta-row {
        margin-top: 30px;
        display: flex;
        justify-content: center;
        gap: 18px;
        flex-wrap: wrap;
      }
      .primary,
      .secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 180px;
        padding: 16px 28px;
        border-radius: 14px;
        text-decoration: none;
        font-weight: 700;
        transition: transform 0.18s ease, box-shadow 0.18s ease;
      }
      .primary {
        background: linear-gradient(135deg, var(--gold) 0%, var(--gold-deep) 100%);
        color: #201d19;
        box-shadow: 0 12px 22px rgba(185, 139, 58, 0.18);
      }
      .secondary {
        background: rgba(255, 255, 255, 0.4);
        border: 1px solid var(--line);
        color: var(--forest);
      }
      .primary:hover,
      .secondary:hover { transform: translateY(-2px); }
      .info-grid {
        margin-top: 42px;
        display: grid;
        grid-template-columns: 1.3fr 1fr 1fr;
        gap: 18px;
        text-align: left;
      }
      .feature-card {
        padding: 20px 18px;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.34);
      }
      .feature-spotlight {
        background: linear-gradient(135deg, rgba(212, 173, 95, 0.12), rgba(47, 82, 77, 0.04));
      }
      .eyebrow {
        display: inline-block;
        margin-bottom: 10px;
        color: var(--gold-deep);
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 800;
      }
      .feature-card h2 {
        margin: 0 0 10px;
        font-size: clamp(1.4rem, 2vw, 2.1rem);
        letter-spacing: -0.06em;
        line-height: 1.08;
        color: var(--forest);
      }
      .feature-card p,
      .feature-card li {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      .feature-card ul {
        margin: 0;
        padding-left: 1.1rem;
      }
      @media (max-width: 760px) {
        .topbar { flex-direction: column; align-items: flex-start; }
        .info-grid { grid-template-columns: 1fr; }
        .hero { padding: 32px 18px 24px; }
      }
    </style>
  </head>
  <body>
    <div class="page-shell">
      <header class="topbar">
        <div class="brand-wrap" aria-label="SAKAN Lodge brand">
          <img class="brand-image" src="/sakan-logo.jpg" alt="SAKAN Lodge logo" />
          <span class="brand-name">SAKAN Lodge</span>
        </div>

        <nav class="top-links" aria-label="Main navigation">
          <a href="#discover">Explore</a>
          <a href="/ledger/">Ledger</a>
        </nav>
      </header>

      <main class="hero" id="discover">
        <div class="badge-row">
          <span class="badge">Hospitality in its true sense</span>
        </div>

        <h1>Warm homes. Honest living. Better stays.</h1>

        <p class="subtitle">
          SAKAN Lodge offers thoughtfully managed rooms and shared living spaces designed for comfort,
          clarity, and a more welcoming everyday experience.
        </p>

        <div class="cta-row">
          <a class="primary" href="#discover">Explore rooms</a>
          <a class="secondary" href="/ledger/">Open ledger</a>
        </div>

        <div class="info-grid">
          <article class="feature-card feature-spotlight">
            <span class="eyebrow">For residents</span>
            <h2>Comfort that feels personal, not transactional.</h2>
            <p>Thoughtful spaces, simple arrangements, and a settled rhythm that helps you feel at home from day one.</p>
          </article>

          <article class="feature-card">
            <span class="eyebrow">What we offer</span>
            <ul>
              <li>Well-managed shared living</li>
              <li>Clear, respectful rooming terms</li>
              <li>Friendly support whenever needed</li>
            </ul>
          </article>

          <article class="feature-card">
            <span class="eyebrow">Why guests choose us</span>
            <ul>
              <li>Comfortable, reliable homes</li>
              <li>Simple communication</li>
              <li>Calm, dignified everyday living</li>
            </ul>
          </article>
        </div>
      </main>
    </div>
  </body>
</html>`;

const landingCss = `:root {
  --bg: #f3efe6;
  --bg-strong: #e7dcc0;
  --paper: #fffdf9;
  --ink: #1b1a17;
  --muted: #58534d;
  --forest: #2f524d;
  --forest-soft: #edf4f1;
  --gold: #d4ad5f;
  --gold-deep: #b98b3a;
  --line: rgba(47, 82, 77, 0.12);
  --shadow: 0 22px 52px rgba(46, 41, 32, 0.1);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: "Inter", "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #f8f4ee 0%, var(--bg) 38%, var(--bg-strong) 100%);
  color: var(--ink);
}
img { max-width: 100%; display: block; }
.page-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 18px 48px;
}
.topbar {
  width: min(1100px, 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.brand-wrap {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px 8px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.54);
  border: 1px solid var(--line);
  box-shadow: 0 8px 20px rgba(36, 32, 27, 0.05);
}
.brand-image {
  width: 54px;
  height: 54px;
  object-fit: cover;
  border-radius: 50%;
  box-shadow: 0 8px 18px rgba(185, 139, 58, 0.2);
}
.brand-name {
  font-size: 1.08rem;
  font-weight: 800;
  letter-spacing: -0.05em;
  color: var(--ink);
}
.top-links {
  display: flex;
  align-items: center;
  gap: 12px;
}
.top-links a {
  color: var(--ink);
  text-decoration: none;
  font-weight: 700;
  font-size: 0.95rem;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.32);
  transition: background 0.18s ease, transform 0.18s ease;
}
.top-links a:hover {
  background: rgba(212, 173, 95, 0.12);
  transform: translateY(-1px);
}
.hero {
  width: min(980px, 100%);
  margin-top: 36px;
  padding: 44px 24px 28px;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.38);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
}
.badge-row { display: flex; justify-content: center; }
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(212, 173, 95, 0.12);
  border: 1px solid rgba(185, 139, 58, 0.22);
  color: var(--gold-deep);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.72rem;
  font-weight: 800;
}
h1 {
  margin: 24px auto 18px;
  max-width: 820px;
  font-size: clamp(3rem, 5vw, 6rem);
  letter-spacing: -0.08em;
  line-height: 0.9;
  font-weight: 800;
}
.subtitle {
  max-width: 700px;
  margin: 0 auto;
  color: var(--muted);
  font-size: 1.12rem;
  line-height: 1.7;
}
.cta-row {
  margin-top: 30px;
  display: flex;
  justify-content: center;
  gap: 18px;
  flex-wrap: wrap;
}
.primary,
.secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  padding: 16px 28px;
  border-radius: 14px;
  text-decoration: none;
  font-weight: 700;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.primary {
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-deep) 100%);
  color: #201d19;
  box-shadow: 0 12px 22px rgba(185, 139, 58, 0.18);
}
.secondary {
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid var(--line);
  color: var(--forest);
}
.primary:hover,
.secondary:hover { transform: translateY(-2px); }
.info-grid {
  margin-top: 42px;
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 18px;
  text-align: left;
}
.feature-card {
  padding: 20px 18px;
  border-radius: 22px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.34);
}
.feature-spotlight {
  background: linear-gradient(135deg, rgba(212, 173, 95, 0.12), rgba(47, 82, 77, 0.04));
}
.eyebrow {
  display: inline-block;
  margin-bottom: 10px;
  color: var(--gold-deep);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 800;
}
.feature-card h2 {
  margin: 0 0 10px;
  font-size: clamp(1.4rem, 2vw, 2.1rem);
  letter-spacing: -0.06em;
  line-height: 1.08;
  color: var(--forest);
}
.feature-card p,
.feature-card li {
  margin: 0;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.65;
}
.feature-card ul {
  margin: 0;
  padding-left: 1.1rem;
}
@media (max-width: 760px) {
  .topbar { flex-direction: column; align-items: flex-start; }
  .info-grid { grid-template-columns: 1fr; }
  .hero { padding: 32px 18px 24px; }
}`;

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

    if (pathname === '/landing.css') {
      return new Response(landingCss, {
        headers: {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'no-cache',
        },
      });
    }

    if (pathname === '/landing.html') {
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
