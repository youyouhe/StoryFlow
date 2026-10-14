/**
 * ffmpeg 导出链壳(docs/storyflow-ir-p3.md §2.4):
 *   · Pro:`mapMixToProSegmentCuts` 产物 → `exportProCut`(段内 amix → concat)
 *   · Express:`concatClipsToMp4` 顺序拼(同参 -c copy / 混参归一化)
 * `getAudioFrom` 把 audioExec 的 `clipBlobs` 接成 `exportProCut` 的取键函数。
 */
import type { ProSegmentCut, ExportProgress } from '../../services/videoExport';
import type { ExportExecDeps } from './types';

/** audioExec 产物 → exportProCut 的 getAudio(会话存储取键口径)。 */
export const getAudioFrom =
  (clips: Record<string, Blob>) =>
    (key: string): Blob | undefined =>
      clips[key];

export const exportProCutWithCuts = async (
  cuts: ProSegmentCut[],
  deps: ExportExecDeps,
  opts: {
    getAudio?: (key: string) => Blob | undefined;
    onProgress?: (p: ExportProgress & { segDone?: number; segTotal?: number }) => void;
  } = {},
): Promise<Blob> =>
  deps.ports.exportProCut(cuts, {
    getAudio: opts.getAudio ?? (() => undefined),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });

export const concatExpressClips = async (
  clipUrls: string[],
  deps: ExportExecDeps,
  opts: { onProgress?: (p: ExportProgress) => void } = {},
): Promise<Blob> =>
  deps.ports.concatClipsToMp4(clipUrls, opts.onProgress);


// ── P14 字幕烧录(libass 边界记档见 docs/storyflow-ir-p14.md §1) ────────────

/** `ffmpeg -vf subtitles=...` 参数构造(纯函数):路径统一正斜杠并转义盘符
 *  冒号;force_style 可选(ASS 样式覆盖)。 */
export const subtitlesFilterArgs = (
  subtitlePath: string,
  opts: { forceStyle?: string } = {},
): string[] => {
  const escaped = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const arg = opts.forceStyle
    ? `subtitles='${escaped}':force_style='${opts.forceStyle}'`
    : `subtitles='${escaped}'`;
  return ['-vf', arg];
};

/** 烧录执行步:video + 字幕文本 → 带字幕 mp4(port 未绑定即抛——拒绝而非钳制)。 */
export const burnSubtitlesInto = async (
  video: Blob,
  subtitles: string,
  deps: ExportExecDeps,
  opts: { format: 'srt' | 'ass'; style?: string } = { format: 'ass' },
): Promise<Blob> => {
  const burn = deps.ports.burnSubtitles;
  if (!burn) {
    throw new Error('未绑定字幕烧录(默认 wasm core 无 libass)——需全量 ffmpeg 核心,见 docs/storyflow-ir-p14.md §1');
  }
  return burn({ video, subtitles, format: opts.format, ...(opts.style ? { style: opts.style } : {}) });
};
