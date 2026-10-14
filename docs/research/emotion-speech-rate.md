# 情绪驱动语速可行性分析(SF-EMOTION)

> 版本 v1 · 2026-10-15 · 分支 `audit/emotion-speech`(基于 `merge/p14-into-split` · 82e51c9)
> 性质:**只读分析,不含功能改动**。所有行号以本分支为准;标注【代码已核实】/【推测】;外部文档结论注明来源(附录 B)。

## 结论先行

1. **语义层已有情绪载体,但它是信息孤岛**:`ScriptBlock.dubEmotion`(emotion/delivery/intensity/parenthetical,`types.ts:44-45`、`types.ts:480-491`)与 DUB 分析模式(`services/geminiService.ts:1558-1635` + `hooks/useAIExecutor.ts:486-503`)已经能对每句对白产出封闭词表的情绪、≤8 词的表演指示和 1–10 强度。但全库 grep 确认:它只有两个消费者——编辑器提示条(`components/EditorBlock.tsx:246-254`)和配音表导出(`utils/exportData.ts:141-144,235`)。**TTS 链与 IR 完全没有读它**;类型注释「mapped to TTS speed/energy」(`types.ts:487`)是意向,不是实现。【代码已核实】
2. **TTS 侧唯一与语速对应的参数通道已铺通,但全链无人设值**:`TtsClip.speed`(0.5–2)从 IR schema(`src/ir/schema.ts:184`)→ 音频编译(`src/ir/audio/compile.ts:135`)→ 桥映射(`src/bridge/audio.ts:41`)→ GLM 适配器(`services/glmTtsService.ts:87`)全通;可提取层不产 speed(`src/extract/screenplayToIR.ts` 的 TtsClip 组装无此字段),live 合成也不传(`components/ProAudioPanel.tsx:86` 只传 voice)。【代码已核实】
3. **GLM-TTS 没有情绪参数**(当前唯一 TTS 供应商):官方 API 参数仅 model/input/voice/speed/volume/watermark_enabled/stream/response_format/encode_format;无 emotion/style/instruct/pitch。模型本身「通过上下文智能预判文本情绪与语调」——情绪是**自动**的,不可显式指定。因此「情绪→语速」在本供应商下只能落成 **情绪 → speed 系数** 的映射(可选叠加 volume/voice)。(附录 B 来源 1/2)
4. **估时→实测闭环的契约已闭合,但执行链未接 UI**:探活回填(`src/exec/audioExec.ts:28-48` measurements → 重编译)、逐词对齐(`alignTake`,`src/align/client.ts:30-69`)、作者校时持久化(P10 `src/ir/annotations.ts:35`)都有契约与实现;但 `executeAudioPlan`/`alignTake` 在 App 内零调用(只有 dry-run 脚本 `scripts/align-e2e-dryrun.ts` 跑通过),live 路径实测秒数走 `proAudio[].tts[].seconds`(`types.ts:175`,**该记录无 speed 字段**)→ 提取期折成 `ttsFloor`(`src/extract/screenplayToIR.ts:236-241`)。【代码已核实】
5. **推荐方案 (d) 混合**:优先级 = 作者显式覆盖 > DUB 标注(intensity→系数)> 规则兜底(标点/词表)> 基准 1.0。**复用已有 DUB 标注意味着零新增 LLM token 成本**;规则兜底让未跑 DUB 的稿也有有限改善。全部前提是 #13 最小版(sf/13-8 派单,本分支未含)把「每句有效语速」注入点留好。自动映射钳 **[0.8, 1.3]**,依据见 §4.2。
6. **关键时序约束**:TTS 按字符计价(speed 不改 TTS 价,`src/exec/pricing.ts:30-31`),但视频按输出秒计价(`utils/plan/pricing.ts:37`)——speed 改变实测时长 → ttsFloor → `wantSeconds` → outputSeconds → H3 视频价。所以**情绪→speed 必须在冻结计划(付费闸门,`utils/plan/freeze.ts:123-184`)之前定值**,否则提前估价漂移。【代码已核实+分析】

---

## 1. 数据现状:情绪信号在哪里、被清洗去了哪

### 1.1 剧本层已有的情绪载体

