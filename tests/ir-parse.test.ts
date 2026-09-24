import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, SfxClip, TtsClip, Shot } from '../src/ir/types';
import { parseStoryFlowIR, validateStoryFlowIR } from '../src/ir/schema';
import { renderStoryFlowXML } from '../src/ir/format/render';
import { parseStoryFlowXML } from '../src/ir/format/parse';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const goldenPath = fileURLToPath(new URL('../docs/storyflow-xml-example.xml', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const golden = (): string => readFileSync(goldenPath, 'utf8').replace(/\n$/, '');

const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

describe('双固定点 golden round-trip(P7 核心门禁)', () => {
  it('parse(render(ir)) ≡ 原 IR(银盐晨光)', () => {
    const ir = example();
    const back = parseStoryFlowXML(renderStoryFlowXML(ir, { pretty: true }));
    expect(back).toEqual(ir);
    const v = validateStoryFlowIR(back);
    if (!v.ok) throw new Error(`round-tripped IR must validate:\n${(v as { issues: string[] }).issues.join('\n')}`);
  });

  it('render(parse(xml)) ≡ golden(固定点)', () => {
    const ir = parseStoryFlowXML(golden());
    expect(renderStoryFlowXML(ir, { pretty: true })).toBe(golden());
  });
});

describe('词锚从散文恢复', () => {
  it('标记位置 → wordIndex 29(shutter@收)', () => {
    const ir = parseStoryFlowXML(golden());
    const shutter = ir.audio.find(c => c.id === 'aud-sfx-002') as SfxClip;
    expect(shutter.anchor).toEqual({ kind: 'word', wordIndex: 29 });
    expect(shutter.shotId).toBe('SHOT_005');
  });

  it('selection 端点 → shot-start/shot-end', () => {
    const ir = parseStoryFlowXML(golden());
    const ding = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
    expect(ding.anchor).toEqual({ kind: 'shot-start' });
    expect(ding.shotId).toBe('SHOT_003');
  });
});

describe('additive round-trip:whiteModel / vendor 类型保真 / 帧元数据', () => {
  it('whiteModel、vendor 袋类型、camera、帧元数据全程携带', () => {
    const src = mutated(ir => {
      (ir.shots[0] as Shot).whiteModel = { assetId: 'wm-asset-1', durationSeconds: 6 };
      (ir.shots[2] as Shot).generation = {
        backend: 'minimax', steps: 1,
        vendor: { model: 'h3', resolution: '768P', turbo: true, retries: 3 },
      };
      (ir.shots[4] as Shot).lastFrame = {
        description: '近黑收尾', assetId: 'lf-1',
      };
    });
    const back = parseStoryFlowXML(renderStoryFlowXML(src, { pretty: true }));
    expect(back.shots[0].whiteModel).toEqual({ assetId: 'wm-asset-1', durationSeconds: 6 });
    // vendor 袋 string/number/boolean 类型保真
    expect(back.shots[2].generation?.vendor).toEqual({
      model: 'h3', resolution: '768P', turbo: true, retries: 3,
    });
    expect(back.shots[2].generation?.steps).toBe(1);
    expect(back.shots[4].lastFrame).toEqual({ description: '近黑收尾', assetId: 'lf-1' });
    expect(back.shots[2].camera?.lookAt).toEqual([0.1, 1.3, 0.6]); // 运镜几何原样
    expect(back).toEqual(src);
  });

  it('锚 tts 行携带 tts-floor(无 clip 时按 ceil(measured+0.3) 推导)', () => {
    const ir = parseStoryFlowXML(golden());
    expect(ir.shots[2].dialogue?.ttsFloor).toBe(4);
    expect(ir.shots[3].dialogue?.ttsFloor).toBe(3);
    // 推导路径:去掉 tts-floor 属性等价于 measured 3.4 → ceil(3.7)=4
    const src = mutated(m => {
      const clip = m.audio.find(c => c.id === 'aud-tts-001') as TtsClip;
      clip.measuredSeconds = 3.4;
      (m.shots[2] as Shot).dialogue = { text: m.shots[2].dialogue!.text, ttsFloor: 0 };
    });
    const xml = renderStoryFlowXML(src).replace(' tts-floor="0"', '');
    expect(parseStoryFlowXML(xml).shots[2].dialogue?.ttsFloor).toBe(4);
  });
});

describe('v0.1 兼容与版本并集', () => {
  it('v0.1 形制文档照常解析(新节/新属性缺省回退)', () => {
    const v01 = `<?storyflow using="storyflow-ir@0.1"?>
<storyflow version="0.1.0">
  <script id="story">
    @{shot-001}
    一条旧文档的动作行
    @{/shot-001}
  </script>
  <generation>
    <shot ref="{story.selection.shot-001}" seconds="5">
      <first-frame>legacy prompt</first-frame>
    </shot>
  </generation>
  <audio>
  </audio>
  <transition>
  </transition>
  <film id="final" title="旧文档">
    <clip ref="{story.selection.shot-001}"/>
  </film>
</storyflow>`;
    const ir = parseStoryFlowXML(v01);
    expect(ir.version).toBe('0.1.0'); // ir-version 缺省
    expect(ir.mode).toBe('pro'); // mode 缺省
    expect(ir.style.name).toBe('未设定'); // style 节缺省回退
    expect(ir.refs.characters).toEqual([]);
    expect(ir.shots[0].status).toBe('draft');
    expect(ir.shots[0].generation).toBeUndefined();
    expect(validateStoryFlowIR(ir).ok).toBe(true); // 0.1.0 旧档过校验(版本并集)
  });
});
