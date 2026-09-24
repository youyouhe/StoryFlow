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
