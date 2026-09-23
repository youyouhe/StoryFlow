import { useState, useEffect, useCallback } from 'react';
import { GalleryUser, SyncStatus } from '../types';
import { TRANSLATIONS } from '../constants';
import { galleryClient, syncEngine, readAllSyncStatuses, syncStore } from '../services/gallery';
import { initSSO, getSsoToken, getSsoCookieToken, adoptSsoToken, clearToken } from '../services/auth4a';
import { readCloudSyncConsent, writeCloudSyncConsent, readCloudPullPolicy, writeCloudPullPolicy, type CloudSyncConsent, type CloudPullPolicy } from '../services/cloudConsent';
import { isGalleryApiError } from '../services/apiClient';
import type { ScriptVisibility } from '../services/apiClient';
import type { ScriptSummary } from './useScriptLibrary';

/**
 * The GALLERY SYNC state domain: the 4A SSO session, the signed-in gallery
 * user, per-script sync badge statuses, cloud visibility, credit balance and
 * the sync/visibility handlers.
 *
 * Extracted verbatim from App.tsx (wave 1 of the App split): same initial
 * state, same effects in the same relative order (SSO exchange → auth-lost →
 * signed-in reconcile → credit balance), same dependency arrays. Script
 * deletion (which also drops the cloud copy) stays in App.tsx.
 */
