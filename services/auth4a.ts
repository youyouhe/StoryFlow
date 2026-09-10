/**
 * 4A unified-login frontend module (skill: 4a-sso-integration, production-
 * proven template from grid.smartbid.site, adapted for StoryFlow's token
 * exchange: the browser hands the sso_token to the gallery backend, which
 * verifies it and issues the gallery session pair).
 *
 * Usage:
 *   - App start: initSSO() once
 *   - Need identity: requireLogin(); in-app logout: clearToken();
 *     everywhere-logout: logoutEverywhere()
 */

const TOKEN_KEY = 'sso_access_token';
const LOGOUT_FLAG_KEY = 'sso_logged_out';
const VITE_ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const LOGIN_URL = VITE_ENV.VITE_LOGIN_URL || 'https://auth.smartbid.site/login';
const LOGOUT_URL = VITE_ENV.VITE_LOGOUT_URL || 'https://auth.smartbid.site/logout';

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Deleting the sso_token cookie 4A writes on the shared parent domain.
// Deleting = writing an expired cookie with the SAME name; the browser matches
// on name+domain+path exactly — omitting domain silently creates a host-only
// no-op instead of removing the real cookie (skill pitfall #1).
function deleteSsoCookie(): void {
  const host = window.location.hostname;
  const labels = host.split('.');
  const parentDomain = labels.length >= 2 ? labels.slice(-2).join('.') : null;
  const domains: (string | undefined)[] = parentDomain
    ? [parentDomain, `.${parentDomain}`]
    : [undefined];
  for (const domain of domains) {
    document.cookie = `sso_token=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
  }
  // The cookie is non-HttpOnly — JS can and should verify the deletion.
  if (getCookie('sso_token')) {
    console.warn('[auth] sso_token cookie 清理失败，请检查删除语句的 domain/path 属性匹配');
  }
}

// Call once on app start: recover the SSO token from URL or cross-subdomain cookie.
export function initSSO(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('sso_token');

  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    // Explicit login returned — lift the logout suppression.
    try {
      sessionStorage.removeItem(LOGOUT_FLAG_KEY);
    } catch {
      /* ignore */
    }
    // Strip the token from the URL (history/address bar must not retain it).
    params.delete('sso_token');
    const newUrl =
      window.location.pathname +
      (params.toString() ? '?' + params.toString() : '') +
      window.location.hash;
    window.history.replaceState({}, '', newUrl);
    return urlToken;
  }

  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;

  // User logged out in this tab: do NOT silently restore from the shared
  // cookie until an explicit login (URL carries sso_token) clears the flag
  // (skill pitfall #4).
  try {
    if (sessionStorage.getItem(LOGOUT_FLAG_KEY)) return null;
  } catch {
    /* ignore */
  }

  // Cross-subdomain cookie fallback: signed in on another smartbid product.
  const cookieToken = getCookie('sso_token');
  if (cookieToken) {
    localStorage.setItem(TOKEN_KEY, cookieToken);
    return cookieToken;
  }

  return null;
}

export function getSsoToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  // Audit notice token: localStorage first, shared cookie as fallback.
  const token = localStorage.getItem(TOKEN_KEY) || getCookie('sso_token');
  localStorage.removeItem(TOKEN_KEY);
  deleteSsoCookie();
  try {
    sessionStorage.setItem(LOGOUT_FLAG_KEY, '1');
  } catch {
    /* ignore */
  }
  if (token) {
    // Best-effort audit to 4A via our backend's same-origin proxy — a direct
    // cross-origin POST would die in CORS preflight (skill pitfall #3).
    // 4A counts 401 as success; failures never block logout.
    void fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}

// Need identity? Jump to the 4A login page; it redirects back with ?sso_token=.
// If this tab logged out earlier, delete the cookie again right before jumping —
// 4A's Auto-SSO block bounces on cookie presence alone (skill pitfall #2).
export function requireLogin(): void {
  try {
    if (sessionStorage.getItem(LOGOUT_FLAG_KEY)) {
      deleteSsoCookie();
    }
  } catch {
    /* ignore */
  }
  const currentUrl = window.location.href;
  window.location.href = `${LOGIN_URL}?redirect=${encodeURIComponent(currentUrl)}`;
}

// Family-wide logout: 4A clears its session cookie and revokes every token
// for the user, then 302s back to the current page.
export function logoutEverywhere(): void {
  clearToken();
  window.location.href = `${LOGOUT_URL}?redirect=${encodeURIComponent(window.location.href)}`;
}
