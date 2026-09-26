import { describe, it, expect } from 'vitest';

import type { Screenplay, ScriptBlock } from '../types';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { validateStoryFlowIR } from '../src/ir/schema';
import { compileVisualPlan } from '../src/ir/visual/compile';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { compileCaptions } from '../src/captions/compile';
import { toSrt, toVtt } from '../src/captions/serialize';
import { screenplayToJSON } from '../utils/exportData';
import { DEFAULT_EXPORT_OPTIONS } from '../utils/exportData';
import { deriveShotList, dialoguesWithoutSpeaker } from '../utils/shotList';

/**
 * IR 管线全链接管测试(StoryFlow 派单,LLM 生成步除外)—— 5 剧本矩阵:
 * 每本跑 extractStoryFlowIR → 三路编译(视觉/音频/字幕)→ 序列化
 * (SRT/VTT/IR JSON/剧本 JSON),断言拍数合理性、全对白覆盖、estimated
 * 标注、警告诚实、schemaVersion 3、角色 ref。真实 LLM 生成(生图/生视频/
 * TTS 花费调用)一律不在本套件内。
 */

const sp = (id: string, title: string, blocks: ScriptBlock[], over: Partial<Screenplay> = {}): Screenplay => ({
  id,
  metadata: { title, author: 'agent', draft: 'First Draft', scriptLanguage: 'zh' },
  blocks,
  schemaVersion: 3,
  lastModified: 0,
  ...over,
});

const b = (id: string, type: ScriptBlock['type'], content: string, extra: Partial<ScriptBlock> = {}): ScriptBlock =>
  ({ id, type, content, ...extra });

interface MatrixResult {
  ir: ReturnType<typeof extractStoryFlowIR>;
  visual: ReturnType<typeof compileVisualPlan>;
  audio: ReturnType<typeof compileAudioPlan>;
  captions: ReturnType<typeof compileCaptions>;
  srt: string;
  vtt: string;
  screenplayJson: { schemaVersion?: number };
  irJson: object;
}

const runPipeline = (screenplay: Screenplay): MatrixResult => {
  const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });
  const visual = compileVisualPlan(ir);
  const audio = compileAudioPlan(ir);
  const captions = compileCaptions(ir);
  const srt = toSrt(captions);
  const vtt = toVtt(captions);
  const screenplayJson = JSON.parse(screenplayToJSON(screenplay, DEFAULT_EXPORT_OPTIONS)) as { schemaVersion?: number };
  const irJson = JSON.parse(JSON.stringify(ir)) as object;
  return { ir, visual, audio, captions, srt, vtt, screenplayJson, irJson };
};

const ttsLines = (r: MatrixResult): string[] =>
  r.ir.audio.filter(c => c.kind === 'tts').map(c => c.text);

const validateOk = (r: MatrixResult, label: string): void => {
  const v = validateStoryFlowIR(r.ir);
  if (!v.ok) throw new Error(`${label}: IR 未过 schema —— ${(v as { issues: string[] }).issues.join('; ')}`);
};

// ── A. 带时间戳前缀的 AI 风格剧本 ──────────────────────────────────────────

const scriptA = (): Screenplay => sp('mtx-a', '矩阵A·AI风格', [
  b('a0', 'SCENE_HEADING', '内. 茶馆 - 夜'),
  b('a1', 'ACTION', '00:00-00:04。刀客推门而入，雨声灌进屋'),
  b('a2', 'CHARACTER', '刀客'),
  b('a3', 'DIALOGUE', '你的刀很快。', { speaker: '刀客' }),
  b('a4', 'ACTION', '00:05-00:08。掌柜斟酒，烛火摇曳'),
  b('a5', 'DIALOGUE', '这杯我请。', { speaker: '掌柜' }),
  b('a6', 'SCENE_HEADING', '外. 码头 - 夜'),
  b('a7', 'ACTION', '00:09-00:12。刀客登船，消失在雨幕里'),
]);

// ── B. 手写无时间戳(#11 多拍合成) ──────────────────────────────────────────

const scriptB = (): Screenplay => sp('mtx-b', '矩阵B·手写', [
  b('b0', 'SCENE_HEADING', '内. 老照相馆 - 黄昏'),
  b('b1', 'ACTION', '夕阳穿过橱窗，尘埃在光柱里浮动。'),
  b('b2', 'CHARACTER', '陆之白'),
  b('b3', 'DIALOGUE', '今天不营业。'),
  b('b4', 'ACTION', '他把相纸一张张摆上晾架。'),
  b('b5', 'DIALOGUE', '相纸要阴干。'),
  b('b6', 'DIALOGUE', '客人来了就说歇业。'),
]);

// ── D. 多场景长剧本(转场覆盖) ─────────────────────────────────────────────

