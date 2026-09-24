# StoryFlow 落地改造方案(借鉴 Hypit)

> 把《Hypit 架构研究笔记》(`docs/hypit-study.md`)的对照表与可借鉴 Top 5 落到 StoryFlow 代码上。
> 产出形态:五期改造,每期有改动点(文件级)、验收标准(可检验)、风险与回退。
> 基线:StoryFlow 当前代码(`/home/git/projects/StoryFlow`,React 19 + Vite + Tauri 2,2026-09)。
> 执行者:站长与 AI Agent 分期实施;每期独立交付、独立回退,不要求一次到位。

---

## 0. 基线盘点(改造的起点事实)

| 事实 | 位置 | 对改造的含义 |
|---|---|---|
| 状态中心 ~2842 行 | `App.tsx` | 剧本/灰模/绑定/任务全部内存态,localStorage 落盘是 JSON 快照 |
| 持久化三层混杂 | localStorage(剧本/设置/H3 任务)、IndexedDB(`refImageStore.ts`)、目录存储(`assetDirStore.ts`) | 无"项目目录"概念,文件不可 diff,Agent 无法离线读写 |
| H3 任务历史上限 50 条 | `App.tsx`(`h3_tasks`) | 产物历史易丢,复用无从谈起 |
| 已有确定性分段 | `utils/videoPlan.ts`(读节拍秒前缀聚合 ≤15s 段,零 AI) | 时间锚是**秒前缀**(`00:00-00:03`),改词不 reflow——P2 的直接升级对象 |
| 白模运镜数据已定型 | `types.ts` `GrayboxCamera`(path/lookPath 双曲线 + targetSeconds,"坐标宪法") | StoryFlow 的差异化资产,P2 只换时间锚,不动几何 |
| 服务层每 API 一文件 | `services/{minimax,comfy,fal,gemini}Service.ts` | 换服务商=改代码,密钥存 localStorage,P4 的收敛对象 |
| 提示词即常量 | `constants.ts` 1334 行(PROMPTS/TEMPLATES) | 改提示词要改代码,P1 里的"样式/模板"落盘对象 |
| Agent 桥已有雏形 | `services/webmcp.ts` + `webmcpAccessor.ts` | P5 的集成点,不必从零建 |
| 无 lint / 无测试 | CLAUDE.md 明言 | 每期补纯函数单测(vitest),`tsc --noEmit` 为基线 |
| 桌面壳 | `src-tauri/` | 凭证进 OS keyring 的通道(P4) |

---

## 1. 改造原则

1. **渐进,不推倒重来。** React/Tauri/灰模/剧本编辑全部保留;只换"状态与时间的底座"。
2. **白模是护城河。** Hypit 没有几何级运镜控制;StoryFlow 的 `path/lookPath` + 白模录制就是给 Hypit 类系统供货的资产。改造不得削弱它。
3. **先落盘,后智能;先契约,后功能。** 每期把"机制"做实(文件、锚点、候选、绑定),AI 能力(自动对齐、Agent 闭环)才站得住。
4. **每期验收必须可检验。** 不接受"体验变好";只接受"改一句词后自动重排""关掉浏览器重开完整恢复"这类可复现断言。

---

## 2. 分期总览

| 期 | 主题 | 对应 Top5 | 补齐对照表行 | 依赖 | 量级 |
|---|---|---|---|---|---|
| P1 | 文件化底座(内容/样式/意图三分落盘) | ②状态落盘 | 创作载体、中间表示、提示词工程 | — | 中 |
| P2 | 词级时间轴(锚点 + 自动 reflow) | ①词当时间轴 | 时间基准、语义标记、运镜挂钩 | P1 | 大 |
| P3 | 显式复用 + 冻结计划 | ③复用靠指认 | 确定性、复用/版本、成本治理 | P1 | 中 |
| P4 | 服务三层 + 凭证库 | ④Model/Provider/Endpoint | 服务商切换、凭证 | 无(P1 后更顺) | 中 |
| P5 | 合成层 + Agent 闭环 | ⑤文档架构 + 次级渲染 | 合成/渲染、多版本量产、审阅、Agent 协作、生成模式 | P1+P2 | 大 |

