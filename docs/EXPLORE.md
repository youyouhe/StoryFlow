# StoryFlow 现状盘点(只读探索报告)

> 探索日期:2026-09-23 · 基线:`main @ e4deae0`(worktree `explore`,工作区干净)
> 方法:通读 README / 需求0901.md / docs/、`tsc --noEmit`、`npm run build`、dev 冒烟、git 历史审阅、密钥史扫描。未改动任何功能代码。

## 一句话架构

**纯前端本地优先应用**:React 19 + TS + Vite(可 Tauri 2 打包桌面),无自研后端——所有 AI 能力(Gemini/DeepSeek 文本、MiniMax 图+视频、FAL 图、自托管 ComfyUI)均为浏览器 BYOK 直连(部分走 dev-server 代理);可选云同步/SSO 依赖外部私有仓库(storyflow-gallery)与外部 4A 登录。

## 产品形态

面向**电影/微短剧/网文创作者**的 AI 剧本工作台。已从「剧本编辑器」(1 月初版)演进为**从文字到成片的管线**:

```
剧本创作(19 模板/AI 八模式) → 视觉风格 StyleHead → 分镜 imagePrompt → 参考图资产库
→ graybox 3D 预演(AI 生成走位+运镜 JSON,Three.js 渲染) → 白模视频导出(Canvas 录制)
→ Video Plan 分段规划(节拍时间戳 → 生成段) → MiniMax H3 API(浏览器 BYOK)或自托管 ComfyUI
→ 任务追踪(刊例成本估算/分段状态) → 导出 PDF/MD/JSON/Blender 脚本
```

产品路线见 `需求0901.md`(AI 视频生成模块完整 PRD,四源参考图/绑定/提示词工程/任务管理);`docs/api-research-seedance-h3.md` 是火山方舟 vs MiniMax 的 CORS 实测调研,直接决定了「H3 浏览器直连、Seedance 手动工作流」的技术选型。

## 技术栈与分层

- React 19 + TypeScript 5.8 + Vite 6 + Tailwind v4;Three.js(@react-three/fiber+drei)做 3D 预演;html2pdf.js 导出
- 扁平布局:`App.tsx`(2842 行,全部状态)+ `constants.ts`(模板/翻译/提示词,74KB)+ `types.ts`(领域模型,注释极好)+ `components/`(15 个)+ `services/`(15 个)+ `utils/`(16 个),共 ~21k 行 TS/TSX
- `src-tauri/`:薄壳(main.rs 7 行,CSP 内联于 tauri.conf.json;目标 app/appimage/nsis)
- 前后端边界:**仓库内无后端**。云同步后端在私有仓库 youyouhe/storyflow-gallery(Hono+pg,`server/` 已于 b5e65cb 抽出);SSO 走外部 4A(smartbid.site);`deploy.yaml` = 向导静态托管配置(same-origin 挂 gallery)
- agent 工具链:`services/webmcp.ts` 注册 17 个 `storyflow_*` 工具 + `scripts/dev.sh`(Vite+WebMCP Chromium 一键管理)

## 功能盘点(完成度)

