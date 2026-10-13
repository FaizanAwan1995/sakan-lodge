import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE_PATH || '/ledger/';
const landingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="SAKAN Lodge offers calm, well-managed rooming and subletting spaces built for comfortable living." />
    <title>SAKAN Lodge | Rooming & Subletting</title>
    <style>
      :root {
        --bg: #efe2c6;
        --bg-soft: #f5ecdc;
        --gold: #c99638;
        --gold-soft: #e8cf95;
        --gold-deep: #a6731b;
        --stone: #ddd0af;
        --panel-dark: #342f2b;
        --ink: #211d18;
        --muted: #534d48;
        --line: rgba(114,87,32,0.23);
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; font-family: Inter, Arial, sans-serif; background: var(--bg); color: var(--ink); }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        overflow: hidden;
        background: var(--bg);
      }
      .wrap {
        position: relative;
        width: min(1180px, calc(100vw - 32px));
        padding: 36px 28px 28px;
        border-radius: 28px;
        border: 1px solid rgba(110,89,40,0.12);
        background: rgba(255,255,255,0.12);
        box-shadow: 0 18px 36px rgba(33,30,25,0.06);
        animation: floatIn 0.9s ease-out both;
      }
      .layout {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 1.35fr 0.95fr;
        gap: 28px;
        align-items: center;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        border-radius: 999px;
        background: rgba(201,150,56,0.22);
        border: 1px solid rgba(118,89,31,0.18);
        color: #7b5418;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .brand-logo {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        object-fit: cover;
        box-shadow: 0 0 0 1px rgba(123,84,24,0.18);
        flex-shrink: 0;
      }
      .brand-mark {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--gold);
      }
      .hero-shell {
        display: grid;
        grid-template-columns: 1fr;
        gap: 18px;
        align-items: center;
      }
      .hero-brand-card {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
        padding: 0;
        border-radius: 50%;
        background: transparent;
        border: none;
      }
      .hero-logo-wrap {
        margin: 0;
        width: 100%;
        display: flex;
        justify-content: center;
        padding: 0;
      }
      .hero-logo {
        display: block;
        width: min(760px, 100%);
        max-width: 100%;
        height: auto;
        border-radius: 50%;
        filter: drop-shadow(0 12px 18px rgba(58,42,12,0.06));
      }
      .hero-copy {
        display: grid;
        gap: 12px;
        text-align: center;
      }
      .eyebrow {
        display: inline-block;
        color: #8a6723;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .hero-title {
        margin: 0;
        font-size: clamp(2.2rem, 4vw, 3.6rem);
        line-height: 0.95;
        letter-spacing: -0.08em;
        color: #1f1b17;
        max-width: 620px;
        margin-inline: auto;
      }
      .subtitle {
        max-width: 560px;
        margin: 0 auto;
        font-size: clamp(1.05rem, 2vw, 1.38rem);
        line-height: 1.6;
        color: #3d3834;
        font-weight: 500;
      }
      .stack {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 6px;
      }
      .pill {
        display: inline-block;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(201,150,56,0.12);
        border: 1px solid rgba(118,89,31,0.18);
        color: #6a4a16;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .teaser-wrap {
        display: grid;
        grid-template-columns: 1.15fr 1fr;
        gap: 20px;
        margin-top: 30px;
      }
      .teaser-card {
        position: relative;
        min-height: 350px;
        border-radius: 24px;
        overflow: hidden;
        border: 1px solid rgba(117,98,55,0.1);
        background-color: #ddd3c5;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }
      .teaser-card:nth-child(1) {
        background-image: url('/ledger/shared-room-1.png');
      }
      .teaser-card:nth-child(2) {
        background-image: url('/ledger/private-room-1.png');
      }
      .teaser-card::after {
        content: "";
        position: absolute;
        inset: 0;
        background: rgba(17,14,11,0.18);
      }
      .teaser-copy {
        position: absolute;
        inset: auto 18px 18px 18px;
        z-index: 1;
        color: #fff;
      }
      .teaser-copy strong {
        display: block;
        font-size: 1.3rem;
        font-weight: 800;
        letter-spacing: -0.04em;
      }
      .teaser-copy span {
        display: inline-block;
        margin-top: 6px;
        font-size: 0.78rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        opacity: 0.9;
      }
      .panel {
        position: relative;
        min-height: 500px;
        padding: 28px 22px;
        border-radius: 26px;
        background: var(--panel-dark);
        overflow: hidden;
        border: 1px solid rgba(201,150,56,0.28);
      }
      .panel::before {
        content: "";
        position: absolute;
        inset: 0;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .panel-inner {
        position: relative;
        z-index: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .panel-card {
        display: grid;
        gap: 14px;
        padding: 18px 18px 16px;
        border-radius: 20px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.09);
      }
      .panel-tag {
        display: inline-block;
        width: fit-content;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(201,150,56,0.18);
        color: var(--gold-soft);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .panel h2 {
        margin: 0;
        font-size: clamp(2.1rem, 4vw, 3.4rem);
        line-height: 0.9;
        letter-spacing: -0.08em;
        color: #f4efe9;
      }
      .mini-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .mini {
        min-height: 86px;
        padding: 14px 10px;
        border-radius: 16px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.09);
        display: flex;
        align-items: end;
        color: #f3efe9;
        font-weight: 700;
        font-size: 0.76rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .mini:nth-child(2) { background: rgba(201,150,56,0.18); }
      @keyframes floatIn {
        0% { opacity: 0; transform: translateY(18px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @media (max-width: 760px) {
        body { overflow: auto; }
        .wrap { padding: 20px 18px; }
        .layout { grid-template-columns: 1fr; }
        .panel { min-height: 300px; }
        .mini-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="layout">
        <div class="hero-shell">
          <div class="hero-brand-card">
            <div class="hero-logo-wrap">
              <img class="hero-logo" src="/ledger/sakan-logo-circle-main.png" alt="SAKAN Lodge logo" />
            </div>
          </div>
          <div class="hero-copy">
            <span class="eyebrow">Launching soon</span>
            <h1 class="hero-title">A better way to live, closer to the city.</h1>
            <p class="subtitle">A new digital experience is almost here — with furnished rooms, private spaces, shared living, and premium homes designed for students, professionals, and couples.</p>
            <div class="stack">
              <span class="pill">Launch soon</span>
              <span class="pill">Furnished rooms</span>
              <span class="pill">City-close living</span>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-inner">
            <div class="panel-card">
              <div class="panel-tag">Trailer</div>
              <h2>Stay close.<br />Stay comfortable.</h2>
            </div>
            <div class="teaser-wrap">
              <div class="teaser-card">
                <div class="teaser-copy"><strong>Shared room</strong><span>Furnished rooms</span></div>
              </div>
              <div class="teaser-card">
                <div class="teaser-copy"><strong>Private room</strong><span>Close to city</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sakan-root-landing',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next();

          const url = new URL(req.url, 'http://localhost');
          const pathname = url.pathname;

          if (pathname === '/' || pathname === '/index.html') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(landingHtml);
            return;
          }

          if (pathname === '/ledger' || pathname === '/ledger/') {
            req.url = '/';
          }

          next();
        });
      }
    }
  ],
  base: appBase,
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
