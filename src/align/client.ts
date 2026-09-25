/**
 * WhisperX 类对齐服务客户端(P8,docs/storyflow-ir-p8.md §2)——
 * `AudioExecPorts.alignTake` 的真身;强制对齐 HTTP 契约:
 *
 *   POST {endpoint}/align  (multipart/form-data: audio=<wav>, text=<锚基文本>)
 *   → { durationMs, tokens: [{ text?, startMs, endMs, confidence? }] }
 *
 * tokens 与 `splitAnchorWords(text)` 逐位对齐(N:M 归并由服务侧消化,同窗多
 * token = 共享窗)。token 数不符/HTTP 错/解析失败 → 显式抛(拒绝而非钳制)。
 * `fetchFn` 可注入(测试零网络)。产出 `clipId: ''` —— 由 alignAudioClips
 * runner 权威盖章(P5 口径)。
 */
import type { AlignmentTake, AlignedToken } from '../ir/audio/types';
import { splitAnchorWords } from '../ir/shared';

export interface AlignServiceResponse {
  durationMs: number;
  tokens: { text?: string; startMs: number; endMs: number; confidence?: number }[];
}

export interface AlignClientConfig {
  /** 服务根(如 http://127.0.0.1:8788),客户端 POST {endpoint}/align。 */
  endpoint: string;
  /** 测试注入;缺省 globalThis.fetch。 */
  fetchFn?: typeof fetch;
  /** 缺省 60_000 ms。 */
  timeoutMs?: number;
}

export const createAlignClient = (
  cfg: AlignClientConfig,
): ((blob: Blob, text: string) => Promise<AlignmentTake>) => {
  const fetchFn = cfg.fetchFn ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 60_000;
  return async (blob: Blob, text: string): Promise<AlignmentTake> => {
    const form = new FormData();
    form.append('audio', blob, 'take.wav');
    form.append('text', text);
    const url = `${cfg.endpoint.replace(/\/$/, '')}/align`;
    const res = await fetchFn(url, {
      method: 'POST',
      body: form,
      ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? { signal: AbortSignal.timeout(timeoutMs) }
        : {}),
    });
    if (!res.ok) {
      throw new Error(`对齐服务 HTTP ${res.status}——${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const data = await res.json().catch(() => null) as AlignServiceResponse | null;
    if (!data || typeof data.durationMs !== 'number' || !Array.isArray(data.tokens)) {
      throw new Error('对齐服务响应非法(缺 durationMs/tokens)');
    }
    const expected = splitAnchorWords(text).length;
    if (data.tokens.length !== expected) {
      throw new Error(
        `对齐服务 token 数不符:期望 ${expected}(splitAnchorWords 逐位),实收 ${data.tokens.length}——拒绝而非钳制`,
      );
    }
    const tokens: AlignedToken[] = data.tokens.map((t, tokenIndex) => ({
      tokenIndex,
      ...(t.text != null ? { text: t.text } : {}),
      startMs: t.startMs,
      endMs: t.endMs,
      ...(t.confidence != null ? { confidence: t.confidence } : {}),
    }));
    return { text, clipId: '', durationMs: data.durationMs, tokens };
  };
};
