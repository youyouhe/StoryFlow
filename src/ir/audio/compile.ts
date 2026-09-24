/**
 * ②音频编译器入口 —— IR → AudioMixPlan(三轨合成任务 + 词锚时间轴 + 混音计划)。
 *
 * 词级锚定→时间轴(P0 规则二:锚是作者身份,毫秒是编译产物):
 *   · 锚基文本 = `anchorTextOf(shot)`(对白优先;分词器 `splitAnchorWords`,
 *     标点不产 token)——①⇄② 缝合不变量,wordIndex 只对基文本分词。
 *   · v1 推导(按字素比例):token 权重 = 码点数,word i 的落点 =
 *     round(basisMs × Σw[0..i-1] / Σw)。basis = 已探活秒数(对白锚 = 锚 clip
 *     的 measured)否则计划时长 `fit.wantSeconds`。shot-start → 0;
 *     shot-end → 镜头内容终点 `fit.wantSeconds × 1000`(镜头尾音效归镜头尾,
 *     不随对白杆长度漂移)。WhisperX 级逐词对齐是 P2 升级位。
 *   · 探活来源:`opts.measured[clipId](IO 边缘新值)?? clip.measuredSeconds`
 *     (IR 回填旧值);TTS 缺探活值 → 不进 timeline(边界契约 §2.2)。
 *
 * 混音计划 = ProSegmentCut 声明化(services/videoExport.ts:175-182):
 *   每镜头 tts 顺序拼杆(从 0 累计)/ bgm 覆盖 fromShotId..toShotId 区间
 *   (缺 toShotId = 铺到片尾)/ sfx 按词锚偏移;增益钉死 1.0/0.25/0.8
 *   (= muxSegment filter_complex 内置默认,videoExport.ts:230-238)。
 *
 * v1 记档:IR 的 per-clip `gain`/`loop` 作者覆盖暂不生效(混音参数 UI 是
 * 既知遗留项,docs/pipeline-two-mode.md 遗留 1)——计划如实描述执行值。
 * 多 TtsClip:锚 clip = text 逐字等于 shot.dialogue.text 者;其余为非锚行,
 * 照常进拼杆时间轴;有对白且有 clip 却无一匹配 → TTS_ANCHOR_UNMATCHED
 * (零 clip = 尚未合成的常态,不警告)。
 */
import type { StoryFlowIR, Shot, TtsClip, SfxAnchor } from '../types';
import type {
  AudioCompileOptions, AudioJob, AudioMixPlan, AudioWarning, BgmJob,
  SegmentMix, SfxJob, TimelineEntry, TtsJob,
} from './types';
import {
  AUDIO_MIX_PLAN_VERSION, MIX_BGM_LOOP, MIX_GAIN_BGM, MIX_GAIN_SFX, MIX_GAIN_TTS,
} from './types';
import { anchorTextOf, fitShotDuration, splitAnchorWords } from '../shared';

/** GLM-TTS 单请求上限(字符),提取源:services/glmTtsService.ts:21。 */
export const GLM_TTS_MAX_INPUT = 1024;

/** splitForTts 本地拷贝(services/glmTtsService.ts:43-66):标点贪心切分
 *  (标点跟句),超长句硬切。src/ir 不引 services(边界总则),规则在此固化。 */
export const splitForTts = (input: string, max = GLM_TTS_MAX_INPUT): string[] => {
  const text = input.trim();
  if (text.length <= max) return text ? [text] : [];
  const parts: string[] = [];
  let buf = '';
  for (const seg of text.split(/(?<=[。！？!?；;，,、…\n])/)) {
    if (!seg) continue;
    if ((buf + seg).length > max) {
      if (buf) parts.push(buf);
      if (seg.length > max) {
        for (let i = 0; i < seg.length; i += max) parts.push(seg.slice(i, i + max));
        buf = '';
      } else {
        buf = seg;
      }
    } else {
      buf += seg;
    }
  }
  if (buf) parts.push(buf);
  return parts;
};

