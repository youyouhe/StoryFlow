import { describe, it, expect } from 'vitest';

import {
  isTauriRuntime, createKeyringStore, resolveCredentialStore,
  type TauriInvoke, type CredentialSlotName,
} from '../desktop';

/**
 * Desktop capability layer(Hypit 尾声 ③)——keyring 后端与 session 回退的
 * 选择/降级语义;Rust command 侧契约(keyring_get/set/delete)按调用形状锁定。
 */

const slot: CredentialSlotName = 'gemini';

const sessionStore = () => {
  const m = new Map<string, string>();
  return {
    get: (s: string) => m.get(s),
    set: (s: string, v: string) => { m.set(s, v); },
    delete: (s: string) => { m.delete(s); },
    _m: m,
  };
};

describe('isTauriRuntime', () => {
  it('node/vitest 无 window → false', () => {
    expect(isTauriRuntime()).toBe(false);
  });
});

describe('createKeyringStore — Rust command 契约', () => {
  it('get/set/delete 按命令名与参数形状调用 invoke', async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    let stored: string | undefined;
    const invoke: TauriInvoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'keyring_set') stored = args?.value as string;
      if (cmd === 'keyring_get') return stored ?? null;
      if (cmd === 'keyring_delete') stored = undefined;
      return null;
    };
    const store = createKeyringStore(invoke);
    expect(store.backend).toBe('keyring');
    await store.set('gemini', 'sk-secret');
    expect(await store.get('gemini')).toBe('sk-secret');
    await store.delete('gemini');
    expect(await store.get('gemini')).toBeUndefined();
    expect(calls.map(c => c.cmd)).toEqual(['keyring_set', 'keyring_get', 'keyring_delete', 'keyring_get']);
    expect(calls[0].args).toEqual({ slot: 'gemini', value: 'sk-secret' });
  });

  it('get 返回非 string(如 null)→ undefined', async () => {
    const store = createKeyringStore(async () => null);
    expect(await store.get(slot)).toBeUndefined();
  });
});

describe('resolveCredentialStore — 能力选择与逐调用降级', () => {
  it('invoke=null → session 后端(浏览器现实,行为不变)', async () => {
    const s = sessionStore();
    const store = resolveCredentialStore(null, s);
    expect(store.backend).toBe('session');
    await store.set(slot, 'v1');
    expect(s._m.get('gemini')).toBe('v1');
    expect(await store.get(slot)).toBe('v1');
    await store.delete(slot);
    expect(await store.get(slot)).toBeUndefined();
  });

  it('keyring 可用 → 直达 keyring,session 不被写', async () => {
    const s = sessionStore();
    const store = resolveCredentialStore(async cmd => (cmd === 'keyring_get' ? null : 'ok'), s);
    await store.set(slot, 'kr-v');
    expect(s._m.size).toBe(0);
    expect(await store.get(slot)).toBeUndefined(); // fake always null,但走了 keyring
  });

  it('keyring 单次失败 → 该次调用降级 session(不整店报废)', async () => {
    const s = sessionStore();
    let failMode = false;
    const store = resolveCredentialStore(async (cmd, args) => {
      if (failMode) throw new Error('plugin gone');
      if (cmd === 'keyring_set') s._m.set(`kr:${args?.slot}`, args?.value as string);
      if (cmd === 'keyring_get') return s._m.get(`kr:${args?.slot}`) ?? null;
      return null;
    }, s);
    await store.set(slot, 'before');
    failMode = true;
    await store.set(slot, 'during-failure'); // 降级到 session
    expect(s._m.get('gemini')).toBe('during-failure');
    failMode = false;
    await store.set(slot, 'after');
    expect(s._m.get('gemini')).toBe('during-failure'); // keyring 恢复后不再写 session
  });
});
