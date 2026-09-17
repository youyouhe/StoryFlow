import { RefBindings, RefImage, ScriptBlock } from '../types';
import { computeBeatCast, collectCharacterNames } from './beatCast';

/** Outcome of resolving a character reference image for an ACTION (storyboard)
 *  beat. ACTION generation is image-to-image — the whole point is to keep a
 *  character looking the same across shots — so the caller MUST gate on this
 *  rather than silently falling back to text-to-image:
 *
 *   - `ready`         a cast member resolved to a reference image → /edit
 *   - `needs-image`   the beat names a character who has no design sheet yet
 *                     → tell the user to generate that character's image first
 *   - `no-character`  the beat names nobody → conditions are not mature;
 *                     image-to-image has nothing to lock to
 *
 *  Falls back to text-to-image only via `no-character`, which the caller
 *  surfaces as a blocked state instead of generating. */
export type ActionRefResolution =
  | { kind: 'ready'; characterName: string; image: RefImage }
  | { kind: 'needs-image'; characterName: string }
  | { kind: 'no-character' };

/** A frame's reference images: the PRIMARY character identity sheet (① 基础或
 *  表征，按序判) plus, for DIALOGUE/ACTION, the scene's environment backdrop (③).
 *  CHARACTER setting-image generation NEVER gets a backdrop (独立背景 rule). */
export interface FrameRefs {
  character?: RefImage;
  environment?: RefImage;
}

/** Resolve a primary character sheet for a beat or a hit, with age-awareness
 *  and (optionally) sequence wardrobe. Precedence:
 *    1. explicit binding for this character (per-scene override already merged)
 *    2. an age-tagged asset (subject `名字/年纪`) when the sequence/context
 *       asks for that age (or the newest age asset)
 *    3. the base design sheet (subject === name or name/…)
 *  Returns the RefImage or undefined when none exists. */
export const resolveCharacterSheet = (
  name: string,
  bindings: RefBindings | undefined,
  refImages: RefImage[],
  sceneHeading?: string,
  age?: string,
): RefImage | undefined => {
  const eff = resolveRefBindings(bindings, sceneHeading);
  const boundId = eff.characters[name];
  if (boundId) {
    const im = refImages.find(r => r.id === boundId);
    if (im) return im;
  }
  const owned = refImages.filter(r =>
    (r.subject ?? '') === name || (r.subject ?? '').startsWith(name + '/'));
  if (!owned.length) return undefined;
  if (age) {
    const tagged = owned.find(r => (r.subject ?? '').startsWith(`${name}/${age}`));
    if (tagged) return tagged;
  }
  // prefer latest non-tagged base sheet if present, else the last any
  return owned.find(r => (r.subject ?? '') === name) ?? owned[owned.length - 1];
};

/** Resolve a frame's references from a beat/CHARACTER target: the primary
 *  character sheet (①, age-aware) and, for scene-bearing blocks, the scene
 *  environment sheet (③) when one is bound/available. Never a character
 *  backdrop for CHARACTER blocks (独立背景). */
export const resolveFrameRefs = (
  kind: 'action' | 'dialogue' | 'character',
  name: string,
  sceneHeading: string,
  bindings: RefBindings | undefined,
  refImages: RefImage[],
  age?: string,
): FrameRefs => {
  const character = resolveCharacterSheet(name, bindings, refImages, sceneHeading, age);
  let environment: RefImage | undefined;
  if (kind !== 'character' && sceneHeading) {
    const eff = resolveRefBindings(bindings, sceneHeading);
    const envId = eff.environment;
    if (envId) environment = refImages.find(r => r.id === envId);
    if (!environment) {
      // scene-title environment, else the generic 环境 asset
      environment = refImages.find(r =>
        (r.subject ?? '') === sceneHeading ||
        (r.kind === 'environment' && r.sceneKey && sceneHeading.includes(r.sceneKey)) ||
        (r.kind === 'environment' && (r.subject ?? '') === '环境'));
    }
  }
  return { character, environment };
};

