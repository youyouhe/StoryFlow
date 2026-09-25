/**
 * ASR provider — OpenAI-compatible word-level transcription (P4).
 *
 * Deployment: direct to whatever baseUrl the endpoint names (Groq default;
 * OpenAI, whisper.cpp server, a dev proxy — same /audio/transcriptions
 * shape). Wraps services/alignment.ts's transport.
 */
import { transcribeAudio } from '../alignment';
import { accepts, refuses, type AsrResultOut, type CapabilityId, type Provider, type SupportsResult, type TranscribeRequest } from './types';

export const asrProvider: Provider = {
  id: 'asr',
  label: '词级 ASR（OpenAI 兼容 transcriptions）',
  capabilities: ['asr.transcribe'],
  deployment: 'direct',
  deploymentNote: 'endpoint.config.baseUrl 指向任意 OpenAI 兼容 /audio/transcriptions（默认 Groq）',
  transientRetry: true,

  supports(capability: CapabilityId, request: unknown): SupportsResult {
    if (capability !== 'asr.transcribe') return refuses(`asr 不提供能力 ${capability}`);
    const audio = request as Blob;
    if (!audio || audio.size === 0) return refuses('对齐需要非空音频');
    return accepts();
  },

  async transcribe(ctx, audio: Blob, req: TranscribeRequest): Promise<AsrResultOut> {
    return transcribeAudio(audio, {
      baseUrl: String(ctx.config.baseUrl ?? ''),
      apiKey: ctx.apiKey,
      model: ctx.config.model ? String(ctx.config.model) : undefined,
    }, req.language);
  },
};
