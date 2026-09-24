import { describe, it, expect } from 'vitest';
import {
  parseLabeledLine,
  parseLabeledScript,
  attachDirectorTag,
  splitInlineDialogue,
  backfillSpeakers,
  fillDirectorDefaults,
  applyDirectorPipeline,
} from '../utils/blockDirectorFill';

const blk = (id: string, type: import('../types').BlockType, content: string) => ({ id, type, content });

describe('parseLabeledLine', () => {
  it('parses the six story tags', () => {
    expect(parseLabeledLine('[SCENE] 内. 茶馆 - 夜')).toEqual({ block: { id: expect.any(String), type: 'SCENE_HEADING', content: '内. 茶馆 - 夜' } });
    expect(parseLabeledLine('[dialogue] 你的刀很快。').block?.type).toBe('DIALOGUE');
    expect(parseLabeledLine('[TRANSITION] CUT TO: 夜 - 次日').block?.type).toBe('TRANSITION');
  });

  it('parses the four director tags', () => {
    expect(parseLabeledLine('[MOTION] 门扇急摆')).toEqual({ director: { tag: 'MOTION', value: '门扇急摆' } });
    expect(parseLabeledLine('[DURATION] 3.5')).toEqual({ director: { tag: 'DURATION', value: '3.5' } });
    expect(parseLabeledLine('[FIRST] 刀客立于门口').director?.tag).toBe('FIRST');
    expect(parseLabeledLine('[LAST] 门在身后合拢').director?.tag).toBe('LAST');
  });

  it('returns empty for blank/unknown lines', () => {
    expect(parseLabeledLine('')).toEqual({});
    expect(parseLabeledLine('刀客推门而入')).toEqual({});
  });
});

describe('attachDirectorTag', () => {
  it('attaches to the nearest preceding generatable block (skips dialogue)', () => {
    const blocks = [
      blk('a', 'ACTION', '推门'),
      blk('c', 'CHARACTER', '刀客'),
      blk('d', 'DIALOGUE', '你的刀很快。'),
    ];
    const out = attachDirectorTag(blocks, 'MOTION', '门扇急摆');
    // nearest generatable = the CHARACTER cue (design §1: cue blocks are
    // generatable and carry frames too)
    expect(out.find(b => b.id === 'c')?.motionPrompt).toBe('门扇急摆');
    expect(out.find(b => b.id === 'd')?.motionPrompt).toBeUndefined();
  });

  it('DURATION accepts decimals and rejects junk', () => {
    const blocks = [blk('a', 'ACTION', '推门')];
    expect(attachDirectorTag(blocks, 'DURATION', '3.5')[0].shotDuration).toBe(3.5);
    expect(attachDirectorTag(blocks, 'DURATION', 'abc')[0].shotDuration).toBeUndefined();
  });

  it('no generatable block → no-op', () => {
    const blocks = [blk('d', 'DIALOGUE', '词')];
    expect(attachDirectorTag(blocks, 'MOTION', 'x')).toEqual(blocks);
  });
});

describe('parseLabeledScript', () => {
  it('assembles a full block group with director fields attached', () => {
    const text = [
      '[SCENE] 内. 茶馆 - 夜',
      '[ACTION] 00:00-00:03。刀客推门而入',
      '[MOTION] 门扇急摆,雨水滴落',
      '[DURATION] 3',
      '[FIRST] 刀客立于门口',
      '[CHARACTER] 刀客',
      '[DIALOGUE] 你的刀很快。',
    ].join('\n');
    const blocks = parseLabeledScript(text);
    expect(blocks.map(b => b.type)).toEqual(['SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE']);
    const action = blocks[1];
    expect(action.motionPrompt).toBe('门扇急摆,雨水滴落');
    expect(action.shotDuration).toBe(3);
    expect(action.firstFrameDesc).toBe('刀客立于门口');
  });

  it('bare lines fall back to the ACTION/SCENE/CHARACTER heuristics', () => {
    const blocks = parseLabeledScript(['内. 茶馆', '刀客推门而入', 'NARRATOR', '普通的一句旁白'].join('\n'));
    expect(blocks[0].type).toBe('SCENE_HEADING');
    expect(blocks[1].type).toBe('ACTION');
    expect(blocks[2].type).toBe('CHARACTER');
    expect(blocks[3].type).toBe('ACTION');
  });
});

