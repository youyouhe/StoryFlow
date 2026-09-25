/**
 * P6 批量编排 —— 多计划顺序执行 + 总预算记账(docs/storyflow-ir-p6.md §4)。
 *
 * 语义:逐项 try/catch(单项失败不断批);批级 `budgetFen` = 总预算——发起
 * 前查「已花 + 本计划」是否越限,越限该项 `rejected`(不发起;后续更便宜的
 * 计划仍可试,不整批终止);**发起即计**(status ≠ 'rejected' 计全额——提交
 * 即计费,失败不退,H3 刊例如此)。逐项内自带闸门抛 BudgetExceededError →
 * 该项同样归 `rejected`。
 */
import type { BatchItemResult, BatchOptions, BatchRequest, BatchResult } from './types';
import { executeVisualPlan } from './visualExec';
import { planCostReport, BudgetExceededError } from './budget';
import { settleVisualRun, type PriceBooks } from './pricing';

export const executeBatch = async (
  requests: BatchRequest[],
  opts: BatchOptions = {},
): Promise<BatchResult> => {
  const items: BatchItemResult[] = [];
  let spent = 0;

  for (const req of requests) {
    const cost = planCostReport(req.plan).totalCostFen;

    // 批级总预算:越限 → 不发起(rejected)
    if (opts.budgetFen != null && spent + cost > opts.budgetFen) {
      opts.onProgress?.({ id: req.id, phase: 'rejected' });
      items.push({
        id: req.id,
        status: 'rejected',
        chargedCostFen: 0,
        error: `预算闸门拒绝:${spent}+${cost} 分超批级总预算 ${opts.budgetFen} 分——该项未发起`,
      });
      continue;
    }

    // stopOnError:前项失败后余项中止
    if (opts.stopOnError && items.some(i => i.status === 'failed')) {
      items.push({
        id: req.id,
        status: 'failed',
        chargedCostFen: 0,
        error: '前项失败,批量中止(stopOnError)',
      });
      continue;
    }

    opts.onProgress?.({ id: req.id, phase: 'running' });
    try {
      const result = await executeVisualPlan(req.plan, req.deps, req.opts);
      // P9 结算:'attempt'(缺省,P6 发起即计)| 'precise'(按实际产出,
      // succeeded 才计);批级预算闸门仍按计划估算判限(提交前语义不变)。
      const charged = opts.settlement === 'precise'
        ? settleVisualRun(req.plan, result, opts.books).chargedCostFen
        : cost;
      spent += charged;
      // failed/timeout 判失败;skipped(无映射后端/依赖)归 succeeded——细节在 result
      const anyBad = result.results.some(r => r.status === 'failed' || r.status === 'timeout');
      opts.onProgress?.({ id: req.id, phase: anyBad ? 'failed' : 'done' });
      items.push({
        id: req.id,
        status: anyBad ? 'failed' : 'succeeded',
        chargedCostFen: charged,
        result,
        ...(anyBad ? { error: '部分任务未成功(见 result.results)' } : {}),
      });
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        // 逐项自带闸门:未发起,不计费
        opts.onProgress?.({ id: req.id, phase: 'rejected' });
        items.push({ id: req.id, status: 'rejected', chargedCostFen: 0, error: e.message });
        continue;
      }
      spent += cost; // 发起即计(已提交部分照刊例)
      const message = (e && typeof e === 'object' && 'message' in e)
        ? String((e as { message: unknown }).message) : String(e);
      opts.onProgress?.({ id: req.id, phase: 'failed' });
      items.push({ id: req.id, status: 'failed', chargedCostFen: cost, error: message });
    }
  }

  return { items, totalChargedFen: spent };
};
