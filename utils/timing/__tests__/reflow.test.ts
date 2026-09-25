/**
 * P2a reflow — white-model shot lengths hang on word spans.
 * Acceptance targets: 白模段时值自动伸缩(1) and 同几何不同词数坐标逐点一致(5).
 */
import { describe, expect, it } from 'vitest';
import type { GrayboxCamera, GrayboxData, Screenplay, ScriptBlock } from '../../../types';
import { planVideoSegments } from '../../videoPlan';
import { applyReflow, shotSpanForBlock, videoPlanWindowsFromScreenplay } from '../reflow';
import { buildTimeline } from '../timeline';

const block = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

const camera = (duration: number): GrayboxCamera => ({
  shotType: 'medium',
  shotDescription: 'hold on her face',
  position: [0, 1.6, 3],
  lookAt: [0, 1.2, 0],
  movement: {
    type: 'dolly',
    duration,
    targetSeconds: duration,
    path: [[0, 0, 0], [0.5, 0, -1], [1, 0, -2]] as [number, number, number][],
    lookPath: [[0, 1.2, 0], [0, 1.1, 0]] as [number, number, number][],
  },
  focus: 'ADA',
});

const shot = (duration: number): GrayboxData => ({ kind: 'shot', camera: camera(duration) });

const screen = (blocks: ScriptBlock[], segmentGrayboxes?: Screenplay['segmentGrayboxes']): Screenplay => ({
  id: 'sp_r',
  metadata: { title: 'T', author: 'A', draft: '1', scriptLanguage: 'en' },
  blocks,
  lastModified: 0,
  segmentGrayboxes,
});

describe('applyReflow', () => {
  it('retimes shot durations to word spans and keeps geometry identical point-by-point (acceptance 5)', () => {
    const shortLine = screen([
      { ...block('d1', 'DIALOGUE', 'Hi.'), graybox: shot(2) },
    ]);
    const longLine = screen([
      { ...block('d1', 'DIALOGUE', 'Hi there my dear friend, absolutely wonderful to see you again.'), graybox: shot(2) },
    ]);

    const rShort = applyReflow(shortLine);
    const rLong = applyReflow(longLine);
    const camShort = rShort.blocks[0].graybox!.camera!;
    const camLong = rLong.blocks[0].graybox!.camera!;

    // same geometry, different words → coordinates identical, lengths differ
    expect(camLong.movement.path).toEqual(camShort.movement.path);
    expect(camLong.movement.lookPath).toEqual(camShort.movement.lookPath);
    expect(camLong.shotType).toBe(camShort.shotType);
    expect(camLong.movement.type).toBe(camShort.movement.type);
    expect(camLong.movement.duration).not.toBe(camShort.movement.duration);
    expect(camLong.movement.duration).toBeGreaterThan(camShort.movement.duration);
  });

  it('a beat\'s dialogue rides the action shot; a cutaway camera starts a new span', () => {
    const sp = screen([
      { ...block('a1', 'ACTION', 'She enters and sits down slowly.'), graybox: shot(3) },
      block('ch', 'CHARACTER', 'ADA'),
      { ...block('d1', 'DIALOGUE', 'Hello everyone.'), graybox: shot(1) },
    ]);
    const tl = buildTimeline(sp);
    const actionSpan = shotSpanForBlock(tl, sp, 'a1');
    const lineSpan = shotSpanForBlock(tl, sp, 'd1');
    // action shot covers action + CHARACTER (stops before the cutaway's camera)
    expect(actionSpan).toBeGreaterThan(lineSpan);
    const r = applyReflow(sp);
    const actionCam = r.blocks[0].graybox!.camera!;
    const lineCam = r.blocks[2].graybox!.camera!;
    expect(actionCam.movement.duration).toBeGreaterThan(lineCam.movement.duration);
  });

  it('segment grayboxes span consecutive beat groups and retime with the words (acceptance 1)', () => {
    const mk = (dlg: string): Screenplay => screen([
      block('sc', 'SCENE_HEADING', 'INT. LAB - NIGHT'),
      block('a1', 'ACTION', 'The machine hums.'),
      block('d1', 'DIALOGUE', 'It works!'),
      block('a2', 'ACTION', 'Sparks fly.'),
      block('d2', 'DIALOGUE', dlg),
    ], { a1: shot(5) });

    const rShort = applyReflow(mk('No!'));
    const rLong = applyReflow(mk('No, no, no — shut the whole thing down right now!'));
    const camShort = rShort.segmentGrayboxes!.a1.camera!;
    const camLong = rLong.segmentGrayboxes!.a1.camera!;
    expect(camLong.movement.duration).toBeGreaterThan(camShort.movement.duration);
    expect(camLong.movement.path).toEqual(camShort.movement.path);
  });

  it('is idempotent and returns the same reference when nothing changes', () => {
    const sp = screen([{ ...block('d1', 'DIALOGUE', 'Hi.'), graybox: shot(2) }]);
    const once = applyReflow(sp);
    expect(applyReflow(once)).toBe(once);
    expect(once).not.toBe(sp); // first pass did retime
  });
});

describe('videoPlan integration (words as the plan input)', () => {
  it('estimated beats open windows and grow with dialogue; the second-prefix path stays intact (acceptance 4)', () => {
    const mk = (dlg: string): ScriptBlock[] => [
      block('sc', 'SCENE_HEADING', 'INT. LAB - NIGHT'),
      block('a1', 'ACTION', 'The machine hums quietly.'),
      block('ch', 'CHARACTER', 'ADA'),
      block('d1', 'DIALOGUE', dlg),
    ];
    const spShort = screen(mk('It works!'));
    const spLong = screen(mk('It works, it really truly works after all this time!'));

    const planShort = planVideoSegments(spShort.blocks, 15, videoPlanWindowsFromScreenplay(spShort));
    const planLong = planVideoSegments(spLong.blocks, 15, videoPlanWindowsFromScreenplay(spLong));

    expect(planShort.untimedBeats).toBe(0); // the "时长未知" gap is closed
    expect(planShort.warnings.some(w => w.includes('词级估算'))).toBe(true);
    expect(planLong.segments[0].endTime).toBeGreaterThan(planShort.segments[0].endTime);

    // degraded path: no windows → original second-prefix behavior
    const plain = planVideoSegments(spShort.blocks, 15);
    expect(plain.untimedBeats).toBeGreaterThan(0);
  });

  it('authored prefixes stay authoritative inside the plan', () => {
    const sp = screen([
      block('sc', 'SCENE_HEADING', 'INT. CAFE - DAY'),
      block('a1', 'ACTION', '00:00-00:05。She enters and sits.'),
      block('ch', 'CHARACTER', 'ALICE'),
      block('d1', 'DIALOGUE', 'A rather long line that would take much longer than five seconds to say out loud properly.'),
    ]);
    const plan = planVideoSegments(sp.blocks, 15, videoPlanWindowsFromScreenplay(sp));
    const beat = plan.segments[0].beats[0];
    expect(beat.source).toBe('authored');
    expect(beat.start).toBe(0);
    expect(beat.end).toBeLessThanOrEqual(5);
  });
});
