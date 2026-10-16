import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES } from '../services/providers/types';
import { registerStoryflowWebMcpTools, type StoryflowWebMcpAccessor } from '../services/webmcp';
import { SKILLS, type SkillId } from '../skills/registry';

/**
 * Skill 名册一致性测试(R0,方案 §1 一一对应规则)。
 *
 * 名册(skills/registry.ts)是纯数据声明;本测试把它与代码结构性绑死:
 * webmcp 工具真实注册、状态文件真实存在、UI 入口真实存在、依赖无环。
 * 文档/名册漂移 = 这里红。改名册或工具前先读懂本文件。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L2_DIR = path.join(ROOT, 'skills', 'storyflow');

/** 递归拼接目录下全部 TS 源码文本(含注释——注释里的路径字面量也算数)。 */
const readSourceTree = (dir: string): string => {
  let out = '';
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (name === 'node_modules') continue;
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out += readSourceTree(rel);
    else if (/\.(ts|tsx)$/.test(name)) out += readFileSync(path.join(ROOT, rel), 'utf8');
  }
  return out;
};

const SERVICES_SOURCE = readSourceTree('services');
const APP_SOURCE =
  SERVICES_SOURCE +
  readSourceTree('hooks') +
  readSourceTree('utils') +
  readSourceTree('components') +
  readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
const FILES_MD = readFileSync(path.join(L2_DIR, 'references', 'files.md'), 'utf8');

/** 快照:SkillId 联合类型的全部成员(与 skills/registry.ts 的 SkillId 同步维护)。 */
const EXPECTED_SKILL_IDS: SkillId[] = [
  'screenplay-editor', 'ai-writing', 'brief-align', 'shot-breakdown',
  'continuity-bible', 'character-assets', 'graybox-previz', 'video-gen',
  'ir-pipeline',
  'prompt-compiler', 'timing', 'plan-gate', 'provider-credentials',
  'compositor', 'gallery-sync', 'variants', 'review-loop',
  'frame-qa', 'edit-repair', 'agent-ops', 'desktop-shell',
];

/** 代码管理的 P1 项目文件(信封格式见 services/project/files.ts)。 */
const isProjectFile = (f: string): boolean =>
  /\.(sfstory|sfstyle|sfrun)$/.test(f) ||
  f.startsWith('.storyflow') ||
  f === 'FEEDBACK.json' ||
  f === 'storyflow.runtime.json';

/** agent 约定面的记忆文件:校验基准是 references/files.md,不是代码。 */
const MEMORY_FILES = ['BRIEF.md', 'TREATMENT.md', 'PROGRESS.md'];

/** 名册写 `sync_{id}`;代码是「前缀 + id」拼接(`SCRIPT_PREFIX: 'script_'`)
 *  或模板串 `sync_${id}` —— 统一归一成前缀子串再查。 */
const asSourceLiteral = (key: string): string => key.replace(/\{[^}]*\}.*$/, '');

/**
 * 真注册一遍 WebMCP 工具(mock document.modelContext 捕获),
 * 返回 services/webmcp.ts 实际注册的工具名 —— 与桥端 tools/list 同源。
 */
const captureRegisteredToolNames = async (): Promise<string[]> => {
  const captured: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevDocument = g.document;
  g.window = globalThis;
  g.document = {
    modelContext: {
      registerTool: async (tool: { name: string }) => { captured.push(tool.name); },
    },
  };
  const cleanup = registerStoryflowWebMcpTools({ current: null as unknown as StoryflowWebMcpAccessor });
  const expected = new Set(SKILLS.flatMap(s => s.webmcpTools)).size;
  try {
    // 注册循环是逐个 await 的 async IIFE。等「不少于名册认领数」只为快速暴露
    // 漏注册;计数可能在中途放行,所以再给一个宏观沉降 tick,确保快照完整。
    // 超时不在此处报错 —— 下面的断言会给出精确到工具名的差异。
    try {
      await vi.waitFor(() => { expect(captured.length).toBeGreaterThanOrEqual(expected); }, { timeout: 5_000 });
    } catch { /* 由下方断言精确报红 */ }
    await new Promise(r => setTimeout(r, 100));
  } finally {
    cleanup();
    if (prevWindow === undefined) delete g.window; else g.window = prevWindow;
    if (prevDocument === undefined) delete g.document; else g.document = prevDocument;
  }
  return captured;
};

