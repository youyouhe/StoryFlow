import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateStoryFlowIR } from '../src/ir/schema';
import type { TtsClip, SfxClip } from '../src/ir/types';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { splitAnchorWords } from '../src/ir/shared';
import { PREFIX, fixture } from './fixtures/silverDawnScreenplay';

const goldenPath = fileURLToPath(new URL('../docs/storyflow-ir-extracted-example.json', import.meta.url));

const extract = () => {
  const { screenplay, refImages } = fixture();
  return extractStoryFlowIR(screenplay, refImages, { targetSeconds: 6 });
};

describe('extractStoryFlowIR — 生产侧闭合(银盐晨光 Screenplay 形态)', () => {
  it('产出过 validateStoryFlowIR(全链可达的总验收)', () => {
    const ir = extract();
    const v = validateStoryFlowIR(ir);
    if (!v.ok) throw new Error(`extracted IR must validate:\n${(v as { issues: string[] }).issues.join('\n')}`);
    expect(ir.title).toBe('银盐晨光');
    expect(ir.mode).toBe('pro');
    expect(ir.version).toBe('0.3.0'); // IR_VERSION(P12 升版)
  });

  it('5 镜推导:编号/时长/motion 去前缀/对白+ttsFloor=ceil(measured+0.3)', () => {
    const ir = extract();
    expect(ir.shots.map(s => s.id)).toEqual(['SHOT_001', 'SHOT_002', 'SHOT_003', 'SHOT_004', 'SHOT_005']);
    expect(ir.shots.map(s => s.shotDuration)).toEqual([6, 5, 6, 5, 4]);
    expect(ir.shots[0].motionPrompt).toBe('镜头极缓慢前推,光柱中尘埃缓缓漂浮,样片墙高光微微呼吸;画面内无人物');
    expect(ir.shots[0].motionPrompt.startsWith('00:00')).toBe(false);
    expect(ir.shots[2].character).toBe('陈默');
    expect(ir.shots[2].dialogue).toEqual({ text: '拍一张证件照,要赶九点的火车。', ttsFloor: 4 }); // ceil(3.4+0.3)
    expect(ir.shots[3].character).toBe('苏晚'); // base 名(对白 cue 带变体)
    expect(ir.shots[3].dialogue).toEqual({ text: '好,坐那边,光正好。', ttsFloor: 3 }); // ceil(2.6+0.3)
  });

  it('词锚反演:shutter at 3.742s → wordIndex 29(② 正向的逆,双向闭环)', () => {
    const ir = extract();
    const shutter = ir.audio.find(c => c.id === 'aud-sfx-002') as SfxClip;
    expect(shutter.name).toBe('shutter');
    expect(shutter.missing).toBe(true);
    expect(shutter.anchor).toEqual({ kind: 'word', wordIndex: 29 });
    // 正向闭环:29/31 × wantSeconds 4s = 3742ms
    const tokens = splitAnchorWords(ir.shots[4].motionPrompt);
    expect(tokens).toHaveLength(31);
    const ding = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
    expect(ding.anchor).toEqual({ kind: 'shot-start' });
    expect(ding.shotId).toBe('SHOT_003');
  });

  it('refs:主/变体/配角 + 场景 + spatial 链接;变体来自对白 cue', () => {
    const ir = extract();
    const ids = ir.refs.characters.map(c => c.id).sort();
    expect(ids).toEqual(['char:苏晚', 'char:苏晚:晨雾围巾', 'char:陈默']);
    const variant = ir.refs.characters.find(c => c.id === 'char:苏晚:晨雾围巾')!;
    expect(variant.variant).toBe('晨雾围巾');
    expect(variant.description).toContain('围巾'); // sourcePrompt 回退
    expect(ir.refs.scenes[0].id).toBe('scene:国营照相馆');
    expect(ir.refs.scenes[0].spatialId).toBe('spatial:国营照相馆');
    expect(ir.shots[3].refBindings).toContain('char:苏晚:晨雾围巾');
    expect(ir.shots[0].refBindings).toEqual(['scene:国营照相馆']);
  });

  it('spatial 1:1 + camera 提取 + transitions + bgm 按 prompt 去重跨镜', () => {
    const ir = extract();
    expect(ir.spatial).toHaveLength(1);
    expect(ir.spatial[0].objects.map(o => o.id)).toEqual(['counter', 'window_display']);
    expect(ir.spatial[0].characters[0].facing).toBe(1.57);
    expect(ir.shots[2].camera?.shotType).toBe('medium');
    expect(ir.shots[2].camera?.description).toContain('定场双人');
    expect(ir.shots[2].camera?.focus).toBe('陈默');

    expect(ir.transitions).toEqual([
      { id: 'tr-001', type: 'dissolve', from: 'SHOT_004', target: 'SHOT_005' },
      { id: 'tr-002', type: 'fade-out', target: 'SHOT_005' },
    ]);

    const bgm = ir.audio.filter(c => c.kind === 'bgm');
    expect(bgm).toHaveLength(1); // 5 段同 prompt → 1 条床
    expect(bgm[0].kind === 'bgm' && bgm[0].fromShotId).toBe('SHOT_001');
    expect(bgm[0].kind === 'bgm' && bgm[0].toShotId).toBe('SHOT_005');
  });

  it('治愈与映射:缺前缀补齐 / simple→express / 多句台词→非锚 TtsClip', () => {
    const { screenplay, refImages } = fixture();
    screenplay.blocks[1].imagePrompt = 'legacy prompt without prefix'; // 缺风格前缀
    screenplay.productionMode = 'simple';
    screenplay.blocks.splice(6, 0,
      { id: 'b5b', type: 'CHARACTER', content: '陈默' },
      { id: 'b6b', type: 'DIALOGUE', content: '再拍一张一寸的。' },
    );
    screenplay.proAudio!.b4!.tts!.push({
      line: '再拍一张一寸的。', charName: '陈默', voice: 'jam', url: 'tts://3', seconds: 2.0,
    });
    const ir = extractStoryFlowIR(screenplay, refImages, { targetSeconds: 6 });

    expect(ir.shots[0].imagePrompt.startsWith(PREFIX)).toBe(true); // 治愈
    expect(ir.mode).toBe('express');
    const extras = ir.audio.filter((c): c is TtsClip => c.kind === 'tts');
    expect(extras.map(t => t.text)).toEqual([
      '拍一张证件照,要赶九点的火车。', '再拍一张一寸的。', '好,坐那边,光正好。',
    ]);
    // 首句 = 锚对白;次句 = 同镜头非锚行
    expect(ir.shots[2].dialogue?.text).toBe('拍一张证件照,要赶九点的火车。');
    expect(extras[1].shotId).toBe('SHOT_003');
  });

  it('status:expressShots 映射 generated/locked/draft', () => {
    const ir = extract();
    expect(ir.shots.map(s => s.status)).toEqual(['generated', 'locked', 'draft', 'draft', 'draft']);
  });

  it('golden: docs/storyflow-ir-extracted-example.json 锁定提取产物', () => {
    const golden = readFileSync(goldenPath, 'utf8').replace(/\n$/, '');
    expect(JSON.stringify(extract(), null, 2)).toBe(golden);
  });
});
