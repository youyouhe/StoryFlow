# StoryFlowIR P8 —— 对齐服务接线 + 词级字幕 + 手动校时

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0–P7)
> 范围(协调侧确认):p5 命名扩展位三项打包——① WhisperX 类**对齐服务客户端**(ports 绑定形态,可真接端点)② AlignmentTake → **karaoke/逐词字幕 cues**(首个对齐消费者,纯推导)③ **手动校时合并**(纯;校时 = 作者写入,参与 reflow)。词级时间主张全链闭合。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P8)

1. **客户端 = port 的真身**:对齐是 IO 边缘(P5 定调)——`createAlignClient` 实现 `AudioExecPorts.alignTake` 形状,HTTP 强制对齐契约见 §2;`fetchFn` 可注入(测试零网络)。
2. **拒绝而非钳制**:响应 token 数与 `splitAnchorWords(text)` 不符、HTTP 错、非法校时 → 显式抛错,不静默截断/补零。
3. **纯消费者**:karaoke cues 与手动校时合并都是纯函数(从 AlignmentTake 推导/合并),不碰网络/存储。
4. **校时 = 作者写入**(hypit/p2 口径):手动窗口覆盖对齐窗,`confidence: 1`;与文本指纹兼容(不动 `text`,stale 检测照常)——可与 ② 编译组合参与 reflow(`applyManualTiming` 产物直接作 `opts.alignments` 传入)。

## 2. 对齐服务契约(WhisperX 类,强制对齐)

```
POST {endpoint}/align          (multipart/form-data)
  audio: <wav blob>
  text:  <锚基文本全文>
→ 200 application/json:
  { "durationMs": 3400,
    "tokens": [ { "text"?: "的", "startMs": 2600, "endMs": 2680, "confidence": 0.93 }, … ] }
```

- `tokens` 与 `splitAnchorWords(text)` **逐位对齐**(强制对齐语义:服务把声学证据对到给定文本;N:M 归并由服务侧消化——同窗多 token = 共享窗)。
- `durationMs` = 归一化杆长(与 `measured` 双源互证,P5 §3 不变)。
- 客户端产出 `AlignmentTake{text, clipId: '', durationMs, tokens}`(`clipId` 由 `alignAudioClips` runner 权威盖章,P5 口径)。
- 非 2xx / 解析失败 / token 数不符 → 抛错。

## 3. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `createAlignClient(cfg)` | `src/align/client.ts` | `{endpoint, fetchFn?, timeoutMs?}` → `alignTake(blob, text)` |
| `buildWordCues(take)` | `src/align/karaoke.ts` | take → `WordCue[]`(逐词:tokenIndex/作者词形/窗口/confidence;N:M = 同窗多 cue) |
| `placeWordCues(cues, offsetMs)` | 同上 | 平移到段/片时间轴(stemOffset 语义,② timeline 同源) |
| `applyManualTiming(take, corrections)` | `src/align/manual.ts` | `WordTimingCorrection{tokenIndex, startMs, endMs}` 窗口覆盖 + `confidence:1`;越界/非法即抛 |
| `defaultAudioPorts({alignEndpoint?})` | `src/exec/wiring.ts` | P8 起**可选绑定**真客户端(P5 记档兑现);缺省仍不绑 |

**Karaoke 消费语义**:`WordCue{tokenIndex, text, startMs, endMs, confidence?}`——作者词形取 `take.text` 分词(与锚同源),窗/置信取对齐件;低置信词即可视作「手动校时候选集」。

**手动校时语义**:校正表是作者数据;`applyManualTiming` 产出**新** take(不可变合并),被覆盖 token 置 `confidence: 1`;持久化/IR 回写属后续(记档)。

## 4. 记档 / 扩展位

- 校正表持久化(随稿/随 IR)、UI 校时面板、逐词字幕/karaoke 的渲染消费 = 后续(P5a 合成层方向)。
- WhisperX 真部署(16kHz python 服务)运维、多服务 Provider 化(P4 服务三层方向)、流式对齐 = 扩展位。
- N:M 归并策略在**服务侧**(契约要求逐位对齐);客户端不猜。

## 5. 排期

本实例 = 清单(本文)+ 对齐客户端 + wiring 可选绑定 + karaoke 词级 cues + 手动校时合并 + 全部 mock 测试。

## 6. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 254);不碰生产;不 push。

- `tests/align-client.test.ts`:multipart 请求(audio blob + text)/ 响应映射(text 指纹、token 逐位)/ token 数不符即抛 / HTTP 错即抛 / fetchFn 注入零网络。
- `tests/align-karaoke.test.ts`:逐词 cues(作者词形+窗口+置信)/ N:M 同窗多 cue / placeWordCues 平移。
- `tests/align-manual.test.ts`:窗口覆盖 + confidence 1 / 越界与非法窗即抛 / **组合②编译**:校正窗直通 SFX 词锚落点(reflow 参与)。

## 7. 真服务部署与全链 e2e dry-run(StoryFlow#6,2026-09-25)

**WhisperX 类对齐服务已部署本机**(`scripts/align_service.py` + `scripts/align_service.sh`):

- 契约:§2 原文(multipart `audio`+`text` → `{durationMs, tokens[]}`),token 数恒等于 `splitAnchorWords` 分词数,客户端按数校验。
- 后端:CPU 声学对齐(`cpu-vad-valley/1.0`,仅 numpy+stdlib)——wav 解码 → 25ms 帧能量 → 自适应迟滞 VAD → 语音区等比分配(汉字=1 / 拉丁串=0.28×长度)→ 边界吸附能量谷(±120ms,谷深 ≥3dB)。**本机(ThinkPad T430)无 NVIDIA GPU**;派单 GPU 纪律(`CUDA_DEVICE_ORDER=PCI_BUS_ID` + `CUDA_VISIBLE_DEVICES=3`)钉在启动器/进程环境最顶端,未来换 torch/WhisperX 后端零改动即落 GPU 3。
- 端口:127.0.0.1:8788(生产 8950/8940 未触碰,启动器显式拒绝绑定这两口)。

```
bash scripts/align_service.sh start|stop|status|restart|foreground   # 默认 8788
npx esbuild scripts/align-e2e-dryrun.ts --bundle --platform=node \
  --format=esm --outfile=/tmp/align-e2e-dryrun.mjs && node /tmp/align-e2e-dryrun.mjs
```

**全链 e2e dry-run 结果**(提取→编译→执行→对齐→重编译→karaoke,21/21):

- 提取:真 `extractStoryFlowIR`——对白节拍进段、三轨 clip 生成、SFX 反演出 word 锚(wordIndex=2)。
- 执行:TTS/SFX/BGM 确定性 mock(音脉冲 WAV,每 token 一个 burst = 已知真值),探活回填 ② reflow。
- 对齐:真 HTTP(`defaultAudioPorts({alignEndpoint})` 绑定)逐 clip 对齐,token 数逐位一致、durationMs 与探活一致。
- 质量:对齐边界平均误差 **25.9ms**,字素比例回退 99.0ms(**改善 74%**)。
- 重编译:无 ALIGNMENT_UNUSABLE;SFX word 锚落点 = 对齐 token 起点(atMs=644=644)。
- karaoke:逐词 cue(作者词形/窗口/置信)单调在片长内,`placeWordCues` 平移正确。

**hermetic 回归**:`tests/exec-e2e-dryrun.test.ts`(全 mock 一测贯通 extract→compile→bridge→exec→align→karaoke→export cuts,含 token 数不符拒绝路径),vitest 基线 264 → 276,零回退。
