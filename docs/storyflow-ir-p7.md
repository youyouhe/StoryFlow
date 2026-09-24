# StoryFlowIR P7 —— XML round-trip + R2V 白模资产入 IR

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0–P6)
> 范围(协调侧确认):p1 命名扩展位最后两项——③ StoryFlowXML **反向解析回 IR**(golden round-trip 锁定,③ 成为真互换格式而非单向渲染);R2V 白模资产 **additive 入 IR**(销掉 IR 最后一个数据缺口)。契约侧彻底收口。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P7)

1. **真互换 = 双向保真**:`parseStoryFlowXML(renderStoryFlowXML(ir)) ≡ ir` 与 `renderStoryFlowXML(parseStoryFlowXML(xml)) ≡ xml` 双固定点,由 golden round-trip 测试锁定。
2. **prose-first 不破**:`<script>` 节**零增补**——v0.2 新增内容全部落在声明节(style/refs/spatial/generation/audio 属性);script 仍只装叙事真相(角色 cue + 逐字文本 + 选区/时刻标记)。
3. **v0.1 文档照常可解析**(extension policy「旧文档照常通过」):新节/新属性全为可选,缺省走回退(风格未设定/refs 空/status draft…)。
4. **词锚从散文恢复**:时刻标记 `@{id!}` 的**插入位置**即 wordIndex(渲染时标记插在锚定 token 前;解析时对去标记文本同款分词、数标记前 token)——锚是作者身份,不需要把下标写进 XML。
5. **IR additive**:版本并集(`'0.1.0' | '0.2.0'`,当前 `0.2.0`)+ `Shot.whiteModel?`;旧档 version 0.1.0 原样通过校验。

## 2. StoryFlowXML v0.2 增补清单(additive)

| 增补 | 承载 | 说明 |
|---|---|---|
| root `mode` / `ir-version` | `<storyflow version="0.2.0" mode="pro" ir-version="0.1.0">` | `version` = 语法版本;`ir-version` = IR 文档版本(v0.1 缺省 → '0.1.0') |
| `<style name art-style scene-preset prompt-prefix/>` | StyleRef 四字段 | 全局风格锚 |
| `<refs>` | 注册表五类:`character/prop/scene/style-ref/action`,各带 `<description>` + asset 溯源属性(asset-id/source/source-prompt/version-group/version) | 资产只存 id(P0 惯例) |
| `<spatial>/<layout>` | objects(`position/size/rotation` 逗号三元组)+ characters(facing 弧度) | 坐标宪章原样(米/y-up/弧度) |
| generation shot 属性 | `status/steps`;`<param name value type>`(vendor 袋,显式 string/number/boolean 类型保真);`<first-frame description asset-id>`(text=imagePrompt);`<last-frame asset-id>`(text=description);`<white-model asset-id duration-seconds>`(R2V,可选);`<camera shot-type description focus position look-at>` + `<movement type duration target-seconds>` + `<path>/<look-path>/<point>`(运镜几何,坐标宪章原样) | 生成参数域 |
| audio tts 属性 | `shot-id` / `measured-seconds` / `tts-floor`(锚行携带;缺省按 ceil(measured+0.3) 推导,P4 同规) | 参数留在声明节,不进 script |

**词锚恢复**:渲染把 `@{sfx-002!}` 插在锚定 token 前;解析对去标记文本用 `splitAnchorWords` 数出标记前 token 数 = wordIndex。降级形态(越界→`selection.end`)回解析为 `shot-end`(记档:降级不可逆)。

## 3. IR additive(P0 契约 +2 处)

```typescript
export type IRVersion = '0.1.0' | '0.2.0';   // 并集:旧档照常通过
export const IR_VERSION: IRVersion = '0.2.0';

interface Shot {
  …
  /** R2V 白模参考视频(P7):资产只存库 id,Blob 在 IO 边缘解算;
   *  durationSeconds = 白模时长(r2v 计费/校验口径)。 */
  whiteModel?: { assetId?: string; durationSeconds: number };
}
```

- `whiteModel` 归 **shot 级**(白模按镜头/链录制);执行器的 `deps.whiteModel` Blob 解算不变(id→Blob 属 IO 边缘)。
- P4 提取层无 Screenplay 来源 → 不产出(记档);round-trip 全程携带。

## 4. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `parseStoryFlowXML(xml)` | `src/ir/format/parse.ts` | StoryFlowXML → StoryFlowIR(结构错 → 抛错;调用方可用 validateStoryFlowIR 再验) |
| `readXml(xml)` | `src/ir/format/xmlReader.ts` | 极简 XML 解析(PI/注释/自闭/实体/引号属性)→ 节点树 |
| `renderStoryFlowXML(ir, opts?)` | `src/ir/format/render.ts` | v0.2 渲染(增补见 §2;v0.1 字段/节形状不变) |

## 5. 记档 / 扩展位

- 词锚**降级形态**(越界→selection.end)不可逆为 word(编译产物的有损位,XML 注释已留痕)。
- `dialogue.ttsFloor` 无锚 tts 行且不遵 ceil 公式者 → 回解析取 0/公式值(归一化);锚行携带 `tts-floor` 属性保精确保真。
- 文本含字面 `@{` 被视为标记语法保留字(记档);Dual Text `||` 仍是作者显读分离扩展位。
- 白模的执行消费(① r2v duration 缺省读 IR、P4 提取产出)属命名扩展位;本实例收**数据模型 + round-trip**。

## 6. 排期

本实例 = 清单(本文)+ IR additive(版本并集/whiteModel)+ render v0.2 + xmlReader + parse + round-trip golden + 全部测试。

## 7. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 247);不碰生产;不 push。

- `tests/ir-parse.test.ts`:
  - **双固定点 golden round-trip**(parse(render(银盐晨光)) ≡ 原 IR;render(parse(golden)) ≡ golden)
  - **词锚恢复**(标记位置 → wordIndex 29)
  - **v0.1 兼容**(手制 v0.1 文档 → 回退可解析)
  - whiteModel round-trip(mutation);vendor 袋类型保真(number/string/boolean)
  - 版本并集(0.1.0 档过校验)
- 既有 golden 再生成(v0.2 语法);既有 prose-first/锚解析测试不变(script 节零增补)。
