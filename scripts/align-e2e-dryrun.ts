/**
 * StoryFlow#6 全链 e2e dry-run —— 提取→对齐→编译→karaoke cues。
 *
 * 真对齐服务(WhisperX 类,scripts/align_service.py,默认 127.0.0.1:8788)经
 * `defaultAudioPorts({alignEndpoint})` 绑真客户端(P8 接线兑现);TTS/SFX/BGM
 * 为确定性本地 mock(音脉冲 WAV,每 token 一个 burst = 已知真值),零外部
 * 花费。对齐质量以真值量化:对齐边界 vs 字素比例回退的误差对比。
 *
 * 运行(先起服务):
 *   bash scripts/align_service.sh start
 *   npx esbuild scripts/align-e2e-dryrun.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/align-e2e-dryrun.mjs && node /tmp/align-e2e-dryrun.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Screenplay, ProSegmentAudio } from '../types';
import type { SfxClip } from '../src/ir/types';
import { planVideoSegments } from '../utils/videoPlan';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { executeAudioPlan, alignAudioClips } from '../src/exec/audioExec';
import { defaultAudioPorts } from '../src/exec/wiring';
import type { AudioExecDeps, AudioExecPorts } from '../src/exec/types';
import { buildWordCues, placeWordCues } from '../src/align/karaoke';
import { splitAnchorWords } from '../src/ir/shared';

// ── fixture:茶馆夜戏(有对白/SFX/BGM 的最小 Pro 稿) ------------------------

const fixtureScreenplay = (): Screenplay => ({
  id: 'e2e-align-1',
  metadata: {
    title: '对齐 e2e dry-run',
    author: 'agent',
    draft: 'First Draft',
    scriptLanguage: 'zh',
    styleHead: {
      name: '水墨夜戏',
      artStyle: '水墨笔触,墨色浓淡分镜',
      scenePreset: '古代茶馆夜内景,烛光摇曳',
      promptPrefix: 'ink-wash painting style, candle-lit night teahouse',
    },
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
  lastModified: Date.now(),
});

// ── mock:音脉冲 TTS(每 token 一个 burst = 对齐真值)+ 假 SFX/BGM ------------

const RATE = 16000;
const BURST_S = 0.2;
const GAP_S = 0.06;
const LEAD_S = 0.15;
const TAIL_S = 0.25;

/** 确定性音脉冲 WAV:返回 (blob, 每 token 真值窗 ms)。 */
const synthBurstWav = (tokenCount: number): { blob: Blob; truth: [number, number][] } => {
  const bytes: number[] = [];
  const push = (v: number) => {
    const s = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    bytes.push(s & 0xff, (s >> 8) & 0xff);
  };
  const silence = (sec: number) => {
    for (let i = 0; i < sec * RATE; i++) push(0);
  };
  const truth: [number, number][] = [];
  let t = LEAD_S;
  silence(LEAD_S);
  for (let i = 0; i < tokenCount; i++) {
    truth.push([Math.round(t * 1000), Math.round((t + BURST_S) * 1000)]);
    const n = Math.floor(BURST_S * RATE);
    const f = 200 + 40 * i;
    const fade = Math.floor(0.008 * RATE);
    for (let k = 0; k < n; k++) {
      const env = Math.min(1, k / fade, (n - k) / fade);
      push(0.6 * env * Math.sin((2 * Math.PI * f * k) / RATE));
    }
    silence(GAP_S);
    t += BURST_S + GAP_S;
  }
  silence(TAIL_S);
  const data = new Uint8Array(bytes);
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  const dataLen = data.length;
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, dataLen, true);
  return {
    blob: new Blob([header, data], { type: 'audio/wav' }),
    truth,
  };
};

const meanErr = (tokens: { startMs: number }[], truth: [number, number][]): number =>
  tokens.reduce((acc, t, i) => acc + Math.abs(t.startMs - truth[i][0]), 0) / tokens.length;

// ── main -------------------------------------------------------------------

const results: { name: string; pass: boolean; detail?: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) process.exitCode = 1;
};

const ENDPOINT = process.env.ALIGN_ENDPOINT ?? 'http://127.0.0.1:8788';

