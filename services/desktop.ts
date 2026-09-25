/**
 * Desktop capability layer (Hypit 尾声 ③,issue #4) — the TS bridge that lets
 * the desktop shell (Tauri) own what the browser cannot: the OS keyring.
 *
 * P4 keeps secrets in session memory only, moving them via an encrypted
 * credential file. The second store named there — "Tauri's OS keychain" —
 * lands here: a keyring-backed credential store with the SAME get/set/delete
 * shape as the session store, selected by runtime capability. Browser runtimes
 * fall back to session memory unchanged; nothing about the browser path moves.
 *
 * `invoke` is injectable (tests run with a fake; the real one comes from
 * @tauri-apps/api at the single call site that opts in). Rust command side:
 * src-tauri/src/keyring_plugin.rs (activate with one `mod` line + handler
 * entry — see its header note).
 */

export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export type CredentialSlotName = 'minimax' | 'fal' | 'gemini' | 'deepseek' | 'asr';

/** The same surface credentials.ts's session store exposes. */
export interface DesktopCredentialStore {
  readonly backend: 'keyring' | 'session';
  get(slot: CredentialSlotName): Promise<string | undefined>;
  set(slot: CredentialSlotName, value: string): Promise<void>;
  delete(slot: CredentialSlotName): Promise<void>;
}

export const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined'
  && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const KEYRING_GET = 'keyring_get';
const KEYRING_SET = 'keyring_set';
const KEYRING_DELETE = 'keyring_delete';

/** Keyring-backed store over the plugin commands (Rust side: keyring_plugin.rs). */
export const createKeyringStore = (invoke: TauriInvoke): DesktopCredentialStore => ({
  backend: 'keyring',
  get: async slot => {
    const v = await invoke(KEYRING_GET, { slot });
    return typeof v === 'string' ? v : undefined;
  },
  set: async (slot, value) => {
    await invoke(KEYRING_SET, { slot, value });
  },
  delete: async slot => {
    await invoke(KEYRING_DELETE, { slot });
  },
});

/** Capability resolution: keyring when the desktop shell offers it, session
 *  memory otherwise (browser reality, unchanged behavior).
 *
 *  `session` is the caller-supplied fallback (App wires credentials.ts's
 *  session map here — no import cycle at module level). Each keyring call
 *  degrades per-call: an absent/failed plugin falls back for THAT operation
 *  instead of bricking the store. */
export const resolveCredentialStore = (
  invoke: TauriInvoke | null,
  session: { get(s: string): string | undefined; set(s: string, v: string): void; delete(s: string): void },
): DesktopCredentialStore => {
  if (invoke) {
    const keyring = createKeyringStore(invoke);
    return {
      backend: 'keyring',
      get: async slot => {
        try { return await keyring.get(slot); } catch { return session.get(slot); }
      },
      set: async (slot, value) => {
        try { await keyring.set(slot, value); } catch { session.set(slot, value); }
      },
      delete: async slot => {
        try { await keyring.delete(slot); } catch { session.delete(slot); }
      },
    };
  }
  return {
    backend: 'session',
    get: async slot => session.get(slot),
    set: async (slot, value) => { session.set(slot, value); },
    delete: async slot => { session.delete(slot); },
  };
};
