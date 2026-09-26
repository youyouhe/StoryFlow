import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import {
  setSessionCredential, getSessionCredential, clearSessionCredentials,
  sessionCredentialSnapshot,
  rememberCredentials, restoreRememberedCredentials,
  forgetRememberedCredentials, hasRememberedCredentials,
  migrateAndHydrate,
} from '../services/credentials';

/**
 * issue #9 — 凭证三档方案:
 *   ①keyring(桌面,命令契约由 services/__tests__/desktop.test.ts 锁定)
 *   ②本机记住(设备口令 AES-GCM 加密落 localStorage,非明文)
 *   ③session-only(默认,刷新即失)
 * 加一次性迁移:migrateAndHydrate 把旧 localStorage 明文密钥种进 session
 * store 并水合回设置字段(幂等,session 已有值优先)。
 */

// node 环境无 localStorage —— 内存桩(credentials.ts 的 remember 档只用到
// getItem/setItem/removeItem)。
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});
afterEach(() => {
  store.clear();
  clearSessionCredentials();
});

describe('migrateAndHydrate — 旧 localStorage 密钥一次性迁移(验收②)', () => {
  it('legacy 明文字段种进 session store 并水合回设置(迁移计数如实)', () => {
    const legacy = {
      deepseekApiKey: 'sk-legacy-ds',
      minimaxApiKey: 'ey-legacy-mm',
      geminiApiKey: '', // 空不迁移
      falKey: 'fal-legacy',
      asrApiKey: 'asr-legacy',
    };
    const { settings, migrated } = migrateAndHydrate({ ...legacy });
    expect(migrated).toBe(4);
    expect(getSessionCredential('deepseek')).toBe('sk-legacy-ds');
    expect(getSessionCredential('minimax')).toBe('ey-legacy-mm');
    expect(getSessionCredential('asr')).toBe('asr-legacy');
    // 水合:全部 secret 字段回填 session store 真实状态(空槽 = '')
    expect(settings.deepseekApiKey).toBe('sk-legacy-ds');
    expect(settings.geminiApiKey).toBe('');
  });

  it('幂等:第二次迁移计数为 0,session 已有值优先于 legacy', () => {
    setSessionCredential('deepseek', 'sk-newer'); // session 已有(如 remember 档恢复)
    const first = migrateAndHydrate({ deepseekApiKey: 'sk-older', geminiApiKey: 'g-1' });
    expect(first.migrated).toBe(1); // gemini 迁移,deepseek 不覆盖
    expect(getSessionCredential('deepseek')).toBe('sk-newer');
    expect(getSessionCredential('gemini')).toBe('g-1');
    const second = migrateAndHydrate({ deepseekApiKey: 'sk-older' });
    expect(second.migrated).toBe(0);
    expect(second.settings.deepseekApiKey).toBe('sk-newer'); // 水合自 session
  });
});

describe('本机记住档(加密,非明文) — roundtrip', () => {
  it('remember → 清会话 → restore 完整恢复(验收③快捷恢复路径)', async () => {
    setSessionCredential('deepseek', 'sk-ds');
    setSessionCredential('minimax', 'ey-mm');
    expect(await rememberCredentials()).toBe(true);
    expect(hasRememberedCredentials()).toBe(true);
    // 落盘的是加密 blob,不含明文
    const blob = store.get('storyflow_cred_remember') ?? '';
    expect(blob).not.toContain('sk-ds');
    expect(blob).not.toContain('ey-mm');

    clearSessionCredentials();
    expect(sessionCredentialSnapshot()).toEqual({});
    const restored = await restoreRememberedCredentials();
    expect(restored).toBe(2);
    expect(getSessionCredential('deepseek')).toBe('sk-ds');
    expect(getSessionCredential('minimax')).toBe('ey-mm');
  });

  it('无密钥时 remember 如实返回 false;forget 清档;损坏 blob 恢复 0 并自清', async () => {
    expect(await rememberCredentials()).toBe(false);
    setSessionCredential('fal', 'fk');
    expect(await rememberCredentials()).toBe(true);
    forgetRememberedCredentials();
    expect(hasRememberedCredentials()).toBe(false);
    expect(await restoreRememberedCredentials()).toBe(0);
    // corrupt blob → restore 0, blob self-cleared(下次保存重新武装)
    store.set('storyflow_cred_remember', 'not-base64!!');
    expect(await restoreRememberedCredentials()).toBe(0);
    expect(hasRememberedCredentials()).toBe(false);
  });

  it('会话写穿语义:空值 = 删除槽位(而非存空串)', () => {
    setSessionCredential('deepseek', 'sk');
    setSessionCredential('deepseek', ''); // Settings 清空 key 栏 = 删槽
    expect(getSessionCredential('deepseek')).toBeUndefined();
  });
});
