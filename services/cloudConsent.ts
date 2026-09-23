/**
 * Cloud-sync CONSENT store — the single source of truth for "may this
 * browser talk to the gallery cloud?".
 *
 * PRIVACY (P0 fix, 2026-09): cloud sync used to be fully automatic once a
 * session existed (silent SSO → pullAll → debounced pushes). Now every
 * outbound/pull flow gates on the user's explicit choice, made in a consent
 * dialog that spells out what will happen (pull + auto-upload + 4A login).
 *
 *   'unset'   never asked — every cloud flow is OFF (the default)
 *   'granted' user confirmed the consent dialog — flows run
 *   'denied'  user declined — flows stay OFF until they re-enable
 *
 * The pull policy separately remembers how DISCOVERING cloud scripts should
 * behave ('ask' every sign-in / 'auto' / 'never'), so the question is not
 * re-asked on every launch.
 */

const CONSENT_KEY = 'cloud_sync_consent';
const PULL_POLICY_KEY = 'cloud_pull_policy';

export type CloudSyncConsent = 'unset' | 'granted' | 'denied';
export type CloudPullPolicy = 'ask' | 'auto' | 'never';

export function readCloudSyncConsent(): CloudSyncConsent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : 'unset';
  } catch {
    return 'unset';
  }
}

export function writeCloudSyncConsent(v: 'granted' | 'denied'): void {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch { /* private mode — consent stays unset for this session */ }
}

export function readCloudPullPolicy(): CloudPullPolicy {
  try {
    const v = localStorage.getItem(PULL_POLICY_KEY);
    return v === 'auto' || v === 'never' ? v : 'ask';
  } catch {
    return 'ask';
  }
}

export function writeCloudPullPolicy(v: CloudPullPolicy): void {
  try {
    localStorage.setItem(PULL_POLICY_KEY, v);
  } catch { /* ignore */ }
}
