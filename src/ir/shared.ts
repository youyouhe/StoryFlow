/**
 * P1 三路共享原语 —— ①⇄② 缝合不变量的唯一实现处。
 *
 * 边界规则(docs/storyflow-ir-p1.md §1):`src/ir/` 树不 import `services/`/
 * `utils/`/`hooks/`(避免 non-strict 模块把 strict 门禁面撑大)。历史实现里
 * 的纯规则在此以**本地纯拷贝**复刻,每处注明提取源;与源实现的有意偏离在
 * docs/storyflow-ir-p1.md §3 记档。
 */

/** 模型输出窗上下限(H3 单请求 4–15s)。提取源:utils/proAudio.ts:15-16、
 *  utils/grayboxPlan.ts:59-62、services/minimaxService.ts validateH3Submission。 */
export const MODEL_MIN_SECONDS = 4;
export const MODEL_MAX_SECONDS = 15;

/** 钳制到 [min, max] 并取整。提取源:utils/videoSegmentSubmit.ts:15-16
 *  (clampSegmentSeconds),统一为通用原语。 */
export const clampSeconds = (d: number, min = MODEL_MIN_SECONDS, max = MODEL_MAX_SECONDS): number =>
  Math.min(Math.max(Math.round(d), min), max);

/** 词锚基文本的来源。 */
export type AnchorSource = 'dialogue' | 'motion';

/** 词锚基文本(锚定契约,src/ir/types.ts SfxAnchor 注释):
 *  `dialogue.text` 有对白时,否则 `motionPrompt`。**逐字节等于 IR 字段**——
 *  不 trim、不改写、不加前缀;① 的每个 video job 原样携带,② 的 wordIndex
 *  只对本文本分词,永不对组装后的 prompt 分词。 */
export const anchorTextOf = (shot: {
  dialogue?: { text: string };
  motionPrompt: string;
}): { text: string; source: AnchorSource } =>
  shot.dialogue ? { text: shot.dialogue.text, source: 'dialogue' }
    : { text: shot.motionPrompt, source: 'motion' };

/**
 * 锚定分词器(P1 钉死,docs/storyflow-ir-p1.md §3):
 *   · 中文逐字(每个 CJK 表意文字 = 1 token)
 *   · 英文/数字按空白分词(连续字母数字串 = 1 token)
 *   · **标点与空白不产 token**(对齐 Hypit 语义:「标点不是语音 token」,
 *     hypit-study.md §2.2)
 * 0 起下标。`SfxAnchor.word.wordIndex` 即指向下标。
 */
export const splitAnchorWords = (text: string): string[] =>
  text.match(/\p{Script=Han}|[\p{Letter}\p{Number}\p{Mark}]+/gu) ?? [];

/** 单链元时长拟合(§3 钉死规则):
 *  `want = max(shotDuration, ttsFloor)`,`outputSeconds = clamp(round(want), 4, 15)`;
 *  `ttsFloor > 15` → audioTooLong。站长规则:TTS 时长是镜头输出下限,镜头
 *  永不切掉对白。**有意偏离** utils/proAudio.ts:37-46 的 fitSegmentSeconds
 *  (有对白时忽略 requested,且实测零调用方)——差异记档于 docs/storyflow-ir-p1.md §3。 */
export interface DurationFit {
  /** max(round(shotDuration), lowerBound) —— 拟合前的需求时长。 */
  wantSeconds: number;
  /** 单链元钳制结果([4,15] 整数秒)。 */
  outputSeconds: number;
  /** lowerBound 超模型窗上限(15s)。 */
  audioTooLong: boolean;
  /** TTS 时长下限(0 = 无对白)。 */
  lowerBound: number;
}

export const fitOutputSeconds = (shotDuration: number, ttsFloor = 0): DurationFit => {
  const lowerBound = Math.max(0, ttsFloor);
  const wantSeconds = Math.max(Math.round(shotDuration), lowerBound);
  return {
    wantSeconds,
    outputSeconds: clampSeconds(wantSeconds),
    audioTooLong: lowerBound > MODEL_MAX_SECONDS,
    lowerBound,
  };
};