const main = async () => {
  console.log(`align endpoint: ${ENDPOINT}`);

  // 1. 提取:screenplay → IR(真提取器;proAudio 按 planVideoSegments 段键挂载)
  const screenplay = fixtureScreenplay();
  const segments = planVideoSegments(screenplay.blocks, 10);
  const segOfDialogue = segments.segments.find(s => s.blockIds.includes('b3'));
  ok('提取前:对白节拍进段', !!segOfDialogue, segOfDialogue ? `segKey=${segOfDialogue.blockIds[0]}` : '');
  if (!segOfDialogue) return;

  // SFX at 选在对白节拍中点 → 提取器应反演出 word 锚
  const dialogueBeat = segOfDialogue.beats.find(b => b.blockIds.includes('b3'))!;
  const sfxAt = dialogueBeat.start + (dialogueBeat.end - dialogueBeat.start) / 2;
  const proAudio: Record<string, ProSegmentAudio> = {
    [segOfDialogue.blockIds[0]]: {
      tts: [
        { line: '你的刀很快。', charName: '刀客', voice: 'tongtong', url: '', seconds: 2.6 },
        { line: '这杯我请。', charName: '刀客', voice: 'tongtong', url: '', seconds: 1.9 },
      ],
      sfx: [{ name: 'cup-slide', at: sfxAt }],
      bgm: { prompt: 'gentle guzheng, rainy night teahouse, ambient bed', url: '' },
    },
  };
  screenplay.proAudio = proAudio;

  const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });
  ok('提取:IR 有 shots', ir.shots.length >= 2, `${ir.shots.length} shots`);
  ok('提取:IR 有对白 shot.dialogue', ir.shots.some(s => !!s.dialogue));
  ok('提取:三轨 audio 生成', ir.audio.filter(c => c.kind === 'tts').length === 2
    && ir.audio.some(c => c.kind === 'sfx') && ir.audio.some(c => c.kind === 'bgm'),
    ir.audio.map(c => c.kind).join('/'));
  const wordAnchored = ir.audio.filter((c): c is SfxClip => c.kind === 'sfx' && c.anchor.kind === 'word');
  ok('提取:SFX 反演出 word 锚', wordAnchored.length >= 1,
    wordAnchored.length ? `${wordAnchored.length} word 锚(wordIndex=${wordAnchored.map(c => (c.anchor as { wordIndex: number }).wordIndex)})` : '全落在 shot-start/shot-end');

  // 2. 编译(首轮:无对齐 → SFX 走字素比例回退)
  const plan1 = compileAudioPlan(ir);
  ok('编译①:三轨 jobs', plan1.jobs.filter(j => j.kind === 'tts').length === 2
    && plan1.jobs.some(j => j.kind === 'sfx') && plan1.jobs.some(j => j.kind === 'bgm'),
    plan1.jobs.map(j => j.kind).join('/'));

  // 3. 执行:TTS mock(音脉冲)→ 探活;对齐端口 = defaultAudioPorts({alignEndpoint}) 真绑定
  const realPorts = defaultAudioPorts({ alignEndpoint: ENDPOINT });
  if (!realPorts.alignTake) throw new Error('defaultAudioPorts 未绑定 alignTake——端点缺失?');
  const truthByClip = new Map<string, [number, number][]>();
  const ports: AudioExecPorts = {
    ...realPorts,
    synthesizeSpeech: async (_key, input) => {
      const { blob, truth } = synthBurstWav(splitAnchorWords(input).length);
      truthByClip.set(input, truth);
      return blob;
    },
    concatWavs: async parts => parts[0],
    resolveSfx: async name => ({ name, url: `sfx://${name}.wav` }),
    requestMusic: async () => ({ requestId: 'req-e2e' }),
    pollMusic: async () => ({ status: 'succeeded' as const, audioUrl: 'bgm://e2e.m4a' }),
  };
  const deps: AudioExecDeps = { ports, ttsApiKey: 'dry-run', falKey: 'dry-run' };
  const run = await executeAudioPlan(plan1, deps);
  ok('执行:TTS mock 合成无失败', run.failures.length === 0, run.failures.map(f => f.error).join('; ') || `${Object.keys(run.clipBlobs).length} clips`);
  ok('执行:探活回填(② reflow 输入)', Object.keys(run.measurements).length === 2,
    JSON.stringify(run.measurements));

  // 4. 对齐:真 HTTP → WhisperX 类服务(逐 clip)
  const { takes, failures: alignFailures } = await alignAudioClips(run.clipBlobs, plan1, deps);
  ok('对齐:全部 clip 真服务对齐成功', alignFailures.length === 0 && Object.keys(takes).length === 2,
    alignFailures.map(f => `${f.clipId}: ${f.error}`).join('; ') || `${Object.keys(takes).length} takes`);

  let alignedErrs: number[] = [];
  let fallbackErrs: number[] = [];
  for (const [clipId, take] of Object.entries(takes)) {
    const text = take.text;
    const words = splitAnchorWords(text);
    ok(`对齐[${clipId}]:token 数逐位一致`, take.tokens.length === words.length,
      `${take.tokens.length}/${words.length}`);
    const truth = truthByClip.get(text)!;
    ok(`对齐[${clipId}]:durationMs 与探活一致`, Math.abs(take.durationMs - run.measurements[clipId] * 1000) < 20,
      `${take.durationMs} vs ${Math.round(run.measurements[clipId] * 1000)}`);
    const ae = meanErr(take.tokens, truth);
    alignedErrs.push(ae);
    // 字素比例回退真值误差(basis = 探活全长,含首尾静音;等权 = compile 的
    // 码点权重在纯汉字下的退化形)
    const basis = run.measurements[clipId] * 1000;
    const n = words.length;
    const fb = words.map((_, i) => (i / n) * basis);
    fallbackErrs.push(meanErr(fb.map(s => ({ startMs: s })), truth));
  }
  const alignedMean = alignedErrs.reduce((a, b) => a + b, 0) / alignedErrs.length;
  const fallbackMean = fallbackErrs.reduce((a, b) => a + b, 0) / fallbackErrs.length;
  ok('对齐质量:平均边界误差 < 120ms', alignedMean < 120, `aligned=${alignedMean.toFixed(1)}ms`);
  ok('对齐质量:显著优于字素比例回退', alignedMean < fallbackMean * 0.6,
    `fallback=${fallbackMean.toFixed(1)}ms → aligned=${alignedMean.toFixed(1)}ms`);

  // 5. 重编译(对齐件回灌):SFX word 锚应落在对齐 token 起点
  const plan2 = compileAudioPlan(ir, { measured: run.measurements, alignments: takes });
  ok('编译②:无 ALIGNMENT_UNUSABLE', !plan2.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE'),
    plan2.warnings.map(w => w.code).join(',') || 'clean');
  const sfxTimeline = plan2.timeline.filter(t => plan1.jobs.find(j => j.kind === 'sfx' && j.clipId === t.clipId));
  const sfxJob = plan1.jobs.find(j => j.kind === 'sfx') as { clipId: string; shotId: string; anchor: { kind: string; wordIndex?: number } } | undefined;
  if (sfxJob?.anchor.kind === 'word' && sfxJob.anchor.wordIndex != null) {
    const anchorClip = ir.audio.find(c => c.kind === 'tts' && c.shotId === sfxJob.shotId
      && (c as { text: string }).text === ir.shots.find(s => s.id === sfxJob.shotId)?.dialogue?.text) as { id: string } | undefined;
    const take = anchorClip ? takes[anchorClip.id] : undefined;
    const tok = take?.tokens[sfxJob.anchor.wordIndex];
    const at = sfxTimeline[0]?.startMs;
    ok('编译②:SFX word 锚 = 对齐 token 起点', !!take && !!tok && at != null
      && Math.abs(at - (take ? Math.round(tok.startMs) : 0)) <= 2,
      `atMs=${at} alignedStartMs=${tok?.startMs}`);
  } else {
    ok('编译②:SFX word 锚 = 对齐 token 起点', false, '提取未产出 word 锚(fixture 需调)');
  }

  // 6. karaoke cues:buildWordCues → placeWordCues
  const anchorTake = Object.values(takes)[0];
  const cues = buildWordCues(anchorTake);
  ok('karaoke:逐词 cue 数 = token 数', cues.length === anchorTake.tokens.length, `${cues.length}`);
  ok('karaoke:作者词形 = splitAnchorWords', cues.every((c, i) => c.text === splitAnchorWords(anchorTake.text)[i]));
  ok('karaoke:窗单调且在片长内', cues.every((c, i) =>
    c.startMs >= 0 && c.endMs <= anchorTake.durationMs && (i === 0 || c.startMs >= cues[i - 1].startMs)));
  const stemOffset = plan2.timeline.find(t => t.clipId === anchorTake.clipId)?.startMs ?? 0;
  const placed = placeWordCues(cues, stemOffset);
  ok('karaoke:placeWordCues 平移正确', placed.every((c, i) =>
    c.startMs === cues[i].startMs + stemOffset && c.endMs === cues[i].endMs + stemOffset),
    `offset=${stemOffset}ms`);

  // ── 报告 ─────────────────────────────────────────────────────────────────
  console.log('\n==== karaoke cues 样例(首 take) ====');
  for (const c of placed) {
    console.log(`  [${String(c.tokenIndex).padStart(2)}] ${c.text}  ${c.startMs}–${c.endMs}ms  conf=${c.confidence}`);
  }
  console.log('\n==== 汇总 ====');
  console.log(`对齐边界平均误差(真值):${alignedMean.toFixed(1)}ms(字素比例回退 ${fallbackMean.toFixed(1)}ms,改善 ${(100 * (1 - alignedMean / fallbackMean)).toFixed(0)}%)`);
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n==== ${results.length - failed}/${results.length} assertions passed ====`);
  if (failed) process.exit(1);
};

main().catch(e => {
  console.error('E2E dry-run 抛错:', e);
  process.exit(1);
});
