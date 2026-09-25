# StoryFlowIR P12 —— Dual Text 显读分离

> 版本 v1 · 2026-09-25 · 分支 `ir-schema`(接 P0–P11)
> 范围(协调侧确认):P7/P11 命名扩展位——对白**显读分离**(显示文本 ≠ 朗读文本;短剧字幕/同义改写/注音刚需)。IR `dialogue.display?` additive + `||` 作者断句进字幕编译器(P11 的 `||`-first 兑现)+ XML round-trip 携带。**词级显读 N:M 对齐 = 命名后续**。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P12)

1. **词锚基文本不变**(P0 规则二基石):`anchorTextOf` 仍取 `dialogue.text`(朗读)——TTS/对齐/词窗/SFX 词锚/karaoke 全链不动;`display` 只影响字幕**显示**与断句。
2. **additive minor**:IR 0.2.0 → 0.3.0(版本并集,旧档照常通过);`display` 可选,缺省 = 朗读文本(零回归)。
3. **`||` = 作者断句**:只对 display 有意义(显示侧断句;朗读侧 `||` 为保留字,出现即按字面交 TTS——作者自查);P11 字幕编译器兑现 `||`-first(作者断句 > 句末标点 > 行宽)。
4. **prose-first 保持**:script 的 `<role>` 文本 = **显示文本**(观众面对的散文真相);朗读文本 ≠ 显示时以 `say` 属性携带(词锚时刻标记随 say 属性,见 §3 记档)。

## 2. IR additive

```typescript
export interface ShotDialogue {
  /** 朗读文本(TTS 输入;词锚基文本——P0 规则二不变)。 */
  text: string;
  /** 显示文本(P12 显读分离):字幕展示;`||` = 作者断句边界。
   *  缺省 = text(显读一体)。 */
  display?: string;
  ttsFloor: number;
}
```

## 3. XML 携带(v0.3 内 additive,无节增补)

```xml
<!-- 显读一体(v0.2 形状,不变): -->
<role name="陈默">拍一张证件照,要赶九点的火车。</role>
<!-- 显读分离:say 属性载朗读,文本载显示(|| 作者断句): -->
<role name="陈默" say="拍一张证件照,要赶九点的火车。">证件照,加急。||再来一张半身。</role>
```

- display 缺省或 === text → v0.2 形状(零变化)。
- **词锚时刻标记边界**:SFX 词锚按朗读 token 计——display ≠ spoken 时标记随 `say` 属性(解析从属性文本恢复 wordIndex,同款分词);display = spoken 时标记仍在 role 文本(P7 原路)。记档:该边界属罕见组合(display + 词锚 SFX 同镜头)。

## 4. 字幕编译器升级(`||`-first)

```
逐镜头(display = dialogue.display ?? text):
  display === spoken → P11 原路(词窗 + segmentShot,逐字节回归)
  display ≠ spoken:
    朗读总窗 = 词窗首尾(对齐窗或字素回退,② 同口径)
    display.split('||') → 作者断句片段
      片窗 = 朗读总窗按显示字素权重比例分配
      片内超行宽 → 句末标点/字宽子切(片窗内按字素权重再分配)
  `||` 优先级:作者断句 > 句末标点 > 行宽(P11 承诺兑现)
```

- 显示侧**词级窗口 = 信任作者断句 + 比例分配**(词级 N:M 显读对齐 = 命名后续;朗读侧词窗精度不受影响)。
- 片段超行宽自动子切(确定性);子切与 `||` 均不改朗读文本。

## 5. 记档 / 扩展位

- 词级显读 N:M 对齐(WhisperX 类服务对显示文本强制对齐)= 命名后续;当前显示窗为比例近似。
- 朗读侧含字面 `||` 按字面交 TTS(保留字约束只约束 display,记档)。
- P4 提取无 Screenplay 显读来源 → 不产出(记档);UI 显读编辑器 = 扩展位。

## 6. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 294);不碰生产;不 push。

- `tests/ir-parse.test.ts` 新增:display round-trip(say 属性 + 文本互逆)/ 显读一体零变化回归。
- `tests/captions-compile.test.ts` 新增:`||`-first 断句(作者断句 > 标点)/ 显读分离窗分配(比例)/ 朗读侧词窗与 karaoke 零变化回归 / display 缺省零回归。
- 版本并集 0.3.0(旧档 0.1.0/0.2.0 照常过校验);提取 golden 版本随 IR_VERSION 再生成。
