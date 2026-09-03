import { ScriptBlock } from '../types';

/** The cast of a beat: which scene characters plausibly appear in THIS shot.
 *  Rule: characters whose name appears in the beat text (or its attached
 *  CHARACTER cue) + the last two distinct preceding CHARACTER blocks within
 *  the scene (the speaker and the likely opposite/reaction party). Characters
 *  not in the cast should NOT get reference images on this beat's submission
 *  — live-tested: over-supplied references leak into frame (H3 put the knight
 *  in a solo swordsman shot because his design sheet was uploaded). */
export const computeBeatCast = (
  blocks: ScriptBlock[],
  beatIndex: number,
  allCharNames: string[],
): string[] => {
  const names: string[] = [];
  const add = (n: string) => {
    if (n && allCharNames.includes(n) && !names.includes(n)) names.push(n);
  };
  // names mentioned in the beat text + the CHARACTER cue right above it
  const beat = blocks[beatIndex];
  const cue = beatIndex > 0 && blocks[beatIndex - 1].type === 'CHARACTER'
    ? blocks[beatIndex - 1].content : '';
  const text = `${beat?.content ?? ''} ${cue}`;
  for (const n of allCharNames) {
    if (n.length >= 2 && text.includes(n)) add(n);
  }
  // last two distinct preceding CHARACTER blocks (scene-bounded)
  let newFound = 0;
  for (let i = beatIndex; i >= 0; i--) {
    if (blocks[i].type === 'SCENE_HEADING' && i !== beatIndex) break;
    if (blocks[i].type === 'CHARACTER') {
      const before = names.length;
      add(blocks[i].content.trim());
      if (names.length > before) {
        newFound++;
        if (newFound >= 2) break;
      }
    }
  }
  return names;
};
