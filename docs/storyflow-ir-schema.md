# StoryFlowIR Schema(P0):视频生产管线的显式 JSON 契约

> 版本 **0.1.0** · 2026-09-24 · 分支 `ir-schema`
> 定位:StoryFlowIR 是**编译器的输入格式**——把剧本/分镜/参考系/音轨意图固化为一份可校验的 JSON 文档,P1 的三个并发实例(**视觉编译器 / 音频编译器 / 声明式格式**)都以此为唯一契约。
> 原则:**从现有代码提取,不是从零发明**。下文每个字段都能指回一个已在生产代码中存在的结构。

## 0. 交付物与门禁

| 交付物 | 路径 |
|---|---|
| TypeScript 类型(strict) | `src/ir/types.ts` |
| zod schema(运行时校验) | `src/ir/schema.ts` |
| schema 校验测试 | `tests/ir-schema.test.ts` |
| 完整示例 JSON(《银盐晨光》) | `docs/storyflow-ir-example.json`(本文 §7 内嵌同一份) |

门禁(全部可机器验证):

```bash
npm run typecheck:ir   # tsc --strict 对 src/ir + IR 测试,0 错
npm run typecheck      # 仓库根 tsc --noEmit,0 错(不回退)
npx vitest run         # 121 个既有测试 + 26 个 IR 测试,全绿
```

**防漂移护栏**:zod v4 在 `strictNullChecks` 关闭时类型推断会退化(tuple 变宽、union 属性误标 optional),因此 `schema.ts` 里的 22 条 `Equal<手写类型, z.infer<schema>>` 断言**只在 strict 下武装**(见 `Guard<T>` 条件类型):`typecheck:ir` 下两份定义任何一侧漂移立即编译失败。手写类型是人类阅读的契约,zod 是运行时执行者,二者被编译期锁死为等价。

## 1. 设计原则(站长三条,全文档强制)

1. **后端无关**:核心结构不含任何 ComfyUI/MiniMax/Grok 专有参数。后端专有旋钮一律放 `Shot.generation.vendor`(扁平的 string/number/boolean 袋子),只被对应后端的编译器读取——换后端不改文档形状。`steps` 仅对自托管扩散后端(comfyui)有意义,闭源 API 惯例填 `1`。
2. **词级锚定,非秒级**:挂在语音上的事件(SFX 落点、字幕同步)以**词序号**锚定在镜头的锚定文本(`dialogue.text`,无对白则 `motionPrompt`;中文按字、英文按空白分词,0 起),秒数是编译器用 TTS 探活结果**推导**的——换音色/调速后锚点永不失效。固有时长(镜头长度、叠化长度)当然是普通秒数。
3. **金额分整数**:IR 内不出现金额。未来任何成本字段一律以最小货币单位**整数(分)**存储,禁止浮点元。

## 2. 提取来源映射(隐式结构 → IR 字段)

| IR 结构 | 现有代码来源(提取处) |
|---|---|
| `mode` | `Screenplay.productionMode`(`'simple'→express`,`'cinematic'→pro`,types.ts) |
| `style` | `ScriptMetadata.styleHead: StyleHead`(name/artStyle/scenePreset/promptPrefix 原样) |
| `refs.characters` | RefImage v4 身份模型(kind/charName/variant/versionGroup)+ `CharacterWardrobe`;**主/变体不合并**——`女主` 与 `女主(战损)` 是两张不同的设定表(videoSegmentSubmit.ts 的教训) |
| `refs.props / scenes / styles / actions` | RefImage kind='prop'/'environment'/'action' + `resolveRefBindings().environment`;`styles`=需求0901 §3.2 的风格类维度(构图/光照/色彩),全局锚在 `style` 不在此 |
| `shots` | `VideoPlan/VideoSegment/PlannedBeat`(编号/顺序/时长/节拍)+ `ExpressShot`(首帧资产、locked 生命周期)+ `block.imagePrompt` + I2V prompt(expressService.ts) |
| `shots.camera` | `GrayboxCamera`(shotType/position/lookAt/movement 双曲线/focus),Pro 模式从 graybox 提取 |
| `shots.dialogue.ttsFloor` | TTS 时长下限规则(utils/proAudio.ts):`L = ceil(Σ台词时长 + 0.3s 呼吸)`,镜头时长永不低于它 |
| `shots.status` | `ExpressShot.locked` + H3Task 生命周期归并:draft/generated/locked/exported(瞬态 imaging/generating 不入契约) |
| `audio` 三轨 | `ProSegmentAudio`(tts/bgm/sfx)+ 三个适配器参数:GLM-TTS(voice/speed/volume/watermark,GlmTtsOptions)、fal sonilo(prompt,buildBgmPrompt)、SFX manifest(name/match/missing,sfxService.ts) |
| `transitions` | TRANSITION 块("CUT TO:"/"DISSOLVE TO:")+ videoPlan 的场景硬边界 |
| `spatial` | `GrayboxData kind='scene'`(layout + characters)+ 坐标宪章(见 §6) |