| 载体 | 位置 | 内容 | 下游消费 |
|---|---|---|---|
| `block.dubEmotion` | `types.ts:44-45,480-491` | emotion(15 词封闭表)/delivery(≤8 词表演指示)/intensity(1–10)/parenthetical(原文) | 仅编辑器提示条 + 配音表导出(见上);**不进 TTS/IR**【代码已核实】 |
| DUB 产出口径 | `services/geminiService.ts:1576,1587-1590` | 词表封闭(anger/joy/sadness/…15 种);intensity 与标点/大写/场景张力对齐;括注意图折进 delivery 并原文保存 | `hooks/useAIExecutor.ts:497-503` 批量写回 block |
| cue 表演括注 | `utils/beatCast.ts:14-22`(parseCharacterName) | `登山者（喘息）` → base+variant;有对应变体设定图才是换装,否则是表演括注(`src/extract/screenplayToIR.ts:202-217`,strictVariant) | 剥离:不造变体 ref、不进 motionPrompt(commit 76eb0c8,#15);语义留在 CHARACTER 块原文【代码已核实】 |
| PARENTHETICAL 块 | 拍吸收 `utils/videoPlan.ts:388-401`;AI 生成约定 `services/geminiService.ts:187,199` | 台词级 delivery 注记(如(语气俏皮,带展示感)) | 不进 motionPrompt(motionParts 只收 ACTION,`screenplayToIR.ts:159-163`)、不进 TTS 文本、不进字幕;留在剧本层【代码已核实】 |
| 画外结构化字段 | `types.ts:34-39`(characterMarker 'vo'/'os',schemaVersion 3)+ `utils/beatCast.ts:46-58` | 预备:括注猜谜改结构化字段的**先例**(issue #8) | 出口/IR 消费为可选(#8④ 未完) |
| 标点 | `utils/timing/estimate.ts:21-23,32-33,50-52` | 句末(含 !?…)统一 0.3s 暂停、逗号 0.1s | 感叹号/省略号与句号**同价**,无情绪区分【代码已核实】 |
| `dialogue.display`(P12 显读分离) | `src/ir/types.ts:242`;`src/captions/compile.ts:264-334` | 字幕展示文本可 `||` 断句 | 只影响字幕切窗,朗读文本/词锚永远是 `text`(P0 规则二)——**display 不承载情绪**【代码已核实】 |
| motionPrompt | `src/extract/screenplayToIR.ts:159-163` | 画面内运动描述 | #15 后明确**不含**表演括注(commit 76eb0c8);它描述画面,不是语速信号源【代码已核实】 |

小结:**情绪语义目前「止步于剧本层」**——提取清洗管线(#14/#15)主动把括注从所有下游字段剥掉(动机正当:不污染镜头运动/TTS 文本),但剥下来的语义没有接到任何表演层出口;唯一存活的情绪通道 `dubEmotion` 不进 IR。【代码已核实】

### 1.2 IR 层:有 speed 无 emotion

- `ShotDialogue`(`src/ir/types.ts:237-247`):text / display? / ttsFloor——无情绪字段。
- `TtsClip`(`src/ir/types.ts:303-323`):voice / **speed?**(0.5–2)/ volume? / watermark? / measuredSeconds? / gain?——**有 speed 无 emotion**。zod 同步 `src/ir/schema.ts:184-185`(speed、volume 均 0.5–2)。
- 架构承诺:`src/ir/types.ts:33-38` 设计原则 2——「changing a voice or speed never invalidates anchors」(词级锚定,毫秒是编译产物)——**改语速不破坏锚**是既定架构性质,给情绪语速留好了地基。【代码已核实】

### 1.3 顺带记录的一个估时口径坑

手写稿回退合成器里,拍长的朗读估时**只算 ACTION 开头文本**:`pushBeat` 唯一调用点传 `extra=[]`(`utils/videoPlan.ts:385`),其后吸收的 CHARACTER/PARENTHETICAL/DIALOGUE 内容不再累计时长(`:388-401` 只 push blockIds/dialogues)——对白长的拍估时偏短(有 proAudio 实测时由 ttsFloor 抬回)。情绪语速若只挂在 DIALOGUE 上,这个坑与它正交但同向(都让估时偏短)。【代码已核实】

---

## 2. TTS 能力矩阵

### 2.1 供应商盘点【代码已核实】

| 能力 | 服务 | 端点/实现 |
|---|---|---|
| **对白 TTS** | **仅 GLM-TTS** | `services/glmTtsService.ts:20`(open.bigmodel.cn/api/paas/v4/audio/speech);P13 记档「音频(TTS/BGM)无多供应商场景(GLM/fal 单源)」(docs/storyflow-ir-p13.md §1.4) |
| BGM | fal sonilo | `services/falMusicService.ts` |
| SFX | 本地 manifest 查表 | `services/sfxService.ts`(免费恒 0,`src/exec/pricing.ts:37`) |
| 生图/视频 | MiniMax image-01/H3、fal 生图、ComfyUI | `services/minimaxService.ts`、`services/falService.ts`、`services/comfyService.ts`(grep 确认 minimaxService 无 speech/tts 端点) |
| ASR | 对齐/校时辅助(识别,非合成) | `types.ts:440-442`(asrApiKey);字幕 tab 回退手动校时 |

### 2.2 GLM-TTS 参数面(代码 × 官方文档)

| 参数 | 代码现状 | 官方文档 | 是否真实生效 |
|---|---|---|---|
| model | `'glm-tts'`(`glmTtsService.ts:81`) | glm-tts | ✅ |
| input | ≤1024 字标点贪心切分+拼杆(`:21,43-66`) | — | ✅ |
| voice | 7 系统音色(`:23`)+「自定义克隆 id 透传 verbatim」(`:22-24` 注释) | 彤彤(默认)/小陈/锤锤/jam/kazi/douji/luodo(来源 1);克隆能力官方页未记载,开源侧有 GLM-TTS-Clone 传闻(来源 3,【推测】) | ✅(克隆未验证) |
| **speed** | `opts.speed` 透传(`:87`);注释「0.6–2 per official docs」(`:35`) | **[0.5, 2],默认 1.0**(来源 2 原文「语速,默认1.0,取值范围[0.5, 2]」)——代码注释与现文档不一致,IR schema 0.5–2 与现文档一致 | ✅ 服务端参数(实现方式文档未说明,【推测】为生成期控制而非后采样) |
| volume | 透传(`:88`) | **(0, 10],默认 1.0**;IR schema 收窄为 0.5–2(保守子集,安全) | ✅ |
| watermark_enabled | 默认 true(`:85`) | 有 | ✅ |
| response_format / stream / encode_format | wav / 未用流式(`:84`) | wav/pcm;支持流式(24kHz) | — |
| **emotion / style / instruct** | **无** | **无此参数**。模型页:「通过上下文智能预判文本情绪与语调」——情绪由文本上下文自动驱动;API 页参数表无任何情绪字段(来源 1/2) | ❌ 不可显式指定 |
| **pitch** | 无 | 无(来源 2) | ❌ |

### 2.3 结论表

| 供应商 | speed | emotion/风格 | 其它 |
|---|---|---|---|
| GLM-TTS(唯一 TTS) | ✅ [0.5,2] ×1.0,IR/桥/适配器全通但无人设值 | ❌ 无参数;文本上下文自动预判(改标点/拟声词可间接影响,【推测】) | volume (0,10](IR 收 0.5–2);voice 7 音色+克隆透传;无 pitch |

**含义**:「情绪→供应商情绪参数」的直通路线在当前供应商下**不存在**;可操纵自由度 = speed × volume × voice × 文本本身。speed 是唯一与「激动快、平稳慢」直接对应的杠杆。未来若接多情绪供应商(如 MiniMax TTS 系列带 emotion 参数),IR 是后端无关的(additive optional 字段即可,`src/ir/types.ts:42-44` 扩展策略),本报告的系数层可原样升格为 emotion 直通。【推测(扩展路线)】

---

## 3. 估时 vs 实测闭环

### 3.1 现有链路【代码已核实】

```
估时(无实测兜底)
  utils/timing/estimate.ts:CJK 0.2s/字(:15,≈5字/秒)→ 拍长合成(utils/videoPlan.ts:343-349)
                                        └→ 字幕 others 分窗(src/captions/compile.ts:366)
实测(有合成时)
  live:  ProAudioPanel.synthSegment(components/ProAudioPanel.tsx:74-103)
         → wavDuration 探活 → screenplay.proAudio[seg].tts[].seconds(types.ts:175,持久化)
         → 提取:ttsFloor = ceil(measured+0.3)(src/extract/screenplayToIR.ts:236-241)
                TtsClip.measuredSeconds(:386)
  exec:  executeAudioPlan(src/exec/audioExec.ts:28-48)→ measurements{clipId→秒}
         → compileAudioPlan(ir,{measured}) 重编译(scripts/align-e2e-dryrun.ts:213 演示)
词级闭环
  alignTake 端口(src/exec/audioExec.ts:84-115)→ 强制对齐服务(src/align/client.ts:30-69)
  → AlignmentTake{durationMs,tokens[]}(src/ir/audio/types.ts:138-146,text 指纹防 stale)
  → ②编译 opts.alignments + P10 作者校时 opts.timing(src/ir/audio/timing.ts:47-72)
  → 字幕/karaoke 词窗三级时基:对齐 > 校正后 > 字素比例(src/captions/compile.ts:208-251)
拍长侧
  fitShotDuration(src/ir/shared.ts:123-134):want = max(round(shotDuration), ttsFloor)
  ——实测只以 ttsFloor 抬高镜头**下限**,不回写 shotDuration(故事时长神圣,src/ir/shared.ts:87)
```

### 3.2 缺什么【代码已核实+分析】

1. **执行链未接 UI**:`defaultAudioPorts` 需显式传 `alignEndpoint` 才绑对齐客户端(`src/exec/wiring.ts:23-30`);App/hooks 无 `executeAudioPlan/alignAudioClips` 调用者(全库仅 dry-run 脚本);`IRPipelineModal` 编译不带 measured(`components/IRPipelineModal.tsx:96-97`)——UI 里字幕窗永远走估时/`wantSeconds` 兜底。
2. **P10 校时「合同已签,无人履行」**:annotations(timing 校时窗 + priceBooks)契约与序列化齐备(`src/ir/annotations.ts:32-39,85-94`),但 app 侧无任何写入者(grep `StoryFlowAnnotations` 零命中于 App/hooks/components)。
3. **实测回写 IR 的路径只有「重新提取」**:exec 路径的 measurements 只活在编译入参,不落盘;live 路径落 `proAudio` 但那是 app 层结构,IR 要再跑一次 extract 才吸收。
4. **没有「speed stale」语义**:对齐件有 text 指纹(改词 → stale → 回退字素比例,`src/ir/audio/compile.ts:224-237`);**改 speed 无任何失效标记**——旧速度的 measuredSeconds/ttsFloor/对齐件照常使用。这是情绪语速落地必须补的缺口(§5 步骤 4)。
5. 拍长不足警告不存在(#13 四验收之一,审计已确认:audit-issues/docs/audit/issue-status-2026-10.md §#13「两分支均无」;本分支同样未含)。

### 3.3 语速变化对「提前估价(冻结计划/付费闸门)」的影响【代码已核实+分析】

- **TTS 价不变**:`ttsClipCostFen = perCharFen × text.length`(`src/exec/pricing.ts:30-31`)——speed 不改 TTS 账单 ✅。
- **视频价变**:H3 按输出秒计价(`输出 Ns × ¥/s`,`utils/plan/pricing.ts:37`)。链条:speed ↓(慢)→ measured ↑ → ttsFloor ↑ → `fitShotDuration().wantSeconds` ↑ → outputSeconds ↑ → 视频费 ↑;speed ↑ 则反之,且能**解除** `AUDIO_TOO_LONG`(音频编译器警告文案已把「提速」列为处方:`src/ir/audio/compile.ts:117`;UI 文案同向:`constants.ts:1547`「请拆段或提高语速」)。
- **时序约束**:冻结计划(`utils/plan/freeze.ts:123-184`)与预算闸门(`src/exec/budget.ts:47-55`;批级 `src/exec/batchExec.ts:26-35`)都在提交前按计划判限。若情绪→speed 在冻结后才定(例如合成完才按听感调),`outputSeconds` 用的是估时/旧实测,**估价漂移**。设计要求:系数必须在提取/编译期定值(进 IR),重估时走「重编译 → 重冻结」的既有流程。

---

## 4. 情绪来源方案对比

### 4.1 四方案

| 方案 | 做法 | 优点 | 缺点/成本 | 侵入度 |
|---|---|---|---|---|
| (a) 作者手写标注 | 括注(已有 PARENTHETICAL/cue 括注)或新字段(如 `block.speechRate`,仿 characterMarker 先例 `types.ts:34-39`) | 零 token 成本;作者意图权威;确定性 | 写作负担大、覆盖率天然低;括注已被清洗管线剥到「不进下游」,需新开消费口;新字段要动 EditorBlock/导出/迁移/schemaVersion | M |
| (b) 规则映射 | 情绪词表(激动/怒吼/低声/颤声/喘息…)+ 标点特征(!!/??/……)→ speed 系数 | 零成本;确定性、可解释、可单测;对未标注稿兜底 | 中文词表维护成本;误伤(情绪词出现在对白内容里);抓不到无标记句,**recall 低**——只能当兜底不能当主力 | S |
| (c) LLM 产出 | c1:**复用现有 DUB**(已产 emotion/delivery/intensity,接线即可,**零新增 token**);c2:生成期(CONTINUE/FROM_PROMPT)同步产 speedHint | c1 覆盖全量、语义质量高(prompt 已把 intensity 与标点/场景张力对齐,geminiService.ts:1588);c2 随写随得 | c2 改 PROMPTS/解析,数字字段 hallucination 风险、侵入生成链;DUB 需显式批跑(本来就是既有操作) | c1:S;c2:L |
| **(d) 混合(推荐)** | 优先级:作者显式 > DUB 标注(intensity→系数)> 规则兜底 > 基准 1.0;每层可解释、可整体关闭(设置项) | 覆盖率×成本最优;DUB 已上线使「LLM 修正」层几乎免费;规则层保证无标注稿不至于死平 | 层间优先级与 stale 语义要做对(§5 步骤 4);映射曲线带主观性(常量表化可调) | S–M(分步) |

### 4.2 语速系数的合理区间及依据

- **硬边界**:GLM-TTS 官方 [0.5, 2](§2.2);IR zod 已收 0.5–2(`src/ir/schema.ts:184`)——通道无需扩。
- **自动映射建议钳 [0.8, 1.3]**:激动/急促 1.15–1.3、平静 1.0、低沉/悲伤/迟疑 0.8–0.9;作者覆盖放宽到 [0.7, 1.5](>1.5 听感机械化风险,【推测,未实测听感】)。
- 依据:
  1. 基准(#13 将定 4.5 字/秒)× 1.3 ≈ 5.9 字/秒,仍在自然汉语会话语速带内(通识,【推测】),且远低于字幕可读上限——Netflix 中文 timed-text 指南成人 ≤9 字/秒(附录 B 来源 4);
  2. 下限 0.8:过慢会让 ttsFloor 频繁主导 `wantSeconds`,放大 H3 链窗膨胀与视频费(§3.3),且字幕最短可读 600ms(`src/captions/compile.ts:21`)的相对裕度反而恶化观感【推测】;
  3. 顺向性:快语速是既有 `AUDIO_TOO_LONG` 警告的合法处方(`src/ir/audio/compile.ts:117`)——情绪加速与现有警告体系天然衔接,无体系冲突。

### 4.3 「字幕/拍长/TTS 三者不一致」的设计要点

1. **speed 定值一处,写进 IR 作唯一事实**:提取/编译期算出每句有效语速(基准 ÷ 系数),写 `TtsClip.speed`;字幕窗(#13 注入点)、拍长合成估时、TTS 任务队列全部从 IR 读**同一个** speed——不许三处各自从情绪信号重算。
2. **时序铁律:估时让位实测**:先定 speed → 合成 → 探活 → measured 回填;字幕/时间轴永远实测优先(对齐件 > 校正 > 实测字素比例,`src/captions/compile.ts:227-230` 三级时基已具形),估时只兜底。语速只改变「估时与警告」,不自动改 `shotDuration`(故事时长神圣,`src/ir/shared.ts:87`);拍长不足走 #13 的警告,由作者/导演决策。
3. **speed 变更 = 重合成触发条件(stale)**:`proAudio.tts[].speed`(需补字段,`types.ts:175`)≠ 当前系数 → 体检警告「语速已变,建议重合成」,不自动重合成(花钱确认走既有仪式)。对齐件已有 text 指纹机制(`src/ir/audio/types.ts:139-140`)可仿——speed 进指纹或随 clipId 重建。
4. **估价一致性**:系数在冻结计划前定值(§3.3);结算差(估价 vs 精确结算,`src/exec/pricing.ts:49-92`)在文档里明示「语速假设」一项。

---

## 5. 推荐方案与分步实施

### 5.1 推荐

**(d) 混合,四步走,前置依赖 #13 最小版。**

理由:DUB 标注层已经存在且质量口径考究(封闭词表/与标点对齐),接线即得全量情绪信号,零新增 LLM 成本;规则兜底覆盖未跑 DUB 的稿;作者覆盖留最高优先级但 MVP 可只做「每角色基线」而不做逐句 UI。GLM-TTS 无情绪参数 → 第一期只做 speed 映射,volume/voice 不动。

### 5.2 分步(改动点/工作量/依赖)

| 步 | 内容 | 文件 | 量 | 依赖 |
|---|---|---|---|---|
| 0 | **#13 最小版**:4.5 字/秒可配置基准 + `estimateTextSeconds(text,{charsPerSecond?})` + 字幕窗=max(拍窗,TTS 估算)+ 拍长不足警告 | `utils/timing/estimate.ts`、`src/captions/compile.ts`、`src/extract/screenplayToIR.ts`(已有派单 sf/13-8) | M | 无(先行) |
| 1 | 系数层纯函数:`speedFactorOf({emotion?,intensity?,parenthetical?,text?})→number`(钳 [0.8,1.3])+ 词表/标点规则 + 常量映射表(可调可测) | 新建 `utils/timing/emotionRate.ts` + 单测 | S | 无(可先行开发,发射点等 0) |
| 2 | 数据通路:`PlannedBeat.dialogues` 加 `blockId`(`utils/videoPlan.ts:40,186,335,399` 四处生产;现只有 cue/line,无法可靠回链 DIALOGUE 块的 dubEmotion);提取组装 TtsClip 时(`src/extract/screenplayToIR.ts:448-469`)读 `block.dubEmotion` → `clip.speed = round(基准相关系数×100)/100` | `utils/videoPlan.ts`、`src/extract/screenplayToIR.ts`、golden/测试 | S–M | 步 0(基准常量)、步 1 |
| 3 | live 合成接线:`ProAudioPanel.synthSegment` 传 `opts.speed`(同一系数函数,`components/ProAudioPanel.tsx:86`);`proAudio.tts[]` 记录持久化 speed(`types.ts:175` 加可选字段+迁移无损) | `components/ProAudioPanel.tsx`、`types.ts` | M | 步 1(步 2 非硬依赖,可并行) |
| 4 | stale 与体检:`proAudio.tts[].speed` ≠ 当前系数 → `IRPipelineModal` 格式体检警告「语速已变,建议重合成」(同型警告先例:e9dcccd ④);不自动重合成 | `components/IRPipelineModal.tsx`、文案 `constants.ts` | S | 步 3 |
| 5 | (可选)规则兜底词表进提取层(无 dubEmotion 的稿给弱系数);或 DUB prompt 加 speedHint 直出(c2);或执行链 UI 接线(measured/对齐回写,利全体非独情绪) | 另派单 | L | 各自独立 |

每步独立可验收、可单独回退;不 push、不动 main。

### 5.3 验收标准(草案)

1. 带 DUB 标注的稿:提取后对应 `TtsClip.speed ∈ [0.8,1.3]`,与 intensity 单调一致(映射表单测锁定)。
2. 无标注稿全 1.0:golden 零漂移;标点规则只对显式强标点(!!/??/……)生效,普通句零影响。
3. 改 speed 后:重合成 → 字幕窗用新实测;`shotDuration` 不变;快语速可使 `AUDIO_TOO_LONG` 警告消失(计数断言)。
4. XML round-trip 保 speed(`src/ir/format/render.ts:265`/`parse.ts:347` 已有,补 golden 1 例)。
5. 冻结计划在 speed 定值后生成:估价与精确结算差可解释(视频秒价差,无隐藏项)。

### 5.4 风险

- DUB 未跑的稿无情绪信号 → 全 1.0 静默退化(可接受;步骤 5 词表可部分缓解)。
- 系数映射主观 → 常量表 + 单测锁定,调曲线不改逻辑。
- 同拍多句不同情绪 → 非锚 clip 逐句独立(`src/ir/audio/compile.ts:193-206` 拼杆),无阻塞。
- #13 未落地前:步 3(TTS 直通)可先行,但「字幕窗读有效语速」半边做不了——**建议排序 #13 先**,避免两分支撞 `src/captions/compile.ts`(审计已记该文件是合并冲突热点)。
- 估时随情绪浮动:同输入→同输出仍成立(系数是确定性函数),但跨稿对比/人工核对时要多一维解释,记档即可。

### 5.5 需要用户拍板的点

1. 情绪信号源:是否接受「复用 DUB 标注 + 规则兜底」(推荐,零新增 LLM 成本),还是要在生成期(CONTINUE/FROM_PROMPT)同步产语速(侵入生成链,量大)?
2. intensity→speed 曲线与 emotion 词表分档:线性还是分档?默认表(§4.2)可否?
3. 作者覆盖粒度 MVP:仅「每角色基线语速」(设置项)是否够,还是必须逐句覆盖(要新 UI)?
4. speed 变更是否作为「重合成 stale」触发(涉及花钱确认流程的口径)?
5. 系数是否同时作用于估时(字幕/拍长警告)与 TTS 合成(推荐「同时」,见 §4.3-1)?

---

## 附录 A:查过的文件(本分支,均有行号引用)

- 契约/类型:`types.ts`、`src/ir/types.ts`、`src/ir/schema.ts`、`src/ir/audio/{types,compile,timing}.ts`、`src/ir/annotations.ts`、`src/ir/shared.ts`
- 提取/合成:`src/extract/screenplayToIR.ts`、`utils/videoPlan.ts`、`utils/beatCast.ts`、`utils/timing/estimate.ts`
- 编译/执行:`src/captions/{compile,karaoke}.ts`、`src/ir/audio/compile.ts`、`src/exec/{audioExec,wiring,batchExec,budget,pricing}.ts`、`src/bridge/audio.ts`、`src/align/client.ts`、`utils/plan/freeze.ts`、`utils/plan/pricing.ts`、`utils/proAudio.ts`
- 服务/UI:`services/glmTtsService.ts`、`services/minimaxService.ts`(grep 确认无 TTS)、`services/falMusicService.ts`、`services/sfxService.ts`、`components/ProAudioPanel.tsx`、`components/IRPipelineModal.tsx`、`components/EditorBlock.tsx`、`components/AIModal.tsx`、`hooks/useAIExecutor.ts`、`utils/exportData.ts`、`constants.ts`
- 文档:docs/storyflow-ir-p4.md、docs/storyflow-ir-p13.md、docs/api-research-seedance-h3.md(grep 无 TTS 内容)、audit-issues/docs/audit/issue-status-2026-10.md(姊妹 worktree,§#13/#8/#9)
- 提交:76eb0c8(#15 motionPrompt 剥括注/authored 口径)、e9dcccd(#14 括注剥离/剥引号)、b8aa84b(P14 karaoke placement)
- 状态核对:sf-13-8 worktree 同基(82e51c9)无新提交 → **#13 在本分支未落地**,本报告按「计划中依赖」处理

## 附录 B:文档来源(公开文档,未调用任何付费 API)

1. GLM-TTS 模型页(七音色/上下文情绪预判/无情绪参数):https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-tts
2. GLM-TTS API 参考(speed [0.5,2] 默认 1.0;volume (0,10];完整参数表无 emotion/pitch):https://docs.bigmodel.cn/api-reference/模型-api/文本转语音
3. GLM-TTS-Clone(3 秒克隆,开源侧信息,官方 API 页未记载,【推测】):搜索结果摘要(zai-org/GLM-TTS,HuggingFace)
4. Netflix 中文 Timed Text Style Guide(成人字幕阅读速度 ≤9 字/秒):https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide
