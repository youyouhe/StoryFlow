/**
 * Express pipeline services (docs/pipeline-two-mode.md §1) — the gacha
 * workbench's two generation steps, built entirely on existing adapters:
 *
 *   first frame  → generateImages (MiniMax image-01 | FAL)  — the block's
 *                  imagePrompt (+ StyleHead prefix already baked in upstream)
 *   I2V clip     → the ComfyUI I2V graph: upload the first frame, patch
 *                  first_frame + prompt + duration + a fresh seed, queue,
 *                  poll history until the /view URL appears.
 *
 * The workbench owns per-shot state; these helpers are stateless.
 */
import { generateImages, ImageProvider } from './minimaxService';
import { comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask, ComfyConfig, ComfyTaskStatus } from './comfyService';

export interface ExpressImageConfig {
  provider: ImageProvider;
  minimaxApiKey: string;
  minimaxBaseUrl: string;
  falKey?: string;
  falModel?: string;
  falQuality?: 'low' | 'high';
}

/** Generate the shot's first frame. Returns a blob for upload + a display URL. */
export async function generateFirstFrame(
  cfg: ExpressImageConfig,
  prompt: string,
  aspectRatio = '16:9',
): Promise<{ blob: Blob; url: string }> {
  const imgs = await generateImages({
    provider: cfg.provider,
    apiKey: cfg.minimaxApiKey,
    baseUrl: cfg.minimaxBaseUrl,
    falKey: cfg.falKey,
    falModel: cfg.falModel,
    falQuality: cfg.falQuality,
  }, prompt, { n: 1, aspectRatio });
  const img = imgs[0];
  if (!img) throw new Error('生图服务没有返回图片');
  return { blob: img.blob, url: img.url };
}

export interface ExpressI2VResult {
  videoUrl: string;
  promptId: string;
}

/** Upload the first frame, patch the I2V graph, queue, and poll to completion.
 *  `onStatus` reports queued/running transitions for the workbench badge.
 *  H3 output window: 4–15s — `durationSeconds` is clamped before patching. */
export async function generateI2V(
  comfyCfg: ComfyConfig,
  graphJson: string,
  params: { prompt: string; firstFrameBlob: Blob; durationSeconds?: number },
  onStatus?: (s: ComfyTaskStatus) => void,
): Promise<ExpressI2VResult> {
  const duration = Math.max(4, Math.min(15, Math.round(params.durationSeconds ?? 5)));
  const frameName = await comfyUploadImage(comfyCfg, params.firstFrameBlob, `sf-express-${Date.now()}.png`);
  const graph = comfyPatchWorkflow(graphJson, {
    prompt: params.prompt,
    firstFrameName: frameName,
    durationSeconds: duration,
    randomizeSeed: true,
  });
  const promptId = await comfyQueuePrompt(comfyCfg, graph);
  onStatus?.({ status: 'queued' });
  // Poll history every 3s — ComfyUI moves finished prompts into /history.
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await comfyQueryTask(comfyCfg, promptId);
    onStatus?.(s);
    if (s.status === 'succeeded' && s.videoUrl) return { videoUrl: s.videoUrl, promptId };
    if (s.status === 'failed') throw new Error(s.errorMessage ?? 'ComfyUI 生成失败');
  }
}