## 3. 顶层结构

```typescript
interface StoryFlowIR {
  version: typeof IR_VERSION;  // 锁定 '0.1.0';过期文档在校验层直接报错
  mode: 'express' | 'pro';     // 编译 profile(= productionMode 的语义升级)
  title: string;
  style: StyleRef;             // 全局风格锚
  refs: RefRegistry;           // 角色/道具/场景/风格 ref 注册表
  shots: Shot[];               // 编号镜头列表(不含 scene layout)
  audio: AudioTrack[];         // 音频片段(TTS/BGM/SFX 三轨的 kind 标记平铺)
  transitions: Transition[];   // 转场列表
  spatial: SpatialLayout[];    // 场景空间锚定(不进 shots,供 refs 引用)
}
```

`audio` 为什么是平铺而非三个容器:每一 clip 显式绑自己的 `shotId`,这正是音频编译器和导出混音器(`exportProCut` 的 amix)要的消费形状;三轨 = 按 `kind` 过滤的三个视图。

## 4. Shot(核心单元)逐字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `SHOT_001` 格式 | 3 位起零填充;全文档唯一(zod 校验) |
| `sequence` | int ≥1 | 顺序;校验器强制 **1..N 连续无重复** |
| `imagePrompt` | string | 首帧生成 prompt,**必须以 `style.promptPrefix` 开头**(express 管线里 StyleHead 前缀本就 upstream 烘焙,zod superRefine 强制) |
| `motionPrompt` | string | 画面内运动描述(I2V 用);不含风格前缀 |
| `shotDuration` | number >0 | 镜头总时长(秒)= 故事时长;对模型输出窗(4–15s)的钳制(`clampSegmentSeconds`)是编译器的事,不回写本字段 |
| `firstFrame` | `FrameDesc` | `{ description, assetId? }`;资产只存库 id,URL 会话级不入契约 |
| `lastFrame?` | `FrameDesc` | 尾帧(可选),端点条件生成用 |
| `camera?` | `CameraMove` | 运镜(Pro,从 graybox 提取);双曲线模型:`movement.path` 是机身轨迹、`movement.lookPath` 是镜头指向轨迹——pan/tilt = 机身不动、lookPath 扫掠。`movement.targetSeconds` 把故事时长与模型固定输出窗解耦 |
| `refBindings` | string[] | 引用的注册表 id;校验器强制全部可解析 |
| `character?` | string | 说话人(基础名);**有 `dialogue` 必须有 `character`**(校验器强制) |
| `dialogue?` | `{ text, ttsFloor }` | 对白;`ttsFloor` = TTS 时长下限(秒),编译器合成探活后回填,0 = 未测 |
| `generation?` | `GenerationParams` | `{ backend: 'comfyui'\|'minimax'\|'grok', steps: int≥1, seed?: int≥0, vendor?: Record<string, string\|number\|boolean> }`;seed 换新 = 抽卡重 roll,永不原地变异 |
| `status` | `'draft'\|'generated'\|'locked'\|'exported'` | draft=仅规划;generated=已出片;locked=🔒冻结(重 roll 不覆盖);exported=已进成片 |

`CameraMove` 的坐标遵循 §6 坐标宪章(米、y 向上、弧度、lookAt 目标点)。

## 5. RefRegistry / AudioTrack / Transition

### RefRegistry(五类注册表)

```typescript
interface RefRegistry {
  characters: CharacterRef[];  // 主/变体:id 'char:苏晚' / 'char:苏晚:晨雾围巾'
  props: PropRef[];            // 'prop:海鸥相机'
  scenes: SceneRef[];          // 'scene:照相馆';sceneHeading + spatialId?
  styles: ExtraStyleRef[];     // 'style:晨光光柱' —— 额外风格参考图
  actions?: ActionRef[];       // 'action:擦拭相机' —— v0.1 可选
}
```

