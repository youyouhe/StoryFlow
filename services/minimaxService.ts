/**
 * MiniMax H3 video generation — browser BYOK client.
 *
 * Feasibility was CORS-tested (see docs/api-research-seedance-h3.md): the
 * CN and international endpoints send Access-Control-Allow-Origin on the
 * real responses of all three endpoints used here (upload / create / query),
 * so a pure client-side flow works with no backend.
 *
 * Pipeline: export white-model video (MediaRecorder, must be MP4) →
 * POST /v1/files/upload (purpose=video_generation_input) → mm_file://{id}
 * → POST /v2/video_generation with the H3 prompt + reference images
 * (base64 data URIs) → poll /v2/query/video_generation/{task_id} every 10s.
 *
 * Constraints encoded here (from the official guide):
 *   - reference video: MP4/MOV (H.264/265), single segment 2–15s, ≤50MB
 *   - reference images: ≤9, each ≤30MB
 *   - output duration: 4–15 integer seconds; resolution 768P / 2K
 *   - billing: output ¥/s + input video ¥/s at the SAME resolution rate
 *     (768P 0.50, 2K 0.80); images beyond 5 cost ¥0.20 each
 */

export interface MiniMaxConfig {
  apiKey: string;
  baseUrl: string;
}

export interface H3ReferenceImage {
  name: string;
  blob: Blob;
}

export interface H3SubmitParams {
  prompt: string;
  videoBlob: Blob;
  videoSeconds: number;
  referenceImages: H3ReferenceImage[];
  resolution: '768P' | '2K';
  outputSeconds: number;
}

export interface H3TaskStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  videoUrl?: string;
  errorMessage?: string;
}

/** Rough pre-submit cost estimate in CNY (warning display only). */
export const estimateH3Cost = (p: Pick<H3SubmitParams, 'videoSeconds' | 'outputSeconds' | 'referenceImages' | 'resolution'>): number => {
  const rate = p.resolution === '2K' ? 0.8 : 0.5;
  const video = (p.videoSeconds + p.outputSeconds) * rate;
  const extraImages = Math.max(0, p.referenceImages.length - 5) * 0.2;
  return video + extraImages;
};

const authHeaders = (apiKey: string): HeadersInit => ({
  Authorization: `Bearer ${apiKey}`,
});

const asBase64DataUri = async (blob: Blob): Promise<string> => {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
};

