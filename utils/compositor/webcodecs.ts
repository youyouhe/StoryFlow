/**
 * WebCodecs composite capture (Hypit 尾声 ①,issue #4) — the browser-side
 * encode/decode exit beside MediaRecorder (utils/compositor/capture.ts).
 *
 * Why a second path: MediaRecorder bakes in REAL TIME (a 60s program takes
 * ~60s) and its MP4 support is spotty — .webm rides the capture stream. The
 * WebCodecs path is frame-stepped and OFFLINE: every frame is seeked, drawn
 * and encoded explicitly, so
 *   · the program exports faster than real time is irrelevant — it exports
 *     EXACTLY durationSec × fps frames (≤1-frame caption accuracy by
 *     construction, not by clock luck),
 *   · the container is true MP4/H.264 (+AAC audio) — what 即梦/Ark upload
 *     prefers — via mp4-muxer (same dependency the canvas path needs none of),
 *   · the plan/draw layers (scene.ts / render.ts) are reused verbatim —
 *     caption logic untouched, Hypit 本体零改动.
 *
 * All WebCodecs seams are injected (`WebCodecsDeps`): the DOM lib on this
 * build has no VideoEncoder typings and node/vitest has no VideoEncoder at
 * all, so the module talks to globals through structural types and tests feed
 * fakes. Refusal, not fallback, inside this file: unsupported → explicit
 * error; the CALLER (ComposeExportModal) decides MediaRecorder fallback via
 * `pickCompositeExport`.
 */
import { compositeDurationSec, compositeSceneAt, type CompositeScene } from './scene';
import { drawBaseFrame, drawCompositeFrame } from './render';

// ── structural seams (no DOM WebCodecs typings on this build) ---------------

/** Minimal EncodedVideoChunk shape mp4-muxer consumes. */
export interface EncodedChunkLike {
  type: 'key' | 'delta';
  timestamp: number; // microseconds
  duration?: number; // microseconds
  byteLength: number;
  copyTo(dest: Uint8Array): void;
}

export interface DecoderConfigMeta {
  decoderConfig?: { codec?: string; description?: Uint8Array };
}

export interface VideoEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(frame: unknown, opts?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
}

export interface AudioEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(data: unknown): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
}

