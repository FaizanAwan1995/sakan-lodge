import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE_PATH || '/ledger/';
const landingHtml = fs.readFileSync(new URL('./public/landing.html', import.meta.url), 'utf-8');

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
