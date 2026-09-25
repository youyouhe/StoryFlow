import React from 'react';
import { X, Play, Ban, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { TRANSLATIONS } from '../constants';
import type { FrozenPlan } from '../utils/plan/freeze';

/**
 * Frozen-plan gate (P3 of docs/storyflow-adoption-plan.md) — the read-only
 * preview every paid request passes through. Zero external requests happen
 * until 确认: rows show exact parameters and price (or an explicit 费用未知),
 * candidate-satisfied rows show their source and will send NO request, and
 * the run selector chooses which run file's Candidates to reuse from — two
 * run files with different satisfactions are the A/B mechanism, and those
 * files diff in git.
 */
interface PlanPreviewModalProps {
  plan: FrozenPlan;
  /** Run files available for candidate reuse (A/B selector). */
  runs: string[];
  selectedRun: string | null;
  onSelectRun: (name: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  t: typeof TRANSLATIONS['en'];
}

export const PlanPreviewModal: React.FC<PlanPreviewModalProps> = ({
  plan, runs, selectedRun, onSelectRun, onConfirm, onCancel, t,
}) => {
  const money = (amount: number, currency: 'CNY' | 'USD'): string =>
    currency === 'CNY' ? `¥${amount.toFixed(2)}` : `$${amount.toFixed(4)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t.planTitle}</h2>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 dark:border-zinc-800 flex items-center gap-2">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.planRunLabel}</label>
          <select
            value={selectedRun ?? ''}
            onChange={e => onSelectRun(e.target.value || null)}
            className="px-2 py-1 text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded"
          >
            <option value="">{t.planRunNone}</option>
            {runs.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="text-[10px] text-gray-400">{t.planRunHint}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {plan.rows.length === 0 && <p className="text-xs text-gray-400">{t.planEmpty}</p>}
          {plan.rows.map(row => (
            <div
              key={row.demand.name}
              className={clsx(
                'p-2.5 rounded-lg border',
                row.satisfiedBy
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : 'border-gray-200 dark:border-zinc-700'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-bold text-gray-800 dark:text-gray-100">{row.demand.name}</span>
                {row.satisfiedBy ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                    <Check className="w-3 h-3" /> {t.planSatisfied} · {t.planNoRequest}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono font-bold text-gray-700 dark:text-gray-200">
                    {row.estimated.amount === undefined
                      ? t.planUnknownCost
                      : money(row.estimated.amount, row.estimated.currency)}
                  </span>
                )}
              </div>
              {row.satisfiedBy ? (
                <p className="mt-0.5 text-[10px] text-emerald-700/80 dark:text-emerald-300/70 font-mono">
                  {row.satisfiedBy.candidateId} → {row.satisfiedBy.source}
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">
                    {row.demand.service} · {Object.entries(row.demand.params).map(([k, v]) => `${k}=${v}`).join(' · ')}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{row.estimated.note}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {plan.warnings.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-zinc-800 space-y-0.5">
            {plan.warnings.map(w => (
              <p key={w} className="text-[10px] text-amber-600 dark:text-amber-400">⚠ {w}</p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 dark:border-zinc-800">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {t.planTotals}：
            <span className="font-mono font-bold">
              {[
                plan.totals.CNY > 0 ? `¥${plan.totals.CNY.toFixed(2)}` : null,
                plan.totals.USD > 0 ? `$${plan.totals.USD.toFixed(4)}` : null,
                plan.unknownCount ? `${plan.unknownCount} ${t.planUnknownCost}` : null,
                plan.skippedCount ? `${plan.skippedCount} ${t.planNoRequest}` : null,
              ].filter(Boolean).join(' + ') || '¥0'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1"
            >
              <Ban className="w-3.5 h-3.5" /> {t.planCancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 inline-flex items-center gap-1"
            >
              <Play className="w-3.5 h-3.5" /> {t.planConfirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
