import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { renderStoryFlowXML } from '../src/ir/format/render';
import { storyFlowXmlFileName, exportStoryFlowXml } from '../src/bridge/format';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const goldenPath = fileURLToPath(new URL('../docs/storyflow-xml-example.xml', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const golden = (): string => readFileSync(goldenPath, 'utf8').replace(/\n$/, '');

afterEach(() => vi.unstubAllGlobals());

describe('storyFlowXmlFileName — 导出文件名', () => {
  it('defaults to <title>.storyflow.xml and honors the override', () => {
    expect(storyFlowXmlFileName(example())).toBe('银盐晨光.storyflow.xml');
    expect(storyFlowXmlFileName(example(), { filename: 'cut.xml' })).toBe('cut.xml');
  });
});

describe('exportStoryFlowXml — 下载壳', () => {
  it('downloads the golden XML body under the computed filename', async () => {
    const clicks: { download: string; href: string }[] = [];
    const blobs: Blob[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        expect(tag).toBe('a');
        const el = {
          href: '',
          download: '',
          click: () => clicks.push({ download: el.download, href: el.href }),
        };
        return el;
      },
    });
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        blobs.push(b);
        return 'blob:mock-1';
      },
      revokeObjectURL: () => {},
    });

    exportStoryFlowXml(example(), { pretty: true });

    expect(clicks).toEqual([{ download: '银盐晨光.storyflow.xml', href: 'blob:mock-1' }]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('application/xml');
    // 文件体 = renderStoryFlowXML 产物 = 已锁 golden
    expect(await blobs[0].text()).toBe(golden());
  });

  it('passes render options through (compact body differs from pretty golden)', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click: () => {} }),
    });
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        blobs.push(b);
        return 'blob:mock-2';
      },
      revokeObjectURL: () => {},
    });

    exportStoryFlowXml(example(), { filename: 'compact.storyflow.xml' });
    // 缺省 pretty:false 的紧凑体与 golden(pretty)不同——渲染选项透传到渲染器
    const body = await blobs[0].text();
    expect(body).toBe(renderStoryFlowXML(example()));
    expect(body).not.toBe(golden());
  });
});