describe('Skill 名册一致性(skills/registry.ts ↔ 代码)', () => {
  it('① 名册 id 集合 ≡ SkillId 联合类型(无缺无多、无重复)', () => {
    const ids = SKILLS.map(s => s.id);
    expect([...ids].sort()).toEqual([...EXPECTED_SKILL_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('② webmcpTools ⊆ webmcp.ts 实际注册;反向每个注册工具都被某个 Skill 认领', async () => {
    const registered = await captureRegisteredToolNames();
    const registeredSet = new Set(registered);
    // 注册表自身健康:无重名、遵守 storyflow_ 前缀
    expect(registered.length).toBe(registeredSet.size);
    for (const tool of registered) expect(tool.startsWith('storyflow_')).toBe(true);

    for (const skill of SKILLS) {
      for (const tool of skill.webmcpTools) {
        expect(registeredSet.has(tool), `${skill.id} 声明的 ${tool} 未在 services/webmcp.ts 注册`).toBe(true);
      }
    }
    for (const tool of registered) {
      // webmcpTools 是 as const 元组(实验 Skill 为空元组),先放宽成 string[] 再查
      const claimant = SKILLS.filter(s => (s.webmcpTools as readonly string[]).includes(tool)).map(s => s.id);
      expect(claimant.length > 0, `注册工具 ${tool} 没有任何 Skill 认领(名册漏登记)`).toBe(true);
    }
  });

  it('③ 每个 referenceDoc 文件真实存在', () => {
    for (const skill of SKILLS) {
      expect(
        existsSync(path.join(L2_DIR, skill.referenceDoc)),
        `${skill.id} 的说明页 ${skill.referenceDoc} 不存在(没有说明的能力不许注册)`,
      ).toBe(true);
    }
  });

  it('④ stateFiles:P1 项目文件在 services/ 中、记忆文件在 files.md、localStorage 键在应用源码中', () => {
    for (const skill of SKILLS) {
      for (const f of skill.stateFiles) {
        if (isProjectFile(f)) {
          expect(SERVICES_SOURCE.includes(f), `${skill.id} 声明的项目文件 ${f} 在 services/ 源码中不存在`).toBe(true);
        } else if (MEMORY_FILES.includes(f)) {
          expect(FILES_MD.includes(f), `${skill.id} 声明的记忆文件 ${f} 未在 references/files.md 记档`).toBe(true);
        } else {
          expect(APP_SOURCE.includes(asSourceLiteral(f)), `${skill.id} 声明的 localStorage 键 ${f} 在应用源码中不存在`).toBe(true);
        }
      }
    }
  });

  it('⑤ depends 引用的 id 都存在,且依赖图无环(含自环)', () => {
    const ids = new Set(SKILLS.map(s => s.id));
    const byId = new Map<string, (typeof SKILLS)[number]>(SKILLS.map(s => [s.id, s]));
    for (const skill of SKILLS) {
      for (const dep of skill.depends) {
        expect(ids.has(dep), `${skill.id} 依赖的 ${dep} 不在名册中`).toBe(true);
      }
    }
    // DFS 三色标记;回边即环
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(SKILLS.map(s => [s.id, WHITE]));
    const visit = (id: string, trail: string[]): void => {
      expect(color.get(id), `依赖成环:${[...trail, id].join(' -> ')}`).not.toBe(GRAY);
      if (color.get(id) === BLACK) return;
      color.set(id, GRAY);
      for (const dep of byId.get(id)!.depends) visit(dep, [...trail, id]);
      color.set(id, BLACK);
    };
    for (const skill of SKILLS) visit(skill.id, []);
  });

  it('⑥ 每个 uiEntries 指向真实存在的文件', () => {
    for (const skill of SKILLS) {
      for (const entry of skill.uiEntries) {
        const file = entry.split('#')[0].trim();
        expect(
          existsSync(path.join(ROOT, file)),
          `${skill.id} 的 UI 入口 ${file} 不存在(组件被移动/删除后名册未跟)`,
        ).toBe(true);
      }
    }
  });

  it('⑦ capabilities ⊆ P4 CAPABILITIES;version/maturity/title/referenceDoc 形状合法', () => {
    const capabilityIds = new Set<string>(CAPABILITIES);
    for (const skill of SKILLS) {
      for (const c of skill.capabilities) {
        expect(capabilityIds.has(c), `${skill.id} 声明的未真能力 ${c}(P4 加法后才可用)`).toBe(true);
      }
      expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(['可用', '半成品', '实验']).toContain(skill.maturity);
      expect(skill.title.trim().length > 0).toBe(true);
      expect(skill.titleZh.trim().length > 0).toBe(true);
      expect(skill.referenceDoc === 'SKILL.md' || skill.referenceDoc.startsWith('references/')).toBe(true);
    }
  });

  it('⑧ 实验 Skill 必须零接线(待立项承诺,方案 D4/D6):实现前字段保持为空', () => {
    for (const skill of SKILLS) {
      if (skill.maturity !== '实验') continue;
      expect(skill.version).toBe('0.0.0');
      expect(skill.depends, `${skill.id} 实验期不应声明依赖`).toEqual([]);
      expect(skill.capabilities, `${skill.id} 实验期不应声明能力`).toEqual([]);
      expect(skill.stateFiles, `${skill.id} 实验期不应声明状态文件`).toEqual([]);
      expect(skill.webmcpTools, `${skill.id} 实验期不应声明工具`).toEqual([]);
      expect(skill.uiEntries, `${skill.id} 实验期不应声明 UI 入口`).toEqual([]);
    }
  });
});
