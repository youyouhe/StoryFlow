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
