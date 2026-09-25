# StoryFlowIR P1 —— 三路接口边界与排期

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0,commit 90d7fff)
> 任务书(协调侧口述):P1 拆三路——①视觉编译器(IR→I2V/T2V 后端调用计划)②音频编译器(TTS 词级锚定→时间轴+三轨混音计划)③声明式格式(StoryFlowXML/蓝图层,对标 Hypit SVML 的 prose-first 设计)。本实例先出三路的接口边界与排期拆分,再从①视觉编译器动工。
> 深度(站长确认):**纯编译层** —— types + zod + 纯函数 + 测试 + 文档;不碰 UI、不调网络、不接现有 hooks/services。③ 的内容角色 = 成片剪辑声明(成片蓝图),载体 = StoryFlowXML prose-first。

## 1. 边界总则

1. **契约唯一共享面**:三路输入都是 StoryFlowIR(`src/ir/types.ts` + `schema.ts`)。三路**互不 import**——这是三路可并发开发的安全边界;共享原语只下沉到 `src/ir/shared.ts`(缝合不变量的唯一实现处)。
2. **`src/ir/` 树不 import `services/`/`utils/`/`hooks/`**:避免 non-strict 模块被卷进 strict 门禁面(`tsconfig.ir.json`)。历史实现里的纯规则以**本地纯拷贝**复刻,每处 file:line 注明提取源;与源实现的**有意偏离**在 §3 记档。
3. **纯函数,零 IO**(P0 同款):不碰 fetch/localStorage/window/Blob。需要外部测量值(如 TTS 探活秒数)由调用方作为参数传入。
4. **产出自带 version**,扩展走 additive 路径(新增 optional 字段 = minor;改名/删除/语义变更 = major)。
5. **P0 三原则延续**:后端无关(厂商参数只进 `vendor` 扁平原语袋)、词级锚定非秒级(秒数是编译产物)、金额分整数(成本字段一律整数分)。

## 2. 三路 I/O 契约

| 路 | 模块 | 入口 | 输出 | 状态 |
|---|---|---|---|---|
| ①视觉编译器 | `src/ir/visual/` | `compileVisualPlan(ir, opts?)` | `VisualCallPlan` | ✅ 已实现 |
| ②音频编译器 | `src/ir/audio/` | `compileAudioPlan(ir, opts?)` | `AudioMixPlan` | ✅ 已实现 |
| ③声明式格式 | `src/ir/format/` | `renderStoryFlowXML(ir, opts?)` | `StoryFlowXmlSource`(prose-first XML 文本) | ✅ 已实现 |

### 2.1 ①视觉编译器 `compileVisualPlan(ir, opts?) → VisualCallPlan`

逐镜头的**后端调用计划**(纯数据,执行器照单提交)。opts:`whiteModelRef?: {durationSeconds}`(R2V 白模运行时输入)、`priceResolution?`/`priceModel?`(刊例)、`defaultBackend?`(缺省 'minimax')。

**路径分派**(mode 驱动):
- `express` → 每镜 **image(首帧 T2I,prompt = imagePrompt 原样)+ video(path:'i2v')** 对;i2v 必带 `firstFrame: {fromJobId, assetId?}`(同计划首帧 job,或已回填资产)。超窗镜头拆链在 I2V 侧。
- `pro` → video(`path:'t2v'` + 参考包);`path:'r2v'` **仅当** `opts.whiteModelRef` 传入(白模视频是运行时输入,永不进 IR)。

**VisualJob 要点**:
- `materials.slots: RefSlot[]` —— **refSlots 统一打包规则**(§3):`[场景/环境图(有则), 角色设定表(绑定序), 其余绑定 ref]`,严格 1..N 连续,上限 9;`tag = <Picture N>` 只由 slots 生成;`primaryRefSlot` = 首个 character 槽(否则首槽)——解决生图参考不对称(minimax image-01 单 subject_reference vs fal 多图),槽位→厂商端口映射属执行器侧。
- `prompt` —— image:`text = imagePrompt` 原样;video:`text = motion + 台词行(cue：\"…\" 引号逐字)+ 连续性锁句`,并带结构化 `motion/dialogue?/cue?/continuity/anchorText/anchorSource`(**锚基文本逐字节等于 IR 字段**,§3)。
- `outputSeconds` —— 每链元 [4,15] 整数;`chainIndex/chainCount/offsetSeconds` = 超窗拆链(等分余数前置,§3)。**对白只挂链元 1**。
- `seed` —— IR 带 seed → `fixed`;缺省 → `reroll`(抽卡语义:重 roll = 换新种子)。
- `vendor` —— 扁平原语袋无损透传(P0 规则一)。
- `estimatedCostFen` —— 整数分(P0 规则三),**仅 minimax 视频任务**;价目是 `services/minimaxService.ts:80-105` 的整数分镜像(`visual/cost.ts`,全整数运算)。
- 预检警告码:`REF_ASSET_MISSING | REF_PACK_TRUNCATED | IMAGE_PROMPT_LONG | DIALOGUE_FLOOR_RAISES_DURATION | AUDIO_TOO_LONG | DIALOGUE_FLOOR_EXCEEDS_CHAIN_LINK`。字节级校验(MP4/≤50MB/参考视频 2–15s)属运行时 `validateH3Submission`,不进核心。

