/**
 * 创作注释契约(P10,docs/storyflow-ir-p10.md)—— 校时校正表 + 价目表的
 * **随稿持久化形状**。注释 ≠ 剧情:不进 StoryFlowIR 主体(它们描述「怎么
 * 编译/怎么记账」,不是「片子是什么」),独立文档随稿持久化,可选拨载进
 * StoryFlowXML v0.3 `<annotations>` 节。
 *
 * 归属键 = clipId(P7 round-trip 后 clip id 由 XML id 属性原样恢复,注释
 * 跨 round-trip 稳定)。费率输入制:分整数,provider 刊例声明(P0 规则三;
 * P9 PriceBooks 自 exec/pricing 上浮至此,exec 侧 re-export 兼容)。
 */
import { z } from 'zod';

import type { WordTimingCorrection } from './audio/timing';

export const ANNOTATIONS_VERSION = '0.1.0';

/** 价目表(P9 契约上浮;provider 刊例声明,分整数;缺任一价目 = 该类回退 unpriced)。 */
export interface PriceBooks {
  /** 生图:每张(每 image job 一张,① opts.n=1 口径)。 */
  image?: { perImageFen: number };
  /** TTS:每字符(实际合成文本用量,TtsJob.text 的 UTF-16 码元数)。 */
  tts?: { perCharFen: number };
  /** BGM:每次请求(每床一条)。 */
  bgm?: { perRequestFen: number };
}

/** 创作注释文档(随稿持久化)。 */
export interface StoryFlowAnnotations {
  version: typeof ANNOTATIONS_VERSION;
  /** clipId → 校时窗(作者写入;applyManualTiming 的持久化形态)。 */
  timing: Record<string, WordTimingCorrection[]>;
  /** 随稿费率(P9 精确结算/预算口径的费率源)。 */
  priceBooks?: PriceBooks;
}

// ── zod(运行时校验) ───────────────────────────────────────────────────────

const correctionSchema = z.strictObject({
  tokenIndex: z.number().int().min(0),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
}).refine(c => c.endMs > c.startMs, { message: '校时窗非法:endMs 必须大于 startMs' });

const priceBooksSchema = z.strictObject({
  image: z.strictObject({ perImageFen: z.number().int().min(0) }).optional(),
  tts: z.strictObject({ perCharFen: z.number().int().min(0) }).optional(),
  bgm: z.strictObject({ perRequestFen: z.number().int().min(0) }).optional(),
});

export const storyFlowAnnotationsSchema = z.strictObject({
  version: z.literal(ANNOTATIONS_VERSION),
  timing: z.record(z.string(), z.array(correctionSchema)),
  priceBooks: priceBooksSchema.optional(),
});

export type AnnotationsValidation =
  | { ok: true; annotations: StoryFlowAnnotations }
  | { ok: false; issues: string[] };

/** 门禁式校验(工具/parse 用)。 */
export const validateAnnotations = (input: unknown): AnnotationsValidation => {
  const r = storyFlowAnnotationsSchema.safeParse(input);
  if (r.success) return { ok: true, annotations: r.data as StoryFlowAnnotations };
  return {
    ok: false,
    issues: r.error.issues.map(i => {
      const path = i.path.length ? `${i.path.map(String).join('.')}: ` : '';
      return `${path}${i.message}`;
    }),
  };
};

// ── JSON 侧车(序列化/解析;文件 IO 属 app 侧) ─────────────────────────────

export const serializeAnnotations = (a: StoryFlowAnnotations): string =>
  JSON.stringify(a, null, 2);

export const parseAnnotations = (input: unknown): StoryFlowAnnotations => {
  const v = validateAnnotations(input);
  // 本仓库 root tsconfig 不开 strictNullChecks——布尔判别联合不窄化(同
  // tests/ir-schema.test.ts 备注),运行时已由 throw 保证失败分支。
  if (!v.ok) throw new Error(`创作注释非法:\n${(v as { issues: string[] }).issues.join('\n')}`);
  return v.annotations;
};

// ── 防漂移断言(仅 strict 下武装,同 src/ir/schema.ts 模式) ─────────────────

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type NullChecksOn = [undefined] extends [1] ? false : true;
type Guard<T> = NullChecksOn extends true ? T : true;
type InferOf<T extends z.ZodType> = z.infer<T>;

const _assertAnnotations: Guard<Equal<StoryFlowAnnotations, InferOf<typeof storyFlowAnnotationsSchema>>> = true;
const _assertBooks: Guard<Equal<PriceBooks, InferOf<typeof priceBooksSchema>>> = true;

export const ANNOTATIONS_TYPE_GUARDS_VERIFIED = [_assertAnnotations, _assertBooks] as const;
