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
 * v0.1 语法要点(对齐边界契约 §2.3):
 *   · 词锚时刻落点 = `splitAnchorWords` 同款分词器的 token 序(wordIndex 与
 *     ② 同源);越界词锚**降级**为 `selection.end` 并留 XML 注释(不产生悬空引用)。
 *   · 对白锚 clip(text 逐字 = dialogue.text)以 `text={…dialogue}` 绑定引用
 *     script,不复制正文;非锚行内嵌文本。
 *   · `||`/Dual Text 是作者声明的显读分离,IR 尚无对应字段——v0.1 不产出
 *     (additive 扩展位)。
 */
import type { StoryFlowIR, SfxClip } from '../types';
import type { StoryFlowXmlOptions, StoryFlowXmlSource } from './types';
import { STORYFLOW_XML_VERSION } from './types';
import { anchorTextOf, splitAnchorWords } from '../shared';

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SHOT_001 → shot-001(选择/时刻 id 的稳定形)。 */
const selId = (shotId: string): string => `shot-${shotId.slice('SHOT_'.length)}`;
/** aud-sfx-002 → sfx-002(时刻 id)。 */
const momentId = (clipId: string): string => clipId.replace(/^aud-/, '');

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

  // ---- <script>:叙事真相(唯一语义源) --------------------------------------
  push(0, '<?storyflow using="storyflow-ir@0.1"?>');
  push(0, `<storyflow version="${STORYFLOW_XML_VERSION}">`);
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

  // ---- <generation>:生成声明(引用 selection,自带 prompt/refs/参数) ---------
  push(1, '<generation>');
  for (const shot of orderedShots) {
    const sid = selId(shot.id);
    const g = shot.generation;
    const attrs = [
      `ref="{${scriptId}.selection.${sid}}"`,
      `seconds="${shot.shotDuration}"`,
    ];
    if (g?.backend) attrs.push(`backend="${g.backend}"`);
    if (g?.seed != null) attrs.push(`seed="${g.seed}"`);
    push(2, `<shot ${attrs.join(' ')}>`);
    push(3, `<first-frame>${escapeXml(shot.imagePrompt)}</first-frame>`);
    if (shot.lastFrame) push(3, `<last-frame>${escapeXml(shot.lastFrame.description)}</last-frame>`);
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
      const attrs = [`id="${escapeXml(clip.id)}"`];
      if (isAnchor) attrs.push(`text="{${scriptId}.selection.${selId(clip.shotId)}.dialogue}"`);
      if (clip.character) attrs.push(`role="${escapeXml(clip.character)}"`);
      attrs.push(`voice="${escapeXml(clip.voice)}"`);
      if (clip.speed != null) attrs.push(`speed="${clip.speed}"`);
      if (clip.volume != null) attrs.push(`volume="${clip.volume}"`);
      if (clip.watermark != null) attrs.push(`watermark="${clip.watermark}"`);
      if (clip.gain != null) attrs.push(`gain="${clip.gain}"`);
      push(2, isAnchor
        ? `<tts ${attrs.join(' ')}/>`
        : `<tts ${attrs.join(' ')}>${escapeXml(clip.text)}</tts>`);
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
    const idx = orderedShots.indexOf(target);
    const fromId = t.from ?? (idx > 0 ? orderedShots[idx - 1].id : undefined);
    const attrs: string[] = [];
    if (fromId) attrs.push(`from="{${scriptId}.selection.${selId(fromId)}}"`);
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
