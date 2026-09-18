import { RefBindings, RefImage, ScriptBlock, ScriptSequence } from '../types';
import { computeBeatCast, collectCharacterNames, parseCharacterName, resolveBeatVariant } from './beatCast';

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
  | { kind: 'ready'; characterName: string; variant?: string; image: RefImage }
  | { kind: 'needs-image'; characterName: string; variant?: string }
  | { kind: 'no-character' };

/** A frame's reference images: the PRIMARY character identity sheet (① 基础或
 *  表征，按序判) plus, for DIALOGUE/ACTION, the scene's environment backdrop (③).
 *  CHARACTER setting-image generation NEVER gets a backdrop (独立背景 rule). */
export interface FrameRefs {
  character?: RefImage;
  environment?: RefImage;
}

/** Normalize ANY identity spelling into {base, variant}: script cues use
 *  parens (张三（浴袍）), the library uses slashes (张三/浴袍), assets may carry
 *  either (users rename freely). One parser keeps them all comparable. */
export const normIdentity = (raw?: string): { base: string; variant?: string } => {
  const s = (raw ?? '').trim();
  if (!s) return { base: '' };
  if (s.includes('/')) {
    const [b, v] = s.split('/', 2);
    return { base: b.trim(), variant: v?.trim() || undefined };
  }
  const p = parseCharacterName(s);
  return { base: p.base, variant: p.variant };
};

/** Resolve a primary character sheet for a beat or a hit, with age-awareness,
 *  optional costume VARIANT, and (optionally) sequence wardrobe. Precedence:
 *    1. explicit binding for this character (per-scene override already merged)
 *    2. the exact VARIANT asset (subject 名字/变体 OR 名字（变体）) when asked for
 *    3. an age-tagged asset (subject 名字/年纪) when the sequence/context asks
 *    4. the base design sheet (no variant tag)
 *  Identity comparison is spelling-agnostic: 女主（初始造型）, 女主/初始造型 and
 *  plain 女主 all match the same person. Returns undefined when none exists. */
export const resolveCharacterSheet = (
  name: string,
  bindings: RefBindings | undefined,
  refImages: RefImage[],
  sceneHeading?: string,
  age?: string,
  variant?: string,
): RefImage | undefined => {
  const wanted = normIdentity(name);
  const wantBase = wanted.base;
  if (!wantBase) return undefined;
  const wantVariant = variant ?? wanted.variant;

  const eff = resolveRefBindings(bindings, sceneHeading);
  // Binding lookup, most-specific first: 女主/浴袍 (this variant) → 女主 (the
  // character's general sheet) → the name as passed. Per-variant keys are what
  // make in-scene 换装 bindable: different beats of one character can link to
  // DIFFERENT pngs, and re-linking a slot never disturbs the others.
  const boundId =
    (wantVariant ? eff.characters[`${wantBase}/${wantVariant}`] : undefined) ??
    eff.characters[wantBase] ??
    eff.characters[name];
  if (boundId) {
    const im = refImages.find(r => r.id === boundId);
    if (im) return im;
  }

  // Identity candidates: match the SUBJECT or the NAME (stem, extension
  // stripped). Both are user-visible identity claims — users rename assets to
  // 女主（初始造型）.png expecting recognition, and subjects may be edited
  // independently. Whichever field carries the identity counts.
  const stemOf = (r: RefImage): string => (r.name ?? '').replace(/\.[^.]+$/, '');
  const owned = refImages.filter(r => {
    const bySubject = normIdentity(r.subject).base === wantBase;
    const byName = normIdentity(stemOf(r)).base === wantBase;
    return bySubject || byName;
  });
  if (!owned.length) return undefined;

  const variantOf = (r: RefImage): string | undefined =>
    normIdentity(r.subject).variant ?? normIdentity(stemOf(r)).variant;

  if (wantVariant) {
    const tagged = owned.find(r => variantOf(r) === wantVariant);
    if (tagged) return tagged;
  }
  if (age) {
    const tagged = owned.find(r => variantOf(r) === age);
    if (tagged) return tagged;
  }
  // prefer the untagged base sheet if present, else the newest owned asset
  return owned.find(r => !variantOf(r)) ?? owned[owned.length - 1];
};

