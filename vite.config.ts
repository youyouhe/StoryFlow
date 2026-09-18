import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    // HTTPS is OPT-IN (VITE_HTTPS=1 → `npm run dev:https`): self-signed cert
    // makes the LAN origin a secure context so the File System Access API
    // (folder asset library) works from other devices. Default stays HTTP —
    // the WebMCP bridge and the localhost dev browser expect it.
    const https = env.VITE_HTTPS === '1' || process.env.VITE_HTTPS === '1';
    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
        strictPort: true,
      },
      plugins: [react(), ...(https ? [basicSsl()] : [])],
      build: {
        // 'assets/' collides with the gallery API route /assets/* when the
        // gallery hosts this SPA — bundle files live under /static/ instead.
        assetsDir: 'static',
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
