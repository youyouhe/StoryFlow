import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseStoryFlowIR,
  validateStoryFlowIR,
  storyFlowIRSchema,
} from '../src/ir/schema';
import type { StoryFlowIR } from '../src/ir/types';
import { IR_VERSION } from '../src/ir/types';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));

/** A minimal-but-valid express-mode doc factories mutate in each test. */
const minimalIR = (): StoryFlowIR => ({
  version: IR_VERSION,
  mode: 'express',
  title: '最小可编译文档',
  style: { name: '素片', artStyle: '写实', scenePreset: '现代都市', promptPrefix: '' },
  refs: { characters: [], props: [], scenes: [], styles: [] },
  shots: [{
    id: 'SHOT_001',
    sequence: 1,
    imagePrompt: 'empty street at dawn',
    motionPrompt: '固定机位,画面内无人',
    shotDuration: 5,
    firstFrame: { description: '空街黎明' },
    refBindings: [],
    status: 'draft',
  }],
  audio: [],
  transitions: [],
  spatial: [],
});

const broken = (mutate: (ir: StoryFlowIR) => void): string[] => {
  const ir = minimalIR();
  mutate(ir);
  const r = validateStoryFlowIR(ir);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('expected invalid');
  // 本仓库 root tsconfig 不开 strictNullChecks —— 布尔判别联合在该配置下
  // 不窄化(与 useH3VideoPlan.ts 里 'error' in 窄化注释同一族怪癖),
  // 运行时已由上面的 throw 保证 r 是 { ok: false } 分支。
  return (r as { issues: string[] }).issues;
};

