import { ScriptBlock } from '../types';

/**
 * Video-generation segmentation planner.
 *
 * The core production problem: story beats are SHORT and variable (1.5s, 3s,
 * 6s) while video models generate FIXED-length output (H3: 4–15s; other
 * models: 5/10/15/30s). Generating one video per beat is impossible (a 1.5s
 * beat is below the model minimum) and destroys consistency (every clip is an
 * independent sampling of the character/scene).
 *
 * The fix: AGGREGATE consecutive beats into generation segments that fit the
 * model's output window. One segment = one video generation covering all the
 * beats in its time span. Fewer generations (N beats → ⌈total/window⌉ videos)
 * and per-segment consistency for free (same cast, same scene, same outfits —
 * a segment never crosses a Sequence boundary).
 *
 * Beat timing comes from the ACTION text prefix ("00:00-00:03。…"), written by
 * the FROM_PROMPT transcriber (rule 9) or typed manually. Beats without a
 * timestamp are continuations — they attach to the current beat's window.
 *
 * Atomicity: a beat is NEVER split across segments — a 1.5s beat is absorbed
 * into the window it fits in, not generated standalone.
 */

export interface PlannedBeat {
  /** first block id of the beat */
  startBlockId: string;
  /** last block id of the beat (inclusive) */
  endBlockId: string;
  blockIds: string[];
  start: number;
  end: number;
  /** timestamp prefix as written, e.g. "00:00-00:03" */
  range: string;
  /** ACTION text without the timestamp prefix */
  text: string;
  /** spoken lines inside the beat: speaker cue + line */
  dialogues: { cue?: string; line: string }[];
  sceneHeading: string;
  /** P2 word-level projection: where this beat's window came from — an
   *  authored timestamp prefix or a deterministic word estimate. */
  source?: 'authored' | 'estimated';
}

/** P2 projected windows per block (from utils/timing/timeline). When supplied
 *  they are the timing authority — authored prefixes are already folded in —
 *  and beat-less blocks extend their beat's end. Without them this module
 *  keeps its original second-prefix-only behavior. */
export type BlockWindows = Map<string, {
  start: number;
  end: number;
  range?: string;
  source: 'authored' | 'estimated';
  /** True for beat openers (timestamped or estimated actions). Continuation
   *  blocks carry windows too — they stretch their beat's end instead of
   *  opening a new beat. */
  opensBeat: boolean;
}>;

export interface VideoSegment {
  index: number;
  startTime: number;
  endTime: number;
  blockIds: string[];
  beats: PlannedBeat[];
  sceneHeading: string;
  /** the span this segment covers */
  duration: number;
  /** true when a single beat exceeds the target window (cannot be split) */
  oversize: boolean;
  /** true when the segment is shorter than the model minimum */
  tooShort: boolean;
}

export interface VideoPlan {
  targetSeconds: number;
  segments: VideoSegment[];
  /** beats with no timing anchor at all (script never states a timeline) */
  untimedBeats: number;
  warnings: string[];
}

