/**
 * AI call performance & diagnostic log — a lightweight ring buffer persisted
 * to localStorage (last N calls). Every AI-provider call, image generation,
 * and H3 task API call is instrumented with duration, outcome, payload sizes
 * and error classification, so flakiness ("时好时坏") becomes analyzable
 * instead of anecdotal. Exposed to agents via storyflow_get_ai_log.
 */

const KEY = 'ai_perf_log';
const CAP = 300;

export interface AiLogEntry {
  ts: number;
  durationMs: number;
  op: string;
  provider: string;
  model: string;
  outcome: 'ok' | 'error' | 'timeout';
  /** error class: timeout | network | http:<status> | parse | unknown */
  errorType?: string;
  error?: string;
  attempt?: number;
  promptChars?: number;
  responseChars?: number;
}

export function logAiCall(e: AiLogEntry): void {
  try {
    const raw = localStorage.getItem(KEY);
    const list: AiLogEntry[] = raw ? JSON.parse(raw) : [];
    list.push(e);
    if (list.length > CAP) list.splice(0, list.length - CAP);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* logging must never break the call path */ }
  const flag = e.outcome === 'ok' ? '✓' : '✗';
  console.debug(
    `[ai] ${flag} ${e.op} ${e.provider}/${e.model} ${e.durationMs}ms` +
    `${e.attempt && e.attempt > 1 ? ` attempt${e.attempt}` : ''}` +
    `${e.promptChars ? ` in=${e.promptChars}` : ''}${e.responseChars ? ` out=${e.responseChars}` : ''}` +
    `${e.errorType ? ` (${e.errorType})` : ''}${e.error ? ` ${e.error.slice(0, 80)}` : ''}`,
  );
}

export function getAiLog(opts?: { last?: number; op?: string; failuresOnly?: boolean }): AiLogEntry[] {
  try {
    let list: AiLogEntry[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (opts?.op) list = list.filter(x => x.op === opts.op);
    if (opts?.failuresOnly) list = list.filter(x => x.outcome !== 'ok');
    return opts?.last ? list.slice(-opts.last) : list;
  } catch { return []; }
}

export function clearAiLog(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Classify a thrown error for the log. */
export function classifyError(e: unknown): { errorType: string; message: string } {
  const name = (e as { name?: string })?.name ?? '';
  const msg = String((e as Error)?.message ?? e);
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|abort/i.test(msg)) return { errorType: 'timeout', message: msg };
  if (name === 'TypeError' || /fetch|network|Failed to fetch/i.test(msg)) return { errorType: 'network', message: msg };
  const http = msg.match(/HTTP (\d+)/i);
  if (http) return { errorType: `http:${http[1]}`, message: msg };
  return { errorType: 'unknown', message: msg };
}
