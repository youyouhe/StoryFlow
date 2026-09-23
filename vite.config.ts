import path from 'path';
import { appendFileSync, mkdirSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/** Dev-only middleware: POST /api/debug-log → append to a local file.
 *  The frontend fires-and-forgets AI call logs here so the developer can
 *  read errors without DevTools on the user's device. */
// Browser → same-origin /minimax-api/* → dev machine → api.minimaxi.com.
// CN platform (the account's home site — international api.minimaxi.com was
// flaky from the user's network). Proxying removes CORS + client-route from
// the equation entirely.
const minimaxProxy = {
  '/minimax-api': {
    target: 'https://api.minimax.cn',
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
    // ComfyUI self-hosted server — same CORS rationale as minimaxProxy: the
    // browser cannot call the pod cross-origin (ComfyUI sends no CORS
    // headers), but the dev machine reaches it fine. Target overridable via
    // .env.local COMFY_TARGET (pod URLs rotate on restart).
    const comfyProxy = {
      '/comfy-api': {
        target: env.COMFY_TARGET || 'https://8188-cpod-1vi7p2bgmhbc-s1.pod.compshare.cn',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/comfy-api/, ''),
        secure: true,
      },
    };
    // HTTPS is OPT-IN (VITE_HTTPS=1 → `npm run dev:https`): self-signed cert
    // makes the LAN origin a secure context so the File System Access API
    // (folder asset library) works from other devices. Default stays HTTP —
    // the WebMCP bridge and the localhost dev browser expect it.
    const https = env.VITE_HTTPS === '1' || process.env.VITE_HTTPS === '1';
    return {
      server: {
      proxy: { ...minimaxProxy, ...comfyProxy },
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
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        // GLM-TTS (Pro dialogue) + fal BGM — shell env names per 站长
        // (BIGMODEL_TOKEN in ~/.bashrc, FAL_TOKEN likewise); never committed
        'process.env.BIGMODEL_TOKEN': JSON.stringify(env.BIGMODEL_TOKEN ?? process.env.BIGMODEL_TOKEN),
        'process.env.FAL_TOKEN': JSON.stringify(env.FAL_TOKEN ?? process.env.FAL_TOKEN)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
