import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { validateStoryFlowIR } from '../src/ir/schema';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { compileCaptions } from '../src/captions/compile';
import { stripWrapQuotes } from '../src/ir/shared';

/**
 * issue #14 — 提取清洗三连(用户《商业广告》手测剧本回归):
 *   ① CHARACTER 括注剥离:登山者（喘息）→ char:登山者,括注进表演层
 *   ② 场景短键:暴雨夜，悬崖攀岩壁，闪电劈开乌云。→ scene:悬崖攀岩壁
 *     (整句保留在 description)
 *   ③ TTS 文本剥首尾引号
 * 剧本内容 = /home/git/Untitled_商业广告_2026-09-26.json 的 blocks 原文。
 */

const adBlocks = JSON.parse(
  readFileSync(new URL('./fixtures/commercialAd.json', import.meta.url), 'utf8'),
) as { blocks: Parameters<typeof extractStoryFlowIR>[0]['blocks'] };
const adBlockList = adBlocks.blocks;

const extractAd = () =>
  extractStoryFlowIR(
    {
      id: 'ad-14',
      metadata: { title: 'Untitled 商业广告', author: 'user', draft: 'First Draft', scriptLanguage: 'zh' },
      blocks: adBlockList,
      schemaVersion: 3,
      lastModified: 0,
    },
    [],
    { defaultMode: 'pro' },
  );

describe('stripWrapQuotes — 剥首尾引号', () => {
  it('成对引号剥离,正文标点保留', () => {
    expect(stripWrapQuotes('“还有十米。”')).toBe('还有十米。');
    expect(stripWrapQuotes('"走。"')).toBe('走。');
    expect(stripWrapQuotes('「闭嘴」')).toBe('闭嘴');
    expect(stripWrapQuotes('『安静』')).toBe('安静');
  });
  it('首/尾单侧引号各自剥(TTS 无怪顿优先);无引号不动', () => {
    expect(stripWrapQuotes('“走。')).toBe('走。');
    // 首尾无条件剥:尾引号对 TTS 是同样的怪顿源(正文内的引号不受影响)
    expect(stripWrapQuotes('他说：“出发。”')).toBe('他说：“出发。');
    expect(stripWrapQuotes('没有引号。')).toBe('没有引号。');
  });
});

describe('issue #14 ① — 角色括注剥离(ref 键不被污染)', () => {
  const ir = extractAd();

  it('ref 键 = char:登山者(不带 :喘息 变体)', () => {
    expect(ir.refs.characters.map(c => c.id)).toEqual(['char:登山者']);
    expect(ir.refs.characters[0].variant).toBeUndefined();
  });

  it('括注不进 motionPrompt(#15:与 ref 键同一清洗),后续拍零残留', () => {
    expect(ir.shots.every(s => !s.motionPrompt.includes('（喘息'))).toBe(true);
    expect(ir.shots.every(s => !s.motionPrompt.includes('(喘息'))).toBe(true);
  });

  it('同角色不同括注写法解析为同一 ref(登山者（喘息）≡登山者)', () => {
    const withPlainCue = structuredClone(adBlockList) as Parameters<typeof extractStoryFlowIR>[0]['blocks'];
    withPlainCue.splice(2, 1, { id: 'h2b', type: 'CHARACTER', content: '登山者' });
    const ir2 = extractStoryFlowIR(
      { id: 'ad-14b', metadata: { title: 'T', author: 'a', draft: '1', scriptLanguage: 'zh' }, blocks: withPlainCue, lastModified: 0 },
      [],
      { defaultMode: 'pro' },
    );
    expect(ir2.refs.characters.map(c => c.id)).toEqual(['char:登山者']);
  });
});

