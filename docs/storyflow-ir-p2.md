# StoryFlowIR P2 —— 接入层:接口清单与调用时序

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0 `90d7fff` / P1 `bede373`+三路)
> 任务书(协调侧口述,无独立文件):P1 交付深度定为纯编译层时已留位——**P2 = 接入层**,把①②③编译产物喂给现有 `services/{comfyService, glmTtsService, falMusicService, sfxService, minimaxService, videoExport}`(薄适配函数,mock 测试不跑真网络)。范围:①VisualCallPlan→minimax/fal 调用参数映射 ②AudioMixPlan→TTS/SFX 任务队列+mixSegment 参数 ③StoryFlowXML 导出入口(golden 已锁)。**本实例:先出接入层接口清单与调用时序,再动工①。**
> 门禁:tsc strict + vitest 零回退;**不碰生产**(services 为只读依赖);不 push。

## 1. 边界总则(P2)

1. **薄适配 = 纯映射**:桥函数 `(编译产物, 运行时注入物) → 服务调用参数元组`。密钥、上传文件名、解算好的 Blob/URL 一律由调用方注入(`src/bridge/types.ts` 的 `*CallRuntime`);映射内**零 IO**。
2. **不碰生产**:`services/*` 只 import 不修改(消费公开签名,行为以现网为准)。私有 helper(如 `clampImagePrompt`)如需等价规则 → 本地镜像 + file:line 互注(P1 同款)。
3. **mock 测试不跑真网络**:测试注入假 key/Blob/上传名,只断言参数映射与调用时序;服务函数本身不被调用。
4. **契约延续**:P0 三原则(后端无关/词级锚定/金额分整数)+ P1 缝合不变量继续有效。参考图厂商不对称(minimax image-01 单 `subject_reference` vs fal `/edit` `characters[]+landscape`)在本层落地为 per-provider 打包——即 P1 扩展策略所称「imageRefPolicy 属执行器侧」。
5. **supports() 拒绝而非钳制**(Hypit 原则):无映射的后端/非法枚举(如 `grok` 无对应 service、resolution 不在 480P/768P/2K)→ 显式抛错,不静默降级。
6. **严格门禁覆盖**:目标 services 已预检全过 `tsc --strict`(minimaxService/comfyService/glmTtsService/falMusicService/sfxService/videoExport,2026-09-24 实测 exit 0);`tsconfig.ir.json` include 扩到 `src/bridge/**` + `tests/bridge-*.test.ts`。脆弱性记档:这些 services 的未来改动会被卷进 strict 门禁面——与 P1 给 `src/ir/` 立「不 import services」的理由同源,`src/bridge/` 是**有意跨越**该线的唯一一层。

## 2. 接口清单(三路)

模块布局:`src/bridge/{types,visual,audio,format}.ts`——types = 调用形状 + 运行时注入物(全部 code-locked);①②③ 各一个桥文件。

### 2.1 ①视觉桥 `src/bridge/visual.ts` —— VisualCallPlan → minimax/fal/comfy 调用参数

| 桥函数 | 喂给(服务签名) | 产出 |
|---|---|---|
| `mapImageJobToGenerateImages(job, rt)` | `minimaxService.generateImages(cfg, prompt, opts)` | `GenerateImagesCall{kind:'images', cfg, prompt, opts}` |
| `mapVideoJobToH3(job, rt)` | `minimaxService.createH3Task(cfg, params, videoFileUri?)`(r2v 先 `uploadH3Video(cfg, blob)`) | `CreateH3Call{kind:'h3', cfg, params, videoFileUri?}` |
| `mapVideoJobToComfy(job, rt)` | `comfyService.comfyPatchWorkflow(graphJson, patch)` → `comfyQueuePrompt(cfg, graph)` | `ComfyPatchCall{kind:'comfy', cfg, graphJson, patch}` |
| `mapVideoCall(job, rts)` | 按 `job.backend` 分派上述二者;`grok` → 抛错拒绝 | `CreateH3Call \| ComfyPatchCall` |
| `planCallSequence(plan)` | 调用方编排(§3) | `CallStep[]`(带 `needs` 依赖) |

**字段映射(①核心交付物)**:

| 服务参数 | ← 来源 |
|---|---|
| `generateImages` prompt | `job.prompt.text`(= imagePrompt 原样) |
| opts.n / aspectRatio | `1` / `rt.aspectRatio ?? '16:9'`(expressService 口径) |
| opts.subjectReference(minimax) | `primaryRefSlot` 槽位 Blob(单身份锁定;景在 prompt 文本,无 landscape 槽——不对称记档) |
| opts.references.characters[](fal) | character 槽位 Blob,按槽序 |
| opts.references.landscape(fal) | scene 槽位 Blob |
| `H3SubmitParams.prompt` | `job.prompt.text`(**不含** `<Picture N>` 材料块——那是 comfy 方言,H3 以 referenceImages 数组收参考) |
| H3 referenceImages | `materials.slots` → `{name: 'ref-'+index, blob}`,≤9(打包层已钳) |
| H3 resolution | `job.vendor.resolution` ?? `rt.resolution` ?? `'768P'`;非法值抛错 |
| H3 model / outputSeconds / videoSeconds | `vendor.model` ?? `rt.model` / `job.outputSeconds` / r2v 时 `rt.whiteModel.seconds`(否则 0) |
| H3 videoBlob / videoFileUri | r2v 时 `rt.whiteModel.blob / .fileUri`(上传时序 §3.2) |
| comfy prompt | `job.prompt.text` + `\n\n` + `renderComfyMaterials(slots, {hasVideo: path==='r2v'})`(①编译层导出的方言助手) |
| comfy patch.refImageNames | `rt.uploadedRefNames`(槽序上传名) |
| comfy patch.refVideoNames | r2v 时 `[rt.uploadedVideoName]` |
| comfy patch.firstFrameName / stripFirstFrame | i2v → `rt.uploadedFirstFrameName`;t2v 且无槽 → `stripFirstFrame: true`(live 规则 `refs.urls.length === 0`) |
| comfy patch.durationSeconds / randomizeSeed | `job.outputSeconds` / `job.seed.mode === 'reroll'` |

**运行时注入物**:`ImageCallRuntime{provider:'minimax'|'fal', apiKey, baseUrl?, falKey?, falModel?, falQuality?, aspectRatio?, refs: ResolvedRef[]}`、`H3CallRuntime{apiKey, baseUrl, whiteModel?: {blob, seconds, fileUri?}, refs?, resolution?, model?}`、`ComfyCallRuntime{serverUrl, graphJson, uploadedRefNames?, uploadedFirstFrameName?, uploadedVideoName?}`;`ResolvedRef{refId, name, blob}` 按槽序。

**记档(①)**:
- **seed**:两服务的提交参数均无显式 seed 字段——`SeedPlan` 的 `fixed` 仅在 comfy 侧以 `randomizeSeed: false` 近似(沿用图内种子);minimax/H3 每次 createH3Task 即新抽卡,`fixed` 不可表达(supports 缺口,不在 P2 补)。
- **comfy 拼包统一**:t2v/r2v 也写入 `durationSeconds`(live 段路径漏传,`comfyPatchWorkflow` 本就支持;与 P1 `<Picture N>` 修复同性质的记档偏离)。
- **grok**:`backend:'grok'` 无对应 service → `mapVideoCall` 抛错;`planCallSequence` 标 `call:'unsupported'` 保持时序函数全域(银盐晨光示例含 grok 镜头)。

### 2.2 ②音频桥 `src/bridge/audio.ts` 🔒边界桩(P2-② 实例实装)

| 桥函数 | 喂给 | 产出 |
|---|---|---|
| `mapAudioPlanToTtsQueue(plan, rt)` | `glmTtsService.synthesizeSpeech(apiKey, input, opts)`(逐句逐 part) | `TtsCall[]{clipId, partIndex, apiKey, input, opts}` |
| `mapAudioPlanToSfxQueue(plan)` | `sfxService.resolveSfx(name)` | `SfxCall[]{clipId, name}` |
| `mapAudioPlanToBgmQueue(plan, rt)` | `falMusicService.requestMusic(falKey, prompt)` → `pollMusic` | `BgmCall[]{clipId, falKey, prompt}` |
| `mapMixToProSegmentCuts(plan, rt)` | `videoExport.exportProCut(segments, opts)` | `ProSegmentCut[]` |