describe('splitInlineDialogue — 站长指定项', () => {
  it('splits 「NAME：台词」 mashed into an ACTION', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 茶馆'),
      blk('1', 'CHARACTER', '刀客'),
      blk('2', 'ACTION', '刀客：你的刀很快。'),
    ];
    const out = splitInlineDialogue(blocks);
    expect(out.map(b => b.type)).toEqual(['SCENE_HEADING', 'CHARACTER', 'CHARACTER', 'DIALOGUE']);
    expect(out[2].content).toBe('刀客');
    expect(out[3].content).toBe('你的刀很快。');
  });

  it('splits costume-cued inline dialogue (NAME（浴袍）：…)', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 浴室'),
      blk('1', 'CHARACTER', '张三'),
      blk('2', 'CHARACTER', '张三：好热。'),
    ];
    const out = splitInlineDialogue(blocks);
    expect(out.map(b => b.type)).toEqual(['SCENE_HEADING', 'CHARACTER', 'CHARACTER', 'DIALOGUE']);
    expect(out[2].content).toBe('张三');
  });

  it('keeps the 括注 on the cue and takes the WHOLE spoken line (regression: the line was the parenthetical)', () => {
    // 银盐晨光形态 — 「女儿（愣住）："你以前从不喝咖啡。"」
    const blocks = [blk('g', 'CHARACTER', '女儿（愣住）："你以前从不喝咖啡。"')];
    const out = splitInlineDialogue(blocks);
    expect(out.map(b => b.type)).toEqual(['CHARACTER', 'DIALOGUE']);
    expect(out[0].content).toBe('女儿（愣住）'); // direction/variant stays on the cue
    expect(out[1].content).toBe('你以前从不喝咖啡。'); // quotes stripped, line intact
  });

  it('splits a DIALOGUE block stuffed with a mashed cue (母亲（微笑）：…)', () => {
    const blocks = [blk('z', 'DIALOGUE', '母亲（微笑）："但我想记住你现在的样子。"')];
    const out = splitInlineDialogue(blocks);
    expect(out.map(b => b.type)).toEqual(['CHARACTER', 'DIALOGUE']);
    expect(out[0].content).toBe('母亲（微笑）');
    expect(out[1].content).toBe('但我想记住你现在的样子。');
  });

  it('splits a 括注 cue even when its name is not yet in the universe', () => {
    // mother is a NEW name mid-script — the 括注 makes the mash unambiguous
    const blocks = [
      blk('0', 'CHARACTER', '女儿'),
      blk('1', 'DIALOGUE', '你以前从不喝咖啡。'),
      blk('2', 'DIALOGUE', '母亲（微笑）：但我想记住你现在的样子。'),
    ];
    const out = splitInlineDialogue(blocks);
    expect(out.map(b => b.type)).toEqual(['CHARACTER', 'DIALOGUE', 'CHARACTER', 'DIALOGUE']);
    expect(out[2].content).toBe('母亲（微笑）');
  });

  it('leaves non-character prefixed ACTIONs alone', () => {
    const blocks = [blk('0', 'ACTION', '时间：深夜')];
    expect(splitInlineDialogue(blocks)).toEqual(blocks);
  });

  it('leaves a bare unknown-name ACTION alone when the universe is non-empty', () => {
    const blocks = [
      blk('0', 'CHARACTER', '刀客'),
      blk('1', 'ACTION', '注意：地板很滑。'), // staging, not 刀客 speaking
    ];
    const out = splitInlineDialogue(blocks);
    expect(out.map(b => b.type)).toEqual(['CHARACTER', 'ACTION']);
    expect(out[1].content).toBe('注意：地板很滑。');
  });
});

