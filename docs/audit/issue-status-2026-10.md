# StoryFlow 未关闭 issue 逐条核实报告(2026-10-14)

审计分支:`audit/issues`(自 `ir-schema` b8aa84b 切出)。方法:逐条读代码取证(**不凭提交信息推断**)+ 运行单测 + 临时分支试合并摸底。全程只读,未改任何源码、未 push、未留合并提交。测试运行于 `/mnt/data/git-work/sf-audit/` 下的独立临时 worktree(`npm ci` 安装依赖,结束后已全部清理)。

## 0. 分支拓扑(审计实测)

```
main (e4deae0, 09-20 停滞)
├── feat/p1-project-files (58056ff)  ← Hypit P1-P5 + 尾声(#4 相关)
├── ir-schema (b8aa84b)              ← IR 管线 P0-P14(#6 #7 相关)
└── refactor/split-app (76eb0c8)     ← 已通过两个 merge 提交并入了 p1(3afd323)
                                       与 ir-schema P0-P13(ae4d879),
                                       再叠加 #8/#9/#10/#11/#12 等 8 个修复提交
```

关键事实:**refactor/split-app 已包含 p1 全部提交与 ir-schema 的 P0-P13**;ir-schema 相对 split-app 仅多 1 个提交(P14,b8aa84b)。三条线合一只剩「P14 并入 split-app」一步。

## 1. 结论表(issue → 状态 → 证据)

判定基准:主要实现分支上加粗;所有行号均在对应分支 tip 实读核实。

### #4 Hypit 尾声三项 —— **部分解决**(`feat/p1-project-files` 58056ff + `refactor/split-app`)

| 项 | 判定 | 证据 |
|---|---|---|
| WebCodecs 出口 | **已解决**(p1) | `utils/compositor/webcodecs.ts`(p1,307 行):`:87 pickCompositeExport()`、`:129 exportCompositeMp4`(VideoEncoder + AAC `isConfigSupported` + 动态 `import('mp4-muxer')`);接入链 `components/ComposeExportModal.tsx:115-125`(webcodecs-mp4 优先,MediaRecorder 兜底)、`App.tsx:3145`、`ExportMenu.tsx:217-220`。测试 `utils/compositor/__tests__/webcodecs.test.ts` 7 例。注:题面说"与 services/ffmpeg 并行"——**全仓任何分支都不存在 services/ffmpeg**,实际并行对象是 MediaRecorder(capture.ts:7 注释为前瞻说明) |
| 候选编辑器 | **已解决**(p1) | 纯层 `services/project/candidates.ts`(`outputsOf/candidateFromOutput/withCandidate/withSatisfaction/validateRunCandidates`);UI `components/CandidatesPanel.tsx`(296 行,`:4-5` 连 `projectStore`/`results` 结果仓库,`:237-281` satisfy 边编辑,存回 `runs/*.sfrun`);挂载 `App.tsx:3171-3176`。测试 `services/project/__tests__/candidates.test.ts` 8 例 |
| Tauri 插件 | **p1=部分 / split-app=已解决** | p1 分支:TS 层完整(`services/desktop.ts:33-38 createKeyringStore`),但 `src-tauri/src/keyring_plugin.rs` 文件头自述**有意未接线**(main.rs 无 mod、Cargo.toml 无 keyring 依赖)。split-app 分支:已接线——`src-tauri/src/main.rs:3,8-10`(`mod keyring_plugin` + invoke_handler 挂 `keyring_get/set/delete`)、`src-tauri/Cargo.toml:12 keyring = "3"`。⚠️ 开发机无 cargo,Rust 侧**未编译验证**(keyring_plugin.rs:14-17 自述) |

### #5 手验双链 —— **部分(核心需人工)**(`refactor/split-app`,docs/ir-pipeline-test-report.md)

| 验收项 | 判定 | 证据 |
|---|---|---|
| 选剧本走全链 | 部分 | 自动化替代证据:`docs/ir-pipeline-test-report.md:7-19` 5 剧本矩阵 A-E(extract→三路编译→SRT/VTT/JSON 全过 `validateStoryFlowIR`);`:26-34` DOM 驱动 E2E《旧梦胶片》全流程零页面错误。报告 `:4` 明确:**真实 LLM 付费链(生图/生视频/TTS 花费调用)一律未执行**——真人在真实页面跑通付费链无可替代 |
| 样例记录到 docs/ | 已解决(带保留) | `docs/ir-pipeline-test-report.md`(79f444d 新增);但 `docs/examples/yinshan-chenchen.json` 等样例文件来自更早提交,非手验过程新增 |
| 字素 fallback 观感 | **需人工** | 报告中无任何观感记录(结构性质有断言,断句美观/节奏只能真人看) |
| 发现问题开新 issue | 部分 | 报告 `:36-42`:唯一发现的缺陷已随提交修复+测试锁定,`:42` 明说未开新 issue;遗留 4 条(报告 `:44-49`)未转化为 issue |

