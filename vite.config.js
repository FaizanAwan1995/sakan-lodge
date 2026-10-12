import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE_PATH || '/ledger/';

export default defineConfig({
  plugins: [react()],
  base: appBase,
});
