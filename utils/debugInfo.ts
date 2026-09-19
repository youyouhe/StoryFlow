/**
 * Collect the last AI call logs + error state into a copyable debug string.
 * Called from the AI modal error state when the user needs help debugging —
 * they click one button, paste the result to the developer.
 *
 * Logs live in localStorage['ai_perf_log'] (written by logAiCall in
 * services/aiLog.ts on EVERY AI call: op, provider, model, outcome,
 * errorType, error, durations). No server shipping — the user copies and
 * pastes into chat. */
export const collectDebugInfo = (context?: string): string => {
  const lines: string[] = [];
  lines.push(`--- StoryFlow Debug ---`);
  lines.push(`时间: ${new Date().toISOString()}`);
  if (context) lines.push(`操作: ${context}`);
  try {
    const log = JSON.parse(localStorage.getItem('ai_perf_log') || '[]');
    const recent = log.slice(-8);
    for (const e of recent) {
      lines.push(`${new Date(e.ts).toLocaleTimeString()} | ${e.op} | ${e.provider}/${e.model} | ${e.outcome}${e.errorType ? ` (${e.errorType})` : ''}${e.error ? ` | ${e.error}` : ''} | ${e.durationMs ?? '?'}ms`);
    }
  } catch { lines.push('ai_perf_log unreadable'); }
  try {
    const s = JSON.parse(localStorage.getItem('screenplay_app_settings') || '{}');
    lines.push(`provider: ${s.provider ?? '?'} | deepseek: ${s.deepseekApiKey ? 'SET' : 'empty'} | gemini: ${s.geminiApiKey ? 'SET' : 'empty'} | minimax: ${s.minimaxApiKey ? 'SET' : 'empty'} | fal: ${s.falKey ? 'SET' : 'empty'}`);
  } catch { lines.push('settings unreadable'); }
  return lines.join('\n');
};
