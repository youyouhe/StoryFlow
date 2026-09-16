import { GrayboxCamera } from '../types';

/**
 * Duration planner — decouples an arbitrary STORY length from a video model's
 * fixed generation length.
 *
 * A beat's screen time (`targetSeconds`, falling back to the authored camera
 * `movement.duration`) rarely matches what a generation model can output.
 * MiniMax H3 is hard-locked to integer output of 4–15s per request, with a
 * ≤15s reference video (the same white-model replay is reused per segment).
 * So we plan the story length INTO one or more generation segments:
 *
 *   4 ≤ T ≤ 15  integer   → one clean segment (exact)
 *   4 ≤ T ≤ 15  decimal   → one segment, snapped to the nearest integer (a
 *                           ≤0.5s trim/speed fix in post picks up the slack)
 *   T < 4                  → one 4s segment (model minimum; the excess is
 *                           trimmed in post — a <4s beat can't be authored in
 *                           a single H3 output)
 *   T > 15                 → a chain of integer 4–15s segments, judged so every
 *                           segment stays in range (borrow from neighbours)
 *
 * A chain is NOT frame-continuous — H3 delivers independent generations with
 * no continuation guarantee, so each segment restarts its own camera replay.
 * The planner returns this as a `warning`, and the UI renders the chain as
 * separate tasks whose outputs are offered for manual concat.
 *
 * Pure + synchronous — no model calls, so the confirm dialog, the task list,
 * and the WebMCP tool all see the same plan.
 */

export interface GenSegment {
  /** 1-based index within the generation chain (1 for single). */
  index: number;
  /** H3 output length for this segment, integer seconds in [4, 15]. */
  outputSeconds: number;
  /** Where this segment sits on the story timeline (seconds in). */
  offsetSeconds: number;
  /** Human-readable note (zh, matches the product UI language). */
  note: string;
}

export type GrayboxPlanStrategy =
  | 'single'        // one output; target was an in-range integer
  | 'snapped'       // one output; rounded to the nearest model integer
  | 'snapped-up'    // one 4s output; target < model min (trim in post)
  | 'chain';        // multiple outputs; target > model max

export interface GrayboxPlan {
  /** The story length being planned (targetSeconds, or the camera duration). */
  targetSeconds: number;
  /** Whether the target maps cleanly, needs a post snap, or needs a chain. */
  strategy: GrayboxPlanStrategy;
  /** One per generation request. Len 1 except for `chain`. */
  segments: GenSegment[];
  /** Model/continuation caveats surfaced to the user before paying. */
  warnings: string[];
}

/** Upper bound H3 accepts per request (single output AND reference video). */
export const MODEL_MAX_SECONDS = 15;
/** Lower bound H3 accepts per request. */
export const MODEL_MIN_SECONDS = 4;

const roundSec = (t: number): number => Math.max(MODEL_MIN_SECONDS, Math.min(MODEL_MAX_SECONDS, Math.round(t)));

/** Default story length for a shot when no explicit target is authored. */
export const defaultTargetSeconds = (camera: GrayboxCamera): number => {
  const d = camera.movement?.duration;
  return d && d > 0 ? d : 3;
};

/**
 * Plan `targetSeconds` of story time into H3 generation segment(s).
 *
 * @param targetSeconds total story length for the shot (≥1)
 */
export const planSegments = (targetSeconds: number): GrayboxPlan => {
  const T = Math.max(1, targetSeconds);
  const warnings: string[] = [];

  // Sub-model-minimum: can't author shorter than 4s in one generation.
  if (T < MODEL_MIN_SECONDS) {
    return {
      targetSeconds: T,
      strategy: 'snapped-up',
      segments: [{ index: 1, outputSeconds: MODEL_MIN_SECONDS, offsetSeconds: 0, note: `目标 ${T.toFixed(1)}s 低于模型下限 4s，生成为 4s，多余部分在后期裁切。` }],
      warnings: ['目标时长低于当前模型的单段下限 4s——将生成为 4s，请后期裁切至目标长度。'],
    };
  }

  // In range: one segment, snap decimals to the nearest integer second.
  if (T <= MODEL_MAX_SECONDS) {
    const out = Math.round(T);
    if (out === T) {
      return { targetSeconds: T, strategy: 'single', segments: [{ index: 1, outputSeconds: out, offsetSeconds: 0, note: `精确 ${out}s。` }], warnings: [] };
    }
    const rem = +(T - out).toFixed(2);
    return {
      targetSeconds: T,
      strategy: 'snapped',
      segments: [{ index: 1, outputSeconds: out, offsetSeconds: 0, note: `生成 ${out}s（最近整数秒），差 ${Math.abs(rem).toFixed(1)}s 靠后期变速/裁切补齐。` }],
      warnings: [`目标 ${T.toFixed(1)}s 不是整数秒——将生成 ${out}s，请后期微调 ${Math.abs(rem).toFixed(1)}s 对齐。`],
    };
  }

  // Over the model max: split into a chain. Every segment must land in [4,15].
  // Equal-share distribution keeps each segment in range and the total exact:
  //   n = ceil(T/15); base = floor(T/n); distribute the remainder +1 each onto
  //   the first `rem` segments.
  const n = Math.ceil(T / MODEL_MAX_SECONDS);
  const totalRounded = Math.round(T);
  const base = Math.floor(totalRounded / n);
  const rem = totalRounded - base * n;
  const ints: number[] = new Array(n).fill(base);
  for (let i = 0; i < rem; i++) ints[i] += 1;
  warnings.push(`目标 ${T.toFixed(1)}s 超过单段上限 15s——将拆成 ${n} 段独立生成${totalRounded !== Math.round(T * 10) / 10 ? '（按整秒近似）' : ''}。`);

  // Defensive clamp keeps every segment in [4,15] (equal-share already does
  // this, but rounding path drift would otherwise slip a 16s out).
  const clamped = ints.map((s) => Math.max(MODEL_MIN_SECONDS, Math.min(MODEL_MAX_SECONDS, Math.round(s))));

  let off = 0;
  const segments: GenSegment[] = clamped.map((sec, i) => {
    const seg = { index: i + 1, outputSeconds: sec, offsetSeconds: off, note: `第 ${i + 1}/${clamped.length} 段：${sec}s。` };
    off += sec;
    return seg;
  });
  warnings.push('链式分段之间为独立生成，无帧连续保证——每段用同一白模运镜重新生成，输出后可手动拼接。');

  return { targetSeconds: T, strategy: 'chain', segments, warnings };
};