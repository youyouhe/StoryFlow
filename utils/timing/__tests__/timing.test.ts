/**
 * P2a word-level time model — tokenization, estimation, anchors, projection.
 * Acceptance targets: 改词自动重排(1), Dual Text + 中文按字(3), identity law(6).
 */
import { describe, expect, it } from 'vitest';
import type { ScriptBlock, Screenplay, ScriptMarks } from '../../../types';
import { displayText, spokenText, stripBeatTimestamp, tokenizeBlock, tokenizeBlocks } from '../tokenize';
import { estimateBlockSeconds, estimateTokenSeconds } from '../estimate';
import { buildAnchors, expectedAnchorCount } from '../anchor';
import { clampMarks, momentAtGap, selectionFromTokenRun } from '../selection';
import {
  blockTokenWindows,
  blockWindow,
  buildTimeline,
  momentTime,
  projectCaptionCues,
  selectionSpan,
} from '../timeline';

const block = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

const screen = (blocks: ScriptBlock[], marks?: ScriptMarks): Screenplay => ({
  id: 'sp_t',
  metadata: { title: 'T', author: 'A', draft: '1', scriptLanguage: 'en' },
  blocks,
  lastModified: 0,
  marks,
});

describe('tokenize', () => {
  it('splits Latin words and CJK characters (Chinese never one giant word)', () => {
    const en = tokenizeBlock(block('b1', 'DIALOGUE', 'Hello there world'));
    expect(en.map(t => t.text)).toEqual(['Hello', 'there', 'world']);
    const zh = tokenizeBlock(block('b2', 'DIALOGUE', '把组件化做好'));
    expect(zh.map(t => t.text)).toEqual(['把', '组', '件', '化', '做', '好']);
    expect(zh.every(t => t.kind === 'char')).toBe(true);
  });

  it('Dual Text shows one surface and speaks the other', () => {
    const tokens = tokenizeBlock(block('b1', 'DIALOGUE', 'We call it <BCC | B C C> here.'));
    const dual = tokens.find(t => t.text === 'BCC');
    expect(dual?.spokenText).toBe('B C C');
    expect(displayText(tokens)).toBe('We call it BCC here.');
    expect(spokenText(tokens)).toBe('We call it B C C here.');
  });

  it('Dual Text shorthand <组件化|> keeps one complete display unit', () => {
    const tokens = tokenizeBlock(block('b1', 'ACTION', '<组件化|>很重要'));
    expect(tokens[0].text).toBe('组件化');
    expect(tokens[0].spokenText).toBe('组件化');
  });

  it('strips beat timestamps before tokenizing (prefix is an envelope, not speech)', () => {
    expect(stripBeatTimestamp('00:00-00:03。She enters.')).toBe('She enters.');
    const tokens = tokenizeBlock(block('b1', 'ACTION', '00:00-00:03。She enters.'));
    expect(tokens[0].text).toBe('She');
  });

  it('preserves author spacing exactly ("3 D" ≠ "3D")', () => {
    const spaced = tokenizeBlock(block('b1', 'ACTION', 'size 3 D'));
    const tight = tokenizeBlock(block('b1', 'ACTION', 'size 3D'));
    expect(displayText(spaced)).toBe('size 3 D');
    expect(displayText(tight)).toBe('size 3D');
  });
});

describe('estimate', () => {
  it('is deterministic and monotonic in word count', () => {
    const short = tokenizeBlock(block('b1', 'DIALOGUE', 'Hi.'));
    const long = tokenizeBlock(block('b1', 'DIALOGUE', 'Hi there my dear friend, really.'));
    const a = estimateBlockSeconds(short, 'DIALOGUE');
    const b = estimateBlockSeconds(long, 'DIALOGUE');
    expect(a).toBe(estimateBlockSeconds(short, 'DIALOGUE'));
    expect(b).toBeGreaterThan(a);
  });

  it('measures CJK per character (~0.2s each) and Dual Text by its spoken side', () => {
    const zh = tokenizeBlock(block('b1', 'DIALOGUE', '是的'));
    expect(estimateTokenSeconds(zh[0])).toBeCloseTo(0.2, 5);
    expect(estimateTokenSeconds(zh[1])).toBeCloseTo(0.2, 5);
    const dual = tokenizeBlock(block('b1', 'DIALOGUE', '<BCC | B C C>'));
    expect(estimateTokenSeconds(dual[0])).toBeGreaterThan(estimateTokenSeconds(zh[0]));
  });
});

describe('anchors', () => {
  it('obeys the identity law: exactly 2M + 2N + 2 unique anchors', () => {
    const blocks = [
      block('sc', 'SCENE_HEADING', 'INT. CAFE - DAY'),
      block('a1', 'ACTION', 'She enters.'),
      block('d1', 'DIALOGUE', 'Hello there.'),
    ];
    const tokens = tokenizeBlocks(blocks);
    const tokenCount = [...tokens.values()].reduce((n, t) => n + t.length, 0);
    const anchors = buildAnchors(blocks.map(b => b.id), tokens);
    expect(anchors.length).toBe(expectedAnchorCount(blocks.length, tokenCount));
    expect(new Set(anchors.map(a => a.id)).size).toBe(anchors.length);
  });
});