/** 词 i 的窗口起点(字素比例,毫秒)。token 权重 = 码点数。 */
const wordStartMs = (tokens: string[], wordIndex: number, basisMs: number): number => {
  const weights = tokens.map(t => [...t].length);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const before = weights.slice(0, wordIndex).reduce((a, b) => a + b, 0);
  return Math.round((before / total) * basisMs);
};

/** SFX 锚 → 段内毫秒落点;null = 无法落点(wordIndex 越界)。
 *  shot-start/shot-end 落**镜头内容边界**(0 / fit.wantSeconds)——镜头尾音效
 *  归镜头尾,不随对白杆长度漂移;word 锚才按字素比例摊 basisMs(对白 =
 *  探活杆长,无对白 = 计划时长)。 */
const resolveAnchorMs = (
  anchor: SfxAnchor,
  tokens: string[],
  basisMs: number,
  shotEndMs: number,
): number | null => {
  switch (anchor.kind) {
    case 'shot-start': return 0;
    case 'shot-end': return Math.round(shotEndMs);
    case 'word':
      return anchor.wordIndex < tokens.length
        ? wordStartMs(tokens, anchor.wordIndex, basisMs)
        : null;
  }
};

export const compileAudioPlan = (
  ir: StoryFlowIR,
  opts: AudioCompileOptions = {},
): AudioMixPlan => {
  const warnings: AudioWarning[] = [];
  const jobs: AudioJob[] = [];
  const timeline: TimelineEntry[] = [];
  const mix: SegmentMix[] = [];

  const shotsById = new Map<string, Shot>(ir.shots.map(s => [s.id, s]));
  const orderedShots = [...ir.shots].sort((a, b) => a.sequence - b.sequence);
  const seqOf = new Map(orderedShots.map(s => [s.id, s.sequence]));

  const measuredOf = (clip: TtsClip): number | undefined =>
    opts.measured?.[clip.id] ?? clip.measuredSeconds;

  const ttsOfShot = (shotId: string): TtsClip[] =>
    ir.audio.filter((c): c is TtsClip => c.kind === 'tts' && c.shotId === shotId);

  // ---- fits + 时长警告(与①同一 fitShotDuration —— ttsFloor 缝合) ----------
  const fits = orderedShots.map(shot => {
    const fit = fitShotDuration(shot.shotDuration, shot.dialogue?.ttsFloor ?? 0);
    if (fit.audioTooLong) {
      warnings.push({
        code: 'AUDIO_TOO_LONG',
        shotId: shot.id,
        message: `对白 TTS 下限 ${fit.lowerBound}s 超模型窗上限 15s——音频放不进生成窗,需拆句或提速。`,
      });
    }
    return { shotId: shot.id, durationFit: fit };
  });
  const fitOf = new Map(fits.map(f => [f.shotId, f.durationFit]));

  // ---- 三轨 jobs(执行值 = 钉死常量,v1 记档见文件头) --------------------
  for (const clip of ir.audio) {
    if (clip.kind === 'tts') {
      const job: TtsJob = {
        kind: 'tts',
        clipId: clip.id,
        shotId: clip.shotId,
        ...(clip.character ? { character: clip.character } : {}),
        text: clip.text,
        parts: splitForTts(clip.text),
        voice: clip.voice,
        ...(clip.speed != null ? { speed: clip.speed } : {}),
        ...(clip.volume != null ? { volume: clip.volume } : {}),
        ...(clip.watermark != null ? { watermark: clip.watermark } : {}),
      };
      jobs.push(job);
    } else if (clip.kind === 'bgm') {
      const job: BgmJob = {
        kind: 'bgm',
        clipId: clip.id,
        fromShotId: clip.fromShotId,
        ...(clip.toShotId ? { toShotId: clip.toShotId } : {}),
        prompt: clip.prompt,
        loop: MIX_BGM_LOOP,
        gain: MIX_GAIN_BGM,
      };
      jobs.push(job);
    } else {
      const job: SfxJob = {
        kind: 'sfx',
        clipId: clip.id,
        shotId: clip.shotId,
        name: clip.name,
        anchor: clip.anchor,
        ...(clip.missing != null ? { missing: clip.missing } : {}),
        gain: MIX_GAIN_SFX,
      };
      jobs.push(job);
    }
  }

  // ---- 锚 clip 匹配(缝合不变量 §2.4-3) ----------------------------------
  for (const shot of orderedShots) {
    if (!shot.dialogue) continue;
    const clips = ttsOfShot(shot.id);
    if (clips.length > 0 && !clips.some(c => c.text === shot.dialogue!.text)) {
      warnings.push({
        code: 'TTS_ANCHOR_UNMATCHED',
        shotId: shot.id,
        message: `无 TtsClip.text 逐字等于 dialogue.text——词锚失去基准 clip(锚基文本 = 对白原文)。`,
      });
    }
  }

  // ---- 逐镜头:TTS 拼杆时间轴 + SFX 词锚落点 + 混音条目 --------------------
  for (const shot of orderedShots) {
    const fit = fitOf.get(shot.id)!;
    const anchorBase = anchorTextOf(shot);
    const tokens = splitAnchorWords(anchorBase.text);
    const anchorClip = anchorBase.source === 'dialogue'
      ? ttsOfShot(shot.id).find(c => c.text === shot.dialogue!.text)
      : undefined;
    const basisSeconds = (anchorClip ? measuredOf(anchorClip) : undefined) ?? fit.wantSeconds;
    const basisMs = basisSeconds * 1000;

    const mixTts: SegmentMix['tts'] = [];
    const mixSfx: SegmentMix['sfx'] = [];

    // 对白拼杆(muxSegment: 顺序 wav 直拼)——缺探活值的 clip 不进 timeline
    let stemMs = 0;
    for (const clip of ttsOfShot(shot.id)) {
      mixTts.push({ clipId: clip.id, gain: MIX_GAIN_TTS });
      const m = measuredOf(clip);
      if (m == null) continue;
      timeline.push({
        clipId: clip.id,
        startMs: Math.round(stemMs),
        durationMs: Math.round(m * 1000),
      });
      stemMs += m * 1000;
    }

    // SFX 词锚落点
    for (const clip of ir.audio) {
      if (clip.kind !== 'sfx' || clip.shotId !== shot.id) continue;
      if (clip.missing) {
        warnings.push({
          code: 'SFX_MISSING',
          shotId: shot.id,
          message: `SFX「${clip.name}」无 manifest/文件命中(SFX_MISSING),混音计划中保留占位。`,
        });
      }
      const atMs = resolveAnchorMs(clip.anchor, tokens, basisMs, fit.wantSeconds * 1000);
      if (atMs == null) {
        warnings.push({
          code: 'SFX_ANCHOR_OUT_OF_RANGE',
          shotId: shot.id,
          message: `SFX「${clip.name}」词锚 wordIndex=${clip.anchor.kind === 'word' ? clip.anchor.wordIndex : '?'} 越界(基文本仅 ${tokens.length} token),无法落点。`,
        });
        continue;
      }
      mixSfx.push({ clipId: clip.id, atMs, gain: MIX_GAIN_SFX });
      timeline.push({ clipId: clip.id, startMs: atMs });
    }

    // BGM 覆盖区间(fromShotId..toShotId,缺 toShotId = 到片尾)
    const shotSeq = seqOf.get(shot.id)!;
    const bgm = ir.audio.find(c => {
      if (c.kind !== 'bgm') return false;
      const from = seqOf.get(c.fromShotId);
      const to = c.toShotId ? seqOf.get(c.toShotId) : undefined;
      if (from == null) return false;
      return shotSeq >= from && (to == null || shotSeq <= to);
    });
    const mixBgm = bgm && bgm.kind === 'bgm'
      ? { clipId: bgm.id, gain: MIX_GAIN_BGM, loop: MIX_BGM_LOOP }
      : undefined;

    if (mixTts.length || mixSfx.length || mixBgm) {
      mix.push({
        shotId: shot.id,
        tts: mixTts,
        ...(mixBgm ? { bgm: mixBgm } : {}),
        sfx: mixSfx,
      });
    }
  }

  void shotsById;
  return {
    version: AUDIO_MIX_PLAN_VERSION,
    jobs,
    timeline,
    mix,
    fits,
    warnings,
  };
};