const scriptD = (): Screenplay => sp('mtx-d', '矩阵D·多场景', [
  b('d0', 'SCENE_HEADING', '内. 茶馆 - 夜'),
  b('d1', 'ACTION', '00:00-00:03。刀客推门而入'),
  b('d2', 'CHARACTER', '刀客'),
  b('d3', 'DIALOGUE', '一杯烈酒。', { speaker: '刀客' }),
  b('d4', 'ACTION', '00:04-00:07。掌柜递酒，两人对视'),
  b('d5', 'SCENE_HEADING', '外. 码头 - 雨'),
  b('d6', 'ACTION', '00:08-00:11。刀客快步穿过雨幕'),
  b('d7', 'ACTION', '00:12-00:14。跳上船头，回望茶馆'),
  b('d8', 'SCENE_HEADING', '内. 船舱 - 夜'),
  b('d9', 'ACTION', '00:15-00:18。刀客擦刀，火把摇曳'),
  b('d10', 'DIALOGUE', '下一站，渡口。', { speaker: '刀客' }),
]);

// ── E. zh/dual 双语 ───────────────────────────────────────────────────────

const scriptE = (): Screenplay => sp('mtx-e', '矩阵E·双语', [
  b('e0', 'SCENE_HEADING', 'INT. PHOTO STUDIO - DUSK'),
  b('e1', 'ACTION', '00:00-00:03。Dust floats in the window light.'),
  b('e2', 'CHARACTER', 'LU ZHIBAI'),
  b('e3', 'DIALOGUE', 'We are closed today.'),
  b('e4', 'ACTION', '00:04-00:06。He lays the photo papers out.'),
]);

describe('IR 管线矩阵 · A 带时间戳 AI 风格剧本', () => {
  const r = runPipeline(scriptA());

  it('authored 拍数与时长(不误标 estimated)', () => {
    validateOk(r, 'A');
    expect(r.ir.shots.length).toBe(3);
    expect(r.ir.shots.every(s => s.estimated !== true)).toBe(true);
    expect(r.ir.shots.map(s => s.shotDuration)).toEqual([4, 3, 3]);
  });

  it('全对白进 TTS 与字幕;音频编译有 TTS jobs', () => {
    expect(ttsLines(r)).toEqual(['你的刀很快。', '这杯我请。']);
    const texts = r.captions.captions.map(c => c.text).join('\n');
    expect(texts).toContain('你的刀很快');
    expect(texts).toContain('这杯我请');
    expect(r.audio.jobs.filter(j => j.kind === 'tts')).toHaveLength(2);
  });

  it('序列化:SRT/VTT/IR JSON/schemaVersion 3/角色 ref', () => {
    validateOk(r, 'A-serialize');
    expect(r.srt).toContain('-->');
    expect(r.vtt.startsWith('WEBVTT')).toBe(true);
    expect(() => toVtt(r.captions)).not.toThrow();
    expect(r.screenplayJson.schemaVersion).toBeGreaterThanOrEqual(3);
    expect(r.irJson).toBeTruthy();
    expect(r.ir.refs.characters.map(c => c.name)).toContain('刀客');
  });
});

describe('IR 管线矩阵 · B 手写无时间戳(回退)', () => {
  const r = runPipeline(scriptB());

  it('多拍合成(≥3)+ 逐拍 estimated', () => {
    validateOk(r, 'B');
    expect(r.ir.shots.length).toBeGreaterThanOrEqual(3);
    expect(r.ir.shots.every(s => s.estimated === true)).toBe(true);
    expect(r.ir.shots.every(s => s.shotDuration >= 1 && s.shotDuration <= 10)).toBe(true);
  });

  it('三句对白全进 TTS 与字幕', () => {
    const lines = ttsLines(r);
    for (const t of ['今天不营业', '相纸要阴干', '客人来了就说歇业']) {
      expect(lines.some(l => l.includes(t))).toBe(true);
      expect(r.captions.captions.some(c => c.text.includes(t))).toBe(true);
    }
  });

  it('拍长钳制 + SRT 无巨条', () => {
    for (const s of r.ir.shots) expect(s.shotDuration).toBeLessThanOrEqual(10);
    for (const c of r.captions.captions) expect(c.endMs - c.startMs).toBeLessThanOrEqual(10_500);
  });
});

describe('IR 管线矩阵 · C 空剧本(可解释空转)', () => {
  const r = runPipeline(sp('mtx-c', '矩阵C·空', []));

  it('零镜头不崩:三路编译全空、schema 校验通过、序列化可用', () => {
    validateOk(r, 'C');
    expect(r.ir.shots).toHaveLength(0);
    expect(r.visual.shots).toHaveLength(0);
    expect(r.audio.jobs).toHaveLength(0);
    expect(r.captions.captions).toHaveLength(0);
    expect(r.srt).toBe('');
    expect(() => JSON.stringify(r.irJson)).not.toThrow();
    expect(r.screenplayJson.schemaVersion).toBeGreaterThanOrEqual(3);
  });

  it('警告诚实:空剧本无捏造内容', () => {
    expect(r.ir.audio).toHaveLength(0);
    expect(r.ir.transitions).toHaveLength(0);
  });
});