/** "00:00-00:03。…" → {start:0, end:3}; null when no leading timestamp. */
export const parseBeatTiming = (content: string): { start: number; end: number; range: string } | null => {
  const m = content.match(/^\s*(\d{1,2}):(\d{2}(?:\.\d+)?)\s*-\s*(\d{1,2}):(\d{2}(?:\.\d+)?)\s*[。.，,]?/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const end = parseInt(m[3], 10) * 60 + parseFloat(m[4]);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return { start, end, range: `${m[1]}:${m[2]}-${m[3]}:${m[4]}` };
};

const fmt = (s: number): string => {
  const total = Math.round(s * 10) / 10;
  const mm = Math.floor(total / 60);
  const ss = total - mm * 60;
  return `${String(mm).padStart(2, '0')}:${ss % 1 === 0 ? String(ss).padStart(2, '0') : ss.toFixed(1).padStart(4, '0')}`;
};

/** Group consecutive beats into generation segments of ≤ targetSeconds.
 *
 *  - A SCENE_HEADING always closes the current segment (a new location is a
 *    hard consistency boundary — the backdrop and cast change).
 *  - Blocks without their own timestamp (dialogue, parentheticals, continuing
 *    actions) attach to the beat they follow.
 *  - A single beat longer than the window becomes its own oversize segment
 *    (warned, not split — splitting one continuous action across two videos
 *    would put a hard cut inside a continuous motion). */
export const planVideoSegments = (blocks: ScriptBlock[], targetSeconds: number, windows?: BlockWindows): VideoPlan => {
  const warnings: string[] = [];
  const segments: VideoSegment[] = [];
  const target = Math.max(1, targetSeconds);

  // ---- 1. collect beats (timed actions) with their spans --------------------
  const beats: PlannedBeat[] = [];
  let untimedActions = 0;
  let estimatedBeats = 0;
  let current: PlannedBeat | null = null;
  let sceneHeading = '';

  for (const b of blocks) {
    if (b.type === 'SCENE_HEADING') {
      // scene change closes the current beat and segment
      if (current) { beats.push(current); current = null; }
      const last = segments[segments.length - 1];
      if (current === null && last) { /* segment close handled below via flush */ }
      sceneHeading = b.content.trim();
      // flush: close the open segment
      const open = segments.length ? null : null;
      void open;
      // mark boundary: push a sentinel handled by the grouping pass
      (b as ScriptBlock & { __sceneBoundary?: boolean }).__sceneBoundary = true;
      beats.push({
        startBlockId: b.id, endBlockId: b.id, blockIds: [b.id],
        start: -1, end: -1, range: '', text: b.content,
        dialogues: [], sceneHeading,
        __scene: true,
      } as PlannedBeat & { __scene: boolean });
      continue;
    }
    const win = windows?.get(b.id);
    const prefixed = b.type === 'ACTION' ? parseBeatTiming(b.content) : null;
    const isOpener = b.type === 'ACTION' && (windows ? !!win?.opensBeat : !!prefixed);
    const timing = isOpener
      ? (win ? { start: win.start, end: win.end, range: win.range ?? '' } : prefixed!)
      : null;
    if (timing) {
      if (current) beats.push(current);
      const source = win ? win.source : 'authored';
      if (source === 'estimated') estimatedBeats++;
      current = {
        startBlockId: b.id, endBlockId: b.id, blockIds: [b.id],
        start: timing.start, end: timing.end, range: timing.range,
        // Strip ONLY the leading NN:NN-NN:NN prefix (plus trailing
        // punctuation). The old \S+-\S+ pattern matched to the first space —
        // i.e. the WHOLE of a space-less Chinese line — and the `|| content`
        // fallback then restored the raw text with the prefix still on it,
        // doubling the range in every display and H3 prompt.
        text: b.content.replace(/^\s*\d{1,2}:\d{2}(?:\.\d+)?\s*-\s*\d{1,2}:\d{2}(?:\.\d+)?\s*[。.，,]?\s*/, '').trim() || b.content,
        dialogues: [], sceneHeading,
        source,
      };
      continue;
    }
    // non-timed block: attach to the current beat (or the scene heading's span)
    if (current) {
      current.blockIds.push(b.id);
      current.endBlockId = b.id;
      // P2: a projected window on an attached block stretches the beat's end —
      // editing a dialogue line reflows the whole beat's screen time.
      const attached = windows?.get(b.id);
      if (attached) current.end = Math.max(current.end, attached.end);
      if (b.type === 'DIALOGUE') {
        // attribute the line to the nearest preceding CHARACTER cue
        let cue: string | undefined;
        for (let i = blocks.indexOf(b) - 1; i >= 0; i--) {
          if (blocks[i].type === 'CHARACTER') { cue = blocks[i].content.trim(); break; }
          if (blocks[i].type === 'SCENE_HEADING') break;
        }
        current.dialogues.push({ cue, line: b.content.trim() });
      }
    } else if (b.type === 'ACTION' && b.content.trim()) {
      untimedActions++;
    }
  }
  if (current) beats.push(current);
  if (untimedActions) warnings.push(`${untimedActions} 个动作没有时间戳——已并入前一段，但时长未知。`);
  if (estimatedBeats) warnings.push(`${estimatedBeats} 拍无时间戳，按词级估算排时（改词即改时长）。`);

  // ---- 2. group beats into segments -----------------------------------------
  const flush = (start: number, end: number, span: PlannedBeat[], boundary: boolean): VideoSegment => {
    const blockIds = span.flatMap(b => b.blockIds);
    const duration = end - start;
    const oversize = span.length === 1 && duration > target;
    const tooShort = duration < 4 && !boundary;
    return {
      index: segments.length + 1, startTime: start, endTime: end,
      blockIds, beats: span, sceneHeading: span[0]?.sceneHeading ?? '',
      duration, oversize, tooShort,
    };
  };

  let segStart = -1;
  let segEnd = -1;
  let span: PlannedBeat[] = [];
  let prevWasBoundary = false;

  for (const beat of beats) {
    const isBoundary = '__scene' in (beat as object & { __scene?: boolean });
    if (isBoundary) {
      // scene boundary: close the current segment
      if (span.length) {
        segments.push(flush(segStart, segEnd, span, prevWasBoundary));
        span = []; segStart = -1; segEnd = -1;
      }
      prevWasBoundary = true;
      continue;
    }
    prevWasBoundary = false;
    if (segStart < 0) { segStart = beat.start; segEnd = beat.end; span = [beat]; continue; }
    if (beat.end - segStart <= target) {
      span.push(beat);
      segEnd = Math.max(segEnd, beat.end);
    } else {
      segments.push(flush(segStart, segEnd, span, false));
      span = [beat]; segStart = beat.start; segEnd = beat.end;
    }
  }
  if (span.length) segments.push(flush(segStart, segEnd, span, false));

  // ---- 3. warnings -----------------------------------------------------------
  const oversize = segments.filter(s => s.oversize);
  if (oversize.length) {
    warnings.push(`${oversize.length} 段内单拍超过目标时长（${fmt(target)}s）——连续动作无法拆分，建议：换支持更长输出的模型，或压缩该节拍的表演。`);
  }
  const tooShort = segments.filter(s => s.tooShort);
  if (tooShort.length) {
    warnings.push(`${tooShort.length} 段短于 4s（模型最短输出）——建议与相邻段合并（调大目标时长），或延长该段的表演。`);
  }
  void prevWasBoundary;

  return { targetSeconds: target, segments, untimedBeats: untimedActions, warnings };
};

/** Human-readable plan for the AI modal / export. */
export const formatVideoPlan = (plan: VideoPlan): string => {
  const lines: string[] = [];
  lines.push(`视频分段规划（目标 ≤${plan.targetSeconds}s/段 · 共 ${plan.segments.length} 段）`);
  lines.push('');
  for (const seg of plan.segments) {
    const dlg = seg.beats.reduce((n, b) => n + b.dialogues.length, 0);
    lines.push(`段${seg.index}  ${fmt(seg.startTime)}-${fmt(seg.endTime)}（${Math.round(seg.duration * 10) / 10}s）· ${seg.beats.length} 拍 · 对白 ${dlg} 句${seg.oversize ? ' ⚠ 单拍超时长' : ''}${seg.tooShort ? ' ⚠ 不足4s' : ''}`);
    for (const b of seg.beats) {
      if (b.range) lines.push(`   · ${b.range}  ${b.text.slice(0, 40)}${b.text.length > 40 ? '…' : ''}`);
      for (const d of b.dialogues) lines.push(`     💬 ${d.cue ? `${d.cue}：` : ''}${d.line}`);
    }
    lines.push('');
  }
  for (const w of plan.warnings) lines.push(`⚠ ${w}`);
  return lines.join('\n');
};

/** Combined video-generation prompt for one segment: all beats with timing
 *  rebased to the segment start (the model sees a continuous 0..N span), plus
 *  every dialogue line VERBATIM with speaker attribution. */
export const buildSegmentVideoBrief = (seg: VideoSegment): string => {
  const lines: string[] = [];
  lines.push(`连续镜头，时长 ${Math.round(seg.duration * 10) / 10} 秒（${fmt(seg.startTime)}-${fmt(seg.endTime)} 对应原剧本时间轴）。固定机位一镜到底，镜头与场景在本段内保持不变。`);
  lines.push('');
  for (const b of seg.beats) {
    if (b.range) {
      const rel = b.start - seg.startTime;
      const dur = Math.round((b.end - b.start) * 10) / 10;
      lines.push(`本段第 ${Math.round(rel * 10) / 10}s 起（持续 ${dur}s）：${b.text}`);
      lines.push('');
    }
    for (const d of b.dialogues) {
      lines.push(`${d.cue ? `${d.cue}（画外则不露脸）` : '角色'}说：「${d.line}」`);
    }
  }
  return lines.join('\n');
};

/** True when the block opens a new timed beat (ACTION with a timestamp). */
export const isTimedBeat = (b: ScriptBlock): boolean =>
  b.type === 'ACTION' && parseBeatTiming(b.content) !== null;
