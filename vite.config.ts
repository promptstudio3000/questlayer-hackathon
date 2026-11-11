import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const FIRST_SCREEN_SHARED =
  /\/src\/(art-world|quest-route|activity-view|Ghost|game-object-art|level-table|qgold-burn|player-key|map-kit|dir-icons)\.|@phosphor-icons\/react\/dist\/(lib\/IconBase|csr\/(ArrowLeft|ArrowRight|X|Lock))\./;
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: 5173, strictPort: true, allowedHosts: process.env.QUESTLAYER_DEV_ORIGIN ? [new URL(process.env.QUESTLAYER_DEV_ORIGIN).hostname] : [], proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: mode === 'signing-vault'
    ? { outDir: 'dist/signing-vault', chunkSizeWarningLimit: 1800, rollupOptions: { input: 'signing-vault.html' } }
    : {
        chunkSizeWarningLimit: 1800,
        rolldownOptions: {
          output: {
            codeSplitting: {
              // The first screen imports these small modules, and lazy screens
              // import them too. Rolldown would give each its own file, which
              // added 16 requests to the phone's first load. Keep them in one
              // shared chunk instead (first-session e2e budget: 30 requests).
              groups: [{ name: 'first-screen-shared', test: FIRST_SCREEN_SHARED }],
            },
          },
        },
      },
}));