**字段映射要点**:TtsJob.parts → 逐 part 一调用(`GlmTtsOptions{voice, speed, volume, watermarkEnabled: clip.watermark}`——注意适配器参数名是 `watermarkEnabled`);MixSegment → `ProSegmentCut{segKey: shotId, ttsKeys: 按 mix.tts 序的 store 键, bgmUrl, sfx:[{blob, atMs}]}`(atMs 已由 ② 计划给出)。混音增益执行值在 ffmpeg 滤镜层(muxSegment 内置),不进 ProSegmentCut。

**调用时序(②)**:TTS 逐句合成(同参 wav `concatWavs` 拼杆)→ `wavDuration` 回填探活 → SFX `resolveSfx`(`missing` 保留)→ BGM `requestMusic`+`pollMusic`(每床一次)→ `exportProCut`(段内 amix → concat)。

### 2.3 ③导出桥 `src/bridge/format.ts` 🔒边界桩(P2-③ 实例实装)

| 桥函数 | 喂给 | 产出 |
|---|---|---|
| `exportStoryFlowXml(ir, opts?)` | 浏览器下载壳(`utils/exportData.ts` exportJSON 模式:Blob+`<a>`) | 触发 `*.storyflow.xml` 下载 |

renderStoryFlowXML 产物即文件体(golden `docs/storyflow-xml-example.xml` 已锁);导出入口只做文件名(默认 `<title>.storyflow.xml`)+ 下载壳。

## 3. 调用时序(运行时编排契约)

### 3.1 Express 路(首帧 T2I → I2V)

```
per shot(shot 序):
  [1] generateImages(mapImageJobToGenerateImages 产物) → blob(首帧)
  [2] i2v(comfy):comfyUploadImage(首帧) → comfyPatchWorkflow(I2V 图,
      {prompt, firstFrameName, durationSeconds: job.outputSeconds,
       randomizeSeed}) → comfyQueuePrompt → 轮询
```
`CallStep` 依赖:image step `needs:[]`;i2v step `needs:[firstFrame.fromJobId]`——[1] 未完成不得提交 [2]。

### 3.2 Pro 路(T2V / R2V)

```
t2v(minimax):createH3Task(mapVideoJobToH3 产物)            # chain 链元互相独立,可并行
t2v(comfy):  comfyUploadImage 各槽图 → comfyPatchWorkflow → comfyQueuePrompt
r2v(minimax):uploadH3Video(白模 blob) → fileUri → createH3Task(cfg, params, fileUri)
r2v(comfy):  comfyUploadImage 槽图 + 白模 → patch({refVideoNames}) → queue
```

### 3.3 编排规则

1. **依赖只有 express 的 i2v←image**;chain 链元、镜头间全部互相独立(并行安全)。
2. **花钱仪式感**:`estimatedCostFen` 在计划层(P1)——桥不做预算,提交前确认由调用方负责。
3. **失败重试 = 新调用**(reroll 语义:新种子/新任务),桥内不做隐式重试。
4. 轮询/上传属 IO 壳(app/后续实例),不在映射函数内。

## 4. 排期

**本实例 = 清单+时序(本文) + ① 实装**。②∥③ 后续实例并发(只依赖本文清单 + services 公开签名);若串行 ② 先(音轨闭合 P1 的 ttsFloor 缝)。

## 5. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 189);不碰生产;不 push。

| 路 | 机器可检门禁 |
|---|---|
| ① ✅ | `tests/bridge-visual.test.ts` 全绿(生图映射 per-provider 不对称 / H3 字段映射 / comfy 拼包+seed 近似 / 分派拒绝 grok / 调用时序依赖 / ②③ 桩);映射输出形状与 `services` 签名经 type 级 `Equal` 互注 |
| ② 🔒 | `tests/bridge-audio.test.ts`:TtsCall 逐 part、ProSegmentCut 字段映射(atMs/键序)、时序队列;桩抛 `P2-② not implemented` |
| ③ 🔒 | `tests/bridge-format.test.ts`:导出文件名/壳;桩抛 `P2-③ not implemented` |

## 6. 扩展策略

- services 公开签名变化 → 桥映射回归测试变红 → **修桥不修 services**(不碰生产)。
- 新后端(grok service、fal 视频等)→ 新增 mapper + 分派表登记;拒绝原则不变。
- 真执行器(submit/poll IO 壳)、批量编排 UI、预算闸门 = P2 之后的接入层纵深,不在本层映射职责内。
