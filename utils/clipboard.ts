/**
 * Copy text to the clipboard with a non-secure-context fallback.
 *
 * `navigator.clipboard` exists ONLY in secure contexts (https:// or
 * localhost). On http://<LAN-IP> dev setups it is undefined, so the naive
 * `navigator.clipboard?.writeText(...)` silently no-ops. The legacy
 * `document.execCommand('copy')` path still works there (needs a user
 * gesture + a temporary selection — which this helper sets up).
 *
 * Returns true when the text reached the clipboard (either path).
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* secure-context rejection — fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // keep it invisible but focusable/selectable (display:none breaks selection)
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};
