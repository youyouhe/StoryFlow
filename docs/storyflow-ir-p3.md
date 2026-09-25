# StoryFlowIR P3 —— 真执行器 IO 壳:接口清单与生命周期时序

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0 契约 / P1 三路编译 / P2 接入层桥映射)
> 范围(协调侧确认):**真执行器(submit/poll/collect IO 壳)**——在 P2 桥映射之上做真运行时编排:ComfyUI/H3 轮询、TTS 合成、BGM 轮询、ffmpeg 导出链,**可注入 mock 测全部时序**。即 p2.md §6 明文命名的「P2 之后的接入层纵深」。
> 门禁:tsc strict + vitest 零回退;不碰生产(services 只读依赖);不 push。

## 1. 边界总则(P3)

1. **ports 全 IO**:执行器只经 `*ExecPorts` 触网——执行器触碰的**每一个** services 函数(含 `comfyPatchWorkflow`/`wavDuration` 等纯侧)都在 ports 里,签名自 services 推导(`Parameters<typeof import(…)>`)防漂移。单一接缝 ⇒ 全时序可 mock(任务书「可注入 mock 测全部时序」)。`wiring.ts` 把真身绑上即是「真执行器」。
2. **不碰生产**延续:services 只 import 不修改;P2 桥映射(`src/bridge/`)继续作为参数打包唯一出处,执行器不重复实现映射。
3. **失败不隐式重试**(P2 编排规则延续):failed/timeout 如实进 `JobRunResult`,重试 = 调用方新调用(reroll 语义)。
4. **严格顺序执行**:按 `planCallSequence` 的 CallStep 序逐个执行(needs 恒被先行满足)——对齐 live `submitPlanToH3`「Sequential — H3 bills per task」;链元并行留为后续 opt-in(§6)。
5. **轮询/超时显式参数化**:`pollIntervalMs`(缺省 10_000 = live H3 轮询口径)、`timeoutMs`(缺省 30 分钟 = live stale guard 口径)、`now`/`sleep` 可注入(测试走假时钟)、`signal` 可中止、`onProgress` 生命周期事件。
6. **严格门禁覆盖**:`tsconfig.ir.json` include 扩 `src/exec/**` + `tests/exec-*.test.ts`(services 已在 strict 面)。

## 2. 接口清单

模块布局:`src/exec/{types,wiring,visualExec,audioExec,exportExec}.ts`。

### 2.1 Ports(`src/exec/types.ts`,签名自 services 推导)

| Port 集 | 成员(= services 函数) | 用途 |
|---|---|---|
| `VisualExecPorts` | `generateImages, uploadH3Video, createH3Task, queryH3Task, comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask` | 视频/首帧生成提交与轮询 |
| `AudioExecPorts` | `synthesizeSpeech, concatWavs, wavDuration, resolveSfx, requestMusic, pollMusic` | TTS 合成拼杆探活、SFX 查表、BGM 提交轮询 |
| `ExportExecPorts` | `exportProCut, concatClipsToMp4` | ffmpeg 导出链(Pro 混音 mux / Express 顺序拼) |

`wiring.ts`:`defaultVisualPorts()/defaultAudioPorts()/defaultExportPorts()` 绑定真实 services 函数(真执行器的组装根;测试注入 mock 不经此)。

### 2.2 视觉执行器 `src/exec/visualExec.ts`

`executeVisualPlan(plan: VisualCallPlan, deps: VisualExecDeps, opts?: ExecOptions) → Promise<VisualRunResult>`

- `deps`:`{ports, refBlob(refId→Blob?), firstFrameBlob?(assetId→Blob?), minimax{apiKey,baseUrl}, image?{provider,aspectRatio,falKey,falModel,falQuality}, comfy?{serverUrl,graphJsonOf(path)}, whiteModel?{blob,seconds}, resolution?, model?}`——运行时注入物(P2 口径)+ 资产解算函数。
- 逐 CallStep(顺序):

```
image  : mapImageJobToGenerateImages(补 refs Blob) → generateImages
         → 首帧 blob 入交接表(jobId → blob),resultBlob/resultUrl 收集
i2v    : 首帧 = 交接表[fromJobId] ?? firstFrameBlob(assetId) → comfyUploadImage
         → mapVideoJobToComfy(uploadedFirstFrameName) → comfyPatchWorkflow
         → comfyQueuePrompt → poll(comfyQueryTask)
t2v    : 槽图逐个 comfyUploadImage(comfy) / 直喂 Blob(H3)
         → mapVideoJobToComfy / mapVideoJobToH3 → queue / createH3Task → poll
r2v    : 白模 comfyUploadImage(comfy) / uploadH3Video→fileUri(H3)
         → …同上(refVideoNames / videoBlob+fileUri)
unsupported(grok 等): skipped + 理由
```

