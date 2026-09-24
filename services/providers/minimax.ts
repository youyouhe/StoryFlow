/**
 * MiniMax provider — H3 / H3-Max video + image-01 (P4).
 *
 * Deployment: direct browser BYOK (api.minimaxi.com / api.minimax.io; the dev
 * server proxies the CN host — see vite.config.ts minimaxProxy). Model limits
 * are the official 刊例 contracts and REFUSE out-of-range requests rather
 * than clamping them (acceptance: duration=20 → 拒绝并说明).
 */
import { createH3Task, queryH3Task, uploadH3Video, generateImages, type H3SubmitParams } from '../minimaxService';
import { accepts, refuses, type CapabilityId, type ImageRequest, type Provider, type SupportsResult, type VideoSubmitRequest, type VideoTaskRef, type VideoTaskStatus } from './types';

interface VideoModelLimits {
  outputSeconds: { min: number; max: number; integer: true };
  resolutions: string[];
}

const modelLimits = (model: string | undefined): VideoModelLimits =>
  model?.includes('Max')
    ? { outputSeconds: { min: 5, max: 15, integer: true }, resolutions: ['480P', '768P'] }
    : { outputSeconds: { min: 4, max: 15, integer: true }, resolutions: ['768P', '2K'] };

const MAX_INPUT_VIDEO_SECONDS = 15;
const MAX_REFERENCE_IMAGES = 9;

export const minimaxProvider: Provider = {
  id: 'minimax',
  label: 'MiniMax（H3 视频 / image-01）',
  capabilities: ['video.generate', 'image.generate'],
  deployment: 'direct',
  deploymentNote: '浏览器直连（CN 域走 dev proxy）；CN/intl 端点由 endpoint.config.baseUrl 切换',
  transientRetry: true,

  supports(capability: CapabilityId, request: unknown): SupportsResult {
    if (capability === 'image.generate') return accepts();
    const req = request as VideoSubmitRequest;
    const limits = modelLimits(req.model);
    const { min, max } = limits.outputSeconds;
    const label = req.model?.includes('Max') ? 'H3-Max' : 'H3';
    if (!Number.isFinite(req.outputSeconds) || req.outputSeconds < min || req.outputSeconds > max) {
      return refuses(`${label} 单段输出 ${min}–${max}s，收到 ${req.outputSeconds}s——请分链生成或换模型（不会静默截断）`);
    }
    if (limits.outputSeconds.integer && !Number.isInteger(req.outputSeconds)) {
      return refuses(`${label} 输出必须是整数秒，收到 ${req.outputSeconds}s`);
    }
    if (!limits.resolutions.includes(req.resolution)) {
      return refuses(`${label} 不支持分辨率 ${req.resolution}（可选：${limits.resolutions.join('/')}）`);
    }
    if ((req.videoSeconds ?? 0) > MAX_INPUT_VIDEO_SECONDS) {
      return refuses(`参考视频上限 ${MAX_INPUT_VIDEO_SECONDS}s，收到 ${req.videoSeconds}s`);
    }
    const images = req.referenceImages?.length ?? 0;
    if (images > MAX_REFERENCE_IMAGES) {
      return refuses(`参考图上限 ${MAX_REFERENCE_IMAGES} 张，收到 ${images} 张`);
    }
    return accepts();
  },

  async submitVideo(ctx, req: VideoSubmitRequest): Promise<VideoTaskRef> {
    const cfg = { apiKey: ctx.apiKey, baseUrl: String(ctx.config.baseUrl ?? 'https://api.minimaxi.com') };
    const params: H3SubmitParams = {
      prompt: req.prompt,
      videoBlob: req.videoBlob,
      videoSeconds: req.videoSeconds ?? 0,
      referenceImages: req.referenceImages ?? [],
      resolution: req.resolution as H3SubmitParams['resolution'],
      outputSeconds: req.outputSeconds,
      model: req.model,
    };
    const fileUri = req.videoBlob ? await uploadH3Video(cfg, req.videoBlob) : undefined;
    const taskId = await createH3Task(cfg, params, fileUri);
    return { taskId };
  },

  async pollVideo(ctx, ref: VideoTaskRef): Promise<VideoTaskStatus> {
    const cfg = { apiKey: ctx.apiKey, baseUrl: String(ctx.config.baseUrl ?? 'https://api.minimaxi.com') };
    return queryH3Task(cfg, ref.taskId);
  },

  async generateImage(ctx, req: ImageRequest) {
    const images = await generateImages(
      { apiKey: ctx.apiKey, baseUrl: String(ctx.config.baseUrl ?? 'https://api.minimaxi.com') },
      req.prompt,
      {
        n: req.n ?? 1,
        aspectRatio: req.aspectRatio ?? '16:9',
        subjectReference: req.subjectReference,
        references: req.references,
      },
    );
    return images.map(im => ({ blob: im.blob as Blob }));
  },
};
