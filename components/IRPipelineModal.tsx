import React, { useCallback, useMemo, useState } from 'react';
import { X, FileJson, Captions, Film, Music, Download, AlertTriangle } from 'lucide-react';
import type { Screenplay } from '../types';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { compileVisualPlan } from '../src/ir/visual/compile';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { compileCaptions } from '../src/captions/compile';
import { toSrt, toVtt } from '../src/captions/serialize';
import { imageJobCostFen } from '../src/exec/pricing';
import type { StoryFlowIR } from '../src/ir/types';

/**
 * IR pipeline entry (三线合并接线,StoryFlow dispatch step ③) — the UI mount
 * for the merged IR engine: 剧本 JSON → 提取 IR → 编译(视觉/音频/字幕三路)
 * → 导出(SRT/VTT/IR JSON)+ 发起即计费展示。
 *
 * Zero-cost by construction: this surface COMPILES plans and SERIALIZES
 * artifacts; it never submits a paid job (visual/audio exec stay behind their
 * executors). Pricing is the P10/P13 发起即计 honesty: image jobs price from
 * the input books, video jobs surface as unpriced(无刊例) rather than guessed.
 * StyleHead/graybox contracts are reused verbatim; no destructive migration —
 * extraction reads the v3 screenplay JSON as-is.
 */

interface IRPipelineModalProps {
  open: boolean;
  onClose: () => void;
  screenplay: Screenplay;
  t?: Record<string, unknown>;
}

const L = (t: Record<string, unknown> | undefined, key: string, fallback: string): string =>
  typeof t?.[key] === 'string' ? (t[key] as string) : fallback;