describe('IR 管线矩阵 · D 多场景长剧本(转场覆盖)', () => {
  const r = runPipeline(scriptD());

  it('转场数 = 场景切换数;拍跨三场景', () => {
    validateOk(r, 'D');
    expect(r.ir.shots.length).toBeGreaterThanOrEqual(5);
    expect(r.ir.transitions.length).toBe(2); // 三场景 → 2 个 cut
    expect(r.ir.transitions.map(t => t.type)).toEqual(['cut', 'cut']);
  });

  it('角色 ref 跨场景复用同一 identity;对白进 TTS/SRT', () => {
    expect(r.ir.refs.characters.map(c => c.name)).toContain('刀客');
    expect(ttsLines(r).join()).toContain('一杯烈酒');
    expect(r.captions.captions.some(c => c.text.includes('下一站'))).toBe(true);
  });

  it('SRT 时间单调递增(时基闭合)', () => {
    const caps = r.captions.captions;
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i].startMs).toBeGreaterThanOrEqual(caps[i - 1].startMs);
    }
  });
});

describe('IR 管线矩阵 · E zh/dual 双语', () => {
  const r = runPipeline({ ...scriptE(), metadata: { ...scriptE().metadata, scriptLanguage: 'dual' } });

  it('英文台词照常提取进 TTS 与字幕(双语不崩)', () => {
    validateOk(r, 'E');
    expect(r.ir.shots.length).toBeGreaterThanOrEqual(2);
    expect(ttsLines(r).join()).toContain('We are closed today');
    expect(r.captions.captions.some(c => c.text.includes('We are closed'))).toBe(true);
  });

  it('序列化闭合', () => {
    expect(r.srt).toContain('-->');
    expect(r.screenplayJson.schemaVersion).toBeGreaterThanOrEqual(3);
  });
});

// ── graybox 与分镜产物 → IR 提取消费 ────────────────────────────────────────

describe('graybox 与分镜产物被 IR 提取正确消费', () => {
  it('shot graybox 运镜 → Shot.camera;scene graybox → spatial + 空镜消费', () => {
    const screenplay = sp('gb-1', 'graybox 消费', [
      {
        id: 'g0', type: 'SCENE_HEADING', content: '内. 茶馆 - 夜',
        graybox: {
          kind: 'scene',
          layout: [
            { id: 'floor', type: 'plane', role: 'floor', position: [0, 0, 0], size: [6, 0.1, 6], color: '#999999' },
            { id: 'table', type: 'box', role: 'prop', label: '桌子', position: [0, 0.5, 0], size: [1, 0.1, 1], color: '#8a6a4a' },
          ],
          characters: [{ name: '刀客', position: [1, 0, 1], facing: 45 }],
        },
      } as unknown as ScriptBlock,
      {
        id: 'g1', type: 'ACTION', content: '00:00-00:04。刀客推门而入',
        graybox: {
          kind: 'shot',
          camera: {
            shotType: 'wide',
            position: [0, 1.6, 4],
            lookAt: [0, 1.2, 0],
            movement: { type: 'pan', duration: 4, path: [[0, 1.6, 4]], lookPath: [[0, 1.2, 0]] },
            shotDescription: '门口视角推入',
            focus: '刀客',
          },
        },
      } as unknown as ScriptBlock,
      b('g2', 'ACTION', '00:05-00:08。掌柜斟酒'),
    ]);
    const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });
    // 运镜直通 Shot.camera
    const shot1 = ir.shots.find(s => s.id === 'SHOT_001')!;
    expect(shot1.camera).toBeTruthy();
    expect(shot1.camera!.position).toEqual([0, 1.6, 4]);
    expect(shot1.camera!.movement.type).toBe('pan');
    // spatial:场景布局 1:1
    expect(ir.spatial.length).toBe(1);
    expect(ir.spatial[0].objects.some(o => o.id === 'table')).toBe(true);
    expect(ir.spatial[0].characters.some(c => c.name === '刀客')).toBe(true);
  });

  it('deriveShotList 分镜消费:同稿的镜头清单与 IR 提取口径一致', () => {
    const screenplay = scriptA();
    // AI 风格稿补 imagePrompt(分镜行按 imagePrompt 列)
    screenplay.blocks = screenplay.blocks.map(bl =>
      bl.type === 'ACTION' || bl.type === 'CHARACTER' || bl.type === 'SCENE_HEADING'
        ? { ...bl, imagePrompt: `shot of ${bl.id}` }
        : bl,
    );
    const list = deriveShotList(screenplay, [], { characters: {} });
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every(e => e.blockIds.length > 0 && e.motionPrompt.length > 0)).toBe(true);
    // speaker 校验清单:对白都有说话人
    expect(dialoguesWithoutSpeaker(screenplay.blocks).length).toBe(0);
  });
});
