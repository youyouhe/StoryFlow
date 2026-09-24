import { describe, it, expect, beforeAll } from 'vitest';

import {
  pickCompositeExport,
  isWebCodecsSupported,
  exportCompositeMp4,
  type EncodedChunkLike,
  type VideoEncoderLike,
  type WebCodecsDeps,
} from '../webcodecs';
import type { CompositeScene } from '../scene';

/**
 * WebCodecs 路径(Hypit 尾声 ①)—— all-seams-fake:fake Video/AudioEncoder +
 * 真 mp4-muxer,零浏览器环境。锁定:帧数 = durationSec × fps(离线逐帧,不靠
 * 实时时钟)、时间戳单调、关键帧节奏、MP4 容器真实成形、不支持即拒(拒绝
 * 而非钳制)、取消即抛。
 */

const fakeChunkOf = (globalName: string, type: 'key' | 'delta', timestamp: number, duration: number): EncodedChunkLike => {
  const data = new Uint8Array(16).fill(type === 'key' ? 0xaa : 0xbb);
  // mp4-muxer 校验 `instanceof EncodedVideoChunk/AudioChunk` 且 duration 必须
  // 是非负实数 — node 无 WebCodecs,这里补空壳全局类并让假 chunk 成为其实例
  const Ctor = (globalThis as Record<string, unknown>)[globalName] as new () => object;
  return Object.assign(new Ctor(), {
    type,
    timestamp,
    duration,
    byteLength: data.byteLength,
    copyTo: (dest: Uint8Array) => dest.set(data),
  }) as unknown as EncodedChunkLike;
};
const fakeChunk = (type: 'key' | 'delta', timestamp: number): EncodedChunkLike =>
  fakeChunkOf('EncodedVideoChunk', type, timestamp, 250_000);
const fakeAudioChunk = (timestamp: number): EncodedChunkLike =>
  fakeChunkOf('EncodedAudioChunk', 'delta', timestamp, 128_000);

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.EncodedVideoChunk ??= class EncodedVideoChunk {};
  g.EncodedAudioChunk ??= class EncodedAudioChunk {};
});

/** Fake VideoEncoder:records config + encode calls, emits one chunk per frame. */
const fakeVideoEncoder = (chunks: { type: 'key' | 'delta'; timestamp: number; keyFrame: boolean }[]) => {
  const configs: Record<string, unknown>[] = [];
  const encoded: { type: 'key' | 'delta'; timestamp: number; keyFrame: boolean }[] = chunks;
  let framesSeen = 0;
  const Ctor = class implements VideoEncoderLike {
    encodeQueueSize = 0;
    constructor(init: { output: (chunk: EncodedChunkLike, meta: { decoderConfig?: { description?: Uint8Array } }) => void }) {
      // hand the constructor its output sink: each encode() emits a chunk
      (this as unknown as { sink: typeof init.output }).sink = init.output;
    }
    sink!: (chunk: EncodedChunkLike, meta: { decoderConfig?: { description?: Uint8Array } }) => void;
    configure(config: Record<string, unknown>): void { configs.push(config); }
    encode(frame: { timestampUs: number }, opts?: { keyFrame?: boolean }): void {
      const type: 'key' | 'delta' = opts?.keyFrame ? 'key' : 'delta';
      encoded.push({ type, timestamp: frame.timestampUs, keyFrame: !!opts?.keyFrame });
      this.sink(fakeChunk(type, frame.timestampUs), {
        decoderConfig: framesSeen++ === 0 ? { description: new Uint8Array([1, 2, 3]) } : undefined,
      });
    }
    async flush(): Promise<void> { /* drain no-op */ }
    close(): void { /* no-op */ }
  };
  return { Ctor, configs, encoded };
};

