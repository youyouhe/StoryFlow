import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, SfxClip } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { renderStoryFlowXML } from '../src/ir/format/render';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const goldenPath = fileURLToPath(new URL('../docs/storyflow-xml-example.xml', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));

const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const scriptInner = (xml: string): string => {
  const m = xml.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> section');
  return m[1];
};

/** 极简 well-formed 校验:标签栈配对(处理指令/注释/自闭合/引号内 >)。 */
const expectWellFormedXml = (xml: string): void => {
  const stack: string[] = [];
  const nameRe = /^[\p{L}_][\p{L}\p{N}._-]*/u;
  let i = 0;
  while (i < xml.length) {
    if (xml[i] !== '<') { i++; continue; }
    if (xml.startsWith('<?', i)) { i = xml.indexOf('?>', i) + 2; continue; }
    if (xml.startsWith('<!--', i)) { i = xml.indexOf('-->', i) + 3; continue; }
    let j = i + 1;
    let inQuote = false;
    while (j < xml.length) {
      const ch = xml[j];
      if (ch === '"') inQuote = !inQuote;
      else if (ch === '>' && !inQuote) break;
      j++;
    }
    const raw = xml.slice(i + 1, j);
    i = j + 1;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open !== name) throw new Error(`标签错配: </${name}> 关闭了 <${open ?? '?'}>`);
    } else {
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const name = nameRe.exec(body.trimStart())?.[0];
      if (!name) throw new Error(`非法标签: <${raw}>`);
      if (!selfClose) stack.push(name);
    }
  }
  if (stack.length) throw new Error(`未闭合标签: ${stack.join(', ')}`);
};

describe('renderStoryFlowXML — golden', () => {
  it('银盐晨光 matches docs/storyflow-xml-example.xml', () => {
    const golden = readFileSync(goldenPath, 'utf8').replace(/\n$/, '');
    expect(renderStoryFlowXML(example(), { pretty: true })).toBe(golden);
  });

  it('compact output is the same lines without indentation', () => {
    const pretty = renderStoryFlowXML(example(), { pretty: true }).split('\n');
    const compact = renderStoryFlowXML(example()).split('\n');
    expect(compact.map(l => l.trimStart())).toEqual(pretty.map(l => l.trimStart()));
  });
});

describe('prose-first invariants (Script reads nothing)', () => {
  it('script section has no Picture/gain/seconds tokens', () => {
    const inner = scriptInner(renderStoryFlowXML(example(), { pretty: true }));
    expect(inner).not.toMatch(/Picture/);
    expect(inner).not.toMatch(/gain/);
    expect(inner).not.toMatch(/seconds/);
  });

  it('script carries role cues + verbatim dialogue and motion prose', () => {
    const inner = scriptInner(renderStoryFlowXML(example(), { pretty: true }));
    expect(inner).toContain('<role name="陈默">拍一张证件照,要赶九点的火车。</role>');
    expect(inner).toContain('<role name="苏晚">好,坐那边,光正好。</role>');
    expect(inner).toContain('镜头极缓慢前推,光柱中尘埃缓缓漂浮');
  });

  it('word-anchored sfx injects its moment at the pinned token', () => {
    const inner = scriptInner(renderStoryFlowXML(example(), { pretty: true }));
    expect(inner).toContain('画面渐暗@{sfx-002!}收黑');
  });
});

describe('anchor references resolve', () => {
  it('every story.moment.* / story.selection.* reference has a script mark', () => {
    const xml = renderStoryFlowXML(example(), { pretty: true });
    const inner = scriptInner(xml);
    const momentRefs = [...xml.matchAll(/story\.moment\.([A-Za-z0-9-]+)/g)].map(m => m[1]);
    expect(momentRefs.length).toBeGreaterThan(0);
    for (const id of new Set(momentRefs)) expect(inner).toContain(`@{${id}!}`);
    const selRefs = [...xml.matchAll(/story\.selection\.([A-Za-z0-9-]+)/g)].map(m => m[1]);
    for (const id of new Set(selRefs)) {
      expect(inner).toContain(`@{${id}}`);
      expect(inner).toContain(`@{/${id}}`);
    }
  });

  it('out-of-range word anchors degrade to selection.end with a comment (no dangling ref)', () => {
    const xml = renderStoryFlowXML(mutated(ir => {
      (ir.audio.find(c => c.id === 'aud-sfx-002') as SfxClip).anchor = { kind: 'word', wordIndex: 99 };
    }), { pretty: true });
    expect(xml).toContain('SFX_ANCHOR_OUT_OF_RANGE');
    expect(xml).toContain('at="{story.selection.shot-005.end}"');
    expect(xml).not.toContain('story.moment.sfx-002');
  });
});

describe('well-formedness', () => {
  it('output is well-formed XML', () => {
    expectWellFormedXml(renderStoryFlowXML(example(), { pretty: true }));
  });
});