- `JobRunResult{jobId, shotId, status: succeeded|failed|timeout|skipped, resultUrl?, resultBlob?, error?}`;`needs` 未成功 → `skipped`(依赖失败)。H3 `cancelled` 归 `failed`(「任务已取消」)。

### 2.3 音频执行器 `src/exec/audioExec.ts`

`executeAudioPlan(plan: AudioMixPlan, deps: AudioExecDeps, opts?) → Promise<AudioRunResult>`

```
TTS : mapAudioPlanToTtsQueue → 逐 part synthesizeSpeech → concatWavs(每 clip)
      → clipBlobs;wavDuration(拼杆)→ measurements(供② reflow 回填 IR)
SFX : mapAudioPlanToSfxQueue → resolveSfx → sfxResolutions(missing 如实保留)
BGM : mapAudioPlanToBgmQueue → requestMusic → poll(pollMusic)→ bgmUrls
```

- `AudioRunResult{clipBlobs, measurements, sfxResolutions, bgmUrls, failures[]}`;单 clip 失败不中断其余(P2「失败=新调用」)。

### 2.4 导出链 `src/exec/exportExec.ts`

- `exportProCutWithCuts(cuts, deps, opts)` → `exportProCut` 壳(`getAudio` 注入 + 进度透传);`getAudioFrom(clipBlobs)` 助手把 audioExec 产物接成存储取键函数。
- `concatExpressClips(clipUrls, deps, opts)` → `concatClipsToMp4` 壳(Express 顺序拼)。

### 2.5 生命周期时序(submit → poll → collect)

```
submit   函数调用返回任务 id(H3 taskId / comfy promptId / BGM requestId / TTS 即时)
poll     按 pollIntervalMs 查询,直至 终态(succeeded|failed|cancelled)或 timeoutMs
collect  succeeded → 产物(videoUrl / blob / audioUrl)写入 JobRunResult;
         timeout → status 'timeout'(live 30min stale guard 口径);
         抛错   → status 'failed'(错误信息如实)
```

## 3. 记档

- **顺序执行**:对齐 live 计费友好 + 进度可读;并行提交是 §6 的 opt-in,不是本版行为。
- **comfyPatchWorkflow 的 `randomizeSeed` 会引入 `Math.random` 噪声**——测试不断言 seed 字段(其余 patch 字段全断言)。
- **H3 `cancelled`** → `failed`(live 同口径:「任务已取消」)。
- **探活回填路径**:audioExec 的 `measurements` 即②编译 `opts.measured` 的输入——TTS 合成→探活→回填→重编时间轴,构成 P1 缝合不变量的闭环(锚是作者身份,毫秒是编译产物)。

## 4. 排期

本实例 = 清单(本文)+ ports/wiring + 视觉执行器 + 音频执行器 + 导出链 + 全部 mock 时序测试。后续纵深(§6)另起。

## 5. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 210);不碰生产;不 push。

| 套件 | 机器可检门禁 |
|---|---|
| `tests/exec-visual.test.ts` | express 首帧交接(image 产物 → i2v 上传)、CallStep 顺序、H3 submit→poll 终态收集、r2v 白模上传先于 createH3Task(带 fileUri)、依赖失败跳过、假时钟超时、grok skipped——全 mock ports,零网络 |
| `tests/exec-audio.test.ts` | TTS 逐 part + concatWavs 拼杆 + wavDuration 探活回填、SFX 解算(missing 如实)、BGM submit→poll 收集、单 clip 失败不中断 |
| `tests/exec-export.test.ts` | exportProCutWithCuts 线程(cuts/getAudio)、concatExpressClips 线程(urls) |

## 6. 扩展策略

- 并行提交(链元并发)、预算闸门(submit 前确认 estimatedCostFen)、批量编排 UI = 后续纵深;接口已留位(ExecOptions.onProgress / 顺序执行可换波次)。
- 真网络烟测(读 ~/.bashrc 环境键、非 CI)属验收外的运维动作,不在 mock 测试门禁内。
