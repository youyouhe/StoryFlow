# StoryFlow 语速模型 —— 字幕/TTS 时长与台词语速脱钩(issue #13)

> 版本 v1 · 2026-10-15 · 分支 `sf/13-8`
> 范围:语速模型最小版 —— 基准语速可配置 + 接口可按拍/按句注入;**情绪驱动语速不实现**(另有分析单),只留注入点。

## 1. 常量(唯一出处:`utils/timing/estimate.ts`,不散落魔法数)

| 常量 | 默认 | 含义 |
|---|---|---|
| `DEFAULT_SPEECH_RATE` | **4.5 字/秒**(issue 原值) | 全局基准语速。CJK 每字时长 = 1/语速(≈0.222s/字;2026-10 前是 0.2s/字 = 5 字/秒口径,随基准移动) |
| `BRACKET_RATE_FACTOR` | 0.7 | 行内括注(（低语）/（喘息)内容按 0.7 倍语速折算(更慢);括注符号自身零时长 |
| `SPEECH_MARGIN_SECONDS` | 0.4s | TTS 朗读余量(句尾呼吸/起音延迟) |

标点停顿:句末 0.3s、逗号类 0.1s。拉丁词保持固定启发式(0.12+0.08×音节,钳 [0.12,0.6]s ≈ 3 词/秒)——语速参数是 CJK 字/秒口径(issue 的可读区间按中文字/秒定义),不随语速缩放。

## 2. 估算函数(单一出处)

- `estimateTextSeconds(text, { type?, charsPerSecond? })` —— 朗读估时;旧位置参数 `(text, type)` 保持可用。
- `estimateSpeechSeconds(text, { charsPerSecond? })` —— **TTS 时长估算口径 = 朗读估时 + 0.4s 余量**(issue 修复方向 1)。

消费方(全部读"每句的有效语速",缺省 = 全局基准):

| 消费方 | 用途 |
|---|---|
| `synthesizeEstimatedPlan`(utils/videoPlan.ts) | 手写稿拍长合成(逐拍透传) |
| `resolveShotPlacements`(src/captions/compile.ts) | 字幕/karaoke 词窗 basis 下限(逐镜头) |
| #11 others 分窗(src/captions/compile.ts) | 同拍余句窗(共用同一函数) |

## 3. 合成规则(issue 修复方向 2/3/4)

- **字幕窗 = max(拍长窗, TTS 估算)** —— 宁可越出拍尾也不可读不完。TTS 估算下限只作用于**估算路径**:有探活(`opts.measured`)时真实音频权威(basis = 探活秒,窗不越过实测)。
- **拍长不足警告**:TTS 估算 > 拍长时产出 `SHOT_TOO_SHORT_FOR_TTS`(『拍 X 需 Ns 朗读,拍仅 Ms——视频会中途切词』),经 `compileCaptions` 警告轨透传 IRPipelineModal(现有警告机制,零新增 UI 管道)。
- **过慢侧**:拍长 >> 估算时字幕保持拍窗(留呼吸感)不缩;括注折算只影响估算下限,不缩窄窗。

## 4. 语速注入点(后续情绪驱动在此接线)

| 层级 | 位置 | 粒度 |
|---|---|---|
| 全局基准 | `utils/timing/estimate.ts` `DEFAULT_SPEECH_RATE` | 改常量即全局生效 |
| 按稿/按批 | `CaptionCompileOptions.charsPerSecond` / `KaraokeCompileOptions.charsPerSecond`(src/captions)| 一次编译 |
| 按稿/按拍 | `ExtractOptions.charsPerSecond`(src/extract/screenplayToIR.ts)→ `synthesizeEstimatedPlan` | 一次提取的拍长合成 |
| **按句** | `estimateTextSeconds` / `estimateSpeechSeconds` 的 `opts.charsPerSecond` 参数 | 逐句有效语速 —— 情绪驱动语速的落点:现有 DUB 模式已按句写 `dubEmotion`,后续"情绪→语速"映射在编译调用点逐句传入即可,估算函数无需再改 |
| 设置项(未做) | `AppSettings` + SettingsModal → 接到上面任一入口 | 用户可调全局基准(本任务只交付常量 + 参数链,UI 项为扩展位) |

## 5. 已知边界(记档)

- `estimateTokenSeconds`/`estimateBlockSeconds`(P2a 编辑器词时间轴)接受同一 `charsPerSecond` 可选参,编辑器时间轴目前用缺省基准。
- 字幕窗的估算下限不作用于对齐件窗(对齐 = 真实逐词时刻,天然可读)。
- 拉丁语速不随语速参数缩放(见 §1);双语稿以 CJK 口径为基准。
