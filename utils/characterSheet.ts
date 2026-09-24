import type { StyleHead } from '../types';

/**
 * Industrial CHARACTER SHEET imagePrompt contract (11 required modules).
 *
 * Replaces the old "3-view turnaround" subject/composition guidance for
 * kind === 'character' (Alt+S on a CHARACTER block). The sheet is a SINGLE
 * image laid out as a model sheet: identity → palette → the LARGEST panel is
 * the main turnaround → silhouettes → expression/micro-expression grids →
 * head angles → poses → bust close-up → costume details → hand poses, with a
 * hard consistency lock across every panel.
 *
 * Style is NEVER hardcoded here: `buildCharacterSheetSystemPrompt` weaves the
 * script's StyleHead (水墨 / 写实 / 动漫 / …) in dynamically. refBindings
 * compatibility is unchanged — this only shapes the text of one imagePrompt;
 * 主 ref / 变体 ref classification still lives in RefImage v4.
 */

export const CHARACTER_SHEET_MODULES = [
  'Identity Header',
  'Color System',
  'Main Turnaround',
  'Silhouette',
  'Expression System',
  'Micro-expressions',
  'Head Angles',
  'Pose Variation',
  'Bust Close-up',
  'Costume Details',
  'Hand Poses',
] as const;

export type CharacterSheetModule = (typeof CHARACTER_SHEET_MODULES)[number];

/** The 8 canonical expressions (站长口径, fixed order). */
export const SHEET_EXPRESSIONS = [
  'calm', 'curious', 'tense', 'surprised', 'afraid', 'sad', 'determined', 'relaxed',
] as const;

/** The 5 micro-expressions. */
export const SHEET_MICRO_EXPRESSIONS = [
  'subtle smile twitch', 'eyebrow micro-furrow', 'lip press', 'eye-narrow tell', 'breath-held stillness',
] as const;

/** The 4 costume detail panels. */
export const SHEET_COSTUME_DETAILS = ['hairstyle', 'fabric & material', 'accessories', 'footwear'] as const;

/** The 4 hand poses. */
export const SHEET_HAND_POSES = ['relaxed open', 'tense clenched', 'pointing', 'gripping'] as const;

/** The 3 pose variations. */
export const SHEET_POSES = ['relaxed', 'tense', 'confident'] as const;

/** The 3 extra head angles (beyond the turnaround's front/side/back). */
export const SHEET_HEAD_ANGLES = ['three-quarter', 'low angle (looking up)', 'high angle (looking down)'] as const;

/**
 * Output line labels — one line per module, in sheet reading order. These are
 * the ONLY labels `normalizeCharacterSheetPrompt` keeps, mirroring the
 * six-element filter used for action/environment prompts.
 */
export const CHARACTER_SHEET_LABELS: Record<CharacterSheetModule, string> = {
  'Identity Header': 'Identity',
  'Color System': 'Palette',
  'Main Turnaround': 'Main',
  'Silhouette': 'Silhouette',
  'Expression System': 'Expressions',
  'Micro-expressions': 'Micro',
  'Head Angles': 'Heads',
  'Pose Variation': 'Poses',
  'Bust Close-up': 'Bust',
  'Costume Details': 'Costume',
  'Hand Poses': 'Hands',
};

export const CHARACTER_SHEET_ALLOWED_LABELS = Object.values(CHARACTER_SHEET_LABELS);

/**
 * The generation contract injected into Alt+S's system prompt when the target
 * is a CHARACTER block. Pure text — style comes from StyleHead, identity from
 * the established-design map / script beats.
 */