P2 与 P3 可部分并行(P3 只依赖 P1 的 runs 文件);P4 与 P2/P3 完全并行。

---

## 3. P1 · 文件化底座:内容 / 样式 / 意图三分落盘

### 目标

项目 = 一个可 git 管理的目录,三种文本文件是唯一真相;App 从"状态持有者"降级为"源的编辑器 + 投影"。

### 改动点

**新增**

- [ ] `src/fs/` 项目文件层(参照 Hypit 三分法;扩展名可议,以下用建议名):
  - `story.sfstory` — 内容:`Screenplay` 序列化(blocks + metadata + sequences + segmentGrayboxes + referenceBindings + productionMode),带 `format: "storyflow.story@1"` 版本字段
  - `style.sfstyle` — 样式:`StyleHead`、`ColorSettings`、字幕样式,并把 `constants.ts` 的 PROMPTS/生成模板抽出为可编辑 Recipe(键值 + 引用,非代码)
  - `runs/<name>.sfrun` — 意图:每次生成/出片要做什么(选哪些段、模式、模型、候选引用)——schema 在本期先立最小骨架(段选择 + 模式),P3 扩 Candidate 字段
- [ ] `src/fs/projectStore.ts` — 项目打开/保存/自动保存;浏览器侧 File System Access API(沿用 `assetDirStore.ts` 先例),Tauri 侧 `tauri-plugin-fs`
- [ ] `src/fs/migrate.ts` — localStorage 旧数据一次性迁移(沿用 `App.tsx` 里 ref_bindings 迁移先例;保留只读回退直到迁移验收通过)

**修改**

- [ ] `App.tsx` — 把剧本 CRUD、自动保存、设置读写改为经 `projectStore`;localStorage 降级为"最近项目缓存"而非真相
- [ ] `types.ts` — 全部可落盘类型加 `format` 版本字段;`H3Task` 结构冻结为 P3 结果仓库的输入
- [ ] `constants.ts` — PROMPTS/TEMPLATES 迁到 `style.sfstyle` 套件;代码只留 schema 与默认值
- [ ] `services/syncEngine.ts` / `apiClient.ts` — 云端同步单元从"剧本 JSON"改为"项目目录"(可后置到 P1 尾声,先本地跑通)
- [ ] `components/SettingsModal.tsx` — 增加"打开项目目录 / 另存项目"入口
- [ ] 新增 vitest 基线:`src/fs/__tests__/`(序列化往返、迁移、版本兼容)

### 验收标准

1. 新建项目后磁盘上出现 `story.sfstyle`/`story.sfstory`/`runs/` 三件套;在编辑器改一句台词,**不刷新页面** `git diff` 能看到该句变化。
2. 完全关闭浏览器/桌面端后重开,项目从目录完整恢复(含灰模、绑定、序列)。
3. 用外部编辑器改 `story.sfstory` 后应用重载,UI 显示新内容(冲突时明确提示,不静默覆盖)。
4. 把项目目录拷贝到另一台机器/另一个 checkout 打开,内容一致(不含 localStorage 依赖)。
5. localStorage 老用户首次打开自动迁移,迁移后旧数据只读保留;`tsc --noEmit` 与新增单测全绿。

### 风险与回退

- File System Access 浏览器兼容(Chrome 系可用,Safari 受限)→ 回退路径:下载/导入 `.zip` 项目包(Tauri 不受影响)。
- 云同步单元变化可能引发 gallery 兼容问题 → 同步改造放本期尾声,先行版本允许本地-only。

### 本期不做

词级时间、复用协议、服务抽象、合成渲染。

---

## 4. P2 · 词级时间轴:锚点 + 自动 reflow

### 目标

时间不再是手工档位,而是从**词**上投影出来的导出物:改一句词,字幕、生成段、白模运镜段全部自动重排。这是 Top 5 第 1 条,也是对照表"时间基准"行的核心差距。

### 改动点

**新增**

