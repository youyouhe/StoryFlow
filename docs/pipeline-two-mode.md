# 双模式流水线设计:Express(简洁)/ Pro(专业)

> 版本 v1 · 2026-09-24 · 站长拍板方案的实施蓝图
> 结论先行:Express = imagePrompt → 首帧 → I2V → 逐镜头抽卡 → ffmpeg 顺序拼接;Pro = 导演全流程(参考系 + SHOT_LIST + 一致性 + TTS 定时长 + 混音)。

## 0. 模式开关(项目级)

- 载体:**已有** `Screenplay.productionMode: 'simple' | 'cinematic'`,随剧本持久化、随导出迁移 —— 不新增字段,语义升级:
  - `simple` = **Express**:不需要 graybox/白模/TTS/BGM;`segmentGrayboxes`、`sequences` 在此模式下不参与生成。
  - `cinematic` = **Pro**:现有导演全流程(graybox→白模→VIDEO_PLAN→H3/ComfyUI)之上,叠加本设计的 TTS/BGM/SFX 音轨。
- 入口:①顶栏徽章「简易/专业」(已有,保留);②Settings → 剧本 tab 增加显式选择器(带模式说明)。二者写同一字段。
- 模式只影响**生成侧**:已有数据不删——切回 Pro 后 graybox 等数据仍在。

## 1. 数据流

### 模式 A:Express(抽卡流水线)

```
可生成 block(有 imagePrompt 的 SCENE_HEADING / ACTION / CHARACTER)
  → 首帧:generateImages(imageProvider, imagePrompt+styleHead)   [现有]
      存 block.imageResult(assetId)+ 工作台内预览
  → I2V:comfyPatchWorkflow(comfyWorkflowI2V, { prompt: imagePrompt 派生,
      firstFrameName: 上传的首帧, durationSeconds, randomizeSeed })
      → comfyQueuePrompt → comfyQueryTask 轮询 → videoUrl       [现有]
  → 逐镜头抽卡工作台(新 ExpressWorkbench modal):
      每镜头一行:缩略图 / 视频预览 / 生成 / 重roll(重新排队,新种子) /
      锁定🔒(锁定后 export 用锁定版本;重roll 不覆盖锁定镜头,需先解锁)
  → 导出:ffmpeg 顺序拼接(锁定或最新保留版本,按剧本顺序)
```

- 数据模型(新增,存 Screenplay,随导出迁移):
  ```ts
  expressShots?: Record<blockId, {
    imageUrl?: string;        // 首帧 URL(object URL 为会话级,持久层只存 ComfyUI/资产 URL)
    imageAssetId?: string;    // 首帧入库(资产库)引用,重载可恢复
    videoUrl?: string;        // ComfyUI /view URL
    videoPromptId?: string;   // 最近一次 I2V 任务
    status: 'idle'|'imaging'|'image-ready'|'generating'|'video-ready'|'failed';
    error?: string;
    locked?: boolean;
    updatedAt?: number;
  }>;
  ```
- I2V 任务复用现有轮询(h3Tasks,backend:'comfy')或工作台内自轮询;v1 选**工作台内自轮询**(模态生命周期内),不写入 `h3_tasks`(避免污染正式任务列表)。
- 拼接顺序 = `screenplay.blocks` 中可生成 block 的出现顺序(跳过无 imagePrompt/未生成的镜头,缺失镜头在导出面板标记)。

### 模式 B:Pro(导演全流程,增量部分)

已有骨架 = 参考系与一致性检查的底座,映射如下:

| Pro 概念 | 现有实现 |
|---|---|
| 五类 ref 注册表 | RefImage v4 身份模型(kind: character/environment/prop/action + sceneKey/variant/版本组;第五类=风格 StyleHead,全局生效) |
| SHOT_LIST | `planVideoSegments()` 的 VideoPlan + `segmentGrayboxes`(段级一镜到底) |
| 一致性校验 | `planPreflight`(resolveSegmentRefs:bound/missing/offScreen/sceneEnv)+ grayboxHealth |
| 定时长 | **新增** TTS 时长拟合(见 §3) |
| 混音 | **新增** 音轨装配(见 §4) |

Pro 新增数据流:

```
SHOT_LIST(VideoPlan)每段:
  对白轨:TTS(逐句,角色→音色)→ wav 24kHz → 时长探测
  音乐轨:BGM(fal sonilo text-to-music,prompt ← scenePreset 情绪)→ result_url
  音效轨:SFX 标记(manifest 匹配,缺失标 SFX_MISSING)
  → 时长拟合:段 outputSeconds ≥ ceil(ΣTTS 时长)(TTS 为下限,见 §3)
  → 混音计划(混音在导出阶段执行,见 §5)
```

新增(存 Screenplay):
```ts
voiceCast?: Record<charName, string>;   // 角色→音色(系统音色枚举)
proAudio?: Record<segmentKey, {         // segmentKey = 段首 blockId
  tts?: { line: string; url: string; seconds: number }[];
  bgm?: { url: string; prompt: string };
  sfx?: { name: string; at?: number; missing?: boolean }[];
}>;
```

## 2. 云适配器接口

### 2.1 TTS = GLM-TTS(`services/glmTtsService.ts`)

```
POST https://open.bigmodel.cn/paas/v4/audio/speech
Authorization: Bearer GLM_TTS_API_KEY
{ model: 'glm-tts', input, voice, speed, volume, response_format: 'wav', watermark_enabled }
→ wav(24kHz)
```

