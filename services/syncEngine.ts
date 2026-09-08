/**
 * Gallery sync engine (P1) — local-first one-click sync.
 *
 * Per-script state machine (ScriptSyncState persisted as `sync_{scriptId}`):
 *
 *   local --syncNow--> pushing --2xx--> synced --edit--> dirty --flush--> pushing
 *                                         ▲                        │
 *                                         └── accept+overwrite ── 409
 *
 * Conflict policy ("local is authoritative, nothing is ever lost"):
 *   on REVISION_CONFLICT → snapshot the cloud doc as a local fork titled
 *   "<title> (云端冲突副本)", then accept the server revision and overwrite it
 *   with the local doc. The losing cloud state survives both in the server's
 *   immutable version history and as the local fork.
 *
 * Edits to never-synced ('local') scripts do NOT auto-push — the first push
 * is always the explicit one-click sync (syncNow). Scripts already in the
 * cloud auto-sync via a debounced flush driven by the autosave hook.
 *
 * The outbox (`sync_outbox`) is persisted: queued pushes survive reloads.
 * Entries are dropped after a successful push and kept (with backoff at the
 * scheduling layer) on network failure. Sign-out pauses flushing; signing
 * back in resumes it (call onSignedIn).
 */
import { CloudScript, GalleryApiError, GalleryClient, isGalleryApiError } from './apiClient';
import { GalleryUser, Screenplay, ScriptSyncState, SyncStatus } from '../types';

/** Storage-port the engine needs from the app. App.tsx already owns every
 *  one of these operations for its localStorage screenplay store. */
export interface SyncStoreAdapter {
  getScreenplay(id: string): Screenplay | null;
  putScreenplay(s: Screenplay): void;
  allScreenplayIds(): string[];
  getSyncState(scriptId: string): ScriptSyncState | null;
  setSyncState(scriptId: string, state: ScriptSyncState | null): void;
}

export type SyncEvent =
  | { type: 'status'; scriptId: string; status: SyncStatus }
  | { type: 'synced'; scriptId: string; revision: number }
  | { type: 'conflict-forked'; scriptId: string; forkScriptId: string; forkTitle: string }
  | { type: 'pulled'; scriptId: string; cloudId: string; title: string }
  | { type: 'error'; scriptId?: string; message: string };

export type SyncListener = (e: SyncEvent) => void;

const OUTBOX_KEY = 'sync_outbox';
const FORK_SUFFIX = ' (云端冲突副本)';

interface OutboxEntry {
  scriptId: string;
  /** Generated once per enqueue so create-retries stay idempotent. */
  createKey: string;
}

const newId = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const errMsg = (e: unknown) => (isGalleryApiError(e) ? `[${e.code}] ${e.message}` : String(e));

export class SyncEngine {
  private listeners = new Set<SyncListener>();
  private inFlight = new Set<string>();
  private flushing = false;
  private flushScheduled = false;
  private readonly flushDelayMs: number;

  constructor(
    private client: GalleryClient,
    private store: SyncStoreAdapter,
    opts?: { flushDelayMs?: number }
  ) {
    this.flushDelayMs = opts?.flushDelayMs ?? 1500;
  }

  on(l: SyncListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: SyncEvent) {
    this.listeners.forEach(l => l(e));
  }

  // ---- public API ----------------------------------------------------------

  /** Current durable status of a script ('local' when never synced). */
  statusOf(scriptId: string): SyncStatus {
    return this.store.getSyncState(scriptId)?.status ?? 'local';
  }

  cloudIdOf(scriptId: string): string | null {
    return this.store.getSyncState(scriptId)?.cloudId ?? null;
  }

  /** Local delete bookkeeping: drop the sync state so the outbox entry
   *  resolves to a no-op on next flush. The cloud copy is NOT touched here —
   *  the caller decides whether to call GalleryClient.deleteScript. */
  forgetScript(scriptId: string): void {
    this.store.setSyncState(scriptId, null);
  }

  /** Autosave hook: record a local edit. Cloud-backed scripts flip to 'dirty'
   *  and schedule a debounced flush; 'local' scripts are left alone; 'conflict'
   *  scripts stay conflicted until resolved (syncNow retries). */
  markDirty(s: Screenplay): void {
    const st = this.store.getSyncState(s.id);
    if (!st || st.status === 'conflict') return;
    if (st.status !== 'dirty') {
      this.store.setSyncState(s.id, { ...st, status: 'dirty' });
      this.emit({ type: 'status', scriptId: s.id, status: 'dirty' });
    }
    this.enqueue(s.id);
    this.scheduleFlush();
  }

  /** One-click sync. First push for 'local' scripts; manual flush otherwise. */
  async syncNow(scriptId: string): Promise<void> {
    this.enqueue(scriptId);
    await this.flush();
  }

  /** Login reconciliation: download cloud scripts that have no local copy.
   *  Existing local copies are never overwritten here — differences surface
   *  as REVISION_CONFLICT on the next push. */
  async pullAll(): Promise<void> {
    if (!this.client.user) return;
    let cloud: CloudScript[];
    try {
      cloud = await this.client.listScripts();
    } catch (e) {
      this.emit({ type: 'error', message: errMsg(e) });
      return;
    }
    for (const cs of cloud) {
      if (this.findByCloudId(cs.id)) continue;
      try {
        const full = await this.client.getScript(cs.id);
        const local: Screenplay = {
          ...full.doc,
          id: newId(),
          lastModified: Date.now()
        };
        this.store.putScreenplay(local);
        this.store.setSyncState(local.id, {
          cloudId: cs.id,
          baseRevision: full.revision,
          status: 'synced',
          syncedAt: full.script.updatedAt
        });
        this.emit({ type: 'pulled', scriptId: local.id, cloudId: cs.id, title: local.metadata.title });
      } catch (e) {
        this.emit({ type: 'error', message: errMsg(e) });
      }
    }
  }

