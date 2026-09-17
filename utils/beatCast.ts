import { ScriptBlock } from '../types';

/** Split a CHARACTER cue into its BASE identity and an optional costume variant
 *  written in parens: `张三（浴袍）` / `张三(浴袍)` → `{ base: '张三', variant: '浴袍' }`.
 *
 *  In-scene 换装 (bathrobe, suit, battle-worn) is expressed HERE rather than by
 *  inventing a second character. The variant is the same identity channel the
 *  asset library stores as `name/variant` (see refImageStore's deriveSubject),
 *  so a variant sheet is tagged `张三/浴袍` and a later frame naming
 *  `张三（浴袍）` resolves to it.
 *
 *  Everything that reasons about WHO is present (cast, universe, sequence
 *  wardrobe) goes through the BASE name, so one person never forks into two. */
export const parseCharacterName = (raw: string): { base: string; variant?: string } => {
  const s = raw.trim();
  // trailing full-width （） or half-width () only — an inner paren is not a cue
  const m = s.match(/^([^()（）]+?)\s*[（(]([^()（）]+)[)）]\s*$/);
  if (!m) return { base: s };
  const base = m[1].trim();
  const variant = m[2].trim();
  if (!base || !variant) return { base: s };
  return { base, variant };
};

/** The base identity of a cue — the variant, if any, stripped. */
export const baseCharName = (raw: string): string => parseCharacterName(raw).base;

/** Every distinct character BASE name the screenplay names via CHARACTER cues —
 *  the universe `computeBeatCast` matches beat-text mentions against. A name
 *  that only ever appears inside an ACTION line ("周荇推门而入") still resolves
 *  because the same character is cued somewhere in the script; callers with
 *  scene-graybox blocking merge those names in too.
 *
 *  `张三` and `张三（浴袍）` collapse to ONE entry (`张三`): they are the same
 *  person, and the costume change is carried separately as a variant. */
export const collectCharacterNames = (blocks: ScriptBlock[]): string[] => {
  const names: string[] = [];
  for (const b of blocks) {
    if (b.type !== 'CHARACTER') continue;
    const n = baseCharName(b.content);
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
};

/** The cast of a beat: which scene characters plausibly appear in THIS shot.
 *  Rule: characters whose name appears in the beat text (or its attached
 *  CHARACTER cue) + the last two distinct preceding CHARACTER blocks within
 *  the scene (the speaker and the likely opposite/reaction party). Characters
 *  not in the cast should NOT get reference images on this beat's submission
 *  — live-tested: over-supplied references leak into frame (H3 put the knight
 *  in a solo swordsman shot because his design sheet was uploaded).
 *
 *  Names are compared and returned as BASE identities (variants stripped), so
 *  a costume cue counts as the same person. */
export const computeBeatCast = (
  blocks: ScriptBlock[],
  beatIndex: number,
  allCharNames: string[],
): string[] => {
  const names: string[] = [];
  const add = (raw: string) => {
    const n = baseCharName(raw);
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
      add(blocks[i].content);
      if (names.length > before) {
        newFound++;
        if (newFound >= 2) break;
      }
    }
  }
  return names;
};

/** The costume variant a character wears at a beat: the variant on the NEAREST
 *  preceding CHARACTER cue for the same base name within the scene. This is how
 *  an in-scene 换装 reaches the action/dialogue frames below it —
 *  `CHARACTER: 张三（浴袍）` then `ACTION: 张三泡入热水` resolves to the bathrobe
 *  sheet, while a bare `CHARACTER: 张三` later in the same scene returns
 *  undefined (back to the base design).
 *
 *  Scene-bounded, like computeBeatCast: the cue must sit after the current
 *  SCENE_HEADING. Returns undefined when no matching cue precedes the beat. */
export const resolveBeatVariant = (
  blocks: ScriptBlock[],
  beatIndex: number,
  base: string,
): string | undefined => {
  for (let i = beatIndex; i >= 0; i--) {
    if (blocks[i].type === 'SCENE_HEADING' && i !== beatIndex) break;
    if (blocks[i].type === 'CHARACTER') {
      const p = parseCharacterName(blocks[i].content);
      if (p.base === base) return p.variant;
    }
  }
  return undefined;
};
