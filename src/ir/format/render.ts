/**
 * ③声明式格式入口 —— IR → StoryFlowXML(prose-first 成片蓝图/剪辑声明)。
 *
 * SVML 形制(hypit-study.md §2,examples 下各 reference.svml):
 *   · `<script>` 只装叙事真相:词级选择 `@{shot-001}`…`@{/shot-001}`、
 *     词锚时刻 `@{sfx-002!}`、角色 cue(`<role name="陈默">`)、逐字台词/
 *     动作文。铁律:Script reads nothing——script 节内没有时间码/媒体/样式/
 *     生成参数(测试强制断言无 Picture/gain/seconds token)。
 *   · `<generation>/<audio>/<transition>/<film>` 全部**引用** `story.selection.*`
 *     / `story.moment.*` 锚,不回写 script。
 *
 * v0.2(P7,双向互换):增补 style/refs/spatial 声明节与 generation/audio
 * 属性(status/steps/params/帧元数据/white-model/camera/measured-seconds/
 * tts-floor/shot-id)——`parse` 可反演全 IR(双固定点 golden 锁定)。script
 * 节**零增补**,prose-first 不破。
 *
 * 词锚时刻落点 = `splitAnchorWords` 同款分词器的 token 序(wordIndex 与
 * ② 同源);越界词锚**降级**为 `selection.end` 并留 XML 注释(不产生悬空引用,
 * 降级不可逆——记档)。对白锚 clip 以 `text={…dialogue}` 绑定引用 script。
 */
import type { StoryFlowIR, SfxClip, TtsClip, AssetProvenance } from '../types';
import type { StoryFlowXmlOptions, StoryFlowXmlSource } from './types';
import { STORYFLOW_XML_VERSION } from './types';
import { anchorTextOf, splitAnchorWords } from '../shared';

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SHOT_001 → shot-001(选择/时刻 id 的稳定形)。 */
const selId = (shotId: string): string => `shot-${shotId.slice('SHOT_'.length)}`;
/** aud-sfx-002 → sfx-002(时刻 id)。 */
const momentId = (clipId: string): string => clipId.replace(/^aud-/, '');
/** [x,y,z] → "x,y,z"(坐标宪章数值原样)。 */
const vecToStr = (v: readonly number[]): string => v.join(',');

type Marks = Map<number, string[]>;

/** 在 token 前注入词锚时刻标记 `@{id!}`;文本逐字节保留,仅转义 XML 特殊字符。 */
const injectMomentMarks = (text: string, marks: Marks | undefined): string => {
  if (!marks || marks.size === 0) return escapeXml(text);
  const re = /\p{Script=Han}|[\p{Letter}\p{Number}\p{Mark}]+/gu;
  let out = '';
  let last = 0;
  let idx = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const ids = marks.get(idx);
    if (ids) {
      out += escapeXml(text.slice(last, start));
      out += [...ids].sort().map(id => `@{${id}!}`).join('');
      last = start;
    }
    idx++;
  }
  out += escapeXml(text.slice(last));
  return out;
};

const paramTypeOf = (v: string | number | boolean): 'string' | 'number' | 'boolean' =>
  typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';