export const CHARACTER_SHEET_RULES = `CHARACTER SHEET CONTRACT (industrial model sheet) — output a SINGLE image laid out as a professional character sheet with EXACTLY these 11 modules. The main identity display is the LARGEST panel on the sheet.

MODULES (required, in this order):
1. Identity Header — character name, role/identity, age, 3-5 personality keywords, one-line core theme.
2. Color System — 6-8 flat colour swatches (skin, hair, eyes, primary garment, secondary garment, accent) as concrete colour names, like a production palette chip strip.
3. Main Turnaround (LARGEST panel, must dominate the sheet) — front view, three-quarter view and back view side by side at identical scale, standard standing pose (A-pose or relaxed stand), height/proportion scale line beside the figures, NO props, identical outfit in all three.
4. Silhouette — clean front + side full-body silhouettes (solid readable outlines, same proportions as the turnaround).
5. Expression System — 8 head-and-shoulder studies in a grid: calm / curious / tense / surprised / afraid / sad / determined / relaxed.
6. Micro-expressions — 5 tight facial studies of subtle tells (e.g. a near-smile twitch, a micro-furrow, a lip press).
7. Head Angles — 3 extra head studies: three-quarter, low angle (looking up), high angle (looking down).
8. Pose Variation — 3 full or three-quarter body studies: relaxed / tense / confident.
9. Bust Close-up — one chest-up portrait with a STRONG readable emotion (the acting reference).
10. Costume Details — 4 close-up panels: hairstyle / fabric & material / accessories / footwear.
11. Hand Poses — 4 hand studies: relaxed open / tense clenched / pointing / gripping.

CONSISTENCY LOCK (hard requirement):
- EVERY panel shows the SAME person: identical face, hairstyle, body proportions and costume. Zero style drift between panels.
- The Main Turnaround panel is visually the largest; the other modules tile around it.
- No style mixing: the whole sheet renders in ONE art style (the locked visual style below).

STYLE: adapt the sheet's rendering style to the locked visual style — the module LAYOUT stays the same whether the style is ink-wash, photoreal 3D, anime, comic, oil painting or paper-cut. Never hardcode a medium.

WARDROBE SAFETY (image-model content checkers): describe garments factually — type, colour, fabric. Always state adult characters are ADULT. No fetish-coded slang (e.g. "JK", "制服诱惑"); translate such cues to neutral fashion wording with explicit adult context. Avoid checker-trigger words ("intimacy", "sensual", "seductive", "sexy") — use "warmth", "graceful", "charming", "stylish".

OUTPUT FORMAT — EXACTLY 11 lines, one per module, English only, no markdown, no preamble:
Identity: ...
Palette: ...
Main: ...
Silhouette: ...
Expressions: ...
Micro: ...
Heads: ...
Poses: ...
Bust: ...
Costume: ...
Hands: ...

Each line is one dense concrete phrase (show, don't tell). No aspect ratio, resolution or quality-booster terms. Translate any non-English source into English.`;

/**
 * Build the full system prompt for a CHARACTER-sheet imagePrompt call.
 * `styleSection` is injected dynamically — never a fixed medium.
 */
export function buildCharacterSheetSystemPrompt(opts: {
  systemInstruction: string;
  styleHead?: StyleHead;
  langInstruction?: string;
  variantNote?: string;
  wardrobeNote?: string;
}): string {
  const styleSection = opts.styleHead?.promptPrefix?.trim()
    ? `GLOBAL STYLE LOCK — this script has a fixed visual head that OVERRIDES your own style inference. Render the WHOLE sheet in this art style / palette / era (adapt every panel to it — the 11-module layout is style-agnostic):\n---\n${opts.styleHead.promptPrefix.trim()}\n---\n${opts.styleHead.artStyle ? `Art-style note: ${opts.styleHead.artStyle}\n` : ''}${opts.styleHead.scenePreset ? `World note (for era-accurate costume/props): ${opts.styleHead.scenePreset}\n` : ''}`
    : 'No locked visual style — infer one coherent art style from the character and story, and keep EVERY panel in it.\n';

  return `You are a Character Designer and expert Text-to-Image Prompt Engineer.
Your job: turn a screenplay CHARACTER into a SINGLE industrial character-sheet image prompt (production model sheet).

${opts.systemInstruction}

${opts.langInstruction ?? 'Respond in English only.'}

${styleSection}${opts.variantNote ?? ''}${opts.wardrobeNote ?? ''}
${CHARACTER_SHEET_RULES}`;
}

