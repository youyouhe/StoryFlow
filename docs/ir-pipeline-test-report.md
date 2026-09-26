# IR 管线全链接管测试报告

> 2026-09-26 · StoryFlow 派单(task_5c74171ee31e) · 分支 refactor/split-app
> 范围:LLM 提交步之前的每一环(提取 → 三路编译 → 序列化 → UI 面板)。真实 LLM 生成(生图/生视频/TTS 花费调用)一律未执行——留给用户。
> 门禁:vitest 475→479 全绿,tsc 双配置 0 错,vite build 绿。

## 1. 源码级 5 剧本矩阵(`tests/ir-pipeline-matrix.test.ts`,15 用例)

每本剧本跑 `extractStoryFlowIR → 三路编译(视觉/音频/字幕)→ SRT/VTT/IR JSON/剧本 JSON 序列化`:

| 剧本 | 形态 | 结果 | 关键断言 |
|---|---|---|---|
| A 带时间戳 AI 风格 | 2 场景/3 拍 authored/2 句对白 | ✅ | 拍数=3、时长=前缀宽(4/3/3s)、**不误标 estimated**、TTS=2、字幕覆盖、角色 ref(刀客)、schemaVersion 3 |
| B 手写无时间戳(#11 回退) | 1 场景/3 对白 | ✅ | ≥3 拍、逐拍 estimated、拍长钳制 [1,10]s、三句对白全进 TTS+SRT、SRT 无巨条 |
| C 空剧本 | 0 块 | ✅ | 零镜头不崩:三路编译全空、**schema 校验通过**(`shots` 无 min(1))、SRT 空串、序列化可用、无捏造内容 |
| D 多场景长 | 3 场景/5 拍/2 句对白 | ✅ | 转场=2(场景切换数)、角色 ref 跨场景复用同一 identity、SRT 时间单调递增、对白全覆盖 |
| E zh/dual 双语 | 英文台词 | ✅ | 英文对白照常进 TTS/SRT、序列化闭合、不崩 |

每本均过 `validateStoryFlowIR`(zod + refinements)——整份 IR 可 round-trip。

## 2. graybox 与分镜消费(2 用例)

- **shot graybox 运镜 → Shot.camera**:position/movement 直通;**scene graybox → spatial**(objects/characters 1:1)。
- **deriveShotList(分镜清单)**:与 IR 提取同稿口径一致(行数/块归属/motion);`dialoguesWithoutSpeaker` 校验清单为空。

## 3. E2E(真实页面,DOM 驱动)

栈:隔离 dev.sh(`STORYFLOW_RUN_DIR=/tmp/storyflow-dev-git`,5173)+ rod chromium 128(CDP 9222,`--enable-features=WebMCP`)。手写稿《旧梦胶片》种入 localStorage → ExportMenu → IR pipeline → 生成:

- ✅ 全流程零页面错误;面板报告:**镜头 5(其中估算节拍 5/5)、音频 clip 3、转场 1、字幕 3 条、警告 0**——与源码级矩阵一致;估算节拍提示横幅正确渲染;SRT/VTT/计划 JSON 按钮在位(下载内容由单测覆盖)。

### ⚠️ 环境限制(非代码缺陷):WebMCP 工具路径未能在本机驱动

`document.modelContext` 在本机可用 chromium(128)上不存在——WebMCP 需要更新的内核且 `/home/git/webmcp-retrofit` 启动器(bridge + launcher)在本机缺失(`dev.sh` 输出 `browser SKIPPED`)。替代:DOM 驱动同一 UI 流程(上 ✅)。`storyflow_*` 工具的注册逻辑本身有单测/类型锁定(`services/webmcp.ts`),建议在有 WebMCP 内核的环境补一次工具路径 E2E。

## 4. 发现的缺陷(已随本提交修复)

| 缺陷 | 根因 | 修复 |
|---|---|---|
| **场景内无 CHARACTER cue 的对白 → 提取 IR 未过 schema**(dialogue⇒character refinement 失败,整份 IR 不可用) | 三处 cue 回溯 walk 遇场景标题即断 | cue 回溯跨场景回退到最近已知说话人(`utils/videoPlan.ts` 节拍收集/合成器两处;语义:cue-less 对白继承上一说话人,IR 保持可用) |

未开新 issue:唯一发现的缺陷已随本提交修复并被矩阵用例锁定(D 剧本场景 3 无 cue 对白即回归锚)。

## 5. 遗留清单

1. **WebMCP 工具路径 E2E**(上述环境限制)——等有 WebMCP 内核 + retrofit 启动器的环境。
2. **TimingStrip 校准 UI 挂载**(既有记档)——估算节拍的校准入口在纯函数/组件层已备,App 挂载随 hook 架构重做。
3. **真实 LLM 生成链**(生图/生视频/TTS/对齐付费调用)——按派单边界留给用户手验。
4. 空剧本的 IR `shots: []` 合法但下游视觉编译为空计划——如需「空稿也出空镜占位」属产品决策,未擅动。

## 6. 结论

LLM 提交步之前的 IR 管线(提取 → 三路编译 → 序列化 → UI 面板)在 5 剧本矩阵 + graybox/分镜消费 + 真实页面 E2E 下**全部通过**,无未修缺陷、无静默数据丢失路径。
