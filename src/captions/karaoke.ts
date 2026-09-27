/**
 * 卡拉OK行编译(P14,合成层纯侧)—— 逐镜头词窗(placement 原语,与字幕
 * 同一出处)→ 片内绝对词级行( ASS \k karaoke 的输入)。
 *
 * 行分组 v1:词宽预算(maxChars,同 P11 口径)——词形不含标点(分词口径),
 * 标点保真的 karaoke 行 = 扩展位(P11 的字符→词窗映射可复用)。
 * 词间连接:CJK 直连,ASCII 词间补空格。
 */
import type { StoryFlowIR, Shot } from '../ir/types';
import type { AlignmentTake, WordTimingCorrection } from '../ir/audio/types';
import { resolveShotPlacements } from './compile';

export interface KaraokeWord {
  /** 词形(不含标点)。 */
  text: string;
  /** 片内绝对毫秒。 */
  startMs: number;
  endMs: number;
}

export interface KaraokeLine {
  words: KaraokeWord[];
  startMs: number;
  endMs: number;
  character?: string;
  shotId: string;
}

export interface KaraokeCompileOptions {
  alignments?: Record<string, AlignmentTake>;
  timing?: Record<string, WordTimingCorrection[]>;
  measured?: Record<string, number>;
  /** 行宽预算(词形字符;缺省 16,同 P11)。 */
  maxCharsPerLine?: number;
}

/** 词间连接:两侧均 ASCII 字母数字时补空格(拉丁词可读性)。 */
const joinWords = (words: KaraokeWord[]): string => {
  let out = '';
  for (const w of words) {
    if (out && /[\w]$/.test(out) && /^[\w]/.test(w.text)) out += ' ';
    out += w.text;
  }
  return out;
};

/** 逐对白镜头:词窗(片内绝对)→ 卡拉OK行(词宽预算分组)。 */
export const compileKaraokeLines = (
  ir: StoryFlowIR,
  opts: KaraokeCompileOptions = {},
): KaraokeLine[] => {
  const maxChars = opts.maxCharsPerLine ?? 16;
  const placements = resolveShotPlacements(ir, opts);
  const lines: KaraokeLine[] = [];

  for (const p of placements) {
    const shot: Shot = p.shot;
    const shotOffset = p.filmOffsetMs + p.stemOffsetMs;
    const words: KaraokeWord[] = p.spans.map(s => ({
      text: s.text,
      startMs: shotOffset + s.startMs,
      endMs: shotOffset + s.endMs,
    }));

    let buf: KaraokeWord[] = [];
    let width = 0;
    const flush = (): void => {
      if (!buf.length) return;
      lines.push({
        words: buf,
        startMs: buf[0].startMs,
        endMs: buf[buf.length - 1].endMs,
        ...(shot.character ? { character: shot.character } : {}),
        shotId: shot.id,
      });
      buf = [];
      width = 0;
    };
    for (const w of words) {
      if (width + [...w.text].length > maxChars && width > 0) flush();
      buf.push(w);
      width += [...w.text].length;
    }
    flush();
    void joinWords;
  }

  return lines;
};

export { joinWords };
