import { GrayboxCamera, GrayboxCharacter } from '../types';

/**
 * White-model video export prompts — Seedance 2.5 and MiniMax H3.
 *
 * The StoryFlow graybox pipeline ends in a white-model (白模) reference video:
 * the shot rendered from ITS OWN camera through the scene layout, with
 * characters as distinctly-colored capsules. That video is uploaded to a
 * video model (即梦/Seedance 2.5, or MiniMax H3) alongside reference images,
 * and the model reproduces the camera language + blocking while rendering
 * real materials from the images.
 *
 * These builders assemble the companion prompt from local data only — no AI
 * call. Both target platforms are Chinese-first, and the capsule-color names
 * the model must read are Chinese ("蓝色胶囊体"), so the generated prompt is
 * deliberately Chinese regardless of UI language.
 */

/** Stable capsule colors for white-model export. The COLOR NAME is what the
 *  video model reads in the prompt ("蓝色胶囊体 → @图片1"), so the renderer
 *  and the prompt builder MUST share this table. Index = character order in
 *  the scene's blocking (position, not importance — keep it deterministic). */
export const WHITE_MODEL_CHAR_COLORS = [
  { hex: '#2563eb', zh: '蓝色' },
  { hex: '#dc2626', zh: '红色' },
  { hex: '#16a34a', zh: '绿色' },
  { hex: '#ea580c', zh: '橙色' },
  { hex: '#9333ea', zh: '紫色' },
  { hex: '#0891b2', zh: '青色' },
  { hex: '#db2777', zh: '粉色' },
  { hex: '#65a30d', zh: '黄绿色' },
] as const;

/** Color for character at blocking index `i` (wraps after 8). */
export const whiteModelCharColor = (i: number): { hex: string; zh: string } =>
  WHITE_MODEL_CHAR_COLORS[i % WHITE_MODEL_CHAR_COLORS.length];

export interface WhiteModelPromptInput {
  /** The beat's block content (the ACTION / DIALOGUE text). */
  beatContent: string;
  /** The beat's block type — DIALOGUE beats get spoken-line framing so H3's
   *  native audio voices them with lip sync. */
  beatType?: string;
  /** The shot camera (shotType, shotDescription, movement duration). */
  camera: GrayboxCamera;
  /** The scene's character blocking — drives the capsule→image mapping. */
  characters: GrayboxCharacter[];
  /** Owning scene heading text, for environment context. */
  sceneHeading?: string;
  /** Style keywords injected into the style-lock lines. Defaults to a
   *  neutral "realistic film" when omitted. */
  styleHint?: string;
  /** Bound reference images: character name -> image file name. When
   *  provided, only bound characters enter the @图片N mapping (numbered in
   *  binding order) and the env image takes the next number. Characters
   *  without a binding are called out so the user notices. When omitted,
   *  the legacy behavior applies (number all characters generically). */
  characterImages?: Record<string, string>;
  /** Bound environment/style image file name (takes the last slot). */
  environmentImage?: string;
}

/** Style presets for the prompt modal (product spec appendix B). The zh
 *  keywords ride into the generated prompt verbatim — both target models
 *  are Chinese-first. */
export const WHITE_MODEL_STYLE_TEMPLATES = [
  { id: 'realistic', zh: '写实影视', keywords: '写实影视质感，自然光影' },
  { id: 'xianxia', zh: '仙侠对峙', keywords: '仙侠、肃杀、冷色调、古风' },
  { id: 'battle', zh: '战斗爆发', keywords: '热血、快节奏、粒子特效、动态模糊' },
  { id: 'scenery', zh: '风景叙事', keywords: '宏大、静谧、自然光、壮丽' },
  { id: 'emotional', zh: '情感对话', keywords: '温暖、柔光、微表情、细腻' },
  { id: 'awakening', zh: '奇幻觉醒', keywords: '玄幻、发光、能量流动、震撼' },
] as const;

const styleOf = (input: WhiteModelPromptInput): string =>
  input.styleHint?.trim() || '写实影视质感';

