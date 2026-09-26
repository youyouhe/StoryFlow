import { describe, it, expect } from 'vitest';

import type { Screenplay, ProSegmentAudio } from '../types';
import { planVideoSegments } from '../utils/videoPlan';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { executeAudioPlan, alignAudioClips } from '../src/exec/audioExec';
import { getAudioFrom, exportProCutWithCuts } from '../src/exec/exportExec';
import { buildWordCues, placeWordCues } from '../src/align/karaoke';
import { createAlignClient } from '../src/align/client';
import { mapMixToProSegmentCuts } from '../src/bridge/audio';
import type { AudioExecDeps, AudioExecPorts } from '../src/exec/types';
import type { AlignmentTake, AlignedToken } from '../src/ir/audio/types';
import { splitAnchorWords } from '../src/ir/shared';
import type { ProSegmentCut } from '../services/videoExport';

/**
 * StoryFlow#6 · issue #6 验收项 —— P0–P8 合成端到端 dry-run(全 mock 一测贯通):
 *   extract → compile① → bridge → audioExec(TTS mock/SFX/BGM)
 *   → alignAudioClips(mock 对齐客户端)→ compile②(对齐件回灌 + 探活回填)
 *   → karaoke cues → mapMixToProSegmentCuts → exportProCutWithCuts。
 * 零网络零花费;真服务的 HTTP 全链由 scripts/align-e2e-dryrun.ts 覆盖。
 */

const fixture = (): Screenplay => ({
  id: 'e2e-dry-1',
  metadata: {
    title: '全链 dry-run', author: 'agent', draft: 'First Draft', scriptLanguage: 'zh',
  },
  blocks: [
    { id: 'b0', type: 'SCENE_HEADING', content: '内. 茶馆 - 夜' },
    { id: 'b1', type: 'ACTION', content: '00:00-00:03。刀客推门而入，雨声灌进屋' },
    { id: 'b2', type: 'CHARACTER', content: '刀客' },
    { id: 'b3', type: 'DIALOGUE', content: '你的刀很快。' },
    { id: 'b4', type: 'ACTION', content: '00:04-00:07。掌柜斟酒，烛火摇曳' },
    { id: 'b5', type: 'DIALOGUE', content: '这杯我请。' },
  ],
  productionMode: 'cinematic',
  lastModified: 0,
});

/** 确定性 mock 对齐:token 数逐位(splitAnchorWords),等分窗 + 末词收 2000ms。 */
const fakeAlignTake = (blob: Blob, text: string): Promise<AlignmentTake> => {
  const words = splitAnchorWords(text);
  const tokens: AlignedToken[] = words.map((w, i) => ({
    tokenIndex: i,
    text: w,
    startMs: Math.round((i / words.length) * 2000),
    endMs: i === words.length - 1 ? 2000 : Math.round(((i + 1) / words.length) * 2000) - 10,
    confidence: 0.8,
  }));
  return Promise.resolve({ text, clipId: '', durationMs: 2000, tokens });
};

const mockPorts = (over: Partial<AudioExecPorts> = {}): AudioExecPorts => ({
  synthesizeSpeech: async (_key, input) => new Blob([`wav:${input}`], { type: 'audio/wav' }),
  concatWavs: async parts => parts[0],
  wavDuration: () => 2.0,
  resolveSfx: async name => ({ name, url: `sfx://${name}.wav` }),
  requestMusic: async () => ({ requestId: 'req-1' }),
  pollMusic: async () => ({ status: 'succeeded' as const, audioUrl: 'bgm://1.m4a' }),
  ...over,
});
const deps = (ports: AudioExecPorts): AudioExecDeps => ({ ports, ttsApiKey: 'k', falKey: 'f' });

