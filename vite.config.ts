import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: 5173, strictPort: true, allowedHosts: process.env.QUESTLAYER_DEV_ORIGIN ? [new URL(process.env.QUESTLAYER_DEV_ORIGIN).hostname] : [], proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: mode === 'signing-vault'
    ? { outDir: 'dist/signing-vault', chunkSizeWarningLimit: 1800, rollupOptions: { input: 'signing-vault.html' } }
    : { chunkSizeWarningLimit: 1800 },
}));