- id 是**语义化且可校验**的:`kind:name` / 角色变体 `char:name:variant`;name 不得含 `:`(分隔符);校验器强制 id↔条目一致、**跨类别唯一**。
- 资产溯源 `AssetProvenance { assetId?, source?, sourcePrompt?, versionGroup?, version? }` 原样对应 RefImage 的可持久化字段;图片本体永远留在资产库,IR 只带 id 与文字。
- SCENE 的 `spatialId` → `spatial[]`:这就是"spatial 不进 shots、供 refs 引用"的落点——镜头经 `refBindings` 绑场景 ref,场景 ref 再指向 3D 布局。

### AudioTrack(三轨 = kind 判别联合)

| kind | 字段要点 | 来源适配器 |
|---|---|---|
| `tts` | `shotId, character?, text, voice, speed?(0.5–2), volume?, watermark?(默认 true), measuredSeconds?, gain?(默认 1.0)` | GLM-TTS;voice = 系统音色(tongtong/chuichui/xiaochen/jam/kazi/douji/luodo)或复刻 id 透传 |
| `bgm` | `fromShotId, toShotId?(缺省=到片尾), prompt, loop?(默认 true), gain?(默认 0.25)` | fal sonilo;prompt 由 StyleHead 场景 preset + 场景情绪生成(buildBgmPrompt);每场景一条,跨镜头延续到下一条 bgm |
| `sfx` | `shotId, name, anchor, missing?, gain?(默认 0.8)` | SFX 小库 manifest;**`anchor` 是词级锚**:`{kind:'shot-start'} | {kind:'shot-end'} | {kind:'word', wordIndex≥0}`;manifest 无命中保留 `missing:true`(SFX_MISSING),不静默丢弃 |

id 格式 `aud-(tts|bgm|sfx)-001`;校验器强制所有 shotId/fromShotId/toShotId 指向存在的镜头。

### Transition

```typescript
interface Transition {
  id: string;                // 'tr-001'
  type: 'cut' | 'dissolve' | 'fade-in' | 'fade-out' | 'wipe' | 'match-cut';
  target: string;            // → Shot.id;cut/dissolve/fade-in 进入该镜头,fade-out 叠在该镜头上(常为最后一个)
  from?: string;             // 缺省 = sequence 前一个镜头
  durationSeconds?: number;  // 叠化/黑场自身时长(固有属性,非锚点)
}
```

## 6. SpatialLayout 与坐标宪章

`spatial[]` 每项 = 一个场景的 3D 锚定(来自 GrayboxData kind='scene'):`{ id: 'spatial:照相馆', sceneHeading, objects: SpatialObject[], characters: SpatialCharacter[] }`。

**坐标与单位宪章**(与 types.ts 的 graybox 宪章逐字一致,所有下游——Three.js 渲染器、白模体检、Seedance/H3 prompt 构建器、未来的 Blender 导出器——按字面消费):

- 单位:**米**;轴:**y 向上**,地面 y=0;原点 = 场景自然中心(内景房心/外景动作零点)。
- 角度:**弧度**;角色 `facing` 是绕 Y 旋转,0 = +Z。
- 相机瞄准一律 **lookAt 目标点**,永不欧拉角。
- 转换器只做变换(transform),不做重新解释(reinterpret)。

## 7. 示例:《银盐晨光》(mode: pro)

> 说明:该示例按《银盐晨光》命题完整重写并校验通过(`tests/ir-schema.test.ts` 加载本文件逐条断言)。原演示剧本存放于临时浏览器会话的 localStorage,未能留存,故示例为按 schema 特性(五类 ref、三后端 generation、三轨音频含 SFX_MISSING、双曲线运镜、词级锚定、尾帧)精心构造的等价物。
> 文件:`docs/storyflow-ir-example.json`(下方内嵌同一份,以文件为准)。

