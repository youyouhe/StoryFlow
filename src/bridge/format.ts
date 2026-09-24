/**
 * ③导出桥(P2-③ 边界桩)——签名锁定,实装归 P2-③ 实例。
 * 接口清单:docs/storyflow-ir-p2.md §2.3(StoryFlowXML 导出入口;golden 已锁
 * docs/storyflow-xml-example.xml)。
 */
import type { StoryFlowIR } from '../ir/types';
import type { StoryFlowXmlOptions } from '../ir/format/types';
import type { StoryFlowXmlExportOptions } from './types';

export const exportStoryFlowXml = (
  ir: StoryFlowIR,
  opts?: StoryFlowXmlOptions & StoryFlowXmlExportOptions,
): void => {
  void ir;
  void opts;
  throw new Error('P2-③ not implemented — 接口清单见 docs/storyflow-ir-p2.md §2.3');
};
