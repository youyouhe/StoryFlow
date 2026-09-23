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
