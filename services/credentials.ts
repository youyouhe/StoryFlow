/**
 * Credential store — session memory + explicit encrypted file (P4 of
 * docs/storyflow-adoption-plan.md).
 *
 * Secrets live in process memory for the session ONLY: they are stripped
 * from every persisted surface (localStorage saves, project exports, logs).
 * Moving them across sessions is an explicit act — export an AES-GCM
 * credential file behind a passphrase, import it next time. Tauri's OS
 * keychain is the planned second store (tauri-plugin-keyring; noted, not
 * wired). No secret ever enters a Runtime Profile: profiles reference named
 * slots, never values.
 */

export type CredentialSlot = 'minimax' | 'fal' | 'gemini' | 'deepseek' | 'asr';

export const CREDENTIAL_SLOTS: CredentialSlot[] = ['minimax', 'fal', 'gemini', 'deepseek', 'asr'];

/** AppSettings field → credential slot (the persistence strip list). */
export const SECRET_SETTINGS_FIELDS = [
  'geminiApiKey', 'deepseekApiKey', 'minimaxApiKey', 'asrApiKey', 'falKey',
] as const;

export const SLOT_FOR_FIELD: Record<string, CredentialSlot> = {
  geminiApiKey: 'gemini',
  deepseekApiKey: 'deepseek',
  minimaxApiKey: 'minimax',
  asrApiKey: 'asr',
  falKey: 'fal',
};

/** Persistence strip: secrets stay in session memory, never on disk. */
export const stripSecrets = <T extends object>(settings: T): T => {
  const out = { ...settings } as Record<string, unknown>;
  for (const field of SECRET_SETTINGS_FIELDS) out[field] = '';
  return out as T;
};

const session = new Map<string, string>();

export const setSessionCredential = (slot: string, value: string): void => {
  if (value) session.set(slot, value);
  else session.delete(slot);
};

export const getSessionCredential = (slot: string): string | undefined => session.get(slot);

export const clearSessionCredentials = (): void => session.clear();

export const sessionCredentialSnapshot = (): Record<string, string> =>
  Object.fromEntries(session.entries());

// ---------------------------------------------------------------------------
// 本机记住(加密)档 — issue #9 体验档位:刷新后 key 不再必然丢失。
// 设备随机口令 + PBKDF2/AES-GCM 加密 blob 存 localStorage(与凭证文件同一
// 加密栈)。安全口径:等同设备本地存储(挡 casual 磁盘读取,不挡本机攻击
// 者);跨设备迁移走显式凭证文件;桌面端的正解是 OS keyring
// (src-tauri/src/keyring_plugin.rs 已备,见 services/desktop.ts)。
// ---------------------------------------------------------------------------

const DEVICE_KEY_STORE = 'storyflow_cred_device_key';
const REMEMBER_BLOB_STORE = 'storyflow_cred_remember';

const devicePassphrase = (): string => {
  let k = localStorage.getItem(DEVICE_KEY_STORE);
  if (!k) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    k = btoa(String.fromCharCode(...raw));
    localStorage.setItem(DEVICE_KEY_STORE, k);
  }
  return k;
};

/** Persist the current session slots into the encrypted remember blob. */
export const rememberCredentials = async (): Promise<boolean> => {
  const snap = sessionCredentialSnapshot();
  if (!Object.keys(snap).length) return false;
  const blob = await exportCredentialFile(snap, devicePassphrase());
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  localStorage.setItem(REMEMBER_BLOB_STORE, btoa(bin));
  return true;
};

/** Restore slots from the remember blob. Returns the number of slots
 *  restored (0 = nothing remembered or decryption failed — caller toasts). */
export const restoreRememberedCredentials = async (): Promise<number> => {
  const data = localStorage.getItem(REMEMBER_BLOB_STORE);
  if (!data) return 0;
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const slots = await importCredentialFile(new Blob([bytes], { type: 'application/json' }), devicePassphrase());
    for (const [slot, v] of Object.entries(slots)) setSessionCredential(slot, v);
    return Object.keys(slots).length;
  } catch {
    // corrupt blob / stale device key — drop it so the next save re-arms clean
    localStorage.removeItem(REMEMBER_BLOB_STORE);
    return 0;
  }
};

