# StoryFlowIR P10 —— 校时/费率随稿持久化(创作注释层)

> 版本 v1 · 2026-09-25 · 分支 `ir-schema`(接 P0–P9)
> 范围(协调侧确认):P8/P9 命名扩展位打包——**手动校时校正表 + 价目表成为随稿创作注释**(持久化形状 + 载体 + StoryFlowXML round-trip 携带),销掉两处「传入即逝」:P8 手动校时与 P9 精确结算从此可重现(重开项目不丢)。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P10)

1. **注释 ≠ 剧情**:校时窗与费率是**创作注释**(authoring annotations),不进 StoryFlowIR 主体(它们描述「怎么编译/怎么记账」,不是「片子是什么」)——独立文档 `StoryFlowAnnotations`,随稿持久化,可选拨载进 StoryFlowXML。
2. **形状上浮到契约层**:`WordTimingCorrection`(P8)与 `PriceBooks`(P9)是注释的数据契约 → 上浮至 `src/ir/annotations.ts`;align/exec 原 import 点 re-export 兼容(分层方向不变:ir ← align ← exec)。
3. **零回归**:旧调用(不传注释)行为逐字节不变;`parseStoryFlowXML` 签名不变(新 `parseStoryFlowDocument` 返回 `{ir, annotations?}`);v0.2 文档(无注释节)照常解析。
4. **消费即语义**:注释不是死数据——② 编译直接吃 `opts.timing`(校正自动套在对齐件上,reflow 参与),`alignAudioClips` 直接吃校正表(对齐后自动覆盖),价目表直通 P9 计价/结算入口。

## 2. 注释文档契约

```typescript
export const ANNOTATIONS_VERSION = '0.1.0';

export interface StoryFlowAnnotations {
  version: ANNOTATIONS_VERSION;
  /** clipId → 校时窗(作者写入;P8 applyManualTiming 的持久化形态)。 */
  timing: Record<string, WordTimingCorrection[]>;
  /** 随稿费率(P9 PriceBooks,分整数;provider 刊例声明)。 */
  priceBooks?: PriceBooks;
}
```

- 载体 ①:**JSON 侧车**(`serializeAnnotations/parseAnnotations`,parse 过 zod 校验)。
- 载体 ②:**StoryFlowXML v0.3 可选节**(additive,v0.2 文档照常解析):

```xml
<annotations>
  <timing clip-id="aud-tts-001">
    <fix token-index="10" start-ms="2150" end-ms="2230"/>
  </timing>
  <price-books>
    <image per-image-fen="2000"/>
    <tts per-char-fen="2"/>
    <bgm per-request-fen="50"/>
  </price-books>
</annotations>
```

- 渲染侧:`renderStoryFlowXML(ir, {annotations?})`——有则发射,无则零节(v0.2 输出不变)。
- 解析侧:`parseStoryFlowDocument(xml) → {ir, annotations?}`(新入口);`parseStoryFlowXML` 保持 P7 签名(内部委托,丢注释)。

## 3. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `StoryFlowAnnotations` + zod | `src/ir/annotations.ts` | 注释契约(类型 + 校验 + 防漂移) |
| `serializeAnnotations / parseAnnotations` | 同上 | JSON 侧车序列化/解析(parse 过校验,错即抛) |
| `applyTimingCorrections(alignments, timing?)` | `src/align/manual.ts` | 批量套用:逐 clip `applyManualTiming`;非法校正**逐条**进 `invalid` 不中断 |
| `compileAudioPlan(ir, {…, timing?})` | `src/ir/audio/compile.ts` | `opts.timing` 注释自动套用(对齐件先过校正再推导)——持久化校时参与 reflow |
| `alignAudioClips(clipBlobs, plan, deps, {corrections?})` | `src/exec/audioExec.ts` | 对齐后自动套校正(非法进 failures) |
| `renderStoryFlowXML(ir, {annotations?})` / `parseStoryFlowDocument` | `src/ir/format/*` | XML 携带 + 反演 |

## 4. 记档 / 扩展位

- 注释**归属键 = clipId**:P7 round-trip 后 clip id 由 XML `id` 属性原样恢复,注释跨 round-trip 稳定。
- 校正与对齐件的职责边界:对齐件 = 服务测量;校正 = 作者写入(confidence 1)——注释持久化的只是**作者写入**部分,服务产物按需重算(重对齐后校正自动再套用)。
- 费率随稿 ≠ 费率上 IR:价目表挂在注释文档,不污染 StoryFlowIR 主体(剧情/制作意图 vs 记账配置分离)。
- 注释 UI、随稿存储接线(app 侧 localStorage/项目目录)、多套价目档位 = 扩展位。

## 5. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 274);不碰生产;不 push。

- `tests/ir-annotations.test.ts`:注释 zod 校验(非法窗/负费率拒)/ JSON 序列化 round-trip / **XML 携带 round-trip**(render{annotations} → parseStoryFlowDocument → 注释 ≡)/ v0.2 文档(无注释节)解析 annotations 缺省。
- `tests/ir-audio.test.ts` 新增:`opts.timing` 校正自动套用(落点=校正窗,与手工 applyManualTiming 组合等价)。
- `tests/align-manual.test.ts` 新增:`applyTimingCorrections` 批量套用 + 非法逐条隔离。
