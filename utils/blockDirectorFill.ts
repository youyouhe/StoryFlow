import { ScriptBlock, BlockType } from '../types';
import { collectCharacterNames, parseCharacterName } from './beatCast';

/**
 * Director-field parsing + deterministic backfill (docs/script-structure-design.md
 * §1 defaults, §3.3 post-processing pipeline).
 *
 * Pipeline order at every AI-insertion site:
 *   parse labeled lines (parseLabeledLine)
 *     → attachDirectorTag (director tags ride the nearest generatable block)
 *     → splitInlineDialogue (CHARACTER/ACTION "名字：台词" auto-split — 站长指定项)
 *     → backfillSpeakers (DIALOGUE.speaker ← nearest CHARACTER cue)
 *     → fillDirectorDefaults (deterministic defaults, zero AI)
 *     → sanitizeParsedBlocks (existing, always last)
 *
 * Every default is DERIVED, never invented: the filler is safe on any input,
 * including legacy scripts (schemaVersion 1).
 */

const GENERATABLE: BlockType[] = ['SCENE_HEADING', 'ACTION', 'CHARACTER'];
const STORY_TAGS: Record<string, BlockType> = {
  SCENE: 'SCENE_HEADING',
  ACTION: 'ACTION',
  CHARACTER: 'CHARACTER',
  DIALOGUE: 'DIALOGUE',
  PARENTHETICAL: 'PARENTHETICAL',
  TRANSITION: 'TRANSITION',
};
const DIRECTOR_TAGS = new Set(['MOTION', 'DURATION', 'FIRST', 'LAST']);

export interface ParsedLine {
  block?: ScriptBlock;
  director?: { tag: 'MOTION' | 'DURATION' | 'FIRST' | 'LAST'; value: string };
}

/** Parse ONE labeled line. Unknown/blank → {} (caller applies heuristics). */
export function parseLabeledLine(line: string): ParsedLine {
  const m = line.match(/^\[(SCENE|ACTION|CHARACTER|DIALOGUE|PARENTHETICAL|TRANSITION)\]\s?(.*)/i);
  if (m) {
    const type = STORY_TAGS[m[1].toUpperCase()];
    return { block: { id: genId(), type, content: m[2].trim() } };
  }
  const d = line.match(/^\[(MOTION|DURATION|FIRST|LAST)\]\s?(.*)/i);
  if (d) {
    return { director: { tag: d[1].toUpperCase() as 'MOTION' | 'DURATION' | 'FIRST' | 'LAST', value: d[2].trim() } };
  }
  return {};
}

/** Apply one director tag to the NEAREST preceding generatable block
 *  (ACTION / CHARACTER / SCENE_HEADING — dialogue carries no camera). */
export function attachDirectorTag(blocks: ScriptBlock[], tag: 'MOTION' | 'DURATION' | 'FIRST' | 'LAST', value: string): ScriptBlock[] {
  const out = blocks.map(b => ({ ...b }));
  for (let i = out.length - 1; i >= 0; i--) {
    const b = out[i];
    if (!GENERATABLE.includes(b.type)) continue;
    if (tag === 'MOTION') b.motionPrompt = value;
    else if (tag === 'DURATION') {
      const n = parseFloat(value);
      if (!Number.isNaN(n) && n > 0) b.shotDuration = n;
    } else if (tag === 'FIRST') b.firstFrameDesc = value;
    else b.lastFrameDesc = value;
    return out;
  }
  return out;
}

/** Parse a full labeled script: story tags → blocks, director tags attach to
 *  the nearest generatable block, bare lines fall back to ACTION (the
 *  heuristic acceptAISuggestion has always used). */
export function parseLabeledScript(text: string): ScriptBlock[] {
  let blocks: ScriptBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const { block, director } = parseLabeledLine(line);
    if (block) { blocks.push(block); continue; }
    if (director) { blocks = attachDirectorTag(blocks, director.tag, director.value); continue; }
    // bare line heuristics. NOTE: the ALL-CAPS cue rule requires LATIN
    // letters — CJK strings are toUpperCase()-invariant, so short zh ACTION
    // lines would otherwise be misfiled as CHARACTER (legacy bug, fixed here).
    const content = line.replace(/^\[(.*?)\]\s?/, '');
    let type: BlockType = 'ACTION';
    if (/^(INT\.|EXT\.|内\.|外\.)/i.test(content)) type = 'SCENE_HEADING';
    else if (/[A-Za-z]/.test(content) && content === content.toUpperCase() && content.length < 20 && !content.includes('。') && !content.includes('.')) type = 'CHARACTER';
    blocks.push({ id: genId(), type, content });
  }
  return blocks;
}

/**
 * 站长指定项 — inline dialogue auto-split: models regularly emit
 * 「ACTION: 刀客：你的刀很快」 or a bare-named line with the cue and the line
 * mashed together. When the prefix IS a known character (base name in the
 * cue universe), split it into CHARACTER cue + DIALOGUE.
 */
/** Non-name prefixes that love colons (时间：深夜 is staging, not dialogue). */
const SPLIT_STOPWORDS = new Set(['时间', '地点', '此时', '突然', '片刻', '随后', '接着', '镜头', '画面']);