/** node 无 DOM:全 no-op 的 2d ctx(render.ts 的 fill/fillText/measureText 全吃掉)。 */
const fakeCanvasDeps = (): Pick<WebCodecsDeps, 'makeCanvas'> => ({
  makeCanvas: () => {
    const noop = (): unknown => undefined;
    const ctx = new Proxy({}, {
      get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : noop),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    return { canvas: { width: 0, height: 0 } as HTMLCanvasElement, ctx };
  },
});

const scene = (): CompositeScene => ({
  width: 320,
  height: 180,
  fps: 4,
  background: '#000000',
  durationSec: 2,
  overlays: [
    { kind: 'title', text: '茶馆', placement: 'top', color: '#fff', size: 24, order: 0 },
  ],
});

describe('pickCompositeExport / isWebCodecsSupported', () => {
  it('WebCodecs 在 → mp4 优先(即便 MediaRecorder 也可用)', () => {
    expect(pickCompositeExport({ VideoEncoder: fakeVideoEncoder([]).Ctor as never })).toBe('webcodecs-mp4');
  });

  it('node 环境两者皆无 → null(显式暴露,不静默)', () => {
    // vitest node:无 VideoEncoder、无 MediaRecorder
    expect(isWebCodecsSupported({})).toBe(false);
    expect(pickCompositeExport({})).toBeNull();
  });
});

describe('exportCompositeMp4 — 离线逐帧编码(all seams fake)', () => {
  it('帧数 = durationSec × fps,时间戳单调,关键帧每 2s 一发,MP4 真实成形', async () => {
    const { Ctor, configs, encoded } = fakeVideoEncoder([]);
    const framesMade: number[] = [];
    const deps: WebCodecsDeps = {
      ...fakeCanvasDeps(),
      VideoEncoder: Ctor as never,
      makeVideoFrame: (_canvas, timestampUs) => {
        framesMade.push(timestampUs);
        return { timestampUs };
      },
    };
    const progress: { t: number; durationSec: number }[] = [];
    const result = await exportCompositeMp4(scene(), { onProgress: p => progress.push(p) }, deps);

    expect(result.mime).toBe('video/mp4');
    expect(result.frames).toBe(8); // 2s × 4fps
    expect(framesMade).toHaveLength(8);
    expect(framesMade.every((v, i) => v === i * 250_000)).toBe(true); // 1/4s 步进
    expect(encoded.map(e => e.timestamp)).toEqual(framesMade);
    // 关键帧节奏:fps×2 = 8 → 第 0 帧是 key,其余 delta
    expect(encoded[0].type).toBe('key');
    expect(encoded.slice(1).every(e => e.type === 'delta')).toBe(true);
    expect(configs[0]).toMatchObject({ codec: 'avc1.42001f', width: 320, height: 180, framerate: 4 });
    // MP4 容器真实成形(真 mp4-muxer):ftyp box + 合理体积
    const head = new Uint8Array(await result.blob.slice(0, 12).arrayBuffer());
    expect(new TextDecoder().decode(head.slice(4, 8))).toBe('ftyp');
    expect(result.blob.size).toBeGreaterThan(64);
    // 进度推进:最后帧 t = 7/4s(durationSec 2s 不变)
    expect(progress.at(-1)).toEqual({ t: 1.75, durationSec: 2 });
    expect(result.hasAudio).toBe(false); // 无 base → 无音轨
  });

  it('base 存在 → 逐帧 seek 绘制 + AAC 音轨编码(hasAudio)', async () => {
    const { Ctor: vCtor } = fakeVideoEncoder([]);
    const audioConfigs: Record<string, unknown>[] = [];
    const audioPackets: { timestamp: number; frames: number }[] = [];
    const AudioEncoderCtor = class {
      encodeQueueSize = 0;
      constructor(init: { output: (chunk: EncodedChunkLike, meta: { decoderConfig?: { description?: Uint8Array } }) => void }) {
        (this as unknown as { sink: typeof init.output }).sink = init.output;
      }
      sink!: (chunk: EncodedChunkLike, meta: { decoderConfig?: { description?: Uint8Array } }) => void;
      configure(config: Record<string, unknown>): void { audioConfigs.push(config); }
      encode(ad: { timestamp: number; numberOfFrames?: number }): void {
        audioPackets.push({ timestamp: ad.timestamp, frames: ad.numberOfFrames ?? 0 });
        this.sink(fakeAudioChunk(ad.timestamp), {});
      }
      async flush(): Promise<void> { /* no-op */ }
      close(): void { /* no-op */ }
    };
    const AD = class {
      format: string; sampleRate: number; numberOfFrames: number;
      numberOfChannels: number; timestamp: number; data: Float32Array;
      constructor(init: { format: string; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }) {
        expect(init.format).toBe('f32-planar');
        expect(init.data.length).toBe(init.numberOfFrames * init.numberOfChannels);
        Object.assign(this, init);
        (globalThis as Record<string, unknown>).__lastAudioData = init;
      }
      close(): void { /* no-op */ }
    };
    (globalThis as Record<string, unknown>).AudioData = AD as never;

    // base blob:fake 音频 2s 立体声 8kHz,packet 值 = 采样序号(验证截断/分片)
    const sampleRate = 8000;
    const samples = new Float32Array(sampleRate * 2).map((_, i) => (i % 1000) / 1000);
    const decoded = {
      sampleRate,
      numberOfChannels: 2,
      length: samples.length,
      getChannelData: (ch: number) => (ch === 0 ? samples : samples.map(v => v / 2)),
    };
    const seekCalls: number[] = [];
    const fakeVideo = { duration: 2, currentTime: 0, videoWidth: 320, videoHeight: 180 } as HTMLVideoElement;
    const deps: WebCodecsDeps = {
      ...fakeCanvasDeps(),
      VideoEncoder: vCtor as never,
      AudioEncoder: AudioEncoderCtor as never,
      decodeAudio: async () => decoded,
      loadVideo: async () => fakeVideo,
      seekTo: async (_v, t) => { seekCalls.push(t); },
      makeVideoFrame: (_c, timestampUs) => ({ timestampUs }),
    };

    // 场景:base 2s + 逐帧 seek;音频应截到 durationSec = 2s
    const withBase = { ...scene(), base: { src: new Blob(['video-bytes']), fit: 'cover' as const } };
    const result = await exportCompositeMp4(withBase, undefined, deps);

    expect(seekCalls).toHaveLength(8); // 每帧一次 seek
    expect(seekCalls[3]).toBeCloseTo(0.75, 5);
    expect(result.hasAudio).toBe(true);
    expect(audioConfigs[0]).toMatchObject({ codec: 'mp4a.40.2', sampleRate: 8000, numberOfChannels: 2 });
    // 2s × 8000 / 1024 → 16 包(15×1024 + 640);时间戳按包序单调
    expect(audioPackets).toHaveLength(16);
    expect(audioPackets[0].frames).toBe(1024);
    expect(audioPackets.at(-1)!.frames).toBe(640);
    expect(audioPackets.every((p, i) => i === 0 || p.timestamp > audioPackets[i - 1].timestamp)).toBe(true);
    const last = (globalThis as Record<string, unknown>).__lastAudioData as { timestamp: number; numberOfFrames: number };
    expect(last.numberOfFrames).toBe(640);
    expect(last.timestamp).toBe(Math.round((15 * 1024 / 8000) * 1e6));

    delete (globalThis as Record<string, unknown>).AudioData;
    delete (globalThis as Record<string, unknown>).__lastAudioData;
  });

  it('不支持 VideoEncoder → 显式抛错(拒绝而非钳制)', async () => {
    await expect(exportCompositeMp4(scene(), undefined, {})).rejects.toThrow('VideoEncoder');
  });

  it('abort 信号 → 抛错且不产 blob', async () => {
    const { Ctor } = fakeVideoEncoder([]);
    const ac = new AbortController();
    const deps: WebCodecsDeps = {
      ...fakeCanvasDeps(),
      VideoEncoder: Ctor as never,
      makeVideoFrame: (_c, timestampUs) => {
        if (timestampUs > 0) ac.abort();
        return { timestampUs };
      },
    };
    await expect(exportCompositeMp4(scene(), { signal: ac.signal }, deps)).rejects.toThrow('取消');
  });

  it('isConfigSupported 拒绝 → 显式抛错(不钳制参数)', async () => {
    const Ctor = class {
      encodeQueueSize = 0;
      constructor(_init: unknown) { /* no-op */ }
      configure(): void { /* no-op */ }
      encode(): void { /* no-op */ }
      async flush(): Promise<void> { /* no-op */ }
      close(): void { /* no-op */ }
      static async isConfigSupported(): Promise<{ supported?: boolean }> { return { supported: false }; }
    };
    await expect(
      exportCompositeMp4(scene(), undefined, { ...fakeCanvasDeps(), VideoEncoder: Ctor as never }),
    ).rejects.toThrow('不支持');
  });
});