- [ ] `src/timing/anchor.ts` — 锚点模型(Hypit 的 2M+2N+2):每个 token 两锚、每个块/段两锚、程序起止;锚点是作者身份,帧/秒是投影结果
- [ ] `src/timing/selection.ts` — 语义标记:命名区间(Selection)与点事件(Moment);块内文本选中即可创建;可交叉不必嵌套
- [ ] `src/timing/alignment.ts` — 词级对齐客户端:音频 → 词 + 时间窗(WhisperX 类 API,BYOK;先接一个服务商,P4 再抽象);产出**自包含对齐件**(token 帧窗口 + 段边界,媒体字节与词表同行,借 Hypit `SemanticTake` 形状)
- [ ] `src/timing/reflow.ts` — 重排引擎:剧本变更 → 局部重对齐 → 投影出字幕 Cue、生成段窗口、白模段时值;`utils/videoPlan.ts` 的秒前缀聚合改为读锚点投影(保留秒前缀作为降级输入)
- [ ] `src/timing/` 单测:锚点计数恒等式、区间投影、改词后的 reflow 快照

**修改**

- [ ] `types.ts` — `ScriptBlock` 增加可选 `tokens`(词级表 + anchorId);新增 Selection/Moment、对齐件类型
- [ ] `utils/videoPlan.ts` — 时间输入从"节拍秒前缀"升级为"锚点投影",输出窗口挂语义 id
- [ ] `utils/whiteModelPrompt.ts` / `utils/grayboxPlan.ts` — 白模段 `duration`/`targetSeconds` 改挂锚点区间:改台词后运镜段自动伸缩(几何 path/lookPath 不动,**只换时间锚**)
- [ ] `components/PromptPanel.tsx` — 时间轴视图:词级刻度、Selection/Moment 图钉、对齐误差显示
- [ ] `components/Graybox3DView.tsx` — 播放头读词锚;选中词 → 移动运镜关键帧(可后置到 P2 尾声)
- [ ] Dual Text(显示 ≠ 朗读):块内容支持双列(字幕显示 / 发音),中文按字切分——短视频注音、同义替换字幕的刚需
- [ ] `services/geminiService.ts` 的 DUB/分镜模式输出挂到词锚(而非块级粗挂)

### 验收标准

1. 改剧本里一句台词(增删改词),保存后:字幕 Cue、该段生成窗口、白模段时值全部自动重排,**无需手动拖动任何段档**。
2. 对齐结果按词显示时间窗;点击字幕词跳到时间轴对应锚点,反之亦然。
3. `<BCC | B C C>` 类显示/朗读分离可用;中文按字切分计时正确("是的 就是这样"的空格策略符合 Hypit 语义:源码空格即显示空格)。
4. 断网/无对齐服务时,秒前缀输入路径仍可用(降级模式),且降级状态在 UI 明示。
5. 白模运镜段随词数伸缩后,path/lookPath 几何不被改写(验收:同几何不同词数的两个版本,坐标逐点一致)。
6. `src/timing/` 单测全绿;reflow 有确定性快照测试。

### 风险与回退

- 对齐质量取决于音频清晰度 → UI 标注低置信词,允许手动校时(校时是"作者写入",参与 reflow)。
- P2 体量大 → 可切两个交付物:P2a 落锚点 + 秒级投影(纯确定性,无对齐服务),P2b 接词级对齐 + reflow。

### 本期不做

复用协议、服务三层、合成导出。

---

## 5. P3 · 显式复用 + 冻结计划

### 目标

把需求文档里的"确定性产出、支持版本迭代和 A/B 测试"从口号变成协议:产物可指认、可复用,花钱前有只读闸门。

### 改动点

**新增**