export interface WebCodecsDeps {
  /** Defaults to globalThis.VideoEncoder; absent → unsupported. */
  VideoEncoder?: (new (init: { output: (chunk: EncodedChunkLike, meta: DecoderConfigMeta) => void; error: (e: Error) => void }) => VideoEncoderLike) & {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  };
  AudioEncoder?: (new (init: { output: (chunk: EncodedChunkLike, meta: DecoderConfigMeta) => void; error: (e: Error) => void }) => AudioEncoderLike) & {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  };
  /** Defaults to `new VideoFrame(canvas, {timestamp, duration})`. */
  makeVideoFrame?: (canvas: HTMLCanvasElement, timestampUs: number, durationUs: number) => unknown;
  /** Defaults to AudioContext.decodeAudioData on the base blob. */
  decodeAudio?: (base: Blob) => Promise<{ sampleRate: number; numberOfChannels: number; length: number; getChannelData(ch: number): Float32Array }>;
  /** Frame-clock seam for tests (default: real awaits only). */
  seekTo?: (video: HTMLVideoElement, t: number) => Promise<void>;
  /** Base-footage loader seam for tests (default: capture.ts loadBaseVideo). */
  loadVideo?: (src: Blob | string) => Promise<HTMLVideoElement>;
  /** Canvas factory seam for tests (default: document.createElement + 2d ctx). */
  makeCanvas?: (width: number, height: number) => { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null;
}

// ── support probe / path selector -------------------------------------------

export type CompositeExportPath = 'webcodecs-mp4' | 'mediarecorder-webm';

export const isWebCodecsSupported = (deps: WebCodecsDeps = {}): boolean =>
  typeof (deps.VideoEncoder ?? (globalThis as Record<string, unknown>).VideoEncoder) === 'function';

/** WebCodecs/MP4 first (frame-exact, upload-friendly), MediaRecorder/.webm
 *  fallback; null = neither (caller surfaces the browser gap). */
export const pickCompositeExport = (deps: WebCodecsDeps = {}): CompositeExportPath | null => {
  if (isWebCodecsSupported(deps)) return 'webcodecs-mp4';
  if (typeof MediaRecorder !== 'undefined') return 'mediarecorder-webm';
  return null;
};

// ── encode -------------------------------------------------------------------

export interface WebCodecsCaptureResult {
  blob: Blob;
  mime: 'video/mp4';
  durationSec: number;
  frames: number;
  /** True when the base's own audio was AAC-encoded into the mp4. */
  hasAudio: boolean;
}

const AVC_CODEC = 'avc1.42001f'; // constrained baseline — the widest decoder net
const AAC_CODEC = 'mp4a.40.2';
const AUDIO_PACKET_FRAMES = 1024;
/** Encode ahead cap: keep the encoder's queue bounded on slow machines. */
const MAX_QUEUE = 8;

const defaultSeekTo = (video: HTMLVideoElement, t: number): Promise<void> =>
  new Promise(resolve => {
    const done = (): void => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });

const defaultDecodeAudio = (base: Blob): Promise<AudioBuffer> => {
  if (typeof AudioContext === 'undefined') return Promise.reject(new Error('AudioContext 不可用'));
  const ctx = new AudioContext();
  return base.arrayBuffer()
    .then(buf => ctx.decodeAudioData(buf))
    .finally(() => { void ctx.close(); });
};

/** Bake the composite scene into an MP4 via WebCodecs (offline, frame-stepped). */
export const exportCompositeMp4 = async (
  scene: CompositeScene,
  opts?: {
    onProgress?: (p: { t: number; durationSec: number }) => void;
    signal?: AbortSignal;
  },
  deps: WebCodecsDeps = {},
): Promise<WebCodecsCaptureResult> => {
  const VideoEncoder = deps.VideoEncoder
    ?? ((globalThis as Record<string, unknown>).VideoEncoder as WebCodecsDeps['VideoEncoder']);
  if (!VideoEncoder) throw new Error('本环境无 VideoEncoder(WebCodecs)——请改用 MediaRecorder 路径');

  // ---- base video + duration ----------------------------------------------
  const loadVideo = deps.loadVideo
    ?? (await import('./capture')).loadBaseVideo;
  const base = scene.base ? await loadVideo(scene.base.src) : null;
  const baseDuration = base && Number.isFinite(base.duration) ? base.duration : undefined;
  const durationSec = compositeDurationSec(scene, baseDuration);
  const totalFrames = Math.max(1, Math.round(durationSec * scene.fps));
  const seekTo = deps.seekTo ?? defaultSeekTo;

  // ---- audio decode + encoder probe BEFORE muxer creation -------------------
  // (mp4-muxer 要求音轨在构造时声明——不能编到一半才决定有没有音轨)
  const AudioEncoder = deps.AudioEncoder
    ?? ((globalThis as Record<string, unknown>).AudioEncoder as WebCodecsDeps['AudioEncoder']);
  let decodedAudio: Awaited<ReturnType<NonNullable<WebCodecsDeps['decodeAudio']>>> | null = null;
  let audioSupported = false;
  if (base && AudioEncoder) {
    try {
      const decode = deps.decodeAudio ?? (b => defaultDecodeAudio(b as Blob));
      decodedAudio = await decode(scene.base!.src instanceof Blob ? (scene.base!.src as Blob) : new Blob([]));
      audioSupported = true;
      if (AudioEncoder.isConfigSupported) {
        audioSupported = !!(await AudioEncoder.isConfigSupported({
          codec: AAC_CODEC,
          sampleRate: decodedAudio.sampleRate,
          numberOfChannels: Math.min(2, decodedAudio.numberOfChannels),
          bitrate: 128_000,
        }))?.supported;
      }
    } catch {
      decodedAudio = null; // audio is best-effort — video-only mp4 stands
      audioSupported = false;
    }
  }

  // ---- muxer + video encoder ------------------------------------------------
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: scene.width, height: scene.height, frameRate: scene.fps },
    ...(decodedAudio && audioSupported
      ? {
          audio: {
            codec: 'aac' as const,
            sampleRate: decodedAudio.sampleRate,
            numberOfChannels: Math.min(2, decodedAudio.numberOfChannels),
          },
        }
      : {}),
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder!({
    output: (chunk, meta) => muxer.addVideoChunk(chunk as never, meta as never),
    error: e => { throw new Error(`VideoEncoder: ${e.message}`); },
  });
  const videoConfig = { codec: AVC_CODEC, width: scene.width, height: scene.height, framerate: scene.fps };
  if (VideoEncoder.isConfigSupported) {
    const probe = await VideoEncoder.isConfigSupported(videoConfig);
    if (!probe?.supported) throw new Error(`编码器不支持 ${AVC_CODEC}@${scene.width}×${scene.height}`);
  }
  encoder.configure(videoConfig);