describe('《银盐晨光》example document', () => {
  const raw: unknown = JSON.parse(readFileSync(examplePath, 'utf-8'));

  it('validates against the schema', () => {
    const r = validateStoryFlowIR(raw);
    if (!r.ok) throw new Error(`example must validate:\n${(r as { issues: string[] }).issues.join('\n')}`);
    expect(r.ok).toBe(true);
  });

  it('carries the locked top-level contract', () => {
    const ir = parseStoryFlowIR(raw);
    expect(ir.version).toBe('0.1.0');
    expect(ir.mode).toBe('pro');
    expect(ir.title).toBe('银盐晨光');
    expect(ir.style.promptPrefix.length).toBeGreaterThan(0);
  });

  it('shots are numbered, ordered and cover the full lifecycle', () => {
    const ir = parseStoryFlowIR(raw);
    expect(ir.shots.map(s => s.id)).toEqual(['SHOT_001', 'SHOT_002', 'SHOT_003', 'SHOT_004', 'SHOT_005']);
    expect(ir.shots.map(s => s.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(ir.shots.map(s => s.status))).toEqual(new Set(['draft', 'generated', 'locked', 'exported']));
  });

  it('every imagePrompt carries the style anchor prefix', () => {
    const ir = parseStoryFlowIR(raw);
    for (const s of ir.shots) expect(s.imagePrompt.startsWith(ir.style.promptPrefix)).toBe(true);
  });

  it('dialogue shots keep speaker + TTS floor below the shot length', () => {
    const ir = parseStoryFlowIR(raw);
    const spoken = ir.shots.filter(s => s.dialogue);
    expect(spoken.map(s => s.character)).toEqual(['陈默', '苏晚']);
    for (const s of spoken) expect(s.dialogue!.ttsFloor).toBeLessThanOrEqual(s.shotDuration);
  });

  it('binds the five ref categories and the scene spatial anchor', () => {
    const ir = parseStoryFlowIR(raw);
    expect(ir.refs.characters).toHaveLength(3);          // 主 + 变体 + 第二角色
    expect(ir.refs.characters[1]!.variant).toBe('晨雾围巾');
    expect(ir.refs.props[0]!.id).toBe('prop:海鸥相机');
    expect(ir.refs.scenes[0]!.spatialId).toBe('spatial:照相馆');
    expect(ir.spatial).toHaveLength(1);
    expect(ir.spatial[0]!.characters.map(c => c.name)).toEqual(['苏晚', '陈默']);
  });

  it('audio clips cover all three tracks, one SFX missing (SFX_MISSING)', () => {
    const ir = parseStoryFlowIR(raw);
    expect(ir.audio.filter(c => c.kind === 'tts')).toHaveLength(2);
    expect(ir.audio.filter(c => c.kind === 'bgm')).toHaveLength(1);
    const sfx = ir.audio.filter(c => c.kind === 'sfx');
    expect(sfx).toHaveLength(2);
    expect(sfx.some(c => c.kind === 'sfx' && c.missing === true)).toBe(true);
    expect(sfx.some(c => c.kind === 'sfx' && c.anchor.kind === 'word')).toBe(true);
  });

  it('generation stays backend-agnostic — vendor bags are primitives only', () => {
    const ir = parseStoryFlowIR(raw);
    const backends = new Set(ir.shots.map(s => s.generation?.backend).filter(Boolean));
    expect(backends).toEqual(new Set(['comfyui', 'minimax', 'grok']));
  });
});

describe('minimal document', () => {
  it('accepts a bare express-mode doc and parses to StoryFlowIR', () => {
    const ir: StoryFlowIR = parseStoryFlowIR(minimalIR());
    expect(ir.shots).toHaveLength(1);
    expect(validateStoryFlowIR(ir).ok).toBe(true);
  });

  it('round-trips through JSON without loss', () => {
    const ir = minimalIR();
    expect(storyFlowIRSchema.parse(JSON.parse(JSON.stringify(ir)))).toBeTruthy();
  });
});

describe('rejects contract violations', () => {
  it('wrong schema version', () => {
    expect(broken(ir => { ir.version = '9.9.9' as typeof ir.version; })[0]).toMatch(/version/);
  });

  it('unknown top-level key (strict object)', () => {
    expect(broken(ir => { (ir as unknown as Record<string, unknown>).extra = 1; }).join('\n'))
      .toMatch(/无法识别|unrecognized|Invalid/i);
  });

  it('malformed shot id', () => {
    expect(broken(ir => { ir.shots[0]!.id = 'shot1'; })[0]).toMatch(/SHOT_/);
  });

  it('duplicate shot id', () => {
    expect(broken(ir => {
      ir.shots.push({ ...ir.shots[0]!, id: 'SHOT_002', sequence: 2 });
      ir.shots.push({ ...ir.shots[0]!, id: 'SHOT_002', sequence: 3 });
    }).join('\n')).toMatch(/镜头 id 重复/);
  });

  it('sequence gap', () => {
    expect(broken(ir => { ir.shots[0]!.sequence = 2; })[0]).toMatch(/sequence 不连续/);
  });

  it('dialogue without a speaker', () => {
    expect(broken(ir => { ir.shots[0]!.dialogue = { text: '谁在说话?', ttsFloor: 1 }; })[0])
      .toMatch(/character/);
  });

  it('imagePrompt missing the style prefix', () => {
    expect(broken(ir => {
      ir.style.promptPrefix = 'film look, ';
      ir.shots[0]!.imagePrompt = 'dawn street'; // 前缀丢失
    })[0]).toMatch(/promptPrefix/);
  });

  it('refBindings pointing outside the registry', () => {
    expect(broken(ir => { ir.shots[0]!.refBindings = ['char:路人']; })[0]).toMatch(/char:路人/);
  });

  it('audio clip bound to a nonexistent shot', () => {
    expect(broken(ir => {
      ir.audio.push({
        id: 'aud-tts-001', kind: 'tts', shotId: 'SHOT_404',
        text: '无人生还', voice: 'tongtong',
      });
    })[0]).toMatch(/SHOT_404/);
  });

  it('transition targeting a nonexistent shot', () => {
    expect(broken(ir => {
      ir.transitions.push({ id: 'tr-001', type: 'cut', target: 'SHOT_404' });
    })[0]).toMatch(/SHOT_404/);
  });

  it('scene ref pointing at a missing spatial layout', () => {
    expect(broken(ir => {
      ir.refs.scenes.push({
        id: 'scene:外景', name: '外景', description: '空街',
        spatialId: 'spatial:外景',
      });
      ir.spatial.push({ id: 'spatial:别的场景', sceneHeading: 'EXT. 别处 - 日', objects: [], characters: [] });
      ir.shots[0]!.refBindings = ['scene:外景'];
    })[0]).toMatch(/spatial:外景/);
  });

  it('unknown generation backend', () => {
    expect(broken(ir => {
      ir.shots[0]!.generation = { backend: 'veo' as never, steps: 1 };
    }).join('\n')).toMatch(/comfyui|invalid|enum/i);
  });

  it('negative word anchor', () => {
    expect(broken(ir => {
      ir.audio.push({
        id: 'aud-sfx-001', kind: 'sfx', shotId: 'SHOT_001', name: 'ding',
        anchor: { kind: 'word', wordIndex: -1 },
      });
    }).join('\n')).toMatch(/anchor/);
  });

  it('duplicate ref id across registry categories', () => {
    expect(broken(ir => {
      ir.refs.characters.push({ id: 'char:古镜', name: '古镜', description: '一把有灵性的镜子' });
      ir.refs.props.push({ id: 'char:古镜', name: '古镜', description: '同 id 撞车' });
    }).join('\n')).toMatch(/跨类别重复/);
  });

  it('character variant id must follow char:name:variant', () => {
    expect(broken(ir => {
      ir.refs.characters.push({
        id: 'char:林枫', name: '林枫', variant: '战损', description: '受伤状态',
      });
    })[0]).toMatch(/char:林枫:战损/);
  });

  it('vendor params must stay primitive (backend-agnostic principle)', () => {
    expect(broken(ir => {
      ir.shots[0]!.generation = {
        backend: 'comfyui',
        steps: 20,
        vendor: { workflow: { nested: true } } as never,
      };
    }).join('\n')).toMatch(/vendor|expected|object/i);
  });
});
