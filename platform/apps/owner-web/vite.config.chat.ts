import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Standalone phone chat PWA at https://offlinegame.az/chat/ */
export default defineConfig({
  plugins: [react()],
  base: '/chat/',
  publicDir: 'public-chat',
  server: {
    port: 5175,
    proxy: {
      '/pos/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'chat',
    emptyOutDir: true,
    rollupOptions: {
      input: 'chat.html',
    },
  },
});
