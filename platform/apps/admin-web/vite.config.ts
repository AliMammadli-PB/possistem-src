import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const consoleBase =
    (process.env.VITE_CONSOLE_BASE ?? env.VITE_CONSOLE_BASE)?.trim() || '/m-43dcc89574d90d1b1983a32c/';
  if (!/^\/[a-z0-9][a-z0-9-]{2,80}\/$/i.test(consoleBase)) {
    throw new Error('VITE_CONSOLE_BASE must be a single URL segment with leading/trailing slashes');
  }

  return {
    plugins: [react()],
    base: consoleBase,
    server: {
      port: 5173,
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
  };
});
