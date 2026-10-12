import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE_PATH || '/ledger/';

export default defineConfig({
  plugins: [react()],
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
