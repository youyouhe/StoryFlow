import path from 'path';
import { appendFileSync, mkdirSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/** Dev-only middleware: POST /api/debug-log → append to a local file.
 *  The frontend fires-and-forgets AI call logs here so the developer can
 *  read errors without DevTools on the user's device. */
// Browser → same-origin /minimax-api/* → dev machine → api.minimaxi.com.
// Some client devices cannot reach the MiniMax international domain directly
// (evening-grade flakiness observed 2026-09-19: 'Failed to fetch' from the
// user's browser while the dev machine itself connected fine). Proxying
// removes CORS + client-route from the equation entirely.
const minimaxProxy = {
  '/minimax-api': {
    target: 'https://api.minimaxi.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/minimax-api/, ''),
    secure: true,
  },
};

const debugLogPlugin = () => ({
  name: 'debug-log',
  configureServer(server: import('vite').ViteDevServer) {
    const logDir = '/tmp/storyflow-dev';
    try { mkdirSync(logDir, { recursive: true }); } catch {}
    server.middlewares.use('/api/debug-log', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const entry = JSON.parse(body);
          const line = JSON.stringify({ ...entry, receivedAt: new Date().toISOString() }) + '\n';
          appendFileSync(`${logDir}/debug.log`, line);
        } catch { /* ignore malformed */ }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
      });
    });
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    // HTTPS is OPT-IN (VITE_HTTPS=1 → `npm run dev:https`): self-signed cert
    // makes the LAN origin a secure context so the File System Access API
    // (folder asset library) works from other devices. Default stays HTTP —
    // the WebMCP bridge and the localhost dev browser expect it.
    const https = env.VITE_HTTPS === '1' || process.env.VITE_HTTPS === '1';
    return {
      server: {
      proxy: minimaxProxy,
        port: 5173,
        host: '0.0.0.0',
        strictPort: true,
      },
      plugins: [react(), debugLogPlugin(), ...(https ? [basicSsl()] : [])],
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
