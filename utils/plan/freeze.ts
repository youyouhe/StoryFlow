/**
 * Frozen plan — the pre-submit read-only gate (P3 of
 * docs/storyflow-adoption-plan.md).
 *
 * Before any paid request leaves the machine, the whole intention freezes
 * into one immutable plan: every external call with its parameters and price
 * estimate, every demand already satisfied by an explicit Candidate (those
 * send NO request), and every price honestly marked unknown when the rate is
 * not in the price book. Pure and synchronous — zero external requests — so
 * the confirm dialog, the tests and the exported plan JSON all see the same
 * frozen truth.
 *
 * Demand naming convention (the logical outputs a run demands):
 *   video.<blockId>          one video for a block
 *   video.<blockId>.<n>      chain part n of a multi-segment generation
 *   image.<blockId>          one image for a block
 * A Candidate satisfies a demand BY NAME through a run file's satisfactions.
 */
import type { RunCandidate, RunSatisfaction } from '../../services/project/files';
import {
  estimateFalImagePrice,
  estimateLocalVideoPrice,
  estimateMinimaxImagePrice,
  estimateVideoPrice,
  type PriceEstimate,
} from './pricing';

export interface PlanDemand {
  /** Logical output name (see convention above) — the reuse address. */
  name: string;
  kind: 'video' | 'image';
  blockId: string;
  /** Which service fulfills it ('minimax-h3' | 'comfy:r2v' | 'fal:gpt-image' | …). */
  service: string;
  /** Exact request parameters for the read-only view. */
  params: Record<string, string | number | boolean>;
  prompt?: string;
  // cost inputs (video)
  videoSeconds?: number;
  outputSeconds?: number;
  imageCount?: number;
  resolution?: string;
  model?: string;
  // cost inputs (image)
  imageSize?: string;
  imageQuality?: string;
}

export interface SatisfiedBy {
  candidateId: string;
  /** Human-readable source: "run-…#video.b1" or a file path. */
  source: string;
  fromRun?: string;
  output?: string;
  file?: string;
}

export interface FrozenRow {
  demand: PlanDemand;
  estimated: PriceEstimate;
  /** Set = this demand sends NO request; the candidate's bytes are reused. */
  satisfiedBy?: SatisfiedBy;
}

export interface FrozenPlan {
  format: 'storyflow.plan@1';
  runName: string;
  createdAt: number;
  rows: FrozenRow[];
  /** Known amounts summed per currency — currencies never mix. */
  totals: { CNY: number; USD: number };
  unknownCount: number;
  /** Demands satisfied by candidates (no request will be sent). */
  skippedCount: number;
  /** Problems worth reading before paying (missing candidates, bad shapes). */
  warnings: string[];
}

/** What the gate returns on confirm: the fresh run's results address plus
 *  the demands that must NOT be requested (candidate-satisfied). */
export interface PlanConfirmResult {
  runId: string;
  runName: string;
  satisfied: Record<string, SatisfiedBy>;
}

const estimateFor = (demand: PlanDemand): PriceEstimate => {
  if (demand.kind === 'video') {
    if (demand.service.startsWith('comfy')) return estimateLocalVideoPrice();
    return estimateVideoPrice({
      videoSeconds: demand.videoSeconds,
      outputSeconds: demand.outputSeconds ?? 0,
      imageCount: demand.imageCount ?? 0,
      resolution: demand.resolution ?? '768P',
      model: demand.model,
    });
  }
  if (demand.service.startsWith('fal')) {
    return estimateFalImagePrice(demand.imageSize ?? 'square_hd', demand.imageQuality ?? 'low');
  }
  if (demand.service.startsWith('minimax')) return estimateMinimaxImagePrice();
  return { currency: 'CNY', note: `未声明价目的服务 ${demand.service}——费用未知（不猜价）` };
};

const describeCandidate = (candidate: RunCandidate): SatisfiedBy => {
  const source = candidate.file
    ? candidate.file
    : `${candidate.fromRun}#${candidate.output}`;
  return {
    candidateId: candidate.id,
    source,
    fromRun: candidate.fromRun,
    output: candidate.output,
    file: candidate.file,
  };
};

