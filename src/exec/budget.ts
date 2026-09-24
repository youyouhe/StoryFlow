/**
 * P6 预算闸门 —— 成本汇总 + 提交前硬拒(docs/storyflow-ir-p6.md §3)。
 *
 * 纯函数:成本数据源 = ① 计划层 `estimatedCostFen`(整数分,P0 规则三),
 * 本层只汇总/判限,不重新计价。超预算 = 零提交硬拒(拒绝而非钳制:不删任务、
 * 不降规格、不截断)。花钱仪式感(hypit 可借鉴 ⑥)在执行器层闭环。
 */
import type { VisualCallPlan } from '../ir/visual/types';

export interface PlanCostReport {
  /** 计划总成本(分,int整数)。 */
  totalCostFen: number;
  /** 逐任务明细(无价目者计 0 并入 unpriced)。 */
  byJob: { jobId: string; shotId: string; estimatedCostFen: number }[];
  /** 无刊例镜像的任务(comfy/grok/生图)——明示防误读,不参与总额。 */
  unpricedJobIds: string[];
}

export const planCostReport = (plan: VisualCallPlan): PlanCostReport => {
  const byJob: PlanCostReport['byJob'] = [];
  const unpricedJobIds: string[] = [];
  let totalCostFen = 0;
  for (const shot of plan.shots) {
    for (const job of shot.jobs) {
      const cost = job.estimatedCostFen;
      byJob.push({ jobId: job.jobId, shotId: job.shotId, estimatedCostFen: cost ?? 0 });
      if (cost == null) unpricedJobIds.push(job.jobId);
      else totalCostFen += cost;
    }
  }
  return { totalCostFen, byJob, unpricedJobIds };
};

export interface BudgetCheck {
  ok: boolean;
  totalCostFen: number;
  /** 缺省 = 无上限(不拦;仪式由调用方)。 */
  budgetFen?: number;
  /** 超限差额(仅 ok=false)。 */
  overByFen?: number;
};

export const checkBudgetGate = (
  plan: VisualCallPlan,
  budgetFen?: number,
): BudgetCheck => {
  const { totalCostFen } = planCostReport(plan);
  if (budgetFen == null) return { ok: true, totalCostFen };
  if (totalCostFen <= budgetFen) return { ok: true, totalCostFen, budgetFen };
  return { ok: false, totalCostFen, budgetFen, overByFen: totalCostFen - budgetFen };
};

/** 硬拒错误:零提交(任何 port 调用之前)。 */
export class BudgetExceededError extends Error {
  readonly totalCostFen: number;
  readonly budgetFen: number;
  readonly overByFen: number;

  constructor(totalCostFen: number, budgetFen: number) {
    super(
      `预算闸门拒绝:计划成本 ${totalCostFen} 分超预算上限 ${budgetFen} 分(超 ${totalCostFen - budgetFen} 分)——零提交,不裁剪不降规格`,
    );
    this.name = 'BudgetExceededError';
    this.totalCostFen = totalCostFen;
    this.budgetFen = budgetFen;
    this.overByFen = totalCostFen - budgetFen;
  }
}
