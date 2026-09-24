/**
 * 词级校时契约(P10 自 P8 上浮)—— 校时 = **作者写入**(hypit/p2 口径),
 * 参与 reflow。形状与合并逻辑属契约层(② 编译直接消费 `opts.timing`),
 * `src/align/manual.ts` 为兼容 re-export 壳。
 *
 * `applyManualTiming` 不可变合并:校正窗覆盖对齐窗,被覆盖 token 置
 * `confidence: 1`;不动 `text`(新鲜度指纹兼容,stale 检测照常)。越界/
 * 非法窗/重复校正 → 显式抛(拒绝而非钳制)。
 */
import type { AlignmentTake, AlignedToken } from './types';

export interface WordTimingCorrection {
  tokenIndex: number;
  startMs: number;
  endMs: number;
}

export const applyManualTiming = (
  take: AlignmentTake,
  corrections: WordTimingCorrection[],
): AlignmentTake => {
  const seen = new Set<number>();
  const tokens: AlignedToken[] = take.tokens.map(t => ({ ...t }));
  for (const c of corrections) {
    if (!Number.isInteger(c.tokenIndex) || c.tokenIndex < 0 || c.tokenIndex >= tokens.length) {
      throw new Error(`校时 tokenIndex ${c.tokenIndex} 越界(0..${tokens.length - 1})——拒绝而非钳制`);
    }
    if (!(c.endMs > c.startMs)) {
      throw new Error(`校时窗非法(${c.startMs}..${c.endMs}):endMs 必须大于 startMs`);
    }
    if (seen.has(c.tokenIndex)) {
      throw new Error(`token ${c.tokenIndex} 重复校正——同一 token 只能有一条作者窗`);
    }
    seen.add(c.tokenIndex);
    tokens[c.tokenIndex] = {
      ...tokens[c.tokenIndex],
      startMs: c.startMs,
      endMs: c.endMs,
      confidence: 1, // 作者写入 = 权威窗
    };
  }
  return { ...take, tokens };
};

/** 批量套用(P10 注释持久化形态):clipId → 校正表;非法 clip **逐条**隔离
 *  进 `invalid`,不中断其余(与执行器失败隔离同口径)。 */
export const applyTimingCorrections = (
  alignments: Record<string, AlignmentTake> | undefined,
  timing: Record<string, WordTimingCorrection[]> | undefined,
): { alignments: Record<string, AlignmentTake>; invalid: { clipId: string; error: string }[] } => {
  const out: Record<string, AlignmentTake> = { ...(alignments ?? {}) };
  const invalid: { clipId: string; error: string }[] = [];
  if (!timing) return { alignments: out, invalid };
  for (const [clipId, fixes] of Object.entries(timing)) {
    if (!fixes?.length) continue;
    const take = out[clipId];
    if (!take) {
      invalid.push({ clipId, error: '无对齐件可套用(该 clip 尚未对齐)' });
      continue;
    }
    try {
      out[clipId] = applyManualTiming(take, fixes);
    } catch (e) {
      invalid.push({
        clipId,
        error: (e && typeof e === 'object' && 'message' in e)
          ? String((e as { message: unknown }).message) : String(e),
      });
    }
  }
  return { alignments: out, invalid };
};
