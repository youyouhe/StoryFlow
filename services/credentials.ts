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
