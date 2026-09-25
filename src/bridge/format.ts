/**
 * ③导出桥 —— StoryFlowXML 导出入口(P2 交付物,接口清单
 * docs/storyflow-ir-p2.md §2.3)。
 *
 * renderStoryFlowXML 产物即文件体(golden `docs/storyflow-xml-example.xml`
 * 已锁);本层只做**文件名 + 下载壳**(utils/exportData.ts exportJSON 模式:
 * Blob + `<a>` + createObjectURL → click → revoke)。
 */
import type { StoryFlowIR } from '../ir/types';
import type { StoryFlowXmlOptions } from '../ir/format/types';
import { renderStoryFlowXML } from '../ir/format/render';
import type { StoryFlowXmlExportOptions } from './types';

/** 导出文件名:显式覆盖优先,缺省 `<title>.storyflow.xml`(纯函数,壳外测)。 */
export const storyFlowXmlFileName = (
  ir: StoryFlowIR,
  opts: StoryFlowXmlExportOptions = {},
): string => opts.filename ?? `${ir.title}.storyflow.xml`;

/** 触发一次 StoryFlowXML 下载。 */
export const exportStoryFlowXml = (
  ir: StoryFlowIR,
  opts: StoryFlowXmlOptions & StoryFlowXmlExportOptions = {},
): void => {
  const xml = renderStoryFlowXML(ir, opts);
  const blob = new Blob([xml], { type: 'application/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = storyFlowXmlFileName(ir, opts);
  a.click();
  URL.revokeObjectURL(a.href);
};