执行器侧方言助手:`renderComfyMaterials(slots, {hasVideo?})` → `Reference materials:` tag 块(`<Video 1>` 仅 hasVideo)。

### 2.2 ②音频编译器 `compileAudioPlan(ir, opts?) → AudioMixPlan` 🔒边界

任务书:**TTS 词级锚定→时间轴 + 三轨混音计划**。

- `jobs: TtsJob|BgmJob|SfxJob` —— 三轨合成任务(TTS 带 ≤1024 字 `parts` 分段/voice/speed/volume/watermark;BGM 带 `buildBgmPrompt` 语义文案 + loop/gain;SFX 带 `SfxAnchor` + `missing`);`kind` 判别(与 IR 音轨同形制)。
- `timeline: {clipId, startMs, durationMs?}` —— **词级锚定→时间轴**:`SfxAnchor.wordIndex` → 毫秒偏移,v1 按字素比例(token 权重=码点数)把 basis 摊到 `splitAnchorWords` token 窗口;basis = 探活秒数(对白锚=锚 clip 的 measured,`opts.measured` 覆盖 IR 回填)否则计划时长 `fit.wantSeconds`。`shot-start → 0`;`shot-end → 镜头内容终点 fit.wantSeconds×1000`(镜头尾音效归镜头尾,不随对白杆长度漂移)。TTS 缺探活值不进 timeline;锚是作者身份,毫秒是编译产物(P0 规则二)。WhisperX 级逐词对齐是 P2 升级位。
- `mix: SegmentMix[]` —— 三轨混音计划 = `ProSegmentCut`(services/videoExport.ts:175-182)的声明化:`tts[{clipId, gain:1.0}]` / `bgm{clipId, gain:0.25, loop:true}` / `sfx[{clipId, atMs, gain:0.8}]`。**增益常量钉死**在 `audio/types.ts`(MIX_GAIN_TTS/BGM/SFX),与 `muxSegment` 的 filter_complex(services/videoExport.ts:230-238)互注,schema 校验混音条目的增益必须等于契约值。
- `fits: {shotId, durationFit}[]` —— 时长拟合复用 `shared.fitShotDuration`(§3 钉死规则,与①同源)。
- 警告码:`TTS_ANCHOR_UNMATCHED | AUDIO_TOO_LONG | SFX_MISSING | SFX_ANCHOR_OUT_OF_RANGE`。
- opts:`measured?: Record<clipId, seconds>`(探活值由 IO 边缘传入;缺项的 clip 不进 timeline 并警告)。

### 2.3 ③声明式格式 `renderStoryFlowXML(ir, opts?) → StoryFlowXmlSource` 🔒边界

任务书:**StoryFlowXML/蓝图层,对标 Hypit SVML 的 prose-first 设计**;内容角色 = **成片剪辑声明**(与命令式 ffmpeg 相对——声明一次,渲染器照单执行)。