- [ ] `src/results/` 结果仓库 — `.storyflow/results/<date>/<run-id>/`(目录名可议):`result.json`(输出命名清单)+ `files/`(实际字节);内容寻址,`run-id + output` 为精确地址
- [ ] `runs/*.sfrun` 扩展 Candidate 协议(对标 Hypit `build-record`/`satisfy`):`candidate(id, from-run, output)` + `satisfy(output, candidate)`;文件候选(`file`)同样支持
- [ ] `src/plan/freeze.ts` — 冻结计划:提交生成前把整次 run 的全部外部请求、参数、预计费用打成一份只读计划(JSON + 人读视图);**plan 阶段零外部请求**
- [ ] `src/plan/pricing.ts` — 费率表(各服务商声明单位价;H3Task.estimatedCost 的既有雏形提升为 plan 输出);未知价显式标注,不猜
- [ ] vitest:candidate 解析、计划冻结快照、复用图裁剪(被候选替代的下游步骤不再执行)

**修改**

- [ ] `App.tsx` — `h3_tasks` 迁出 localStorage 50 条上限,写入结果仓库;任务列表读仓库
- [ ] `types.ts` — `H3Task` ↔ 结果记录映射;失败任务的**已完成子产物**标记为可继承
- [ ] `components/SettingsModal.tsx` / 任务 UI — "计划预览"页:提交前列出将调用的 API、参数、预计花费,确认后才提交
- [ ] `components/ExportMenu.tsx` — 导出时引用 `(run-id, output)` 地址
- [ ] A/B 支持:两个 `.sfrun` 指向不同 Candidate,一键各跑一遍,产物并排对比(复用 P3 结果仓库,不新建机制)

### 验收标准

1. 任意一次生成的任意产物,可在后续任一 run 里**按名引用**并跳过重生成;验收:第二次 run 的计划里该步骤显示"由候选满足",且不发该 API 请求。
2. 失败任务中已完成的产物(如成功的参考图)可被下一个 run 继承;验收:制造一次中途失败,确认子产物仍可 satisfy。
3. 提交前的计划预览:**零外部请求**地列出全部将调用 API + 参数 + 预计费用;未确认不提交。
4. 同输入 + 同 Candidate 集 = 可复现结果;A/B 两个 run 文件可 git diff 出差异。
5. 任务历史不再丢(去掉 50 条上限);`run-id + output` 导出一次成功。

### 风险与回退

- 结果仓库占磁盘 → 提供清理命令(只删未被引用的 run);引用中的不可删。
- 计划冻结与实际请求漂移(服务商改行为)→ 计划与回执(run receipt)分开保存,差异报警而非静默。

### 本期不做

服务抽象(P4 可先并行)、词级细节(P2 收益在窗口粒度已够 P3 用)。

---

## 6. P4 · 服务三层(Model / Provider / Endpoint)+ 凭证库

### 目标

换服务商改配置不改代码;密钥永不进 localStorage/导出/日志;失败绝不静默换账号。

### 改动点

**新增**

- [ ] `src/providers/types.ts` — 三层契约:
  - **Model** = 请求语义(H3 的 R2V/T2V 请求形状、Seedance、GPT Image…从各 Service 提取 schema);
  - **Provider** = 一个服务商如何履约(HTTP 映射 / ComfyUI 图;`supports()` **拒绝而非钳制**——参数超界给理由,不静默截断);
  - **Endpoint** = 配置实例(地址 + 凭证引用 + 容量/并发)
- [ ] `src/providers/{minimax,comfy,fal,gemini,deepseek}.ts` — 现有 `services/*Service.ts` 收敛为 Provider 实现(异步任务型统一为 submit/poll/collect 三动作;即时型单动作)
- [ ] `storyflow.runtime.json` — Profile(对标 Hypit Runtime Profile):endpoints + 凭证引用 + **能力绑定**(`h3-r2v → minimax.cn` 之类);多候选不绑定即报错,不 fallback
- [ ] 凭证库:localStorage 移除密钥;Tauri 走 OS keyring(`src-tauri/` 插件),浏览器侧走会话内存 + 显式加密文件(不落 localStorage);导入支持 `--from file`
- [ ] `src/providers/README` 模板 — 新服务商接入指南(含 CORS 部署形态声明:直连 / 需代理 / 自托管 ComfyUI——把既有调研结论落成 Provider 元数据)

**修改**

