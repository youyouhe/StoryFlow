/**
 * 真执行器组装根 —— ports 绑定真实 services 函数(测试注入 mock 不经此)。
 * 不碰生产:只 import 公开签名,不改 services。
 */
import {
  generateImages, uploadH3Video, createH3Task, queryH3Task,
} from '../../services/minimaxService';
import {
  comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask,
} from '../../services/comfyService';
import { synthesizeSpeech, concatWavs, wavDuration } from '../../services/glmTtsService';
import { resolveSfx } from '../../services/sfxService';
import { requestMusic, pollMusic } from '../../services/falMusicService';
import { exportProCut, concatClipsToMp4 } from '../../services/videoExport';
import { createAlignClient } from '../align/client';
import type { VisualExecPorts, AudioExecPorts, ExportExecPorts } from './types';

export const defaultVisualPorts = (): VisualExecPorts => ({
  generateImages, uploadH3Video, createH3Task, queryH3Task,
  comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask,
});

export const defaultAudioPorts = (opts: { alignEndpoint?: string } = {}): AudioExecPorts => ({
  synthesizeSpeech, concatWavs, wavDuration, resolveSfx, requestMusic, pollMusic,
  // P8:配 endpoint 才绑定真客户端(WhisperX 类,强制对齐契约);缺省不绑,
  // ② 编译照常回退字素比例(P5 口径)。
  ...(opts.alignEndpoint
    ? { alignTake: createAlignClient({ endpoint: opts.alignEndpoint }) }
    : {}),
});

export const defaultExportPorts = (): ExportExecPorts => ({
  exportProCut, concatClipsToMp4,
});
