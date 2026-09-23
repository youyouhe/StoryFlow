import { useState, useEffect, useCallback } from 'react';
import { GalleryUser, SyncStatus } from '../types';
import { galleryClient, syncEngine, readAllSyncStatuses, syncStore } from '../services/gallery';
import { initSSO, getSsoToken, clearToken } from '../services/auth4a';
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
export function useGallerySync({ savedScripts, refreshSavedScripts }: {
  savedScripts: ScriptSummary[];
  refreshSavedScripts: () => void;
}) {
  // 4A SSO first: recover the sso_token (URL ?sso_token= → localStorage →
  // shared cookie) so the exchange effect below can establish the session.
  initSSO();
  const [galleryUser, setGalleryUser] = useState<GalleryUser | null>(galleryClient.user);
  const [syncStatusMap, setSyncStatusMap] = useState<Record<string, SyncStatus>>(readAllSyncStatuses);
  const [cloudVisMap, setCloudVisMap] = useState<Record<string, ScriptVisibility>>({});
  const [syncError, setSyncError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

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
      } else {
        // 'pulled' | 'conflict-forked': a new local screenplay appeared.
        refreshGalleryView();
      }
    });
    return off;
  }, [refreshGalleryView]);

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

  // SSO token arriving via URL/cookie (login redirect or cross-subdomain):
  // exchange it into a gallery session once, on mount.
  useEffect(() => {
      if (!getSsoToken()) return;
      void handleSSOExchange();
  }, [handleSSOExchange]);

  /** App-level logout: drop the 4A token + gallery session. */
  const handleGalleryLogout = useCallback(async () => {
      const auth = galleryClient.isAuthenticated;
      if (auth) await galleryClient.logout();
      clearToken();
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
      if (!galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          for (const s of savedScripts) {
              await syncEngine.syncNow(s.id);
          }
      } catch { /* surfaced via events */ }
      refreshGalleryView();
      void refreshCloudVis();
  }, [savedScripts, refreshGalleryView, refreshCloudVis]);

  // Returning signed-in user: reconcile with the cloud once on app start.
  useEffect(() => {
    if (!galleryClient.isAuthenticated) return;
    void syncEngine.onSignedIn().then(() => { refreshGalleryView(); void refreshCloudVis(); });
  }, [refreshGalleryView, refreshCloudVis]);

  // P5: keep the credit balance in sync with the signed-in 4A identity.
  useEffect(() => {
    if (!galleryUser) { setCreditBalance(null); return; }
    galleryClient.getCreditBalance()
      .then(r => setCreditBalance(r.balance))
      .catch(() => setCreditBalance(null));
  }, [galleryUser]);

  return {
    galleryUser, setGalleryUser,
    syncStatusMap, setSyncStatusMap,
    cloudVisMap, setCloudVisMap,
    syncError, setSyncError,
    creditBalance,
    refreshCloudVis,
    refreshGalleryView,
    handleChangeVisibility,
    handleSSOExchange,
    handleGalleryLogout,
    handleSyncScript,
    handleSyncAll,
  };
}
