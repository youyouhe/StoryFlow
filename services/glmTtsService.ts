/**
 * GLM-TTS adapter (docs/pipeline-two-mode.md §2.1) — Pro mode's dialogue track.
 *
 *   POST https://open.bigmodel.cn/paas/v4/audio/speech
 *   Authorization: Bearer $GLM_TTS_API_KEY
 *   { model: 'glm-tts', input, voice, speed, volume, response_format: 'wav', watermark_enabled }
 *   → wav (24 kHz)
 *
 * input is capped at 1024 chars — longer lines are split on sentence
 * boundaries, synthesized per segment, and the WAVs are concatenated
 * client-side (same voice/params ⇒ same format, PCM-safe to join).
 *
 * KEY HANDLING: the key rides the shell env as BIGMODEL_TOKEN (站长-provided
 * name, exported in ~/.bashrc) and reaches the bundle via the vite `define`
 * at build/dev time — never committed, never stored in the settings record.
 */

export const GLM_TTS_URL = 'https://open.bigmodel.cn/paas/v4/audio/speech';
export const GLM_TTS_MAX_INPUT = 1024;
/** System voices (doc §2.1). Custom clone ids pass through `voice` verbatim. */
export const GLM_VOICES = ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'] as const;
export type GlmVoice = (typeof GLM_VOICES)[number];
export const GLM_DEFAULT_VOICE: GlmVoice = 'tongtong';


const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
/** BIGMODEL_TOKEN — exported in the shell (~/.bashrc), injected at build time. */
export const getGlmTtsKey = (): string =>
  ((viteEnv.BIGMODEL_TOKEN ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BIGMODEL_TOKEN) ?? '').trim();

export interface GlmTtsOptions {
  voice?: string;
  /** 0.6–2 per official docs; UI offers 0.5–2. */
  speed?: number;
  volume?: number;
  /** Watermark in the synthesized audio — on by default, configurable. */
  watermarkEnabled?: boolean;
}

/** Split a long line into ≤max segments at sentence punctuation (greedy). */
export function splitForTts(input: string, max = GLM_TTS_MAX_INPUT): string[] {
  const text = input.trim();
  if (text.length <= max) return text ? [text] : [];
  const parts: string[] = [];
  let buf = '';
  // keep the punctuation with its sentence
  for (const seg of text.split(/(?<=[。！？!?；;，,、…\n])/)) {
    if (!seg) continue;
    if ((buf + seg).length > max) {
      if (buf) parts.push(buf);
      // a single over-long sentence without punctuation: hard-slice
      if (seg.length > max) {
        for (let i = 0; i < seg.length; i += max) parts.push(seg.slice(i, i + max));
        buf = '';
      } else {
        buf = seg;
      }
    } else {
      buf += seg;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

/** Synthesize one line (auto-splitting + concatenation). Returns the wav blob. */
export async function synthesizeSpeech(
  apiKey: string,
  input: string,
  opts: GlmTtsOptions = {},
): Promise<Blob> {
  const key = apiKey.trim();
  if (!key) throw new Error('未配置 BIGMODEL_TOKEN——请在 shell 环境中 export 后重启 dev/build。');
  const segments = splitForTts(input);
  if (!segments.length) throw new Error('TTS 输入为空');
  const blobs: Blob[] = [];
  for (const seg of segments) {
    const body: Record<string, unknown> = {
      model: 'glm-tts',
      input: seg,
      voice: opts.voice ?? GLM_DEFAULT_VOICE,
      response_format: 'wav',
      watermark_enabled: opts.watermarkEnabled ?? true,
    };
    if (opts.speed != null) body.speed = opts.speed;
    if (opts.volume != null) body.volume = opts.volume;
    const res = await fetch(GLM_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`GLM-TTS 失败 (HTTP ${res.status}): ${detail.slice(0, 200)}`);
    }
    blobs.push(await res.blob());
  }
  return blobs.length === 1 ? blobs[0] : await concatWavs(blobs);
}

// ---- wav plumbing ----------------------------------------------------------

interface WavInfo {
  sampleRate: number;
  byteRate: number;
  bitsPerSample: number;
  channels: number;
  dataOffset: number;
  dataLength: number;
}

/** Walk the RIFF chunks of a wav file. Tolerates LIST/fact chunks between fmt
 *  and data (some encoders emit them). */
export function parseWav(buf: ArrayBuffer): WavInfo {
  const v = new DataView(buf);
  // 4-char chunk tags must be read byte-by-byte — a getUint32 truncated into
  // a single char would never equal 'RIFF' (caught by the wav tests).
  const tag = (o: number) =>
    String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF') {
    throw new Error('不是 RIFF/WAV 文件');
  }
  let off = 12;
  let info: WavInfo | null = null;
  while (off + 8 <= buf.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      const audioFormat = v.getUint16(off + 8, true);
      const channels = v.getUint16(off + 10, true);
      const sampleRate = v.getUint32(off + 12, true);
      const byteRate = v.getUint32(off + 16, true);
      const bitsPerSample = v.getUint16(off + 22, true);
      if (audioFormat !== 1 && audioFormat !== 3) {
        throw new Error(`不支持的 WAV 编码 (format=${audioFormat})——需要 PCM/float`);
      }
      info = { sampleRate, byteRate, bitsPerSample, channels, dataOffset: 0, dataLength: 0 };
    } else if (id === 'data' && info) {
      info.dataOffset = off + 8;
      info.dataLength = Math.min(size, buf.byteLength - off - 8);
      break;
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!info || !info.dataLength) throw new Error('WAV 缺少 fmt/data 块');
  return info;
}

/** Duration in seconds, straight from the header — no decode needed. */
export function wavDuration(buf: ArrayBuffer): number {
  const w = parseWav(buf);
  return w.dataLength / w.byteRate;
}

/** Concatenate same-format PCM wavs: sum the data chunks, rewrite the header. */
export async function concatWavs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  const bufs: ArrayBuffer[] = [];
  for (const b of blobs) bufs.push(await b.arrayBuffer());
  const first = parseWav(bufs[0]);
  let total = 0;
  const payloads: Uint8Array[] = [];
  for (const ab of bufs) {
    const w = parseWav(ab);
    if (w.byteRate !== first.byteRate || w.sampleRate !== first.sampleRate) {
      throw new Error('WAV 参数不一致,无法直接拼接(应使用同音色同参数分段)');
    }
    const payload = new Uint8Array(ab, w.dataOffset, w.dataLength);
    payloads.push(payload);
    total += w.dataLength + (w.dataLength % 2);
  }
  const headerSize = 44;
  const out = new Uint8Array(headerSize + total);
  const dv = new DataView(out.buffer);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + total, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, first.channels, true);
  dv.setUint32(24, first.sampleRate, true);
  dv.setUint32(28, first.byteRate, true);
  dv.setUint16(32, first.channels * (first.bitsPerSample / 8), true);
  dv.setUint16(34, first.bitsPerSample, true);
  wr(36, 'data'); dv.setUint32(40, total, true);
  let o = headerSize;
  for (const p of payloads) { out.set(p, o); o += p.length + (p.length % 2); }
  return new Blob([out], { type: 'audio/wav' });
}
