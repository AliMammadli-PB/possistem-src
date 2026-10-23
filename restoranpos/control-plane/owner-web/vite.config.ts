import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/pos/app/',
  server: {
    port: 5174,
    proxy: {
      '/pos/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4174,
    proxy: {
      '/pos/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
