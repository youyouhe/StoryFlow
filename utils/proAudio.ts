import { wavDuration } from '../services/glmTtsService';

/**
 * Pro-mode audio planning + duration fitting (docs/pipeline-two-mode.md §3).
 *
 * The rule the 站长 set: **TTS duration is the LOWER BOUND of the shot's
 * output length** — a clip must never cut its dialogue short.
 *
 *   L     = ceil(Σ dialogue durations + 0.3s breath)      (sequential lines)
 *   MODEL = [4, 15]                                        (H3 window)
 *   out   = clamp(max(model_min, min(window, L)), 4, 15)
 *   AUDIO_TOO_LONG when L > window — the segment must be split or sped up.
 */

export const MODEL_MIN_SECONDS = 4;
export const MODEL_MAX_SECONDS = 15;
const BREATH_SECONDS = 0.3;

/** Lower bound from the segment's TTS durations (already-probed wav blobs). */
export function audioLowerBoundSeconds(ttsSeconds: number[]): number {
  if (!ttsSeconds.length) return 0;
  return Math.ceil(ttsSeconds.reduce((a, b) => a + b, 0) + BREATH_SECONDS);
}

export interface FitResult {
  outputSeconds: number;
  /** true when the dialogue cannot fit the planning window — split/speed up. */
  audioTooLong: boolean;
  /** the lower bound that drove the fit (0 = no dialogue track) */
  lowerBound: number;
}

/** Fit an H3 output length for a segment with (possibly) a TTS lower bound.
 *  - no dialogue → the requested window (clamped to the model range)
 *  - dialogue    → at least L; never above the window; AUDIO_TOO_LONG when
 *                  even the window cannot hold the dialogue. */
export function fitSegmentSeconds(requested: number, ttsSeconds: number[], window: number = MODEL_MAX_SECONDS): FitResult {
  const lower = audioLowerBoundSeconds(ttsSeconds);
  const win = Math.max(MODEL_MIN_SECONDS, Math.min(MODEL_MAX_SECONDS, Math.round(window)));
  if (lower <= 0) {
    const out = Math.max(MODEL_MIN_SECONDS, Math.min(MODEL_MAX_SECONDS, Math.round(requested)));
    return { outputSeconds: out, audioTooLong: false, lowerBound: 0 };
  }
  const out = Math.max(MODEL_MIN_SECONDS, Math.min(win, lower));
  return { outputSeconds: out, audioTooLong: lower > win, lowerBound: lower };
}

/** Probe a set of TTS wav blobs → durations (header-only, no decode). */
export async function probeTtsSeconds(blobs: Blob[]): Promise<number[]> {
  const out: number[] = [];
  for (const b of blobs) out.push(wavDuration(await b.arrayBuffer()));
  return out;
}