describe('timeline projection', () => {
  it('authored beat prefixes win; words distribute inside the envelope', () => {
    const sp = screen([
      block('sc', 'SCENE_HEADING', 'INT. CAFE - DAY'),
      block('a1', 'ACTION', '00:00-00:04。She enters and sits.'),
      block('ch', 'CHARACTER', 'ALICE'),
      block('d1', 'DIALOGUE', 'Hi.'),
    ]);
    const tl = buildTimeline(sp);
    const a1 = blockWindow(tl, 'a1')!;
    expect(a1.source).toBe('authored');
    expect(a1.start).toBe(0);
    // group envelope is the authored [0,4); members partition it
    const d1 = blockWindow(tl, 'd1')!;
    expect(d1.end).toBeLessThanOrEqual(4);
    expect(tl.durationSec).toBeGreaterThan(0);
  });

  it('untimed blocks get estimated windows (the old "时长未知" gap is gone)', () => {
    const sp = screen([
      block('sc', 'SCENE_HEADING', 'INT. CAFE - DAY'),
      block('a1', 'ACTION', 'She enters quietly and looks around the room.'),
    ]);
    const tl = buildTimeline(sp);
    const a1 = blockWindow(tl, 'a1')!;
    expect(a1.source).toBe('estimated');
    expect(a1.end).toBeGreaterThan(a1.start);
  });

  it('token windows tile their block window exactly', () => {
    const sp = screen([block('d1', 'DIALOGUE', 'Hello there world')]);
    const tl = buildTimeline(sp);
    const words = blockTokenWindows(tl, 'd1');
    expect(words.length).toBe(3);
    expect(words[0].start).toBe(blockWindow(tl, 'd1')!.start);
    expect(words[words.length - 1].end).toBe(blockWindow(tl, 'd1')!.end);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].start).toBe(words[i - 1].end);
    }
  });

  it('reflows when a line changes: caption cues and word windows re-arrange (acceptance 1)', () => {
    const before = screen([
      block('sc', 'SCENE_HEADING', 'INT. CAFE - DAY'),
      block('a1', 'ACTION', 'She enters quietly.'),
      block('d1', 'DIALOGUE', 'Hi.'),
    ]);
    const after = screen([
      block('sc', 'SCENE_HEADING', 'INT. CAFE - DAY'),
      block('a1', 'ACTION', 'She enters quietly.'),
      block('d1', 'DIALOGUE', 'Hi there my dear friend, wonderful to see you.'),
    ]);
    const tlBefore = buildTimeline(before);
    const tlAfter = buildTimeline(after);
    expect(blockWindow(tlAfter, 'd1')!.end).toBeGreaterThan(blockWindow(tlBefore, 'd1')!.end);
    const cuesBefore = projectCaptionCues(tlBefore).find(c => c.blockId === 'd1')!;
    const cuesAfter = projectCaptionCues(tlAfter).find(c => c.blockId === 'd1')!;
    expect(cuesAfter.words.length).toBeGreaterThan(cuesBefore.words.length);
    expect(cuesAfter.end).toBeGreaterThan(cuesBefore.end);
  });

  it('clamps marks into re-tokenized ranges and projects selection spans across blocks (acceptance 2 substrate)', () => {
    const blocks = [
      block('a1', 'ACTION', 'One two three four'),
      block('d1', 'DIALOGUE', 'Five six seven eight'),
    ];
    const marks: ScriptMarks = {
      selections: [selectionFromTokenRun('reveal', 'a1', 1, 4)],
      moments: [momentAtGap('punch', 'd1', 2)],
    };
    const sp = screen(blocks, marks);
    const tl = buildTimeline(sp);
    const span = selectionSpan(tl, 'reveal')!;
    expect(span.end).toBeGreaterThan(span.start);
    expect(momentTime(tl, 'punch')).toBeGreaterThanOrEqual(0);

    // shrink the block below the stored gap → clamp, no crash
    const shrunk = screen([block('a1', 'ACTION', 'One'), block('d1', 'DIALOGUE', 'Five six seven eight')], marks);
    const tl2 = buildTimeline(shrunk);
    const span2 = selectionSpan(tl2, 'reveal')!;
    expect(span2.end).toBeGreaterThanOrEqual(span2.start);
    expect(tl2.marks.selections[0].start.gap).toBeLessThanOrEqual(1);
  });

  it('clamps marks non-destructively', () => {
    const tokens = tokenizeBlocks([block('a1', 'ACTION', 'One two')]);
    const marks: ScriptMarks = { selections: [selectionFromTokenRun('s', 'a1', 0, 99)], moments: [] };
    const clamped = clampMarks(marks, tokens);
    expect(marks.selections[0].end.gap).toBe(99); // input untouched
    expect(clamped.selections[0].end.gap).toBe(2);
  });
});