- [ ] `services/{minimax,comfy,fal}Service.ts` — 删除或降为 Provider 适配壳
- [ ] `services/geminiService.ts` — 剧本 AI 也走同一 Endpoint 层(它是另一个能力类:`llm-chat`),1571 行按 Provider 边界拆
- [ ] `components/SettingsModal.tsx` — 改为"凭证库 + Profile 绑定"UI;密钥输入只进凭证库
- [ ] `services/aiLog.ts` / `debugLog.ts` — 日志脱敏审计(密钥不出现)
- [ ] vitest:`supports()` 边界、绑定缺失报错、日志脱敏扫描

### 验收标准

1. 把 H3 的 endpoint 从 CN 切到 intl(或换 Monid 网关):**只改 `storyflow.runtime.json`**,代码零改动,下一 run 生效。
2. 同一能力配置两个 endpoint 但不绑定 → 提交被拒绝并指名二者;绑定后走绑定者。请求失败**不会**自动尝试另一个账号/服务商。
3. 导出项目 zip + 全文搜索 API 密钥:零命中;`aiLog` 样本零命中。
4. 提示词含超出模型范围参数(如 duration=20)→ Provider 拒绝并说明,而非钳制到 15。
5. 新写一个假 Provider(测试桩)接入展示"接新服务商不用动核心"。

### 风险与回退

- ComfyUI 自托管链路复杂(已有 `comfyService.ts` + dev proxy 经验)→ Comfy Provider 允许最后迁移,先动 API 型三家。
- keyring 依赖系统钥匙串(Linux 需 libsecret)→ 回退:加密文件库,UI 提示降级。

---

## 7. P5 · 合成层 + Agent 闭环

### 目标

字幕/贴纸/标题零成本合成进成片(生成模型只出素材,不出整秒画面);量产变体脚本化;Agent 从需求文件到交付全流程走通,人只在审阅点介入。

### 5a 合成层

**新增**

- [ ] `src/compositor/` — 轨道模型(借 Hypit composition 契约的简化版):VisualTrack / AudioTrack / Present(帧区间 + 层序 + 元素树);轨道内容全部挂 P2 锚点
- [ ] `src/compositor/tracks/` — 首批轨道:**字幕轨**(词级 karaoke,PromptPanel 已有样式基础)、**标题/标注轨**、**贴纸/评论轨**(对标 comment-sticker);生成视频是底轨素材之一
- [ ] 导出合成:浏览器逐帧 canvas 烘焙(WebCodecs 优先,ffmpeg.wasm 回退);音频独立混流后封装(对齐 Hypit"音/画/混流三独立"的可测试性)
- [ ] `components/ExportMenu.tsx` — 合成导出路径(带字幕成片 / 无字幕底版)

**验收**:零生成成本出一条带动态字幕 + 标题的完整成片;字幕逐词卡点误差 ≤1 帧;音频口型与字幕对齐抽样 10 处全对;导出 60s 1080p 在参考机型 5 分钟内完成(量化基线可调)。

### 5b Agent 闭环

**新增**

- [ ] `skills/storyflow/`(或扩展 `services/webmcp.ts` 暴露面)— 对标 Hypit Skill 架构:
  - `SKILL.md`:身份 + 常设职责(Money / Existing work / Secrets / Evidence / **Files are the memory** / **Done means watched**)+ **问题→文件路由表**(约 60 行),总量控制在 ~300 行
  - `references/` 按需深读:格式规范、时间锚、运行与复用、服务商接入、格式剧本写法(口播/街采/排名/短剧…)
- [ ] 生产记忆文件(P1 的项目目录里):`BRIEF.md`(用户要什么 + 预算协议)、`TREATMENT.md`(创作方案)、`PROGRESS.md`、`FEEDBACK.json`(审阅备注)——对标 Hypit Studio Comments 回路
- [ ] `components/` 审阅模式:时间轴批注(点画面对应时刻留评),备注写入 `FEEDBACK.json`,Agent 可读可销项
- [ ] 双模式收敛(对照表"生成模式"行):`productionMode` 保留为 UX 偏好,管线统一为"图上**有无白模参考节点**";simple 不再走独立代码分支
- [ ] 量产脚本:批量 `.sfrun` 生成器(换角色 / 换 SKU / 换语言),复用 P3 Candidate 目标:"1 条 workflow,100 变体"里 StoryFlow 负责的那半

