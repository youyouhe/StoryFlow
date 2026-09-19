/**
 * Deterministic VIDEO_PLAN → H3 submission helpers. No AI calls — the prompt
 * is assembled from the planned beats themselves and reference images are the
 * character sheets already bound in the asset library.
 */
import type { ScriptBlock } from '../types';
import type { VideoSegment } from './videoPlan';
import { collectCharacterNames, computeBeatCast } from './beatCast';
import { resolveCharacterSheet } from './refBindings';
import type { RefBindings, RefImage } from '../types';

/** H3 (MiniMax) accepted output span; segments outside are clamped. */
export const H3_MIN_SECONDS = 4;
export const H3_MAX_SECONDS = 15;

export const clampSegmentSeconds = (d: number): number =>
  Math.min(H3_MAX_SECONDS, Math.max(H3_MIN_SECONDS, Math.round(d)));

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
  /** character names that resolved to a sheet */
  characters: string[];
  /** cast members with NO sheet bound — surfaced as a warning, not a block:
   *  a segment spans several beats; one missing secondary character should
   *  not veto the whole segment (unlike single ACTION shots, where the
   *  missing primary identity blocks hard). */
  missing: string[];
}

/**
 * Character sheets for a segment: union of per-beat cast (text mentions +
 * CHARACTER cues) resolved through the same binding rules as single shots.
 */
export const resolveSegmentRefs = (
  seg: VideoSegment,
  segBlocks: ScriptBlock[],
  bindings: RefBindings | undefined,
  refImages: RefImage[],
): SegmentRefs => {
  const universe = collectCharacterNames(segBlocks);
  const names: string[] = [];
  seg.beats.forEach((_, i) => {
    for (const n of computeBeatCast(segBlocks, i, universe)) {
      if (!names.includes(n)) names.push(n);
    }
  });
  const urls: string[] = [];
  const characters: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const sheet = resolveCharacterSheet(n, bindings, refImages, seg.sceneHeading);
    if (!sheet) { missing.push(n); continue; }
    if (seen.has(sheet.id)) continue;
    seen.add(sheet.id);
    urls.push(sheet.url);
    characters.push(n);
  }
  return { urls: urls.slice(0, 9), characters, missing };
};
