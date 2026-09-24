/**
 * Model / Provider / Endpoint — the P4 three-layer service contract
 * (docs/storyflow-adoption-plan.md).
 *
 *   Model     = WHAT you ask for (request shape + limits). Out-of-range
 *               parameters are REFUSED with a reason — never silently clamped.
 *   Provider  = HOW one service fulfills it (HTTP mapping, ComfyUI graph…).
 *   Endpoint  = ONE configured instance (address + credential reference +
 *               capacity). A Runtime Profile binds capabilities to endpoints.
 *
 * Swapping services is a config change: `storyflow.runtime.json` says which
 * endpoint serves `video.generate`, the source does not. A failed request
 * never silently falls back to another account — the binding names exactly
 * one route and errors stay on it.
 */

export type CapabilityId = 'video.generate' | 'image.generate' | 'llm-chat' | 'asr.transcribe';

export const CAPABILITIES: CapabilityId[] = ['video.generate', 'image.generate', 'llm-chat', 'asr.transcribe'];

// ---- supports(): refuse rather than clamp -----------------------------------

export type SupportsResult = { ok: true } | { ok: false; reason: string };

export const accepts = (): SupportsResult => ({ ok: true });
export const refuses = (reason: string): SupportsResult => ({ ok: false, reason });

// ---- requests ---------------------------------------------------------------

export interface VideoSubmitRequest {
  prompt: string;
  /** Story/output length the request must cover (model seconds are the
   *  provider's contract; out-of-range is refused, not trimmed). */
  outputSeconds: number;
  resolution: string;
  /** Vendor model id — its limits own the supports() checks (H3 4–15s …). */
  model?: string;
  /** White-model/reference input video seconds (billed on paid APIs). */
  videoSeconds?: number;
  videoBlob?: Blob;
  referenceImages?: { name: string; blob: Blob }[];
  /** Free-form extras the provider documents (comfy patch flags etc.). */
  extras?: Record<string, string | number | boolean>;
}

export interface VideoTaskRef {
  taskId: string;
}

export interface VideoTaskStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  videoUrl?: string;
  errorMessage?: string;
}

export interface ImageRequest {
  prompt: string;
  n?: number;
  aspectRatio?: string;
  /** FAL canonical preset ('landscape_16_9'…) — out-of-preset is refused. */
  size?: string;
  quality?: string;
  subjectReference?: Blob;
  references?: { characters?: Blob[]; landscape?: Blob };
}

export interface ChatRequest {
  system: string;
  user: string;
  model?: string;
  jsonMode?: boolean;
  thinkingLevel?: 'none' | 'low' | 'medium' | 'high';
}

export interface TranscribeRequest {
  language?: string;
}

export interface AsrWordOut {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface AsrResultOut {
  words: AsrWordOut[];
  text?: string;
  durationSec?: number;
  language?: string;
}

// ---- provider ---------------------------------------------------------------

/** Non-secret endpoint settings (addresses, workflow graphs, flags). */
export interface EndpointConfig {
  readonly [key: string]: string | number | boolean | undefined;
}

/** What an implementation receives: its config plus the resolved secret.
 *  The secret must never be logged, serialized or exported. */
export interface ProviderContext {
  config: EndpointConfig;
  apiKey: string;
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: readonly CapabilityId[];
  /** Browser reachability note (the P4 CORS research lands here):
   *  'direct' | 'proxy' (dev proxy or hosted gateway) | 'self-hosted'. */
  readonly deployment: 'direct' | 'proxy' | 'self-hosted';
  readonly deploymentNote?: string;
  /** Retry once on transient transport errors (timeout/network/5xx). */
  readonly transientRetry?: boolean;
  /** Refuse rather than clamp — the P4 honesty rule. */
  supports(capability: CapabilityId, request: unknown): SupportsResult;

  // capability implementations (optional; presence must match `capabilities`)
  submitVideo?(ctx: ProviderContext, request: VideoSubmitRequest): Promise<VideoTaskRef>;
  pollVideo?(ctx: ProviderContext, ref: VideoTaskRef): Promise<VideoTaskStatus>;
  generateImage?(ctx: ProviderContext, request: ImageRequest): Promise<{ blob: Blob }[]>;
  chat?(ctx: ProviderContext, request: ChatRequest): Promise<string>;
  transcribe?(ctx: ProviderContext, audio: Blob, request: TranscribeRequest): Promise<AsrResultOut>;
}

// ---- runtime profile (storyflow.runtime.json) -------------------------------

export interface EndpointInstanceSpec {
  /** Provider id ('minimax' | 'comfy' | 'fal' | 'gemini' | 'deepseek' | 'asr'). */
  use: string;
  config?: EndpointConfig;
  /** Named slot in the session credential store — NEVER a secret value. */
  credential?: { slot: string };
}

export interface RuntimeProfile {
  format: 'storyflow.runtime@1';
  /** instance name → provider + config + credential reference. */
  endpoints: Record<string, EndpointInstanceSpec>;
  /** capability → endpoint instance name. */
  bindings: Record<string, string>;
}

export const RUNTIME_FORMAT = 'storyflow.runtime@1';
export const RUNTIME_FILE = 'storyflow.runtime.json';
