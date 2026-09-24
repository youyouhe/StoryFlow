/**
 * ③声明式格式入口(P1-③ 边界桩)——签名锁定,实现归 ③ 实例。
 *
 * 产出 StoryFlowXML(prose-first 蓝图/成片剪辑声明):SVML 形制,
 * 语法骨架与验收 golden 见 docs/storyflow-ir-p1.md §2.3/§5。
 */
import type { StoryFlowIR } from '../types';
import type { StoryFlowXmlOptions, StoryFlowXmlSource } from './types';

export const renderStoryFlowXML = (
  ir: StoryFlowIR,
  opts: StoryFlowXmlOptions = {},
): StoryFlowXmlSource => {
  void ir;
  void opts;
  throw new Error('P1-③ not implemented — 边界契约见 docs/storyflow-ir-p1.md §2.3');
};
