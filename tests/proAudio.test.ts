import { describe, it, expect } from 'vitest';
import {
  splitForTts,
  parseWav,
  wavDuration,
  concatWavs,
} from '../services/glmTtsService';
import {
  audioLowerBoundSeconds,
  fitSegmentSeconds,
} from '../utils/proAudio';

/** Build a minimal PCM wav in-test: 44-byte canonical header + sine samples. */
function makeWav(sampleRate: number, seconds: number, opts?: { withListChunk?: boolean }): Blob {
  const n = Math.floor(sampleRate * seconds);
  const dataLen = n * 2; // mono 16-bit
  const extra = opts?.withListChunk
    ? (() => {
        const payload = 'INFOstoryflow-test';
        return { id: 'LIST', size: payload.length, bytes: payload };
      })()
    : null;
  const headerLen = 44 + (extra ? 8 + extra.size + (extra.size % 2) : 0);
  const out = new Uint8Array(headerLen + dataLen);
  const dv = new DataView(out.buffer);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  wr(0, 'RIFF'); dv.setUint32(4, headerLen + dataLen - 8, true); wr(8, 'WAVE');
  let o = 12;
  if (extra) { wr(o, extra.id); dv.setUint32(o + 4, extra.size, true); wr(o + 8, extra.bytes); o += 8 + extra.size + (extra.size % 2); }
  wr(o, 'fmt '); dv.setUint32(o + 4, 16, true);
  dv.setUint16(o + 8, 1, true); dv.setUint16(o + 10, 1, true);
  dv.setUint32(o + 12, sampleRate, true); dv.setUint32(o + 16, sampleRate * 2, true);
  dv.setUint16(o + 20, 2, true); dv.setUint16(o + 22, 16, true);
  o += 24; wr(o, 'data'); dv.setUint32(o + 4, dataLen, true);
  // fill a distinguishable payload per file (byte pattern = sampleRate/100)
  out.fill(sampleRate === 24000 ? 0xAB : 0xCD, headerLen);
  return new Blob([out], { type: 'audio/wav' });
}

describe('splitForTts', () => {
  it('keeps short lines whole', () => {
    expect(splitForTts('你迟到了四百年。')).toEqual(['你迟到了四百年。']);
  });

  it('splits long text at sentence punctuation, ≤1024 per segment', () => {
    const line = '一二三四五。'.repeat(300); // 1800 chars with punctuation
    const segs = splitForTts(line);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(1024);
    expect(segs.join('')).toBe(line);
  });

  it('hard-slices a punctuation-free over-long sentence', () => {
    const segs = splitForTts('啊'.repeat(2500));
    expect(segs.every(s => s.length <= 1024)).toBe(true);
    expect(segs.join('').length).toBe(2500);
  });
});

describe('wav parse/duration/concat', () => {
  it('parses duration from the header (24 kHz mono 16-bit)', async () => {
    const blob = makeWav(24000, 2);
    const d = wavDuration(await blob.arrayBuffer());
    expect(d).toBeCloseTo(2, 1);
  });

  it('tolerates a LIST chunk before data', async () => {
    const blob = makeWav(24000, 1.5, { withListChunk: true });
    const w = parseWav(await blob.arrayBuffer());
    expect(w.sampleRate).toBe(24000);
    expect(wavDuration(await blob.arrayBuffer())).toBeCloseTo(1.5, 1);
  });

  it('concatWavs sums data and rewrites the header', async () => {
    const joined = await concatWavs([makeWav(24000, 1), makeWav(24000, 0.5)]);
    const w = parseWav(await joined.arrayBuffer());
    expect(w.sampleRate).toBe(24000);
    expect(wavDuration(await joined.arrayBuffer())).toBeCloseTo(1.5, 1);
  });

  it('concatWavs rejects mismatched sample rates', async () => {
    await expect(concatWavs([makeWav(24000, 1), makeWav(44100, 1)])).rejects.toThrow('参数不一致');
  });
});

describe('proAudio duration fitting — TTS is the shot lower bound', () => {
  it('lower bound = ceil(sum + breath)', () => {
    expect(audioLowerBoundSeconds([1.2, 2.4])).toBe(4); // 3.6 + 0.3 → ceil 4
    expect(audioLowerBoundSeconds([])).toBe(0);
  });

  it('no dialogue → requested clamped to the model window', () => {
    expect(fitSegmentSeconds(8, []).outputSeconds).toBe(8);
    expect(fitSegmentSeconds(20, []).outputSeconds).toBe(15);
    expect(fitSegmentSeconds(1, []).outputSeconds).toBe(4);
    expect(fitSegmentSeconds(8, []).audioTooLong).toBe(false);
  });

  it('dialogue shorter than the window → lower bound wins over the request', () => {
    const r = fitSegmentSeconds(4, [2, 2]); // L = ceil(4.3) = 5
    expect(r.outputSeconds).toBe(5);
    expect(r.audioTooLong).toBe(false);
  });

  it('dialogue exceeding the window → clamp to window + AUDIO_TOO_LONG', () => {
    const r = fitSegmentSeconds(10, [8, 8]); // L = ceil(16.3) = 17 > model max
    expect(r.outputSeconds).toBe(15);
    expect(r.audioTooLong).toBe(true);
    expect(r.lowerBound).toBe(17);
  });

  it('a custom planning window caps the fit', () => {
    const r = fitSegmentSeconds(10, [5], 6); // L = 6 → exactly the window
    expect(r.outputSeconds).toBe(6);
    expect(r.audioTooLong).toBe(false);
    const r2 = fitSegmentSeconds(10, [6.2], 6); // L = 7 > 6
    expect(r2.outputSeconds).toBe(6);
    expect(r2.audioTooLong).toBe(true);
  });
});
