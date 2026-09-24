/**
 * P5a composite scene — karaoke exactness, overlay windows, duration.
 * Acceptance: 字幕逐词卡点 ≤1 帧(边界语义精确), 音频口型与字幕对齐(窗口同源).
 */
import { describe, expect, it } from 'vitest';
import type { Screenplay } from '../../../types';
import { blockTokenWindows, buildTimeline, projectCaptionCues, type CaptionCue } from '../../timing/timeline';
import {
  activeWordAt,
  compositeDurationSec,
  compositeSceneAt,
  DEFAULT_CAPTION_STYLE,
  type CompositeScene,
} from '../scene';

const screen = (blocks: { id: string; type: Screenplay['blocks'][number]['type']; content: string }[]): Screenplay => ({
  id: 'sp5',
  metadata: { title: 't', author: 'a', draft: '1', scriptLanguage: 'en' },
  blocks: blocks as Screenplay['blocks'],
  lastModified: 0,
});

const sceneWith = (cues: CaptionCue[]): CompositeScene => ({
  width: 1080,
  height: 1920,
  fps: 30,
  background: '#000',
  overlays: [{ kind: 'caption', cues, style: DEFAULT_CAPTION_STYLE, order: 70 }],
});

describe('karaoke caption timing (≤1-frame: boundaries are exact)', () => {
  it('activates words on half-open windows [start, end)', () => {
    const words = [
      { text: 'one', start: 0, end: 0.5 },
      { text: 'two', start: 0.5, end: 1.2 },
    ];
    expect(activeWordAt(words, 0)).toBe(0);
    expect(activeWordAt(words, 0.4999)).toBe(0);
    expect(activeWordAt(words, 0.5)).toBe(1); // exact boundary: next word
    expect(activeWordAt(words, 1.2)).toBe(-1); // after the last
  });

  it('caption windows ARE the token windows (audio/字幕 alignment identity, 10 samples)', () => {
    const sp = screen([
      { id: 'd1', type: 'DIALOGUE', content: 'Hello there my dear friend wonderful to see you again today' },
      { id: 'd2', type: 'DIALOGUE', content: 'Yes absolutely wonderful indeed' },
    ]);
    const timeline = buildTimeline(sp);
    const cues = projectCaptionCues(timeline);
    const scene = sceneWith(cues);

    // sample 10 words across both cues
    const samples: { cueWord: { text: string; start: number; end: number }; tokenWin: { start: number; end: number } }[] = [];
    for (const cue of cues) {
      const tokenWins = blockTokenWindows(timeline, cue.blockId)
        .filter(({ token }) => token.kind !== 'punct' && token.text);
      cue.words.forEach((w, i) => samples.push({ cueWord: w, tokenWin: tokenWins[i] }));
    }
    expect(samples.length).toBeGreaterThanOrEqual(10);
    for (const s of samples.slice(0, 10)) {
      expect(s.cueWord.start).toBeCloseTo(s.tokenWin.start, 5);
      expect(s.cueWord.end).toBeCloseTo(s.tokenWin.end, 5);
    }
    // and the scene resolves the same windows live
    const captionTrack = scene.overlays[0] as Extract<CompositeScene['overlays'][number], { kind: 'caption' }>;
    for (const s of samples.slice(0, 10)) {
      const mid = (s.cueWord.start + s.cueWord.end) / 2;
      const plan = compositeSceneAt(scene, mid);
      expect(plan.caption?.lines.flat().find(w => w.active)?.text).toBe(s.cueWord.text);
      void captionTrack;
    }
  });
});

describe('overlay windows and duration', () => {
  it('titles and stickers appear only inside their windows (with edge fades)', () => {
    const scene: CompositeScene = {
      width: 720, height: 1280, fps: 30, background: '#000',
      overlays: [
        { kind: 'title', text: 'MEANING', placement: 'top', color: '#fff', size: 64, startSec: 0, endSec: 2, order: 90 },
        { kind: 'sticker', id: 's1', text: 'nice', author: '@viewer', atSec: 1, durationSec: 1, order: 50 },
      ],
    };
    expect(compositeSceneAt(scene, 0.5).title?.text).toBe('MEANING');
    expect(compositeSceneAt(scene, 2).title).toBeUndefined();
    const early = compositeSceneAt(scene, 1.02).stickers[0];
    const mid = compositeSceneAt(scene, 1.5).stickers[0];
    expect(early.opacity).toBeLessThan(1);
    expect(mid.opacity).toBe(1);
    expect(compositeSceneAt(scene, 0.5).stickers).toHaveLength(0);
  });

  it('duration: base wins, else the last overlay extent', () => {
    const scene: CompositeScene = {
      width: 720, height: 1280, fps: 30, background: '#000',
      overlays: [{ kind: 'sticker', id: 's', text: 'x', atSec: 8, durationSec: 2, order: 1 }],
    };
    expect(compositeDurationSec(scene)).toBe(10);
    expect(compositeDurationSec(scene, 33.5)).toBe(33.5);
    expect(compositeDurationSec({ ...scene, overlays: [] })).toBe(3); // min program
  });

  it('zero-generation scene: captions + title alone make a full program', () => {
    const sp = screen([{ id: 'd1', type: 'DIALOGUE', content: 'Buy it now today' }]);
    const cues = projectCaptionCues(buildTimeline(sp));
    const scene: CompositeScene = {
      width: 1080, height: 1920, fps: 30, background: '#09090B',
      overlays: [
        { kind: 'caption', cues, style: DEFAULT_CAPTION_STYLE, order: 70 },
        { kind: 'title', text: 'HYPIT', placement: 'top', color: '#fff', size: 80, order: 90 },
      ],
    };
    expect(compositeDurationSec(scene)).toBeGreaterThan(0.3);
    const plan = compositeSceneAt(scene, cues[0].start + 0.01);
    expect(plan.caption).toBeDefined();
    expect(plan.title?.text).toBe('HYPIT');
  });
});