  const makeFrame = deps.makeVideoFrame
    ?? ((canvas: HTMLCanvasElement, timestampUs: number, durationUs: number) => {
      const VF = (globalThis as Record<string, unknown>).VideoFrame as
        | (new (src: HTMLCanvasElement, init: { timestamp: number; duration?: number }) => unknown)
        | undefined;
      if (!VF) throw new Error('本环境无 VideoFrame(WebCodecs)');
      return new VF(canvas, { timestamp: timestampUs, duration: durationUs });
    });

  // ---- frame loop (seek → draw → encode) ------------------------------------
  const makeCanvas = deps.makeCanvas
    ?? ((w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d');
      return cx ? { canvas: c, ctx: cx } : null;
    });
  const made = makeCanvas(scene.width, scene.height);
  if (!made) throw new Error('无法创建画布');
  const canvas = made.canvas;
  const ctx = made.ctx;

  const frameDurUs = Math.round(1e6 / scene.fps);
  for (let i = 0; i < totalFrames; i++) {
    if (opts?.signal?.aborted) {
      encoder.close();
      throw new Error('导出已取消');
    }
    const t = Math.min(i / scene.fps, durationSec);
    if (base) {
      await seekTo(base, Math.min(t, (baseDuration ?? t)));
      drawBaseFrame(ctx, base, scene.width, scene.height, scene.base!.fit, scene.background);
      drawCompositeFrame(ctx, compositeSceneAt(scene, t), scene.width, scene.height);
    } else {
      drawCompositeFrame(ctx, compositeSceneAt(scene, t), scene.width, scene.height, scene.background);
    }
    const frame = makeFrame(canvas, i * frameDurUs, frameDurUs);
    encoder.encode(frame, { keyFrame: i % (scene.fps * 2) === 0 });
    (frame as { close?: () => void }).close?.();
    opts?.onProgress?.({ t: Math.min(t, durationSec), durationSec });
    while (encoder.encodeQueueSize > MAX_QUEUE) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // ---- audio: base → PCM → AAC(音轨已在 muxer 声明;编码失败即真错) ---------
  let hasAudio = false;
  if (base && decodedAudio && audioSupported && AudioEncoder) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk as never, meta as never),
      error: e => { throw new Error(`AudioEncoder: ${e.message}`); },
    });
    audioEncoder.configure({
      codec: AAC_CODEC,
      sampleRate: decodedAudio.sampleRate,
      numberOfChannels: Math.min(2, decodedAudio.numberOfChannels),
      bitrate: 128_000,
    });
    const channels = Math.min(2, decodedAudio.numberOfChannels);
    const totalSamples = Math.min(
      decodedAudio.length,
      Math.ceil(durationSec * decodedAudio.sampleRate),
    );
    for (let off = 0; off < totalSamples; off += AUDIO_PACKET_FRAMES) {
      const n = Math.min(AUDIO_PACKET_FRAMES, totalSamples - off);
      const planar = new Float32Array(n * channels);
      for (let ch = 0; ch < channels; ch++) {
        planar.set(decodedAudio.getChannelData(ch).subarray(off, off + n), ch * n);
      }
      const AD = (globalThis as Record<string, unknown>).AudioData as
        | (new (init: Record<string, unknown>) => unknown)
        | undefined;
      if (!AD) throw new Error('本环境无 AudioData(WebCodecs)');
      const ad = new AD({
        format: 'f32-planar',
        sampleRate: decodedAudio.sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((off / decodedAudio.sampleRate) * 1e6),
        data: planar,
      });
      audioEncoder.encode(ad);
      (ad as { close?: () => void }).close?.();
    }
    await audioEncoder.flush();
    audioEncoder.close();
    hasAudio = true;
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  if (base && typeof base.src === 'string' && base.src.startsWith('blob:')) URL.revokeObjectURL(base.src);

  return {
    blob: new Blob([target.buffer as ArrayBuffer], { type: 'video/mp4' }),
    mime: 'video/mp4',
    durationSec,
    frames: totalFrames,
    hasAudio,
  };
};

