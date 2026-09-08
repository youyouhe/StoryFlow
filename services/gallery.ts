/**
 * Gallery singleton wiring — the ONE place to switch mock/real backend.
 *
 * `syncStore` adapts the engine to App.tsx's localStorage screenplay store
 * (`script_{id}` + `script_index`); it also keeps the index upserted so
 * engine-written screenplays (pulled scripts, conflict forks) become visible
 * in the sidebar immediately.
 *
 * Backend switch: replace the MockGalleryApi line with
 *   const api = new HttpGalleryApi('https://api.<host>');
 * — nothing else changes.
 */
import { GalleryClient, MockGalleryApi } from './apiClient';
import { SyncEngine, SyncStoreAdapter } from './syncEngine';
import { ScriptSyncState, Screenplay, SyncStatus } from '../types';

const SCRIPT_PREFIX = 'script_';
const SCRIPT_INDEX = 'script_index';
const SYNC_PREFIX = 'sync_';

interface IndexEntry {
  id: string;
  title: string;
  lastModified: number;
}

function upsertIndex(id: string, title: string) {
  try {
    const idx: IndexEntry[] = JSON.parse(localStorage.getItem(SCRIPT_INDEX) || '[]');
    const entry: IndexEntry = { id, title, lastModified: Date.now() };
    const i = idx.findIndex(e => e.id === id);
    if (i >= 0) idx[i] = entry;
    else idx.push(entry);
    localStorage.setItem(SCRIPT_INDEX, JSON.stringify(idx));
  } catch (e) {
    console.warn('gallery: failed to update script index', e);
  }
}

export const syncStore: SyncStoreAdapter = {
  getScreenplay(id: string): Screenplay | null {
    try {
      const raw = localStorage.getItem(SCRIPT_PREFIX + id);
      return raw ? (JSON.parse(raw) as Screenplay) : null;
    } catch {
      return null;
    }
  },

  putScreenplay(s: Screenplay) {
    try {
      localStorage.setItem(SCRIPT_PREFIX + s.id, JSON.stringify(s));
      upsertIndex(s.id, s.metadata.title);
    } catch (e) {
      console.warn('gallery: failed to persist screenplay', e);
    }
  },

  allScreenplayIds(): string[] {
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // 'script_index' shares the prefix — it is not a screenplay.
      if (key && key.startsWith(SCRIPT_PREFIX) && key !== SCRIPT_INDEX) {
        ids.push(key.slice(SCRIPT_PREFIX.length));
      }
    }
    return ids;
  },

  getSyncState(scriptId: string): ScriptSyncState | null {
    try {
      const raw = localStorage.getItem(SYNC_PREFIX + scriptId);
      return raw ? (JSON.parse(raw) as ScriptSyncState) : null;
    } catch {
      return null;
    }
  },

  setSyncState(scriptId: string, state: ScriptSyncState | null) {
    try {
      if (state) localStorage.setItem(SYNC_PREFIX + scriptId, JSON.stringify(state));
      else localStorage.removeItem(SYNC_PREFIX + scriptId);
    } catch (e) {
      console.warn('gallery: failed to persist sync state', e);
    }
  }
};

// ---- backend selection -----------------------------------------------------
// TODO(gallery P1): swap for HttpGalleryApi('<prod-url>') once the server ships.
const api = new MockGalleryApi();

/** What the account tab displays so dev builds are unmistakable. */
export const GALLERY_BACKEND: 'mock' | 'http' = 'mock';

export const galleryClient = new GalleryClient(api);
export const syncEngine = new SyncEngine(galleryClient, syncStore);

/** Seed the per-script status map the UI badges read from. */
export function readAllSyncStatuses(): Record<string, SyncStatus> {
  const map: Record<string, SyncStatus> = {};
  for (const id of syncStore.allScreenplayIds()) {
    const st = syncStore.getSyncState(id);
    if (st) map[id] = st.status;
  }
  return map;
}