**验收**:
1. 一个 Agent 会话从 `BRIEF.md` 出发,产出 `story.sfstory` + 灰模 + 生成任务 + 合成成片,全程零人工干预直至 `FEEDBACK.json` 审阅点;失败可从 `PROGRESS.md` 断点续跑。
2. 审阅批注三条,Agent 消解后重新导出,三条批注对应画面均被修改。
3. 批量 10 个变体 run(换主角名 + 换产品),仅变化部分发起生成请求(计划预览可证),总花费 ≈ 10 × 增量。
4. simple 与 cinematic 剧本走同一管线代码(验收:代码搜索无 `productionMode` 分支实现,仅 UI 偏好)。

### 风险与回退

- 合成性能(WebCodecs 兼容)→ 优先 Chromium 系(Tauri WebView2/WKWebView 差异逐一验证);不行则后端 ffmpeg(已有 comfy 自托管先例)。
- Agent 闭环依赖文件化(P1)与锚点(P2)全部就绪 → 严格排在 P5,不抢跑。

---

## 8. 保住不动的清单(StoryFlow 优势)

| 资产 | 处置 |
|---|---|
| 剧本多格式(好莱坞/情景喜剧/中文题材)、AI 续写/灵感/润色 | 不动;Hypit 没有这块 |
| 白模 3D(`GrayboxCamera` path/lookPath 双曲线、坐标宪法、`grayboxToBlender` 出口) | 只换时间锚,几何与工具链不动 |
| 参考资产库(四源导入、四维标签、白模绑定、AI 推荐绑定) | 不动;P1 让绑定随项目目录走 |
| 双语剧本、打印排版 | 不动 |
| Tauri 桌面离线形态 | 不动;P4 借它的 keyring |
| 双模式 UX | 保留为偏好(P5c 收敛实现) |

---

## 9. MVP 最小路径(只做 P1 + P2a)

**P1 全部 + P2a(锚点 + 秒级投影,无对齐服务)** ≈ 对照表最大两行差距(创作载体、时间基准)一次补齐:

- 收益:项目可 git / 可交接 / Agent 可离线读写;改词自动重排段窗口与运镜时值;后续 P2b–P5 都有了地基。
- 不做 P2b(词级对齐)时,字幕仍是块级/秒级,但 reflow 机制已在。
- 预估:P1 约 5–8 人日,P2a 约 4–6 人日,P2b 再 +5–8 人日,P3 约 5–7 人日,P4 约 5–8 人日,P5 约 10–15 人日(Agent 与合成可再拆)。数字是量级参考,按站长节奏调整。

---

## 10. 附:映射索引

**Top 5 → 期号**

| # | 可借鉴要点 | 落点 |
|---|---|---|
| ① | 词当时间轴,秒当导出物 | P2 |
| ② | 状态落盘为内容/样式/意图三种文本 | P1 |
| ③ | 复用靠显式指认,确定性靠冻结计划 | P3 |
| ④ | Model/Provider/Endpoint 三层,不 fallback | P4 |
| ⑤ | 路由表式 Skill 文档 + 文件即记忆 + done-means-watched | P5b |

**对照表 18 行 → 期号**(行名见 `docs/hypit-study.md` §7.2)

| 对照表行 | 落点 | 对照表行 | 落点 |
|---|---|---|---|
| 创作载体 | P1 | 复用/版本 | P3 |
| 中间表示 | P1(+P3 冻结计划) | 参考资产 | 保持(绑定随项目走) |
| 时间基准 | P2 | 提示词工程 | P1(模板落盘) |
| 语义标记 | P2 | 合成/渲染 | P5a |
| 生成模式 | P5c | 多版本量产 | P5(+P3) |
| 运镜控制 | 保持 +P2 换锚 | 成本治理 | P3 |
| 确定性 | P3 | 凭证 | P4 |
| Agent 协作 | P5b | 服务商切换 | P4 |
| 审阅 | P5b | 部署形态 | 保持(单机优势) |
