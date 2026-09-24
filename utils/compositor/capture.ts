/**
 * Composite capture (P5a) — bake overlays into a finished video with zero
 * generation cost.
 *
 * Implementation: canvas + MediaRecorder (Chromium/WebView2 real-time bake;
 * a 60s program exports in ~60s, inside the 5-minute budget). The plan/draw
 * layers are pure, so a WebCodecs or server-ffmpeg capture can replace this
 * file without touching caption logic. Audio rides the capture stream from
 * the base video's own track (the mix stays in the browser graph — the
 * "画/音/混流三独立" testability from Hypit holds at the plan layer).
 */
import { compositeDurationSec, compositeSceneAt, type CompositeScene } from './scene';
import { drawBaseFrame, drawCompositeFrame } from './render';

export interface CaptureProgress {
  t: number;
  durationSec: number;
}

export interface CaptureOptions {
  onProgress?: (p: CaptureProgress) => void;
  signal?: AbortSignal;
}

export interface CaptureResult {
  blob: Blob;
  mime: string;
  durationSec: number;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export const pickCaptureMime = (): string | null => {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) ?? null;
};

const loadBaseVideo = (src: Blob | string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = false;
    video.playsInline = true;
    video.src = typeof src === 'string' ? src : URL.createObjectURL(src);
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('底版视频无法加载'));
  });

/** Bake the composite scene into one downloadable clip. */
export const exportComposite = async (scene: CompositeScene, opts?: CaptureOptions): Promise<CaptureResult> => {
  const mime = pickCaptureMime();
  if (!mime) throw new Error('当前浏览器不支持 MediaRecorder 视频编码（请用 Chrome/Edge 或桌面端）');

  const base = scene.base ? await loadBaseVideo(scene.base.src) : null;
  const baseDuration = base && Number.isFinite(base.duration) ? base.duration : undefined;
  const durationSec = compositeDurationSec(scene, baseDuration);

  const canvas = document.createElement('canvas');
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  // stream = canvas frames (+ base audio when present)
  const stream = canvas.captureStream(scene.fps);
  let audioCtx: AudioContext | null = null;
  if (base) {
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaElementSource(base);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    } catch {
      audioCtx = null; // no audio mixing available — video-only is acceptable
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
  recorder.start(500);

  const startedAt = performance.now();
  if (base) {
    base.currentTime = 0;
    await base.play().catch(() => { /* autoplay policies: user gesture already happened */ });
  }

  await new Promise<void>(resolve => {
    const tick = (): void => {
      const t = base ? base.currentTime : (performance.now() - startedAt) / 1000;
      if (base) drawBaseFrame(ctx, base, scene.width, scene.height, scene.base!.fit, scene.background);
      drawCompositeFrame(
        ctx, compositeSceneAt(scene, t), scene.width, scene.height,
        base ? undefined : scene.background, // base already painted
      );
      opts?.onProgress?.({ t: Math.min(t, durationSec), durationSec });
      if (opts?.signal?.aborted || t >= durationSec) {
        resolve();
        return;
      }
      // video frame callbacks keep draws presentation-accurate when a base
      // video drives the clock (≤1-frame caption sync)
      const anyBase = base as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | null;
      if (anyBase?.requestVideoFrameCallback) anyBase.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    };
    tick();
  });

  base?.pause();
  recorder.stop();
  await stopped;
  audioCtx?.close().catch(() => {});
  stream.getTracks().forEach(track => track.stop());
  if (base && typeof base.src === 'string' && base.src.startsWith('blob:')) URL.revokeObjectURL(base.src);

  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime, durationSec };
};
