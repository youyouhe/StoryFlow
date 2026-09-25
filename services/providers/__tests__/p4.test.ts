/**
 * P4 — Model/Provider/Endpoint layering + credential store.
 * Acceptance: config-only service switch(1), unbound ambiguity refuses(2),
 * no secrets in project files/logs(3), refuse-not-clamp(4), fake provider
 * plug-in(5).
 */
import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../../types';
import {
  defaultProfile,
  defaultRegistry,
  createRegistry,
  createServiceHub,
  parseRuntimeProfile,
  serializeRuntimeProfile,
  resolveCapability,
  BindingError,
  minimaxProvider,
  falProvider,
  createFakeProvider,
  type RuntimeProfile,
} from '..';
import {
  clearSessionCredentials,
  exportCredentialFile,
  importCredentialFile,
  redactSecrets,
  setSessionCredential,
  stripSecrets,
} from '../../credentials';

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  provider: 'gemini',
  geminiApiKey: 'test-gemini-key-000',
  deepseekApiKey: '',
  minimaxApiKey: 'test-minimax-key-000',
  asrApiKey: '',
  falKey: '',
  minimaxBaseUrl: '/minimax-api',
  asrBaseUrl: 'https://api.groq.com/openai/v1',
  videoBackend: 'api',
  imageProvider: 'minimax',
  comfyServerUrl: '',
  ...over,
} as AppSettings);

describe('supports() refuses rather than clamps (acceptance 4)', () => {
  it('H3 refuses duration=20 with a reason instead of trimming to 15', () => {
    const refusal = minimaxProvider.supports('video.generate', {
      prompt: 'x', outputSeconds: 20, resolution: '768P',
    });
    expect('reason' in refusal).toBe(true);
    if ('reason' in refusal) {
      expect(refusal.reason).toMatch(/4[–-]15/);
      expect(refusal.reason).toContain('20');
    }
  });

  it('H3-Max has its own bounds and resolutions; unknown fal cells refuse', () => {
    expect('reason' in minimaxProvider.supports('video.generate', {
      prompt: 'x', outputSeconds: 3, resolution: '768P', model: 'MiniMax-Hailuo-2.3-Max',
    })).toBe(true);
    expect('reason' in minimaxProvider.supports('video.generate', {
      prompt: 'x', outputSeconds: 10, resolution: '2K', model: 'MiniMax-Hailuo-2.3-Max',
    })).toBe(true);
    expect('reason' in falProvider.supports('image.generate', { prompt: 'x', size: 'weird' })).toBe(true);
    expect('reason' in falProvider.supports('image.generate', { prompt: 'x', quality: 'ultra' })).toBe(true);
    expect(falProvider.supports('image.generate', { prompt: 'x', size: 'landscape_16_9', quality: 'low' }).ok).toBe(true);
  });

  it('integer seconds are enforced for H3', () => {
    expect('reason' in minimaxProvider.supports('video.generate', {
      prompt: 'x', outputSeconds: 7.5, resolution: '768P',
    })).toBe(true);
  });
});

describe('capability bindings (acceptance 1 + 2)', () => {
  const twoMinimax: RuntimeProfile = {
    format: 'storyflow.runtime@1',
    endpoints: {
      'minimax.cn': { use: 'minimax', config: { baseUrl: 'https://api.minimaxi.com' }, credential: { slot: 'minimax' } },
      'minimax.intl': { use: 'minimax', config: { baseUrl: 'https://api.minimax.io' }, credential: { slot: 'minimax' } },
    },
    bindings: {},
  };

  it('switching CN→intl is a config change only (acceptance 1)', () => {
    const registry = defaultRegistry();
    const cn = resolveCapability(registry, { ...twoMinimax, bindings: { 'video.generate': 'minimax.cn' } }, 'video.generate');
    const intl = resolveCapability(registry, { ...twoMinimax, bindings: { 'video.generate': 'minimax.intl' } }, 'video.generate');
    expect(cn.config.baseUrl).toBe('https://api.minimaxi.com');
    expect(intl.config.baseUrl).toBe('https://api.minimax.io');
    // same provider, same code path — only the profile line differs
    expect(cn.provider.id).toBe(intl.provider.id);
  });

  it('two unbound endpoints refuse naming BOTH (acceptance 2)', () => {
    const registry = defaultRegistry();
    try {
      resolveCapability(registry, twoMinimax, 'video.generate');
      expect.unreachable('should refuse');
    } catch (e) {
      expect(e).toBeInstanceOf(BindingError);
      const err = e as BindingError;
      expect(err.candidates).toEqual(['minimax.cn', 'minimax.intl']);
      expect(err.message).toContain('minimax.cn');
      expect(err.message).toContain('minimax.intl');
      expect(err.message).toContain('未绑定');
    }
  });

  it('a single unbound candidate auto-selects; a bound non-capable endpoint refuses (no silent fallback)', () => {
    const registry = defaultRegistry();
    const onlyOne: RuntimeProfile = {
      format: 'storyflow.runtime@1',
      endpoints: { 'minimax.cn': twoMinimax.endpoints['minimax.cn'] },
      bindings: {},
    };
    expect(resolveCapability(registry, onlyOne, 'video.generate').name).toBe('minimax.cn');

    const badBind: RuntimeProfile = {
      format: 'storyflow.runtime@1',
      endpoints: { ...twoMinimax.endpoints, 'fal.only': { use: 'fal', credential: { slot: 'fal' } } },
      bindings: { 'video.generate': 'fal.only' },
    };
    expect(() => resolveCapability(registry, badBind, 'video.generate')).toThrow(/不提供能力/);
  });

  it('default profile binds every capability explicitly (legacy knobs)', () => {
    const hub = createServiceHub(defaultRegistry(), defaultProfile(settings()), () => undefined);
    expect(hub.resolve('video.generate').provider.id).toBe('minimax');
    const comfyHub = createServiceHub(defaultRegistry(), defaultProfile(settings({ videoBackend: 'comfy', comfyServerUrl: 'https://gpu.local:8188' })), () => undefined);
    expect(comfyHub.resolve('video.generate').provider.id).toBe('comfy');
  });
});

