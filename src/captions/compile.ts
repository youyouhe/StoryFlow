/**
 * 字幕轨编译器(P11,合成层纯侧,docs/storyflow-ir-p11.md)——
 * IR + 对齐件/校正 → 字幕条 cues → 外挂字幕序列化(toSrt/toVtt)。
 *
 * 词窗来源(逐镜头,确定性):
 *   对齐件(新鲜,P5 哲学)> 字素比例回退(splitAnchorWords + wordStartMs,
 *   basis = 探活秒 ?? fit.wantSeconds);`opts.timing` 校正先套(P10 闭环);
 *   拼杆偏移(② 同口径)→ 镜头偏移 → 片内绝对毫秒。
 *
 * 断句(v1,确定性):句末标点(+随行闭引号)收口 > 行宽上限 token 边界
 * 强制收口;标点/空白随**前**词窗(分词不含标点,只影响窗口归属);
 * 显示文本 = 原文切片(标点保留)。`||` 作者断句待 Dual Text(P12 候选)。
 */
import type { StoryFlowIR, TtsClip } from '../ir/types';
import type { AlignmentTake, WordTimingCorrection } from '../ir/audio/types';
import { splitAnchorWords, wordStartMs, fitShotDuration, anchorTextOf } from '../ir/shared';
import { applyTimingCorrections } from '../ir/audio/timing';

export const DEFAULT_MAX_CHARS = 16;
export const DEFAULT_MIN_CAPTION_MS = 600;

/** 句末标点(+随行闭引号)收口集。 */
const TERMINAL = new Set(['。', '!', '?', '…', ';', '！', '？', '；']);
const CLOSING = new Set(['」', '』', '"', '’', ')', '）', ']', '】']);

export interface CaptionCue {
  /** 1 起,轨内顺序。 */
  index: number;
  /** 显示文本(原文切片,标点保留)。 */
  text: string;
  /** 片内绝对毫秒。 */
  startMs: number;
  endMs: number;
  character?: string;
  shotId: string;
}

export interface CaptionTrack {
  captions: CaptionCue[];
  warnings: CaptionWarning[];
}

export interface CaptionWarning {
  code: 'CAPTION_TOO_SHORT' | 'CAPTION_UNSEGMENTABLE';
  shotId?: string;
  message: string;
}

export interface CaptionCompileOptions {
  /** P5 对齐件(键 = 锚 clip 的 TtsClip id)。 */
  alignments?: Record<string, AlignmentTake>;
  /** P10 注释校时(先套后分,reflow 参与)。 */
  timing?: Record<string, WordTimingCorrection[]>;
  /** clipId → 探活秒(字素回退的 basis 优先源)。 */
  measured?: Record<string, number>;
  /** 行宽上限(CJK 字符;缺省 16)。 */
  maxCharsPerCaption?: number;
  /** 最短可读时长(缺省 600ms,短于此仅警告)。 */
  minCaptionMs?: number;
  /** 字幕文本加说话人前缀(缺省 false = 纯文本)。 */
  speakerPrefix?: boolean;
}

interface WordSpan {
  /** 词形(不含标点)。 */
  text: string;
  /** 镜头内相对窗(毫秒)。 */
  startMs: number;
  endMs: number;
}

/** 对齐窗(clip 相对)→ 镜头相对:token 序 == 词序,直接取窗。 */
const alignedSpans = (take: AlignmentTake, tokens: string[]): WordSpan[] =>
  take.tokens.slice(0, tokens.length).map((t: { startMs: number; endMs: number }, i: number) => ({
    text: tokens[i],
    startMs: t.startMs,
    endMs: t.endMs,
  }));