export const forgetRememberedCredentials = (): void => {
  localStorage.removeItem(REMEMBER_BLOB_STORE);
};

export const hasRememberedCredentials = (): boolean =>
  !!localStorage.getItem(REMEMBER_BLOB_STORE);

// ---------------------------------------------------------------------------
// 一次性迁移 + 水合 — issue #9:P4 之前 localStorage 设置里直接存密钥,合并后
// 生成走 session store,两处脱节(Settings 有值、生成 KEY_MISSING)。
// ---------------------------------------------------------------------------

/** One-time legacy migration + hydration. Seeds EMPTY slots from non-empty
 *  legacy setting fields, then hydrates ALL secret fields from the session
 *  store (canonical). Idempotent: a second run migrates nothing. Mutates and
 *  returns the settings record for the caller to persist (stripped). */
export const migrateAndHydrate = (
  parsed: Record<string, unknown>,
): { settings: Record<string, unknown>; migrated: number } => {
  let migrated = 0;
  for (const field of SECRET_SETTINGS_FIELDS) {
    const slot = SLOT_FOR_FIELD[field];
    const legacy = parsed[field];
    if (typeof legacy === 'string' && legacy && !getSessionCredential(slot)) {
      setSessionCredential(slot, legacy);
      migrated += 1;
    }
  }
  for (const field of SECRET_SETTINGS_FIELDS) {
    parsed[field] = getSessionCredential(SLOT_FOR_FIELD[field]) ?? '';
  }
  return { settings: parsed, migrated };
};

// ---------------------------------------------------------------------------
// Redaction — logs and diagnostics never carry secrets
// ---------------------------------------------------------------------------

/** Scrub known session secrets and generic key shapes from diagnostic text. */
export const redactSecrets = (text: string): string => {
  let out = text;
  for (const value of session.values()) {
    if (value.length >= 6) out = out.split(value).join('[redacted]');
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]');
  out = out.replace(/\b(?:sk|gsk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
  out = out.replace(/([?&](?:key|api_key|apikey|token|secret)=)[^&\s"']+/gi, '$1[redacted]');
  out = out.replace(/(["']?(?:api[_-]?key|apikey|token|authorization|secret)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi, '$1[redacted]');
  return out;
};

// ---------------------------------------------------------------------------
// Encrypted credential file (PBKDF2 + AES-GCM via WebCrypto)
// ---------------------------------------------------------------------------

interface CredentialFileEnvelope {
  v: 1;
  kdf: { name: 'PBKDF2'; salt: string; iterations: number };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

const PBKDF2_ITERATIONS = 210_000;

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));

const deriveKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

/** Encrypt a slot map into a portable credential file. */
export const exportCredentialFile = async (
  values: Record<string, string>,
  passphrase: string,
): Promise<Blob> => {
  if (!passphrase) throw new Error('需要口令来加密凭证文件');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify({ v: 1, slots: values }));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource);
  const envelope: CredentialFileEnvelope = {
    v: 1,
    kdf: { name: 'PBKDF2', salt: b64(salt), iterations: PBKDF2_ITERATIONS },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    data: b64(new Uint8Array(cipher)),
  };
  return new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
};

/** Decrypt a credential file. Throws on wrong passphrase / wrong shape. */
export const importCredentialFile = async (
  blob: Blob,
  passphrase: string,
): Promise<Record<string, string>> => {
  const envelope = JSON.parse(await blob.text()) as CredentialFileEnvelope;
  if (envelope?.v !== 1 || envelope.kdf?.name !== 'PBKDF2' || envelope.cipher?.name !== 'AES-GCM') {
    throw new Error('不是 StoryFlow 凭证文件');
  }
  const key = await deriveKey(passphrase, unb64(envelope.kdf.salt));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(envelope.cipher.iv) as BufferSource },
      key,
      unb64(envelope.data) as BufferSource,
    );
  } catch {
    throw new Error('口令错误或文件已损坏');
  }
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { slots?: Record<string, string> };
  return parsed.slots ?? {};
};
