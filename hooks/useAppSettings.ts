import { useState, useEffect, useRef } from 'react';
import { AppSettings, ScriptMetadata, Screenplay } from '../types';
import { DEFAULT_APP_SETTINGS } from '../constants';
import { STORAGE_KEYS } from './useScriptLibrary';
import {
  stripSecrets, setSessionCredential, getSessionCredential, SLOT_FOR_FIELD,
  SECRET_SETTINGS_FIELDS, migrateAndHydrate, rememberCredentials,
  restoreRememberedCredentials, hasRememberedCredentials,
} from '../services/credentials';
import { isTauriRuntime, createKeyringStore, type DesktopCredentialStore, type CredentialSlotName } from '../services/desktop';
import { invoke } from '@tauri-apps/api/core';
import { shipLog } from '../services/debugLog';

/**
 * The APP SETTINGS domain: the persisted settings record (provider, keys,
 * models, colors, shortcuts, AI params) with its load-time migrations and the
 * save effect, plus the SettingsModal save handler (which also writes the
 * script metadata).
 *
 * Credential model (issue #9, 三档并存用户自选 — 站长拍板):
 *   · session credential store (services/credentials.ts) is ALWAYS the
 *     runtime-canonical mirror — the P4 provider hub reads keys from it, so
 *     generation and Settings can never disagree; in-memory appSettings
 *     mirrors the session store, so pre-P4 read sites
 *     (`appSettings.minimaxApiKey` etc.) keep working unchanged;
 *   · tier 'session'(默认,最高档):nothing persisted — refresh loses keys
 *     (explicit toast + Settings hint);
 *   · tier 'remember'(Web):device-passphrase-derived AES-GCM blob in
 *     localStorage — refreshed automatically, never plaintext;
 *   · tier 'keyring'(桌面):OS keyring via Tauri commands
 *     (src-tauri/src/keyring_plugin.rs ↔ services/desktop.ts);浏览器不可用
 *     如实回落并提示;
 *   · one-time legacy migration: pre-P4 saves carried raw keys → seeded into
 *     the session store on first load (toast); persisted settings are ALWAYS
 *     stripped (localStorage never holds plaintext keys).
 */

export type CredentialTier = 'session' | 'remember' | 'keyring';

