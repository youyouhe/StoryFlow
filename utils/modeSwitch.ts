/**
 * Pipeline MODE SWITCH rules (docs/pipeline-two-mode.md §0, 站长规则 2026-09):
 *
 *   1. Pro → Express: FORBIDDEN — Pro features (proAudio / voiceCast /
 *      SHOT_LIST) depend on the cinematic mode. The entry renders disabled
 *      and explains itself on hover/click.
 *   2. Express → Pro: allowed, but MUST pass an AskDialog confirmation
 *      (upgrade is one-way).
 *   3. Even while the project SITS in Express, carried Pro-feature data
 *      (proAudio / voiceCast present) locks the downgrade door just the same.
 *
 * Pure decision logic — the UI maps reason codes to localized copy.
 */

export type ProductionMode = 'simple' | 'cinematic';

export interface ProFeatureCarrier {
  proAudio?: unknown;
  voiceCast?: unknown;
}

/** True when the project carries Pro-feature data (rule 3's detector). */
export function hasProFeatureData(s: ProFeatureCarrier): boolean {
  const nonEmpty = (v: unknown): boolean =>
    !!v && typeof v === 'object' && Object.keys(v as object).length > 0;
  return nonEmpty(s.proAudio) || nonEmpty(s.voiceCast);
}

export type ModeSwitchReasonCode = 'pro-features' | 'pro-data';

export interface ModeSwitchCheck {
  allowed: boolean;
  /** upgrade path needs an explicit confirmation dialog */
  needsConfirm: boolean;
  /** set when forbidden — UI maps the code to localized copy */
  reasonCode?: ModeSwitchReasonCode;
}

export function checkModeSwitch(
  target: ProductionMode,
  current: ProductionMode,
  hasProData: boolean,
): ModeSwitchCheck {
  if (target === 'simple') {
    // Any downgrade door is shut: by mode (rule 1) or by carried data
    // (rule 3 — a project holding proAudio/voiceCast cannot even stay/be set
    // to Express; the lock wins over the no-op).
    if (hasProData) return { allowed: false, needsConfirm: false, reasonCode: 'pro-data' };
    if (target === current) return { allowed: true, needsConfirm: false };
    return { allowed: false, needsConfirm: false, reasonCode: 'pro-features' };
  }
  // target === 'cinematic': upgrade — allowed, one-way, needs consent (rule 2).
  return { allowed: true, needsConfirm: current === 'simple' };
}