```json
{
  "version": "0.1.0",
  "mode": "pro",
  "title": "银盐晨光",
  "style": {
    "name": "银盐晨光",
    "artStyle": "银盐胶片摄影质感:细腻颗粒、柔和晨光、暖金色调、柯达 Portra 胶片色,轻微暗角与高光光晕",
    "scenePreset": "1990 年代中国南方小城的国营照相馆,清晨,木质橱窗,尘埃在光柱中漂浮,旧挂钟与褪色样片墙",
    "promptPrefix": "silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, "
  },
  "refs": {
    "characters": [
      { "id": "char:苏晚", "name": "苏晚", "description": "女照相师,28 岁,齐肩黑发别一支素色发卡,米白的确良衬衫袖口挽起,神情安静专注", "asset": { "assetId": "asset_sowan_base_01", "source": "ai-generate", "sourcePrompt": "1990s chinese young woman photographer, white shirt, film photo portrait", "versionGroup": "sowan", "version": 1 } },
      { "id": "char:苏晚:晨雾围巾", "name": "苏晚", "variant": "晨雾围巾", "description": "苏晚在晨间湿冷时加的一条雾灰色针织围巾,其余形象与主设定一致", "asset": { "assetId": "asset_sowan_scarf_01", "source": "ai-generate", "versionGroup": "sowan", "version": 2 } },
      { "id": "char:陈默", "name": "陈默", "description": "常客,35 岁上下,火车司机,深绿色旧工装外套,眉眼温和,随身一只人造革提包", "asset": { "assetId": "asset_chenmo_base_01", "source": "upload", "versionGroup": "chenmo", "version": 1 } }
    ],
    "props": [
      { "id": "prop:海鸥相机", "name": "海鸥相机", "description": "海鸥牌 4B 双反相机,银灰机身磨损发亮,皮质快门线垂在侧面,腰平取景器朝上", "asset": { "assetId": "asset_seagull_4b_01", "source": "upload" } }
    ],
    "scenes": [
      { "id": "scene:照相馆", "name": "照相馆", "sceneHeading": "INT. 国营照相馆 - 清晨", "description": "老式照相馆内景:北面木质橱窗透进晨光,光柱里浮尘可见,砖墙挂褪色样片,柜台后是深色背景布", "spatialId": "spatial:照相馆", "asset": { "assetId": "asset_studio_env_01", "source": "ai-generate" } }
    ],
    "styles": [
      { "id": "style:晨光光柱", "name": "晨光光柱", "description": "构图与光照参考:低角度晨光穿过橱窗形成可见光柱,主体半逆光,高光允许过曝半档", "asset": { "assetId": "asset_lightbeam_ref_01", "source": "video-frame" } }
    ],
    "actions": [
      { "id": "action:擦拭相机", "name": "擦拭相机", "description": "双手持软布沿机身画圆擦拭的动作参考,节奏缓慢,不抬腕", "asset": { "assetId": "asset_action_wipe_01", "source": "upload" } }
    ]
  },
  "shots": [
    {
      "id": "SHOT_001", "sequence": 1, "status": "exported",
      "imagePrompt": "silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, wide interior at dawn, sunbeams cutting through the wooden display window, dust motes floating, faded sample prints on the brick wall, empty counter, no people",
      "motionPrompt": "镜头极缓慢前推,光柱中尘埃缓缓漂浮,样片墙高光微微呼吸;画面内无人物",
      "shotDuration": 6,
      "firstFrame": { "description": "照相馆内景清晨全景:北窗光柱斜切过空荡的柜台,样片墙在半逆光中泛黄" },
      "camera": { "shotType": "wide", "description": "定场:让光柱先于人物出场,建立空间的安静与年代感", "position": [0.0, 1.5, 4.2], "lookAt": [0.0, 1.2, 0.0], "movement": { "type": "dolly", "duration": 6, "targetSeconds": 6, "path": [[0.0, 1.5, 4.2], [0.0, 1.4, 3.4]], "lookPath": [[0.0, 1.2, 0.0], [0.0, 1.2, 0.0]] } },
      "refBindings": ["scene:照相馆", "style:晨光光柱"],
      "generation": { "backend": "comfyui", "steps": 28, "seed": 10240001, "vendor": { "workflow": "i2v-v3", "sampler": "euler" } }
    },
    {
      "id": "SHOT_002", "sequence": 2, "status": "generated",
      "imagePrompt": "silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, close-up of a young woman's hands polishing a vintage twin-lens reflex camera on the wooden counter, shallow depth of field",
      "motionPrompt": "苏晚双手沿机身缓慢画圆擦拭,软布起伏,快门线轻微晃动;镜头固定",
      "shotDuration": 5,
      "firstFrame": { "description": "特写:苏晚的手与海鸥双反相机,晨光侧逆,金属磨损处反着暖光" },
      "camera": { "shotType": "close-up", "position": [0.6, 1.1, 1.2], "lookAt": [0.2, 1.0, 0.4], "movement": { "type": "static", "duration": 5 } },
      "refBindings": ["char:苏晚", "prop:海鸥相机", "scene:照相馆", "action:擦拭相机"],
      "generation": { "backend": "comfyui", "steps": 28, "seed": 10240002 }
    },
    {
      "id": "SHOT_003", "sequence": 3, "status": "draft",
      "imagePrompt": "silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, medium two-shot, a man in a dark green work jacket entering through the studio door, morning light flaring briefly behind him, woman at the counter turning her head",
      "motionPrompt": "陈默推门进店,门铃轻晃;他抬手示意;苏晚在柜台后抬头;镜头固定中景",
      "shotDuration": 6,
      "firstFrame": { "description": "中景双人:陈默跨进门,背后晨光短暂光晕,苏晚在柜台后侧身回头" },
      "character": "陈默",
      "dialogue": { "text": "拍一张证件照,要赶九点的火车。", "ttsFloor": 4 },
      "camera": { "shotType": "medium", "position": [-0.4, 1.4, 2.6], "lookAt": [0.1, 1.3, 0.6], "movement": { "type": "static", "duration": 6 }, "focus": "陈默" },
      "refBindings": ["char:陈默", "char:苏晚", "scene:照相馆"],
      "generation": { "backend": "minimax", "steps": 1, "vendor": { "model": "h3", "resolution": "768P" } }
    },
    {
      "id": "SHOT_004", "sequence": 4, "status": "locked",
      "imagePrompt": "silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, medium close-up of the young woman in a mist-grey knit scarf looking up from the counter with a gentle smile, warm rim light on her hair",
      "motionPrompt": "苏晚抬头,嘴角渐展微笑,围巾边缘随转身轻动;镜头缓慢推近半档",
      "shotDuration": 5,
      "firstFrame": { "description": "中近景:苏晚(晨雾围巾)抬头瞬间,发丝边缘被晨光镶了一道金边" },
      "character": "苏晚",
      "dialogue": { "text": "好,坐那边,光正好。", "ttsFloor": 3 },
      "camera": { "shotType": "medium", "position": [0.2, 1.4, 1.8], "lookAt": [-0.6, 1.35, 0.2], "movement": { "type": "dolly", "duration": 5, "path": [[0.2, 1.4, 1.8], [0.0, 1.4, 1.5]], "lookPath": [[-0.6, 1.35, 0.2], [-0.6, 1.35, 0.2]] } },
      "refBindings": ["char:苏晚:晨雾围巾", "scene:照相馆"],
      "generation": { "backend": "grok", "steps": 1, "seed": 10240004, "vendor": { "quality": "high" } }
    },
    {
      "id": "SHOT_005", "sequence": 5, "status": "draft",
      "imagePrompt": "silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, macro still life on the counter, the twin-lens reflex camera viewfinder catching a tiny upside-down image of the window light, dust in the beam, quiet morning",
      "motionPrompt": "固定镜头微距:腰平取景器里的倒立窗光微微呼吸,尘埃缓浮,画面渐暗收黑",
      "shotDuration": 4,
      "firstFrame": { "description": "微距静物:海鸥相机腰平取景器中倒映着橱窗光柱,四下安静" },
      "lastFrame": { "description": "同机位,画面整体压暗至近黑,仅取景器亮点残留" },
      "camera": { "shotType": "close-up", "position": [0.3, 1.0, 0.8], "lookAt": [0.25, 0.95, 0.35], "movement": { "type": "static", "duration": 4 } },
      "refBindings": ["prop:海鸥相机", "scene:照相馆"],
      "generation": { "backend": "comfyui", "steps": 30, "seed": 10240005 }
    }
  ],
  "audio": [
    { "id": "aud-tts-001", "kind": "tts", "shotId": "SHOT_003", "character": "陈默", "text": "拍一张证件照,要赶九点的火车。", "voice": "jam", "speed": 1.0, "watermark": false, "measuredSeconds": 3.4, "gain": 1.0 },
    { "id": "aud-tts-002", "kind": "tts", "shotId": "SHOT_004", "character": "苏晚", "text": "好,坐那边,光正好。", "voice": "tongtong", "speed": 0.9, "measuredSeconds": 2.6, "gain": 1.0 },
    { "id": "aud-bgm-001", "kind": "bgm", "fromShotId": "SHOT_001", "prompt": "Nostalgic quiet-morning instrumental bed for a 1990s photo studio at dawn. Warm felt piano with soft tape hiss, no vocals, steady loop, 30 seconds.", "loop": true, "gain": 0.25 },
    { "id": "aud-sfx-001", "kind": "sfx", "shotId": "SHOT_003", "name": "ding", "anchor": { "kind": "shot-start" }, "gain": 0.8 },
    { "id": "aud-sfx-002", "kind": "sfx", "shotId": "SHOT_005", "name": "shutter", "anchor": { "kind": "word", "wordIndex": 12 }, "missing": true, "gain": 0.8 }
  ],
  "transitions": [
    { "id": "tr-001", "type": "cut", "target": "SHOT_002", "from": "SHOT_001" },
    { "id": "tr-002", "type": "cut", "target": "SHOT_003", "from": "SHOT_002" },
    { "id": "tr-003", "type": "cut", "target": "SHOT_004", "from": "SHOT_003" },
    { "id": "tr-004", "type": "dissolve", "target": "SHOT_005", "from": "SHOT_004", "durationSeconds": 1.2 },
    { "id": "tr-005", "type": "fade-out", "target": "SHOT_005" }
  ],
  "spatial": [
    {
      "id": "spatial:照相馆",
      "sceneHeading": "INT. 国营照相馆 - 清晨",
      "objects": [
        { "id": "floor", "type": "plane", "role": "floor", "position": [0.0, 0.0, 0.0], "size": [6.0, 5.0, 0.0] },
        { "id": "wall_north", "type": "plane", "role": "wall", "label": "橱窗墙", "position": [0.0, 1.5, -2.5], "size": [6.0, 3.0, 0.0] },
        { "id": "window_display", "type": "plane", "role": "window", "label": "木质橱窗", "position": [0.0, 1.5, -2.48], "size": [3.2, 2.2, 0.0], "color": "#d9c9a8" },
        { "id": "wall_south", "type": "plane", "role": "wall", "position": [0.0, 1.5, 2.5], "size": [6.0, 3.0, 0.0] },
        { "id": "door", "type": "box", "role": "door", "label": "店门", "position": [1.2, 1.05, 2.5], "size": [1.0, 2.1, 0.1], "color": "#6b4a2f" },
        { "id": "counter", "type": "box", "role": "furniture", "label": "柜台", "position": [0.0, 0.55, 0.2], "size": [2.4, 1.1, 0.8], "color": "#8b5e3c" },
        { "id": "backdrop", "type": "plane", "role": "environment", "label": "深色背景布", "position": [0.0, 1.6, 1.8], "size": [2.6, 2.4, 0.0], "color": "#3a3f4a" },
        { "id": "tripod", "type": "cylinder", "role": "prop", "label": "相机三脚架", "position": [1.2, 0.7, 1.2], "size": [0.08, 1.4, 0.08], "color": "#4a4a4a" }
      ],
      "characters": [
        { "name": "苏晚", "position": [-0.8, 0.2], "facing": 1.57, "pose": "standing" },
        { "name": "陈默", "position": [0.9, 2.0], "facing": 3.34, "pose": "standing" }
      ]
    }
  ]
}
```