export function useGallerySync({ savedScripts, refreshSavedScripts, t, onToast }: {
  savedScripts: ScriptSummary[];
  refreshSavedScripts: () => void;
  t: typeof TRANSLATIONS['en'];
  onToast?: (msg: string) => void;
}) {
  // 4A SSO first: recover the sso_token (URL ?sso_token= → localStorage →
  // shared cookie) so the exchange effect below can establish the session.
  initSSO();
  const [galleryUser, setGalleryUser] = useState<GalleryUser | null>(galleryClient.user);
  const [syncStatusMap, setSyncStatusMap] = useState<Record<string, SyncStatus>>(readAllSyncStatuses);
  const [cloudVisMap, setCloudVisMap] = useState<Record<string, ScriptVisibility>>({});
  const [syncError, setSyncError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  // PRIVACY: cloud flows run only with the user's explicit consent.
  const [syncConsent, setSyncConsentState] = useState<CloudSyncConsent>(readCloudSyncConsent);
  const [pullPolicy, setPullPolicyState] = useState<CloudPullPolicy>(readCloudPullPolicy);
  const [cloudBusy, setCloudBusy] = useState(false);

  const enableCloudSync = useCallback(() => {
    writeCloudSyncConsent('granted');
    setSyncConsentState('granted');
  }, []);

  const disableCloudSync = useCallback(() => {
    writeCloudSyncConsent('denied');
    setSyncConsentState('denied');
    // Off means OFF: drop the session and any queued outbound content.
    void (async () => {
      if (galleryClient.isAuthenticated) await galleryClient.logout();
      clearToken();
      syncEngine.clearOutbox();
      setGalleryUser(null);
      setCloudVisMap({});
      setSyncStatusMap(readAllSyncStatuses());
    })();
  }, []);

  const setCloudPullPolicy = useCallback((v: CloudPullPolicy) => {
    writeCloudPullPolicy(v);
    setPullPolicyState(v);
  }, []);

  /** Re-read the script index + badge statuses (engine pulls/forks land here). */
  const refreshGalleryView = useCallback(() => {
    refreshSavedScripts();
    setSyncStatusMap(readAllSyncStatuses());
  }, [refreshSavedScripts]);

  // Gallery sync engine subscription: keep badge statuses + script index fresh.
  useEffect(() => {
    const off = syncEngine.on(e => {
      if (e.type === 'status') {
        setSyncStatusMap(prev => ({ ...prev, [e.scriptId]: e.status }));
      } else if (e.type === 'synced') {
        setSyncStatusMap(prev => ({ ...prev, [e.scriptId]: 'synced' }));
      } else if (e.type === 'error') {
        setSyncError(e.message);
      } else if (e.type === 'conflict-forked') {
        // No longer silent: tell the user a fork appeared and why.
        onToast?.(t.cloudToastFork.replace('{title}', e.forkTitle));
        refreshGalleryView();
      } else if (e.type === 'first-pushed') {
        // First upload of a script — surface it once instead of a silent create.
        onToast?.(t.cloudToastFirstPush.replace('{title}', e.title));
      } else {
        // 'pulled': a new local screenplay appeared.
        refreshGalleryView();
      }
    });
    return off;
  }, [refreshGalleryView, t, onToast]);

  /** Cloud visibility per local script id (cloud-backed only) — powers the
   *  Sidebar lock/globe chip. */
  const refreshCloudVis = useCallback(async () => {
      if (!galleryClient.isAuthenticated) { setCloudVisMap({}); return; }
      try {
          const list = await galleryClient.listScripts();
          const byCloud = new Map(list.map(s => [s.id, s.visibility]));
          const next: Record<string, ScriptVisibility> = {};
          for (const localId of syncStore.allScreenplayIds()) {
              const cloudId = syncStore.getSyncState(localId)?.cloudId;
              const v = cloudId ? byCloud.get(cloudId) : undefined;
              if (v) next[localId] = v;
          }
          setCloudVisMap(next);
      } catch { /* keep last-known map */ }
  }, []);

  /** Cycle a cloud-backed script's visibility from the Sidebar chip. */
  const handleChangeVisibility = useCallback(async (id: string, v: ScriptVisibility) => {
      const cloudId = syncStore.getSyncState(id)?.cloudId;
      if (!cloudId) return;
      setCloudVisMap(prev => ({ ...prev, [id]: v })); // optimistic
      try {
          await galleryClient.setVisibility(cloudId, v);
      } catch (e) {
          setSyncError(e instanceof Error ? e.message : String(e));
          void refreshCloudVis(); // revert to server truth
      }
  }, [refreshCloudVis]);

  /** 4A SSO: exchange the browser's sso_token for a gallery session. */
  const handleSSOExchange = useCallback(async () => {
      const ssoToken = getSsoToken();
      if (!ssoToken || galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          await galleryClient.ssoExchange(ssoToken);
          setGalleryUser(galleryClient.user);
          await syncEngine.onSignedIn();
          refreshGalleryView();
          void refreshCloudVis();
      } catch (e) {
          // 4A rejected the token (expired / revoked / superseded by another
          // device): drop it and return to anonymous instead of retrying a
          // dead token on every reload.
          if (isGalleryApiError(e) && (e.code === 'INVALID_TOKEN' || e.code === 'AUTH_REQUIRED')) {
              clearToken();
          }
          setSyncError(e instanceof Error ? e.message : String(e));
      }
  }, [refreshGalleryView, refreshCloudVis]);

  // Connect flow — runs on mount and whenever consent changes.
  //  1) consent unset + family cookie present → ASK before adopting the
  //     session (declining suppresses until an explicit login).
  //  2) consent granted + token present → exchange into a gallery session.
  useEffect(() => {
    if (syncConsent === 'unset' && !getSsoToken()) {
      const cookieToken = getSsoCookieToken();
      if (cookieToken) {
        const ok = window.confirm(t.cloudCookieLoginAsk);
        if (ok) {
          adoptSsoToken(cookieToken);
          writeCloudSyncConsent('granted');
          setSyncConsentState('granted');
        } else {
          // Suppress until an explicit login — same mechanism as logout.
          try { sessionStorage.setItem('sso_logged_out', '1'); } catch { /* ignore */ }
        }
      }
      return;
    }
    if (syncConsent === 'granted' && getSsoToken() && !galleryClient.isAuthenticated) {
      void handleSSOExchange();
    }
  }, [syncConsent, handleSSOExchange, t]);

  /** App-level logout: drop the 4A token + gallery session. */
  const handleGalleryLogout = useCallback(async () => {
      const auth = galleryClient.isAuthenticated;
      if (auth) await galleryClient.logout();
      clearToken();
      // PRIVACY: queued pushes are user content waiting to leave the device —
      // they must not silently depart on the next (possibly silent) sign-in.
      syncEngine.clearOutbox();
      setGalleryUser(null);
      setCloudVisMap({});
  }, []);

  // Session dropped at runtime (refresh rejected after supersede/revoke):
  // reflect the anonymous state immediately instead of waiting for a reload.
  useEffect(() => {
      galleryClient.onAuthLost = () => {
          setGalleryUser(null);
          setCloudVisMap({});
      };
      return () => { galleryClient.onAuthLost = null; };
  }, []);

  /** One-click sync for a single script (sidebar badge click). */
  const handleSyncScript = useCallback(async (id: string) => {
      if (readCloudSyncConsent() !== 'granted') { setSyncError(t.cloudSyncDisabledHint); return; }
      if (!galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          await syncEngine.syncNow(id);
      } catch { /* already surfaced via the engine event listener */ }
      refreshGalleryView();
      void refreshCloudVis();
  }, [refreshGalleryView, refreshCloudVis]);

  /** Push every script in the index (account tab button). */
  const handleSyncAll = useCallback(async () => {
      if (readCloudSyncConsent() !== 'granted') { setSyncError(t.cloudSyncDisabledHint); return; }
      if (!galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          for (const s of savedScripts) {
              await syncEngine.syncNow(s.id);
          }
      } catch { /* surfaced via events */ }
      refreshGalleryView();
      void refreshCloudVis();
  }, [savedScripts, refreshGalleryView, refreshCloudVis, t]);

  // Returning signed-in user (consent granted only): reconcile with the
  // cloud. Pulls ASK first unless the user set a standing policy — the old
  // behavior downloaded every cloud script silently on launch.
  useEffect(() => {
    if (syncConsent !== 'granted' || !galleryClient.isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const policy = readCloudPullPolicy();
        if (policy !== 'never') {
          const fresh = await syncEngine.listNewCloudScripts().catch(() => []);
          if (cancelled) return;
          if (fresh.length > 0 && policy === 'ask') {
            const ok = window.confirm(t.cloudPullAskConfirm.replace('{n}', String(fresh.length)));
            writeCloudPullPolicy(ok ? 'auto' : 'never');
            if (ok && !cancelled) await syncEngine.pullAll();
          } else {
            await syncEngine.pullAll();
          }
        }
        if (cancelled) return;
        await syncEngine.flush();
        refreshGalleryView();
        void refreshCloudVis();
      } catch { /* surfaced via engine events */ }
    })();
    return () => { cancelled = true; };
  }, [syncConsent, refreshGalleryView, refreshCloudVis, t]);

  // P5: keep the credit balance in sync with the signed-in 4A identity.
  useEffect(() => {
    if (!galleryUser) { setCreditBalance(null); return; }
    galleryClient.getCreditBalance()
      .then(r => setCreditBalance(r.balance))
      .catch(() => setCreditBalance(null));
  }, [galleryUser]);

  /** Export EVERY cloud script (full docs) as one JSON file — uses only the
   *  existing list/get endpoints, no backend work needed. */
  const exportCloudScripts = useCallback(async () => {
      if (readCloudSyncConsent() !== 'granted' || !galleryClient.isAuthenticated) return;
      setCloudBusy(true);
      setSyncError(null);
      try {
          const list = await galleryClient.listScripts();
          if (!list.length) { window.alert(t.cloudExportNone); return; }
          const scripts: Array<Record<string, unknown>> = [];
          for (const cs of list) {
              const full = await galleryClient.getScript(cs.id);
              scripts.push({ cloudId: cs.id, title: cs.title, revision: full.revision, updatedAt: full.script.updatedAt, doc: full.doc });
          }
          const pack = { storyflowCloudExport: 1 as const, exportedAt: new Date().toISOString(), count: scripts.length, scripts };
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
          a.download = `storyflow-cloud-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          onToast?.(t.cloudExportDone.replace('{n}', String(scripts.length)));
      } catch (e) {
          setSyncError(e instanceof Error ? e.message : String(e));
      } finally { setCloudBusy(false); }
  }, [t, onToast]);

  /** Delete every cloud script + cloud asset. Server-side this is the same
   *  soft-delete as per-script deletion; local sync states + the outbox are
   *  dropped so badges reset and nothing re-pushes. */
  const deleteCloudData = useCallback(async () => {
      if (readCloudSyncConsent() !== 'granted' || !galleryClient.isAuthenticated) return;
      setCloudBusy(true);
      setSyncError(null);
      try {
          const scripts = await galleryClient.listScripts();
          let assets: Awaited<ReturnType<typeof galleryClient.listAssets>> = [];
          try { assets = await galleryClient.listAssets(); } catch { /* assets optional */ }
          if (!scripts.length && !assets.length) { window.alert(t.cloudExportNone); return; }
          if (!window.confirm(t.cloudDeleteAllConfirm
              .replace('{n}', String(scripts.length))
              .replace('{m}', String(assets.length)))) { setCloudBusy(false); return; }
          for (const cs of scripts) await galleryClient.deleteScript(cs.id);
          const deleted = new Set(scripts.map(s => s.id));
          for (const localId of syncStore.allScreenplayIds()) {
              const st = syncStore.getSyncState(localId);
              if (st && deleted.has(st.cloudId)) syncEngine.forgetScript(localId);
          }
          for (const a of assets) {
              try { await galleryClient.deleteAsset(a.id); } catch { /* keep going */ }
          }
          syncEngine.clearOutbox();
          refreshGalleryView();
          onToast?.(t.cloudDeleteDone.replace('{n}', String(scripts.length)).replace('{m}', String(assets.length)));
      } catch (e) {
          setSyncError(e instanceof Error ? e.message : String(e));
      } finally { setCloudBusy(false); }
  }, [t, onToast, refreshGalleryView]);

  return {
    galleryUser, setGalleryUser,
    syncStatusMap, setSyncStatusMap,
    cloudVisMap, setCloudVisMap,
    syncError, setSyncError,
    creditBalance,
    syncConsent, enableCloudSync, disableCloudSync,
    pullPolicy, setCloudPullPolicy,
    cloudBusy, exportCloudScripts, deleteCloudData,
    refreshCloudVis,
    refreshGalleryView,
    handleChangeVisibility,
    handleSSOExchange,
    handleGalleryLogout,
    handleSyncScript,
    handleSyncAll,
  };
}
