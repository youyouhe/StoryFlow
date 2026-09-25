/**
 * Fake provider — the P4 plug-in proof (acceptance 5): a brand-new service
 * joins WITHOUT touching the core. Copy this file as `providers/my-service.ts`
 * (see providers/README.md), implement the capabilities you serve, register
 * it in `defaultRegistry()`, bind a capability in storyflow.runtime.json.
 * Tests use it to prove resolution and dispatch.
 */
import { accepts, type CapabilityId, type ChatRequest, type ImageRequest, type Provider, type SupportsResult, type VideoSubmitRequest, type VideoTaskRef, type VideoTaskStatus } from './types';

export interface FakeProviderOptions {
  id?: string;
  capabilities?: CapabilityId[];
  /** Scripted responses by capability. */
  chatText?: string;
  videoUrl?: string;
  imageBlob?: Blob;
  /** Custom refusal for supports(). */
  refuse?: (capability: CapabilityId, request: unknown) => string | null;
}

export interface FakeProvider extends Provider {
  /** Call recorder — tests assert what was (not) sent. */
  readonly calls: { capability: CapabilityId; request: unknown }[];
}

export const createFakeProvider = (opts: FakeProviderOptions = {}): FakeProvider => {
  const calls: { capability: CapabilityId; request: unknown }[] = [];
  const capabilities = opts.capabilities ?? ['video.generate', 'image.generate', 'llm-chat', 'asr.transcribe'];
  let nextTask = 0;

  const provider: FakeProvider = {
    id: opts.id ?? 'fake',
    label: 'Fake（测试桩）',
    capabilities,
    deployment: 'direct',
    calls,
    transientRetry: false,

    supports(capability, request): SupportsResult {
      const reason = opts.refuse?.(capability, request) ?? null;
      return reason ? { ok: false, reason } : accepts();
    },

    async submitVideo(_ctx, request: VideoSubmitRequest): Promise<VideoTaskRef> {
      calls.push({ capability: 'video.generate', request });
      return { taskId: `fake-task-${++nextTask}` };
    },

    async pollVideo(_ctx, ref: VideoTaskRef): Promise<VideoTaskStatus> {
      calls.push({ capability: 'video.generate', request: ref });
      return { status: 'succeeded', videoUrl: opts.videoUrl ?? 'https://example.com/fake.mp4' };
    },

    async generateImage(_ctx, request: ImageRequest) {
      calls.push({ capability: 'image.generate', request });
      return [{ blob: opts.imageBlob ?? new Blob(['fake-image'], { type: 'image/png' }) }];
    },

    async chat(_ctx, request: ChatRequest): Promise<string> {
      calls.push({ capability: 'llm-chat', request });
      return opts.chatText ?? 'fake-response';
    },

    async transcribe(_ctx, _audio: Blob) {
      calls.push({ capability: 'asr.transcribe', request: null });
      return { words: [{ word: 'fake', start: 0, end: 0.2, confidence: 0.99 }], durationSec: 0.2 };
    },
  };
  return provider;
};
