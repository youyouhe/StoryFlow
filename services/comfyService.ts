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
  /** Desired output seconds — written into the duration source the graph's
   *  `length` chain resolves to (H3 templates compute frames from seconds
   *  via a math node, e.g. max(5, round(a*24)) adjusted to the %17 rhythm). */
  durationSeconds?: number;
  /** Randomize sampler noise_seed per submission so identical prompts vary. */
  randomizeSeed?: boolean;
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
  // UI-format exports (plain "Save") parse as JSON too but use {nodes:[…],
  // links:[…]} — no class_type keys. Without this guard the patcher would
  // silently no-op and run the workflow with its BAKED-IN sample prompt.
  const probe = Object.values(graph)[0] as { class_type?: string } | undefined;
  if (!probe?.class_type) {
    throw new Error('导入的 JSON 是 UI 格式，不是 API 格式——请在 ComfyUI 菜单 Workflow → Export (API) 重新导出。');
  }
  let h3 = false;
  let lengthNodeRef: [string, string] | null = null; // [nodeId, inputKey] carrying length
  // T2V positive text: the LONGEST current text (negatives are short/empty).
  let textNode: string | null = null;
  let textLen = -1;
  for (const [id, node] of Object.entries(graph)) {
    const ct = node.class_type ?? '';
    if (ct === 'MiniMaxH3ReferenceToVideo') {
      h3 = true;
      node.inputs.prompt = patch.prompt;
      if (patch.refImageNames?.length) node.inputs.ref_images = patch.refImageNames;
      if (typeof node.inputs.length !== 'number') lengthNodeRef = [id, 'length'];
    } else if (ct === 'MiniMaxH3ImageToVideo') {
      h3 = true;
      node.inputs.prompt = patch.prompt;
      if (patch.firstFrameName) node.inputs.first_frame = patch.firstFrameName;
      if (typeof node.inputs.length !== 'number') lengthNodeRef = [id, 'length'];
    } else if (ct === 'CLIPTextEncode') {
      const t = node.inputs.text;
      if (typeof t === 'string' && t.length > textLen) { textLen = t.length; textNode = id; }
    }
    // Randomize every sampler seed so equal prompts don't repeat renders.
    if (patch.randomizeSeed && 'noise_seed' in node.inputs) {
      node.inputs.noise_seed = Math.floor(Math.random() * 2 ** 48);
    }
  }
  if (!h3 && textNode) graph[textNode].inputs.text = patch.prompt;
  if (!h3) {
    throw new Error('图中没有找到 MiniMax-H3 节点（MiniMaxH3ReferenceToVideo / MiniMaxH3ImageToVideo）——请确认导出的是 H3 工作流的 API 格式。');
  }
  // Duration: follow the H3 node's `length` connection to its numeric source
  // (typically a PrimitiveFloat seconds value feeding a frames math node) and
  // write the desired seconds there. Templates without a chain keep their own.
  if (patch.durationSeconds != null && lengthNodeRef) {
    // [nodeId, 'length'] → the length input's connection source is where the
    // walk STARTS (the H3 node's OTHER connections — width/height — have
    // non-duration sources). Then walk first-connection hops until a
    // primitive numeric node: the duration seconds source (templates compute
    // frames from seconds via a math expression).
    const lenInput = graph[lengthNodeRef[0]]?.inputs[lengthNodeRef[1]];
    let srcId: string | null = Array.isArray(lenInput) ? (lenInput[0] as string) : null;
    for (let hops = 0; hops < 4 && srcId; hops++) {
      const node = graph[srcId];
      if (!node) break;
      const entries = Object.entries(node.inputs);
      const conn = entries.find(([, v]) => Array.isArray(v) && typeof (v as unknown[])[0] === 'string');
      if (!conn) {
        // primitive numeric source — this is the duration in seconds
        const num = entries.find(([, v]) => typeof v === 'number');
        if (num) node.inputs[num[0]] = patch.durationSeconds;
        break;
      }
      srcId = (conn[1] as unknown[])[0] as string;
    }
  }
  return graph;
};

export type ComfyWorkflowKind = 'r2v' | 't2v' | 'i2v';

const EXPECTED_NODE: Record<ComfyWorkflowKind, string> = {
  r2v: 'MiniMaxH3ReferenceToVideo',
  t2v: 'EmptyMiniMaxH3LatentAV',
  i2v: 'MiniMaxH3ImageToVideo',
};

export interface ComfyValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** every class_type the graph depends on */
  nodeTypes: string[];
}

/** Full pre-flight for one imported workflow: API format, expected H3 node,
 *  patch dry-run (prompt + duration + seed writes), and a cross-check that
 *  EVERY class_type the graph uses actually exists on the target server
 *  (catches missing custom-node packs and renamed nodes before a queue
 *  attempt burns GPU time). */
export const comfyValidateWorkflow = async (
  cfg: ComfyConfig,
  graphJson: string,
  kind: ComfyWorkflowKind,
): Promise<ComfyValidationResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let nodeTypes: string[] = [];

  let graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  try {
    graph = JSON.parse(graphJson);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${String((e as Error)?.message ?? e)}`], warnings, nodeTypes };
  }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    return { ok: false, errors: ['不是 API 格式（期望 {节点ID: {class_type, inputs}}）'], warnings, nodeTypes };
  }

  nodeTypes = [...new Set(Object.values(graph).map(n => n?.class_type).filter(Boolean) as string[])];
  const probe = Object.values(graph)[0] as { class_type?: string } | undefined;
  if (!probe?.class_type) {
    errors.push('这是 UI 格式导出（含 nodes/links 数组）——请在 ComfyUI 菜单 Workflow → Export (API) 重新导出');
    return { ok: false, errors, warnings, nodeTypes };
  }

  const expected = EXPECTED_NODE[kind];
  if (!nodeTypes.includes(expected)) {
    const h3ish = nodeTypes.filter(c => /minimax|h3/i.test(c));
    errors.push(
      `缺少本工作流应有的节点 ${expected}。图中实际包含${h3ish.length ? `的 H3 相关节点: ${h3ish.join(', ')}` : '没有任何 H3 相关节点'}；全部节点类型: ${nodeTypes.slice(0, 10).join(', ')}${nodeTypes.length > 10 ? ` 等 ${nodeTypes.length} 种` : ''}`,
    );
  }

  try {
    comfyPatchWorkflow(graphJson, {
      prompt: '【校验干跑】validation dry-run',
      refImageNames: kind === 'r2v' ? ['dryrun.png'] : undefined,
      firstFrameName: kind === 'i2v' ? 'dryrun.png' : undefined,
      durationSeconds: 10,
      randomizeSeed: true,
    });
  } catch (e) {
    errors.push(`改图干跑失败：${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }

  // Server-side node existence cross-check
  try {
    const res = await fetch(`${base(cfg.serverUrl)}/object_info`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      warnings.push(`无法获取服务器节点清单 (HTTP ${res.status})——跳过节点存在性检查`);
    } else {
      const info = await res.json().catch(() => ({} as Record<string, unknown>));
      const missing = nodeTypes.filter(ct => !(ct in info));
      if (missing.length) errors.push(`服务器缺少节点：${missing.join(', ')}（自定义节点包未安装或版本不符）`);
    }
  } catch (e) {
    warnings.push(`无法连接服务器做节点检查：${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }

  return { ok: errors.length === 0, errors, warnings, nodeTypes };
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