describe('issue #14 ② — 场景短键', () => {
  it('ref 键 = scene:悬崖攀岩壁;完整句保留在 description', () => {
    const ir = extractAd();
    expect(ir.refs.scenes.map(s => s.id)).toEqual(['scene:悬崖攀岩壁']);
    expect(ir.refs.scenes[0].description).toContain('暴雨夜');
    expect(ir.refs.scenes[0].description).toContain('闪电');
  });

  it('short key 派生规则:时间/天气段跳过、内景前缀剥离、普通稿不变', () => {
    const mk = (heading: string) =>
      extractStoryFlowIR(
        { id: 'sk', metadata: { title: 'T', author: 'a', draft: '1', scriptLanguage: 'zh' },
          blocks: [{ id: 's', type: 'SCENE_HEADING', content: heading }], lastModified: 0 },
        [], { defaultMode: 'pro' },
      );
    expect(mk('内. 茶馆 - 夜').refs.scenes[0].id).toBe('scene:茶馆');
    expect(mk('INT. 国营照相馆 - 清晨').refs.scenes[0].id).toBe('scene:国营照相馆');
    expect(mk('夜，码头').refs.scenes[0].id).toBe('scene:码头');
    expect(mk('悬崖攀岩壁').refs.scenes[0].id).toBe('scene:悬崖攀岩壁');
  });
});

describe('issue #14 ③ — TTS 文本剥引号', () => {
  it('音频 clip 与编译 jobs 文本无引号;正文标点保留', () => {
    const ir = extractAd();
    const clips = ir.audio.filter(c => c.kind === 'tts');
    expect(clips).toHaveLength(1);
    expect(clips[0].text).toBe('还有十米。');
    const audio = compileAudioPlan(ir);
    const job = audio.jobs.find(j => j.kind === 'tts') as { text: string };
    expect(job.text).not.toMatch(/[“”"]/u);
    expect(job.text).toBe('还有十米。');
  });

  it('字幕文本同步无引号', () => {
    const ir = extractAd();
    const caps = compileCaptions(ir);
    expect(caps.captions.map(c => c.text)).toEqual(['还有十米。']);
  });
});

describe('issue #14 ④ — schema 与回归', () => {
  it('《商业广告》全稿过 validateStoryFlowIR;既有 golden 不受影响', () => {
    const ir = extractAd();
    const v = validateStoryFlowIR(ir);
    if (!v.ok) throw new Error(`IR 未过 schema:\n${(v as { issues: string[] }).issues.join('\n')}`);
  });
});

describe('issue #15 — graybox authored 口径(targetSeconds 钉拍长,估算只兜底)', () => {
  const gbBlocks = (JSON.parse(
    readFileSync(new URL('./fixtures/commercialAdGraybox.json', import.meta.url), 'utf8'),
  ) as { blocks: Parameters<typeof extractStoryFlowIR>[0]['blocks'] }).blocks;

  const ir = extractStoryFlowIR(
    {
      id: 'ad-15',
      metadata: { title: 'Untitled 商业广告', author: 'user', draft: 'First Draft', scriptLanguage: 'zh' },
      blocks: gbBlocks,
      schemaVersion: 3,
      lastModified: 0,
    },
    [],
    { defaultMode: 'pro' },
  );

  it('SHOT_002 拍长 = targetSeconds 4s 且 estimated=false(验收①)', () => {
    const shot2 = ir.shots.find(s => s.id === 'SHOT_002')!;
    expect(shot2.shotDuration).toBe(4);
    expect(shot2.estimated).toBeUndefined();
    // 运镜照旧直通(#12/#14 之前的行为保持)
    expect(shot2.camera?.movement.type).toBe('dolly');
  });

  it('motionPrompt 无「（喘息」残留(验收②)', () => {
    for (const s of ir.shots) {
      expect(s.motionPrompt.includes('（喘息')).toBe(false);
      expect(s.motionPrompt.includes('(喘息')).toBe(false);
    }
  });

  it('无 graybox 的镜头仍走估算(兜底语义不变,逐拍可辨)', () => {
    const shot3 = ir.shots.find(s => s.id === 'SHOT_003')!;
    expect(shot3.estimated).toBe(true);
    expect(shot3.shotDuration).toBeGreaterThanOrEqual(1);
    expect(shot3.shotDuration).toBeLessThanOrEqual(10);
    // 混合稿:authored 与 estimated 逐拍并存
    expect(ir.shots.some(s => s.estimated !== true)).toBe(true);
    expect(ir.shots.some(s => s.estimated === true)).toBe(true);
  });
});