/** Resolve the reference image an ACTION beat should be generated from.
 *
 *  Cast is decided by `computeBeatCast` (beat text mentions + the preceding
 *  CHARACTER cues), NOT by whoever happens to be nearest in the block list —
 *  that is what makes `ACTION: 周荇推门而入` followed by `CHARACTER: 周荇`
 *  resolve, and what keeps an unrelated earlier actor out of the frame
 *  (over-supplied references leak into the render — live-tested).
 *
 *  Only the PRIMARY cast member is locked. A second body in frame is far
 *  better served by the prompt than by a second reference sheet, which
 *  drags that character's look into shots they are not in.
 *
 *  @param extraCharNames scene-graybox blocking names, merged into the
 *         screenplay-cue universe (a blocked-but-never-cued character still
 *         resolves). */
export const resolveActionRef = (
  blocks: ScriptBlock[],
  beatIndex: number,
  extraCharNames: string[],
  bindings: RefBindings | undefined,
  refImages: RefImage[],
  sceneHeading?: string,
): ActionRefResolution => {
  const universe = collectCharacterNames(blocks);
  for (const n of extraCharNames) {
    if (n && !universe.includes(n)) universe.push(n);
  }

  const cast = computeBeatCast(blocks, beatIndex, universe);
  if (!cast.length) return { kind: 'no-character' };

  const primary = cast[0];
  const eff = resolveRefBindings(bindings, sceneHeading);
  const boundId = eff.characters[primary];
  const image =
    (boundId ? refImages.find((r) => r.id === boundId) : undefined) ??
    refImages.find((r) => (r.subject ?? '') === primary || (r.subject ?? '').startsWith(primary + '/'));

  if (!image) return { kind: 'needs-image', characterName: primary };
  return { kind: 'ready', characterName: primary, image };
};

/** Resolve the EFFECTIVE bindings for a scene: per-scene costume overrides
 *  win over the script-wide defaults. Used everywhere bindings are consumed
 *  (prompt builders, H3 submission, the binding panel display). */
export const resolveRefBindings = (
  b: RefBindings | undefined,
  sceneHeading?: string,
): RefBindings => {
  const base = b ?? { characters: {} };
  const ov = sceneHeading ? base.scenes?.[sceneHeading] : undefined;
  if (!ov) return { characters: base.characters, environment: base.environment };
  return {
    characters: { ...base.characters, ...(ov.characters ?? {}) },
    environment: ov.environment ?? base.environment,
  };
};

/** Write an effective-binding update back into the full structure. When
 *  `sceneOnly` is on, keys that differ from the script default are stored as
 *  that scene's override (and keys equal to the default are dropped from the
 *  override, so the scene falls back cleanly). */
export const writeRefBindings = (
  current: RefBindings | undefined,
  sceneHeading: string | undefined,
  sceneOnly: boolean,
  effective: RefBindings,
): RefBindings => {
  const base: RefBindings = current ?? { characters: {} };

  if (!sceneOnly || !sceneHeading) {
    // script-wide write: merge effective over defaults, keep scene overrides
    return { ...base, characters: effective.characters, environment: effective.environment };
  }

  const globalDefault = resolveRefBindings(base, undefined);
  const scenes = { ...(base.scenes ?? {}) };
  const prev = scenes[sceneHeading] ?? {};
  const chars: Record<string, string> = {};

  for (const [name, id] of Object.entries(effective.characters)) {
    if (globalDefault.characters[name] !== id) chars[name] = id;
  }
  const environment = effective.environment !== globalDefault.environment
    ? effective.environment
    : undefined;

  const nextScene = {
    ...(Object.keys(chars).length ? { characters: chars } : {}),
    ...(environment ? { environment } : {}),
  };
  if (Object.keys(nextScene).length > 0) scenes[sceneHeading] = nextScene;
  else delete scenes[sceneHeading];

  return {
    characters: base.characters,
    environment: base.environment,
    ...(Object.keys(scenes).length ? { scenes } : {}),
  };
};