describe('backfillSpeakers', () => {
  it('backfills DIALOGUE.speaker from the nearest cue', () => {
    const out = backfillSpeakers([
      blk('0', 'CHARACTER', '张三（浴袍）'),
      blk('1', 'DIALOGUE', '好热。'),
      blk('2', 'ACTION', '张三入水'),
      blk('3', 'DIALOGUE', '舒服。'),
    ]);
    expect(out[0].speaker).toBeUndefined(); // cues carry no speaker
    expect(out[1].speaker).toBe('张三');
    expect(out[3].speaker).toBe('张三'); // cue persists across actions
  });

  it('never overwrites an explicit speaker', () => {
    const out = backfillSpeakers([
      blk('0', 'CHARACTER', '张三'),
      blk('1', 'DIALOGUE', '词'),
    ].map((b, i) => (i === 1 ? { ...b, speaker: '旁白' } : b)));
    expect(out[1].speaker).toBe('旁白');
  });
});

describe('fillDirectorDefaults — deterministic, zero AI', () => {
  it('motionPrompt defaults to first sentence (timestamp stripped)', () => {
    const out = fillDirectorDefaults([blk('a', 'ACTION', '00:00-00:03。刀客推门而入。雨声灌进屋')]);
    expect(out[0].motionPrompt).toBe('刀客推门而入');
  });

  it('shotDuration defaults to the timestamp width, else 5', () => {
    expect(fillDirectorDefaults([blk('a', 'ACTION', '00:01-00:04。动作')])[0].shotDuration).toBe(3);
    expect(fillDirectorDefaults([blk('a', 'ACTION', '动作没有时间戳')])[0].shotDuration).toBe(5);
  });

  it('firstFrameDesc falls back to imagePrompt, then content', () => {
    const withImg = fillDirectorDefaults([Object.assign(blk('a', 'ACTION', '动作'), { imagePrompt: 'a cinematic frame' })]);
    expect(withImg[0].firstFrameDesc).toBe('a cinematic frame');
    const bare = fillDirectorDefaults([blk('a', 'ACTION', '动作')]);
    expect(bare[0].firstFrameDesc).toBe('动作');
  });

  it('lastFrameDesc stays absent when unset (legal state)', () => {
    expect(fillDirectorDefaults([blk('a', 'ACTION', '动作')])[0].lastFrameDesc).toBeUndefined();
  });

  it('existing values are never overwritten', () => {
    const out = fillDirectorDefaults([Object.assign(blk('a', 'ACTION', '00:00-00:03。推门'), { motionPrompt: ' authored motion', shotDuration: 7 })]);
    expect(out[0].motionPrompt).toBe(' authored motion');
    expect(out[0].shotDuration).toBe(7);
  });

  it('dialogue/parenthetical blocks are untouched', () => {
    const out = fillDirectorDefaults([blk('d', 'DIALOGUE', '词'), blk('p', 'PARENTHETICAL', '(冷冷地)')]);
    expect(out[0].motionPrompt).toBeUndefined();
    expect(out[0].shotDuration).toBeUndefined();
    expect(out[1].firstFrameDesc).toBeUndefined();
  });
});

describe('applyDirectorPipeline — full order', () => {
  it('split → speakers → defaults, end to end', () => {
    const text = [
      '[SCENE] 内. 茶馆 - 夜',
      '[ACTION] 00:00-00:03。刀客：你的刀很快。',
    ].join('\n');
    const parsed = parseLabeledScript(text);
    const out = applyDirectorPipeline(parsed);
    // pure-dialogue beat: the ACTION is replaced by cue + dialogue, and the
    // timestamp duration rides onto the DIALOGUE block
    expect(out.map(b => b.type)).toEqual(['SCENE_HEADING', 'CHARACTER', 'DIALOGUE']);
    const dlg = out.find(b => b.type === 'DIALOGUE');
    expect(dlg?.speaker).toBe('刀客');
    expect(dlg?.shotDuration).toBe(3);
  });
});