  /** Call after a successful sign-in: reconcile from the cloud, then push
   *  whatever got queued while signed out. */
  async onSignedIn(): Promise<void> {
    await this.pullAll();
    await this.flush();
  }

  /** Process the persisted outbox sequentially. Safe to call concurrently —
     a running flush is joined, not duplicated; entries enqueued mid-flush are
     merged back. */
  async flush(): Promise<void> {
    if (this.flushing || !this.client.user) return;
    this.flushing = true;
    let newWhileFlushing = false;
    try {
      const batch = this.readOutbox();
      const remaining: OutboxEntry[] = [];
      for (const entry of batch) {
        if (this.inFlight.has(entry.scriptId)) {
          remaining.push(entry);
          continue;
        }
        this.inFlight.add(entry.scriptId);
        try {
          await this.pushOne(entry);
        } catch (e) {
          // Network failures stay queued (retry on next flush); everything
          // else also stays queued for now but is reported.
          remaining.push(entry);
          this.emit({ type: 'error', scriptId: entry.scriptId, message: errMsg(e) });
        } finally {
          this.inFlight.delete(entry.scriptId);
        }
      }
      // Merge entries enqueued while this flush was running.
      const mid = this.readOutbox().filter(e => !batch.some(b => b.scriptId === e.scriptId));
      this.writeOutbox([...mid, ...remaining.filter(r => !mid.some(m => m.scriptId === r.scriptId))]);
      newWhileFlushing = mid.length > 0;
    } finally {
      this.flushing = false;
    }
    if (newWhileFlushing) this.scheduleFlush();
  }

  /** True when no flush is running or scheduled. */
  isIdle(): boolean {
    return !this.flushing && !this.flushScheduled;
  }

  // ---- internals -----------------------------------------------------------

  private findByCloudId(cloudId: string): string | null {
    for (const id of this.store.allScreenplayIds()) {
      if (this.store.getSyncState(id)?.cloudId === cloudId) return id;
    }
    return null;
  }

  private readOutbox(): OutboxEntry[] {
    try {
      const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') as OutboxEntry[];
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  }

  private writeOutbox(q: OutboxEntry[]) {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
  }

  private enqueue(scriptId: string) {
    const q = this.readOutbox();
    if (q.some(e => e.scriptId === scriptId)) return;
    q.push({ scriptId, createKey: newId() });
    this.writeOutbox(q);
  }

  private scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      void this.flush();
    }, this.flushDelayMs);
  }

  private async pushOne(entry: OutboxEntry): Promise<void> {
    const sp = this.store.getScreenplay(entry.scriptId);
    if (!sp) return; // deleted locally — drop silently
    const st = this.store.getSyncState(entry.scriptId);
    const prev: SyncStatus = st?.status ?? 'local';
    this.emit({ type: 'status', scriptId: entry.scriptId, status: 'pushing' });
    try {
      let next: ScriptSyncState;
      if (!st) {
        const res = await this.client.createScript(sp, entry.createKey);
        next = { cloudId: res.id, baseRevision: res.revision, status: 'synced', syncedAt: Date.now() };
      } else {
        next = await this.pushOrResolve(entry.scriptId, st, sp);
      }
      this.store.setSyncState(entry.scriptId, next);
      this.emit({ type: 'status', scriptId: entry.scriptId, status: 'synced' });
      this.emit({ type: 'synced', scriptId: entry.scriptId, revision: next.baseRevision });
    } catch (e) {
      this.emit({ type: 'status', scriptId: entry.scriptId, status: prev });
      throw e;
    }
  }

  /** Push against baseRevision; on 409 fork the cloud doc locally, then
   *  accept the server revision and overwrite with ours. */
  private async pushOrResolve(
    scriptId: string,
    st: ScriptSyncState,
    sp: Screenplay
  ): Promise<ScriptSyncState> {
    try {
      const res = await this.client.pushScript(st.cloudId, st.baseRevision, sp);
      return { ...st, baseRevision: res.revision, status: 'synced', syncedAt: Date.now() };
    } catch (e) {
      if (!(isGalleryApiError(e) && e.code === 'REVISION_CONFLICT')) throw e;
      const serverRev = e.serverRevision ?? (await this.client.getScript(st.cloudId)).revision;
      // 1) Best-effort: preserve the cloud copy locally so the other
      //    device's work is never lost (it also lives in version history).
      try {
        const cloud = await this.client.getScript(st.cloudId);
        const fork: Screenplay = {
          ...cloud.doc,
          id: newId(),
          lastModified: Date.now(),
          metadata: { ...cloud.doc.metadata, title: `${cloud.script.title}${FORK_SUFFIX}` }
        };
        this.store.putScreenplay(fork); // no sync state → a plain local script
        this.emit({
          type: 'conflict-forked',
          scriptId,
          forkScriptId: fork.id,
          forkTitle: fork.metadata.title
        });
      } catch {
        // fork failed — resolution still proceeds; history keeps the copy
      }
      // 2) Local wins: accept the server state, then overwrite it.
      const res = await this.client.pushScript(st.cloudId, serverRev, sp);
      return { ...st, baseRevision: res.revision, status: 'synced', syncedAt: Date.now() };
    }
  }
}

/** Convenience for wiring: wait for all pending activity to drain (tests). */
export async function drain(engine: SyncEngine, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(10);
    if (engine.isIdle()) return;
  }
  throw new Error('drain: engine still busy after timeout');
}
