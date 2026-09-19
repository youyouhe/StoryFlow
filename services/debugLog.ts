/**
 * Ship operational errors/warnings to the dev-server debug endpoint.
 * Fire-and-forget — never blocks the caller. In production the endpoint
 * 404s and this is silently ignored.
 *
 * Every major functional area uses this: script CRUD, asset library,
 * storyboard batch, graybox batch, H3 submission, FROM_PROMPT, settings.
 * The developer reads /tmp/storyflow-dev/debug.log to diagnose issues
 * without DevTools on the user's device.
 */
export function shipLog(source: string, level: 'warn' | 'error', message: string, detail?: unknown): void {
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
