import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offlineBrand } from '../brands/offline/brand.mjs';

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [offlineBrand({ appRoot: resolve(__dirname) }), react()],
  server: { port: 5192, strictPort: true },
  build: {
    outDir: resolve(__dirname, process.env.VITE_BRAND === 'offline' ? 'dist-offline' : 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
  },
});