### #6 IR 真对齐服务接线 —— **已解决**(`ir-schema` e3f220f,split-app 继承)

| 验收项 | 判定 | 证据 |
|---|---|---|
| ports 绑定 + 本地桩可真跑 | 已解决(形状有差异,见注) | port:`src/exec/types.ts:53-55 alignTake?`;runner:`src/exec/audioExec.ts:84-115 alignAudioClips`(clipId 由 runner 盖章,未绑定即抛);真绑定:`src/exec/wiring.ts:23-30 defaultAudioPorts({ alignEndpoint })`;客户端:`src/align/client.ts:30-69`(multipart 契约 + `fetchFn` 可注入 + token 数逐位校验);本地桩:`scripts/align_service.py`(324 行 ThreadingHTTPServer,CPU 声学对齐)+ `scripts/align_service.sh`(start/stop/status,拒绝绑生产端口)。**注**:对齐是一次性 POST(P8 强制契约),submit→poll→collect + 假时钟那套在共享轮询层 `src/exec/poll.ts:26-27`(`now/sleep` 可注入,视觉测试真用了)——意图满足,字面形状未照搬 |
| P0-P6 e2e dry-run | 已解决(音频链) | `tests/exec-e2e-dryrun.test.ts`(文件头自述 issue #6):"一测贯通:提取 → 三轨执行 → 对齐回灌 → karaoke → 导出 cuts"——`extractStoryFlowIR → compileAudioPlan → executeAudioPlan → alignAudioClips → compileAudioPlan(回灌) → buildWordCues/placeWordCues → mapMixToProSegmentCuts → exportProCutWithCuts`(全 mock);第二例用真 `createAlignClient` + 注入 fetchFn 走拒绝路径。另有非 vitest 真服务全链 `scripts/align-e2e-dryrun.ts`(21 断言,含对齐质量量化 <120ms)。**视觉链无单测贯通**(分散在 exec-visual/exec-export) |
| 真 WhisperX 接线 | 已解决(适配器层) | 换入点已兑现:endpoint 参数即换入(wiring.ts:27-29);WhisperX 模型本体未接(`align_service.py:8-14`:本机无 GPU,当前 CPU 声学对齐,GPU 换 backend 零改动)——**属预期预留**,不判未解决 |

### #7 图/音频价目+结算 —— **基本已解决**(ir-schema 1670517 + db467b6,split-app 继承)

| 验收项 | 判定 | 证据 |
|---|---|---|
| 生图/TTS/BGM 刊例,销 unpriced | 已解决(范围=image/TTS/BGM) | 价目契约 `src/ir/annotations.ts:18-30 PriceBooks`(image perImageFen/minimax/fal 分册;tts perCharFen;bgm perRequestFen);计价 `src/exec/pricing.ts:21-37`(imageJobCostFen provider 分册 → 兜底 → null;tts 按字符;bgm 按次;SFX 显式 0 非unpriced);`src/exec/budget.ts:29-31` 给 books 后 unpriced **收窄到只剩 comfy/grok 视频**(无刊例,记档于 docs/storyflow-ir-p9.md:49,自托管成本≈0 属业务判断)。口径:输入制(调用方声明 books,代码不编造数值);官方刊例硬镜像仅 minimax 视频(`src/ir/visual/cost.ts:25-40`)。测试 `tests/exec-pricing.test.ts` 11 例 + `tests/ir-annotations.test.ts` round-trip |
| 按成功任务精确结算 | 已解决(双口径并存) | `src/exec/pricing.ts:51-92 settleVisualRun`(仅 succeeded 计,逐 job 明细)、`:133-170 settleAudioRun`(TTS 只计实际合成 clip、BGM 只计到账);`src/exec/batchExec.ts:51-56` `opts.settlement: 'attempt'(缺省,发起即计回归保留) \| 'precise'`;测试同步(`tests/exec-batch.test.ts:116-143`:attempt 回归锁 + precise 失败计 0/部分成功只计 succeeded) |
| 逐任务粒度/实时结算/批量 UI(可选) | 未实现(可选) | grep `settleVisualRun\|executeBatch\|planCostReport` 在 components/App.tsx 零命中;exec 层原语已备(SettledJob[]、budgetFen、onProgress)但无 UI、无逐 job cap、无滚动计费 |

### #8 剧本 JSON 去冗余 —— **大部分已解决**(`refactor/split-app` 3a43dd0)

| 验收项 | 判定 | 证据 |
|---|---|---|
| ① 改 styleHead 全块即时更新 | 已解决 | 写侧只存增量:`services/geminiService.ts:681-686/887-891`(注释明言 prefix 不再内联);读侧单一出处 `utils/promptStyle.ts:44-55 composeBlockImagePrompt`(每次读取从**当前** styleHead 合成,未迁移内联不重复加);消费点 PromptPanel.tsx:129/713、ExpressWorkbench.tsx:64、exportData.ts:115、webmcpAccessor.ts:488,502;旧数据反解 `utils/screenplayMigrate.ts:27-28 stripBlockPrefix`(幂等)。测试 `tests/promptStyleMigrate.test.ts`("editing styleHead.promptPrefix updates EVERY existing block 验收①") |
| ② 角色 sheet 全剧一份 | 已解决 | `types.ts:221-226 characterSheets?: Record<string,string>`(key=CHARACTER cue 原文);迁移收编 `utils/screenplayMigrate.ts:38-43`(first wins + 删块内副本);新生成 `hooks/useAIExecutor.ts:212-224/692-704` 走 registry 不内联;读 `utils/promptStyle.ts:32-38 characterSheetOf`(registry 优先内联兜底);删除联动 `hooks/useBlockEditing.ts:33-58`。测试 promptStyleMigrate + characterSheet.test.ts(13 例)+ yinshanExample.test.ts(断言 cue 不内联副本) |
| ③ 导出含 schemaVersion、IR 可读 | **部分** | 导出写 `utils/exportData.ts:225-231 schemaVersion: max(?, 3)` + 打包 characterSheets ✅;但 **`src/extract/screenplayToIR.ts` 不读 schemaVersion 分流**(靠 `:168-170` 前缀治愈隐式兼容 legacy/v3 两种形状),且 characterSheets registry 不被 IR 提取消费(grep 零命中) |
| ④ CHARACTER extension 字段(V.O./O.S.) | **部分** | 字段有:`types.ts:34-39 characterMarker?: 'vo'\|'os'`;解析/迁移/导出有(`utils/beatCast.ts:52-59`、`screenplayMigrate.ts:46-49`、`exportData.ts:243`)。缺口:**生成侧不写**(scriptParse/useAIExecutor/模板块均不设,v3 新增 cue 永远拿不到)、**提取侧不读**(IR 走文本匹配 isOffScreen 等价) |
| (附)localStorage 无损迁移 | 已实现 | `utils/screenplayMigrate.ts:30-60`(纯、幂等、无损),触发点 useScriptLibrary.ts:52/77-79/160、useImportExport.ts:49;测试锁幂等 |

### #9 P4 凭证迁移缺陷 —— **大部分已解决**(`refactor/split-app` 0415a92;详见 §3)

① 现状/一致性/一次性迁移均解决;④ 刷新提示**部分**(remember/keyring 档自动恢复+toast,纯 session 档刷新静默丢 key 无主动提示)。

### #10 手写剧本自动节拍回退 —— **已解决**(`refactor/split-app` e48a81b + 5b5a91b)

| 验收项 | 判定 | 证据 |
|---|---|---|
| 无时间戳 → estimated 完整三路计划 | 已解决 | `src/extract/screenplayToIR.ts:136-141`(hasTimedBeat 为 false 走 `synthesizeEstimatedPlan`);合成 `utils/videoPlan.ts:310-434`(拍长优先级:graybox targetSeconds→shotDuration(authored 不标)→词级估时钳 [1,10]s;空镜拍缺省 3s);estimated 写入 `screenplayToIR.ts:226` + schema `src/ir/schema.ts:157`。测试 `tests/extract-screenplay.test.ts:145/157` |
| 空/全空提取有原因提示 | 已解决 | `components/IRPipelineModal.tsx:112-116` emptyReason 三分支 + `:184-186` 估算提示文案(措辞与 issue 原文不同,语义覆盖) |
| debug-log 落盘修复 | 已解决 | `vite.config.ts:26-31`:`process.env.STORYFLOW_RUN_DIR` 优先,缺省按端口分目录(替代硬编码 /tmp/storyflow-dev)。**ir-schema 分支此文件未修**(仍硬编码),该修复归属 split-app 线 |

### #11 节拍回退粒度细化 —— **已解决**(`refactor/split-app` fa17ce3)

多拍合成(每个非空 ACTION 开新拍 `utils/videoPlan.ts:384-387`,空镜拍锚定场景边界 `:367-382`,分段不跨场景 `:424-430`);全对白覆盖(TTS 从拍的全部 dialogues 派生 `src/extract/screenplayToIR.ts:445-470`,余句=非锚 clip;字幕同集合驱动);时长钳制 [1,10]s + 词窗按字素权重比例分窗(`src/captions/compile.ts:79-90 proportionalSpans`);逐拍 estimated 可辨。测试 `tests/extract-screenplay.test.ts:195-227`(≥3 拍/全对白进 TTS 与 SRT/钳制/无 22s 巨条)+ `tests/ir-pipeline-matrix.test.ts:148-155`。实测同款《旧梦胶片》场景在矩阵 B 组有回归锁。

### #12 场景名中文标点 —— **已解决于 split-app;ir-schema 未修**(1d3ef66 + e9dcccd)

split-app:`src/extract/screenplayToIR.ts:53-63`——前缀剥离类 `[\s.,，、:：]*`(56 行)含中文逗号/顿号/全角冒号,切段正则把「，」「、」当分隔符(58 行),「内景，废弃剧院 - 午夜」→ `scene:废弃剧院`;测试 `tests/extractClean.test.ts`(场景短键 describe,含中文逗号例)+ `tests/extract-screenplay.test.ts:55-65`(INT./EXT. 英文不回归)。**ir-schema 同函数(:46-53)仍是旧版 `[\s.:]*`,未修**——随 P14 并入 split-app 的合并自然消解。

### #13 字幕/TTS 语速脱钩 —— **未解决(两分支均无)**

grep 证据(两分支 src/ utils/ components/,排除 node_modules):

1. **语速模型不存在**:无 4.5 字/秒、无 speechRate/charsPerSecond;唯一近似是 `utils/timing/estimate.ts:14`(CJK 0.2s/字 ≈ 5 字/秒)——那是 #10/#11 的拍长合成估时器,不是字幕/TTS 的语速维度。
2. **字幕窗口 ≠ max(拍长, TTS 估算)**:P11 编译器窗基 `basisSec = measured ?? fitShotDuration(shotDuration, ttsFloor).wantSeconds`(split-app `src/captions/compile.ts:275-280`)——是「拍长 vs 实测探活」取值,无「按台词字数估的朗读时长」输入;全链(镜头时长/探活实测/对齐件)无字数÷语速。
3. **拍长不足警告不存在**:grep 朗读需 Ns 语义零命中;现有警告仅 oversize/tooShort/CAPTION_TOO_SHORT。
4. **括注 0.7 倍折算不存在**:`estimate.ts:41` 括注块乘数是 0.85(块级,非行内 0.7 折算)。

结论:#13 四条验收(语速模型/字幕窗口 max/不足警告/0.7 折算)在 ir-schema 与 split-app 均未实现。

## 2. 试合并摸底(临时分支 --no-commit --abort,未留提交)

| 试合并方向 | 结果 |
|---|---|
| `feat/p1-project-files` ← `refactor/split-app` | Already up to date(p1 已是 split-app 祖先,无需合并) |
| `refactor/split-app` ← `ir-schema` | **冲突 1 文件 1 hunk**:`src/captions/compile.ts` |
| `feat/p1-project-files` ← `ir-schema` | 冲突 5 文件 17 hunks:App.tsx(9)、components/SettingsModal.tsx(3)、package.json(1)、package-lock.json(3)、types.ts(1)——**不推荐直接合**,split-app 的 ae4d879/3afd323 已解决过同批冲突 |

**冲突语义(split-app ← ir-schema 的唯一冲突)**:P14 把字幕/karaoke 摆位抽取为共享原语 `resolveShotPlacements`(ir-schema 无 #11),而 split-app 在旧结构循环里叠了 #11「全对白覆盖 others 块」——git 无法自动安放。这不是文本级冲突而是**特性交错**。

**推荐合并顺序**:
1. `ir-schema` → `refactor/split-app`(只带 P14,1 hunk;解析方式:取 P14 的 placement 结构,把 #11 others 块适配进 P11 路径循环外——`anchorBase = anchorTextOf(shot)` 就地补,`filmOffset` 换 `p.filmOffsetMs`)。
2. `refactor/split-app` → `main`(或直接以 split-app 为新主线)。

**合并后验证**(在临时 clone 完成上述解析后实测,clone 已删除):

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx vitest run` | ✅ **49 文件 / 513 用例全绿**(split-app 单独 48/504;多出的 1 文件 9 例即 P14 的 karaoke/ASS) |
| `npm run build` | ✅ exit 0(仅 chunk>500kB 提示,与本次合并无关) |

各分支单测基线(独立 worktree `npm ci` + `npx vitest run`):

| 分支 | 结果 |
|---|---|
| feat/p1-project-files | ✅ 12 文件 / 97 用例全过 |
| ir-schema | ✅ 30 文件 / 316 用例全过 |
| refactor/split-app | ✅ 48 文件 / 504 用例全过 |

## 3. #9 凭证迁移专项(任务第 4 条)

**`services/credentials.ts` 现状**(split-app,实读):
- session store:模块级 `Map<slot, secret>`(:38-50),slot ∈ minimax|fal|gemini|deepseek|asr;
- `stripSecrets`(:32-36)对 5 个 SECRET_SETTINGS_FIELDS 置空,持久化点 `hooks/useAppSettings.ts:164-166`("localStorage never holds plaintext keys");
- **本机记住(加密)档**(:60-109):设备随机口令(32 字节,落 `storyflow_cred_device_key`)+ PBKDF2(210k)/AES-GCM 密文落 `storyflow_cred_remember`,非明文;
- **keyring 档已接线**:`src-tauri/src/main.rs:3,8-10` + `Cargo.toml:12 keyring="3"` + `services/desktop.ts:37-75`(单次失败逐调用降级 session)。⚠️ 开发机无 cargo,Rust 未编译验证;`credentials.ts:8-10` 头注释仍写"keyring noted, not wired"——**已过时,仅注释问题**。

**SettingsModal 显示来源**:表单初始值 = `appSettings`,其 load 时经 `migrateAndHydrate` 从 session store 水合(`credentials.ts:132-134`);五个密钥栏均 `type="password"` 掩码显示(SettingsModal.tsx:507/541/594/629/767)。**无幽灵字段**——显示即生成路径读到的状态(写穿:`useAppSettings.ts:174-186`,空值=删槽)。

**一次性迁移:有**。`services/credentials.ts:120-136 migrateAndHydrate`(旧明文字段种入空 session 槽,session 已有值优先,幂等),触发于 `hooks/useAppSettings.ts:59-65`,toast 文案在 `constants.ts:749-755`("已迁移 N 个密钥到会话凭证库——刷新后会丢失,可在设置选择「本机记住」或桌面端 keyring 档"),迁移后旧字段经 stripSecrets 落盘被清空。测试 `tests/credentialMigration.test.ts:35-64`。

**刷新后提示:部分**。remember/keyring 档:boot 自动恢复 + toast(useAppSettings.ts:102-160,失败有恢复指引文案);纯 session 档(默认档):刷新后 key 静默消失,只有 Settings 内常驻文案(SettingsModal.tsx:681),**无主动 toast**——这是剩余缺口(对应验收第 3 条的"明确提示")。

**最小修复方案(不重引入明文持久化,只描述)**:
- 思路:session store 刷新即空是设计行为,无法在刷新后"检测丢失";改为**持久化一个非敏感计数标记**。`services/credentials.ts` 增加 `sessionCredentialCount`(如落 `storyflow_cred_count`,只存上会话非空槽位数,不含任何密钥材料);`hooks/useAppSettings.ts` 写穿密钥时同步更新计数;boot effect 的 session 分支(:155-158)改为:若标记 >0 且当前 snapshot 为空 → toast「上次会话的 N 个密钥已随刷新清除——可在设置重输、导入凭证文件,或开启『本机记住』」。
- 改动点:`services/credentials.ts`(+~15 行)、`hooks/useAppSettings.ts`(boot 判断 + 写穿处 +1 行)、`constants.ts`(双语文案)、`tests/credentialMigration.test.ts`(+2 例)。工作量 **S**。

## 4. 修复派单建议(未解决/部分项)

| 顺序 | 项 | 改动点 | 量 | 依赖 |
|---|---|---|---|---|
| 1 | 合并落地:ir-schema(P14)→ split-app | `src/captions/compile.ts` 1 hunk——本审计已在临时 clone 给出可用解析(513/513 绿),可直接采纳 | S | 无;做完后续项都在唯一主线上 |
| 2 | **#13 语速模型**(唯一整条未解决的 issue) | `utils/timing/estimate.ts`(4.5 字/秒可配置常量 + TTS 估时 = 字数/语速 + 0.4s 余量,行内括注 0.7 折算);`src/captions/compile.ts`(字幕窗 = max(拍窗, TTS 估算);拍长不足警告新 warning code);`src/extract/screenplayToIR.ts`(警告透传);`tests/captions-compile.test.ts` + 新用例。注意与 #11 others 分窗共用 estimateTextSeconds,改动会影响 `tests/extract-screenplay.test.ts` 的钳制断言 | M | 建议在合并落地后做,避免再撞 compile.ts 冲突 |
| 3 | #8③ 收尾:提取器版本分流 + registry 消费 | `src/extract/screenplayToIR.ts`(读 schemaVersion;`spanBlocks` 找不到 imagePrompt 时查 `characterSheets` registry) | M | 无 |
| 4 | #8④ 收尾:characterMarker 全链 | 生成侧写字段(`utils/scriptParse.ts`、`hooks/useAIExecutor.ts`);IR 提取消费(可选,现有 isOffScreen 等价) | S | 无 |
| 5 | #9④ session 档刷新提示 | 见 §3 最小修复方案 | S | 无 |
| 6 | #5 真人手验 + 缺陷转 issue | 真实页面跑付费链;字素 fallback 观感;报告 `:44-49` 遗留 4 条开 issue | S(人工) | 需真实 API key 与人 |
| 7 | #4③ Rust 编译验证 | 有 cargo 的机器跑 `npm run tauri:build-debug` | S | 需 cargo 环境 |
| 8 | #6 收尾(可选):视觉链 e2e 贯通单测 | `tests/`(补 extract→visual→export 一条测试,对齐音频链) | S | 无 |
| 9 | #7 可选项(可选):逐任务预算粒度/实时结算/批量 UI | components/ 新面板 + exec 层扩展 | L | 依赖 #7 主体(已备原语) |
| 10 | split-app → main 合并 | 冲突预计同 §2(p1/ir-schema 已被包含,main 落后太多,建议直接 fast-forward 语义审阅) | M | 1-5 完成后 |

## 5. 附录:运行过的命令

```bash
# 环境(全部在 /mnt/data/git-work/sf-audit/ 下,结束后已清理)
git -C /home/git/projects/StoryFlow worktree add --detach wt-<branch> <branch>
npm ci --no-audit --no-fund        # 各 worktree
npx vitest run                     # 三分支基线:p1 97✅ / ir 316✅ / split 504✅

# 试合并摸底(不留提交)
git checkout --detach refactor/split-app && git merge --no-commit --no-ff ir-schema
git diff --name-only --diff-filter=U && grep -c '^<<<<<<<' <file> && git merge --abort
git checkout --detach feat/p1-project-files && git merge --no-commit --no-ff ir-schema   # 5 文件 17 hunks → abort

# 合并后验证(临时 clone,结束已删)
git clone --branch refactor/split-app /home/git/projects/StoryFlow merge-test
git merge origin/ir-schema         # 冲突 1 文件,手工解析(#11 others 块适配 P14 placement)
npx tsc --noEmit                   # exit 0
npx vitest run                     # 49 文件 / 513 用例全绿
npm run build                      # exit 0

# 证据核查
git grep -n <symbol> <branch> -- '*.ts'   # sceneNameOf / schemaVersion / unpriced /
                                          # estimateTextSeconds / migrateAndHydrate 等
```

原始日志留存:`/mnt/data/git-work/sf-audit/*.log`(vitest-*.log、tsc-merge.log、build-merge.log)。

## 6. 需人工 / 待确认清单

- **#5**:真人真剧本走付费链(结构链可由矩阵测试代理,质量链观感必须人看);字素 fallback 观感判定。
- **#4③**:keyring Rust 侧编译验证(本机无 cargo;代码已接线但从未编译过)。
- **#7**:comfy/grok 视频是否补刊例(当前按"自托管≈0 成本"记档不代填——业务判断)。
- **#13**:语速常量 4.5 字/秒与 0.4s 余量是否按 issue 数值采用(现估时器是 5 字/秒口径,采用 4.5 会使部分既有钳制断言位移)。
- ir-schema 分支上 #10③(vite.config)/#12(sceneNameOf)未修——若 ir-schema 还会被单独检出使用,需知悉这两处只在 split-app 已修。
