/**
 * FAL text-to-image client — faL queue API (submit → poll → fetch), a browser
 * BYOK implementation (page holds the key; no backend) of the production FAL
 * workflow used by JoyRead.
 *
 * CORS verified on 2026-09-16 against the live FAL endpoints:
 *   - POST queue.fal.run model-path text-to-image preflight OK (allow authorization)
 *   - status/result GET (application root) send ACAO, credentials true
 *   - CDN (v3.fal.media) sends access-control-allow-origin *
 * so a pure client-side queue flow works with no proxy.
 *
 * Three production-pitfall fixes carried over:
 *   1. submit URL MUST end in /text-to-image, else FAL 404s (Application not found)
 *   2. status/result URLs hang off the APPLICATION ROOT (owner/app), not the
 *      full submit path
 *   3. "Strictly NO ..." negative-prompt phrasing triggers OpenAI-downstream
 *      500s — strip it before sending (gpt-image has no negative-prompt path)
 *
 * Generated images are returned as {url, blob} (blob = CDN-downloaded, ready
 * for the asset library), plus width/height.
 */

const QUEUE_BASE = 'https://queue.fal.run';
/** REST API host — file uploads live here (queue host has no upload route). */
const REST_BASE = 'https://rest.fal.ai';
export const DEFAULT_FAL_MODEL = 'openai/gpt-image-2.5/flare';
/** Default FAL quality tier — cheapest. See the cost table on falTextToImage. */
export const ECONOMY_QUALITY = 'low' as const;
/** Size preset per aspect ratio. Preset dimensions are fal-toolkit standard
 *  (docs: model-apis/model-arguments): square_hd 1024×1024, landscape_4_3
 *  1024×768, portrait_4_3 768×1024, landscape_16_9 1024×576, portrait_16_9
 *  576×1024. Cost tracks size as well as quality (see the falTextToImage
 *  table), so the cheapest priced cell — 1024×768 @ low — is landscape_4_3. */
export const FAL_SIZE_FOR_ASPECT: Record<string, string> = {
  '1:1': 'square_hd',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
};
const POLL_INTERVAL_MS = 2000;
const DEADLINE_MS = 300_000;

export interface FalConfig {
  apiKey: string;
  /** Application model path WITHOUT the endpoint suffix (e.g.
   *  "openai/gpt-image-2.5/flare"). Defaults to DEFAULT_FAL_MODEL. The
   *  endpoint suffix is chosen per call: text-to-image with no references,
   *  edit when reference images are supplied (both variants of the
   *  gpt-image-2.5 apps expose both endpoints). */
  model?: string;
}

export interface FalGeneratedImage {
  url: string;
  blob: Blob;
  width?: number;
  height?: number;
}

const authHeaders = (key: string): HeadersInit => ({
  Authorization: `Key ${key}`,
  'Content-Type': 'application/json',
});

/** Application root = scheme + host + first two path segments (owner/app).
 *  queue.fal.run/openai/gpt-image-2.5/flare/text-to-image
 *    → queue.fal.run/openai/gpt-image-2.5
 *  FAL's status/result URLs always hang off the app root, never the submit path.
 *  (In practice FAL returns status_url/response_url in the submit response and
 *  those are preferred; this is the fallback.) */
const appRoot = (submitUrl: string): string => {
  const p = new URL(submitUrl);
  const segs = p.pathname.split('/').filter(Boolean);
  return `${p.protocol}//${p.host}/${segs.slice(0, 2).join('/')}`;
};

/** FAL endpoint suffixes. The submit URL MUST end in one of these: without a
 *  suffix FAL reads the first two segments as the app name and 404s. */
export type FalEndpoint = 'text-to-image' | 'edit';

const submitUrl = (model: string, endpoint: FalEndpoint): string => {
  const path = model.replace(/^\/+|\/+$/g, '').replace(/\/(text-to-image|edit)$/, '');
  return `${QUEUE_BASE}/${path}/${endpoint}`;
};

/** Strip negative-prompt phrasing. gpt-image has no negative-prompt mechanism;
 *  these words get read as body text and can trip OpenAI safe-guard 500s. */
