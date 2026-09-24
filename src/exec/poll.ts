/**
 * submit→poll→collect 的轮询循环(视觉/H3/comfy 与 BGM 共用)。
 * 终态 = succeeded/failed/cancelled(cancel 归 failed,「任务已取消」——live
 * 口径);超时按 live 30min stale guard。首查立即发起;`now`/`sleep` 可注入
 * 假时钟(测试)。失败/超时如实上报,不隐式重试。
 */
import type { ExecOptions } from './types';

export const DEFAULT_POLL_MS = 10_000;
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface Terminal {
  status: 'succeeded' | 'failed' | 'timeout';
  url?: string;
  error?: string;
}

export const errMsg = (e: unknown): string =>
  (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);

export const pollUntil = async (
  query: () => Promise<{ status: string; videoUrl?: string; errorMessage?: string }>,
  opts: ExecOptions,
  ctx: { jobId: string; shotId: string },
): Promise<Terminal> => {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = now();
  for (;;) {
    if (opts.signal?.aborted) return { status: 'failed', error: '已中止' };
    let s: { status: string; videoUrl?: string; errorMessage?: string };
    try {
      s = await query();
    } catch (e) {
      return { status: 'failed', error: errMsg(e) };
    }
    if (s.status === 'succeeded') {
      opts.onProgress?.({ ...ctx, phase: 'succeeded' });
      return { status: 'succeeded', url: s.videoUrl };
    }
    if (s.status === 'failed') {
      return { status: 'failed', error: s.errorMessage || '生成失败' };
    }
    if (s.status === 'cancelled') {
      return { status: 'failed', error: s.errorMessage || '任务已取消' };
    }
    if (now() - start >= timeoutMs) {
      opts.onProgress?.({ ...ctx, phase: 'timeout' });
      return { status: 'timeout', error: `轮询超时(${Math.round(timeoutMs / 60000)} 分钟)——任务可能仍在远端完成` };
    }
    opts.onProgress?.({ ...ctx, phase: s.status === 'queued' ? 'queued' : 'running', detail: s.status });
    await sleep(pollMs);
  }
};
