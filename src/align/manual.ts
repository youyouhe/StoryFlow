/**
 * 手动校时(P8)—— 校时 = **作者写入**(hypit/p2 口径),参与 reflow。
 *
 * `applyManualTiming` 不可变合并:校正窗覆盖对齐窗,被覆盖 token 置
 * `confidence: 1`;不动 `text`(新鲜度指纹兼容,stale 检测照常)。产出可直接
 * 作 ② 编译 `opts.alignments` 传入:
 *
 *   compileAudioPlan(ir, { alignments: { [clipId]: applyManualTiming(take, fixes) } })
 *
 * 越界 tokenIndex / 非法窗(endMs ≤ startMs)/ 重复校正 → 显式抛(拒绝而非钳制)。
 * 校正表持久化(随稿/随 IR)属扩展位(docs/storyflow-ir-p8.md §4)。
 */
import type { AlignmentTake, AlignedToken } from '../ir/audio/types';

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
