import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const r = (...p: string[]): string => resolve(__dirname, ...p);

const RENDERER_ROOT = r('apps/desktop/src/renderer');

function customerProfile(): Record<string, unknown> {
  const file = process.env.POS_CUSTOMER_PROFILE_PATH?.trim();
  if (!file || !existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Invalid POS_CUSTOMER_PROFILE_PATH JSON: ${file}`);
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('shared'), '@main': r('apps/desktop/src/main') },
    },
    build: {
      outDir: 'out/main',
      // CJS is mandatory: the sandboxed preload and the main process both load
      // through Electron's CommonJS loader.
      lib: { entry: r('apps/desktop/src/main/index.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: 'index.js' } },
      minify: !process.env.ELECTRON_VITE_DEV,
      sourcemap: process.env.ELECTRON_VITE_DEV ? true : false,
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('shared') },
    },
    build: {
      outDir: 'out/preload',
      lib: { entry: r('apps/desktop/src/preload/index.ts'), formats: ['cjs'] },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
          // Under `sandbox: true` a preload cannot require a sibling chunk, so
          // everything must land in one file. Without this the bridge silently
          // fails and window.pos is undefined.
          inlineDynamicImports: true,
        },
      },
      minify: false,
      sourcemap: process.env.ELECTRON_VITE_DEV ? 'inline' : false,
    },
  },

  renderer: {
    root: RENDERER_ROOT,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': RENDERER_ROOT,
        '@shared': r('shared'),
      },
    },
    define: {
      __POS_CUSTOMER_PROFILE__: JSON.stringify(customerProfile()),
    },
    build: {
      outDir: r('out/renderer'),
      emptyOutDir: true,
      // Electron 43 ships Chromium 140; no need to down-level for browsers we
      // will never run in.
      target: 'chrome140',
      rollupOptions: {
        input: { index: resolve(RENDERER_ROOT, 'index.html') },
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            motion: ['framer-motion'],
          },
        },
      },
      chunkSizeWarningLimit: 900,
    },
    server: { port: 5173, strictPort: true },
  },
});
