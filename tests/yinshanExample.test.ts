import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  splitInlineDialogue,
  backfillSpeakers,
  fillDirectorDefaults,
  applyDirectorPipeline,
} from '../utils/blockDirectorFill';
import { auditCharacterSheet } from '../utils/characterSheet';
import { dialoguesWithoutSpeaker } from '../utils/shotList';
import type { Screenplay, ScriptBlock } from '../types';

/**
 * 《银盐晨光》example-document regression (docs/examples/yinshan-chenchen.json).
 *
 * The example is the reference schema-v2 document: director fields on every
 * generatable block, CHARACTER design sheets in the industrial 11-module
 * format, DIALOGUE auto-split from mashed CHARACTER lines (站长指定项) with
 * speakers backfilled. This suite pins that shape so the example cannot drift.
 */
const sp = JSON.parse(
  readFileSync(join(__dirname, '../docs/examples/yinshan-chenchen.json'), 'utf8'),
) as Screenplay;

const GENERATABLE = new Set(['SCENE_HEADING', 'ACTION', 'CHARACTER']);

describe('《银盐晨光》example document', () => {
  it('is schemaVersion 2 with both CHARACTER design sheets present', () => {
    expect(sp.schemaVersion).toBe(2);
    expect(sp.metadata.styleHead?.name).toBe('银盐晨光');
    const cues = sp.blocks.filter(b => b.type === 'CHARACTER');
    expect(cues.map(b => b.content.trim()).sort()).toEqual(['女儿（愣住）', '母亲（微笑）']);
    // 补母亲 CHARACTER ref — the mother cue must carry a design sheet
    const mother = cues.find(b => b.content.includes('母亲'))!;
    expect(mother.imagePrompt).toBeTruthy();
  });

  it('g60az7ygd is split into CHARACTER + DIALOGUE (不再是 mashed 台词)', () => {
    const cue = sp.blocks.find(b => b.id === 'g60az7ygd')!;
    expect(cue.type).toBe('CHARACTER');
    expect(cue.content.trim()).toBe('女儿（愣住）');
    expect(cue.content).not.toContain('：');
    const line = sp.blocks.find(b => b.id === 'g60az7ygd-d1')!;
    expect(line.type).toBe('DIALOGUE');
    expect(line.content).toContain('你以前从不喝咖啡');
    expect(line.content).not.toContain('女儿');
  });

  it('every DIALOGUE has a speaker (Pro validation list is empty)', () => {
    expect(dialoguesWithoutSpeaker(sp.blocks)).toEqual([]);
    const speakers = sp.blocks.filter(b => b.type === 'DIALOGUE').map(b => b.speaker);
    expect(speakers).toContain('女儿');
    expect(speakers).toContain('母亲');
  });

  it('every generatable block carries motionPrompt / shotDuration / first+last frames', () => {
    for (const b of sp.blocks) {
      if (!GENERATABLE.has(b.type)) continue;
      expect(b.motionPrompt, `${b.id} motionPrompt`).toBeTruthy();
      expect(b.shotDuration, `${b.id} shotDuration`).toBeGreaterThan(0);
      expect(b.firstFrameDesc, `${b.id} firstFrameDesc`).toBeTruthy();
      expect(b.lastFrameDesc, `${b.id} lastFrameDesc`).toBeTruthy();
    }
  });

  it('both CHARACTER sheets pass the industrial 11-module audit', () => {
    for (const b of sp.blocks) {
      if (b.type !== 'CHARACTER') continue;
      const a = auditCharacterSheet(b.imagePrompt!);
      expect(a.missingLabels, `${b.id} labels`).toEqual([]);
      expect(a.missingSignatures, `${b.id} signatures`).toEqual([]);
      expect(a.ok).toBe(true);
    }
  });

  it('both CHARACTER sheets are locked to the 银盐晨光 styleHead prefix', () => {
    const prefix = sp.metadata.styleHead!.promptPrefix;
    for (const b of sp.blocks) {
      if (b.type !== 'CHARACTER') continue;
      expect(b.imagePrompt!.startsWith(`Global Style: ${prefix}`)).toBe(true);
    }
  });
});