/**
 * Freeze demands against one run's explicit Candidates. Zero network. A
 * satisfaction naming a missing/malformed candidate warns and leaves the
 * demand UNsatisfied (a paid request still happens — never silently skip).
 */
export const freezePlan = (
  runName: string,
  candidates: readonly RunCandidate[] | undefined,
  satisfactions: readonly RunSatisfaction[] | undefined,
  demands: readonly PlanDemand[],
  opts?: { createdAt?: number },
): FrozenPlan => {
  const warnings: string[] = [];
  const byId = new Map((candidates ?? []).map(c => [c.id, c]));
  const byOutput = new Map<string, RunCandidate>();
  for (const s of satisfactions ?? []) {
    const candidate = byId.get(s.candidate);
    if (!candidate) {
      warnings.push(`satisfy(${s.output} → ${s.candidate})：候选不存在——该请求仍会发起。`);
      continue;
    }
    const wellFormed = candidate.file !== undefined || (candidate.fromRun !== undefined && candidate.output !== undefined);
    if (!wellFormed) {
      warnings.push(`候选 ${candidate.id} 形状不完整（需要 file 或 fromRun+output）——忽略。`);
      continue;
    }
    if (byOutput.has(s.output)) {
      warnings.push(`输出 ${s.output} 被多个 satisfy 引用——只取第一个。`);
      continue;
    }
    byOutput.set(s.output, candidate);
  }

  const rows: FrozenRow[] = [];
  for (const demand of demands) {
    const candidate = byOutput.get(demand.name);
    const row: FrozenRow = {
      demand,
      estimated: estimateFor(demand),
      ...(candidate ? { satisfiedBy: describeCandidate(candidate) } : {}),
    };
    rows.push(row);
  }

  const totals = { CNY: 0, USD: 0 };
  let unknownCount = 0;
  let skippedCount = 0;
  for (const row of rows) {
    if (row.satisfiedBy) {
      skippedCount++;
      continue; // no request → no spend
    }
    if (row.estimated.amount === undefined) unknownCount++;
    else totals[row.estimated.currency] = Math.round((totals[row.estimated.currency] + row.estimated.amount) * 1e6) / 1e6;
  }

  return {
    format: 'storyflow.plan@1',
    runName,
    createdAt: opts?.createdAt ?? Date.now(),
    rows,
    totals,
    unknownCount,
    skippedCount,
    warnings,
  };
};

/** Plain-text view of a frozen plan (tests, fallback confirm, exports). */export const formatFrozenPlan = (plan: FrozenPlan): string => {
  const lines: string[] = [];
  lines.push(`冻结计划 · run「${plan.runName}」 · ${plan.rows.length} 个请求（${plan.skippedCount} 个由候选满足，不发请求）`);
  lines.push('');
  for (const row of plan.rows) {
    const head = row.satisfiedBy
      ? `✓ ${row.demand.name} — 由候选满足（${row.satisfiedBy.source}），不发请求`
      : `→ ${row.demand.name} — ${row.demand.service} · ${row.estimated.amount === undefined ? '费用未知' : `${row.estimated.currency === 'CNY' ? '¥' : '$'}${row.estimated.amount}`}`;
    lines.push(head);
    const params = Object.entries(row.demand.params).map(([k, v]) => `${k}=${v}`).join(', ');
    if (params) lines.push(`   参数：${params}`);
    if (!row.satisfiedBy) lines.push(`   计价：${row.estimated.note}`);
  }
  lines.push('');
  const parts: string[] = [];
  if (plan.totals.CNY > 0) parts.push(`¥${plan.totals.CNY.toFixed(2)}`);
  if (plan.totals.USD > 0) parts.push(`$${plan.totals.USD.toFixed(4)}`);
  if (plan.unknownCount) parts.push(`${plan.unknownCount} 项费用未知`);
  lines.push(`已知合计：${parts.join(' + ') || '¥0'}`);
  for (const w of plan.warnings) lines.push(`⚠ ${w}`);
  return lines.join('\n');
};
