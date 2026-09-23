import { useCallback } from 'react';
import { Screenplay } from '../types';
import { galleryClient } from '../services/gallery';
import { syncEngine } from '../services/gallery';
import { shipLog } from '../services/debugLog';
import { STORAGE_KEYS, type ScriptSummary } from './useScriptLibrary';
import { SyncStatus } from '../types';

const generateId = () => Math.random().toString(36).substring(2, 11);

/**
 * Script MANAGEMENT orchestration: load a stored script, delete a script
 * (local storage + index + cloud bookkeeping + load-next-or-default), rename
 * (index + active screenplay or the stored copy).
 *
 * Delete/rename span the library and sync domains, so they live in their own
 * hook called AFTER both, receiving the sync badge/error setters explicitly.
 * Bodies verbatim from App.tsx (wave 2 of the App split).
 */
export function useScriptManagement({
  screenplay, setScreenplay,
  savedScripts, setSavedScripts,
  loadScript, createDefaultScript,
  setSyncError, setSyncStatusMap,
  setSidebarOpen, t,
}: {
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  savedScripts: ScriptSummary[];
  setSavedScripts: React.Dispatch<React.SetStateAction<ScriptSummary[]>>;
  loadScript: (id: string) => boolean;
  createDefaultScript: () => void;
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  setSyncStatusMap: React.Dispatch<React.SetStateAction<Record<string, SyncStatus>>>;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  t: typeof import('../constants').TRANSLATIONS['en'];
}) {
  const handleLoadScript = (id: string) => {
      // Load + select first block in the library domain; the sidebar pop is
      // the App-level UI side effect (only on a successful load, as before).
      if (loadScript(id)) setSidebarOpen(true);
  };

  const handleDeleteScript = (id: string) => {
      if (!window.confirm(t.confirmDelete)) return;

      try {
          // Remove Content
          localStorage.removeItem(STORAGE_KEYS.SCRIPT_PREFIX + id);

          // Cloud bookkeeping: drop local sync state; soft-delete the cloud
          // copy too so pullAll won't resurrect it on the next sign-in.
          const cloudId = syncEngine.cloudIdOf(id);
          syncEngine.forgetScript(id);
          if (cloudId && galleryClient.isAuthenticated) {
              galleryClient.deleteScript(cloudId).catch(e => {
                  setSyncError(`删除云端副本失败: ${e instanceof Error ? e.message : String(e)}`);
              });
          }
          setSyncStatusMap(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
          });

          // Update Index
          const newIndex = savedScripts.filter(s => s.id !== id);
          localStorage.setItem(STORAGE_KEYS.SCRIPT_INDEX, JSON.stringify(newIndex));
          setSavedScripts(newIndex);

          // If deleted current script, load another or create default
          if (id === screenplay.id) {
              if (newIndex.length > 0) {
                  handleLoadScript(newIndex[0].id);
              } else {
                  // Reset to default
                  createDefaultScript();
              }
          }
      } catch (e) {
          console.error("Failed to delete script", e); shipLog("script", "error", "Failed to delete script", e);
      }
  };

  const handleRenameScript = (id: string, newTitle: string) => {
      // 1. Update Index
      const updatedScripts = savedScripts.map(s => 
          s.id === id ? { ...s, title: newTitle, lastModified: Date.now() } : s
      );
      setSavedScripts(updatedScripts);
      localStorage.setItem(STORAGE_KEYS.SCRIPT_INDEX, JSON.stringify(updatedScripts));

      // 2. Update Active State if matched
      if (id === screenplay.id) {
          setScreenplay(prev => ({
              ...prev,
              metadata: { ...prev.metadata, title: newTitle },
              lastModified: Date.now()
          }));
      } else {
          // 3. Update Storage for inactive script
          try {
              const scriptJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_PREFIX + id);
              if (scriptJson) {
                  const s = JSON.parse(scriptJson);
                  s.metadata.title = newTitle;
                  s.lastModified = Date.now();
                  localStorage.setItem(STORAGE_KEYS.SCRIPT_PREFIX + id, JSON.stringify(s));
              }
          } catch(e) { console.error(e); }
      }
  };


  return { handleLoadScript, handleDeleteScript, handleRenameScript };
}
