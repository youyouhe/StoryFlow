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
import type { VisualExecPorts, AudioExecPorts, ExportExecPorts } from './types';

export const defaultVisualPorts = (): VisualExecPorts => ({
  generateImages, uploadH3Video, createH3Task, queryH3Task,
  comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask,
});

export const defaultAudioPorts = (): AudioExecPorts => ({
  synthesizeSpeech, concatWavs, wavDuration, resolveSfx, requestMusic, pollMusic,
});

export const defaultExportPorts = (): ExportExecPorts => ({
  exportProCut, concatClipsToMp4,
});
