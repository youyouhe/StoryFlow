import { RefBindings } from '../types';

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
