/**
 * Video export (docs/pipeline-two-mode.md §5) — ffmpeg.wasm sequential concat
 * for the Express pipeline (and the video leg of Pro).
 *
 * Loading strategy (click-time, zero bundle cost): UMD builds from unpkg,
 * core wasm via blob URLs. 0.12.6 pinned — its vanilla-script recipe works
 * without a classWorkerURL. If load fails (offline / CDN blocked), callers
 * fall back to downloadConcatFallback: clips + concat_list.txt + a README.
 *
 * Concat strategy:
 *   - all clips mp4 → concat demuxer with -c copy (stream copy, instant)
 *   - mixed containers (ComfyUI may emit webm) → normalize each clip to
 *     mp4 (libx264 veryfast) first, then concat-copy. Two passes but only
 *     when needed.
 * Pro-mode audio muxing (TTS/BGM/SFX amix) builds on the same ffmpeg
 * instance — documented as the next step, not in this v1.
 */

const FFMPEG_UMD = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js';
const UTIL_UMD = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/util.js';
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

/* Minimal shape of the UMD FFmpeg instance we use. */
interface FfmpegLike {
  load(opts: { coreURL: string; wasmURL: string; classWorkerURL?: string }): Promise<boolean>;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array | string>;
  exec(args: string[]): Promise<number>;
  deleteFile(path: string): Promise<boolean>;
  on(event: 'log' | 'progress', cb: (e: never) => void): void;
}

interface FfmpegGlobal {
  FFmpeg: new () => FfmpegLike;
}
interface UtilGlobal {
  toBlobURL(url: string, mime: string): Promise<string>;
}

let ffmpegPromise: Promise<FfmpegLike> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

async function loadFFmpeg(log?: (line: string) => void): Promise<FfmpegLike> {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    log?.('加载 ffmpeg.wasm(首次约 25MB)…');
    const w = window as unknown as { FFmpegWASM?: FfmpegGlobal; FFmpegUtil?: UtilGlobal };
    if (!w.FFmpegWASM) await loadScript(FFMPEG_UMD);
    if (!w.FFmpegUtil) await loadScript(UTIL_UMD);
    if (!w.FFmpegWASM || !w.FFmpegUtil) throw new Error('ffmpeg.wasm 加载失败(CDN 不可达?)');
    const ffmpeg = new w.FFmpegWASM.FFmpeg();
    const { toBlobURL } = w.FFmpegUtil;
    const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');
    try {
      await ffmpeg.load({ coreURL, wasmURL });
    } catch {
      // Some deployments need the class worker as a blob too — retry once.
      const classWorkerURL = await toBlobURL('https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/814.ffmpeg.js', 'text/javascript');
      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
    }
    log?.('ffmpeg 就绪。');
    return ffmpeg;
  })();
  ffmpegPromise.catch(() => { ffmpegPromise = null; }); // allow retry after failure
  return ffmpegPromise;
}

export interface ExportProgress {
  /** 0..1 over the whole export (fetch → normalize → concat). */
  phase: 'loading' | 'fetching' | 'concat' | 'done';
  done: number;
  total: number;
  line?: string;
}

const extOf = (url: string): string => {
  const m = url.split('?')[0].match(/\.(mp4|webm|mov|mkv)$/i);
  return (m?.[1] ?? 'mp4').toLowerCase();
};

/** Sequential concat of clip URLs → mp4 Blob. Mixed codecs are normalized to
 *  H.264 mp4 first; same-codec sets go through concat -c copy untouched. */
