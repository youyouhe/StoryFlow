import { useState, useEffect } from 'react';
import { AppSettings, ScriptMetadata, Screenplay } from '../types';
import { DEFAULT_APP_SETTINGS } from '../constants';
import { STORAGE_KEYS } from './useScriptLibrary';

/**
 * The APP SETTINGS domain: the persisted settings record (provider, keys,
 * models, colors, shortcuts, AI params) with its load-time migrations and the
 * save effect, plus the SettingsModal save handler (which also writes the
 * script metadata).
 *
 * Extracted verbatim from App.tsx (wave 2 of the App split).
 */
export function useAppSettings({ setScreenplay }: {
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
}) {
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.APP_SETTINGS);
        if (saved) {
            const parsed = JSON.parse(saved);
            return {
                ...DEFAULT_APP_SETTINGS,
                ...parsed,
                colorSettings: { ...DEFAULT_APP_SETTINGS.colorSettings, ...(parsed.colorSettings || {}) },
                shortcuts: { ...DEFAULT_APP_SETTINGS.shortcuts, ...(parsed.shortcuts || {}) },
                // Ensure autoAcceptAI has a value (for backward compatibility)
                autoAcceptAI: parsed.autoAcceptAI ?? DEFAULT_APP_SETTINGS.autoAcceptAI,
                // Migrate deprecated Gemini model names to the current default (3.7 Flash)
                geminiModel: ['gemini-2.0-flash', 'gemini-2.5-flash'].includes(parsed.geminiModel)
                    ? DEFAULT_APP_SETTINGS.geminiModel
                    : (parsed.geminiModel || DEFAULT_APP_SETTINGS.geminiModel),
                // Ensure geminiThinkingLevel has a value (added when thinking controls shipped)
                geminiThinkingLevel: parsed.geminiThinkingLevel || DEFAULT_APP_SETTINGS.geminiThinkingLevel,
                // Migrate deprecated DeepSeek model names to the current default (V4 Flash)
                deepseekModel: ['deepseek-chat', 'deepseek-reasoner'].includes(parsed.deepseekModel)
                    ? DEFAULT_APP_SETTINGS.deepseekModel
                    : (parsed.deepseekModel || DEFAULT_APP_SETTINGS.deepseekModel),
                // Migrate the old direct MiniMax URL to the dev proxy: settings saved
                // before the proxy shipped carry the old default verbatim and would
                // otherwise override it forever.
                minimaxBaseUrl: parsed.minimaxBaseUrl === 'https://api.minimaxi.com'
                    ? DEFAULT_APP_SETTINGS.minimaxBaseUrl
                    : (parsed.minimaxBaseUrl || DEFAULT_APP_SETTINGS.minimaxBaseUrl)
            };
        }
    } catch (e) {
        console.warn("Failed to load app settings", e);
    }
    return DEFAULT_APP_SETTINGS;
  });

  // App Settings Autosave
  useEffect(() => {
      localStorage.setItem(STORAGE_KEYS.APP_SETTINGS, JSON.stringify(appSettings));
  }, [appSettings]);

  const handleUpdateSettings = (newMetadata: ScriptMetadata, newAppSettings: AppSettings) => {
      setScreenplay(prev => ({
          ...prev,
          metadata: newMetadata,
          lastModified: Date.now()
      }));
      setAppSettings(newAppSettings);
  };

  return { appSettings, setAppSettings, handleUpdateSettings };
}
