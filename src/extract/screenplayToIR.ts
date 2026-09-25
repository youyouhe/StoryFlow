/**
 * P4 提取层 —— Screenplay → StoryFlowIR(生产侧闭合,docs/storyflow-ir-p4.md)。
 *
 * 纯函数、零 IO、确定性。提取语义的唯一出处是原版纯件:
 *   · `utils/videoPlan.planVideoSegments` —— 时间戳节拍 → PlannedBeat(一拍一镜)
 *   · `utils/beatCast` —— computeBeatCast/resolveBeatVariant(角色/变体)
 *   · `utils/refBindings` —— resolveBeatRefs/resolveCharacterSheet(设定表解析)
 * `src/ir/shared` —— 词锚反演 wordIndexAtMs(② wordStartMs 的逆)。
 *
 * 产出必须过 `validateStoryFlowIR`。Screenplay 无来源的字段缺省省略,不编造;
 * 遗留失配(缺风格前缀)在提取时治愈并记档(§6)。
 */
import type {
  Screenplay, ScriptBlock, RefImage, GrayboxCamera, ProSegmentAudio,
} from '../../types';
import type {
  StoryFlowIR, Shot, FrameDesc, CameraMove, RefRegistry, CharacterRef, SceneRef,
  PropRef, ActionRef, SpatialLayout, SpatialObject, SpatialCharacter,
  TtsClip, BgmClip, SfxClip, Transition, ShotStatus,
} from '../ir/types';
import { IR_VERSION } from '../ir/types';
import {
  planVideoSegments, parseBeatTiming, type PlannedBeat, type VideoSegment,
} from '../../utils/videoPlan';
import {
  collectCharacterNames, computeBeatCast, resolveBeatVariant, parseCharacterName,
} from '../../utils/beatCast';
import { resolveCharacterSheet, resolveRefBindings } from '../../utils/refBindings';
import {
  anchorTextOf, fitShotDuration, splitAnchorWords, wordIndexAtMs,
} from '../ir/shared';

export interface ExtractOptions {
  /** VIDEO_PLAN 分段窗(秒,缺省 10)——只影响 proAudio 段键解析,不改拍时长。 */
  targetSeconds?: number;
  /** productionMode 缺席时的模式(缺省 'pro')。 */
  defaultMode?: 'express' | 'pro';
  /** 形象设定文案钩子(缺省回退 sourcePrompt → subject → name)。 */
  descriptionOf?: (img: RefImage) => string;
}

const pad3 = (n: number): string => String(n).padStart(3, '0');
const sanitizeName = (s: string): string => s.replace(/:/g, '_');

/** INT. 国营照相馆 - 清晨 → 国营照相馆(剥内外景前缀与时段后缀)。 */
const sceneNameOf = (heading: string): string => {
  const stripped = heading
    .replace(/^\s*(INT\.?|EXT\.?|INT\/EXT\.?|内景|外景|内|外)[\s.:]*/u, '')
    .split(/\s+-\s+/)[0]
    .trim();
  return sanitizeName(stripped || heading.trim());
};

const FALLBACK_STYLE = {
  name: '未设定',
  artStyle: '未设定',
  scenePreset: '未设定',
  promptPrefix: '',
} as const;

const descriptionOfDefault = (img: RefImage): string =>
  img.sourcePrompt ?? img.subject ?? img.name;

const assetOf = (img: RefImage) => ({
  assetId: img.id,
  ...(img.source ? { source: img.source } : {}),
  ...(img.sourcePrompt ? { sourcePrompt: img.sourcePrompt } : {}),
  ...(img.versionGroup ? { versionGroup: img.versionGroup } : {}),
  ...(img.version != null ? { version: img.version } : {}),
});

const cameraFromGraybox = (cam: GrayboxCamera): CameraMove => ({
  shotType: cam.shotType,
  ...(cam.shotDescription ? { description: cam.shotDescription } : {}),
  position: [...cam.position],
  lookAt: [...cam.lookAt],
  movement: {
    type: cam.movement.type,
    duration: cam.movement.duration,
    ...(cam.movement.targetSeconds != null ? { targetSeconds: cam.movement.targetSeconds } : {}),
    ...(cam.movement.path ? { path: cam.movement.path.map(p => [...p] as [number, number, number]) } : {}),
    ...(cam.movement.lookPath ? { lookPath: cam.movement.lookPath.map(p => [...p] as [number, number, number]) } : {}),
  },
  ...(cam.focus ? { focus: cam.focus } : {}),
});

