# CHARACTER 设计图(Reference Sheet)规范

> 版本 v1 · 2026-09-24 · 站长拍板:三视图 turnaround 升级为工业级 Character Sheet
> 代码:`utils/characterSheet.ts`(契约/归一化/审计)· 生成入口:`services/geminiService.ts` `kind === 'character'`
> 回归样例:`docs/examples/yinshan-chenchen.json` 母亲 / 女儿 双 sheet + `tests/characterSheet.test.ts` LU ZHIBAI(陆之白)审计

CHARACTER 块的 `imagePrompt` 是这个角色的**主 ref 设计图**(design sheet):一张图承载全身转面、表情系统、服装细节,后续所有镜头图生图锁定到它。旧版只出「正面 / 侧面 / 背面」三视图 turnaround,信息量不够画表情与手部;现升级为工业级 11 模块 Character Sheet。

---

## 1. 11 个必须模块

| # | 模块 | 输出行标签 | 内容 |
|---|---|---|---|
| 1 | 顶部信息 | `Identity:` | 角色名 / 身份 / 年龄 / 性格关键词(3-5 个)/ 核心主题(1 句) |
| 2 | 配色系统 | `Palette:` | 6-8 个色块(肤色 / 发 / 眼 / 主服装 / 次服装 / 配饰),给具体色名 |
| 3 | **主身份展示** | `Main:` | **最大区域**:正面 / 3-4 侧面 / 背面,标准站姿,带身高比例线,**无道具** |
| 4 | 轮廓剪影 | `Silhouette:` | 正面 + 侧面剪影(比例与主展示一致) |
| 5 | 表情系统 | `Expressions:` | **8 张**:平静 / 好奇 / 紧张 / 惊讶 / 害怕 / 悲伤 / 坚定 / 放松 |
| 6 | 微表情 | `Micro:` | **5 张**细微表情(欲笑未笑、眉心微蹙、抿唇…) |
| 7 | 头部多角度 | `Heads:` | 3/4 侧、仰视、俯视 |
| 8 | 姿态变化 | `Poses:` | 放松 / 紧张 / 自信 |
| 9 | 胸上特写 | `Bust:` | 强情绪胸上特写(表演参考) |
| 10 | 服装细节 | `Costume:` | **4 张**:发型 / 材质 / 配饰 / 鞋 |
| 11 | 手部动作 | `Hands:` | 放松 / 紧张 / 指向 / 抓握 |

**一致性锁(硬性)**:所有画面角色完全一致(脸 / 发型 / 比例 / 服装),禁止风格漂移;**主展示区最大**,其余模块围绕它排布。

## 2. 风格注入(不硬编码)

风格段落从 **StyleHead 动态注入**(`buildCharacterSheetSystemPrompt`),11 模块布局与画风解耦:

- 有 `styleHead.promptPrefix` → `GLOBAL STYLE LOCK` 整段织入,水墨 / 写实 / 动漫 / 漫画 / 油画 / 剪纸均适用;
- 无 styleHead → 模型自行推定**一种**统一画风,并保持全 sheet 一致。

`artStyle` / `scenePreset` 以备注形式附带,用于年代准确的服装 / 道具。

## 3. 输出格式与回写

模型输出**恰好 11 行**标签文本(见上表),`normalizeCharacterSheetPrompt` 落盘前:

1. 只保留 11 个合法标签行(丢弃前言 / markdown / 多余行);
2. 标签统一大小写(`Identity:` / `Palette:` / …);
3. 前置 `Global Style: <styleHead.promptPrefix>`(与 ACTION 六要素路径同一契约);
4. `applySheetFilterSafety` 过滤 content-checker 触发词(intimacy→warmth 等)。

写回处:`useAIExecutor` 的 STORYBOARD 分支(Alt+S / 场景级联)对 CHARACTER 块**只写 `imagePrompt`**(Motion/First/Last 是镜头字段,不进设计图);同名 CHARACTER 块共享同一 sheet。

## 4. refBindings 兼容(主 / 变体分类不变)