const stripNegative = (prompt: string): string => {
  const idx = prompt.indexOf('Strictly NO');
  return idx >= 0 ? prompt.slice(0, idx).trimEnd() : prompt;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Upload a local file to FAL's CDN and return its public URL.
 *
 * Reference images must be URLs FAL's runner can fetch — a browser blob: /
 * object URL is unreachable from the runner, so anything local goes through
 * here first. Two steps, matching @fal-ai/client's storage.upload:
 *   1. POST {REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3
 *      → { upload_url, file_url }
 *   2. PUT upload_url with the raw bytes (no auth header — the URL is signed)
 * CORS verified 2026-09-16: the initiate preflight allows `authorization`.
 * Files under 90MB use this single-PUT path; ours are far below.
 */
export const falUploadFile = async (cfg: FalConfig, blob: Blob, fileName?: string): Promise<string> => {
  const contentType = blob.type || 'image/png';
  const ext = contentType.split('/')[1]?.split(/[-;]/)[0] || 'png';
  const name = fileName || `${Date.now()}.${ext}`;

  const initRes = await fetch(`${REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ content_type: contentType, file_name: name }),
  });
  if (!initRes.ok) {
    const body = await initRes.text().catch(() => '');
    throw new Error(`FAL 上传初始化失败 (HTTP ${initRes.status}): ${body.slice(0, 200)}`);
  }
  const { upload_url: uploadUrl, file_url: fileUrl } = await initRes.json().catch(() => ({}));
  if (!uploadUrl || !fileUrl) throw new Error(`FAL 上传初始化返回异常: 缺少 upload_url/file_url`);

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': contentType },
  });
  if (!putRes.ok) throw new Error(`FAL 文件上传失败 (HTTP ${putRes.status})`);
  return fileUrl as string;
};

/**
 * Submit → poll → fetch. Returns the final result JSON plus the download-blob
 * materialization (see generateImages in minimaxService).
 *
 * COST — two official statements on the model page (openai/gpt-image-2.5/
 * flare/edit, "Pricing"): the token rates are the BILLING MECHANISM, and the
 * per-image table below is the derived price for canonical sizes. They are
 * consistent halves of one explanation — the mechanism is why longer prompts,
 * more complex requests, and larger images cost more.
 *
 *   Text tokens  (per 1M): $5.00 in / $1.25 cached / $10.00 out
 *   Image tokens (per 1M): $8.00 in / $2.00 cached / $30.00 out
 *
 *   size        low       medium    high      xhigh     max        (USD, 1 input image)
 *   1024×768    0.00402   0.00903   0.03612   0.06420   0.14445
 *   1024×1024   0.00588   0.01317   0.05268   0.09366   0.21072
 *   1024×1536   0.00474   0.01029   0.04116   0.07377   0.16464
 *   1920×1080   0.00441   0.01029   0.03960   0.07041   0.15840
 *   2560×1440   0.00615   0.01434   0.05529   0.09828   0.22110
 *   3840×2160   0.01113   0.02595   0.10008   0.17790   0.40026
 *
 * Both levers matter: quality is ~9× across the range (low→high), size is
 * ~2.8× (1024×768 → 3840×2160 at low). Cheapest cell = 1024×768 low $0.00402.
 * The table is quoted "including one input image", i.e. it prices the /edit
 * path; a text-to-image call (no reference) carries no input-image tokens and
 * should price at or below these rows.
 *
 * StoryFlow defaults to 'low' (AppSettings.falQuality) because storyboard
 * frames are iterated heavily; raise it for a keeper.
 *
 * @param prompt        The image prompt (negative phrasing auto-stripped).
 * @param opts.size     "square_hd" | "landscape_4_3" | "portrait_4_3" |
 *                      "landscape_16_9" | "portrait_16_9" | {width,height}.
 * @param opts.quality  "low" (cheapest) … "max" — see the table above.
 * @param opts.referenceImages  Local blobs to condition on (character design
 *                      sheets for identity lock). When non-empty the call goes
 *                      to the model's /edit endpoint with `image_urls` — each
 *                      blob is uploaded to FAL's CDN first (a blob: URL is
 *                      unreachable from the runner). The /edit endpoint bills
 *                      the input image tokens the table above already assumes.
 */
/** FAL validation errors arrive as {"detail":[{"loc":["body","prompt"],"msg":"…"}]}.
 *  A truncated raw dump like that is undebuggable in a 10px UI line — extract
 *  the human-readable messages (with their field path) and keep the raw body
 *  only as a fallback when the body isn't the expected shape. */
const falErrorMessage = (status: number, body: string): string => {
  try {
    const parsed = JSON.parse(body);
    const details = Array.isArray(parsed?.detail) ? parsed.detail : [];
    const msgs = details
      .map((d: { loc?: unknown; msg?: unknown }) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter(Boolean).join('.') : '';
        const msg = typeof d?.msg === 'string' ? d.msg : '';
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (msgs.length) return `FAL HTTP ${status}: ${msgs.join(' | ')}`;
  } catch { /* body wasn't JSON — fall through to the raw dump */ }
  return `FAL HTTP ${status}: ${body.slice(0, 300)}`;
};

export const falTextToImage = async (
  cfg: FalConfig,
  prompt: string,
  opts?: {
    size?: string | { width: number; height: number };
    quality?: 'high' | 'low';
    numImages?: number;
    outputFormat?: string;
    referenceImages?: Blob[];
  },
): Promise<{ images: Array<{ url: string; file_name?: string; width?: number; height?: number }> }> => {
  const model = cfg.model?.trim() || DEFAULT_FAL_MODEL;
  const refs = opts?.referenceImages?.filter((b) => !!b) ?? [];
  const endpoint: FalEndpoint = refs.length ? 'edit' : 'text-to-image';
  const submit = submitUrl(model, endpoint);

  let imageUrls: string[] | undefined;
  if (refs.length) {
    // gpt-image-2.5 edit accepts up to 16 reference images.
    imageUrls = [];
    for (const blob of refs.slice(0, 16)) {
      imageUrls.push(await falUploadFile(cfg, blob));
    }
  }

  const payload: Record<string, unknown> = {
    prompt: stripNegative(prompt),
    image_size: opts?.size ?? 'square_hd',
    quality: opts?.quality ?? ECONOMY_QUALITY,
    num_images: opts?.numImages ?? 1,
    output_format: opts?.outputFormat ?? 'png',
  };
  if (imageUrls) payload.image_urls = imageUrls;

  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(submit, {
      method: 'POST',
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(`FAL submit 网络错误: ${String(e)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(falErrorMessage(res.status, body));
  }
  const sub = await res.json().catch(() => ({}));
  const requestId = sub?.request_id;
  if (!requestId) throw new Error(`FAL submit 缺少 request_id: ${Object.keys(sub).join(', ')}`);

  // Prefer the URLs FAL returns (stable across model paths); fall back to
  // deriving from the app root, mirroring the Python client.
  const root = appRoot(submit);
  const statusUrl = sub?.status_url ?? `${root}/requests/${requestId}/status`;
  const pollHeaders = authHeaders(cfg.apiKey);

  let status = '';
  const deadline = Date.now() + DEADLINE_MS;
  while (status !== 'COMPLETED') {
    if (Date.now() > deadline) throw new Error(`FAL ${requestId} 超时(${DEADLINE_MS / 1000}s), 最后状态: ${status || 'unknown'}`);
    await sleep(POLL_INTERVAL_MS);
    const s = await fetch(statusUrl, { headers: pollHeaders });
    if (!s.ok) throw new Error(`FAL 状态查询 HTTP ${s.status}`);
    const sj = await s.json().catch(() => ({}));
    status = sj?.status;
    if (status === 'FAILED' || status === 'CANCELLED') throw new Error(`FAL ${requestId} ${status}`);
  }

  const resultUrl = sub?.response_url ?? `${root}/requests/${requestId}`;
  const r = await fetch(resultUrl, { headers: pollHeaders });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(falErrorMessage(r.status, body));
  }
  return r.json();
};

/** Materialize a FAL result's CDN image URLs into blobs (the CDN link expires,
 *  so download right away). Returns one entry per image, blobs ready for the
 *  asset library. */
export const falDownloadImages = async (
  result: { images: Array<{ url: string; file_name?: string; width?: number; height?: number }> },
  numImages = 1,
): Promise<FalGeneratedImage[]> => {
  const out: FalGeneratedImage[] = [];
  for (const img of (result?.images ?? []).slice(0, numImages)) {
    const url = img.url;
    if (!url) continue;
    const imgRes = await fetch(url).catch(() => {
      throw new Error('FAL 图片下载失败（CDN 跨域？）——请重试一次；若持续失败请反馈。');
    });
    if (!imgRes.ok) throw new Error(`FAL 图片下载 HTTP ${imgRes.status}`);
    out.push({ url, blob: await imgRes.blob(), width: img.width, height: img.height });
  }
  if (!out.length) throw new Error(`FAL 未返回图片`);
  return out;
};