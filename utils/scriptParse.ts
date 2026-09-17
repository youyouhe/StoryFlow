import { ScriptBlock } from '../types';

/**
 * Deterministic post-parse repair for LLM-produced labeled blocks.
 *
 * The FROM_PROMPT path feeds free-form user input to an LLM and parses its
 * labeled output back into blocks. Whatever the model returns, this function
 * guarantees the result is STRUCTURALLY valid for the rest of the pipeline
 * (scene lookup, graybox, reference resolution all assume ≥1 SCENE_HEADING and
 * no empty/duplicated blocks). It is deliberately conservative: it never
 * reorders, rewrites, or drops distinct content — it only fixes structure.
 *
 *  1. trim content, drop empty blocks
 *  2. collapse consecutive duplicates (same type AND content) — models
 *     occasionally emit the same beat twice in a row
 *  3. guarantee a leading SCENE_HEADING — the env-reference / graybox / beat-cast
 *     resolvers all walk "backwards to the nearest SCENE_HEADING"; without one
 *     they silently no-op. If the model emitted none, prepend a generic one.
 */
export const sanitizeParsedBlocks = (blocks: ScriptBlock[]): ScriptBlock[] => {
  // 1. trim + drop empties
  const cleaned = blocks
    .map(b => ({ ...b, content: b.content.trim() }))
    .filter(b => b.content.length > 0);

  // 2. collapse consecutive identical blocks
  const deduped: ScriptBlock[] = [];
  for (const b of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.type === b.type && prev.content === b.content) continue;
    deduped.push(b);
  }
  if (!deduped.length) return deduped;

  // 3. guarantee a leading SCENE_HEADING
  if (!deduped.some(b => b.type === 'SCENE_HEADING')) {
    deduped.unshift({ id: `auto-scene-${Math.random().toString(36).substring(2, 9)}`, type: 'SCENE_HEADING', content: 'INT. 未指明场景 - 日' });
  }
  return deduped;
};
