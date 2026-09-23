/**
 * Ship operational errors/warnings to the dev-server debug endpoint.
 * Fire-and-forget — never blocks the caller. In production the endpoint
 * 404s and this is silently ignored.
 *
 * PRIVACY (P0 fix, 2026-09): logs are TELEMETRY — boot pings carry UA/screen,
 * error details can carry content fragments. Production builds DO NOT SHIP
 * unless explicitly opted in with VITE_ENABLE_SHIPLOG=1 at build time; dev
 * builds keep the old behavior (POSTs land in /tmp/storyflow-dev/debug.log).
 *
 * Every major functional area uses this: script CRUD, asset library,
 * storyboard batch, graybox batch, H3 submission, FROM_PROMPT, settings.
 */
const SHIPLOG_ENABLED =
  !(import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PROD ||
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_ENABLE_SHIPLOG === '1';

export function shipLog(source: string, level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  if (!SHIPLOG_ENABLED) return;
  try {
    fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        level,
        message,
        detail: detail ? String(detail).slice(0, 500) : undefined,
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch { /* never break the caller */ }
}
