/**
 * Provider assembly (P4) — the built-in registry and the legacy-knob→profile
 * mapping. `storyflow.runtime.json` (project root) replaces the default
 * profile entirely when present; until then today's settings keep driving
 * the same behavior through explicit bindings (never implicit fallback).
 */
import type { AppSettings } from '../../types';
import { asrProvider } from './asr';
import { comfyProvider } from './comfy';
import { deepseekProvider } from './deepseek';
import { falProvider } from './fal';
import { geminiProvider } from './gemini';
import { minimaxProvider } from './minimax';
import { createRegistry, type ProviderRegistry } from './registry';
import { RUNTIME_FORMAT, type RuntimeProfile } from './types';

export * from './types';
export * from './registry';
export { minimaxProvider } from './minimax';
export { comfyProvider } from './comfy';
export { falProvider } from './fal';
export { geminiProvider } from './gemini';
export { deepseekProvider } from './deepseek';
export { asrProvider } from './asr';
export { createFakeProvider } from './testing';

/** Built-in providers. Project providers register on top of this. */
export const defaultRegistry = (): ProviderRegistry =>
  createRegistry([minimaxProvider, comfyProvider, falProvider, geminiProvider, deepseekProvider, asrProvider]);

/**
 * The pre-profile default: one endpoint per service, bindings derived from
 * the legacy settings knobs (videoBackend / imageProvider / provider). Every
 * capability is explicitly bound — default mode never hits the "several
 * unbound endpoints" error.
 */
export const defaultProfile = (settings: AppSettings): RuntimeProfile => ({
  format: RUNTIME_FORMAT,
  endpoints: {
    'minimax.default': {
      use: 'minimax',
      config: { baseUrl: settings.minimaxBaseUrl || '/minimax-api' },
      credential: { slot: 'minimax' },
    },
    'comfy.local': {
      use: 'comfy',
      config: {
        serverUrl: settings.comfyServerUrl,
        workflowR2V: settings.comfyWorkflowR2V,
        workflowT2V: settings.comfyWorkflowT2V,
        workflowI2V: settings.comfyWorkflowI2V,
      },
    },
    'fal.default': { use: 'fal', config: { model: settings.falModel }, credential: { slot: 'fal' } },
    'llm.gemini': { use: 'gemini', credential: { slot: 'gemini' } },
    'llm.deepseek': { use: 'deepseek', credential: { slot: 'deepseek' } },
    'asr.default': {
      use: 'asr',
      config: { baseUrl: settings.asrBaseUrl || 'https://api.groq.com/openai/v1' },
      credential: { slot: 'asr' },
    },
  },
  bindings: {
    'video.generate': settings.videoBackend === 'comfy' && settings.comfyServerUrl.trim() ? 'comfy.local' : 'minimax.default',
    'image.generate': settings.imageProvider === 'fal' ? 'fal.default' : 'minimax.default',
    'llm-chat': settings.provider === 'deepseek' ? 'llm.deepseek' : 'llm.gemini',
    'asr.transcribe': 'asr.default',
  },
});

export const parseRuntimeProfile = (text: string): RuntimeProfile => {
  const parsed = JSON.parse(text) as RuntimeProfile;
  if (parsed?.format !== RUNTIME_FORMAT) {
    throw new Error(`storyflow.runtime.json 格式应为 ${RUNTIME_FORMAT}，收到 ${String(parsed?.format)}`);
  }
  if (!parsed.endpoints || typeof parsed.endpoints !== 'object') {
    throw new Error('storyflow.runtime.json 缺少 endpoints');
  }
  return {
    format: RUNTIME_FORMAT,
    endpoints: parsed.endpoints,
    bindings: parsed.bindings ?? {},
  };
};

export const serializeRuntimeProfile = (profile: RuntimeProfile): string =>
  JSON.stringify(profile, null, 2) + '\n';
