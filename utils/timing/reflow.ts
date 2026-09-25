/**
 * Reflow — white-model shot lengths hang on word spans
 * (P2 of docs/storyflow-adoption-plan.md).
 *
 * The promise: 改一句词 → 白模段时值自动伸缩. Camera GEOMETRY (path/lookPath/
 * shotType) is never touched — only the time anchors (`movement.duration`,
 * `movement.targetSeconds`) are re-derived from the projected span of the
 * words the shot covers. Same blocking, same lens sweep, new length.
 *
 * Span rules (documented policy):
 * - a block shot covers its own window plus trailing blocks of the same beat
 *   group that carry no camera of their own (a beat's dialogue rides the
 *   action's shot; a later cutaway with its own camera starts a new span);
 * - a segment graybox (one continuous design per generation segment, keyed by
 *   first block id) covers consecutive beat groups from its key block to the
 *   next segment key (exclusive) or the next scene boundary.
 *
 * `applyReflow` is idempotent and returns the SAME reference when nothing
 * changes — safe to run on every save.
 */
import type { GrayboxCamera, Screenplay } from '../../types';
import { planVideoSegments, type BlockWindows } from '../videoPlan';
import { blockWindow, buildTimeline, type BeatGroup, type ProgramTimeline } from './timeline';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const MIN_DURATION = 0.2;
const MIN_TARGET = 1; // GrayboxCamera.movement.targetSeconds contract: ≥1

/** Story span of the words a block-level shot covers (see span rules above). */
export const shotSpanForBlock = (timeline: ProgramTimeline, screenplay: Screenplay, blockId: string): number => {
  const beat = timeline.beats.find(b => b.blockIds.includes(blockId));
  const members = beat ? beat.blockIds : [blockId];
  const startIndex = members.indexOf(blockId);
  if (startIndex < 0) return spanOfBlocks(timeline, [blockId]);

  const hasCamera = (id: string): boolean =>
    !!screenplay.blocks.find(b => b.id === id)?.graybox?.camera;

  const covered: string[] = [blockId];
  for (let i = startIndex + 1; i < members.length; i++) {
    if (hasCamera(members[i])) break; // the next shot owns its own time
    covered.push(members[i]);
  }
  return spanOfBlocks(timeline, covered);
};

/** Story span of the words a segment graybox covers (multi-beat, one move). */
export const shotSpanForSegmentKey = (timeline: ProgramTimeline, screenplay: Screenplay, keyBlockId: string): number | null => {
  const beats = timeline.beats;
  const startIndex = beats.findIndex(b => b.blockIds.includes(keyBlockId));
  if (startIndex < 0) return null;

  const segmentKeys = new Set(Object.keys(screenplay.segmentGrayboxes ?? {}));
  let endIndex = startIndex;
  for (let i = startIndex + 1; i < beats.length; i++) {
    const opensNewSegment = beats[i].blockIds.some(id => segmentKeys.has(id) && id !== keyBlockId);
    if (opensNewSegment) break;
    if (beats[i].source === 'scene') break; // scene boundary ends a segment
    endIndex = i;
  }
  return round1(beats[endIndex].end - beats[startIndex].start);
};

const spanOfBlocks = (timeline: ProgramTimeline, blockIds: string[]): number => {
  let start = Infinity;
  let end = -Infinity;
  for (const id of blockIds) {
    const w = blockWindow(timeline, id);
    if (!w) continue;
    start = Math.min(start, w.start);
    end = Math.max(end, w.end);
  }
  return Number.isFinite(start) ? round1(Math.max(MIN_DURATION, end - start)) : MIN_DURATION;
};

const retimeCamera = (camera: GrayboxCamera, span: number): GrayboxCamera => {
  const duration = Math.max(MIN_DURATION, round1(span));
  const targetSeconds = Math.max(MIN_TARGET, round1(span));
  if (camera.movement.duration === duration && camera.movement.targetSeconds === targetSeconds) {
    return camera;
  }
  // Spread keeps path/lookPath BY REFERENCE — geometry bytes never change.
  return {
    ...camera,
    movement: { ...camera.movement, duration, targetSeconds },
  };
};

/**
 * Re-derive every shot's time anchors from the word projection. Returns the
 * SAME screenplay reference when all spans already match (React-safe).
 */
export const applyReflow = (screenplay: Screenplay): Screenplay => {
  const timeline = buildTimeline(screenplay);
  let changed = false;

  const blocks = screenplay.blocks.map(b => {
    const camera = b.graybox?.camera;
    if (!camera) return b;
    const span = shotSpanForBlock(timeline, screenplay, b.id);
    const retimed = retimeCamera(camera, span);
    if (retimed === camera) return b;
    changed = true;
    return { ...b, graybox: { ...b.graybox!, camera: retimed } };
  });

  let segmentGrayboxes = screenplay.segmentGrayboxes;
  if (segmentGrayboxes) {
    const next: typeof segmentGrayboxes = {};
    for (const [key, graybox] of Object.entries(segmentGrayboxes)) {
      const camera = graybox.camera;
      if (!camera) { next[key] = graybox; continue; }
      const span = shotSpanForSegmentKey(timeline, screenplay, key);
      if (span === null) { next[key] = graybox; continue; } // dormant key: keep as-is
      const retimed = retimeCamera(camera, span);
      if (retimed !== camera) changed = true;
      next[key] = retimed === camera ? graybox : { ...graybox, camera: retimed };
    }
    segmentGrayboxes = changed ? next : segmentGrayboxes;
  }

  if (!changed) return screenplay;
  return { ...screenplay, blocks, segmentGrayboxes };
};

/** Projected windows keyed for planVideoSegments (the reflowed plan input).
 *  `opensBeat` distinguishes beat openers (timestamped/estimated actions)
 *  from continuation blocks that merely stretch their beat's end. */
export const videoPlanWindowsOf = (timeline: ProgramTimeline): BlockWindows => {
  const openers = new Set(
    timeline.beats
      .filter(b => b.source === 'authored' || b.source === 'estimated')
      .map(b => b.openerBlockId),
  );
  const windows: BlockWindows = new Map();
  for (const w of timeline.blocks) {
    windows.set(w.blockId, {
      start: w.start,
      end: w.end,
      range: w.range,
      source: w.source,
      opensBeat: openers.has(w.blockId),
    });
  }
  return windows;
};

/** Convenience: windows straight from a screenplay (tokenize + project). */
export const videoPlanWindowsFromScreenplay = (screenplay: Screenplay): BlockWindows =>
  videoPlanWindowsOf(buildTimeline(screenplay));

export type { BeatGroup };
