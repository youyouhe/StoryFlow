/**
 * ComfyUI provider — self-hosted H3 workflows (R2V/T2V) on the user's GPU
 * box (P4). Deployment 'self-hosted': the browser talks to the Comfy server
 * directly (LAN/https); no API billing, no credential slot. The workflow
 * graphs live in endpoint config (not secrets) and the caller builds the
 * prompt (including the <Picture N>/<Video 1> reference tags).
 */
import { comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask, comfyUploadImage } from '../comfyService';
import { accepts, refuses, type CapabilityId, type Provider, type SupportsResult, type VideoSubmitRequest, type VideoTaskRef, type VideoTaskStatus } from './types';

export const comfyProvider: Provider = {
  id: 'comfy',
  label: 'ComfyUI（自托管 H3 工作流）',
  capabilities: ['video.generate'],
  deployment: 'self-hosted',
  deploymentNote: '用户 GPU 机上的 ComfyUI；endpoint.config 携带 serverUrl 与 R2V/T2V 工作流 JSON',
  transientRetry: true,

  supports(capability: CapabilityId, request: unknown): SupportsResult {
    if (capability !== 'video.generate') return refuses(`comfy 不提供能力 ${capability}`);
    const req = request as VideoSubmitRequest;
    if (!Number.isFinite(req.outputSeconds) || req.outputSeconds <= 0) {
      return refuses(`输出时长必须为正（收到 ${req.outputSeconds}s）`);
    }
    // Self-hosted graphs own their own bounds — the provider refuses nothing
    // it cannot know; H3 range rules live on the model-capable API providers.
    return accepts();
  },

  async submitVideo(ctx, req: VideoSubmitRequest): Promise<VideoTaskRef> {
    const serverUrl = String(ctx.config.serverUrl ?? '');
    if (!serverUrl) throw new Error('ComfyUI 端点缺少 serverUrl');
    const useT2V = req.extras?.workflow === 't2v' || !req.referenceImages?.length;
    const graphJson = String(useT2V ? (ctx.config.workflowT2V ?? '') : (ctx.config.workflowR2V ?? ''));
    if (!graphJson) throw new Error(`ComfyUI 端点缺少 ${useT2V ? 'workflowT2V' : 'workflowR2V'} 图`);

    const refNames: string[] = [];
    let i = 0;
    for (const image of req.referenceImages ?? []) {
      refNames.push(await comfyUploadImage({ serverUrl }, image.blob, `sf-ref-${Date.now()}-${i++}.png`));
    }
    const videoName = req.videoBlob
      ? await comfyUploadImage({ serverUrl }, req.videoBlob, `sf-white-${Date.now()}.mp4`)
      : undefined;
    const graph = comfyPatchWorkflow(graphJson, {
      prompt: req.prompt,
      refImageNames: refNames,
      refVideoNames: videoName ? [videoName] : undefined,
      stripFirstFrame: req.extras?.stripFirstFrame === true,
    });
    const promptId = await comfyQueuePrompt({ serverUrl }, graph);
    return { taskId: promptId };
  },

  async pollVideo(ctx, ref: VideoTaskRef): Promise<VideoTaskStatus> {
    return comfyQueryTask({ serverUrl: String(ctx.config.serverUrl ?? '') }, ref.taskId);
  },
};