/** 生成链元(超窗镜头拆链)。 */
export interface ChainLink {
  /** 1 起。 */
  chainIndex: number;
  chainCount: number;
  /** 该链元生成时长(秒,[4,15] 整数)。 */
  outputSeconds: number;
  /** 故事时长内偏移(秒),累计。 */
  offsetSeconds: number;
}

/**
 * 超窗拆链 —— 等分余数前置规则,复刻 utils/grayboxPlan.ts:110-127
 * (planSegments 的 chain 分支):n = ⌈T/15⌉,base = ⌊round(T)/n⌋,余数 +1
 * 摊到前 rem 个链元,各钳 [4,15],offset 累计。仅当 T > 15 调用;≤15 由
 * fitOutputSeconds 出单链元。故事时长神圣:ttsFloor 不膨胀链总长。
 */
export const chainSegments = (shotDuration: number): ChainLink[] => {
  const T = shotDuration;
  const n = Math.ceil(T / MODEL_MAX_SECONDS);
  const totalRounded = Math.round(T);
  const base = Math.floor(totalRounded / n);
  const rem = totalRounded - base * n;
  const ints: number[] = new Array(n).fill(base);
  for (let i = 0; i < rem; i++) ints[i] += 1;
  const clamped = ints.map(s => clampSeconds(s));
  let off = 0;
  return clamped.map((sec, i) => {
    const link: ChainLink = {
      chainIndex: i + 1,
      chainCount: clamped.length,
      outputSeconds: sec,
      offsetSeconds: off,
    };
    off += sec;
    return link;
  });
};

/** 镜头级时长拟合(①②共用的缝合形状):单窗 1 链元,超窗拆链。 */
export interface ShotDurationFit {
  /** max(round(shotDuration), lowerBound)。 */
  wantSeconds: number;
  /** 生成链元(≥1;单镜 = 1 元)。对白挂链元 1。 */
  chain: ChainLink[];
  /** ttsFloor > 15。 */
  audioTooLong: boolean;
  /** TTS 时长下限(0 = 无对白)。 */
  lowerBound: number;
}

export const fitShotDuration = (shotDuration: number, ttsFloor = 0): ShotDurationFit => {
  const fit = fitOutputSeconds(shotDuration, ttsFloor);
  const chain = shotDuration > MODEL_MAX_SECONDS
    ? chainSegments(shotDuration)
    : [{ chainIndex: 1, chainCount: 1, outputSeconds: fit.outputSeconds, offsetSeconds: 0 }];
  return {
    wantSeconds: fit.wantSeconds,
    chain,
    audioTooLong: fit.audioTooLong,
    lowerBound: fit.lowerBound,
  };
};

// ── 词锚正/反推(字素比例分窗)──────────────────────────────────────────────

/** 词 i 的窗口起点(毫秒)—— ② 正向推导;token 权重 = 码点数。 */
export const wordStartMs = (tokens: string[], wordIndex: number, basisMs: number): number => {
  const weights = tokens.map(t => [...t].length);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const before = weights.slice(0, wordIndex).reduce((a, b) => a + b, 0);
  return Math.round((before / total) * basisMs);
};

/** 词锚反演(毫秒偏移 → wordIndex)—— wordStartMs 的逆(P4 提取层恢复
 *  proAudio 秒偏移的锚点)。落在含 `atMs` 的 token 窗;越界兜底末词。 */
export const wordIndexAtMs = (tokens: string[], atMs: number, basisMs: number): number | null => {
  const weights = tokens.map(t => [...t].length);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < tokens.length; i++) {
    const end = ((acc + weights[i]) / total) * basisMs;
    if (atMs < end) return i;
    acc += weights[i];
  }
  return tokens.length - 1;
};