/** 字素比例回退(basis = 探活 ?? wantSeconds;② 同口径)。 */
const proportionalSpans = (tokens: string[], basisMs: number): WordSpan[] => {
  const weights = tokens.map(t => [...t].length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return tokens.map((text, i) => {
    const startMs = Math.round((acc / total) * basisMs);
    acc += weights[i];
    const endMs = Math.round((acc / total) * basisMs);
    return { text, startMs, endMs };
  });
};

/** 断句:原文切片 + 词窗。返回字幕条(镜头相对毫秒)。 */
const segmentShot = (
  text: string,
  spans: WordSpan[],
  opts: { maxChars: number; shotId: string; character?: string },
): { cues: Omit<CaptionCue, 'index'>[]; warnings: CaptionWarning[] } => {
  const warnings: CaptionWarning[] = [];
  if (!spans.length) {
    warnings.push({ code: 'CAPTION_UNSEGMENTABLE', shotId: opts.shotId, message: '对白分词为空,不产字幕' });
    return { cues: [], warnings };
  }
  // 原文逐字符 → 词窗下标(标点/空白随前词;首词前随首词);
  // 逐 token 消费原文:token 字符属该 token,词间标点属前 token
  const owner: number[] = [];
  {
    let ti = 0;
    let ci = 0;
    while (ci < text.length && ti < spans.length) {
      const token = spans[ti].text;
      const at = text.indexOf(token, ci);
      if (at < 0) break; // 分词与原文不一致(防御;splitAnchorWords 恒为原文子序列)
      for (let k = ci; k < at; k++) owner[k] = Math.max(0, ti - 1);
      for (let k = at; k < at + token.length; k++) owner[k] = ti;
      ci = at + token.length;
      ti += 1;
    }
    for (let k = ci; k < text.length; k++) owner[k] = Math.max(0, spans.length - 1);
  }

  const cues: Omit<CaptionCue, 'index'>[] = [];
  let start = 0; // 原文 char 下标(切片起点)
  const windowOf = (charIdx: number): WordSpan => spans[Math.min(owner[charIdx] ?? 0, spans.length - 1)];
  const closeAt = (end: number): void => {
    const slice = text.slice(start, end).trim();
    if (!slice) { start = end; return; }
    const first = start + text.slice(start, end).indexOf(slice.slice(0, 1));
    const w0 = windowOf(first);
    const w1 = windowOf(Math.max(start, end - 1));
    cues.push({
      text: slice,
      startMs: w0.startMs,
      endMs: Math.max(w1.endMs, w0.startMs + 1),
      ...(opts.character ? { character: opts.character } : {}),
      shotId: opts.shotId,
    });
    start = end;
  };

  let width = 0;
  let i = 0;
  let lastTokenEnd = -1;
  while (i < text.length) {
    const ch = text[i];
    const w = windowOf(i);
    if (w.startMs !== lastTokenEnd) {
      // 进入新 token:行宽预算按词形计
      if (width + [...w.text].length > opts.maxChars && width > 0) {
        closeAt(i);
        width = 0;
        continue;
      }
      width += [...w.text].length;
      lastTokenEnd = w.startMs;
      i += [...w.text].length;
      continue;
    }
    // 词外字符(标点/空白):句末标点(+闭引号)收口
    if (TERMINAL.has(ch)) {
      let j = i + 1;
      while (j < text.length && CLOSING.has(text[j])) j++;
      closeAt(j);
      width = 0;
      i = j;
      continue;
    }
    i += 1;
  }
  closeAt(text.length);

  const out = cues.map(c => ({
    ...c,
    endMs: Math.max(c.endMs, c.startMs + 1),
  }));
  for (const c of out) {
    if (c.endMs - c.startMs < 600) {
      warnings.push({
        code: 'CAPTION_TOO_SHORT',
        shotId: opts.shotId,
        message: `字幕「${c.text.slice(0, 8)}…」仅 ${c.endMs - c.startMs}ms(低于最短可读时长)`,
      });
    }
  }
  return { cues: out, warnings };
};

/** 字幕轨编译:IR + 对齐件/校正 → 片内绝对字幕条。 */
export const compileCaptions = (
  ir: StoryFlowIR,
  opts: CaptionCompileOptions = {},
): CaptionTrack => {
  const maxChars = opts.maxCharsPerCaption ?? DEFAULT_MAX_CHARS;
  const minCaptionMs = opts.minCaptionMs ?? DEFAULT_MIN_CAPTION_MS;
  const warnings: CaptionWarning[] = [];
  const { alignments } = applyTimingCorrections(opts.alignments, opts.timing);

  const orderedShots = [...ir.shots].sort((a, b) => a.sequence - b.sequence);
  const captions: CaptionCue[] = [];
  let filmOffset = 0;
  let index = 0;

  for (const shot of orderedShots) {
    if (shot.dialogue) {
      const text = shot.dialogue.text;
      const tokens = splitAnchorWords(text);
      const anchorBase = anchorTextOf(shot);
      const anchorClip = ir.audio.find(
        (c): c is TtsClip => c.kind === 'tts' && c.shotId === shot.id && c.text === anchorBase.text,
      );
      const basisSec = (anchorClip && opts.measured?.[anchorClip.id]) ?? fitShotDuration(shot.shotDuration, shot.dialogue.ttsFloor).wantSeconds;
      const take = anchorClip ? alignments[anchorClip.id] : undefined;
      const spans = take
        ? alignedSpans(take, tokens)
        : proportionalSpans(tokens, basisSec * 1000);

      // 拼杆偏移:同镜头锚 clip 之前 tts 的探活累计(② 同口径)
      let stemOffset = 0;
      for (const c of ir.audio) {
        if (c.kind !== 'tts' || c.shotId !== shot.id) continue;
        if (c.id === anchorClip?.id) break;
        stemOffset += (opts.measured?.[c.id] ?? c.measuredSeconds ?? 0) * 1000;
      }

      const shotOffset = filmOffset + stemOffset;
      const seg = segmentShot(text, spans, {
        maxChars,
        shotId: shot.id,
        ...(shot.character ? { character: shot.character } : {}),
      });
      warnings.push(...seg.warnings);
      for (const c of seg.cues) {
        index += 1;
        captions.push({
          index,
          text: opts.speakerPrefix && shot.character ? `${shot.character}：${c.text}` : c.text,
          startMs: shotOffset + c.startMs,
          endMs: shotOffset + c.endMs,
          ...(shot.character ? { character: shot.character } : {}),
          shotId: shot.id,
        });
      }
    }
    filmOffset += shot.shotDuration * 1000;
  }

  return { captions, warnings };
};
