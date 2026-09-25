import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Link2, AlertTriangle } from 'lucide-react';
import type { RunCandidate, RunFileData, ResultRecord } from '../services/project/files';
import { listRunFiles, loadRunFile, saveRunFile } from '../services/project/projectStore';
import { resultsStoreFor } from '../services/project/results';
import {
  candidateFromOutput, outputsOf, sameCandidateAddress, validateRunCandidates,
  withCandidate, withSatisfaction, withoutCandidate, withoutSatisfaction,
  type OutputAddress,
} from '../services/project/candidates';

/**
 * Candidate editor (Hypit 尾声 ②,issue #4) — 人工挑选/微调面 for the P3
 * build-record/satisfy protocol. Before this panel, runs/*.sfrun candidates
 * and satisfy edges were hand-edited JSON; this is the display/edit surface
 * over the SAME files (no new format, Hypit 本体零改动).
 *
 * Needs a project directory (P1 file-backed project): runs and results live
 * on disk. Without one the panel explains that and offers nothing — refuse,
 * not fake.
 */
interface CandidatesPanelProps {
  open: boolean;
  onClose: () => void;
  dir: FileSystemDirectoryHandle | null;
  /** TRANSLATIONS[lang](含函数值)——只用字符串键,函数键走 fallback。 */
  t?: Record<string, unknown>;
}

const L = (t: Record<string, unknown> | undefined, key: string, fallback: string): string =>
  typeof t?.[key] === 'string' ? (t[key] as string) : fallback;

