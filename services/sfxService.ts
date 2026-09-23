/**
 * SFX mini-library (docs/pipeline-two-mode.md §2.3) — v1: a curated set of
 * local wav files under public/sfx/ + a manifest. NO AI — markers that don't
 * match the manifest surface as SFX_MISSING in the workbench/export panel.
 *
 * Selection: a shot marker ([SFX:name] in the beat text) wins; otherwise an
 * emotion keyword hit on the manifest's `match` lists proposes a default.
 */

export interface SfxEntry {
  name: string;
  file: string;
  /** lowercase emotion/scene keywords this effect suggests itself for */
  match: string[];
}

interface SfxManifest {
  effects: SfxEntry[];
}

const MANIFEST_URL = 'sfx/manifest.json';
let cache: SfxManifest | null = null;

export async function loadSfxManifest(): Promise<SfxManifest> {
  if (cache) return cache;
  const res = await fetch(MANIFEST_URL).catch(() => null);
  cache = res?.ok ? await res.json() as SfxManifest : { effects: [] };
  return cache;
}

export interface SfxResolution {
  name: string;
  url?: string;
  missing?: boolean;
}

/** Resolve one marker name against the manifest. Missing = marker preserved
 *  for the export panel instead of a silent gap. */
export async function resolveSfx(name: string): Promise<SfxResolution> {
  const m = await loadSfxManifest();
  const hit = m.effects.find(e => e.name === name);
  if (!hit) return { name, missing: true };
  const url = `sfx/${hit.file}`;
  const ok = await fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
  return ok ? { name, url } : { name, missing: true };
}

/** Propose an effect for a beat from its text (marker-less path). */
export async function suggestSfx(beatText: string): Promise<SfxResolution | null> {
  const m = await loadSfxManifest();
  const text = beatText.toLowerCase();
  for (const e of m.effects) {
    if (e.match.some(k => text.includes(k))) {
      return resolveSfx(e.name);
    }
  }
  return null;
}