const download = (text: string, mime: string, filename: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

interface CompileReport {
  ir: StoryFlowIR;
  visual: ReturnType<typeof compileVisualPlan>;
  audio: ReturnType<typeof compileAudioPlan>;
  captions: ReturnType<typeof compileCaptions>;
}

export const IRPipelineModal: React.FC<IRPipelineModalProps> = ({ open, onClose, screenplay, t }) => {
  const [report, setReport] = useState<CompileReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseName = (screenplay.metadata.title || 'storyflow').replace(/[^\w一-龥]+/gi, '_');

  const run = useCallback(() => {
    setBusy(true);
    setError(null);
    try {
      const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });
      const visual = compileVisualPlan(ir);
      const audio = compileAudioPlan(ir);
      const captions = compileCaptions(ir);
      setReport({ ir, visual, audio, captions });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [screenplay]);

  const cost = useMemo(() => {
    if (!report) return null;
    const jobs = report.visual.shots.flatMap(sh => sh.jobs);
    const imageJobs = jobs.filter(j => j.kind === 'image');
    const priced = imageJobs.reduce((acc, j) => acc + (imageJobCostFen(j as never) ?? 0), 0);
    return { imageCount: imageJobs.length, pricedFen: priced, unpricedVideo: jobs.length - imageJobs.length };
  }, [report]);

  if (!open) return null;

  const irJson = report ? JSON.stringify(report.ir, null, 2) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-gray-200 dark:border-zinc-800">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Film className="w-4 h-4 text-indigo-600" />
            {L(t, 'irPipelineTitle', 'IR 管线:提取 → 编译 → 导出')}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded" aria-label="close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {L(t, 'irPipelineIntro',
              '从当前剧本提取 StoryFlowIR(镜头/三轨音频/转场,块 id 作锚),编译视觉/音频/字幕三路计划并导出 SRT/VTT。本面板只编译与序列化,零生成花费;费用为发起即计口径(图片按输入价目,视频无刊例如实标 unpriced)。')}
          </p>

          <button
            onClick={run}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          >
            {busy ? '…' : L(t, 'irPipelineRun', '生成 IR 并编译')}
          </button>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {report && (
            <div className="space-y-3">
              {/* 提取摘要 */}
              <section className="rounded-xl border border-gray-200 dark:border-zinc-700 p-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                  <FileJson className="w-3.5 h-3.5" />{L(t, 'irExtractTitle', '提取 StoryFlowIR')}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[
                    [L(t, 'irShots', '镜头'), report.ir.shots.length],
                    [L(t, 'irAudioClips', '音频 clip'), report.ir.audio.length],
                    [L(t, 'irTransitions', '转场'), report.ir.transitions.length],
                    [L(t, 'irMode', '模式'), report.ir.mode],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="rounded-lg bg-gray-50 dark:bg-zinc-800/60 px-2.5 py-2">
                      <div className="text-gray-400 text-[10px]">{k}</div>
                      <div className="font-bold text-gray-800 dark:text-gray-200">{v}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => download(irJson, 'application/json;charset=utf-8', `${baseName}-ir.json`)}
                  className="mt-2 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <Download className="inline w-3 h-3 mr-1" />{L(t, 'irDownloadJson', '下载 IR JSON')}
                </button>
              </section>

              {/* 编译三路 */}
              <section className="rounded-xl border border-gray-200 dark:border-zinc-700 p-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" />{L(t, 'irCompileTitle', '编译三路')}
                </h3>
                <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
                  <li>· {L(t, 'irVisual', '视觉')}: {report.visual.shots.length} shots / {report.visual.shots.reduce((n, sh) => n + sh.jobs.length, 0)} jobs</li>
                  <li>· <Music className="inline w-3 h-3" /> {L(t, 'irAudio', '音频')}: {report.audio.jobs.length} jobs,{L(t, 'irMix', '混音段')} {report.audio.mix.length},{L(t, 'irWarnings', '警告')} {report.audio.warnings.length}</li>
                  <li>· <Captions className="inline w-3 h-3" /> {L(t, 'irCaptions', '字幕')}: {report.captions.captions.length} 条,{L(t, 'irWarnings', '警告')} {report.captions.warnings.length}</li>
                </ul>
                {(report.audio.warnings.length > 0 || report.captions.warnings.length > 0) && (
                  <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                    {report.audio.warnings.slice(0, 3).map((w, i) => <div key={`a${i}`}>⚠ {w.message}</div>)}
                    {report.captions.warnings.slice(0, 3).map((w, i) => <div key={`c${i}`}>⚠ {w.message}</div>)}
                  </div>
                )}
              </section>

              {/* 计费(发起即计,honest) */}
              {cost && (
                <section className="rounded-xl border border-gray-200 dark:border-zinc-700 p-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{L(t, 'irCostTitle', '费用(发起即计)')}</h3>
                  <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                    <div>· {L(t, 'irCostImage', '图片')}: {cost.imageCount} × 刊例 = <span className="font-bold">¥{(cost.pricedFen / 100).toFixed(2)}</span></div>
                    <div>· {L(t, 'irCostVideo', '视频')}: {cost.unpricedVideo} jobs <span className="text-amber-600 dark:text-amber-400">unpriced({L(t, 'irUnpricedNote', '无刊例,不编造')}</span>)</div>
                  </div>
                </section>
              )}

              {/* 导出 */}
              {report && (
                <section className="rounded-xl border border-gray-200 dark:border-zinc-700 p-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => download(toSrt(report.captions), 'text/plain;charset=utf-8', `${baseName}.srt`)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Download className="inline w-3 h-3 mr-1" />SRT
                  </button>
                  <button
                    onClick={() => download(toVtt(report.captions), 'text/vtt;charset=utf-8', `${baseName}.vtt`)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Download className="inline w-3 h-3 mr-1" />VTT
                  </button>
                  <button
                    onClick={() => download(JSON.stringify({ visual: report.visual, audio: report.audio }, null, 2), 'application/json;charset=utf-8', `${baseName}-plans.json`)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-300"
                  >
                    <Download className="inline w-3 h-3 mr-1" />{L(t, 'irDownloadPlans', '编译计划 JSON')}
                  </button>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