describe('《银盐晨光》 pipeline round-trip', () => {
  /** Simulate the model emitting the mashed form 站长 called out. */
  const mashed: ScriptBlock[] = [
    { id: 'm1', type: 'SCENE_HEADING', content: '清晨厨房，阳光斜照，咖啡机嗡鸣。' },
    { id: 'm2', type: 'ACTION', content: '00:00-00:04。母亲把一杯咖啡推给刚起床的女儿。' },
    { id: 'm3', type: 'CHARACTER', content: '女儿（愣住）："你以前从不喝咖啡。"' },
    { id: 'm4', type: 'DIALOGUE', content: '母亲（微笑）："但我想记住你现在的样子。"' },
    { id: 'm5', type: 'ACTION', content: '00:09-00:13。两人手指轻触杯沿。' },
  ];

  it('split → speakers → defaults reproduces the example\'s dialogue structure', () => {
    const out = applyDirectorPipeline(mashed);
    const types = out.map(b => b.type);
    expect(types).toEqual([
      'SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE', 'CHARACTER', 'DIALOGUE', 'ACTION',
    ]);
    expect(dialoguesWithoutSpeaker(out)).toEqual([]);
    // mashed CHARACTER line became cue + spoken line
    const daughterCue = out.find(b => b.type === 'CHARACTER' && b.content.includes('女儿'))!;
    expect(daughterCue.content).not.toContain('你以前');
    const daughterLine = out.find(b => b.type === 'DIALOGUE' && b.content.includes('你以前'))!;
    expect(daughterLine.speaker).toBe('女儿');
    // mashed DIALOGUE line gained a mother cue + speaker
    const motherLine = out.find(b => b.type === 'DIALOGUE' && b.content.includes('但我想'))!;
    expect(motherLine.speaker).toBe('母亲');
    expect(motherLine.content).not.toContain('母亲');
  });

  it('defaults fill director fields on generatable blocks (timestamp width wins)', () => {
    const out = applyDirectorPipeline(mashed);
    const beat = out.find(b => b.id === 'm2')!;
    expect(beat.shotDuration).toBe(4); // 00:00-00:04
    expect(beat.motionPrompt).toBeTruthy();
    expect(beat.firstFrameDesc).toBeTruthy();
    const second = out.find(b => b.id === 'm5')!;
    expect(second.shotDuration).toBe(4); // 00:09-00:13
    // DIALOGUE carries no camera
    const line = out.find(b => b.id !== 'm3' && b.type === 'DIALOGUE')!;
    expect(line.motionPrompt).toBeUndefined();
  });

  it('splitInlineDialogue alone never drops the spoken line', () => {
    const split = splitInlineDialogue(mashed);
    const spoken = split.filter(b => b.type === 'DIALOGUE').map(b => b.content);
    expect(spoken.some(s => s.includes('你以前从不喝咖啡'))).toBe(true);
    expect(split.some(b => b.type === 'CHARACTER' && b.content.includes('女儿'))).toBe(true);
  });

  it('backfillSpeakers alone fills from the nearest cue', () => {
    const split = splitInlineDialogue(mashed);
    const withSpeakers = backfillSpeakers(split);
    expect(dialoguesWithoutSpeaker(withSpeakers)).toEqual([]);
  });

  it('fillDirectorDefaults alone never overwrites authored values', () => {
    const authored: ScriptBlock[] = [{
      id: 'a1', type: 'ACTION', content: '推门而入。',
      motionPrompt: 'AUTHORED', shotDuration: 2.5,
      firstFrameDesc: 'F1', lastFrameDesc: 'L1',
    }];
    const out = fillDirectorDefaults(authored);
    expect(out[0].motionPrompt).toBe('AUTHORED');
    expect(out[0].shotDuration).toBe(2.5);
    expect(out[0].firstFrameDesc).toBe('F1');
    expect(out[0].lastFrameDesc).toBe('L1');
  });
});