describe('全链 dry-run(extract→compile→bridge→exec→align→export,全 mock)', () => {
  it('一测贯通:提取 → 三轨执行 → 对齐回灌 → karaoke → 导出 cuts', async () => {
    // ① 提取:proAudio 按段键挂载 → IR
    const screenplay = fixture();
    const seg = planVideoSegments(screenplay.blocks, 10).segments.find(s => s.blockIds.includes('b3'))!;
    expect(seg).toBeTruthy();
    const beat = seg.beats.find(b => b.blockIds.includes('b3'))!;
    const proAudio: Record<string, ProSegmentAudio> = {
      [seg.blockIds[0]]: {
        tts: [
          { line: '你的刀很快。', charName: '刀客', voice: 'tongtong', url: '', seconds: 2.4 },
          { line: '这杯我请。', charName: '刀客', voice: 'tongtong', url: '', seconds: 1.8 },
        ],
        sfx: [{ name: 'cup-slide', at: beat.start + (beat.end - beat.start) / 2 }],
        bgm: { prompt: 'guzheng, rainy night', url: '' },
      },
    };
    screenplay.proAudio = proAudio;
    const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });

    expect(ir.shots.length).toBeGreaterThanOrEqual(2);
    expect(ir.shots.filter(s => s.dialogue)).toHaveLength(2);
    const ttsClips = ir.audio.filter(c => c.kind === 'tts');
    expect(ttsClips).toHaveLength(2);
    const sfxClips = ir.audio.filter(c => c.kind === 'sfx');
    expect(sfxClips.length).toBeGreaterThanOrEqual(1);
    expect(sfxClips.some(c => c.anchor.kind === 'word')).toBe(true); // 词锚反演
    expect(ir.audio.some(c => c.kind === 'bgm')).toBe(true);

    // ② 编译①:jobs/timeline/mix 齐;SFX 走字素比例回退(无对齐件)
    const plan1 = compileAudioPlan(ir);
    expect(plan1.jobs.filter(j => j.kind === 'tts')).toHaveLength(2);
    expect(plan1.jobs.some(j => j.kind === 'sfx')).toBe(true);
    expect(plan1.jobs.some(j => j.kind === 'bgm')).toBe(true);
    expect(plan1.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE')).toBe(false);

    // ③ bridge + audio 执行:合成/拼杆/探活/SFX/BGM 全 mock
    const run = await executeAudioPlan(plan1, deps(mockPorts()));
    expect(run.failures).toEqual([]);
    expect(Object.keys(run.clipBlobs)).toHaveLength(2);
    expect(Object.values(run.measurements)).toEqual([2.0, 2.0]);

    // ④ 对齐:mock alignTake(ports 契约与真客户端同形)→ runner 盖章 clipId
    const { takes, failures } = await alignAudioClips(run.clipBlobs, plan1, deps(mockPorts({ alignTake: fakeAlignTake })));
    expect(failures).toEqual([]);
    expect(Object.keys(takes)).toHaveLength(2);
    for (const [clipId, take] of Object.entries(takes)) {
      expect(take.clipId).toBe(clipId); // runner 权威盖章(P5)
      expect(take.tokens).toHaveLength(splitAnchorWords(take.text).length); // 逐位
    }

    // ⑤ 编译②:对齐件 + 探活回灌 —— SFX word 锚改走对齐 token 起点
    const plan2 = compileAudioPlan(ir, { measured: run.measurements, alignments: takes });
    expect(plan2.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE')).toBe(false);
    const wordSfx = sfxClips.find(c => c.anchor.kind === 'word')!;
    const wordIndex = (wordSfx.anchor as { kind: 'word'; wordIndex: number }).wordIndex;
    const anchorShot = ir.shots.find(s => s.id === wordSfx.shotId)!;
    const anchorClip = ttsClips.find(c => c.shotId === wordSfx.shotId && c.text === anchorShot.dialogue!.text)!;
    const take = takes[anchorClip.id];
    const atMs = plan2.timeline.find(t => t.clipId === wordSfx.id)!.startMs;
    expect(atMs).toBe(Math.round(take.tokens[wordIndex].startMs)); // 对齐落点,非字素比例

    // ⑥ karaoke cues:纯消费者
    const cues = buildWordCues(take);
    expect(cues).toHaveLength(take.tokens.length);
    expect(cues.every(c => c.text === splitAnchorWords(take.text)[c.tokenIndex])).toBe(true);
    const stemOffset = plan2.timeline.find(t => t.clipId === anchorClip.id)!.startMs;
    const placed = placeWordCues(cues, stemOffset);
    expect(placed[0].startMs).toBe(cues[0].startMs + stemOffset);

    // ⑦ 导出:mix → ProSegmentCuts → exportProCut(壳层贯通)
    const exportCalls: ProSegmentCut[][] = [];
    const exportBlob = await exportProCutWithCuts(
      mapMixToProSegmentCuts(plan2, {
        videoUrlOf: shotId => `video://${shotId}.mp4`,
        keyOf: clipId => `key-${clipId}`,
        blobOf: clipId => (clipId === wordSfx.id ? new Blob(['sfx']) : undefined),
        bgmUrlOf: clipId => `bgm://${clipId}.m4a`,
      }),
      { ports: { exportProCut: async (cuts) => { exportCalls.push(cuts); return new Blob(['mp4']); }, concatClipsToMp4: async () => new Blob(['x']) } },
      { getAudio: getAudioFrom(run.clipBlobs) },
    );
    expect(exportBlob.size).toBeGreaterThan(0);
    expect(exportCalls).toHaveLength(1);
    const cuts = exportCalls[0];
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    const cutWithTts = cuts.find(c => c.ttsKeys?.length)!;
    expect(cutWithTts.ttsKeys!.every(k => k.startsWith('key-aud-tts'))).toBe(true);
    const cutWithSfx = cuts.find(c => c.sfx?.length)!;
    expect(cutWithSfx.sfx![0].atMs).toBe(atMs); // 对齐落点直通混音计划
  });

  it('对齐服务 token 数不符 → 失败如实收集(拒绝而非钳制)', async () => {
    const screenplay = fixture();
    const seg = planVideoSegments(screenplay.blocks, 10).segments.find(s => s.blockIds.includes('b3'))!;
    screenplay.proAudio = {
      [seg.blockIds[0]]: {
        tts: [{ line: '你的刀很快。', charName: '刀客', voice: 'tongtong', url: '', seconds: 2.0 }],
      },
    };
    const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });
    const plan = compileAudioPlan(ir);
    const run = await executeAudioPlan(plan, deps(mockPorts()));
    // 真客户端 + 注入 fetch(零网络):服务回包 token 数不符 → 客户端拒绝
    const badTake = createAlignClient({
      endpoint: 'http://align-mock.invalid',
      fetchFn: (async () => Response.json({
        durationMs: 2000,
        tokens: [{ startMs: 0, endMs: 400 }, { startMs: 500, endMs: 900 }],
      })) as typeof fetch,
    });
    const { takes, failures } = await alignAudioClips(run.clipBlobs, plan, deps(mockPorts({ alignTake: badTake })));
    expect(Object.keys(takes)).toHaveLength(0);
    // issue #10 后:未声明 proAudio 的对白由提取派生意图 clip——坏 take 对
    // 每个 clip 如实各报一次失败(拒绝而非钳制)
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.every(f => f.error.includes('token 数不符'))).toBe(true);
  });
});