export const CandidatesPanel: React.FC<CandidatesPanelProps> = ({ open, onClose, dir, t }) => {
  const [runs, setRuns] = useState<string[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runData, setRunData] = useState<RunFileData | null>(null);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedRun(null);
    setRunData(null);
    if (!dir) { setRuns([]); setResults([]); return; }
    void (async () => {
      try {
        const names = await listRunFiles(dir);
        setRuns(names);
        const store = resultsStoreFor(dir);
        const summaries = await store.list();
        const records: ResultRecord[] = [];
        for (const s of summaries) {
          const r = await store.get(s.runId);
          if (r) records.push(r);
        }
        setResults(records);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [open, dir]);

  useEffect(() => {
    if (!dir || !selectedRun) { setRunData(null); return; }
    void (async () => {
      try {
        const data = await loadRunFile(dir, selectedRun);
        setRunData(data);
        setDirty(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [dir, selectedRun]);

  // available history outputs → validation + picker source
  const available = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of results) {
      const set = m.get(r.runId) ?? new Set<string>();
      for (const o of outputsOf(r.runId, r)) set.add(o.output);
      m.set(r.runId, set);
    }
    return m;
  }, [results]);

  const validation = useMemo(
    () => (runData ? validateRunCandidates(runData, available) : null),
    [runData, available],
  );

  // history outputs not yet picked as candidates
  const pickable = useMemo<OutputAddress[]>(() => {
    if (!runData) return [];
    const out: OutputAddress[] = [];
    for (const r of results) {
      for (const o of outputsOf(r.runId, r)) {
        const cand = candidateFromOutput(o);
        if (!runData.candidates.some(c => sameCandidateAddress(c, cand))) out.push(o);
      }
    }
    return out;
  }, [runData, results]);

  if (!open) return null;

  const edit = (next: RunFileData): void => {
    setRunData(next);
    setDirty(true);
  };

  const handleSave = async (): Promise<void> => {
    if (!dir || !selectedRun || !runData) return;
    setSaving(true);
    setError(null);
    try {
      await saveRunFile(dir, runData);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-gray-200 dark:border-zinc-800">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-indigo-600" />
            {L(t, 'candidatesTitle', '候选与复用编辑器(build-record / satisfy)')}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded" aria-label="close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!dir ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {L(t, 'candidatesNeedProject', '候选与复用绑定随项目目录持久化(runs/*.sfrun)——先在导出菜单打开/新建项目目录,再回来编辑。')}
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center gap-3">
              <label className="text-xs text-gray-500">{L(t, 'candidatesRunLabel', 'Run 文件')}</label>
              <select
                className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-transparent"
                value={selectedRun ?? ''}
                onChange={e => setSelectedRun(e.target.value || null)}
              >
                <option value="">{L(t, 'candidatesPickRun', '选择 run…')}</option>
                {runs.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              {selectedRun && (
                <button
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40"
                >
                  {saving ? '…' : L(t, 'candidatesSave', '保存')}
                </button>
              )}
            </div>

            {error && (
              <div className="mx-5 mt-3 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</div>
            )}

            {runData && validation && (
              <div className="px-5 py-3 space-y-3 overflow-y-auto flex-1">
                {/* validation warnings — warn, never skip(P3 语义) */}
                {!validation.ok && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 space-y-1">
                    <div className="font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{L(t, 'candidatesWarnings', '校验提示')}</div>
                    {validation.danglingSatisfactions.map(o => (
                      <div key={`d-${o}`}>{L(t, 'candidatesDangling', 'satisfy 指向缺失候选')}: {o}</div>
                    ))}
                    {validation.missingHistory.map(id => (
                      <div key={`m-${id}`}>{L(t, 'candidatesMissing', '候选的历史输出不在结果库')}: {id}</div>
                    ))}
                    {validation.duplicateIds.map(id => (
                      <div key={`c-${id}`}>{L(t, 'candidatesDup', '重复候选 id')}: {id}</div>
                    ))}
                  </div>
                )}

                {/* candidates */}
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    {L(t, 'candidatesList', '候选(build-record)')}
                  </h3>
                  {runData.candidates.length === 0 && (
                    <p className="text-xs text-gray-400 py-2">{L(t, 'candidatesEmpty', '暂无候选——从下方结果库挑一个。')}</p>
                  )}
                  <ul className="space-y-1">
                    {runData.candidates.map(c => (
                      <li key={c.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800/60">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400">{c.id}</span>
                        <span className="text-gray-500 truncate flex-1">
                          {c.fromRun
                            ? `${L(t, 'candidatesFromRun', '历史')} ${c.fromRun} · ${c.output}`
                            : (c.file ? `${L(t, 'candidatesFromFile', '文件')} ${c.file}` : '—')}
                        </span>
                        <button
                          onClick={() => edit(withoutCandidate(runData, c.id))}
                          className="p-1 text-gray-400 hover:text-red-500"
                          aria-label={`remove ${c.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {pickable.length > 0 && (
                    <select
                      className="mt-2 w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-transparent"
                      value=""
                      onChange={e => {
                        const addr = pickable.find(o => `${o.runId}/${o.output}` === e.target.value);
                        if (addr) edit(withCandidate(runData, candidateFromOutput(addr)));
                      }}
                    >
                      <option value="">+ {L(t, 'candidatesAddFrom', '从结果库添加候选…')}</option>
                      {pickable.map(o => (
                        <option key={`${o.runId}/${o.output}`} value={`${o.runId}/${o.output}`}>
                          {o.runId} · {o.output} ({o.kind})
                        </option>
                      ))}
                    </select>
                  )}
                </section>

                {/* satisfactions */}
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    {L(t, 'satisfactionsList', '复用边(satisfy:输出 → 候选)')}
                  </h3>
                  {runData.satisfactions.length === 0 && (
                    <p className="text-xs text-gray-400 py-2">{L(t, 'satisfactionsEmpty', '暂无复用边。')}</p>
                  )}
                  <ul className="space-y-1">
                    {runData.satisfactions.map(s => (
                      <li key={s.output} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800/60">
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">{s.output}</span>
                        <span className="text-gray-400">→</span>
                        <select
                          className="flex-1 bg-transparent text-xs"
                          value={s.candidate}
                          onChange={e => edit(withSatisfaction(runData, s.output, e.target.value))}
                        >
                          {runData.candidates.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                        </select>
                        <button
                          onClick={() => edit(withoutSatisfaction(runData, s.output))}
                          className="p-1 text-gray-400 hover:text-red-500"
                          aria-label={`unlink ${s.output}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {runData.candidates.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-transparent font-mono"
                        placeholder={L(t, 'satisfactionsOutputHint', '输出名,如 video.b1')}
                        onKeyDown={e => {
                          if (e.key !== 'Enter') return;
                          const value = (e.target as HTMLInputElement).value.trim();
                          if (!value) return;
                          edit(withSatisfaction(runData, value, runData.candidates[0].id));
                          (e.target as HTMLInputElement).value = '';
                        }}
                      />
                      <span className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Plus className="w-3 h-3" />{L(t, 'satisfactionsAddHint', '回车添加(默认绑第一个候选)')}
                      </span>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/** Exported for tests/App: the RunCandidate type re-export (picker payload). */
export type { RunCandidate };
