/**
 * fal BGM adapter (docs/pipeline-two-mode.md §2.2) — Pro mode's music track.
 *
 *   POST https://queue.fal.run/sonilo/v1.1/text-to-music   (Key $FAL_KEY)
 *   { prompt } → { request_id }
 *   GET  …/text-to-music/{request_id}/status  → { status }
 *   GET  …/text-to-music/{request_id}         → { … result_url }
 *
 * Prompt is derived from the StyleHead scene preset + the scene's mood —
 * one BGM per scene, cached by the caller in `screenplay.proAudio`.
 * Reuses the existing FAL BYOK key (appSettings.falKey / FAL_KEY env).
 */

const QUEUE_BASE = 'https://queue.fal.run';
export const FAL_MUSIC_PATH = '/sonilo/v1.1/text-to-music';

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
/** FAL_TOKEN — 站长-provided shell env, injected at build/dev time. */
export const getFalToken = (): string =>
  ((viteEnv.FAL_TOKEN ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FAL_TOKEN) ?? '').trim();

export interface MusicRequestResult {
  requestId: string;
}

export async function requestMusic(
  falKey: string,
  prompt: string,
): Promise<MusicRequestResult> {
  const key = falKey.trim();
  if (!key) throw new Error('未配置 FAL API Key——BGM 需要 FAL(设置 → AI 或 FAL_KEY 环境变量)。');
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
  return { requestId: String(requestId) };
}

export interface MusicPollResult {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  audioUrl?: string;
  errorMessage?: string;
}

interface FalQueueStatus {
  status?: string;
  error?: string;
  response?: { result_url?: string; audio_url?: string } | null;
  result_url?: string;
  audio_url?: string;
}

/** Poll once. `COMPLETED` responses carry the audio URL in the queue's
 *  status payload or the request root — tolerate both. */
export async function pollMusic(
  falKey: string,
  requestId: string,
): Promise<MusicPollResult> {
  const key = falKey.trim();
  const headers = { Authorization: `Key ${key}` };
  const sRes = await fetch(`${QUEUE_BASE}${FAL_MUSIC_PATH}/${encodeURIComponent(requestId)}/status`, { headers });
  if (!sRes.ok) return { status: 'running' };
  const s: FalQueueStatus = await sRes.json().catch(() => ({} as FalQueueStatus));
  const st = (s.status ?? '').toUpperCase();
  if (st === 'COMPLETED') {
    const root = await fetch(`${QUEUE_BASE}${FAL_MUSIC_PATH}/${encodeURIComponent(requestId)}`, { headers })
      .then(r => (r.ok ? r.json() : Promise.resolve({} as FalQueueStatus)))
      .catch(() => ({} as FalQueueStatus));
    const url = root.response?.result_url ?? root.response?.audio_url
      ?? root.result_url ?? root.audio_url
      ?? s.response?.result_url ?? s.response?.audio_url
      ?? s.result_url ?? s.audio_url;
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
