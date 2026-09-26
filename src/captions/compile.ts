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
import type { Shot, StoryFlowIR, TtsClip } from '../ir/types';
import { estimateTextSeconds } from '../../utils/timing/estimate';
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

  // P12 显读分离片段切分:作者 `||` 断句 > 句末标点 > 行宽;窗 = 朗读总窗
  // 按显示字素权重比例分配(词级显读 N:M 对齐 = 命名后续)。
  const splitPlain = (
    frag: string,
    startMs: number,
    endMs: number,
  ): { text: string; startMs: number; endMs: number }[] => {
    const span = endMs - startMs;
    // 句末标点切片(标点随前句)
    const sentences: string[] = [];
    let buf = '';
    for (const ch of frag) {
      buf += ch;
      if (TERMINAL.has(ch)) {
        let j = frag.indexOf(ch) + 1;
        void j;
        sentences.push(buf);
        buf = '';
      }
    }
    if (buf) sentences.push(buf);
    // 句片窗口(字素权重)+ 超行宽再按字宽切
    const weights = sentences.map(x => [...x].length);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const pieces: { text: string; startMs: number; endMs: number }[] = [];
    sentences.forEach((sentence, i) => {
      const s0 = startMs + Math.round((acc / total) * span);
      acc += weights[i];
      const s1 = startMs + Math.round((acc / total) * span);
      if ([...sentence].length <= maxChars) {
        pieces.push({ text: sentence, startMs: s0, endMs: Math.max(s1, s0 + 1) });
        return;
      }
      const chars = [...sentence];
      for (let k = 0; k < chars.length; k += maxChars) {
        const chunk = chars.slice(k, k + maxChars).join('');
        const c0 = s0 + Math.round((k / chars.length) * (s1 - s0));
        const c1 = s0 + Math.round(((k + chars.slice(k, k + maxChars).length) / chars.length) * (s1 - s0));
        pieces.push({ text: chunk, startMs: c0, endMs: Math.max(c1, c0 + 1) });
      }
    });
    return pieces;
  };

  const filmOffsetOf = (shot: Shot): number => {
    let off = 0;
    for (const s of orderedShots) {
      if (s.sequence >= shot.sequence) break;
      off += s.shotDuration * 1000;
    }
    return off;
  };

  for (const shot of orderedShots) {
    if (shot.dialogue) {
      // ── P12 显读分离路径(display ≠ spoken):||-first 片段 + 比例窗 ──
      const display = shot.dialogue.display;
      if (display != null && display !== shot.dialogue.text) {
        const spoken = shot.dialogue.text;
        const tokens = splitAnchorWords(spoken);
        const anchorBase = anchorTextOf(shot);
        const anchorClip = ir.audio.find(
          (c): c is TtsClip => c.kind === 'tts' && c.shotId === shot.id && c.text === anchorBase.text,
        );
        const basisSec = (anchorClip && opts.measured?.[anchorClip.id]) ?? fitShotDuration(shot.shotDuration, shot.dialogue.ttsFloor).wantSeconds;
        const take = anchorClip ? alignments[anchorClip.id] : undefined;
        const spans = take ? alignedSpans(take, tokens) : proportionalSpans(tokens, basisSec * 1000);
        const totalStart = spans[0]?.startMs ?? 0;
        const totalEnd = spans[spans.length - 1]?.endMs ?? basisSec * 1000;
        const filmBase = filmOffsetOf(shot) + totalStart;
        const fragments = display.split('||').map(f => f.trim()).filter(Boolean);
        const weights = fragments.map(f => [...f].length);
        const totalW = weights.reduce((a, b) => a + b, 0) || 1;
        let accW = 0;
        fragments.forEach((frag, fi) => {
          const fStart = filmBase + Math.round((accW / totalW) * (totalEnd - totalStart));
          accW += weights[fi];
          const fEnd = filmBase + Math.round((accW / totalW) * (totalEnd - totalStart));
          for (const piece of splitPlain(frag, fStart, fEnd)) {
            index += 1;
            captions.push({
              index,
              text: opts.speakerPrefix && shot.character ? `${shot.character}：${piece.text}` : piece.text,
              startMs: piece.startMs,
              endMs: piece.endMs,
              ...(shot.character ? { character: shot.character } : {}),
              shotId: shot.id,
            });
          }
        });
        filmOffset += shot.shotDuration * 1000;
        continue;
      }
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

      // issue #11 全对白覆盖:同拍余句(非锚 TTS clip)也进字幕轨——窗接在
      // 锚句之后,按字数权重比例分窗(时长来自朗读估时,单条 ≤ 行窗 ≤ 拍长)。
      const others = ir.audio.filter(
        (c): c is TtsClip => c.kind === 'tts' && c.shotId === shot.id
          && c.text !== shot.dialogue!.text && c.text !== anchorBase.text,
      );
      if (others.length) {
        const anchorEnd = shotOffset + (seg.cues.length ? Math.max(...seg.cues.map(c => c.endMs)) : 0);
        const weights = others.map(c => [...c.text].length || 1);
        const totalW = weights.reduce((a, b) => a + b, 0);
        const estMs = others.reduce((n, c) => n + estimateTextSeconds(c.text, 'DIALOGUE') * 1000, 0);
        const windowEnd = Math.max(anchorEnd + Math.round(estMs), filmOffset + shot.shotDuration * 1000, anchorEnd + 1);
        let acc = anchorEnd;
        others.forEach((c, oi) => {
          const w0 = acc;
          const w1 = anchorEnd + Math.round(
            (weights.slice(0, oi + 1).reduce((a, b) => a + b, 0) / totalW) * (windowEnd - anchorEnd),
          );
          acc = Math.max(w1, w0 + 1);
          for (const piece of splitPlain(c.text, w0, Math.max(w1, w0 + 1))) {
            index += 1;
            captions.push({
              index,
              text: opts.speakerPrefix && c.character ? `${c.character}：${piece.text}` : piece.text,
              startMs: piece.startMs,
              endMs: Math.max(piece.endMs, piece.startMs + 1),
              ...(c.character ? { character: c.character } : {}),
              shotId: shot.id,
            });
          }
        });
      }
    }
    filmOffset += shot.shotDuration * 1000;
  }

  return { captions, warnings };
};
