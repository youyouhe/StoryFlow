import { Screenplay, ScriptBlock } from '../types';
import { collectCharacterNames, computeBeatCast } from './beatCast';
import { resolveSegmentRefs } from './videoSegmentSubmit';
import { RefBindings, RefImage } from '../types';

/**
 * SHOT_LIST — the read-only Pro view assembled from blocks + refBindings
 * (docs/script-structure-design.md §2.4). Zero persistence: derived on demand
 * for the audio panel / export / future H3 submission surfaces.
 */

export interface ShotListEntry {
  shot: number;
  blockIds: string[];
  sceneHeading: string;
  /** beat cast (base names) for this shot */
  cast: string[];
  /** reference resolution: bound sheets / missing names / scene env */
  refs: ReturnType<typeof resolveSegmentRefs>;
  motionPrompt: string;
  duration: number;
  frames: { first?: string; last?: string };
}

const GENERATABLE: ScriptBlock['type'][] = ['SCENE_HEADING', 'ACTION', 'CHARACTER'];

/** Group generatable blocks into shots: a SCENE_HEADING opens a new group;
 *  an ACTION with an imagePrompt is its own shot-carrying entry. */
export function deriveShotList(
  screenplay: Screenplay,
  refImages: RefImage[],
  refBindings: RefBindings,
): ShotListEntry[] {
  const entries: ShotListEntry[] = [];
  const universe = collectCharacterNames(screenplay.blocks);
  let sceneHeading = '';
  let shot = 0;
  let current: { blockIds: string[]; blocks: ScriptBlock[] } | null = null;

  const flush = () => {
    if (!current) return;
    shot += 1;
    const anchorIdx = screenplay.blocks.findIndex(b => b.id === current!.blockIds[0]);
    const cast = anchorIdx >= 0 ? computeBeatCast(screenplay.blocks, anchorIdx, universe) : [];
    const refs = resolveSegmentRefs(
      {
        index: shot, startTime: 0, endTime: 0, duration: 0,
        blockIds: current.blockIds, beats: [], sceneHeading,
        oversize: false, tooShort: false,
      },
      screenplay.blocks, refBindings, refImages,
    );
    const carrier = current.blocks.find(b => b.motionPrompt || b.imagePrompt) ?? current.blocks[0];
    entries.push({
      shot,
      blockIds: [...current.blockIds],
      sceneHeading,
      cast,
      refs,
      motionPrompt: carrier.motionPrompt ?? carrier.imagePrompt ?? carrier.content,
      duration: carrier.shotDuration ?? 5,
      frames: { first: carrier.firstFrameDesc, last: carrier.lastFrameDesc },
    });
    current = null;
  };

  for (const b of screenplay.blocks) {
    if (b.type === 'SCENE_HEADING') {
      flush();
      sceneHeading = b.content.trim();
      continue;
    }
    const generatable = GENERATABLE.includes(b.type);
    if (!generatable) continue;
    const isShotCarrier = b.type === 'ACTION' && !!b.imagePrompt?.trim();
    if (!current) current = { blockIds: [], blocks: [] };
    current.blockIds.push(b.id);
    current.blocks.push(b);
    // a non-carrier ACTION/CHARACTER joins the current shot; a carrier ACTION
    // completes one (each imagePrompt-bearing ACTION is its own cut)
    if (isShotCarrier) flush();
  }
  flush();
  return entries;
}

/** DIALOGUE blocks missing a speaker (Pro validation list — warns, never blocks). */
export function dialoguesWithoutSpeaker(blocks: ScriptBlock[]): { blockId: string; line: string }[] {
  return blocks
    .filter(b => b.type === 'DIALOGUE' && !b.speaker)
    .map(b => ({ blockId: b.id, line: b.content.trim().slice(0, 40) }));
}
