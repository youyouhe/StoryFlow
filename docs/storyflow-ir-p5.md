# StoryFlowIR P5 —— 词级对齐升级:对齐件契约与 reflow 语义

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0 契约 / P1 三路编译 / P2 桥映射 / P3 真执行器 / P4 提取层)
> 范围(协调侧确认):**词级对齐升级(WhisperX 级)**——p1 命名升级位,即 hypit 可借鉴 Top5 ①「把『词』当时间轴,把『秒』当导出物」。对齐件(SemanticTake 形状)契约 + ② 时间轴从字素比例切换为**真对齐** + 改词 reflow;**对齐计算属 IO 边缘**(P3 ports 风格,mock 可测)。销掉全链最后一处质量占位。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P5)

1. **锚仍是作者身份,毫秒仍是编译产物**(P0 规则二不变)——对齐件不进 IR:它是 IO 边缘(对齐服务)对**已合成音频**的测量产物,与 `measured` 同为 ② 编译的输入(`opts.alignments`)。
2. **推导优先级**:word 锚 → 对齐窗(有且新鲜)> 字素比例(无对齐/stale 回退)。`shot-start`/`shot-end` 语义不变(镜头内容边界,不随对齐漂移)。
3. **reflow = 重编译 + 新鲜度回退**:对齐件带**锚基文本指纹**(`text`)——改词后指纹不匹配即 stale,② 自动回退字素比例并出 `ALIGNMENT_UNUSABLE` 警告;重新对齐后窗口生效。时间轴永远从当前 IR 状态重推,无需手工重排(hypit「Rewrite a line and the timing re-flows itself」)。
4. **对齐计算 IO 边缘**:服务绑定走 P3 ports 风格(`AudioExecPorts.alignTake`);**未绑定 = 不可对齐**(编译层照常回退)——拒绝而非钳制,真 WhisperX 类接线属 §6 扩展位。
5. AudioMixPlan **minor 升版 0.2.0**(新增输入 + 警告码,additive 路径)。

## 2. 对齐件契约(SemanticTake 形状)

`src/ir/audio/types.ts` 的 `AlignmentTake` —— 对 hypit `SemanticTake`(hypit-study.md §2.4)的逐项映射:

| hypit SemanticTake | StoryFlow `AlignmentTake` | 说明 |
|---|---|---|
| `narrativeId` | (省略) | clip 即最小叙事件 |
| `media: SynchronizedMedia` | `clipId` + `durationMs` | **自含**:杆长随对齐件走(与 measured 互证) |
| `segment{start/endAnchorId, start/endFrame}` | (省略) | clip 边界即 token 窗首末 |
| `tokens[]{tokenId, text, start/endAnchorId, start/endFrame}` | `AlignedToken{tokenIndex, text?, startMs, endMs, confidence?}` | 作者身份 = **tokenIndex**(`splitAnchorWords` 同款下标);N:M 分组 = 多 token 共享窗;`text` = 声学词形 |
| `anchors[]{identity, frame}` | tokenIndex 即身份 | 帧域归一属渲染层;音频编译在**毫秒域** |
| (对齐置信) | `confidence?: 0–1` | 低置信词允许手动校时(hypit「标注低置信词」) |

`AlignmentTake.text` = 对齐所依据的**锚基文本全文**(新鲜度指纹)。

## 3. ②切换规则(word→ms)

```
SfxAnchor.word(wordIndex) 落点(镜头内毫秒):
  对白锚 + opts.alignments[锚clip.id] 存在:
    take.text ≠ 锚基文本 或 take 无该 tokenIndex
        → ALIGNMENT_UNUSABLE 警告,回退字素比例
    否则 → stemOffset(锚clip 在对白拼杆中的起点) + token.startMs
  其余(无对齐/motion 锚)→ 字素比例(② v1 原路,不变)
```

- **stemOffset**:对齐窗是 clip 内相对;镜头内落点 = 拼杆偏移 + 窗起点(多台词拼杆语义不变)。
- 回退是**显式带警告**的(stale/缺 token 都出 `ALIGNMENT_UNUSABLE`),不静默降级。
- `measured` 与 `take.durationMs` 双源互证;不一致以 `measured`(探活实测)为准记档。

## 4. reflow 语义(改词自动重排)

1. 锚基文本变更(改台词/motion)→ `wordIndex` 仍按**新文本**分词(作者身份);
2. 旧对齐件指纹不匹配 → `ALIGNMENT_UNUSABLE` → 字素比例自动接管(时间轴立刻可用);
3. IO 边缘重新对齐(`alignAudioClips` 新 wav + 新文本)→ 新对齐件窗口生效;
4. 全程无手工重排步骤——时间轴是编译产物(P0 规则二的直接收益)。

## 5. ports 边界(P3 风格)

- `AudioExecPorts.alignTake?: (blob, text) => Promise<AlignmentTake>`(可选成员:真服务未绑定=不可对齐)。
- `alignAudioClips(clipBlobs, plan, deps)` → `{takes, failures}`:逐 TTS clip 对齐(单 clip 失败不中断);**未绑定 alignTake 抛错**(拒绝而非钳制)。
- `wiring.defaultAudioPorts()` 不绑 alignTake(真 WhisperX 类服务接线 = 扩展位)。

## 6. 记档 / 扩展位

- motion 锚无对齐件(无音频可对齐)→ 照常字素比例;视频生成后的全片对齐属更远的升级位。
- `ALIGNMENT_UNUSABLE` 一码覆盖 stale 与缺 token 两态(不静默降级是关键,细分码按需 additive)。
- 真对齐服务(WhisperX 类,16kHz 声学证据 ↔ 作者 token N:M)绑定、逐词字幕/karaoke 消费、手动校时回写 = 命名扩展位。
- R2V 白模资产入 IR、XML round-trip 仍是 p1 命名扩展位,不在本实例。

## 7. 排期

本实例 = 清单(本文)+ AlignmentTake 契约(types/schema,minor 0.2.0)+ ② 切换/回退 + reflow 测试 + alignTake port/alignAudioClips + mock 测试。

## 8. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 229);不碰生产;不 push。

- `tests/ir-audio.test.ts` 新增:对齐窗优先(stemOffset+startMs,精确落点)/ stale 指纹回退 + `ALIGNMENT_UNUSABLE` / 缺 token 回退 / **reflow 演示**(改词→重编→字素接管→再对齐→窗口生效)/ 无对齐默认路径零变化(回归锁)。
- `tests/exec-audio.test.ts` 新增:alignAudioClips 逐 clip 调用 mock alignTake(文本逐字传入)、失败隔离、未绑定 port 抛错。