export async function concatClipsToMp4(
  clipUrls: string[],
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  if (!clipUrls.length) throw new Error('没有可拼接的镜头');
  const ffmpeg = await loadFFmpeg(line => onProgress?.({ phase: 'loading', done: 0, total: clipUrls.length, line }));

  onProgress?.({ phase: 'fetching', done: 0, total: clipUrls.length });
  const names: string[] = [];
  for (let i = 0; i < clipUrls.length; i++) {
    const res = await fetch(clipUrls[i]);
    if (!res.ok) throw new Error(`镜头 ${i + 1} 拉取失败 (HTTP ${res.status})——视频 URL 是会话级的,请在同一 ComfyUI 会话内导出`);
    const ext = extOf(clipUrls[i]);
    const name = `in_${String(i + 1).padStart(3, '0')}.${ext}`;
    await ffmpeg.writeFile(name, new Uint8Array(await res.arrayBuffer()));
    names.push(name);
    onProgress?.({ phase: 'fetching', done: i + 1, total: clipUrls.length });
  }

  const allMp4 = names.every(n => n.endsWith('.mp4'));
  const concatList = names.map(n => `file '${n}'`).join('\n');
  await ffmpeg.writeFile('list.txt', new TextEncoder().encode(concatList));

  const emit = (phase: ExportProgress['phase'], line: string) =>
    onProgress?.({ phase, done: 0, total: 1, line });

  if (allMp4) {
    emit('concat', '同参数 mp4——concat -c copy 直拼…');
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4']);
  } else {
    // Mixed codecs: normalize each clip, then concat-copy the normals.
    emit('concat', '混合编码——先归一化为 H.264 mp4…');
    const normalized: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const out = `norm_${String(i + 1).padStart(3, '0')}.mp4`;
      await ffmpeg.exec(['-i', names[i], '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
      normalized.push(out);
      onProgress?.({ phase: 'concat', done: i + 1, total: names.length });
    }
    await ffmpeg.writeFile('list.txt', new TextEncoder().encode(normalized.map(n => `file '${n}'`).join('\n')));
    emit('concat', '拼接…');
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4']);
  }
  const data = await ffmpeg.readFile('out.mp4');
  if (typeof data === 'string') throw new Error('ffmpeg 输出异常(文本)');
  onProgress?.({ phase: 'done', done: 1, total: 1 });
  return new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
}

/** Fallback when ffmpeg.wasm cannot load: hand the user the clips plus a
 *  ready-made concat list and the one-line command to run locally. */
export async function downloadConcatFallback(clipUrls: string[]): Promise<number> {
  const list = clipUrls
    .map((u, i) => `file 'shot_${String(i + 1).padStart(3, '0')}.${extOf(u)}'`)
    .join('\n');
  const a = document.createElement('a');
  for (let i = 0; i < clipUrls.length; i++) {
    const res = await fetch(clipUrls[i]);
    const blob = await res.blob();
    a.href = URL.createObjectURL(blob);
    a.download = `shot_${String(i + 1).padStart(3, '0')}.${extOf(clipUrls[i])}`;
    a.click();
    await new Promise(r => setTimeout(r, 350)); // let the browser settle
    URL.revokeObjectURL(a.href);
  }
  const readme = `StoryFlow Express 导出回退包\n\nffmpeg.wasm 不可用(离线或 CDN 被拦)。本地拼接方法:\n\n  1. 把本目录所有 shot_*.mp4 与 concat_list.txt 放同一文件夹\n  2. 运行: ffmpeg -f concat -safe 0 -i concat_list.txt -c copy storyflow-express.mp4\n`;
  const txt = new Blob([`${list}\n\n${readme}`], { type: 'text/plain' });
  a.href = URL.createObjectURL(txt);
  a.download = 'concat_list.txt';
  a.click();
  URL.revokeObjectURL(a.href);
  return clipUrls.length;
}


// ---- Pro mode: per-segment audio mux + concat (docs §4) --------------------

import { concatWavs } from './glmTtsService';
import { getAudio } from './proAudioStore';

const getStoredAudio = (key: string): Blob | undefined => getAudio(key);

export interface ProSegmentCut {
  videoUrl: string;
  segKey: string;
  /** session keys for the segment's dialogue line blobs (in order) */
  ttsKeys?: string[];
  bgmUrl?: string;
  sfx?: { blob: Blob; atMs?: number }[];
}

/** Mux one segment: video + (dialogue wav | looped BGM | delayed SFX) → mp4.
 *  Falls back to a straight copy when the segment has no audio at all. */
async function muxSegment(
  ffmpeg: FfmpegLike,
  index: number,
  videoUrl: string,
  cut: { ttsKeys?: string[]; bgmUrl?: string; sfx?: { blob: Blob; atMs?: number }[] },
  onProgress?: (p: ExportProgress) => void,
): Promise<string> {
  const out = `norm_${String(index + 1).padStart(3, '0')}.mp4`;
  const hasDialogue = !!cut.ttsKeys?.length;
  const hasBgm = !!cut.bgmUrl;
  const sfx = cut.sfx ?? [];
  if (!hasDialogue && !hasBgm && !sfx.length) {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`段 ${index + 1} 视频拉取失败 (HTTP ${res.status})`);
    await ffmpeg.writeFile(out, new Uint8Array(await res.arrayBuffer()));
    return out;
  }
  const args: string[] = ['-i', videoUrl];
  if (hasDialogue) {
    const blobs = (cut.ttsKeys ?? [])
      .map(k => getStoredAudio(k))
      .filter((b): b is Blob => !!b);
    const dialogue = blobs.length > 1 ? await concatWavs(blobs) : blobs[0];
    await ffmpeg.writeFile(`d_${index + 1}.wav`, new Uint8Array(await dialogue.arrayBuffer()));
    args.push('-i', `d_${index + 1}.wav`);
  }
  if (hasBgm) {
    const res = await fetch(cut.bgmUrl!);
    if (!res.ok) throw new Error(`段 ${index + 1} BGM 拉取失败 (HTTP ${res.status})`);
    await ffmpeg.writeFile(`b_${index + 1}.src`, new Uint8Array(await res.arrayBuffer()));
    args.push('-stream_loop', '-1', '-i', `b_${index + 1}.src`);
  }
  for (let s = 0; s < sfx.length; s++) {
    await ffmpeg.writeFile(`s_${index + 1}_${s}.wav`, new Uint8Array(await sfx[s].blob.arrayBuffer()));
    args.push('-i', `s_${index + 1}_${s}.wav`);
  }
  const stemCount = (hasDialogue ? 1 : 0) + (hasBgm ? 1 : 0);
  const sfxStart = 1 + stemCount - (hasBgm ? 0 : 0) + (hasDialogue ? 0 : 0) - (hasDialogue ? 0 : 0);
  // input indices: 0 video, then stems (dialogue, bgm) then sfx
  const dialogueIdx = hasDialogue ? 1 : -1;
  const bgmIdx = hasBgm ? (hasDialogue ? 2 : 1) : -1;
  const sfxBase = 1 + stemCount;
  const parts: string[] = [];
  const labels: string[] = [];
  if (hasDialogue) { parts.push(`[${dialogueIdx}:a]volume=1.0[ad]`); labels.push('[ad]'); }
  if (hasBgm) { parts.push(`[${bgmIdx}:a]volume=0.25[ab]`); labels.push('[ab]'); }
  for (let s = 0; s < sfx.length; s++) {
    const at = Math.max(0, Math.round(sfx[s].atMs ?? 0));
    parts.push(`[${sfxBase + s}:a]adelay=${at}:all=1,volume=0.8[as${s}]`);
    labels.push(`[as${s}]`);
  }
  parts.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`);
  args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out);
  onProgress?.({ phase: 'concat', done: index, total: index + 1, line: `混音段 ${index + 1}…` });
  await ffmpeg.exec(args);
  void sfxStart;
  return out;
}

/** Pro cut: mux every segment's audio under its video, then concat-copy. */
export async function exportProCut(
  segments: ProSegmentCut[],
  opts: {
    getAudio: (key: string) => Blob | undefined;
    onProgress?: (p: ExportProgress & { segDone?: number; segTotal?: number }) => void;
  },
): Promise<Blob> {
  const usable = segments.filter(s => s.videoUrl);
  if (!usable.length) throw new Error('没有可导出的成片段——先提交生成并等待完成。');
  const ffmpeg = await loadFFmpeg(line => opts.onProgress?.({ phase: 'loading', done: 0, total: usable.length, line }));
  const normalized: string[] = [];
  for (let i = 0; i < usable.length; i++) {
    const seg = usable[i];
    const cut = {
      ttsKeys: seg.ttsKeys,
      bgmUrl: seg.bgmUrl,
      sfx: (seg.sfx ?? []).map(s => ({ blob: s.blob, atMs: s.atMs })),
    };
    const name = await muxSegment(ffmpeg, i, seg.videoUrl, cut, mLine =>
      opts.onProgress?.({ phase: 'concat', done: i, total: usable.length, line: mLine.line }));
    normalized.push(name);
    opts.onProgress?.({ phase: 'concat', done: i + 1, total: usable.length, segDone: i + 1, segTotal: usable.length });
  }
  await ffmpeg.writeFile('plist.txt', new TextEncoder().encode(normalized.map(n => `file '${n}'`).join('\n')));
  opts.onProgress?.({ phase: 'concat', done: normalized.length, total: normalized.length, line: '拼接成片…' });
  await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'plist.txt', '-c', 'copy', 'pro_out.mp4']);
  const data = await ffmpeg.readFile('pro_out.mp4');
  if (typeof data === 'string') throw new Error('ffmpeg 输出异常(文本)');
  opts.onProgress?.({ phase: 'done', done: 1, total: 1 });
  return new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
}
