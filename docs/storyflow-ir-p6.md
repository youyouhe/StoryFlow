# StoryFlowIR P6 —— 预算闸门 + 批量编排 + 并行提交

> 版本 v1 · 2026-09-24 · 分支 `ir-schema`(接 P0–P5)
> 范围(协调侧确认):p2 §6 明文纵深的最后一块——submit 前 `estimatedCostFen` 汇总/预算上限拒绝(**花钱仪式感**,hypit 可借鉴 ⑥:plan/pricing 三读 + BRIEF 预算协议)、多计划批量编排、链元并发 opt-in(P3 `ExecOptions` 留位兑现)。让 P3 执行器可安全投产。
> 门禁:tsc strict + vitest 零回退;不碰生产;不 push。

## 1. 边界总则(P6)

1. **预算在执行器层闭环**:成本数据源 = ① 计划层 `estimatedCostFen`(整数分,P0 规则三);本层只做**汇总、闸门、批量记账**——不重新计价。
2. **拒绝而非钳制**:超预算 = **零提交硬拒**(`BudgetExceededError`),不删任务、不降规格、不静默截断。
3. **发起即计**:批量记账按「计划一经发起即计全额」累计(提交即计费,失败不退——H3 按任务刊例)。仅**被拒**(未发起)不计。
4. **并行是 opt-in**:`concurrency` 缺省 1 = 严格顺序(与 live「Sequential — H3 bills per task」逐字一致,零行为变化);>1 按**依赖波次**并发(同波 = 无依赖互斥的链元/镜头,`needs` 恒先满足)。
5. **计价范围记档**:仅 minimax 视频任务有刊例镜像(① cost.ts);comfy/grok/生图/TTS/BGM 无价目 → 计入 `unpricedJobIds` 明示,不参与总额(音频价目、图价目 = 扩展位)。

## 2. 接口清单

| 入口 | 模块 | 说明 |
|---|---|---|
| `planCostReport(plan)` | `src/exec/budget.ts` | 纯汇总:`{totalCostFen, byJob[], unpricedJobIds[]}` |
| `checkBudgetGate(plan, budgetFen?)` | 同上 | `{ok, totalCostFen, budgetFen?, overByFen?}`;`budgetFen` 缺省 = 无上限(不拦,仪式由调用方) |
| `BudgetExceededError` | 同上 | 带 `totalCostFen/budgetFen` 的硬拒错误 |
| `executeVisualPlan(plan, deps, opts)` | `src/exec/visualExec.ts` | `opts.budgetFen` 非空时**先闸后发**(超限抛 `BudgetExceededError`,零 port 调用);`opts.concurrency` 波次并发 |
| `executeBatch(requests, opts)` | `src/exec/batchExec.ts` | 多计划顺序编排 + 总预算记账 + 逐项结果 |

## 3. 预算闸门语义

```
planCostReport: totalCostFen = Σ job.estimatedCostFen(缺省 0);
                unpricedJobIds = 无 estimatedCostFen 的任务(明示防误读)
checkBudgetGate: budgetFen 缺省 → ok(无上限);
                 totalCostFen > budgetFen → {ok:false, overByFen: 差额}
executeVisualPlan: opts.budgetFen 非空 → 先 checkBudgetGate,
                   !ok → throw BudgetExceededError(**零提交**)
```

- 闸门在**任何** port 调用之前(连 upload 都不发生)——「花钱前三读」的最后一读。
- 闸门粒度 = 整计划(计划要么整发要么不发);逐任务裁剪违背规则 2。

## 4. 批量编排语义

```
executeBatch(requests, {budgetFen?, stopOnError?}):
  顺序逐 request:
    cost = planCostReport(req.plan).totalCostFen
    budgetFen 非空 且 spent+cost > budgetFen
        → {status:'rejected'}(不发起;后续更便宜的计划仍可试——不整批终止)
        → 执行 executeVisualPlan(逐项 try/catch)
    status: 'succeeded'(全 job 成功)| 'failed'(有失败/抛错)| 'rejected'(预算拒)
    发起即计:status ≠ 'rejected' → spent += cost
  stopOnError:true → 首个 failed 后余项 skipped(记 status:'failed', error:'前项失败,批量中止')
```

- 逐项 `opts` 独立(可带各自的 `concurrency/budgetFen/whiteModelRef/…`);批级 `budgetFen` = **总预算**。
- 逐项内抛 `BudgetExceededError`(逐项自带闸)→ 该项 `rejected`,批量继续。

## 5. 并发模型(链元并发 opt-in)

- `opts.concurrency: n`(缺省 1):>1 时按 **needs 依赖波次**执行——`level(step) = 1 + max(level(needs))`,同波互不依赖(= 同镜头 chain 链元、不同镜头),波内 `Promise.all` 分块(n 为上限);波间严格先后(首帧交接 image→i2v 天然分波)。
- `concurrency === 1` 走原顺序循环(**逐字节同行为**,回归锁)。
- 结果组装序不变(`planCallSequence` 序);轮询/超时/失败语义不变。

## 6. 记档 / 扩展位

- 音频(TTS/BGM)与生图无刊例镜像——`unpricedJobIds` 明示;图/音频价目表 = 扩展位(P0 规则三已备:分整数)。
- 批级预算「发起即计」不因失败退款(H3 刊例如此);精确按成功任务结算 = 扩展位。
- 逐任务/逐镜头预算粒度、实时花费累计(轮询中任务的中途取消结算)、批量 UI = 扩展位。

## 7. 排期

本实例 = 清单(本文)+ budget 纯模块 + 执行器闸门/并发 + batchExec + 全部 mock 测试。

## 8. 验收门禁

基线(共有):`npm run typecheck:ir` 0 错 + `npm run typecheck` 0 错 + `npx vitest run` 零回退(基线 237);不碰生产;不 push。

- `tests/exec-budget.test.ts`:成本汇总(银盐晨光 = 300 分 + unpriced 明示)/ 闸门边界 / **超预算零提交**(全部 mock port 零调用)/ 无上限不拦。
- `tests/exec-visual.test.ts` 新增:concurrency=1 回归锁(顺序不变)+ 波次并发实证(延迟 mock 下同波任务同时在飞、needs 恒先满足)。
- `tests/exec-batch.test.ts`:总预算下第二计划 rejected(第一计划照跑)/ 发起即计记账 / stopOnError 中止 / 逐项 BudgetExceededError 归 rejected 不断批。