| 模块 | 说明 | 完成度 |
|---|---|---|
| 剧本编辑核心 | 6 类块流式排版、智能换型、快捷键、19 模板(影视/短剧/网文/歌词/科普)、中英双语 UI、双语文稿 | ✅ 可用,成熟 |
| AI 文本辅助 | Gemini/DeepSeek 双供应商;8 模式:续写/点子/重写/分镜提示词/GRAYBOX/配音分析/FROM_PROMPT 转写/VIDEO_PLAN;上下文窗口可调 | ✅ 可用 |
| 多稿管理 | localStorage 两级(script_index+script_{id})、1s 防抖自动保存、旧版迁移、AI 开场生成(OpeningPicker) | ✅ 可用 |
| 导出 | PDF(含 AI 附录)/Markdown/JSON 导入导出、资产包导出、Blender .py 单向导出、配音表 | ✅ 可用 |
| 云同步 (P1) | outbox 队列+单调 revision+409 冲突自动分叉(本地赢);后端在**私有仓库**;4A SSO(VITE_DISABLE_SSO=1 可关) | ✅ 可用(依赖外部服务) |
| 参考图资产库 | IndexedDB v4 身份模型(kind/charName/variant/sceneKey/版本组)+ 文件夹后端(File System Access API,可挂同步盘);AI 生图双后端:MiniMax image-01 / FAL 队列 | ✅ 可用(文件夹后端限 Chrome/Edge 安全上下文) |
| Graybox 3D 预演 | AI 生成场景布局+运镜 JSON(严格归一化),R3F 渲染 orbit/POV 双视图,白模体检(grayboxHealth),段级 graybox(一镜到底多节拍) | ✅ 可用 |
| 白模视频导出 | Canvas 干净渲染录制(隐藏辅助元素)、按 path/lookPath 运镜、MP4 | ✅ 可用 |
| Video Plan 分段 | 节拍时间戳聚合进模型固定窗(4–15s)、节拍不跨段、窗口切换即时重规划、成本预估(官方刊例) | ✅ 可用 |
| MiniMax H3 管线 | 浏览器 BYOK:上传→建任务→轮询→下载;分段链(chainId)、每段状态、失败原因恢复;CN/国际端点 | ✅ 可用(9 月密集修复后的稳定期) |
| ComfyUI 自托管 | T2V/I2V/R2V 三图按 class_type 结构化 patch、导入预检校验(节点注册表)、R2V 白模视频直喂(pro 模式)、dev 代理 | 🟡 刚跑通(本周落地,fix 密度高,最后一笔仍在修校验性能) |
| Seedance 2.5 | 提示词生成+手动上传即梦可用;**API 直连放弃**(实测无 ACAO,调研文档有结论) | 🟡 手动工作流(有意为之) |
| 配音 DUB | AI 推断情绪/语气/强度存块、配音表导出;**无 TTS 执行环节** | 🟡 半成品(止于元数据) |
| Tauri 桌面壳 | 可打包;但 CSP connect-src **缺 fal.ai 与 ComfyUI 直连**,桌面版功能落后 web | 🟡 半成品 |
| WebMCP 工具面 | 17 个 storyflow_* 工具(读稿/追加/graybox/提示词/导出等),append-only 写面设计 | ✅ 可用(开发工具链) |

## AI / 外部服务依赖与密钥管理(如实评估)

| 依赖 | 用途 | 接入方式 |
|---|---|---|
| Gemini / DeepSeek | 文本 AI(默认供应商) | 浏览器直连,BYOK |
| MiniMax(api.minimaxi.com/.cn/.io) | image-01 生图 + H3 视频生成 | 浏览器直连(CORS 实测通过)+ dev 代理备选 |
| FAL(queue.fal.run) | 文生图队列(gpt-image-2.5/flare) | 浏览器直连,2026-09-16 CORS 复验 |
| ComfyUI(pod) | 自托管 H3 工作流 | **仅 dev-server 代理**(`/comfy-api` → COMFY_TARGET,pod URL 会轮换);Tauri/prod 直连 |
| 火山方舟 Seedance 2.5 | 视频生成 | **不直连**(无 ACAO),仅出提示词手动上传 |
| storyflow-gallery(私有仓库) | 云同步 API | same-origin 或独立部署 |
| 4A SSO(smartbid.site) | 统一登录 | 浏览器 token 换 gallery 会话 |

**密钥管理结论(如实)**:
- 所有 key 为**用户侧 BYOK**,存 localStorage `screenplay_app_settings`,从浏览器直接带参请求——服务端不存 key,风险面小;
- git 历史扫描:**无真实密钥入库**(仅 server/.env.example 占位符;`.env.local` 被 `*.local` 覆盖且工作区无该文件);
- 两个卫生问题:① `vite define` 会把构建期 `GEMINI_API_KEY` **烤进 JS bundle**——若带真实 key 跑静态部署会随包泄漏,当前仓库无该文件、未发生,但流程上无守门;② `vite.config.ts` 硬编码了一个 pod 域名作为 COMFY_TARGET 兜底(会轮换的基础设施地址,敏感度低但属外部细节入库)。

## 完成度证据:近期提交在修什么

