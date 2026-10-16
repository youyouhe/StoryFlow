import type { CapabilityId } from '../services/providers/types';

/**
 * Skill registry — the single capability roster (方案:分支 sf-arch-review 的
 * docs/architecture/skill-architecture.md §2 契约 + §3 名册;R0 期)。
 *
 * 纯数据、零行为:每个 L1 Skill(能力模块)在此声明它是什么、消费什么、
 * 状态落在哪、对外暴露哪些 WebMCP 工具、agent 说明页在哪。实现文件不动,
 * 只登记既有机制(P1 项目文件 / P3 冻结门禁 / P4 路由 / IR 管线)。
 *
 * 同步护栏(改名册必读):
 *  - tests/skill-registry.test.ts 结构性校验本名册与代码一致(webmcp 工具、
 *    状态文件、UI 入口、referenceDoc、依赖无环)。文档漂移 = 测试红。
 *  - SkillId 联合类型必须与 SKILLS 数组一一对应:名册缺 id 由文末
 *    AssertNever 编译报错;数组多/少 id 由测试 ① 兜底。
 *  - 新增用户可感知能力 = 实现 + 本名册登记 + references 说明页,三件套
 *    一个 PR(CLAUDE.md「变更纪律」)。
 *
 * 与本文件无关的同名注册表(勿混):services/providers/registry.ts 是 P4
 * provider 路由注册表;tests/extract-registry.test.ts 是 IR characterSheets
 * 注册表的测试。
 */

export type SkillId =
  | 'screenplay-editor' | 'ai-writing' | 'brief-align' | 'shot-breakdown'
  | 'continuity-bible' | 'character-assets' | 'graybox-previz' | 'video-gen'
  | 'ir-pipeline'
  | 'prompt-compiler' | 'timing' | 'plan-gate' | 'provider-credentials'
  | 'compositor' | 'gallery-sync' | 'variants' | 'review-loop'
  | 'frame-qa' | 'edit-repair' | 'agent-ops' | 'desktop-shell';

export interface SkillMeta {
  id: SkillId;
  /** 该 Skill 对外契约的版本,独立于代码版本。约定:可用=1.0.0,
   *  半成品=0.9.0,实验(待立项、零接线)=0.0.0。 */
  version: string;
  title: string;
  titleZh: string;
  /** 可用 / 半成品 / 实验。实验 = 只有 id 与边界,没有实现代码。 */
  maturity: '可用' | '半成品' | '实验';
  /** 依赖的其它 Skill(禁止环;测试 ⑤ 校验)。 */
  depends: readonly SkillId[];
  /** 消费的 P4 能力(services/providers/types.ts 的 CapabilityId)。
   *  注:方案设想的 vision.check 尚不存在(R6 阶段二才进 P4)。 */
  capabilities: readonly CapabilityId[];
  /** 读写的 P1 项目文件(信封格式见 services/project/files.ts)+ localStorage 键。
   *  记忆文件(BRIEF/TREATMENT/PROGRESS.md)是 agent 约定面,校验基准是
   *  references/files.md;IndexedDB/内存后端不入册(见 references/skills.md)。 */
  stateFiles: readonly string[];
  /** 消费的 AppSettings 键(展示与审计用;密钥字段现状见 provider-credentials)。 */
  settingsKeys?: readonly string[];
  /** 暴露或复用的 storyflow_* 工具名(实现见 services/webmcp.ts)。 */
  webmcpTools: readonly string[];
  /** UI 入口:仓库相对路径,可带 `#` 注释(组件 / 面板 tab)。 */
  uiEntries: readonly string[];
  /** L2 agent 说明页,相对 skills/storyflow/。没有说明的能力不许注册。 */
  referenceDoc: string;
}

/** storyflow_list_skills 对 agent 返回的投影(不含内部路径细节)。 */
export interface SkillSummary {
  id: SkillId;
  title: string;
  titleZh: string;
  maturity: SkillMeta['maturity'];
  depends: readonly SkillId[];
  webmcpTools: readonly string[];
  referenceDoc: string;
}

export const toSkillSummary = (s: SkillMeta): SkillSummary => ({
  id: s.id,
  title: s.title,
  titleZh: s.titleZh,
  maturity: s.maturity,
  depends: s.depends,
  webmcpTools: s.webmcpTools,
  referenceDoc: s.referenceDoc,
});

