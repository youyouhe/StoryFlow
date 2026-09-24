import { describe, it, expect } from 'vitest';
import {
  CHARACTER_SHEET_MODULES,
  CHARACTER_SHEET_ALLOWED_LABELS,
  CHARACTER_SHEET_RULES,
  buildCharacterSheetSystemPrompt,
  normalizeCharacterSheetPrompt,
  applySheetFilterSafety,
  auditCharacterSheet,
  SHEET_EXPRESSIONS,
  SHEET_HAND_POSES,
} from '../utils/characterSheet';

/** 银盐晨光 styleHead (from docs/examples/yinshan-chenchen.json) — the
 *  regression style for the LU ZHIBAI / 陆之白 sheet. */
const YINSHAN_STYLE = {
  name: '银盐晨光',
  artStyle: '35mm实拍电影质感，浅景深与呼吸式手持，自然窗光单一光源，细密胶片颗粒与高光轻微溢出，肤色真实有毛孔细节；米灰、暖褐与低饱和青的克制调色，质感冷静而温存。',
  scenePreset: '当代东亚城市住宅厨房，清晨七点，百叶窗在台面切出条状光影，不锈钢咖啡机、白瓷杯、木质台面构成写实静物；生活流、私密、几乎无戏剧感的真实空间。',
  promptPrefix: 'live-action 35mm film cinematography, shallow depth of field, single natural window light source, fine film grain, soft halation on highlights, realistic skin and porcelain texture, muted beige, warm brown and desaturated teal palette, quiet intimate kitchen realism',
};

/** A complete 11-line sheet in the shape the contract demands — used as the
 *  LU ZHIBAI (陆之白) regression sample and as normalize/audit input. */
const LU_ZHIBAI_SHEET = [
  'Identity: LU ZHIBAI (陆之白) — adult photo studio owner, 34, keywords: quiet / observant / dry-humoured / protective / meticulous; core theme: a man who records other people\'s mornings while hiding his own.',
  'Palette: 8 swatches — warm skin #E8C4A8, ink-black hair #1A1A1A, deep brown eyes #4A3728, oatmeal linen shirt #D9CFC0, charcoal wool trousers #3A3A3A, faded teal apron #5F7A78, brass camera trim #B08D57, silver-halide paper white #F2EFE8.',
  'Main: LARGEST panel — three full-body figures side by side at identical scale (front / three-quarter / back), standard relaxed standing pose, height scale line beside the figures, no props, identical oatmeal linen shirt and charcoal trousers in all three; every panel on the sheet keeps the same person (identical face, hairstyle, proportions) with zero style drift.',
  'Silhouette: clean solid front + side full-body silhouettes matching the turnaround proportions exactly.',
  'Expressions: 8 head-and-shoulder studies in a grid — calm / curious / tense / surprised / afraid / sad / determined / relaxed.',
  'Micro: 5 tight facial studies — near-smile twitch, eyebrow micro-furrow, lip press, eye-narrow tell, breath-held stillness.',
  'Heads: 3 extra head studies — three-quarter, low angle looking up, high angle looking down.',
  'Poses: 3 studies — relaxed (weight on one leg), tense (shoulders braced), confident (chin level, hands easy).',
  'Bust: chest-up portrait with a strong restrained grief breaking into warmth.',
  'Costume: 4 close-ups — hairstyle (side-parted black hair), fabric (oatmeal linen weave), accessories (brass watch, camera strap), footwear (worn brown leather shoes).',
  'Hands: 4 studies — relaxed open, tense clenched, pointing, gripping a camera body.',
].join('\n');

describe('CHARACTER_SHEET contract', () => {
  it('declares the 11 required modules', () => {
    expect(CHARACTER_SHEET_MODULES).toHaveLength(11);
    expect(CHARACTER_SHEET_ALLOWED_LABELS).toEqual([
      'Identity', 'Palette', 'Main', 'Silhouette', 'Expressions',
      'Micro', 'Heads', 'Poses', 'Bust', 'Costume', 'Hands',
    ]);
  });

  it('rules pin the 8 expressions and 4 hand poses (表情系统 / 手部动作)', () => {
    for (const e of SHEET_EXPRESSIONS) expect(CHARACTER_SHEET_RULES).toContain(e);
    for (const h of SHEET_HAND_POSES) expect(CHARACTER_SHEET_RULES).toContain(h);
  });

  it('rules pin head angles (头部多角度) and main-panel dominance (主展示区最大)', () => {
    expect(CHARACTER_SHEET_RULES).toMatch(/three-quarter/i);
    expect(CHARACTER_SHEET_RULES).toMatch(/low angle/i);
    expect(CHARACTER_SHEET_RULES).toMatch(/high angle/i);
    expect(CHARACTER_SHEET_RULES).toMatch(/LARGEST/i);
    expect(CHARACTER_SHEET_RULES).toMatch(/identical face/i);
  });
});

