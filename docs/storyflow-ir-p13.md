# StoryFlowIR P13 —— 多供应商生图差异化费率(#7 收口)

> 版本 v1 · 2026-09-25 · 分支 `ir-schema`(接 P0–P12;orchestration 派单 StoryFlow#7 的唯一未做增量,协调侧口头指派)
> 范围:P9 记档「多供应商生图混用的差异化费率」——image 价目按 provider(minimax/fal)分册,计价按 job 声明的 provider 解析;费率输入制口径不变(分整数,不编造刊例)。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 语义

1. **provider 上计划**:① `opts.imageProvider?` → `ImageJob.provider?` 烘焙(additive)——计划期的费率假设显式化;运行时实际 provider(`deps.image.provider`)仍可不同,差异属「估算假设 vs 实际」(结算按计划声明口径,记档)。
2. **价目解析优先级**:`books.image.{job.provider}` 分册 > `books.image.perImageFen` 兜底 > unpriced。混合混用时无分册的 provider 落兜底,再无 → unpriced 明示(不猜)。
3. **注释 XML 携带同步**:`<image per-image-fen="20" minimax-per-image-fen="15" fal-per-image-fen="50"/>`——兜底与分册同元素属性,解析按属性在场与否重建(P10 round-trip 兼容:只有兜底属性时形状不变)。
4. 音频(TTS/BGM)无多供应商场景(GLM/fal 单源),不分册(记档)。

## 2. 接口变化(全部 additive)

| 变化 | 处 |
|---|---|
| `ImageJob.provider?: 'minimax' \| 'fal'` | `src/ir/visual/types.ts` + schema/守卫 |
| `VisualCompileOptions.imageProvider?` | `src/ir/visual/compile.ts`(烘培) |
| `PriceBooks.image`: `{ perImageFen?, minimax?{perImageFen}, fal?{perImageFen} }` | `src/ir/annotations.ts`(zod 同步)+ P10 XML 属性携带 |
| `imageJobCostFen` 按 `job.provider` 解析 | `src/exec/pricing.ts` |

## 3. 验收门禁

基线:双端 tsc 0 错 + vitest 302/302 零回退;不碰生产;不 push。

- `tests/exec-pricing.test.ts` 新增:分册解析(fal job × fal 分册 / minimax 兜底 / flat 兜底 / 无价目 unpriced)/ ① 烘 provider / planCostReport 混合混用总额。
- `tests/ir-annotations.test.ts` 新增:差异化价目的 XML 携带 round-trip。