169 个提交:1 月初版 16 笔;8/30 起爆发 153 笔(9/18–9/20 三天 28+28+27)。9 月以来 **87 feat / 48 fix(fix 占 36%)**,fix 集中区:
1. **ComfyUI 接入周**(最近 10 笔):代理路由、env 作用域、UI 格式图误导入、节点注册表逐图拉取(多 MB×每图,最后一笔修的就是它)→ 典型「新管线落地摩擦」;
2. **H3 端点/协议漂移**:/v1→/v2 世代切换、1080P 枚举张冠李戴、subject_reference 只收一张图、失败原因被吞;
3. **跨模块状态传递 bug**(最高频):segment cast 切片读错、装束变体借用他人、plan 窗口滞后一拍、表单按钮误提交——纯逻辑模块(videoPlan/beatCast/refBindings/refBindings 解析)反复出回归。

## 运行状态(本机实测)

- `npm install` ✅;`npx tsc --noEmit` **0 错误** ✅;`npm run build` ✅(14s,单 bundle 2.07MB/gzip 588KB,有 chunk 警告)
- dev 冒烟 ✅:5173 端口已有 Vite dev server 在跑(HTTP 200),App.tsx/geminiService/comfyService 按需编译均 200 —— 页面加载正常,未做深度操作
- `scripts/dev.sh` 提供完整 dev 工作台(app+WebMCP 浏览器);`npm run dev:https` 为 LAN 安全上下文备选

## 测试与质量

- **无测试框架、无 lint、无 CI**(无 .github/workflows);质量门只有 `typecheck`(tsc)与构建
- `scripts/` 下有 sync-e2e / sync-smoke / gallery-e2e 三个验证脚本,但依赖真实后端(私有仓库),非自动化
- 类型注释质量**非常高**(types.ts 的坐标宪法、各 service 的坑位记录),部分弥补了测试缺失

## 技术债 / 痛点 Top 3

1. **单体化 + 回归热区无护栏**:App.tsx 2842 行(40+ useState 全在一个组件)、geminiService 1571 行(12 个 AI 函数同文件);9 月 1/3 的 fix 是跨模块状态传递类 bug,而 videoPlan/grayboxPlan/beatCast/refBindings 这些纯函数恰是最易测、也最常回归的地方——零测试。
2. **质量门缺失 + 包体失控**:无 CI/lint/单测;2.07MB 单 bundle 无代码分割(Three.js 全量打入);桌面壳 CSP 与 web 功能脱节(fal/Comfy 缺席)。
3. **外部依赖脆弱 + 文档滞后**:BYOK 直连强依赖厂商 CORS 与端点世代(v1→v2、枚举、pod 轮换都咬过一口);代理只存在于 dev server;**CLAUDE.md 与 README 完全未提及视频管线/graybox**(README 还在描述「localStorage 两个 key」的初版),新接手者只能靠读代码。

## 最值得继续完善的三个方向(基于代码现状的客观推断)

1. **给回归热区上护栏、顺势拆单体**:为 videoPlan / grayboxPlan / beatCast / refBindings / sequence 建纯函数单测(输入输出都是 JSON,成本极低),再把 App.tsx 的状态切片(稿件/资产/H3 任务/同步)抽成独立 store/hook——直接消灭「切片读错」「借用他人装束」这类 bug 的滋生土壤。
2. **可选轻量接入网关(self-hosted proxy)**:统一代理 MiniMax/FAL/ComfyUI/(未来)方舟,顺带解决 pod URL 轮换、生产模式无代理、Tauri CSP 漂移、Seedance 直连解锁,并提供「托管 key」选项(BYOK 保留为隐私档)。调研文档已给出同样判断,是水到渠成的一步。
3. **成片交付最后一公里**(对应 需求0901 Phase 2 清单):多段链自动拼接(H3 无帧连续续写,当前 chain 生成后**留给用户手动拼**)、多版本并排对比/一键重生成、渲染后验证(首尾帧/景别/朝向/参考图 CLIP 打分);同时刷新 README/CLAUDE.md 与桌面端对齐,让对外叙事追上代码现状。

---
*盘点人:Claude Code agent · 2026-09-23 · 只读探索,未改动功能代码*