const fmtSeconds = (s: number): string => {
  const v = Math.round(s * 10) / 10;
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}s`;
};

/** One timestamped action line shared by both templates. DIALOGUE beats are
 *  framed as SPOKEN lines — H3 generates native audio with lip sync, so the
 *  verbatim line + delivery intent is what voices the character. */
const beatLine = (input: WhiteModelPromptInput): string => {
  const dur = Math.max(0.5, input.camera.movement?.duration ?? 0);
  const desc = input.camera.shotDescription?.trim();
  const beat = input.beatContent.trim();
  if (input.beatType === 'DIALOGUE') {
    const delivery = desc ? `（${desc}）` : '';
    return `0-${fmtSeconds(dur)}：画面中角色开口说出这句对白（原声人声、口型同步、对白逐字一致）：「${beat}」${delivery}`;
  }
  const core = desc ? `${beat}（镜头意图：${desc}）` : beat;
  return `0-${fmtSeconds(dur)}：${core}`;
};

/** H3 renders native stereo audio — one guiding soundscape line. */
const soundscapeLine = (input: WhiteModelPromptInput): string =>
  input.beatType === 'DIALOGUE'
    ? '音景：环境声贴合场景氛围，对白为清晰近讲人声并口型同步，声画同步收束。'
    : '音景：环境声与动作音效贴合画面（风沙/马蹄/金属等按场景），无对白。';

/** Capsule → reference-image mapping lines (shared shape, target-specific
 *  reference syntax). Character images are numbered 1..N in binding order;
 *  the environment image takes the next number.
 *
 *  Capsule COLORS stay assigned by blocking INDEX (matching the 3D render),
 *  so a bound character keeps the color it wears on screen even when earlier
 *  characters are unbound. When `characterImages` is omitted entirely, the
 *  legacy generic numbering applies (all characters, placeholders). */
const mappingLines = (
  input: WhiteModelPromptInput,
  ref: (n: number) => string,
): { lines: string[]; envImageNo: number; boundNames: string[] } => {
  const { characters, characterImages } = input;
  const capped = characters.slice(0, 8);

  if (!characterImages) {
    const lines = capped.map((c, i) =>
      `- ${whiteModelCharColor(i).zh}胶囊体 → ${ref(i + 1)} 的「${c.name}」`);
    return { lines, envImageNo: capped.length + 1, boundNames: capped.map((c) => c.name) };
  }

  const bound = capped
    .map((c, i) => ({ c, color: whiteModelCharColor(i).zh, fileName: characterImages[c.name] }))
    .filter((x) => !!x.fileName);
  const unbound = capped.filter((c) => !characterImages[c.name]);

  const lines = bound.map((x, n) =>
    `- ${x.color}胶囊体 → ${ref(n + 1)} 的「${x.c.name}」（图片文件：${x.fileName}）`);
  if (unbound.length) {
    lines.push(`- （未绑定参考图：${unbound.map((c) => c.name).join('、')}——上传并绑定后自动进入映射）`);
  }
  return { lines, envImageNo: bound.length + 1, boundNames: bound.map((x) => x.c.name) };
};

/**
 * Seedance 2.5 template — 即梦's @引用 syntax (@视频1 / @图片N).
 * Shape follows the official 粗粒度白模 guidance: lock the camera structure
 * to the white-model video, map capsules to reference images, forbid
 * helper artifacts from leaking into the render.
 */
export const buildSeedancePrompt = (input: WhiteModelPromptInput): string => {
  const { lines, envImageNo } = mappingLines(input, (n) => `@图片${n}`);
  const envRef = `@图片${envImageNo}`;
  const envName = input.environmentImage ? `（图片文件：${input.environmentImage}）` : '';
  const scene = input.sceneHeading?.trim();

  return [
    '参考 @视频1 的运镜、镜头节奏、景别变化与镜头调度，',
    '严格保持白模视频的镜头结构、机位运动方式与节奏，不改变镜头，不新增镜头。',
    '',
    beatLine(input),
    '',
    '白模角色映射：',
    ...(lines.length ? lines : ['- （白模中无角色胶囊体，仅场景空镜）']),
    `灰色几何体为场景陈设与地形，按 ${envRef}${envName} 的环境风格渲染。`,
    '',
    `场景使用 ${envRef}${envName} 的${scene ? `「${scene}」` : ''}环境风格，整体保持${styleOf(input)}。`,
    '全程保持角色身份、服装、比例、站位逻辑与动作连续；',
    '不保留白模材质、网格线、轨迹线或任何辅助标记。',
  ].join('\n');
};

/**
 * MiniMax H3 template — H3's Ref2VA takes numbered materials without @
 * syntax ("图片1 控制角色，视频1 控制运镜"). Same skeleton, expressed in
 * H3's 素材分工 idiom.
 */
export const buildH3Prompt = (input: WhiteModelPromptInput): string => {
  const { lines, envImageNo, boundNames } = mappingLines(input, (n) => `图片${n}`);
  const envNo = envImageNo;
  const envName = input.environmentImage ? `（${input.environmentImage}）` : '';

  const rolePart = boundNames.length
    ? boundNames.map((name, i) => `图片${i + 1} 控制角色「${name}」`).join('；')
    : '';
  const duty = [
    '视频1 控制运镜、镜头节奏与角色走位',
    ...(rolePart ? [rolePart] : []),
    `图片${envNo} 控制场景风格`,
  ].join('；');

  return [
    `素材分工：${duty}。`,
    ...(lines.length
      ? ['视频1 白模中：' + lines.map((l) => l.replace(/^- /, '').replace(/→/, '对应')).join('；') + '；灰色几何体为场景陈设。']
      : ['视频1 白模中无角色，仅场景空镜；灰色几何体为场景陈设。']),
    '',
    beatLine(input),
    soundscapeLine(input),
    '',
    `请严格保持参考视频的运镜轨迹、机位节奏与角色站位；场景风格参考图片${envNo}${envName}${input.sceneHeading?.trim() ? `（${input.sceneHeading.trim()}）` : ''}。`,
    `全程保持角色形象、服装与比例一致，输出${styleOf(input)}；画面中不出现网格、轨迹线或任何辅助元素。`,
  ].join('\n');
};

/**
 * Clipboard write with a non-secure-context fallback. StoryFlow is often
 * opened over LAN (http://192.168.x.x:5173), where navigator.clipboard is
 * undefined — fall back to the deprecated-but-working execCommand path so
 * copy still works there.
 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};