设计图只是 `imagePrompt` 文本,不改 RefImage v4 身份模型:

| 站长口径 | 现有模型 | sheet 行为 |
|---|---|---|
| 主 ref | `kind=character`,无 variant | 全新 11 模块 sheet |
| 变体 ref | `kind=character` + `variant`(浴袍 / 战损…) | **VARIANT MODE**:复用已有 sheet 的人(脸 / 发 / 比例不变),只换该变体的服装 / 年龄 |
| PROP | `kind=prop` | 不走 sheet |
| SCENE | `kind=environment`+`sceneKey` | 环境定妆照(六要素,非本规范) |
| 风格 | StyleHead 全局 | 见 §2 |

变体生成时,`variantNote` 会把已有主 sheet 全文喂给模型并要求「只换装,不换人」;ensemble 里其他角色的 sheet 也会作为身份锚附带,保证同一世界感。

## 5. 内容安全

sheet 文本直通文生图模型,其 content checker 对暧昧年龄 / 恋物化着装零容忍。两条防线:

1. **生成时**(system prompt):服装事实化描述(品类 / 颜色 / 面料),成年角色显式标注 ADULT;禁 JK / 制服诱惑类黑话,改写中性时尚表述;禁 intimacy / sensual / seductive / sexy 等触发词。
2. **落盘时**(`applySheetFilterSafety`):确定性替换残留触发词。

## 6. 回归验证

- **LU ZHIBAI(陆之白)**:《银盐晨光》风格下的完整 11 模块样例,`tests/characterSheet.test.ts` 用 `auditCharacterSheet` 逐项断言 —— 必含表情系统 / 头部多角度 / 手部动作 / 主展示区最大 / 一致性 5 个签名;旧三视图样例必须被判为不完整。
- **《银盐晨光》示例文档**:`docs/examples/yinshan-chenchen.json` 的母亲 / 女儿双 sheet 过同一审计,且前缀钉住 styleHead(`tests/yinshanExample.test.ts`)。
- **拆分回归**:「女儿（愣住）："你以前从不喝咖啡。"」→ CHARACTER `女儿（愣住）` + DIALOGUE `你以前从不喝咖啡。`;「母亲（微笑）："但我想记住你现在的样子。"」(DIALOGUE 塞台词)同样拆出母亲 cue 并回填 speaker。

### LU ZHIBAI sheet 样例(节选)

```
Global Style: live-action 35mm film cinematography, shallow depth of field, …
Identity: LU ZHIBAI (陆之白) — adult photo studio owner, 34, keywords: quiet / observant / dry-humoured / protective / meticulous; …
Palette: 8 swatches — warm skin #E8C4A8, ink-black hair #1A1A1A, … silver-halide paper white #F2EFE8.
Main: LARGEST panel — three full-body figures side by side at identical scale (front / three-quarter / back), standard relaxed standing pose, height scale line beside the figures, no props, …; every panel on the sheet keeps the same person (identical face, hairstyle, proportions) with zero style drift.
Silhouette: clean solid front + side full-body silhouettes matching the turnaround proportions exactly.
Expressions: 8 head-and-shoulder studies in a grid — calm / curious / tense / surprised / afraid / sad / determined / relaxed.
Micro: 5 tight facial studies — near-smile twitch, eyebrow micro-furrow, lip press, eye-narrow tell, breath-held stillness.
Heads: 3 extra head studies — three-quarter, low angle looking up, high angle looking down.
Poses: 3 studies — relaxed (weight on one leg), tense (shoulders braced), confident (chin level, hands easy).
Bust: chest-up portrait with a strong restrained grief breaking into warmth.
Costume: 4 close-ups — hairstyle (side-parted black hair), fabric (oatmeal linen weave), accessories (brass watch, camera strap), footwear (worn brown leather shoes).
Hands: 4 studies — relaxed open, tense clenched, pointing, gripping a camera body.
```

---

*实现:Claude Code agent · 2026-09-24 · 任务书 `/tmp/character-sheet-task.txt`*