## 8. 校验与使用(P1 实例的入口)

```typescript
import { parseStoryFlowIR, validateStoryFlowIR } from '../src/ir/schema';

// 抛错式(zod 结构化 issue):
const ir = parseStoryFlowIR(JSON.parse(raw));

// 门禁式(工具/测试):
const r = validateStoryFlowIR(JSON.parse(raw));
if (!r.ok) console.error(r.issues); else compile(r.ir);
```

schema 强制的跨字段不变量:镜头 id 唯一 + sequence 连续;`imagePrompt` 带风格前缀;`dialogue ⇒ character`;`refBindings`/audio shot 引用/transitions target 全部可解析;`spatialId` 可解析;注册表 id 形状合法且跨类别唯一;未知字段一律拒绝(strict object——笔误的 `shotDuratoin` 不会静默通过)。

## 9. 版本与扩展策略

- **新增字段** → 必须 optional,minor 升版(0.1.x → 0.2.0),旧文档照常通过。
- **改名/删除/语义变更** → major 升版,`version` 字面量锁定使旧文档在校验层**大声失败**,绝不静默误编译。
- P1 三实例对 `vendor`/`spatial`/`actions` 的消费发现的新需求,走同一条 additive 路径。

---
*设计:从现有代码提取 · Claude Code agent · 2026-09-24*