describe('fake provider plug-in (acceptance 5)', () => {
  it('a brand-new provider joins via registry + binding, no core changes', () => {
    const fake = createFakeProvider({ id: 'my-cloud', chatText: 'hello from my cloud' });
    const registry = createRegistry([...defaultRegistry().values(), fake]);
    const profile: RuntimeProfile = {
      format: 'storyflow.runtime@1',
      endpoints: { 'my-cloud.main': { use: 'my-cloud', credential: { slot: 'minimax' } } },
      bindings: { 'llm-chat': 'my-cloud.main' },
    };
    const hub = createServiceHub(registry, profile, () => 'secret-from-store');
    const endpoint = hub.resolve('llm-chat');
    expect(endpoint.provider.id).toBe('my-cloud');
    expect(hub.context(endpoint).apiKey).toBe('secret-from-store');
  });

  it('dispatch records calls — and supports() can refuse with a reason', async () => {
    const fake = createFakeProvider({
      refuse: (cap) => (cap === 'video.generate' ? 'my-cloud 只支持 10s' : null),
    });
    expect('reason' in fake.supports('video.generate', { outputSeconds: 20 })).toBe(true);
    const reply = await fake.chat!({ config: {}, apiKey: '' }, { system: 's', user: 'u' });
    expect(reply).toBe('fake-response');
    expect(fake.calls.map(c => c.capability)).toContain('llm-chat');
  });
});

describe('profile files carry no secrets (acceptance 3)', () => {
  it('round-trips and credential fields are references, never values', () => {
    const profile = defaultProfile(settings());
    const text = serializeRuntimeProfile(profile);
    expect(text).not.toContain('test-minimax-key-000');
    expect(text).not.toContain('test-gemini-key-000');
    expect(text).toContain('"slot": "minimax"');
    expect(parseRuntimeProfile(text)).toEqual(profile);
    expect(() => parseRuntimeProfile('{"format":"wrong@9"}')).toThrow(/storyflow.runtime@1/);
  });
});

describe('credential store (session memory + encrypted file)', () => {
  it('export/import round-trips behind a passphrase; wrong passphrase fails', async () => {
    const blob = await exportCredentialFile({ minimax: 'sk-super-secret-123' }, 'correct horse');
    const text = await blob.text();
    expect(text).not.toContain('sk-super-secret-123'); // envelope is ciphertext
    expect(await importCredentialFile(blob, 'correct horse')).toEqual({ minimax: 'sk-super-secret-123' });
    await expect(importCredentialFile(blob, 'wrong')).rejects.toThrow(/口令错误|损坏/);
  });

  it('redactSecrets scrubs session values and key shapes from logs (acceptance 3)', () => {
    setSessionCredential('minimax', 'sk-live-abcdef123456');
    expect(redactSecrets('failed: bearer sk-live-abcdef123456 rejected')).not.toContain('sk-live-abcdef123456');
    expect(redactSecrets('Authorization: Bearer gsk_abcdefghijklmnop')).not.toContain('gsk_abcdefghijklmnop');
    expect(redactSecrets('url?key=AIzaSySECRETVALUE&x=1')).not.toContain('AIzaSySECRETVALUE');
    clearSessionCredentials();
  });

  it('stripSecrets empties every key field before persistence', () => {
    const stripped = stripSecrets(settings());
    expect(stripped.minimaxApiKey).toBe('');
    expect(stripped.geminiApiKey).toBe('');
    expect(stripped.falKey).toBe('');
    expect(stripped.minimaxBaseUrl).toBe('/minimax-api'); // non-secret config survives
  });
});