- `input ≤ 1024 字`:超长台词按标点切分(`。!?;,、…`)分段合成,客户端 **wav 顺序拼接**(同参数同音色,PCM 直拼 + 修 header),失败段重试一次。
- 系统音色枚举:`tongtong / chuichui / xiaochen / jam / kazi / douji / luodo`(导出 `GLM_VOICES` 常量);**复刻音色**:接口预留 `voice` 透传自定义 id,v1 不做 UI。
- `speed`(0.6–2)、`volume`(0.1–3?以官方文档为准,UI 给 0.5–2 档)、`watermark_enabled` 默认 true(可配)。
- 角色映射:`screenplay.voiceCast`,默认无映射的台词用 `tongtong`。
- **密钥**:`GLM_TTS_API_KEY` 走 `.env.local`,vite define 注入;Settings 不落盘、不回显。FAL 沿用现有 `appSettings.falKey`(BYOK)。
- 时长探测:wav 头 `data` chunk 长度 / byteRate,纯客户端零解码。

### 2.2 BGM = fal 队列(`services/falMusicService.ts`)

```
POST https://queue.fal.run/sonilo/v1.1/text-to-music   (Authorization: Key $FAL_KEY)
{ prompt }   → { request_id }
GET  https://queue.fal.run/sonilo/v1.1/text-to-music/{request_id}/status
GET  …/{request_id}                                      → result_url(audio)
```

- prompt 生成:`scenePreset`(StyleHead)+ 段场景情绪模板 → 英文一句话(如 "gentle guzheng, misty dawn, xianxia mood, ambient bed")。每场景只生成一次,缓存 `proAudio[sceneKey].bgm`。

### 2.3 SFX = 内置小库(`public/sfx/` + `services/sfxService.ts`)

- `public/sfx/manifest.json`:名称→文件/情绪标签。v1 附 3 个合成占位 wav(whoosh/ding/impact,可被同名精选文件直接替换)。
- 匹配:SHOT/段标记(如 `[SFX:whoosh]`)或情绪关键词;**找不到 → `SFX_MISSING` 标记**显示在工作台/导出面板,不接 AI。

## 3. 时长拟合规则(TTS 为镜头时长下限)

1. 段内每句对白 → TTS 时长 `d_i`(合成后探测)。
2. 段音频下限 `L = ceil(Σ d_i + 0.3s 呼吸)`(对白顺序播放)。
3. 提交/规划钳制:`outputSeconds = clamp(max(模型下限, min(窗口, L_raw)), 4, 15)`;若 `L > 窗口`,**拆段警告**(与现有 chain 拆分一致:对该段标记 `AUDIO_TOO_LONG`,建议拆或加速)。
4. Express 模式不适用(无 TTS);Pro 的 graybox `targetSeconds` 拟合:显示 `L` 与当前时长的对比,由用户确认加速/延长。

## 4. 混音计划(v1)

- 每段产出 `mixPlan`: `{ video, tts:[{file,gain:1.0}], bgm:{file,gain:0.25,loop}, sfx:[{file,at,gain:0.8}] }`。
- v1 执行:ffmpeg `-filter_complex amix` 每段先混音成 `seg_i.mp4`(video+audio),再 concat。BGM 覆盖全段循环,TTS 顺序对齐到段首,SFX 按标记偏移。
- 无音轨的段:静音轨占位(concat 需要统一流结构)。

## 5. ffmpeg 导出(`services/videoExport.ts`)

- **方案**:ffmpeg.wasm(@ffmpeg/ffmpeg,点击时动态 import;core 从 CDN 取)。
  - Tauri CSP 已放开(connect-src https:)✓;离线/加载失败 → **回退**:下载 clips + `concat_list.txt`(ffmpeg 文档格式)+ 使用说明。
  - 模式 A(顺序拼接):
    ```
    concat demuxer:file 'shot_01.mp4' …  → -c copy(同参数流直拼)
    参数不一致时回退重编码:-f concat -i list -c:v libx264 -preset veryfast
    ```
  - 模式 B:每段先混音(§4)→ concat。进度按段回调(工作台进度条)。
- 产物:`storyflow-express-YYYYMMDD.mp4`。

## 6. UI 入口

| 入口 | 位置 | 条件 |
|---|---|---|
| 抽卡工作台 | Toolbar 右侧新增「🎬 抽卡」按钮 | `productionMode === 'simple'` |
| Pro 音轨面板 | 现有 VIDEO_PLAN modal 内新增「音轨」分区(TTS/BGM/SFX 状态) | `productionMode === 'cinematic'` |
| 导出 | 工作台内「导出成片」(Express)/ Plan modal「导出」(Pro) | 同上 |

## 7. 实施顺序与提交切分

1. 本文档
2. 模式开关:Settings 剧本 tab 选择器 + 类型注释升级(语义化 Express/Pro)
3. Express:types(expressShots)+ ExpressWorkbench(首帧生成→I2V→预览/重roll/锁定)
4. Pro:glmTtsService + falMusicService + sfxService + 时长拟合工具 + Plan modal 音轨分区
5. ffmpeg 导出:videoExport(Express 顺序拼接;Pro 混音后拼接)

## 8. 风险与边界

- ffmpeg.wasm 首次加载 ~25MB(CDN)——按钮上注明;失败回退 concat_list.txt。
- ComfyUI /view URL 会话级:工作台提示「导出前请在同一 ComfyUI 会话内完成」;锁定镜头的持久化靠 URL 重放(v1),后续可转存资产库。
- GLM-TTS `speed/volume` 官方档位以控制台文档为准,UI 先给 0.5–2 连续值。
- 密钥:GLM 走构建期注入(与 GEMINI_API_KEY 同机制,注意构建产物含 key 的问题与既有机制一致,文档已知);FAL 走 BYOK 设置。

---
*设计:Claude Code agent · 2026-09-24*
