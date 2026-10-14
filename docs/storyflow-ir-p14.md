# StoryFlowIR P14 —— ASS karaoke + 字幕烧录接线

> 版本 v1 · 2026-09-25 · 分支 `ir-schema`(接 P0–P13)
> 范围(协调侧确认):P8/P11 命名扩展位打包——①**ASS 序列化**(卡拉OK `\k` 逐词着色,直接消费词级窗)②**导出链烧录步**(SRT/ASS → `ffmpeg -vf subtitles`;⚠ 默认 wasm core 无 libass——核心可切/桌面全量 ffmpeg 可用,边界记档)。字幕交付链 IR→词窗→cues→SRT/VTT/ASS→烧录 全链闭合。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P14)

1. **词级时间 = 朗读侧**(P0 规则二延续):karaoke 词窗与 P11 字幕同一来源(对齐窗 > 校正后 > 字素回退),`compileKaraokeLines` 与 `compileCaptions` **共享同一 placement 原语**(抽 `resolveShotSpans`,单一出处);Dual Text 的 display 侧词级 = P12 命名后续。
2. **ASS karaoke 时基**:`\k` 单位 = **厘秒**(1/100s);词 i 的 `\k` = `start_{i+1} − start_i`(词间空隙折入前词高亮),末词 = `lineEnd − start_last`(钳 ≥0)。
3. **烧录步边界记档**:默认 ffmpeg.wasm core **无 libass**(`subtitles` 滤镜不可用)——烧录 port 为**可选绑定**(缺省不绑),桌面全量 ffmpeg/自管 worker 核心可切时才可用;绑定 = 扩展位。参数构造(`subtitlesFilterArgs`)为纯函数可测。
4. **不碰生产**:烧录实现属 app/桌面壳侧(ffmpeg.wasm 加载壳 videoExport 已有,新步不重复加载器),本层只锁 port 形状 + 参数构造。

## 2. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `compileKaraokeLines(ir, opts?)` | `src/captions/karaoke.ts` | 逐镜头词窗(同②口径:对齐>校正后>字素回退;拼杆+镜头偏移→片内绝对)→ `KaraokeLine[]{words[{text,startMs,endMs}], startMs, endMs, character?, shotId}`(行分组 = 词宽预算,maxChars 同 P11) |
| `toAssKaraoke(lines, opts?)` | `src/captions/serialize.ts` | ASS 文本:`[Script Info]/[V4+ Styles]/[Events]`,Dialogue 逐词 `{\kN}`;说话人入 Name 字段;`{playResX?, playResY?, font?}` |
| `toAss(track, opts?)` | 同上 | 普通字幕 Dialogue(无 `\k`,P11 CaptionTrack 直转) |
| `subtitlesFilterArgs(path, opts?)` | `src/exec/exportExec.ts` | 纯构造 `-vf subtitles=...` 参数串(`force_style` 可选) |
| `burnSubtitlesInto(video, subtitles, deps, opts?)` | 同上 | 烧录执行步(port 可选绑定;未绑定即抛——拒绝而非钳制) |

## 3. 记档 / 扩展位

- karaoke 行文本为**词形拼接**(无标点——分词不含标点;标点保真的 ASS 行 = 扩展位,P11 的字符→词窗映射可复用);词间连接:CJK 直连、ASCII 词间补空格。
- ASS 样式(字体/配色/逐词高亮色 `SecondaryColour→PrimaryColour`)v1 用缺省 Style,样式参数化 = 扩展位;双行/每语言多轨 = 扩展位。
- 烧录的账单口径:烧录为本地计算,零远端消耗(P0 规则三无关);桌面/Tauri 全量 ffmpeg 绑定 = 扩展位。

## 4. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 307);不碰生产;不 push。

- `tests/captions-karaoke.test.ts`:片内绝对词窗(对齐优先/校正直通/字素回退)/ 行分组(词宽预算)/ ASS karaoke `\k` 厘秒逐词 + 说话人 Name 字段 / toAss 普通轨 / 空轨。
- `tests/exec-export.test.ts` 新增:subtitlesFilterArgs 纯构造(force_style)/ burnSubtitlesInto 线程 + 未绑定 port 即抛。
- 回归锁:P11 字幕测试逐字节不变(placement 抽取共用后)。
