/**
 * DeepSeek provider — OpenAI-shaped chat completions transport (P4).
 *
 * Deployment: direct (api.deepseek.com). One attempt per chat call with a
 * hard 180s timeout; the application layer's retry-on-transient wraps it
 * (transientRetry: true).
 */
import { accepts, refuses, type CapabilityId, type ChatRequest, type Provider, type SupportsResult } from './types';

export const deepseekProvider: Provider = {
  id: 'deepseek',
  label: 'DeepSeek',
  capabilities: ['llm-chat'],
  deployment: 'direct',
  deploymentNote: 'api.deepseek.com 直连（OpenAI 形状 chat/completions）；密钥 slot: deepseek',
  transientRetry: true,

  supports(capability: CapabilityId, request: unknown): SupportsResult {
    if (capability !== 'llm-chat') return refuses(`deepseek 不提供能力 ${capability}`);
    const req = request as ChatRequest;
    if (!req?.system && !req?.user) return refuses('空提示词');
    return accepts();
  },

  async chat(ctx, req: ChatRequest): Promise<string> {
    if (!ctx.apiKey) throw new Error('DEEPSEEK_KEY_MISSING');
    const model = req.model || 'deepseek-v4-flash';
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        stream: false,
        ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const message = (err as { error?: { message?: string } }).error?.message
        || `DeepSeek API Error: ${response.statusText}`;
      throw new Error(message);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  },
};
