import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE_PATH || '/ledger/';

// Staging is deliberately browser-local only. No production Supabase credentials
// may be included in a staging bundle. OAuth and shared-data tests are excluded.
if (process.env.SAKAN_ENV === 'staging') {
  if (process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('Demo staging build blocked: remove all Supabase credentials.');
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