SVML 形制(hypit-study.md §2 + examples/*/reference.svml):
- 处理指令 `<?storyflow using="storyflow-ir@0.1"?>` + `<storyflow>` 根。
- **`<script>` 只装「说了什么」**:角色 cue(`<陈默>`)、`||` 断句、Dual Text `<显示|朗读>`、Selection `@{id}`…`@{/id}`、Moment `@{id!}`;词级锚定,标点无 token。铁律:**Everything else reads the Script; the Script reads nothing.**
- `<generation>` / `<audio>` / `<transition>` / `<film>` 声明节全部**引用** `story.selection.*` / `story.moment.*` 锚,不回写 script。
- v0.1 **单向渲染**(IR→XML),无 parser;opts 仅 `{pretty?, scriptId?}`。round-trip 归 ③ 实例扩展位。

### 2.4 缝合不变量(①⇄②,代码实现在 `src/ir/shared.ts`)

1. **词锚基文本** = `shot.dialogue.text`(无对白则 `motionPrompt`);`anchorTextOf` 返回值**逐字节等于 IR 字段**(不 trim/改写/加前缀)。① 的每个 video job 携带 `anchorText/anchorSource`;② 的 wordIndex **只对 anchorText 分词**,永不对组装后的 prompt 分词(组装文本仅供模型)。
2. **分词器** `splitAnchorWords`(P1 钉死):中文逐字、英文/数字按空白成 run、**标点与空白不产 token**(对齐 Hypit「标点不是语音 token」)。0 起下标。
3. **多 TtsClip 语义**:锚基文本取 `shot.dialogue.text`;`text === dialogue.text` 的 TtsClip 是锚 clip,其余为非锚行;无匹配 → `TTS_ANCHOR_UNMATCHED` 警告。
4. **ttsFloor 双端生效**:`outputSeconds = clamp(round(max(shotDuration, ttsFloor)), 4, 15)`;`ttsFloor > 15` → `AUDIO_TOO_LONG`;`ttsFloor > shotDuration` → `DIALOGUE_FLOOR_RAISES_DURATION`;拆链时对白挂链元 1,`ttsFloor > 链元1` → `DIALOGUE_FLOOR_EXCEEDS_CHAIN_LINK`。

## 3. 有意偏离记档(P1 统一规则 vs 历史实现)

| # | 历史实现 | P1 规则 | 理由 |
|---|---|---|---|
| 1 | `<Picture N>` 双拷贝:白模路径顺序 1..N 正确(`hooks/useH3VideoPlan.ts:151-155`);段路径 `(sceneEnvTag?1:0)+i+2` **跳号**(env 在场首个角色得 `<Picture 3>`,缺席得 `<Picture 2>`,`useH3VideoPlan.ts:300-303`) | 严格 1..N 连续,env 在前,≤9 | 契约层编号必须唯一确定;跳号是实存 bug,统一即修复 |
| 2 | 段路径 env tag 写死故事文案「keep the desktop, sofa…」(`useH3VideoPlan.ts:254-255`) | 通用文案 + `SceneRef.name` | 故事文案混进通用打标器是泄漏 |
| 3 | `fitSegmentSeconds`(utils/proAudio.ts:37-46):有对白时**忽略** requested,`out = clamp(max(4, min(window, L)), 4, 15)`;实测零调用方 | `clamp(round(max(shotDuration, ttsFloor)), 4, 15)` | 故事时长与站长下限取大后钳制;双端(①②)同一函数 |
| 4 | `estimateH3Cost` 以元浮点计价(`Math.round(x*100)/100`,`services/minimaxService.ts:100-105`) | `estimateVideoCostFen` 整数分镜像(`visual/cost.ts`) | P0 规则三「金额分整数」;且 `src/ir` 不引 services(总则 2) |
| 5 | `planSegments` 对 <4s 出「生成 4s 后期裁切」单链元(utils/grayboxPlan.ts:82-88) | `fitOutputSeconds` 统一钳 [4,15](2s → 4s) | 同行为,收口为一个原语 |
| 6 | 示例 `aud-sfx-002.wordIndex: 12`(P0 未审计) | **29**(「画面渐暗**收**黑」的「收」) | 按钉死分词器复核:31 token,12=「的」(句中虚位);shutter 落收黑收尾是语义落点 |

## 4. 排期拆分(哪路先动)

**①先动(✅)→ ② ∥ ③(✅ 均已实现)。**

- ① 是复用面最密的一路(refSlots 打包/时长钳制/拆链/成本),解耦 express+pro 生成路径;其 `RefSlot`/`jobs`/`outputSeconds` 词汇被 ③ 的 `<generation>` 声明引用。
- ②③ 在边界锁定后只依赖 `shared.ts` + 本文契约,**互不依赖,可并发**;若必须串行:**② 先于 ③**(② 与①共享锚/时长原语并闭合 ttsFloor 接缝;③ 是 golden 快照可验的纯渲染,耦合最低)。
- 实例划分:本实例 = 边界 + ①;P1-② = 一个实例;P1-③ = 一个实例。

## 5. 验收门禁

**基线(三路共有)**:`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 全绿零回退(基线 147);**不 push**。

| 路 | 机器可检门禁 |
|---|---|
| ① ✅ | `tests/ir-visual.test.ts` 全绿(18 条:路径分派×3 / refSlots×4 / 时长拟合×3 / seed+vendor×2 / 成本×2 / prompt+接缝×2 / shared×2);改坏任一产出字段 → `typecheck:ir` 因 `visual/schema.ts` 防漂移断言失败;`src/ir/visual/` 无 services/hooks/components import |
| ② ✅ | `tests/ir-audio.test.ts` 全绿(16 条:三轨任务×3 / 词锚→时间轴×5 / 混音计划×4 / 警告×4);`AudioMixPlan` types+zod+防漂移守卫;混音增益常量与 services/videoExport.ts:230-238 互注;词锚→ms 用合成 `measured` fixture 测试(无 IO) |
| ③ ✅ | `tests/ir-format.test.ts` 全绿(8 条);`renderStoryFlowXML(银盐晨光)` 匹配入库 golden `docs/storyflow-xml-example.xml`;script 节无 `Picture`/`gain`/`seconds` token(仅角色 cue+逐字文本+选区/时刻标记);script 外锚引用全部可解析;输出过 well-formed 校验 |

## 6. 扩展策略

- **additive optional 字段 = minor 升版**(VisualCallPlan/AudioMixPlan 各自的 `version`);改名/删除/语义变更 = major,校验层大声失败(P0 同款)。
- `imageRefPolicy`(每生图任务的参考槽位策略)属 **vendor pack**,不进核心——`primaryRefSlot` 已给确定性单槽选取,多槽映射是执行器方言。
- ② 的逐词对齐(WhisperX 级)、③ 的 parser/round-trip、R2V 白模资产入 IR,都是命名扩展位,走同一条 additive 路径。
- v1 已记档的执行简化:IR per-clip `gain`/`loop` 作者覆盖暂不生效(混音参数 UI 是既知遗留项,docs/pipeline-two-mode.md 遗留 1)——AudioMixPlan 如实描述 muxSegment 内置默认的执行值。