/**
 * 名册(21 = 14 可用 + ir-pipeline 半成品新登记 + 6 个实验待立项)。
 * 每个字段都从代码抄实;实验 Skill 只立 id 与边界,字段如实留空。
 */
export const SKILLS = [
  // ---- 现有能力(只登记,零新码)------------------------------------------
  {
    id: 'screenplay-editor',
    version: '1.0.0',
    title: 'Screenplay editor',
    titleZh: '剧本编辑器',
    maturity: '可用',
    depends: [],
    capabilities: [],
    stateFiles: ['story.sfstory', 'script_index', 'script_{id}', 'screenplay_autosave'],
    webmcpTools: [
      'storyflow_list_scripts',
      'storyflow_get_blocks',
      'storyflow_append_blocks',
      'storyflow_insert_blocks',
      'storyflow_update_block',
      'storyflow_delete_block',
      'storyflow_import_script',
      'storyflow_export_script',
    ],
    uiEntries: [
      'components/EditorCanvas.tsx',
      'components/EditorBlock.tsx',
      'components/Sidebar.tsx',
      'components/Toolbar.tsx',
      'components/ExportMenu.tsx',
      'components/TemplateModal.tsx',
    ],
    referenceDoc: 'references/files.md',
  },
  {
    id: 'ai-writing',
    version: '1.0.0',
    title: 'AI writing (8 modes)',
    titleZh: 'AI 文本生成(八模式)',
    maturity: '可用',
    depends: ['screenplay-editor', 'provider-credentials'],
    capabilities: ['llm-chat'],
    stateFiles: ['ai_perf_log'],
    settingsKeys: ['provider', 'geminiModel', 'deepseekModel', 'geminiThinkingLevel', 'autoAcceptAI', 'aiContextBlocks', 'aiOutputBlocks'],
    webmcpTools: ['storyflow_continue_script', 'storyflow_get_ai_log'],
    uiEntries: ['components/AIModal.tsx', 'components/OpeningPicker.tsx'],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'character-assets',
    version: '1.0.0',
    title: 'Reference assets & character sheets',
    titleZh: '参考资产库与角色设定图',
    maturity: '可用',
    depends: ['screenplay-editor', 'provider-credentials'],
    capabilities: ['llm-chat', 'image.generate'],
    stateFiles: ['story.sfstory', 'asset_cloud_map', 'assetDir'],
    settingsKeys: ['imageProvider', 'falModel', 'falQuality'],
    webmcpTools: ['storyflow_generate_image_prompt', 'storyflow_generate_image'],
    uiEntries: [
      'components/RefAssetLibraryModal.tsx',
      'components/ReferenceBindingPanel.tsx',
      'components/StyleHeadModal.tsx',
    ],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'graybox-previz',
    version: '1.0.0',
    title: 'Graybox 3D previs',
    titleZh: '灰盒(白模)3D 预演',
    maturity: '可用',
    depends: ['screenplay-editor', 'provider-credentials'],
    capabilities: ['llm-chat'],
    stateFiles: ['story.sfstory'],
    webmcpTools: ['storyflow_generate_graybox', 'storyflow_get_graybox', 'storyflow_check_graybox_health'],
    uiEntries: ['components/Graybox3DView.tsx', 'components/Panorama3DViewer.tsx'],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'video-gen',
    version: '1.0.0',
    title: 'Video generation (Express / Pro)',
    titleZh: '视频生成管线(双模式)',
    maturity: '可用',
    depends: ['graybox-previz', 'plan-gate', 'provider-credentials'],
    capabilities: ['video.generate', 'image.generate'],
    stateFiles: ['h3_tasks', 'story.sfstory'],
    settingsKeys: ['videoBackend', 'minimaxApiKey', 'minimaxBaseUrl', 'comfyServerUrl', 'comfyWorkflowT2V', 'comfyWorkflowI2V', 'comfyWorkflowR2V'],
    webmcpTools: ['storyflow_generate_video_prompt'],
    uiEntries: [
      'components/ExpressWorkbench.tsx',
      'components/PromptPanel.tsx',
      'components/ProAudioPanel.tsx',
    ],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'ir-pipeline',
    version: '0.9.0',
    title: 'IR production pipeline',
    titleZh: 'IR 生产管线',
    maturity: '半成品',
    // 编译/导出/计价展示零成本(IRPipelineModal);src/exec 执行器未接 UI
    // 主路径,故 capabilities 留空——执行链上主路径后再声名 video.generate 等。
    depends: ['screenplay-editor', 'timing'],
    capabilities: [],
    stateFiles: ['story.sfstory'],
    webmcpTools: [],
    uiEntries: ['components/IRPipelineModal.tsx'],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'timing',
    version: '1.0.0',
    title: 'Timing, captions & speech rate',
    titleZh: '时间轴、字幕与语速',
    maturity: '可用',
    depends: ['screenplay-editor'],
    capabilities: ['asr.transcribe'],
    stateFiles: ['story.sfstory'],
    settingsKeys: ['asrApiKey', 'asrBaseUrl'],
    webmcpTools: [],
    uiEntries: ['components/TimingStrip.tsx'],
    referenceDoc: 'references/timing.md',
  },
  {
    id: 'plan-gate',
    version: '1.0.0',
    title: 'Plan gate, candidates & results',
    titleZh: '计划冻结、候选复用与结果仓库',
    maturity: '可用',
    depends: ['screenplay-editor'],
    capabilities: [],
    stateFiles: [
      'runs/*.sfrun',
      '.storyflow/results/<runId>/result.json',
      '.storyflow/results/<runId>/files/',
      'storyflow_results_index',
    ],
    webmcpTools: [],
    uiEntries: ['components/PlanPreviewModal.tsx', 'components/CandidatesPanel.tsx'],
    referenceDoc: 'references/builds.md',
  },
  {
    id: 'provider-credentials',
    version: '1.0.0',
    title: 'Providers, routing & credentials',
    titleZh: 'Provider 路由与凭证三档',
    maturity: '可用',
    depends: [],
    capabilities: [],
    stateFiles: [
      'storyflow.runtime.json',
      'storyflow_cred_remember',
      'storyflow_cred_device_key',
      'storyflow_cred_count',
      'screenplay_app_settings',
    ],
    // settingsKeys 里的 *ApiKey 字段是 D5 记录的现状:明文字段仍在
    // AppSettings(types.ts:428-430)与 SettingsModal 输入,落盘已被
    // services/credentials.ts strip;两步迁移(先断 UI 直填再删字段)未做,
    // 新代码禁止新增对明文字段的消费。
    settingsKeys: ['provider', 'credentialTier', 'geminiApiKey', 'deepseekApiKey', 'minimaxApiKey', 'falKey', 'asrApiKey'],
    webmcpTools: [],
    uiEntries: ['components/SettingsModal.tsx'],
    referenceDoc: 'references/providers.md',
  },
  {
    id: 'compositor',
    version: '1.0.0',
    title: 'Compositor & export',
    titleZh: '合成层与导出',
    maturity: '可用',
    depends: ['plan-gate', 'timing'],
    capabilities: [],
    stateFiles: ['.storyflow/results/<runId>/result.json'],
    webmcpTools: [],
    uiEntries: ['components/ComposeExportModal.tsx'],
    referenceDoc: 'references/review.md',
  },
  {
    id: 'gallery-sync',
    version: '1.0.0',
    title: 'Gallery cloud sync & consent',
    titleZh: '云同步与同意门禁',
    maturity: '可用',
    depends: ['screenplay-editor'],
    capabilities: [],
    stateFiles: [
      'sync_outbox',
      'sync_{id}',
      'gallery_auth',
      'gallery_mock_cloud',
      'cloud_sync_consent',
      'cloud_pull_policy',
      'sso_access_token',
      'sso_logged_out',
    ],
    webmcpTools: [],
    uiEntries: ['components/GalleryModal.tsx'],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'variants',
    version: '1.0.0',
    title: 'Batch variants',
    titleZh: '批量变体',
    maturity: '可用',
    depends: ['screenplay-editor', 'plan-gate'],
    capabilities: [],
    stateFiles: ['runs/*.sfrun'],
    webmcpTools: [],
    // 纯函数(utils/variants.ts)+ 文件约定(run 名即变体名),由 agent 经
    // references/variants.md 驱动,暂无 UI 组件入口。
    uiEntries: [],
    referenceDoc: 'references/variants.md',
  },
  {
    id: 'review-loop',
    version: '1.0.0',
    title: 'Review loop',
    titleZh: '评审回路',
    maturity: '可用',
    depends: ['compositor'],
    capabilities: [],
    stateFiles: ['FEEDBACK.json'],
    webmcpTools: [],
    uiEntries: ['components/ReviewPanel.tsx'],
    referenceDoc: 'references/review.md',
  },
  {
    id: 'agent-ops',
    version: '1.0.0',
    title: 'Agent operations (WebMCP)',
    titleZh: 'Agent 操作面',
    maturity: '可用',
    depends: [],
    capabilities: [],
    // 记忆文件是 agent 的落盘约定(写入方主要是 agent,而非应用代码)。
    stateFiles: ['BRIEF.md', 'TREATMENT.md', 'PROGRESS.md'],
    webmcpTools: ['storyflow_get_app_info', 'storyflow_list_skills'],
    uiEntries: [],
    referenceDoc: 'SKILL.md',
  },
  {
    id: 'desktop-shell',
    version: '1.0.0',
    title: 'Desktop shell (Tauri 2)',
    titleZh: '桌面壳(Tauri 2)',
    maturity: '可用',
    depends: ['provider-credentials'],
    capabilities: [],
    stateFiles: [],
    settingsKeys: ['credentialTier'],
    webmcpTools: [],
    uiEntries: ['src-tauri/tauri.conf.json'],
    referenceDoc: 'references/skills.md',
  },
  // ---- 新增 Skill(方案 §3a,R0 只立 id 与边界,零实现)--------------------
  {
    id: 'brief-align',
    version: '0.0.0',
    title: 'Brief alignment & style samples (planned)',
    titleZh: '需求对齐与样图(待立项)',
    maturity: '实验',
    depends: [],
    capabilities: [],
    stateFiles: [],
    webmcpTools: [],
    uiEntries: [],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'shot-breakdown',
    version: '0.0.0',
    title: 'Shot breakdown board (planned)',
    titleZh: '生产状态板(待立项)',
    maturity: '实验',
    depends: [],
    capabilities: [],
    stateFiles: [],
    webmcpTools: [],
    uiEntries: [],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'continuity-bible',
    version: '0.0.0',
    title: 'Continuity bible (planned)',
    titleZh: '连戏规约(待立项)',
    maturity: '实验',
    depends: [],
    capabilities: [],
    stateFiles: [],
    webmcpTools: [],
    uiEntries: [],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'prompt-compiler',
    version: '0.0.0',
    title: 'Unified prompt compiler (planned)',
    titleZh: '提示词统一编译(待立项;legacy 收编)',
    maturity: '实验',
    depends: [],
    capabilities: [],
    stateFiles: [],
    webmcpTools: [],
    uiEntries: [],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'frame-qa',
    version: '0.0.0',
    title: 'Frame extraction & QA (planned)',
    titleZh: '抽帧质检(待立项;vision.check 须先过 D4/D6 门槛)',
    maturity: '实验',
    depends: [],
    capabilities: [],
    stateFiles: [],
    webmcpTools: [],
    uiEntries: [],
    referenceDoc: 'references/skills.md',
  },
  {
    id: 'edit-repair',
    version: '0.0.0',
    title: 'Edit repair (trim / crop, planned)',
    titleZh: '后期修复(待立项;trim/裁切)',
    maturity: '实验',
    depends: [],
    capabilities: [],
    stateFiles: [],
    webmcpTools: [],
    uiEntries: [],
    referenceDoc: 'references/skills.md',
  },
] as const satisfies readonly SkillMeta[];

// 编译期护栏:SkillId 里的每个 id 都必须出现在 SKILLS 名册中。
// 若此行报「does not satisfy the constraint 'never'」,说明有 SkillId
// 未登记——先补名册条目,再改别处。
type AssertNever<T extends never> = T;
type UnregisteredSkillId = Exclude<SkillId, (typeof SKILLS)[number]['id']>;
type _RosterMustCoverEverySkillId = AssertNever<UnregisteredSkillId>;
