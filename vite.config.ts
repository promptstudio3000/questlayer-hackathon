import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const FIRST_SCREEN_SHARED =
  /\/src\/(art-world|quest-route|activity-view|Ghost|game-object-art|level-table|qgold-burn|player-key|map-kit|dir-icons)\.|@phosphor-icons\/react\/dist\/(lib\/IconBase|csr\/(ArrowLeft|ArrowRight|X|Lock))\./;
// Test Layer build (docs/TEST-LAYER.md): VITE_QL_LAYER=test pins the bundle to
// the Test Layer's own contract set, so every import of a
// public/native-*-testnet.json manifest resolves to its -testlayer twin.
const TEST_LAYER_BUILD = process.env.VITE_QL_LAYER === 'test';
const testLayerManifests = {
  name: 'questlayer-test-layer-manifests',
  enforce: 'pre' as const,
  async resolveId(source: string, importer: string | undefined) {
    if (!TEST_LAYER_BUILD || !/public\/[a-z0-9-]+-testnet\.json$/.test(source)) return null;
    const resolved = await (this as any).resolve(source.replace(/-testnet\.json$/, '-testlayer.json'), importer, { skipSelf: true });
    if (!resolved) throw new Error(`Test Layer build: ${source.replace(/-testnet\.json$/, '-testlayer.json')} is missing (run scripts/deploy-testlayer.mjs).`);
    return resolved;
  },
};
export default defineConfig(({ mode }) => ({
  plugins: [testLayerManifests, react()],
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
