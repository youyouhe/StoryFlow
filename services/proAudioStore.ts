/**
 * Pro-mode session audio store (docs/pipeline-two-mode.md §4).
 *
 * Synthesized TTS wavs and fetched BGM/SFX bytes live here as blobs for the
 * CURRENT session — the mux at export time reads from this store. Metadata
 * (line, voice, probed seconds, CDN url) persists in screenplay.proAudio;
 * the bytes themselves are re-synthesizable, so they are not persisted
 * (localStorage would blow its quota on audio).
 */

const store = new Map<string, Blob>();

export function putAudio(key: string, blob: Blob): void {
  store.set(key, blob);
}

export function getAudio(key: string): Blob | undefined {
  return store.get(key);
}

export function hasAudio(key: string): boolean {
  return store.has(key);
}

export const audioKeys = {
  tts: (segKey: string, i: number) => `tts:${segKey}:${i}`,
  bgm: (segKey: string) => `bgm:${segKey}`,
  sfx: (segKey: string, name: string) => `sfx:${segKey}:${name}`,
};