export function useAppSettings({ setScreenplay, onToast, t }: {
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  /** Privacy/credential toasts (migration + tier-restore outcomes). */
  onToast?: (msg: string) => void;
  t?: Record<string, unknown>;
}) {
  const tt = (key: string, fallback: string): string =>
    typeof t?.[key] === 'string' ? (t[key] as string) : fallback;

  // OS keyring store — only exists in the Tauri runtime (tier ①).
  const keyring: DesktopCredentialStore | null = isTauriRuntime()
    ? createKeyringStore(invoke as never)
    : null;

  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.APP_SETTINGS);
        if (saved) {
            const parsed = { ...(JSON.parse(saved) as Record<string, unknown>) };
            // issue #9: one-time legacy migration (raw keys → session store)
            // + hydration (session store is canonical). Idempotent.
            const { settings, migrated } = migrateAndHydrate(parsed);
            if (migrated > 0) {
              shipLog('credentials', 'info', `migrated ${migrated} legacy key(s) into the session store`);
              pendingMigrateToast.current = migrated;
            }
            return {
                ...DEFAULT_APP_SETTINGS,
                ...settings,
                colorSettings: { ...DEFAULT_APP_SETTINGS.colorSettings, ...((settings.colorSettings as object) || {}) },
                shortcuts: { ...DEFAULT_APP_SETTINGS.shortcuts, ...((settings.shortcuts as object) || {}) },
                autoAcceptAI: (settings.autoAcceptAI as boolean) ?? DEFAULT_APP_SETTINGS.autoAcceptAI,
                // Migrate deprecated Gemini model names to the current default (3.7 Flash)
                geminiModel: ['gemini-2.0-flash', 'gemini-2.5-flash'].includes(settings.geminiModel as string)
                    ? DEFAULT_APP_SETTINGS.geminiModel
                    : ((settings.geminiModel as string) || DEFAULT_APP_SETTINGS.geminiModel),
                geminiThinkingLevel: (settings.geminiThinkingLevel as string) || DEFAULT_APP_SETTINGS.geminiThinkingLevel,
                // Migrate deprecated DeepSeek model names to the current default (V4 Flash)
                deepseekModel: ['deepseek-chat', 'deepseek-reasoner'].includes(settings.deepseekModel as string)
                    ? DEFAULT_APP_SETTINGS.deepseekModel
                    : ((settings.deepseekModel as string) || DEFAULT_APP_SETTINGS.deepseekModel),
                // Migrate the old direct MiniMax URL to the dev proxy: settings saved
                // before the proxy shipped carry the old default verbatim and would
                // otherwise override it forever.
                minimaxBaseUrl: settings.minimaxBaseUrl === 'https://api.minimaxi.com'
                    ? DEFAULT_APP_SETTINGS.minimaxBaseUrl
                    : ((settings.minimaxBaseUrl as string) || DEFAULT_APP_SETTINGS.minimaxBaseUrl),
                credentialTier: ((settings.credentialTier as CredentialTier) || 'session'),
            } as AppSettings;
        }
    } catch (e) {
        console.warn("Failed to load app settings", e);
    }
    return { ...DEFAULT_APP_SETTINGS };
  });

  // Deferred toasts from the sync initializer (can't toast during render).
  const pendingMigrateToast = useRef<number | null>(null);
  const bootstrapped = useRef(false);

  // Tier restore on boot: seed the session store from the ACTIVE tier, then
  // mirror into appSettings so every read site sees the restored keys.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const migrateN = pendingMigrateToast.current;
    pendingMigrateToast.current = null;
    const tier = appSettings.credentialTier ?? 'session';

    const mirrorAndToast = (restored: number, note: string) => {
      if (restored > 0) {
        setAppSettings(prev => {
          const next = { ...prev } as Record<string, unknown>;
          for (const field of SECRET_SETTINGS_FIELDS) {
            const v = getSessionCredential(SLOT_FOR_FIELD[field]);
            if (v) next[field] = v;
          }
          return next as unknown as AppSettings;
        });
        onToast?.(tt('credRestored', `已从${note}恢复 ${restored} 个密钥`));
      } else if (migrateN) {
        onToast?.(tt('credMigrated', `已迁移 ${migrateN} 个密钥到会话凭证库`));
      }
    };

    if (tier === 'keyring') {
      if (!keyring) {
        onToast?.(tt('credKeyringUnavailable', 'OS keyring 档在浏览器不可用——已按会话档运行（桌面端可用）'));
        if (migrateN) onToast?.(tt('credMigrated', `已迁移 ${migrateN} 个密钥到会话凭证库`));
        return;
      }
      void (async () => {
        let n = 0;
        for (const slot of ['minimax', 'fal', 'gemini', 'deepseek', 'asr'] as CredentialSlotName[]) {
          try {
            const v = await keyring.get(slot);
            if (v) { setSessionCredential(slot, v); n += 1; }
          } catch { /* per-slot degrade — refuses silently only for absent plugin */ }
        }
        mirrorAndToast(n, 'OS keyring');
      })();
      return;
    }

    if (tier === 'remember') {
      void restoreRememberedCredentials().then(restored => {
        if (restored === 0 && hasRememberedCredentials()) {
          onToast?.(tt('credRestoreFailed', '本机密钥档恢复失败——请在设置中重新输入，或导入凭证文件'));
          return;
        }
        mirrorAndToast(restored, '本机加密档');
      });
      return;
    }

    // tier 'session' — nothing persisted; legacy migration toast only
    if (migrateN) {
      onToast?.(tt('credMigratedSession', `已迁移 ${migrateN} 个密钥到会话凭证库——刷新后会丢失，可在设置选择「本机记住」或桌面端 keyring 档`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App Settings Autosave — ALWAYS persisted stripped: localStorage never
  // holds plaintext keys (the session store is canonical; in-memory mirrors).
  useEffect(() => {
      localStorage.setItem(STORAGE_KEYS.APP_SETTINGS, JSON.stringify(stripSecrets(appSettings)));
  }, [appSettings]);

  const handleUpdateSettings = (newMetadata: ScriptMetadata, newAppSettings: AppSettings) => {
      setScreenplay(prev => ({
          ...prev,
          metadata: newMetadata,
          lastModified: Date.now()
      }));
      // Write-through: the form's secret fields ARE the session store's new
      // state — non-empty sets, empty clears (display ≡ generation, issue #9).
      const slotValues: Record<string, string> = {};
      for (const field of SECRET_SETTINGS_FIELDS) {
          const slot = SLOT_FOR_FIELD[field];
          const v = (newAppSettings as unknown as Record<string, string>)[field];
          if (v && v.trim()) {
            setSessionCredential(slot, v.trim());
            slotValues[slot] = v.trim();
          } else if (getSessionCredential(slot)) {
            setSessionCredential(slot, '');
          }
      }
      setAppSettings(newAppSettings);

      // Persist per ACTIVE tier (三档并存:其它档位的存量不动,切档即恢复).
      const tier = newAppSettings.credentialTier ?? 'session';
      if (tier === 'keyring') {
        if (keyring) {
          void (async () => {
            for (const [slot, v] of Object.entries(slotValues)) {
              try { await keyring.set(slot as CredentialSlotName, v); } catch (e) {
                onToast?.(tt('credKeyringWriteFail', `keyring 写入失败(${slot})——密钥仍在本会话有效`));
                shipLog('credentials', 'error', `keyring set ${slot} failed`, e);
              }
            }
          })();
        } else {
          onToast?.(tt('credKeyringUnavailable', 'OS keyring 档在浏览器不可用——密钥按会话档运行（桌面端可用）'));
        }
      } else if (tier === 'remember') {
        void rememberCredentials().then(ok => {
          if (!ok) onToast?.(tt('credRememberNone', '没有可记住的密钥——请先填写至少一个 key'));
        });
      }
      // tier 'session' — nothing persisted (the point of the highest tier).
  };

  return { appSettings, setAppSettings, handleUpdateSettings };
}
