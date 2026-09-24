/**
 * 词级字幕 / karaoke cues(P8,AlignmentTake 的第一个纯消费者)。
 *
 * 作者词形取 `take.text` 分词(锚同源,splitAnchorWords 同款);窗口/置信取
 * 对齐件。N:M 共享窗 = 多 cue 同窗(karaoke 逐词高亮)。低置信词即「手动校
 * 时候选集」。`placeWordCues` 平移到段/片时间轴(stemOffset 语义,② timeline
 * 同源)。
 */
import type { AlignmentTake } from '../ir/audio/types';
import { splitAnchorWords } from '../ir/shared';

export interface WordCue {
  /** 作者身份 = 锚基文本 token 下标(与 SfxAnchor.wordIndex 同域)。 */
  tokenIndex: number;
  /** 作者词形(非声学词形)。 */
  text: string;
  startMs: number;
  endMs: number;
  /** 对齐置信 0–1;手动校时后的窗为 1。 */
  confidence?: number;
}

export const buildWordCues = (take: AlignmentTake): WordCue[] => {
  const words = splitAnchorWords(take.text);
  if (take.tokens.length !== words.length) {
    throw new Error(
      `对齐件 token 数与锚基文本不符:期望 ${words.length},实收 ${take.tokens.length}——拒绝而非钳制`,
    );
  }
  return words.map((text, tokenIndex) => {
    const t = take.tokens[tokenIndex];
    return {
      tokenIndex,
      text,
      startMs: t.startMs,
      endMs: t.endMs,
      ...(t.confidence != null ? { confidence: t.confidence } : {}),
    };
  });
};

/** 平移到时间轴(段首/拼杆偏移 stemOffset 同语义)。 */
export const placeWordCues = (cues: WordCue[], offsetMs: number): WordCue[] =>
  cues.map(c => ({ ...c, startMs: c.startMs + offsetMs, endMs: c.endMs + offsetMs }));
