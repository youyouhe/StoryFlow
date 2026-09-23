import { useState, useEffect, useCallback } from 'react';
import { Screenplay } from '../types';
import { DEFAULT_SCRIPT } from '../constants';
import { syncEngine } from '../services/gallery';
import { shipLog } from '../services/debugLog';

// Storage Constants
export const STORAGE_KEYS = {
    LEGACY_AUTOSAVE: 'screenplay_autosave',
    SCRIPT_INDEX: 'script_index',
    SCRIPT_PREFIX: 'script_',
    APP_SETTINGS: 'screenplay_app_settings'
};

export interface ScriptSummary {
    id: string;
    title: string;
    lastModified: number;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

/**
 * The SCRIPT LIBRARY state domain: the saved-script index, the active
 * screenplay, the selected block and the autosave lifecycle.
 *
 * Extracted verbatim from App.tsx (wave 1 of the App split): same state
 * initializers, same effects (legacy migration + 1s-debounced autosave with
 * syncEngine.markDirty), same dependency arrays. Cross-domain orchestration
 * (delete/rename touch cloud sync; create-from-template touches UI modals)
 * stays in App.tsx.
 */
export function useScriptLibrary() {
  // Load Script List (Index)
  const [savedScripts, setSavedScripts] = useState<ScriptSummary[]>(() => {
      try {
          const indexJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_INDEX);
          return indexJson ? JSON.parse(indexJson) : [];
      } catch (e) {
          console.warn("Failed to load script index", e); shipLog("script", "error", "Failed to load script index", e);
          return [];
      }
  });

  // Load Initial Screenplay
  const [screenplay, setScreenplay] = useState<Screenplay>(() => {
    // 1. Try migration from legacy system first
    try {
        const legacySave = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTOSAVE);
        if (legacySave) {
            const parsed = JSON.parse(legacySave);
            if (parsed && Array.isArray(parsed.blocks)) {
                // Ensure it has an ID
                if (!parsed.id) parsed.id = generateId();
                if (!parsed.metadata.scriptLanguage) parsed.metadata.scriptLanguage = 'en';

                // Return legacy script to be set as current, migration happens in useEffect
                return parsed;
            }
        }
    } catch (e) {
        console.warn("Legacy migration check failed", e);
    }

    // 2. Try loading the most recent script from the index
    try {
        const indexJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_INDEX);
        if (indexJson) {
            const index: ScriptSummary[] = JSON.parse(indexJson);
            if (index.length > 0) {
                // Sort by recency
                index.sort((a, b) => b.lastModified - a.lastModified);
                const mostRecentId = index[0].id;
                const scriptJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_PREFIX + mostRecentId);
                if (scriptJson) {
                    return JSON.parse(scriptJson);
                }
            }
        }
    } catch (e) {
        console.warn("Failed to load recent script", e); shipLog("script", "error", "Failed to load recent script", e);
    }

    // 3. Fallback to default
    const newScript = { ...DEFAULT_SCRIPT, id: generateId() };
    return newScript;
  });

  const [selectedBlockId, setSelectedBlockId] = useState<string>(() => {
      return screenplay.blocks.length > 0 ? screenplay.blocks[0].id : '';
  });

  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');

  // Migration & Autosave Logic
  useEffect(() => {
    setSaveStatus('saving');

    // Migration Logic: If legacy exists, save it to new format and delete legacy key
    const legacySave = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTOSAVE);
    if (legacySave) {
        try {
             // We are currently working with the migrated object in state 'screenplay'
             // Just ensure the legacy key is removed so we don't migrate again on refresh
             localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTOSAVE);
        } catch(e) { console.error("Migration cleanup failed", e); }
    }

    const timer = setTimeout(() => {
      try {
        // 1. Save Content
        localStorage.setItem(STORAGE_KEYS.SCRIPT_PREFIX + screenplay.id, JSON.stringify(screenplay));

        // 2. Update Index
        const newSummary: ScriptSummary = {
            id: screenplay.id,
            title: screenplay.metadata.title,
            lastModified: Date.now()
        };

        setSavedScripts(prev => {
            const filtered = prev.filter(s => s.id !== screenplay.id);
            const newList = [...filtered, newSummary];
            localStorage.setItem(STORAGE_KEYS.SCRIPT_INDEX, JSON.stringify(newList));
            return newList;
        });

        setSaveStatus('saved');

        // Gallery sync: mirror the local save into the engine. Cloud-backed
        // scripts flip to 'dirty' and flush on the engine's own debounce;
        // never-synced ('local') scripts are intentionally left alone — the
        // first push is always the explicit one-click sync.
        syncEngine.markDirty(screenplay);
      } catch (e) {
        console.error("Autosave failed", e); shipLog("autosave", "error", "Autosave failed", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [screenplay]);

  /** Re-read the script index from localStorage (engine pulls/forks land here). */
  const refreshSavedScripts = useCallback(() => {
    try {
      const idx = JSON.parse(localStorage.getItem(STORAGE_KEYS.SCRIPT_INDEX) || '[]');
      if (Array.isArray(idx)) setSavedScripts(idx);
    } catch { /* ignore */ }
  }, []);

  /** Load a stored script into the editor. Returns false when the id has no
   *  readable payload (caller decides about any UI side effects). */
  const loadScript = useCallback((id: string): boolean => {
      try {
          const scriptJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_PREFIX + id);
          if (scriptJson) {
              const loadedScript = JSON.parse(scriptJson);
              setScreenplay(loadedScript);
              if (loadedScript.blocks.length > 0) {
                  setSelectedBlockId(loadedScript.blocks[0].id);
              }
              return true;
          }
      } catch (e) {
          console.error("Failed to load script", e); shipLog("script", "error", "Failed to load script", e);
      }
      return false;
  }, []);

  /** Reset to the pristine default script (used when the last script is deleted). */
  const createDefaultScript = useCallback(() => {
      setScreenplay({ ...DEFAULT_SCRIPT, id: generateId() });
  }, []);

  return {
    savedScripts, setSavedScripts,
    screenplay, setScreenplay,
    selectedBlockId, setSelectedBlockId,
    saveStatus,
    refreshSavedScripts,
    loadScript,
    createDefaultScript,
  };
}
