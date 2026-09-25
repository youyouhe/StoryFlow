/**
 * ③声明式格式(StoryFlowXML/蓝图层)—— 边界契约(P1 三路之一,
 * docs/storyflow-ir-p1.md §2.3)。对标 Hypit SVML 的 prose-first 设计
 * (/home/git/orca/workspaces/hypit/study/docs/hypit-study.md §2):
 *
 *   · `<script>` 只装「说了什么」(角色 cue / `||` 断句 / Dual Text 显读分离 /
 *     Selection `@{id}`…`@{/id}` / Moment `@{id!}`;词级锚定,标点无 token)
 *   · 生成 / 音轨 / 转场 / 成片声明全部**引用** `story.*` 锚——
 *     「Everything else in the pipeline reads the Script; the Script reads nothing.」
 *
 * v0.2(P7)是**双向互换**:parse.ts 反演全 IR,双固定点 golden 锁定
 * (成片蓝图声明的角色不变——与命令式 ffmpeg 相对)。
 */

/** 0.3.0(P10):`<annotations>` 可选节(校时/费率随稿携带;v0.2 照常解析)。 */
export const STORYFLOW_XML_VERSION = '0.3.0';
export type StoryFlowXmlVersion = typeof STORYFLOW_XML_VERSION;

import type { StoryFlowAnnotations } from '../annotations';

/** StoryFlowXML 源文本(prose-first XML;处理指令
 *  `<?storyflow using="storyflow-ir@0.3"?>` 起头)。 */
export type StoryFlowXmlSource = string;

export interface StoryFlowXmlOptions {
  /** 缩进美化输出(缺省 false = 紧凑)。 */
  pretty?: boolean;
  /** `<script>` 的 id(缺省 'story',锚前缀 `story.*` 据此生成)。 */
  scriptId?: string;
  /** P10 创作注释(校时/费率)随 XML 携带;缺省不发射。 */
  annotations?: StoryFlowAnnotations;
}
