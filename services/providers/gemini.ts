/**
 * Google Gemini provider — llm-chat transport (P4).
 *
 * Deployment: direct (generativelanguage.googleapis.com). One attempt per
 * chat call; the application layer (geminiService's callAIProvider) owns
 * timing, logging and its retry policy. The transport is exactly what
 * callAIProvider's Gemini branch used to inline.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { accepts, refuses, type CapabilityId, type ChatRequest, type Provider, type SupportsResult } from './types';

export const geminiProvider: Provider = {
  id: 'gemini',
  label: 'Google Gemini',
  capabilities: ['llm-chat'],
  deployment: 'direct',
  deploymentNote: 'generativelanguage.googleapis.com 直连；密钥 slot: gemini',

  supports(capability: CapabilityId, request: unknown): SupportsResult {
    if (capability !== 'llm-chat') return refuses(`gemini 不提供能力 ${capability}`);
    const req = request as ChatRequest;
    if (!req?.system && !req?.user) return refuses('空提示词');
    return accepts();
  },

  async chat(ctx, req: ChatRequest): Promise<string> {
    const key = ctx.apiKey || (typeof process !== 'undefined' ? process.env.API_KEY : undefined);
    if (!key) throw new Error('GEMINI_KEY_MISSING');
    const model = req.model || 'gemini-3.7-flash';
    const ai = new GoogleGenAI({ apiKey: key });
    const levelMap: Record<'low' | 'medium' | 'high', ThinkingLevel> = {
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH,
    };
    const userLevel = req.thinkingLevel ?? 'none';
    const thinkingConfig = userLevel === 'none'
      ? { thinkingBudget: 0 }
      : { thinkingLevel: levelMap[userLevel] };
    const response = await ai.models.generateContent({
      model,
      contents: `${req.system}\n\n${req.user}`,
      config: {
        temperature: 0.9,
        thinkingConfig,
        ...(req.jsonMode ? { responseMimeType: 'application/json' as const } : {}),
      },
    });
    return response.text || '';
  },
};
