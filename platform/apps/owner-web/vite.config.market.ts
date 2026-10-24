import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * styles.css hardcodes the restaurant portal's font paths (/pos/app/fonts/...).
 * Rewriting them here keeps that file untouched for the /pos/app build while the
 * market bundle still resolves its own copy under public-market/fonts.
 */
function rewriteFontBase(): Plugin {
  return {
    name: 'marketpos-font-base',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
        const css = typeof asset.source === 'string' ? asset.source : asset.source.toString();
        asset.source = css.replaceAll('/pos/app/fonts/', '/marketpos/fonts/');
      }
    },
  };
}

/** Market POS owner panel at https://possistem.az/marketpos/ */
export default defineConfig({
  plugins: [react(), rewriteFontBase()],
  base: '/marketpos/',
  publicDir: 'public-market',
  server: {
    port: 5176,
    proxy: {
      '/pos/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist-market',
    emptyOutDir: true,
    rollupOptions: {
      input: 'market.html',
    },
  },
});
