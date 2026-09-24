# StoryFlowIR P11 —— 字幕轨编译器(合成层纯侧)

> 版本 v1 · 2026-09-25 · 分支 `ir-schema`(接 P0–P10)
> 范围(协调侧确认):P8 明指的后续方向(合成层**纯侧**)——WordCues/词窗 → **字幕条 cues**(断句/分组)→ **SRT/VTT 序列化**(外挂字幕产物,可直接 `ffmpeg -vf subtitles` 烧录)。卡拉OK词窗 → 可交付字幕文件的最后一环;渲染消费(UI/合成器)= 后续。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P11)

1. **纯函数**:IR + 对齐件/校正(同②输入口径)→ 字幕轨 → 序列化文本。零 IO;费率无关。
2. **对齐优先,字素兜底**(P5 哲学延续):词窗 = 对齐件(新鲜)→ 字素比例(回退);校正(`opts.timing`)先套后分——P8/P10 的校时结论直通字幕。
3. **字幕只字幕「话」**:无对白镜头不产字幕(motion 是画面叙述不是台词,记档);多台词镜头 = 拼杆序多条字幕(P8 拼杆语义同源)。
4. **片内绝对时基**:词窗(clip 相对)→ 拼杆偏移 → 镜头偏移(前序镜头时长累计)→ 片内绝对。分层换算全部确定性纯函数。
5. **断句规则(v1,确定性)**:句末标点(`。!?…;`+随行闭引号)收口 > 行宽上限(`maxCharsPerCaption`,缺省 16 CJK 字符)token 边界强制收口。`||` 作者断句优先规则待 Dual Text 落地(P7 命名扩展位,P12 候选)。
6. **最短可读时长**只警告不自动合并(确定性优先于聪明;`minCaptionMs` 缺省 600ms)。

## 2. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `compileCaptions(ir, opts?)` | `src/captions/compile.ts` | `CaptionTrack{captions[{index,text,startMs,endMs,character?,shotId}], warnings[]}`;opts:`{alignments?, timing?, measured?, maxCharsPerCaption?, minCaptionMs?, speakerPrefix?}` |
| `toSrt(track)` / `toVtt(track)` | `src/captions/serialize.ts` | 外挂字幕序列化(SRT:`HH:MM:SS,mmm` + CRLF;VTT:`WEBVTT` 头 + `.` 毫秒) |

**词窗来源(逐镜头)**:锚 clip(text 逐字 = dialogue.text)的对齐件 token 窗 → 字素比例回退(`splitAnchorWords` + `wordStartMs`,basis = 探活秒 ?? `fit.wantSeconds`);拼杆偏移(② 同口径)→ 镜头偏移 → 片内绝对。`opts.timing` 校正先套(P10 闭环)。

**断句实现**:原文逐字符映射 token 窗(标点/空白随**前**词窗);句末标点(+随行闭引号)收口;行宽超限在 token 边界强制收口;字幕文本 = 原文切片(trim)——**标点保留在显示文本**(分词不含标点只影响窗口归属)。

## 3. 记档 / 扩展位

- `||` 作者断句优先 = P12 候选(依赖 Dual Text 显读分离落地,IR 对白需断句字段)。
- 双行字幕、每语言多轨、ASS 样式(卡拉OK逐词着色)、字幕烧录执行器接线(`ffmpeg -vf subtitles`)、UI 字幕面板 = 扩展位。
- 无对白镜头不产字幕是有意行为(旁白/标题字幕属另一轨道概念,不在本层)。

## 4. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 283);不碰生产;不 push。

- `tests/captions-compile.test.ts`:句末标点断句 / 行宽强制收口 / 片内绝对时基跨镜头 / 对齐窗优先 + 校正直通 / 字素回退(无对齐件)/ 无对白镜头零字幕 / 多台词拼杆序 / 最短时长警告。
- `tests/captions-serialize.test.ts`:SRT 格式(序号/逗号毫秒/CRLF)/ VTT 格式(WEBVTT 头/点毫秒)/ 空轨。
