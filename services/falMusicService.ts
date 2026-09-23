/**
 * fal BGM adapter (docs/pipeline-two-mode.md §2.2) — Pro mode's music track.
 *
 *   POST https://queue.fal.run/sonilo/v1.1/text-to-music   (Key $FAL_TOKEN)
 *   { prompt } → { request_id, status_url, response_url }
 *   GET  status_url → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
 *   GET  response_url → { audio, audios }   ← the audio URL lives here
 *
 * Smoke-tested 2026-09-24: the poll URLs are the queue's `/requests/{id}`
 * namespace (the submit response returns them verbatim — use them when
 * present), and the result payload keys are `audio`/`audios`, NOT
 * `result_url`.
 *
 * Prompt is derived from the StyleHead scene preset + the scene's mood —
 * one BGM per scene, cached by the caller in `screenplay.proAudio`.
 * Key: FAL_TOKEN shell env (getFalToken) or the BYOK settings key.
 */

const QUEUE_BASE = 'https://queue.fal.run';
export const FAL_MUSIC_PATH = '/sonilo/v1.1/text-to-music';

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
/** FAL_TOKEN — 站长-provided shell env, injected at build/dev time. */
export const getFalToken = (): string =>
  ((viteEnv.FAL_TOKEN ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FAL_TOKEN) ?? '').trim();

export interface MusicRequestResult {
  requestId: string;
  /** The queue's own poll/result URLs — authoritative, use when present. */
  statusUrl?: string;
  responseUrl?: string;
}

export async function requestMusic(
  falKey: string,
  prompt: string,
): Promise<MusicRequestResult> {
  const key = falKey.trim();
  if (!key) throw new Error('未配置 FAL API Key——BGM 需要 FAL(FAL_TOKEN 环境变量或设置 → AI)。');
  const res = await fetch(`${QUEUE_BASE}${FAL_MUSIC_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`BGM 提交失败 (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  const d = await res.json().catch(() => ({} as Record<string, unknown>));
  const requestId = d.request_id ?? d.requestId;
  if (!requestId) throw new Error('BGM 提交响应缺少 request_id');
  return {
    requestId: String(requestId),
    statusUrl: typeof d.status_url === 'string' ? d.status_url : undefined,
    responseUrl: typeof d.response_url === 'string' ? d.response_url : undefined,
  };
}

export interface MusicPollResult {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  audioUrl?: string;
  errorMessage?: string;
}

interface FalQueueStatus {
  status?: string;
  error?: string;
  audio?: string;
  audios?: string[];
  response?: { audio?: string; audios?: string[]; result_url?: string } | null;
}

/** Poll once for a submitted request. `urls` are the submit response's
 *  status_url/response_url when available; else the /requests/{id} namespace
 *  is constructed (smoke-tested shape, 2026-09-24). */
export async function pollMusic(
  falKey: string,
  request: MusicRequestResult | string,
): Promise<MusicPollResult> {
  const key = falKey.trim();
  const req: MusicRequestResult = typeof request === 'string' ? { requestId: request } : request;
  const headers = { Authorization: `Key ${key}` };
  const statusUrl = req.statusUrl ?? `${QUEUE_BASE}${FAL_MUSIC_PATH}/requests/${encodeURIComponent(req.requestId)}/status`;
  const sRes = await fetch(statusUrl, { headers });
  if (!sRes.ok) return { status: 'running' };
  const s: FalQueueStatus = await sRes.json().catch(() => ({} as FalQueueStatus));
  const st = (s.status ?? '').toUpperCase();
  if (st === 'COMPLETED') {
    const responseUrl = req.responseUrl ?? `${QUEUE_BASE}${FAL_MUSIC_PATH}/requests/${encodeURIComponent(req.requestId)}`;
    const root: FalQueueStatus = await fetch(responseUrl, { headers })
      .then(r => (r.ok ? r.json() : Promise.resolve({} as FalQueueStatus)))
      .catch(() => ({} as FalQueueStatus));
    const url = root.audio ?? root.audios?.[0]
      ?? root.response?.audio ?? root.response?.audios?.[0]
      ?? root.response?.result_url ?? s.audio ?? s.audios?.[0];
    if (!url) return { status: 'failed', errorMessage: 'BGM 完成但没有音频 URL' };
    return { status: 'succeeded', audioUrl: url };
  }
  if (st === 'FAILED' || s.error) return { status: 'failed', errorMessage: s.error ?? 'BGM 生成失败' };
  return { status: st === 'IN_PROGRESS' ? 'running' : 'queued' };
}

/** Build the BGM prompt from the style-head scene preset + scene mood. */
export function buildBgmPrompt(scenePreset: string | undefined, sceneHeading: string): string {
  const mood = scenePreset?.trim() || 'cinematic';
  const scene = sceneHeading.trim().slice(0, 80) || 'story scene';
  return `${mood} mood instrumental bed for ${scene}. Orchestral-electronic underscore, no vocals, steady loop, 30 seconds.`;
}
