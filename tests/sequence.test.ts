import { describe, it, expect } from 'vitest';
import { ScriptBlock, ScriptSequence } from '../types';
import {
  buildSequenceContext,
  sequenceAt,
  wardrobeIn,
} from '../utils/sequence';

const blk = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

describe('buildSequenceContext', () => {
  // ⚠ CAPTURES CURRENT BEHAVIOR, including a suspected defect (flagged to the
  // owner, intentionally NOT fixed under the zero-behavior-change mandate):
  // the `i === scenes.indexOf(s)` break inside the scan fires on the FIRST
  // scene heading for every scene after the first distinct one, so `present`
  // is only ever populated for scene 1 — later scenes render "—". Also,
  // CHARACTER cues inside one scene are NOT deduped (张三 + 张三（浴袍） both push
  // 张三). Fixing either changes the LLM prompt text = behavior change.
  it('scene 1 lists present cues (un-deduped by base); later scenes scan empty (see ⚠ above)', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '外. 泥沼 - 黄昏'),
      blk('1', 'ACTION', '张三跌进泥里'),
      blk('2', 'CHARACTER', '张三'),
      blk('3', 'CHARACTER', '张三（浴袍）'), // same base — NOT deduped in this view
      blk('4', 'SCENE_HEADING', '内. 浴室 - 夜'),
      blk('5', 'CHARACTER', '李四'),
      blk('6', 'SCENE_HEADING', '外. 泥沼 - 黄昏'), // re-entry: same heading text
    ];
    const ctx = buildSequenceContext(blocks);
    expect(ctx).toContain('Scene 1: "外. 泥沼 - 黄昏" — present: 张三、张三');
    expect(ctx).toContain('Scene 2: "内. 浴室 - 夜" — present: —');
    // the re-entered heading is NOT listed twice (distinct by content)
    expect(ctx.match(/Scene \d+:/g)).toHaveLength(2);
    expect(ctx).toContain('Characters seen: 张三、李四');
    // the judgment instruction is carried so the LLM output stays parseable
    expect(ctx).toContain('Output: {"sequences"');
  });

  it('renders an empty present list and dash-only characters for a bare script', () => {
    const blocks = [blk('0', 'SCENE_HEADING', '内. 某处')];
    const ctx = buildSequenceContext(blocks);
    expect(ctx).toContain('present: —');
    expect(ctx).toContain('Characters seen: —');
  });
});

describe('sequenceAt', () => {
  const seqs: ScriptSequence[] = [
    { id: 'seq1', start: 0, end: 4, wardrobe: { 张三: { costume: '便装' } } },
    { id: 'seq2', start: 4, end: 9, wardrobe: { 张三: { costume: '浴袍', age: '青年' } } },
  ];

  it('finds the sequence covering a block index (start inclusive, end exclusive)', () => {
    expect(sequenceAt(seqs, 0)?.id).toBe('seq1');
    expect(sequenceAt(seqs, 3)?.id).toBe('seq1');
    expect(sequenceAt(seqs, 4)?.id).toBe('seq2');
    expect(sequenceAt(seqs, 8)?.id).toBe('seq2');
  });

  it('returns null outside every sequence and for undefined input', () => {
    expect(sequenceAt(seqs, 9)).toBeNull();
    expect(sequenceAt(seqs, 100)).toBeNull();
    expect(sequenceAt(undefined, 0)).toBeNull();
  });
});

describe('wardrobeIn', () => {
  const seq: ScriptSequence = {
    id: 'seq2', start: 4, end: 9,
    wardrobe: { 张三: { costume: '浴袍', age: '青年' } },
  };

  it('returns the character’s wardrobe state inside the sequence', () => {
    expect(wardrobeIn(seq, '张三')).toEqual({ costume: '浴袍', age: '青年' });
  });

  it('returns an empty object for an unlisted character or null sequence', () => {
    expect(wardrobeIn(seq, '李四')).toEqual({});
    expect(wardrobeIn(null, '张三')).toEqual({});
  });
});