/**
 * Normalize raw model output to the 11 labeled lines. Tolerant: keeps only
 * lines whose label is in CHARACTER_SHEET_ALLOWED_LABELS, re-capitalizes the
 * label, drops markdown/preamble. Returns the joined sheet WITHOUT a style
 * prefix (callers prepend Global Style when a StyleHead exists — same contract
 * as the six-element path).
 */
export function normalizeCharacterSheetPrompt(raw: string): string {
  const lines = raw
    .split('\n')
    .map(l => l.trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .filter(l => {
      const m = l.match(/^([A-Za-z][A-Za-z -]{0,20})\s*:/);
      if (!m) return false;
      const label = m[1].trim().toLowerCase();
      return CHARACTER_SHEET_ALLOWED_LABELS.some(a => a.toLowerCase() === label
        || a.toLowerCase().startsWith(label) && label.length >= 3);
    })
    .map(l => {
      const colonIdx = l.indexOf(':');
      const label = l.slice(0, colonIdx).trim();
      const rest = l.slice(colonIdx + 1).trim().replace(/\*\*/g, '');
      const canon = CHARACTER_SHEET_ALLOWED_LABELS.find(a =>
        a.toLowerCase() === label.toLowerCase() || a.toLowerCase().startsWith(label.toLowerCase()));
      return `${canon ?? label}: ${rest}`;
    })
    .filter(l => l.split(':').slice(1).join(':').trim().length > 0);
  return lines.join('\n');
}

/**
 * Deterministic filter-safety pass (same triggers as the six-element path).
 * Applied to the final sheet text before it is saved to the block.
 */
export function applySheetFilterSafety(text: string): string {
  const FILTER_TRIGGERS: Array<[RegExp, string]> = [
    [/\bintimacy\b/gi, 'warmth'],
    [/\bintimate\b/gi, 'warm'],
    [/\bsensual\b/gi, 'graceful'],
    [/\bseductive\b/gi, 'charming'],
    [/\balluring\b/gi, 'inviting'],
    [/\benticing\b/gi, 'charming'],
    [/\bsexy\b/gi, 'stylish'],
  ];
  let out = text;
  for (const [re, rep] of FILTER_TRIGGERS) out = out.replace(re, rep);
  return out;
}

/**
 * Regression helper (tests + the LU ZHIBAI smoke): does this imagePrompt carry
 * the required sheet modules? Checks the 11 labels AND the content signatures
 * 站长 asked for (表情系统 / 头部多角度 / 手部动作 / 主展示区最大 / 一致性).
 */
export function auditCharacterSheet(imagePrompt: string): {
  ok: boolean;
  missingLabels: string[];
  missingSignatures: string[];
} {
  const text = imagePrompt.toLowerCase();
  const missingLabels = CHARACTER_SHEET_ALLOWED_LABELS.filter(
    label => !new RegExp(`^${label}\\s*:`, 'mi').test(imagePrompt),
  );
  const signatures: Array<[string, RegExp]> = [
    ['表情系统', /\b(calm|curious|tense|surprised|afraid|sad|determined|relaxed)\b.*\b(curious|tense|surprised)/is],
    ['头部多角度', /(three[- ]quarter|low angle|high angle|looking up|looking down)/i],
    ['手部动作', /(relaxed open|tense clenched|pointing|gripping)/i],
    ['主展示区最大', /(largest|dominate|biggest)/i],
    ['一致性', /(identical face|same person|zero style drift|consistency)/i],
    ['表情 8 张', /(8|eight).{0,20}(expression|head)/i],
  ];
  const missingSignatures = signatures
    .filter(([, re]) => !re.test(imagePrompt))
    .map(([name]) => name);
  return {
    ok: missingLabels.length === 0 && missingSignatures.length === 0,
    missingLabels,
    missingSignatures,
  };
}
