import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE_PATH || '/ledger/';

// Fail closed: staging must never silently use production or browser-local storage.
if (process.env.SAKAN_ENV === 'staging') {
  const url = (process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key || url.includes('gpohuctqsmmoikupyfvi') || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    throw new Error('Staging build blocked: set an isolated Supabase project URL and public key (never production).');
  }
}
const landingHtml = fs.readFileSync(new URL('./public/landing.html', import.meta.url), 'utf-8');
const appHtml = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf-8');
const viteBase = process.env.NODE_ENV === 'production' ? appBase : '/';

function serveSakanRoutes(req, res, next) {
  if (!req.url) return next();

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(landingHtml);
    return;
  }

  if (pathname === '/ledger' || pathname === '/ledger/' || pathname.startsWith('/ledger/')) {
    const normalized = pathname === '/ledger' || pathname === '/ledger/' ? '/index.html' : pathname.slice('/ledger'.length) || '/index.html';
    const isAssetRequest = normalized.includes('.') || normalized.startsWith('/src/') || normalized.startsWith('/@vite/') || normalized.startsWith('/node_modules/') || normalized.startsWith('/assets/') || normalized.startsWith('/manifest') || normalized.startsWith('/sakan-') || normalized.startsWith('/shared-') || normalized.startsWith('/private-');

    if (isAssetRequest) {
      req.url = normalized;
      return next();
    }

    req.url = '/index.html';
    return next();
  }

  next();
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sakan-root-landing',
      configureServer(server) {
        server.middlewares.use(serveSakanRoutes);
      },
      configurePreviewServer(server) {
        server.middlewares.use(serveSakanRoutes);
      }
    }
  ],
  base: viteBase,
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
