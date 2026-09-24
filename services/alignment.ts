/**
 * Word-level ASR client (P2b of docs/storyflow-adoption-plan.md).
 *
 * Shape: OpenAI-compatible `POST {baseUrl}/audio/transcriptions` with
 * `response_format=verbose_json` + word timestamps — the interface Groq
 * (whisper-large-v3-turbo), OpenAI (whisper-1) and self-hosted whisper.cpp /
 * WhisperX wrappers all speak. BYOK; the Timing tab degrades to JSON import +
 * manual 校时 when no key is configured (2026-09: Groq preflight from the
 * studio LAN returned 403 at the edge — verify from the browser, use the dev
 * proxy, or point asrBaseUrl at any compatible/self-hosted endpoint).
 *
 * The pure N:M matcher lives in utils/timing/align.ts; this module is only
 * transport + parsing + the multi-block orchestration.
 */
import type { ScriptBlock, TimedToken } from '../types';
import { alignTokensToAsr, type AsrWord } from '../utils/timing/align';
import { applyAlignedTokens } from '../utils/timing/overlay';
import { tokenizeBlock } from '../utils/timing/tokenize';

export type { AsrWord };

export interface AsrResult {
  words: AsrWord[];
  text?: string;
  durationSec?: number;
  language?: string;
}

export interface AsrConfig {
  baseUrl: string;
  apiKey: string;
  /** Default: whisper-large-v3-turbo at Groq; override per deployment. */
  model?: string;
}

export class AlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlignmentError';
  }
}

/** Accept verbose_json in its common shapes (OpenAI `words[]`, whisper.cpp
 *  `transcription[]` centisecond offsets, HF-style `segments[].words`).
 *  Refuses rather than guesses when word timestamps are missing — word time
 *  is the whole point. */
export const parseAsrResult = (json: unknown): AsrResult => {
  const data = json as {
    words?: { word?: string; text?: string; start?: number; end?: number; confidence?: number }[];
    transcription?: { offsets?: { from: number; to: number }; text?: string; start?: number; end?: number }[];
    segments?: { words?: { word: string; start: number; end: number }[] }[];
    text?: string;
    duration?: number | string;
    language?: string;
  };
  const words: AsrWord[] = [];

  for (const w of data.words ?? []) {
    const text = (w.word ?? w.text ?? '').trim();
    if (!text || typeof w.start !== 'number' || typeof w.end !== 'number') continue;
    words.push({ word: text, start: w.start, end: w.end, confidence: w.confidence });
  }
  if (!words.length) {
    for (const seg of data.segments ?? []) {
      for (const w of seg.words ?? []) {
        words.push({ word: w.word, start: w.start, end: w.end });
      }
    }
  }
  if (!words.length) {
    // whisper.cpp shape: centisecond offsets, one entry per segment/word
    for (const t of data.transcription ?? []) {
      const text = (t.text ?? '').trim();
      const start = t.offsets ? t.offsets.from / 100 : t.start;
      const end = t.offsets ? t.offsets.to / 100 : t.end;
      if (!text || typeof start !== 'number' || typeof end !== 'number') continue;
      words.push({ word: text, start, end });
    }
  }
  if (!words.length) {
    throw new AlignmentError('对齐结果里没有词级时间戳——需要 verbose_json / word timestamps 输出');
  }
  const durationSec = typeof data.duration === 'string' ? parseFloat(data.duration) : data.duration;
  return {
    words,
    text: data.text,
    durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
    language: data.language,
  };
};

/** One transcription call against an OpenAI-compatible endpoint. */
export const transcribeAudio = async (audio: Blob, cfg: AsrConfig, language?: string): Promise<AsrResult> => {
  if (!cfg.apiKey) throw new AlignmentError('未配置 ASR 密钥（可在设置里填，或改用 JSON 导入 / 手动校时）');
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const form = new FormData();
  const ext = audio.type.includes('wav') ? 'wav' : audio.type.includes('mpeg') || audio.type.includes('mp3') ? 'mp3' : 'm4a';
  form.append('file', audio, `take.${ext}`);
  form.append('model', cfg.model ?? 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  let res: Response;
  try {
    res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
  } catch (e) {
    throw new AlignmentError(`ASR 请求失败（网络/CORS）：${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AlignmentError(`ASR ${res.status}：${body.slice(0, 200)}`);
  }
  return parseAsrResult(await res.json());
};

export interface AlignedBlocksResult {
  blocks: ScriptBlock[];
  /** Per block, token indices with confidence < 0.6 — flagged for 校时. */
  lowConfidence: Map<string, number[]>;
  /** Take duration as measured (envelope input for the covered run). */
  durationSec: number;
}

/**
 * Align a contiguous run of blocks against one take's ASR words. Tokens match
 * in program order across the whole run (the take covers the run's spoken
 * content), then each block gets its own overlay.
 */
export const alignBlocks = (
  blocks: ScriptBlock[],
  blockIds: string[],
  result: AsrResult,
  opts?: { takeRef?: string },
): AlignedBlocksResult => {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const ordered = blockIds.map(id => byId.get(id)).filter((b): b is ScriptBlock => !!b);
  const tokenized = ordered.map(b => tokenizeBlock(b));
  const flat = tokenized.flat();
  const timed: TimedToken[] = alignTokensToAsr(flat, result.words);

  const replaced = new Map<string, ScriptBlock>();
  const lowConfidence = new Map<string, number[]>();
  let cursor = 0;
  ordered.forEach((block, bi) => {
    const count = tokenized[bi].length;
    // owners are array positions in `flat`; slice back to block-local indices
    const slice = timed.slice(cursor, cursor + count).map(t => ({ ...t, index: t.index - cursor }));
    cursor += count;
    const applied = applyAlignedTokens(block, slice, {
      takeRef: opts?.takeRef,
      durationSec: bi === ordered.length - 1 ? result.durationSec : undefined,
    });
    replaced.set(block.id, applied.block);
    if (applied.lowConfidence.length) lowConfidence.set(block.id, applied.lowConfidence);
  });

  return {
    blocks: blocks.map(b => replaced.get(b.id) ?? b),
    lowConfidence,
    durationSec: result.durationSec ?? 0,
  };
};