/** Upload the white-model video; returns the mm_file:// URI for the request. */
export const uploadH3Video = async (
  cfg: MiniMaxConfig,
  videoBlob: Blob,
): Promise<string> => {
  const form = new FormData();
  form.append('purpose', 'video_generation_input');
  const ext = videoBlob.type.includes('webm') ? 'webm' : 'mp4';
  form.append('file', videoBlob, `whitemodel.${ext}`);
  const res = await fetch(`${cfg.baseUrl}/v1/files/upload`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`上传白模视频失败 (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  const fileId = data?.file?.file_id ?? data?.file_id;
  if (!fileId) throw new Error(`上传成功但未返回 file_id: ${JSON.stringify(data).slice(0, 300)}`);
  return `mm_file://${fileId}`;
};

/** Create the generation task; returns the MiniMax task_id. */
export const createH3Task = async (
  cfg: MiniMaxConfig,
  p: H3SubmitParams,
  videoFileUri: string,
): Promise<string> => {
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: p.prompt },
    { type: 'video_url', video_url: { url: videoFileUri }, role: 'reference_video' },
  ];
  for (const img of p.referenceImages.slice(0, 9)) {
    content.push({
      type: 'image_url',
      image_url: { url: await asBase64DataUri(img.blob) },
      role: 'reference_image',
    });
  }
  const body = {
    model: 'MiniMax-H3',
    content,
    resolution: p.resolution,
    duration: p.outputSeconds,
    prompt_engineering: true,
  };
  const res = await fetch(`${cfg.baseUrl}/v2/video_generation`, {
    method: 'POST',
    headers: { ...authHeaders(cfg.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`创建任务失败 (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  const taskId = data?.task_id;
  if (!taskId) throw new Error(`未返回 task_id: ${JSON.stringify(data).slice(0, 300)}`);
  return taskId as string;
};

/** Poll one task. */
export const queryH3Task = async (cfg: MiniMaxConfig, taskId: string): Promise<H3TaskStatus> => {
  const res = await fetch(`${cfg.baseUrl}/v2/query/video_generation/${taskId}`, {
    headers: authHeaders(cfg.apiKey),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { status: 'failed', errorMessage: `查询失败 (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}` };
  }
  const status = data?.status as H3TaskStatus['status'] | undefined;
  if (!status) return { status: 'failed', errorMessage: `未知状态: ${JSON.stringify(data).slice(0, 300)}` };
  return {
    status,
    videoUrl: data?.content?.url,
    errorMessage: status === 'failed' ? String(data?.fail_code ?? '') + ' ' + String(data?.fail_reason ?? data?.error ?? '') : undefined,
  };
};

/** Pre-flight validation shared by the UI and the submit flow. */
export const validateH3Submission = (p: H3SubmitParams): string | null => {
  if (!p.videoBlob.type.includes('mp4')) {
    return '白模视频必须是 MP4 格式——当前浏览器录出了 ' + (p.videoBlob.type || '未知格式') + '。请使用支持 MP4 录制的浏览器（如桌面 Chrome）重新导出。';
  }
  if (p.videoBlob.size > 50 * 1024 * 1024) return '白模视频超过 50MB 上限。';
  if (p.videoSeconds < 2 || p.videoSeconds > 15) {
    return `参考视频时长需在 2–15s（当前 ${p.videoSeconds.toFixed(1)}s）——请调整镜头 duration 后重新导出。`;
  }
  if (p.referenceImages.length > 9) return '参考图超过 9 张上限。';
  if (p.outputSeconds < 4 || p.outputSeconds > 15 || !Number.isInteger(p.outputSeconds)) {
    return `输出时长需为 4–15 的整数秒（当前 ${p.outputSeconds}s）。`;
  }
  return null;
};

// ---- image generation (image-01, same BYOK key as H3) -----------------------

export interface GeneratedImage {
  url: string;
  blob: Blob;
}

/** image-01 rejects prompts over 1500 chars (status 2013). Our six-element
 *  storyboard prompts can exceed that. Trim at the last complete line that
 *  fits so whole elements survive (Subject-first ordering means the tail
 *  Material/Mood lines are what gets dropped, never the identity core). */
const clampImagePrompt = (prompt: string): string => {
  const MAX = 1450; // safety margin under the 1500 cap
  const p = prompt.trim();
  if (p.length <= MAX) return p;
  const cut = p.lastIndexOf('\n', MAX);
  return cut > 0 ? p.slice(0, cut) : p.slice(0, MAX);
};

/** Generate images from a prompt. Returns blobs ready for the asset library.
 *  Uses response_format=base64 (natively supported) so the images arrive in
 *  the API response itself — no CDN fetch, no CORS wall on the image host,
 *  no 24h URL expiry. Falls back to URL download if the endpoint ignores
 *  the base64 request. */
export const generateImages = async (
  cfg: MiniMaxConfig,
  prompt: string,
  opts?: { n?: number; aspectRatio?: string; subjectReference?: Blob },
): Promise<GeneratedImage[]> => {
  const body: Record<string, unknown> = {
    model: 'image-01',
    prompt: clampImagePrompt(prompt),
    aspect_ratio: opts?.aspectRatio ?? '16:9',
    response_format: 'base64',
    n: opts?.n ?? 1,
    prompt_optimizer: true,
  };
  // Subject reference (图生图 identity lock): array of {type:'character',
  // image_file} per the official schema — base64 Data URL natively supported,
  // single front-facing subject works best (exactly our turnaround sheets).
  if (opts?.subjectReference) {
    body.subject_reference = [{
      type: 'character',
      image_file: await asBase64DataUri(opts.subjectReference),
    }];
  }
  const res = await fetch(`${cfg.baseUrl}/v1/image_generation`, {
    method: 'POST',
    headers: { ...authHeaders(cfg.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`图像生成失败 (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  const d = data?.data ?? {};
  // Collect payloads defensively: data URIs, raw base64 (single or array),
  // or hosted URLs. Live testing showed image_base64 arrives as an ARRAY.
  const entries: string[] = [
    ...(Array.isArray(d.image_urls) ? d.image_urls : []),
    ...(Array.isArray(d.image_base64_list) ? d.image_base64_list : []),
    ...(Array.isArray(d.image_base64) ? d.image_base64 : []),
    ...(typeof d.image_base64 === 'string' ? [d.image_base64] : []),
  ].filter((x) => typeof x === 'string' && x.length > 0);
  if (!entries.length) throw new Error(`未返回图片: ${JSON.stringify(data).slice(0, 300)}`);

  const out: GeneratedImage[] = [];
  for (const entry of entries.slice(0, opts?.n ?? 1)) {
    if (entry.startsWith('data:')) {
      const blob = await (await fetch(entry)).blob(); // data URIs: no CORS
      out.push({ url: entry, blob });
    } else if (entry.startsWith('http')) {
      // endpoint ignored the base64 request — download the hosted URL
      const imgRes = await fetch(entry).catch(() => {
        throw new Error('图片下载失败（CDN 跨域？）——请重试一次；若持续失败请反馈。');
      });
      out.push({ url: entry, blob: await imgRes.blob() });
    } else {
      // raw base64 without the data: prefix
      const uri = `data:image/png;base64,${entry}`;
      out.push({ url: uri, blob: await (await fetch(uri)).blob() });
    }
  }
  return out;
};