describe('buildCharacterSheetSystemPrompt', () => {
  it('injects styleHead dynamically (no hardcoded medium)', () => {
    const p = buildCharacterSheetSystemPrompt({ systemInstruction: 'STORY', styleHead: YINSHAN_STYLE });
    expect(p).toContain(YINSHAN_STYLE.promptPrefix);
    expect(p).toContain('GLOBAL STYLE LOCK');
    expect(p).toContain(YINSHAN_STYLE.artStyle.slice(0, 20));
    // ink-wash / anime / photoreal all valid — the rules say style-agnostic
    expect(p).toMatch(/ink-wash/i);
    expect(p).toMatch(/anime/i);
    // and must NOT hardcode only one medium as the output
    expect(p).not.toMatch(/always photoreal/i);
  });

  it('works without a styleHead (infers one coherent style)', () => {
    const p = buildCharacterSheetSystemPrompt({ systemInstruction: 'STORY' });
    expect(p).toContain('No locked visual style');
    expect(p).toContain('Identity:');
  });

  it('carries variant + wardrobe notes when given', () => {
    const p = buildCharacterSheetSystemPrompt({
      systemInstruction: 'STORY',
      styleHead: YINSHAN_STYLE,
      variantNote: '\nVARIANT MODE — reuse the person EXACTLY\n',
      wardrobeNote: '\nAt this story point the character is travel gear\n',
    });
    expect(p).toContain('VARIANT MODE');
    expect(p).toContain('travel gear');
  });
});

describe('normalizeCharacterSheetPrompt', () => {
  it('keeps exactly the 11 labeled lines and re-capitalizes labels', () => {
    const raw = [
      'Here is your sheet:',
      '- identity: LU ZHIBAI — adult studio owner, 34',
      '- PALETTE: oatmeal / charcoal / teal',
      '- MAIN: LARGEST turnaround panel',
      '- silhouette: front + side',
      '- expressions: calm / curious / tense',
      '- micro: lip press',
      '- heads: three-quarter',
      '- poses: relaxed',
      '- bust: strong emotion',
      '- costume: hairstyle / fabric',
      '- hands: relaxed open / gripping',
      'Enjoy!',
    ].join('\n');
    const out = normalizeCharacterSheetPrompt(raw);
    const lines = out.split('\n');
    expect(lines).toHaveLength(11);
    expect(lines[0].startsWith('Identity:')).toBe(true);
    expect(lines[1].startsWith('Palette:')).toBe(true);
    expect(lines[3].startsWith('Silhouette:')).toBe(true);
    expect(out).not.toContain('Enjoy');
    expect(out).not.toContain('Here is');
  });

  it('drops empty values and stray markdown', () => {
    const out = normalizeCharacterSheetPrompt('Identity: **LU ZHIBAI**\nPalette:\nMain: big');
    expect(out).toContain('Identity: LU ZHIBAI');
    expect(out).not.toContain('**');
    expect(out).not.toContain('Palette:');
  });
});

describe('applySheetFilterSafety', () => {
  it('rewrites checker-trigger words', () => {
    expect(applySheetFilterSafety('an intimate sensual scene')).toBe('an warm graceful scene');
    expect(applySheetFilterSafety('seductive charm')).toBe('charming charm');
  });
});

describe('auditCharacterSheet — LU ZHIBAI (陆之白) regression', () => {
  it('the 银盐晨光 sample sheet passes the full 11-module audit', () => {
    const a = auditCharacterSheet(LU_ZHIBAI_SHEET);
    expect(a.missingLabels).toEqual([]);
    expect(a.missingSignatures).toEqual([]);
    expect(a.ok).toBe(true);
  });

  it('names the signatures 站长 required: 表情系统 / 头部多角度 / 手部动作 / 主展示区最大 / 一致性', () => {
    // each signature is individually detectable on the sample
    expect(LU_ZHIBAI_SHEET).toMatch(/Expressions: 8/);
    expect(LU_ZHIBAI_SHEET).toMatch(/three-quarter, low angle/i);
    expect(LU_ZHIBAI_SHEET).toMatch(/relaxed open, tense clenched, pointing, gripping/);
    expect(LU_ZHIBAI_SHEET).toMatch(/LARGEST/);
    expect(LU_ZHIBAI_SHEET).toMatch(/identical scale/);
  });

  it('flags a stripped sheet (legacy 3-view turnaround) as incomplete', () => {
    const legacy = [
      'Identity: LU ZHIBAI',
      'Palette: brown',
      'Main: three figures side by side',
    ].join('\n');
    const a = auditCharacterSheet(legacy);
    expect(a.ok).toBe(false);
    expect(a.missingLabels).toContain('Expressions');
    expect(a.missingLabels).toContain('Hands');
    expect(a.missingLabels).toContain('Heads');
    expect(a.missingSignatures.length).toBeGreaterThan(0);
  });
});
