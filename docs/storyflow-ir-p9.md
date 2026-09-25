# StoryFlowIR P9 —— 图/音频价目与精确结算

> 版本 v1 · 2026-09-25 · 分支 `ir-schema`(接 P0–P8;orchestration 派单 StoryFlow#7 / issue #7,task_ab2d17094625)
> 范围(派单原文):IR 价目:图片/音频条目计价,**销掉 unpriced 明示项**;**精确结算按实际用量而非估算**。扩展 P6 预算/批量层,保持 typecheck+vitest 全绿,commit 不 push。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P9)

1. **费率输入制,口径本层定**(hypit pricing 口径「读供应商费率」):价目表 `PriceBooks` 由调用方按 provider 刊例声明(**分整数**,P0 规则三);本层只实现**计价口径**(按张/按字符/按次)与汇总——**不编造刊例数值**,无价目 = 回退 unpriced 明示。
2. **精确结算 = 按实际产出**:结算以运行结果为准——`succeeded` 计费,`failed/timeout/skipped` 不计(远端账单为准,本层是结算口径;与 P6「发起即计」的保守估算并存,`settlement` 选项切换,缺省保持 P6 行为零回归)。
3. **SFX = 已知零价**(本地 manifest,非 unpriced):计价明细里显式 0,不进 unpriced。
4. **扩展 P6 层**:`planCostReport` 加价目表参数(旧签名兼容);`executeBatch` 加 `settlement: 'attempt' | 'precise'`(缺省 attempt = P6 行为逐字节回归);批级预算闸门语义不变(提交前仍按计划估算判限)。

## 2. 价目表与计价口径

```typescript
export interface PriceBooks {
  /** 生图:每张(每 image job 一张,① opts.n=1 口径)。 */
  image?: { perImageFen: number };
  /** TTS:每字符(按实际合成文本用量,TtsJob.text 的 UTF-16 码元数)。 */
  tts?: { perCharFen: number };
  /** BGM:每次请求(每床一条)。 */
  bgm?: { perRequestFen: number };
}
```

| 条目 | 口径 | 无价目时 |
|---|---|---|
| minimax 视频 job | ① baked `estimatedCostFen`(刊例镜像,P1) | ——(恒有) |
| image job | `books.image.perImageFen` × 1 | unpriced |
| comfy/grok 视频 job | 无刊例镜像 | unpriced(记档) |
| TTS clip | `books.tts.perCharFen` × `text.length` | unpriced |
| BGM clip | `books.bgm.perRequestFen` × 1 | unpriced |
| SFX clip | 0(本地 manifest 免费,已知价) | ——(恒有,显式 0) |

## 3. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `planCostReport(plan, books?)` | `src/exec/budget.ts` | 加价目表参数:image job 入价;`unpricedJobIds` 相应收窄;旧调用兼容 |
| `audioCostReport(plan, books?)` | `src/exec/pricing.ts` | `AudioMixPlan` 三轨计价:`{totalCostFen, byClip[{clipId, kind, costFen, priced}], unpricedClipIds}` |
| `settleVisualRun(plan, result, books?)` | 同上 | **精确结算**:按 `VisualRunResult` 实际产出计费(succeeded 才计);`{chargedCostFen, settled[], unpricedJobIds}` |
| `settleAudioRun(plan, run, books?)` | 同上 | 按实际用量:TTS 只计实际合成 clip(`clipBlobs` 在场),BGM 只计拿到 URL 的床 |
| `executeBatch(requests, {settlement?})` | `src/exec/batchExec.ts` | `'attempt'`(缺省,P6 发起即计)| `'precise'`(P9 逐 job 实际产出);批级预算闸门不变 |

## 4. 记档 / 扩展位

- **timeout 不计**的口径:轮询超时任务远端可能仍完成并计费——本层按「未收到产出不计」,以供应商账单为准对账(记档)。
- comfy/grok 视频仍 unpriced(无刊例镜像);自托管 GPU 边际成本 ≈0 属业务判断,不代填。
- TTS 字符口径 = `text.length`(UTF-16 码元;CJK 等价字符数);分包(`parts`)不改总量。
- 多供应商生图混用的差异化费率、UI 价目面板 = 扩展位;**随稿费率持久化已落**(P10 创作注释层 → storyflow-ir-p10.md)。

## 5. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 264);不碰生产;不 push。

- `tests/exec-pricing.test.ts`:图/音频条目计价(books 输入制)/ **unpriced 收窄断言**(image 入价后 unpriced 只剩 comfy/grok;SFX 恒 0 非 unpriced)/ audioCostReport 三轨 / **精确结算**(succeeded 才计;SHOT_003 失败 → 视觉 0)/ settleAudioRun 实际用量(未合成 clip 不计)。
- `tests/exec-batch.test.ts` 新增:precise 模式(失败计划只计 succeeded 任务)与 attempt 缺省回归锁。