/** Resolve a frame's references from a beat/CHARACTER target: the primary
 *  character sheet (①, variant/age-aware) and, for scene-bearing blocks, the
 *  scene environment sheet (③) when one is bound/available. Never a character
 *  backdrop for CHARACTER blocks (独立背景). */
export const resolveFrameRefs = (
  kind: 'action' | 'dialogue' | 'character' | 'environment',
  name: string,
  sceneHeading: string,
  bindings: RefBindings | undefined,
  refImages: RefImage[],
  age?: string,
  variant?: string,
): FrameRefs => {
  const character = resolveCharacterSheet(name, bindings, refImages, sceneHeading, age, variant);
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
  // In-scene 换装: the variant named on the nearest preceding cue for this base
  // (e.g. `张三（浴袍）` cues the action below to resolve the bathrobe sheet).
  const variant = resolveBeatVariant(blocks, beatIndex, primary);
  const image = resolveCharacterSheet(primary, bindings, refImages, sceneHeading, undefined, variant);

  if (!image) return { kind: 'needs-image', characterName: primary, variant };
  return { kind: 'ready', characterName: primary, variant, image };
};


/** Full beat conditioning: EVERY cast member's sheet (variant/age-aware,
 *  spelling-agnostic) plus the scene backdrop. This is what a frame
 *  generation should be conditioned on — one reference per character in
 *  frame (several characters in one ACTION is normal), not just the lead.
 *
 *  Gating is still PRIMARY-only: if the lead cast member has no sheet the
 *  caller blocks (needs-image) exactly as before. Secondary cast members
 *  without a sheet are skipped silently — a missing secondary degrades the
 *  shot gracefully instead of blocking it.
 *
 *  `characterRefs` (returned) is ordered: primary first. */
export interface BeatRefs {
  primary?: { name: string; variant?: string; image: RefImage };
  others: { name: string; variant?: string; image: RefImage }[];
  environment?: RefImage;
  /** true when the lead cast member exists but has no sheet → caller blocks. */
  needsImage: boolean;
}

export const resolveBeatRefs = (
  blocks: ScriptBlock[],
  beatIndex: number,
  extraCharNames: string[],
  bindings: RefBindings | undefined,
  refImages: RefImage[],
  sceneHeading?: string,
  sequences?: ScriptSequence[] | undefined,
): BeatRefs => {
  const universe = collectCharacterNames(blocks);
  for (const n of extraCharNames) {
    if (n && !universe.includes(n)) universe.push(n);
  }
  const cast = computeBeatCast(blocks, beatIndex, universe);
  if (!cast.length) return { others: [], needsImage: false };

  const primary = cast[0];
  const variantOf = (name: string): string | undefined => resolveBeatVariant(blocks, beatIndex, name);
  const pVariant = variantOf(primary);
  const primarySheet = resolveCharacterSheet(primary, bindings, refImages, sceneHeading, undefined, pVariant);

  const others: BeatRefs['others'] = [];
  for (const name of cast.slice(1)) {
    const sheet = resolveCharacterSheet(name, bindings, refImages, sceneHeading, undefined, variantOf(name));
    if (sheet) others.push({ name, variant: variantOf(name), image: sheet });
  }

  const eff = resolveRefBindings(bindings, sceneHeading);
  let environment: RefImage | undefined;
  if (eff.environment) environment = refImages.find(r => r.id === eff.environment);
  if (!environment && sceneHeading) {
    environment = refImages.find(r =>
      (r.subject ?? '') === sceneHeading ||
      (r.kind === 'environment' && r.sceneKey && sceneHeading.includes(r.sceneKey)) ||
      (r.kind === 'environment' && (r.subject ?? '') === '环境'));
  }

  return {
    primary: primarySheet
      ? { name: primary, variant: pVariant, image: primarySheet }
      : undefined,
    others,
    environment,
    needsImage: !primarySheet,
  };
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
