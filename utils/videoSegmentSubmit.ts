/**
 * Deterministic VIDEO_PLAN → H3 submission helpers. No AI calls — the prompt
 * is assembled from the planned beats themselves and reference images are the
 * character sheets already bound in the asset library.
 */
import type { ScriptBlock } from '../types';
import type { VideoSegment } from './videoPlan';
import { collectCharacterNames, computeBeatCast, isOffScreen, baseCharName, resolveBeatVariant } from './beatCast';
import { resolveCharacterSheet } from './refBindings';
import type { RefBindings, RefImage } from '../types';

/** H3 supports VARIABLE durations — every integer between the model's min
 *  (H3: 4, H3-Max: 5) and 15 is a valid `duration`. The chosen plan window
 *  caps the top: segments render at their own span, never padded. */
export const clampSegmentSeconds = (d: number, min = 4, max = 15): number =>
  Math.min(Math.max(Math.round(d), min), max);

/**
 * The H3 prompt for one segment: fixed-camera one-take instruction + the
 * timed beats verbatim + spoken lines. Chinese throughout — MiniMax handles
 * it natively and the beats already carry the timestamps H3 paces against.
 */
export const buildSegmentVideoPrompt = (
  seg: VideoSegment,
  segmentIndex: number,
  segmentCount: number,
): string => {
  const lines: string[] = [];
  lines.push(`固定机位一镜到底，总时长约 ${clampSegmentSeconds(seg.duration)} 秒（第 ${segmentIndex}/${segmentCount} 段）。`);
  lines.push(`场景：${seg.sceneHeading}`);
  lines.push('');
  lines.push('按时间顺序：');
  for (const b of seg.beats) {
    lines.push(`[${b.range}] ${b.text}`);
    for (const d of b.dialogues) {
      lines.push(`${d.cue ? `${d.cue}：` : ''}"${d.line}"`);
    }
  }
  lines.push('');
  lines.push('画面连续、机位不切换；人物外形严格保持参考图设定。');
  return lines.join('\n');
};

export interface SegmentRefs {
  /** object URLs of the resolved character sheets, cast order, deduped */
  urls: string[];
  /** characters that resolved to a sheet — carries what the preflight
   *  hover-preview needs: display name (variant-qualified), image URL, sheet
   *  file name. Variants matter: 女主（黑白条纹） and 女主（酒红学院风） are
   *  DIFFERENT sheets and the whole point of the preflight is to show which
   *  costume each segment will wear. */
  bound: { name: string; url: string; sheetName: string }[];
  /** cast members with NO sheet bound — surfaced as a warning, not a block:
   *  a segment spans several beats; one missing secondary character should
   *  not veto the whole segment (unlike single ACTION shots, where the
   *  missing primary identity blocks hard). */
  missing: string[];
  /** V.O./O.S. speakers in the segment — listed informationally in the
   *  preflight (their dialogue stays in the H3 prompt as voice) but they
   *  never receive a reference image. */
  offScreen: string[];
}

/**
 * Character sheets for a segment: union of per-beat cast (text mentions +
 * CHARACTER cues) resolved through the same binding rules as single shots.
 * `allBlocks` is the FULL screenplay block list — the planner's blockIds
 * cover only the timed beat rows, so the slice below is cut by the segment's
 * span (one row early, to keep the CHARACTER cue above the first beat) and
 * carries the cues the cast matcher depends on.
 */
export const resolveSegmentRefs = (
  seg: VideoSegment,
  allBlocks: ScriptBlock[],
  bindings: RefBindings | undefined,
  refImages: RefImage[],
): SegmentRefs => {
  const firstIdx = allBlocks.findIndex(b => b.id === seg.beats[0]?.startBlockId);
  const lastIdx = allBlocks.findIndex(b => b.id === seg.beats[seg.beats.length - 1]?.endBlockId);
  const segBlocks = firstIdx >= 0 && lastIdx >= firstIdx
    ? allBlocks.slice(Math.max(0, firstIdx - 1), lastIdx + 1)
    : [];
  // Voice-only cues (画外/V.O./O.S.) in the segment span — informational.
  const offScreen: string[] = [];
  for (const b of segBlocks) {
    if (b.type !== 'CHARACTER' || !isOffScreen(b.content)) continue;
    const n = baseCharName(b.content);
    if (n && !offScreen.includes(n)) offScreen.push(n);
  }
  // Universe from the FULL script (off-screen cues already excluded) — a
  // narrow slice would drop cues that sit before the segment span, and beat
  // texts that name a character explicitly would match nothing.
  const universe = collectCharacterNames(allBlocks);
  // Cast as (base, variant) pairs — computeBeatCast returns base names only,
  // and the costume variant named on the nearest preceding cue selects WHICH
  // sheet of that character applies to the beat. 女主 in one segment may be
  // 黑白条纹 and 酒红学院风 in the next; collapsing to the base name resolved
  // every segment to the same generic sheet.
  const castPairs: { name: string; variant?: string }[] = [];
  const pairSeen = new Set<string>();
  for (const beat of seg.beats) {
    // computeBeatCast indexes BLOCKS, not beats — map each planned beat to
    // its block position inside the segment slice (the slice also holds
    // SCENE_HEADING/CHARACTER rows, so index !== beat number).
    const bi = segBlocks.findIndex(b => b.id === beat.startBlockId);
    if (bi < 0) continue;
    for (const n of computeBeatCast(segBlocks, bi, universe)) {
      // Variant lookup runs on the FULL block list from the beat's real
      // position: cues attach to DIALOGUE rows in common layouts while the
      // timed beats are ACTION rows, so the narrow slice regularly cuts the
      // cue off and the variant was lost → bare 女主 resolved the wrong sheet.
      const gi = allBlocks.findIndex(b => b.id === beat.startBlockId);
      const variant = gi >= 0 ? resolveBeatVariant(allBlocks, gi, n) : undefined;
      const key = `${n}/${variant ?? ''}`;
      if (!pairSeen.has(key)) { pairSeen.add(key); castPairs.push({ name: n, variant }); }
    }
  }
  // A segment that carries both (女主) and (女主, 黑白条纹) means one beat sat
  // before any cue — the cued pair defines the costume; drop the bare one.
  const cued = new Set(castPairs.filter(p => p.variant).map(p => p.name));
  const consolidated = castPairs.filter(p => p.variant || !cued.has(p.name));
  const urls: string[] = [];
  const bound: SegmentRefs['bound'] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const { name, variant } of consolidated) {
    const label = variant ? `${name}（${variant}）` : name;
    // strictVariant: an unbound costume must surface as ⚠ in the preflight,
    // not silently borrow another costume's sheet (that IS the drift).
    const sheet = resolveCharacterSheet(name, bindings, refImages, seg.sceneHeading, undefined, variant, { strictVariant: true });
    if (!sheet) { missing.push(label); continue; }
    if (seen.has(sheet.id)) continue;
    seen.add(sheet.id);
    urls.push(sheet.url);
    bound.push({ name: label, url: sheet.url, sheetName: sheet.name ?? '' });
  }
  return { urls: urls.slice(0, 9), bound, missing, offScreen };
};
