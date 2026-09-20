/**
 * Self-hosted ComfyUI backend for the MiniMax-H3 video node pack.
 *
 * The user runs ComfyUI on their own GPU box (优云 pod etc.) at a fraction
 * of the official 刊例 cost. The H3 pack exposes NATIVE nodes, so the app
 * can patch the exported API-format graph structurally by class_type —
 * no manual "Save API Format" dance:
 *
 *   MiniMaxH3ReferenceToVideo (R2V, ref2va) → prompt / ref_images[]
 *   MiniMaxH3ImageToVideo     (I2V, fl2va) → prompt / first_frame
 *   EmptyMiniMaxH3LatentAV    (T2V latent)               — length untouched
 *   CLIPTextEncode (longest)  → positive prompt          — T2V text node
 *
 * Deliberately NOT patched: `length`. The exported workflow defines the
 * output duration; patching it blind would desync audio (H3 is AV-native)
 * without knowing the pack's fps. Export a 10s workflow → 10s segments.
 *
 * API surface used: POST /upload/image · POST /prompt · GET /history/{id}
 * · GET /view · GET /system_stats.
 */

export interface ComfyConfig {
  serverUrl: string;
}

/** The browser cannot reach the pod cross-origin (no CORS headers) — all
 *  requests route through the dev-server proxy. The stored URL is the
 *  logical target (keep .env.local COMFY_TARGET in sync); Tauri/prod builds
 *  have no dev server and go direct. */
const resolveBase = (serverUrl: string): string => {
  const url = serverUrl.trim().replace(/\/+$/, '');
  if (url.startsWith('/')) return url;
  if (typeof window !== 'undefined' && !(window as unknown as { __TAURI__?: unknown }).__TAURI__) {
    return '/comfy-api';
  }
  return url;
};
const base = resolveBase;

export const comfySystemStats = async (cfg: ComfyConfig): Promise<{ version: string; device: string }> => {
  const res = await fetch(`${base(cfg.serverUrl)}/system_stats`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ComfyUI 连接失败 (HTTP ${res.status})`);
  const d = await res.json().catch(() => ({} as Record<string, never>));
  return {
    version: String(d?.system?.comfyui_version ?? '?'),
    device: String(d?.devices?.[0]?.name ?? 'GPU'),
  };
};

/** Upload a reference image; returns the API-format filename reference. */
export const comfyUploadImage = async (cfg: ComfyConfig, blob: Blob, filename: string): Promise<string> => {
  const form = new FormData();
  form.append('image', new File([blob], filename, { type: blob.type || 'image/png' }));
  form.append('overwrite', 'true');
  const res = await fetch(`${base(cfg.serverUrl)}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`ComfyUI 参考图上传失败 (HTTP ${res.status})`);
  const d = await res.json().catch(() => ({} as { name?: string; subfolder?: string }));
  if (!d.name) throw new Error('ComfyUI 上传响应缺少文件名');
  return d.subfolder ? `${d.name} [${d.subfolder}]` : d.name;
};

export interface ComfyGraphPatch {
  prompt: string;
  refImageNames?: string[];
  firstFrameName?: string;
}

/** Structural patch of an API-format workflow graph (see module docblock). */
export const comfyPatchWorkflow = (
  graphJson: string,
  patch: ComfyGraphPatch,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> => {
  let graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  try {
    graph = JSON.parse(graphJson);
  } catch {
    throw new Error('ComfyUI 工作流 JSON 解析失败——请用 ComfyUI 的 Save (API Format) 导出。');
  }
  let h3 = false;
  // T2V positive text: the LONGEST current text (negatives are short/empty).
  let textNode: string | null = null;
  let textLen = -1;
  for (const [id, node] of Object.entries(graph)) {
    const ct = node.class_type ?? '';
    if (ct === 'MiniMaxH3ReferenceToVideo') {
      h3 = true;
      node.inputs.prompt = patch.prompt;
      if (patch.refImageNames?.length) node.inputs.ref_images = patch.refImageNames;
    } else if (ct === 'MiniMaxH3ImageToVideo') {
      h3 = true;
      node.inputs.prompt = patch.prompt;
      if (patch.firstFrameName) node.inputs.first_frame = patch.firstFrameName;
    } else if (ct === 'CLIPTextEncode') {
      const t = node.inputs.text;
      if (typeof t === 'string' && t.length > textLen) { textLen = t.length; textNode = id; }
    }
  }
  if (!h3 && textNode) graph[textNode].inputs.text = patch.prompt;
  return graph;
};

export const comfyQueuePrompt = async (
  cfg: ComfyConfig,
  graph: Record<string, unknown>,
): Promise<string> => {
  const res = await fetch(`${base(cfg.serverUrl)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'storyflow' }),
  });
  const d = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || d.error || !d.prompt_id) {
    throw new Error(`ComfyUI 提交失败: ${JSON.stringify(d).slice(0, 250)}`);
  }
  return String(d.prompt_id);
};

export interface ComfyTaskStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  videoUrl?: string;
  errorMessage?: string;
}

/** History-poll one prompt. A missing history entry means still queued/running
 *  (ComfyUI moves it into history on completion). */
export const comfyQueryTask = async (cfg: ComfyConfig, promptId: string): Promise<ComfyTaskStatus> => {
  const res = await fetch(`${base(cfg.serverUrl)}/history/${encodeURIComponent(promptId)}`);
  if (!res.ok) return { status: 'running' };
  const d = await res.json().catch(() => ({} as Record<string, never>));
  const entry = (d as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: unknown[] }; outputs?: Record<string, Record<string, { filename: string; subfolder?: string; type?: string }[]>> }>)[promptId];
  if (!entry) return { status: 'running' };
  if (entry.status?.status_str === 'error') {
    const last = Array.isArray(entry.status.messages) ? entry.status.messages.slice(-1)[0] : null;
    return { status: 'failed', errorMessage: `ComfyUI 执行出错: ${JSON.stringify(last).slice(0, 250)}` };
  }
  let videoUrl: string | undefined;
  for (const o of Object.values(entry.outputs ?? {})) {
    const items = o.gifs ?? o.videos ?? o.images ?? [];
    for (const f of items) {
      if (!f.filename) continue;
      videoUrl = `${base(cfg.serverUrl)}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder ?? '')}&type=${encodeURIComponent(f.type ?? 'output')}`;
      break;
    }
    if (videoUrl) break;
  }
  if (entry.status?.completed) {
    return videoUrl
      ? { status: 'succeeded', videoUrl }
      : { status: 'failed', errorMessage: '执行完成但没有视频输出——检查工作流的 SaveVideo 节点是否 type=output' };
  }
  return { status: 'running' };
};
