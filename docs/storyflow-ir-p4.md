# StoryFlowIR P4 —— 剧本→IR 提取层:接口清单与推导规则

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0 契约 / P1 三路编译 / P2 桥映射 / P3 真执行器)
> 范围(协调侧确认):**剧本→StoryFlowIR 提取层**——Screenplay/ScriptBlock/VIDEO_PLAN/graybox/refs/sequences → StoryFlowIR 确定性提取编译。**补齐 IR 生产侧**(P0–P3 全链只消费不生产),让整条管线从真实剧本可达。
> 门禁:tsc strict + vitest 零回退;不碰生产(services/utils 为只读依赖);不 push。

## 1. 边界总则(P4)

1. **纯函数提取**:`extractStoryFlowIR(screenplay, refImages, opts?) → StoryFlowIR`——零 IO,确定性(同输入同输出)。产出**必须过 `validateStoryFlowIR`**(验收门禁第一条)。
2. **复用原版纯件**:`utils/{videoPlan, beatCast, refBindings}` 是提取语义的唯一出处(节拍切分/角色变体/设定表解析),**import 不重写**——这三件 + `types.ts` 已预检全过 `tsc --strict`(2026-09-24 exit 0),提取层(`src/extract/`)同 `src/bridge/` 一样是有意跨越 `src/ir/` 禁入线的一层。
3. **推导可追溯**:每个 IR 字段的来源在 §3 表里逐项记档;Screenplay 没有来源的字段(如 `generation` vendor 袋)**缺省省略**(IR optional),不编造。
4. **失配修复显式化**:遗留数据不合契约处(如 imagePrompt 缺风格前缀)在提取时**治愈**(补前缀)并记档——产出永远合法,但不静默改写无关内容。

## 2. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `extractStoryFlowIR(screenplay, refImages, opts?)` | `src/extract/screenplayToIR.ts` | Screenplay + 资产库视图(RefImage[])→ StoryFlowIR |
| `ExtractOptions` | 同上 | `{ targetSeconds?: number(VIDEO_PLAN 窗,缺省 10); defaultMode?: 'express'\|'pro'(productionMode 缺席时,缺省 'pro'); descriptionOf?(img) => string(形象设定文案钩子) }` |
| `wordIndexAtMs(tokens, atMs, basisMs)` | `src/ir/shared.ts` | 词锚**反演**(秒偏移→wordIndex,② wordStartMs 的逆) |

## 3. 字段推导规则(逐项)

| IR 字段 | ← 来源 | 规则 |
|---|---|---|
| `version/mode` | `productionMode` | `'simple'→'express'`,`'cinematic'→'pro'`,缺席→`opts.defaultMode ?? 'pro'` |
| `title` | `metadata.title` | 逐字 |
| `style` | `metadata.styleHead` | 逐字;缺席 → 回退 `{name:'未设定', artStyle:'未设定', scenePreset:'未设定', promptPrefix:''}` |
| `refs.characters` | `referenceBindings` + `resolveBeatRefs/resolveBeatVariant` + RefImage 身份 v2 | 每个出场 (base, variant) 对一条:`char:{base}` / `char:{base}:{variant}`;`description` = `opts.descriptionOf(img) ?? img.sourcePrompt ?? img.subject ?? img.name`;`asset` = 溯源(source/sourcePrompt/versionGroup/version/assetId=RefImage.id) |
| `refs.scenes` | SCENE_HEADING 块 | `name` = 剥 `INT./EXT./内/外` 前缀与 ` - 时段` 后缀(空则用整行;`:`→`_`);`sceneHeading` 逐字;`spatialId = 'spatial:{name}'` |
| `refs.props/actions` | RefImage(kind='prop'/'action')+ 名称在节拍文本中的包含匹配 | 注册表收录 scriptIds 钉住本稿(或全局)的资产;per-shot 绑定 = 资产名在节拍文本中出现(词法匹配,记档);`styles` 无库侧 kind 标记 → 收空(记档 6) |
| `shots[]` | `planVideoSegments(blocks, targetSeconds)` 的 **PlannedBeat 一一对应** | 见 §4 |
| `audio.tts` | `proAudio[segKey].tts[]` | line 对上镜头对白/附加台词 → `aud-tts-{NNN}`;`measuredSeconds = seconds`;voice 逐字;character 取 base 名 |
| `audio.bgm` | `proAudio[*].bgm` **按 prompt 去重** | 「One music bed per scene, cached by prompt」——同 prompt 的多段条目并成一条 `BgmClip`,from/to = 覆盖段的首/尾镜头 |
| `audio.sfx` | `proAudio[segKey].sfx[]` | 段相对 `at`(缺省 0)→ 绝对时刻 → 所属镜头 + 镜内偏移 → **词锚反演**(§5);边界落 `shot-start`/`shot-end`;`missing` 逐字 |
| `transitions` | TRANSITION 块 + 场景边界 | TRANSITION 块:from=块前镜、target=块后镜(片尾 FADE OUT → target=末镜、from 省略=前一镜);类型解析 MATCH CUT→cut→DISSOLVE→FADE IN/OUT→WIPE(先特殊后一般);场景边界 → cut |
| `spatial` | SCENE_HEADING 块的 scene graybox | GrayboxObject/GrayboxCharacter **1:1 逐字段**(坐标宪章原样);`id = 'spatial:{场景名}'` |