const transitionTypeOf = (content: string): Transition['type'] => {
  const t = content.toUpperCase();
  if (t.includes('MATCH CUT')) return 'match-cut';
  if (t.includes('DISSOLVE') || content.includes('叠化')) return 'dissolve';
  if (t.includes('FADE IN') || content.includes('淡入')) return 'fade-in';
  if (t.includes('FADE OUT') || content.includes('淡出')) return 'fade-out';
  if (t.includes('WIPE') || content.includes('划像')) return 'wipe';
  return 'cut';
};

const statusFromExpress = (s: Screenplay, blockId: string): ShotStatus => {
  const e = s.expressShots?.[blockId];
  if (!e) return 'draft';
  if (e.locked) return 'locked';
  return e.status === 'image-ready' || e.status === 'video-ready' ? 'generated' : 'draft';
};

export const extractStoryFlowIR = (
  screenplay: Screenplay,
  refImages: RefImage[],
  opts: ExtractOptions = {},
): StoryFlowIR => {
  const blocks = screenplay.blocks;
  const blockById = new Map(blocks.map(b => [b.id, b]));
  const blockIdx = new Map(blocks.map((b, i) => [b.id, i]));
  const style = screenplay.metadata.styleHead ?? FALLBACK_STYLE;
  const modeVal = screenplay.productionMode ?? opts.defaultMode ?? 'pro';
  const mode: 'express' | 'pro' =
    modeVal === 'simple' || modeVal === 'express' ? 'express' : 'pro';
  const describe = opts.descriptionOf ?? descriptionOfDefault;

  const plan = planVideoSegments(blocks, opts.targetSeconds ?? 10);
  // 段键 = 段首块 id(live proAudio/segmentGrayboxes 口径)
  const segOf = new Map<string, VideoSegment>();
  for (const seg of plan.segments) {
    for (const id of seg.blockIds) if (!segOf.has(id)) segOf.set(id, seg);
  }
  const segKeyOfBeat = (beat: PlannedBeat): string | undefined =>
    segOf.get(beat.startBlockId)?.blockIds[0];

  // ── shots:PlannedBeat 一一对应 ───────────────────────────────────────────
  const universe = collectCharacterNames(blocks);
  const shots: Shot[] = [];
  const beatByShot = new Map<string, { beat: PlannedBeat; segKey?: string }>();
  const castPairs = new Map<string, { name: string; variant?: string }>();

  const beats: PlannedBeat[] = plan.segments.flatMap(s => s.beats);

  beats.forEach((beat, i) => {
    const shotId = `SHOT_${pad3(i + 1)}`;
    const motionParts = beat.blockIds
      .map(id => blockById.get(id))
      .filter((b): b is ScriptBlock => !!b && b.type === 'ACTION' && !parseBeatTiming(b.content))
      .map(b => b.content.trim());
    const motion = [beat.text, ...motionParts.filter(t => t && t !== beat.text)].join('\n');
    const spanBlocks = beat.blockIds.map(id => blockById.get(id)).filter((b): b is ScriptBlock => !!b);

    // imagePrompt:拍内首块 imagePrompt ?? 前缀+motion;缺前缀治愈
    const imgBlock = spanBlocks.find(b => b.imagePrompt);
    let imagePrompt = imgBlock?.imagePrompt ?? `${style.promptPrefix}${beat.text}`;
    if (style.promptPrefix && !imagePrompt.startsWith(style.promptPrefix)) {
      imagePrompt = style.promptPrefix + imagePrompt;
    }

    // firstFrame:imageResult 回填资产,描述 = subject ?? motion
    const resBlock = spanBlocks.find(b => b.imageResult);
    const firstFrame: FrameDesc = resBlock?.imageResult
      ? {
          description: resBlock.imageResult.subject || motion,
          assetId: resBlock.imageResult.assetId,
        }
      : { description: motion };

    // camera:拍首块 shot graybox ?? 覆盖段的 segment graybox
    const shotCam = spanBlocks.find(b => b.graybox?.kind === 'shot' && b.graybox.camera)?.graybox?.camera;
    const segKey = segKeyOfBeat(beat);
    const segCam = segKey ? screenplay.segmentGrayboxes?.[segKey]?.camera : undefined;
    const camera = shotCam ?? segCam;

    // 台词:首句 → 对白(ttsFloor = ceil(measured+0.3));余句 → 非锚 TtsClip
    const d0 = beat.dialogues[0];
    const beatBlockIdx = blockIdx.get(beat.startBlockId) ?? 0;
    const cast = computeBeatCast(blocks, beatBlockIdx, universe);
    const dialogueCueVariant = (name: string): string | undefined => {
      for (const d of beat.dialogues) {
        if (!d.cue) continue;
        const p = parseCharacterName(d.cue);
        if (p.base === name) return p.variant;
      }
      return undefined;
    };
    for (const name of cast) {
      const variant = resolveBeatVariant(blocks, beatBlockIdx, name) ?? dialogueCueVariant(name);
      const key = variant ? `${name}:${variant}` : name;
      if (!castPairs.has(key)) castPairs.set(key, { name, variant });
    }

    const shot: Shot = {
      id: shotId,
      sequence: i + 1,
      imagePrompt,
      motionPrompt: motion,
      shotDuration: Math.round((beat.end - beat.start) * 1000) / 1000,
      firstFrame,
      refBindings: [], // 下方统一装配(registry id 需先定名)
      ...(camera ? { camera: cameraFromGraybox(camera) } : {}),
      ...(d0?.cue ? { character: parseCharacterName(d0.cue).base } : {}),
      ...(d0 ? {
        dialogue: {
          text: d0.line,
          // audioLowerBoundSeconds 单句口径:ceil(measured + 0.3) —— 恰合
          // P0 示例 3.4→4 / 2.6→3;无探活记录 → 0(未测)
          ttsFloor: (() => {
            const seg = segKey ? screenplay.proAudio?.[segKey] : undefined;
            const rec = seg?.tts?.find(t => t.line === d0.line);
            return rec ? Math.ceil(rec.seconds + 0.3) : 0;
          })(),
        },
      } : {}),
      status: statusFromExpress(screenplay, beat.startBlockId),
    };
    shots.push(shot);
    beatByShot.set(shotId, { beat, segKey });
  });

  // ── refs 注册表 ──────────────────────────────────────────────────────────
  const characters: CharacterRef[] = [];
  for (const { name, variant } of castPairs.values()) {
    const sceneHeading = plan.segments.find(s =>
      s.beats.some(b => b.dialogues.some(d => d.cue && parseCharacterName(d.cue).base === name))
        || s.beats.some(b => computeBeatCast(blocks, blockIdx.get(b.startBlockId) ?? 0, universe).includes(name)),
    )?.sceneHeading;
    const sheet = resolveCharacterSheet(
      name, screenplay.referenceBindings, refImages, sceneHeading, undefined, variant,
    );
    characters.push({
      id: variant ? `char:${sanitizeName(name)}:${sanitizeName(variant)}` : `char:${sanitizeName(name)}`,
      name,
      ...(variant ? { variant } : {}),
      description: sheet ? describe(sheet) : name,
      ...(sheet ? { asset: assetOf(sheet) } : {}),
    });
  }

  // spatial 先于 scene 收集:spatialId 只在布局真实存在时给出(防悬空)
  const spatialNames = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'SCENE_HEADING' && b.graybox?.kind === 'scene') {
      spatialNames.add(sceneNameOf(b.content.trim()));
    }
  }
  const sceneEntries = new Map<string, SceneRef>();
  for (const b of blocks) {
    if (b.type !== 'SCENE_HEADING') continue;
    const heading = b.content.trim();
    const name = sceneNameOf(heading);
    if (sceneEntries.has(name)) continue;
    const env = resolveRefBindings(screenplay.referenceBindings, heading).environment;
    const envImg = env ? refImages.find(r => r.id === env) : undefined;
    sceneEntries.set(name, {
      id: `scene:${name}`,
      name,
      sceneHeading: heading,
      description: envImg ? describe(envImg) : heading,
      ...(spatialNames.has(name) ? { spatialId: `spatial:${name}` } : {}),
    });
  }

  // props / actions:库侧 kind 收录(scriptIds 钉住本稿或全局);styles 无 kind 标记 → 不收(记档)
  const pinned = (img: RefImage): boolean =>
    img.scriptIds == null || img.scriptIds.length === 0 || img.scriptIds.includes(screenplay.id);
  const props: PropRef[] = [];
  const actions: ActionRef[] = [];
  for (const img of refImages) {
    if (!pinned(img)) continue;
    if (img.kind === 'prop') {
      const name = sanitizeName(
        (img.subject?.startsWith('道具:') ? img.subject.slice(3) : img.subject) || img.name,
      );
      props.push({ id: `prop:${name}`, name, description: describe(img), asset: assetOf(img) });
    } else if (img.kind === 'action') {
      const name = sanitizeName(img.name);
      actions.push({ id: `action:${name}`, name, description: describe(img), asset: assetOf(img) });
    }
  }

  // per-shot refBindings:cast(变体化)+ 场景 + 词法 prop/action
  for (const shot of shots) {
    const { beat } = beatByShot.get(shot.id)!;
    const beatBlockIdx = blockIdx.get(beat.startBlockId) ?? 0;
    const refs = new Set<string>();
    const sceneName = sceneNameOf(beat.sceneHeading);
    if (sceneEntries.has(sceneName)) refs.add(`scene:${sceneName}`);
    const cast = computeBeatCast(blocks, beatBlockIdx, universe);
    for (const name of cast) {
      const variant = resolveBeatVariant(blocks, beatBlockIdx, name) ?? beat.dialogues
        .filter(d => d.cue && parseCharacterName(d.cue).base === name)
        .map(d => parseCharacterName(d.cue!).variant)[0];
      refs.add(variant
        ? `char:${sanitizeName(name)}:${sanitizeName(variant)}`
        : `char:${sanitizeName(name)}`);
    }
    for (const p of props) if (shot.motionPrompt.includes(p.name)) refs.add(p.id);
    for (const a of actions) if (shot.motionPrompt.includes(a.name)) refs.add(a.id);
    shot.refBindings = [...refs];
  }

  // ── spatial:scene graybox 1:1 ────────────────────────────────────────────
  const spatial: SpatialLayout[] = [];
  for (const b of blocks) {
    if (b.type !== 'SCENE_HEADING' || b.graybox?.kind !== 'scene') continue;
    const name = sceneNameOf(b.content.trim());
    const objects: SpatialObject[] = (b.graybox.layout ?? []).map(o => ({
      id: o.id,
      type: o.type,
      role: o.role,
      ...(o.label ? { label: o.label } : {}),
      position: [...o.position],
      size: [...o.size],
      ...(o.rotation ? { rotation: [...o.rotation] } : {}),
      ...(o.color ? { color: o.color } : {}),
    }));
    const chars: SpatialCharacter[] = (b.graybox.characters ?? []).map(c => ({
      name: c.name,
      position: [...c.position],
      ...(c.facing != null ? { facing: c.facing } : {}),
      ...(c.pose ? { pose: c.pose } : {}),
    }));
    spatial.push({ id: `spatial:${name}`, sceneHeading: b.content.trim(), objects, characters: chars });
  }

  // ── audio:proAudio → 三轨(词锚反演) ─────────────────────────────────────
  const audio: (TtsClip | BgmClip | SfxClip)[] = [];
  let ttsN = 0;
  let sfxN = 0;
  const shotOfLine = (line: string): Shot | undefined =>
    shots.find(s => s.dialogue?.text === line);
  const segShots = (segKey: string | undefined): Shot[] => {
    if (!segKey) return [];
    const seg = plan.segments.find(s => s.blockIds[0] === segKey);
    if (!seg) return [];
    return seg.blockIds
      .map(id => shots.find(sh => beatByShot.get(sh.id)?.beat.blockIds.includes(id)))
      .filter((s): s is Shot => !!s)
      .filter((s, i, arr) => arr.indexOf(s) === i);
  };

  const bgmByPrompt = new Map<string, { prompt: string; shotIds: string[] }>();
  for (const [segKey, pro] of Object.entries(screenplay.proAudio ?? {}) as [string, ProSegmentAudio][]) {
    const inSeg = segShots(segKey);

    for (const t of pro.tts ?? []) {
      const shot = shotOfLine(t.line) ?? inSeg[0];
      if (!shot) continue;
      ttsN += 1;
      audio.push({
        id: `aud-tts-${pad3(ttsN)}`,
        kind: 'tts',
        shotId: shot.id,
        ...(t.charName ? { character: parseCharacterName(t.charName).base } : {}),
        text: t.line,
        voice: t.voice,
        measuredSeconds: t.seconds,
      });
    }

    if (pro.bgm) {
      const e = bgmByPrompt.get(pro.bgm.prompt) ?? { prompt: pro.bgm.prompt, shotIds: [] };
      e.shotIds.push(...inSeg.map(s => s.id));
      bgmByPrompt.set(pro.bgm.prompt, e);
    }

    const segStart = inSeg[0] ? (beatByShot.get(inSeg[0].id)?.beat.start ?? 0) : 0;
    for (const f of pro.sfx ?? []) {
      const absMs = (segStart + (f.at ?? 0)) * 1000;
      // 归属镜头:绝对时刻落在 [shotStart, shotEnd)
      let target: Shot | undefined;
      for (const s of inSeg) {
        const start = (beatByShot.get(s.id)?.beat.start ?? 0) * 1000;
        const end = (beatByShot.get(s.id)?.beat.end ?? 0) * 1000;
        if (absMs >= start && absMs < end) { target = s; break; }
      }
      target ??= inSeg[inSeg.length - 1];
      if (!target) continue;

      const start = (beatByShot.get(target.id)?.beat.start ?? 0) * 1000;
      const end = (beatByShot.get(target.id)?.beat.end ?? 0) * 1000;
      const offMs = absMs - start;
      const anchorBase = anchorTextOf(target);
      const fit = fitShotDuration(target.shotDuration, target.dialogue?.ttsFloor ?? 0);
      const measured = target.dialogue
        ? Object.entries(screenplay.proAudio ?? {})
            .flatMap(([, p]) => p.tts ?? [])
            .find(t => t.line === target.dialogue!.text)?.seconds
        : undefined;
      const basisMs = (anchorBase.source === 'dialogue' && measured != null
        ? measured
        : fit.wantSeconds) * 1000;

      let anchor: SfxClip['anchor'];
      if (offMs < 1) anchor = { kind: 'shot-start' };
      else if (absMs >= end - 1) anchor = { kind: 'shot-end' };
      else {
        const tokens = splitAnchorWords(anchorBase.text);
        const idx = wordIndexAtMs(tokens, offMs, basisMs);
        anchor = idx != null ? { kind: 'word', wordIndex: idx } : { kind: 'shot-end' };
      }

      sfxN += 1;
      audio.push({
        id: `aud-sfx-${pad3(sfxN)}`,
        kind: 'sfx',
        shotId: target.id,
        name: f.name,
        anchor,
        ...(f.missing != null ? { missing: f.missing } : {}),
      });
    }
  }

  let bgmN = 0;
  const ordered = [...shots].sort((a, b) => a.sequence - b.sequence);
  for (const { prompt, shotIds } of bgmByPrompt.values()) {
    const inSpan = ordered.filter(s => shotIds.includes(s.id));
    if (!inSpan.length) continue;
    bgmN += 1;
    const first = inSpan[0];
    const last = inSpan[inSpan.length - 1];
    audio.push({
      id: `aud-bgm-${pad3(bgmN)}`,
      kind: 'bgm',
      fromShotId: first.id,
      ...(last.id !== first.id ? { toShotId: last.id } : {}),
      prompt,
    });
  }

  // ── transitions:显式 TRANSITION 块 + 场景边界 ─────────────────────────────
  const transitions: Transition[] = [];
  let trN = 0;
  const shotSpanIdx = (shot: Shot): number[] =>
    (beatByShot.get(shot.id)?.beat.blockIds ?? []).map(id => blockIdx.get(id) ?? -1);
  for (const [i, b] of blocks.entries()) {
    if (b.type !== 'TRANSITION') continue;
    const type = transitionTypeOf(b.content);
    const before = ordered.filter(s => shotSpanIdx(s).some(x => x < i)).pop();
    const after = ordered.find(s => shotSpanIdx(s).some(x => x > i));
    trN += 1;
    if (after && before && after.id !== before.id) {
      transitions.push({
        id: `tr-${pad3(trN)}`,
        type,
        from: before.id,
        target: after.id,
      });
    } else if (!after && before) {
      // 片尾转场(FADE OUT 等):叠在末镜上,from 缺省 = 前一镜
      const final = ordered[ordered.length - 1];
      transitions.push({ id: `tr-${pad3(trN)}`, type, target: final.id });
    }
  }
  for (const [i, shot] of ordered.entries()) {
    if (i === 0) continue;
    const prev = ordered[i - 1];
    const prevHeading = beatByShot.get(prev.id)?.beat.sceneHeading;
    const curHeading = beatByShot.get(shot.id)?.beat.sceneHeading;
    if (prevHeading !== curHeading) {
      trN += 1;
      transitions.push({ id: `tr-${pad3(trN)}`, type: 'cut', from: prev.id, target: shot.id });
    }
  }

  return {
    version: IR_VERSION,
    mode,
    title: screenplay.metadata.title,
    style: { ...style },
    refs: {
      characters,
      props,
      scenes: [...sceneEntries.values()],
      styles: [],
      ...(actions.length ? { actions } : {}),
    },
    shots,
    audio,
    transitions,
    spatial,
  };
};