const looksLikeDialogueLine = (line: string): boolean =>
  /[。．.!?!?…~～]$/.test(line) || line.length >= 8;

export function splitInlineDialogue(blocks: ScriptBlock[]): ScriptBlock[] {
  let universe = collectCharacterNames(blocks);
  const out: ScriptBlock[] = [];
  for (const b of blocks) {
    // timestamp prefixes pollute the name match — strip before matching
    const content = b.type === 'ACTION' || b.type === 'CHARACTER'
      ? b.content.replace(/^\s*\d{1,2}:\d{2}(?:\.\d+)?\s*-\s*\d{1,2}:\d{2}(?:\.\d+)?\s*[。.，,]?\s*/, '')
      : b.content;
    const m = content.match(/^\s*([^：:（(]{1,20})\s*[（(]([^）)]{1,20})[)）]?\s*[：:]\s*(.+)$/s)
      ?? content.match(/^\s*([^：:（(]{1,20})\s*[：:]\s*(.+)$/s);
    if (!m || (b.type !== 'ACTION' && b.type !== 'CHARACTER')) { out.push(b); continue; }
    const rawName = m[1].trim();
    const line = m[2].trim();
    const { base } = parseCharacterName(rawName);
    if (!base || !line) { out.push(b); continue; }
    // Accept when the cue universe knows the name — or, when the script has
    // NO cues at all (the exact case auto-split exists for), when the prefix
    // looks like a name AND the line looks like spoken dialogue (terminal
    // punctuation or substantial length; 时间：深夜 is staging, not speech).
    const known = universe.includes(base);
    const nameLike = base.length <= 12 && /^[^\d]/.test(base) && !SPLIT_STOPWORDS.has(base);
    const dialogueLike = looksLikeDialogueLine(line);
    if (!known && (universe.length > 0 || !nameLike || !dialogueLike)) { out.push(b); continue; }
    if (!known) universe = [...universe, base];
    // A pure-dialogue beat replaces the ACTION wholesale — the shot's
    // timestamp duration must ride along on the DIALOGUE block.
    const carried = b.shotDuration ?? timestampWidth(b.content);
    const dialogue: ScriptBlock = { id: genId(), type: 'DIALOGUE', content: line };
    if (carried != null) dialogue.shotDuration = carried;
    out.push({ id: genId(), type: 'CHARACTER', content: rawName });
    out.push(dialogue);
  }
  return out;
}

/** DIALOGUE.speaker ← the nearest preceding CHARACTER cue (base name). */
export function backfillSpeakers(blocks: ScriptBlock[]): ScriptBlock[] {
  let cue: string | undefined;
  return blocks.map(b => {
    if (b.type === 'CHARACTER') { cue = parseCharacterName(b.content.trim()).base; return b; }
    if (b.type === 'DIALOGUE') {
      return b.speaker ? b : { ...b, speaker: cue };
    }
    return b;
  });
}

/** Strip a leading beat timestamp ("00:00-00:03。") — the motion default
 *  describes movement, not the clock. */
const stripTimestamp = (s: string): string =>
  s.replace(/^\s*\d{1,2}:\d{2}(?:\.\d+)?\s*-\s*\d{1,2}:\d{2}(?:\.\d+)?\s*[。.，,]?\s*/, '').trim();

const timestampWidth = (s: string): number | undefined => {
  const m = s.match(/^\s*(\d{1,2}):(\d{2}(?:\.\d+)?)\s*-\s*(\d{1,2}):(\d{2}(?:\.\d+)?)\s*[。.，,]?/);
  if (!m) return undefined;
  const a = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const b = parseInt(m[3], 10) * 60 + parseFloat(m[4]);
  const d = b - a;
  return d > 0 ? Math.round(d * 10) / 10 : undefined;
};

const firstSentence = (s: string, cap = 80): string => {
  const m = (stripTimestamp(s).split(/(?<=[。．.!?！？\n])/)[0] ?? '').trim();
  return (m.replace(/[。．.!?！？]+$/, '') || s).slice(0, cap).trim();
};


/** Deterministic defaults (docs §1 table). Never invents: every default is
 *  derived from content the block already carries. */
export function fillDirectorDefaults(blocks: ScriptBlock[]): ScriptBlock[] {
  return blocks.map(b => {
    if (!GENERATABLE.includes(b.type)) return b;
    const next = { ...b };
    if (!next.motionPrompt) {
      const fromContent = firstSentence(next.content);
      next.motionPrompt = fromContent || next.imagePrompt || next.content;
    }
    if (next.shotDuration == null) next.shotDuration = timestampWidth(next.content) ?? 5;
    if (!next.firstFrameDesc) next.firstFrameDesc = next.imagePrompt || next.content;
    // lastFrameDesc: absent is a LEGAL state — plain motion needs no last frame.
    return next;
  });
}

/** The full post-parse pipeline, in the doc §3.3 order. */
export function applyDirectorPipeline(blocks: ScriptBlock[]): ScriptBlock[] {
  const split = splitInlineDialogue(blocks);
  const withSpeakers = backfillSpeakers(split);
  const filled = fillDirectorDefaults(withSpeakers);
  return filled;
}

const genId = () => Math.random().toString(36).substring(2, 11);