export const renderStoryFlowXML = (
  ir: StoryFlowIR,
  opts: StoryFlowXmlOptions = {},
): StoryFlowXmlSource => {
  const pretty = opts.pretty ?? false;
  const scriptId = opts.scriptId ?? 'story';
  const orderedShots = [...ir.shots].sort((a, b) => a.sequence - b.sequence);
  const shotById = new Map(orderedShots.map(s => [s.id, s]));

  const lines: { indent: number; text: string }[] = [];
  const push = (indent: number, text: string) => lines.push({ indent, text });

  // ---- 词锚时刻标记收集(按锚基文本归属 motion / dialogue) ----------------
  const motionMarks = new Map<string, Marks>();
  const dialogueMarks = new Map<string, Marks>();
  const degraded: SfxClip[] = [];
  for (const clip of ir.audio) {
    if (clip.kind !== 'sfx' || clip.anchor.kind !== 'word') continue;
    const shot = shotById.get(clip.shotId);
    if (!shot) continue;
    const base = anchorTextOf(shot);
    const tokens = splitAnchorWords(base.text);
    const wordIndex = clip.anchor.wordIndex;
    if (wordIndex >= tokens.length) {
      degraded.push(clip);
      continue;
    }
    const table = base.source === 'dialogue' ? dialogueMarks : motionMarks;
    let marks = table.get(clip.shotId);
    if (!marks) { marks = new Map(); table.set(clip.shotId, marks); }
    const ids = marks.get(wordIndex) ?? [];
    ids.push(momentId(clip.id));
    marks.set(wordIndex, ids);
  }

  // ---- root + <style> -------------------------------------------------------
  push(0, '<?storyflow using="storyflow-ir@0.2"?>');
  push(0, `<storyflow version="${STORYFLOW_XML_VERSION}" mode="${ir.mode}" ir-version="${ir.version}">`);
  push(1, `<style name="${escapeXml(ir.style.name)}" art-style="${escapeXml(ir.style.artStyle)}" scene-preset="${escapeXml(ir.style.scenePreset)}" prompt-prefix="${escapeXml(ir.style.promptPrefix)}"/>`);

  // ---- <script>:叙事真相(唯一语义源;v0.2 零增补) -------------------------
  push(1, `<script id="${escapeXml(scriptId)}">`);
  for (const shot of orderedShots) {
    const sid = selId(shot.id);
    push(2, `@{${sid}}`);
    push(2, injectMomentMarks(shot.motionPrompt, motionMarks.get(shot.id)));
    if (shot.dialogue) {
      push(2, `<role name="${escapeXml(shot.character ?? '')}">${injectMomentMarks(shot.dialogue.text, dialogueMarks.get(shot.id))}</role>`);
    }
    push(2, `@{/${sid}}`);
  }
  push(1, '</script>');

  // ---- <refs>:注册表五类(资产只存 id + 溯源) ------------------------------
  push(1, '<refs>');
  const assetAttrs = (a?: AssetProvenance): string => {
    const out: string[] = [];
    if (a?.assetId) out.push(`asset-id="${escapeXml(a.assetId)}"`);
    if (a?.source) out.push(`source="${escapeXml(a.source)}"`);
    if (a?.sourcePrompt) out.push(`source-prompt="${escapeXml(a.sourcePrompt)}"`);
    if (a?.versionGroup) out.push(`version-group="${escapeXml(a.versionGroup)}"`);
    if (a?.version != null) out.push(`version="${a.version}"`);
    return out.length ? ` ${out.join(' ')}` : '';
  };
  for (const c of ir.refs.characters) {
    const head = `<character id="${escapeXml(c.id)}" name="${escapeXml(c.name)}"`
      + (c.variant ? ` variant="${escapeXml(c.variant)}"` : '') + assetAttrs(c.asset) + '>';
    push(2, head);
    push(3, `<description>${escapeXml(c.description)}</description>`);
    push(2, '</character>');
  }
  for (const p of ir.refs.props) {
    push(2, `<prop id="${escapeXml(p.id)}" name="${escapeXml(p.name)}"${assetAttrs(p.asset)}>`);
    push(3, `<description>${escapeXml(p.description)}</description>`);
    push(2, '</prop>');
  }
  for (const sc of ir.refs.scenes) {
    const head = `<scene id="${escapeXml(sc.id)}" name="${escapeXml(sc.name)}"`
      + (sc.sceneHeading ? ` scene-heading="${escapeXml(sc.sceneHeading)}"` : '')
      + (sc.spatialId ? ` spatial-id="${escapeXml(sc.spatialId)}"` : '')
      + assetAttrs(sc.asset) + '>';
    push(2, head);
    push(3, `<description>${escapeXml(sc.description)}</description>`);
    push(2, '</scene>');
  }
  for (const st of ir.refs.styles) {
    push(2, `<style-ref id="${escapeXml(st.id)}" name="${escapeXml(st.name)}"${assetAttrs(st.asset)}>`);
    push(3, `<description>${escapeXml(st.description)}</description>`);
    push(2, '</style-ref>');
  }
  for (const a of ir.refs.actions ?? []) {
    push(2, `<action id="${escapeXml(a.id)}" name="${escapeXml(a.name)}"${assetAttrs(a.asset)}>`);
    push(3, `<description>${escapeXml(a.description)}</description>`);
    push(2, '</action>');
  }
  push(1, '</refs>');

  // ---- <spatial>:场景空间锚定(坐标宪章原样) -------------------------------
  push(1, '<spatial>');
  for (const sp of ir.spatial) {
    push(2, `<layout id="${escapeXml(sp.id)}" scene-heading="${escapeXml(sp.sceneHeading)}">`);
    for (const o of sp.objects) {
      const attrs = [`id="${escapeXml(o.id)}"`, `type="${o.type}"`, `role="${o.role}"`]
        .concat(o.label ? [`label="${escapeXml(o.label)}"`] : [])
        .concat([
          `position="${vecToStr(o.position)}"`,
          `size="${vecToStr(o.size)}"`,
        ])
        .concat(o.rotation ? [`rotation="${vecToStr(o.rotation)}"`] : [])
        .concat(o.color ? [`color="${escapeXml(o.color)}"`] : []);
      push(3, `<object ${attrs.join(' ')}/>`);
    }
    for (const c of sp.characters) {
      const attrs = [`name="${escapeXml(c.name)}"`, `position="${vecToStr(c.position)}"`]
        .concat(c.facing != null ? [`facing="${c.facing}"`] : [])
        .concat(c.pose ? [`pose="${escapeXml(c.pose)}"`] : []);
      push(3, `<character ${attrs.join(' ')}/>`);
    }
    push(2, '</layout>');
  }
  push(1, '</spatial>');

  // ---- <generation>:生成声明(引用 selection,自带 prompt/refs/参数) ---------
  push(1, '<generation>');
  for (const shot of orderedShots) {
    const sid = selId(shot.id);
    const g = shot.generation;
    const attrs = [
      `ref="{${scriptId}.selection.${sid}}"`,
      `seconds="${shot.shotDuration}"`,
      `status="${shot.status}"`,
    ];
    if (g?.backend) attrs.push(`backend="${g.backend}"`);
    if (g?.seed != null) attrs.push(`seed="${g.seed}"`);
    if (g?.steps != null) attrs.push(`steps="${g.steps}"`);
    push(2, `<shot ${attrs.join(' ')}>`);
    const ffAttrs = (shot.firstFrame.description ? ` description="${escapeXml(shot.firstFrame.description)}"` : '')
      + (shot.firstFrame.assetId ? ` asset-id="${escapeXml(shot.firstFrame.assetId)}"` : '');
    push(3, `<first-frame${ffAttrs}>${escapeXml(shot.imagePrompt)}</first-frame>`);
    if (shot.lastFrame) {
      push(3, `<last-frame${shot.lastFrame.assetId ? ` asset-id="${escapeXml(shot.lastFrame.assetId)}"` : ''}>${escapeXml(shot.lastFrame.description)}</last-frame>`);
    }
    if (shot.whiteModel) {
      push(3, `<white-model${shot.whiteModel.assetId ? ` asset-id="${escapeXml(shot.whiteModel.assetId)}"` : ''} duration-seconds="${shot.whiteModel.durationSeconds}"/>`);
    }
    if (shot.camera) {
      const cam = shot.camera;
      const camAttrs = [`shot-type="${cam.shotType}"`]
        .concat(cam.description ? [`description="${escapeXml(cam.description)}"`] : [])
        .concat([
          `position="${vecToStr(cam.position)}"`,
          `look-at="${vecToStr(cam.lookAt)}"`,
        ])
        .concat(cam.focus ? [`focus="${escapeXml(cam.focus)}"`] : []);
      push(3, `<camera ${camAttrs.join(' ')}>`);
      const mv = cam.movement;
      const mvAttrs = [`type="${mv.type}"`, `duration="${mv.duration}"`]
        .concat(mv.targetSeconds != null ? [`target-seconds="${mv.targetSeconds}"`] : []);
      push(4, `<movement ${mvAttrs.join(' ')}>`);
      if (mv.path?.length) {
        push(5, '<path>');
        for (const p of mv.path) push(6, `<point>${vecToStr(p)}</point>`);
        push(5, '</path>');
      }
      if (mv.lookPath?.length) {
        push(5, '<look-path>');
        for (const p of mv.lookPath) push(6, `<point>${vecToStr(p)}</point>`);
        push(5, '</look-path>');
      }
      push(4, '</movement>');
      push(3, '</camera>');
    }
    for (const [k, v] of Object.entries(g?.vendor ?? {})) {
      push(3, `<param name="${escapeXml(k)}" value="${escapeXml(String(v))}" type="${paramTypeOf(v)}"/>`);
    }
    for (const refId of shot.refBindings) push(3, `<ref>${escapeXml(refId)}</ref>`);
    push(2, '</shot>');
  }
  push(1, '</generation>');

  // ---- <audio>:三轨声明(对白绑 script,时刻绑 moment/selection 端点) ------
  push(1, '<audio>');
  for (const clip of ir.audio) {
    if (clip.kind === 'tts') {
      const shot = shotById.get(clip.shotId);
      const isAnchor = !!shot?.dialogue && clip.text === shot.dialogue.text;
      const attrs = [
        `id="${escapeXml(clip.id)}"`,
        `shot-id="${escapeXml(clip.shotId)}"`,
      ];
      if (isAnchor) attrs.push(`text="{${scriptId}.selection.${selId(clip.shotId)}.dialogue}"`);
      if (clip.character) attrs.push(`role="${escapeXml(clip.character)}"`);
      attrs.push(`voice="${escapeXml(clip.voice)}"`);
      if (clip.speed != null) attrs.push(`speed="${clip.speed}"`);
      if (clip.volume != null) attrs.push(`volume="${clip.volume}"`);
      if (clip.watermark != null) attrs.push(`watermark="${clip.watermark}"`);
      if (clip.gain != null) attrs.push(`gain="${clip.gain}"`);
      if (clip.measuredSeconds != null) attrs.push(`measured-seconds="${clip.measuredSeconds}"`);
      if (isAnchor && shot?.dialogue) attrs.push(`tts-floor="${shot.dialogue.ttsFloor}"`);
      push(2, isAnchor
        ? `<tts ${attrs.join(' ')}/>`
        : `<tts ${attrs.join(' ')}>${escapeXml((clip as TtsClip).text)}</tts>`);
      continue;
    }
    if (clip.kind === 'bgm') {
      const attrs = [
        `id="${escapeXml(clip.id)}"`,
        `from="{${scriptId}.selection.${selId(clip.fromShotId)}}"`,
      ];
      if (clip.toShotId) attrs.push(`to="{${scriptId}.selection.${selId(clip.toShotId)}}"`);
      if (clip.loop != null) attrs.push(`loop="${clip.loop}"`);
      if (clip.gain != null) attrs.push(`gain="${clip.gain}"`);
      push(2, `<bgm ${attrs.join(' ')}>${escapeXml(clip.prompt)}</bgm>`);
      continue;
    }
    // sfx
    const sid = selId(clip.shotId);
    let at: string;
    if (clip.anchor.kind === 'shot-start') {
      at = `{${scriptId}.selection.${sid}.start}`;
    } else if (clip.anchor.kind === 'shot-end') {
      at = `{${scriptId}.selection.${sid}.end}`;
    } else if (degraded.includes(clip)) {
      push(2, `<!-- SFX_ANCHOR_OUT_OF_RANGE: ${escapeXml(clip.id)} 词锚越界,降级为 selection.end -->`);
      at = `{${scriptId}.selection.${sid}.end}`;
    } else {
      at = `{${scriptId}.moment.${momentId(clip.id)}}`;
    }
    const attrs = [
      `id="${escapeXml(clip.id)}"`,
      `at="${at}"`,
      `name="${escapeXml(clip.name)}"`,
    ];
    if (clip.missing != null) attrs.push(`missing="${clip.missing}"`);
    if (clip.gain != null) attrs.push(`gain="${clip.gain}"`);
    push(2, `<sfx ${attrs.join(' ')}/>`);
  }
  push(1, '</audio>');

  // ---- <transition>:剪辑转场(成片剪辑声明) -------------------------------
  push(1, '<transition>');
  for (const t of ir.transitions) {
    const target = shotById.get(t.target);
    if (!target) continue;
    // from 仅显式存在时发射——「缺省 = 前一镜」的省略语义必须原样保留(round-trip)
    const attrs: string[] = [];
    if (t.from) attrs.push(`from="{${scriptId}.selection.${selId(t.from)}}"`);
    attrs.push(`to="{${scriptId}.selection.${selId(t.target)}}"`);
    if (t.durationSeconds != null) attrs.push(`seconds="${t.durationSeconds}"`);
    push(2, `<${t.type} ${attrs.join(' ')}/>`);
  }
  push(1, '</transition>');

  // ---- <film>:成片剪辑顺序 -------------------------------------------------
  push(1, `<film id="final" title="${escapeXml(ir.title)}">`);
  for (const shot of orderedShots) {
    push(2, `<clip ref="{${scriptId}.selection.${selId(shot.id)}}"/>`);
  }
  push(1, '</film>');
  push(0, '</storyflow>');

  return lines.map(l => (pretty ? '  '.repeat(l.indent) + l.text : l.text)).join('\n');
};
