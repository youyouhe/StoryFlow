import { ScriptBlock, ScriptSequence, CharacterWardrobe } from '../types';
import { baseCharName } from './beatCast';

/**
 * Sequence segmentation + wardrobe/age resolution.
 *
 * A **Sequence** is the continuity granule BETWEEN a scene and the whole script:
 * a run of consecutive scenes where characters do NOT change costume/age. The
 * split is NOT a rule (not "every N scenes" or "every scene change") — it is a
 * NARRATIVE judgment: costume changes when the story itself signals one (muddy
 * outdoors → bathing indoors, 穿越 timeframe, years later). The LLM reads the
 * scene headings + beats and decides where the change points are, in one
 * pass over the script, so the same character's wardrobe/age stays STABLE
 * within a sequence and only changes at a judged boundary.
 *
 * This module owns that segmentation + how a frame resolves which
 * wardrobe/age reference to use for a character at a given beat.
 */

/** Distinct scene blocks (real SCENE_HEADING content), oldest first. */
const keyedScenes = (blocks: ScriptBlock[]) =>
  blocks
    .filter(b => b.type === 'SCENE_HEADING')
    .map(b => b.content.trim())
    .filter((v, i, a) => v && a.indexOf(v) === i);

/** Lead character names (distinct CHARACTER base names), oldest first. */
const keyedChars = (blocks: ScriptBlock[]) =>
  blocks
    .filter(b => b.type === 'CHARACTER')
    .map(b => baseCharName(b.content.trim()))
    .filter((v, i, a) => v && a.indexOf(v) === i);

/** Build a compact context the LLM reads once to judge sequence boundaries.
 *  We don't dump every block — scenes + first beats + who's present — enough
 *  for a costume/age change point. */
export const buildSequenceContext = (blocks: ScriptBlock[]): string => {
  const scenes = keyedScenes(blocks);
  const chars = keyedChars(blocks);
  const lines: string[] = [];
  scenes.forEach((s, i) => {
    let present: string[] = [];
    // find the scene span, collect CHARACTER cues inside
    let inScene = false;
    for (const b of blocks) {
      if (b.type === 'SCENE_HEADING') {
        inScene = b.content.trim() === s;
        if (inScene) present = [];
        else {
          // re-entering same heading later shouldn't leak — coarse is fine
          if (i === scenes.indexOf(s)) break;
        }
        continue;
      }
      if (inScene && b.type === 'CHARACTER') present.push(baseCharName(b.content.trim()));
    }
    lines.push(`Scene ${i + 1}: "${s}" — present: ${present.length ? present.join('、') : '—'}`);
  });
  return `Screenplay sequence boundary judgment. These are the scenes in order with who is present. Decide where a costume-change / age-change happens: a new sequence begins when the STORY demands a change in someone's outfit or age (enter a room, change clothes for a bath, 穿越, a time jump), NOT at every scene heading. Output JSON only.\n\nScenes:\n${lines.join('\n')}\n\nCharacters seen: ${chars.join('、') || '—'}\n\nOutput: {"sequences":[{"id":"seq1","scenes":[1,2],"label":"..."}]} — each sequence lists scene numbers (1-based). Scenes before the first costume/age change = sequence 1; consecutive scenes that share a costume/age form one sequence. A scene-by-scene 1:1 split is allowed only when every scene genuinely demands a costume change.`;
};

/** Resolve which ScriptSequence a block index belongs to; null if none. */
export function sequenceAt(seqs: ScriptSequence[] | undefined, blockIndex: number): ScriptSequence | null {
  if (!seqs) return null;
  return seqs.find(s => blockIndex >= s.start && blockIndex < s.end) ?? null;
}

/** The wardrobe/age state for a character within a sequence (or {} if none). */
export function wardrobeIn(seq: ScriptSequence | null, charName: string): CharacterWardrobe {
  return seq?.wardrobe?.[charName] ?? {};
}
