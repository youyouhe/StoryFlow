/**
 * P5b variant mass-production — acceptance 3: 批量 10 个变体仅变化部分
 * 发起请求，总花费 ≈ 10 × 增量（计划预览可证）。
 */
import { describe, expect, it } from 'vitest';
import type { Screenplay } from '../../types';
import { freezePlan, type PlanDemand } from '../plan/freeze';
import { applyVariant, buildVariantRun, changedBlockIds, type VariantSpec } from '../variants';

const base: Screenplay = {
  id: 'sp-base',
  metadata: { title: 'Ada reviews the ProductX', author: 'a', draft: '1', scriptLanguage: 'en' },
  blocks: [
    { id: 'sc', type: 'SCENE_HEADING', content: 'INT. STUDIO - DAY' },
    { id: 'b1', type: 'ACTION', content: 'Ada holds the ProductX box.' },
    { id: 'b2', type: 'DIALOGUE', content: 'The ProductX changed my routine.' },
    { id: 'b3', type: 'DIALOGUE', content: 'Unchanged closer line for every variant.' },
    { id: 'b4', type: 'ACTION', content: 'Ada smiles at the ProductX.' },
  ],
  lastModified: 0,
};

const demandFor = (blockId: string): PlanDemand => ({
  name: `video.${blockId}`,
  kind: 'video',
  blockId,
  service: 'comfy:t2v',
  params: { outputSeconds: 5 },
  outputSeconds: 5,
  videoSeconds: 0,
  imageCount: 0,
  resolution: '768P',
});

describe('variants (P5b mass production)', () => {
  it('substitutes text while keeping block ids stable (reuse keys)', () => {
    const spec: VariantSpec = { name: 'swap-host', substitutions: [{ from: 'Ada', to: 'Leon' }, { from: 'ProductX', to: 'CheatGPT' }] };
    const variant = applyVariant(base, spec);
    expect(variant.blocks.map(b => b.id)).toEqual(['sc', 'b1', 'b2', 'b3', 'b4']);
    expect(variant.blocks[1].content).toContain('Leon');
    expect(variant.blocks[1].content).not.toContain('Ada');
    expect(changedBlockIds(base, variant).sort()).toEqual(['b1', 'b2', 'b4']);
  });

  it('10 variants: only changed blocks send requests, cost ≈ 10 × increment', () => {
    const baseDemands = base.blocks.map(b => demandFor(b.id));
    const shared = ['sc', 'b3'].map(id => ({ name: `video.${id}`, fromRun: 'run_shared', output: `video.${id}` }));
    let totalSkipped = 0;
    let totalSent = 0;
    for (let i = 0; i < 10; i++) {
      const spec: VariantSpec = {
        name: `variant-${i}`,
        substitutions: [{ from: 'Ada', to: `Host${i}` }, { from: 'ProductX', to: `SKU${i}` }],
      };
      const variant = applyVariant(base, spec);
      const changed = new Set(changedBlockIds(base, variant));
      const run = buildVariantRun({ name: spec.name, shared });
      const plan = freezePlan(spec.name, run.candidates, run.satisfactions, baseDemands);

      // unchanged blocks satisfied (no request); changed blocks send
      expect(plan.skippedCount).toBe(2);
      const sentRows = plan.rows.filter(r => !r.satisfiedBy);
      expect(sentRows.map(r => r.demand.blockId).sort()).toEqual([...changed].sort());
      // money only moves for the sent rows — self-hosted here is ¥0, so assert
      // the COUNT identity that the 10× increment claim reduces to
      totalSkipped += plan.skippedCount;
      totalSent += sentRows.length;
    }
    expect(totalSkipped).toBe(20);
    expect(totalSent).toBe(30); // 10 variants × 3 changed blocks

    // A/B diff story: run files are plain text
    const runA = buildVariantRun({ name: 'a', shared });
    const runB = buildVariantRun({ name: 'b', shared: [...shared, { name: 'video.b2', fromRun: 'run_shared' }] });
    expect(JSON.stringify(runA)).not.toEqual(JSON.stringify(runB));
    expect(runB.satisfactions).toHaveLength(3);
  });
});