## 4. Shot 推导(PlannedBeat → Shot)

| Shot 字段 | ← 来源 |
|---|---|
| `id/sequence` | `SHOT_{NNN}` 序号重排(beat 序) |
| `shotDuration` | `beat.end - beat.start`(故事时长,VIDEO_PLAN 时间戳) |
| `motionPrompt` | `beat.text`(时间戳前缀已剥)+ 同拍附着的无时间戳 ACTION 内容(按块序) |
| `imagePrompt` | 拍内首块 `imagePrompt` ?? `(promptPrefix + motionPrompt)`;**缺风格前缀则补**(治愈,记档) |
| `firstFrame` | 块 `imageResult` → `{description: subject ?? motionPrompt, assetId}`;无 → `{description: motionPrompt}` |
| `lastFrame` | 无来源,缺省 |
| `camera` | 拍首块 shot graybox.camera ?? 覆盖本拍的 segmentGraybox.camera(`shotDescription→description`,其余 1:1) |
| `refBindings` | cast(`computeBeatCast`,变体 = `resolveBeatVariant` ?? 本拍对白 cue 的变体)+ `scene:{name}` + 词法 prop/style/action |
| `character/dialogue` | `beat.dialogues[0]`:character=base 名;`ttsFloor = ceil(measured+0.3)`(= audioLowerBoundSeconds 单句;proAudio 按 line 匹配,**恰合 P0 示例 4/3**);无 proAudio → 0(未测) |
| 多句台词 | `beat.dialogues[1:]` → 同镜头**非锚 TtsClip**(② 多台词语义:锚 clip = text 逐字等于 dialogue.text) |
| `generation` | 无来源,缺省(编译器 default;vendor 袋属计划期手填) |
| `status` | `expressShots[beat 首块]`:locked→`locked`;image-ready/video-ready→`generated`;余→`draft` |

## 5. 词锚反演(秒偏移 → wordIndex)

proAudio 的 sfx 只有段相对秒偏移(`at`),IR 要求词锚。反演 = ② `wordStartMs`(字素比例分窗)的**逆**:取包含 `atMs` 的 token 窗下标;`atMs ≥ basisMs` 兜底末 token。basis = 对白杆探活长(有对白且有 measured)否则 `wantSeconds`。边界(偏移≈0/≈basis)落 `shot-start`/`shot-end`。—— v1 锚定恢复;WhisperX 级对齐落地后由对齐件直接给 token 窗(p1 扩展位)。

## 6. 记档(失配/差别的显式化)

1. **imagePrompt 前缀治愈**:遗留块缺 `style.promptPrefix` → 提取时补前缀(契约要求前缀烘焙;不改写已有前缀)。
2. **cast 规则 = computeBeatCast 语义**(文本提及 + 近两枚 CHARACTER cue,场景界内)——提取不臆断「谁在画面里」;手填 IR 可以更紧(如特写空镜不绑角色),差别属作者判断。
3. **per-shot prop/style/action 词法包含匹配**(资产名/subject 出现在节拍文本才绑)——无语义绑定来源;精确绑定属扩展位。
4. **转场只收显式 TRANSITION 块 + 场景边界**;镜头间的隐式硬切是缺省语义,不占转场列表。
5. `generation`/`lastFrame`/`status='exported'` 无 Screenplay 来源——缺省省略,不编造。
6. **styles 收空**:RefImage.kind 无 'style' 值(风格类图无库侧标记)——提取层不出 ExtraStyleRef;精确风格绑定属扩展位。

## 7. 排期

本实例 = 清单(本文)+ 提取器 + 词锚反演(shared)+ 测试 + 银盐晨光 Screenplay 形态 golden。

## 8. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 221);不碰生产;不 push。

`tests/extract-screenplay.test.ts`:
- **银盐晨光 Screenplay 形态 fixture → 产出过 `validateStoryFlowIR`**(生产侧闭合的总验收)
- 5 镜推导:SHOT 编号/时长(6/5/6/5/4)/motion 去前缀/对白+ttsFloor(**ceil(3.4+0.3)=4、ceil(2.6+0.3)=3**)
- 词锚反演:shutter `at: 3.742s` → `wordIndex 29`(② 正向 29/31×4s=3742ms 的逆,双向闭环)
- refs:char:苏晚 / char:苏晚:晨雾围巾(对白 cue 变体)/ char:陈默 / scene:国营照相馆 + spatial 链接
- spatial:scene graybox 1:1;transitions:DISSOLVE(from4→to5)+ 片尾 FADE OUT;bgm 按 prompt 去重跨镜合并
- 治愈:缺前缀 imagePrompt 补齐;mode 映射 simple→express;多句台词 → 非锚 TtsClip
- golden `docs/storyflow-ir-extracted-example.json` 锁定提取产物(8 条全绿)

## 9. 扩展策略

- 语义 prop 绑定、`generation` 提取钩子、WhisperX 对齐件直读、storyboard 无 imagePrompt 时的 AI 补写 = 命名扩展位(additive)。
- 反向(IR→Screenplay 回写)不在本层——IR 是编译器输入,剧本是创作源,单向。
