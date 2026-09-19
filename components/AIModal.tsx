import React from 'react';
import { createPortal } from 'react-dom';
import { FileText, Sparkles, X, Boxes, Bot, Loader2, Wand2, Cloud } from 'lucide-react';
import { clsx } from 'clsx';
import type { AIMode, AIState } from '../types';
import { TRANSLATIONS } from '../constants';
import { grayboxOverviewLine } from '../utils/exportData';
import { collectDebugInfo } from '../utils/debugInfo';
import { copyToClipboard } from '../utils/clipboard';

interface AIModalProps {
    aiMode: AIMode;
    setAIMode: React.Dispatch<React.SetStateAction<AIMode>>;
    aiState: AIState;
    setAIState: React.Dispatch<React.SetStateAction<AIState>>;
    t: typeof TRANSLATIONS['en'];
    onClose: () => void;
    onExecute: () => void;
    onAccept: () => void;
    transitionHeadingDraft: string;
    setTransitionHeadingDraft: React.Dispatch<React.SetStateAction<string>>;
    promptSource: string;
    onPromptSourceChange: (v: string) => void;
    runContinuation: (directive?: { allowTransition: boolean; targetSceneHeading?: string }) => void;
    /** VIDEO_PLAN only: submit every planned segment to H3 (text-to-video
     *  with bound character sheets). Absent → button hidden. */
    onSubmitPlanToH3?: () => void;
    planH3Progress?: { current: number; total: number } | null;
    /** Pre-submit scan of every segment's cast: which characters have bound
     *  design sheets, which don't. Purely informational — missing sheets
     *  warn, never veto. */
    planPreflight?: { index: number; seconds: number; beatCount: number; characters: { name: string; url: string; sheetName: string }[]; missing: string[] }[] | null;
}

export const AIModal: React.FC<AIModalProps> = ({
    aiMode,
    setAIMode,
    aiState,
    setAIState,
    t,
    onClose,
    onExecute,
    onAccept,
    transitionHeadingDraft,
    setTransitionHeadingDraft,
    promptSource,
    onPromptSourceChange,
    runContinuation,
    onSubmitPlanToH3,
    planH3Progress,
    planPreflight,
}) => {
    // Live elapsed-seconds ticker while a batch runs — the user sees the
    // modal is alive during slow serial LLM calls instead of assuming a hang.
    const [elapsed, setElapsed] = React.useState(0);
    // Preflight hover preview — portaled to <body> with fixed coords: the
    // modal root has overflow-hidden + transform, which clips any in-tree
    // popup (the first CSS group-hover attempt was invisible for exactly
    // that reason). pointer-events-none so it never traps the mouse.
    const [preview, setPreview] = React.useState<{ name: string; url?: string; missing?: boolean; x: number; y: number } | null>(null);
    const openPreview = (e: React.MouseEvent, data: { name: string; url?: string; missing?: boolean }) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPreview({ ...data, x: r.left + r.width / 2, y: r.top });
    };
    React.useEffect(() => {
        if (!aiState.batchProgress) { setElapsed(0); return; }
        const started = Date.now();
        const iv = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
        return () => clearInterval(iv);
    }, [aiState.batchProgress !== null]);
    return (
        <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-zinc-800 transform transition-all scale-100 ring-1 ring-black/5">
                <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
                        <Sparkles className="w-5 h-5" />
                        <span>{t.aiAssistant}</span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="flex gap-2 p-1 bg-gray-100 dark:bg-zinc-900 rounded-xl">
                        {[...(['CONTINUE', 'IDEAS', 'REWRITE', 'STORYBOARD', 'GRAYBOX', 'DUB', 'FROM_PROMPT', 'VIDEO_PLAN'] as const)].map(m => (
                            <button
                                key={m}
                                onClick={() => { setAIMode(m); setAIState({isLoading:false, suggestion:null, error:null, decision:null, grayboxDraft:null, batchProgress:null})}}
                                className={clsx(
                                    "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                                    aiMode === m
                                        ? "bg-white dark:bg-[#27272a] text-indigo-600 dark:text-indigo-400 shadow-sm"
                                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                )}
                            >
                                {m === 'CONTINUE' && t.modes.continue}
                                {m === 'IDEAS' && t.modes.ideas}
                                {m === 'REWRITE' && t.modes.rewrite}
                                {m === 'STORYBOARD' && t.modes.storyboard}
                                {m === 'GRAYBOX' && t.modes.graybox}
                                {m === 'DUB' && t.modes.dub}
                                {m === 'FROM_PROMPT' && t.modes.fromPrompt}
                                {m === 'VIDEO_PLAN' && t.modes.videoPlan}
                            </button>
                        ))}
                    </div>

                    {aiState.batchProgress && (
                        <div className="text-center py-6 space-y-3">
                            <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mx-auto text-emerald-500 dark:text-emerald-400">
                                <Boxes className="w-8 h-8 animate-pulse" />
                            </div>
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                                {t.grayboxBatchProgress
                                    .replace('{current}', String(aiState.batchProgress.current))
                                    .replace('{total}', String(aiState.batchProgress.total))}
                            </p>
                            <div className="w-full h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden mx-auto max-w-[80%]">
                                <div
                                    className="h-full bg-emerald-500 transition-all duration-300"
                                    style={{ width: `${(aiState.batchProgress.current / Math.max(aiState.batchProgress.total, 1)) * 100}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 px-4">
                                已等待 {elapsed}s · 每段需调一次 LLM（10~30s），未到 180s 超时前都是正常等待
                            </p>
                        </div>
                    )}

                    {!aiState.suggestion && !aiState.decision && !aiState.grayboxDraft && !aiState.batchProgress && (
                         <div className="text-center py-6">
                            <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-500 dark:text-indigo-400">
                                <Bot className="w-8 h-8" />
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 px-4">
                                {aiMode === 'CONTINUE' && t.prompts.continue}
                                {aiMode === 'IDEAS' && t.prompts.ideas}
                                {aiMode === 'REWRITE' && t.prompts.rewrite}
                                {aiMode === 'STORYBOARD' && t.prompts.storyboard}
                                {aiMode === 'GRAYBOX' && t.prompts.graybox}
                                {aiMode === 'DUB' && t.prompts.dub}
                                {aiMode === 'FROM_PROMPT' && t.prompts.fromPrompt}
                                {aiMode === 'VIDEO_PLAN' && t.prompts.videoPlanHint}
                            </p>
                            {aiMode === 'GRAYBOX' && (
                                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-6 px-4 leading-relaxed">
                                    {t.grayboxBatchSceneHint}
                                </p>
                            )}
                            {aiMode === 'STORYBOARD' && (
                                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mb-6 px-4 leading-relaxed">
                                    {t.storyboardBatchSceneHint}
                                </p>
                            )}
                            {aiMode === 'FROM_PROMPT' && (
                                <textarea
                                    value={promptSource}
                                    onChange={e => onPromptSourceChange(e.target.value)}
                                    placeholder={t.fromPromptPlaceholder}
                                    rows={8}
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-xs font-mono resize-y max-h-64 text-gray-800 dark:text-gray-200"
                                />
                            )}
                            <button
                                onClick={onExecute}
                                disabled={aiState.isLoading}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-xl active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Wand2 className="w-4 h-4" />}
                                {aiState.isLoading
                                  ? (aiMode === 'CONTINUE' ? t.transitionAssessing : t.aiGenerating)
                                  : (aiMode === 'CONTINUE' ? t.transitionContinueScene : t.aiGenerate)}
                            </button>
                         </div>
                    )}

                    {/* CONTINUE two-step: transition decision card (shown after
                        the judgment step, before the continuation is written). */}
                    {aiMode === 'CONTINUE' && aiState.decision && !aiState.suggestion && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{t.transitionSuggests}</span>
                                    <span className={clsx(
                                        "text-[11px] font-bold px-2 py-0.5 rounded-full",
                                        aiState.decision.action === 'transition'
                                            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                            : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                    )}>
                                        {aiState.decision.action === 'transition' ? t.transitionReasonTransition : t.transitionReasonContinue}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-700 dark:text-gray-300">{aiState.decision.reason}</p>
                                {aiState.decision.action === 'transition' && (
                                    <div className="mt-3">
                                        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                            {t.transitionSceneLabel}
                                        </label>
                                        <input
                                            type="text"
                                            value={transitionHeadingDraft}
                                            onChange={e => setTransitionHeadingDraft(e.target.value)}
                                            className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm font-mono dark:text-white"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setAIState({isLoading:false, suggestion:null, error:null, decision:null, grayboxDraft:null, batchProgress:null})}
                                    className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                                >
                                    {t.aiDiscard}
                                </button>
                                {aiState.decision.action === 'transition' && (
                                    <button
                                        onClick={() => runContinuation({ allowTransition: true, targetSceneHeading: transitionHeadingDraft.trim() })}
                                        disabled={aiState.isLoading || !transitionHeadingDraft.trim()}
                                        className="flex-1 py-2.5 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-lg shadow-amber-100 dark:shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1"/> : null}
                                        {t.transitionAccept}
                                    </button>
                                )}
                                <button
                                    onClick={() => runContinuation({ allowTransition: false })}
                                    disabled={aiState.isLoading}
                                    className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                                >
                                    {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1"/> : null}
                                    {t.transitionContinueScene}
                                </button>
                            </div>
                        </div>
                    )}

                    {aiState.info && (
                        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 text-sm rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                            {aiState.info}
                        </div>
                    )}

                    {aiMode === 'VIDEO_PLAN' && aiState.suggestion && (
                        <div className="space-y-3">
                            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{t.videoPlanNext}</p>
                            <button
                                onClick={() => {
                                    const blob = new Blob([aiState.suggestion || ''], { type: 'text/markdown' });
                                    const a = document.createElement('a');
                                    a.href = URL.createObjectURL(blob);
                                    a.download = 'video-plan.md';
                                    a.click();
                                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                                }}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                {t.videoPlanExport}
                            </button>
                        </div>
                    )}
                    {aiMode === 'VIDEO_PLAN' && aiState.suggestion && planPreflight && (
                        <div className="px-4 pb-1 space-y-1">
                            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                                角色设定图预检
                            </p>
                            {planPreflight.map(s => (
                                <div key={s.index} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                                    <span className="text-gray-400 shrink-0">段{s.index} ({s.seconds}s/{s.beatCount}拍)</span>
                                    <span className="flex flex-wrap gap-x-2">
                                        {s.characters.map(c => (
                                            <span
                                                key={c.name}
                                                className="rounded px-0.5 -mx-0.5 text-emerald-600 dark:text-emerald-400 cursor-default hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                                                onMouseEnter={e => openPreview(e, { name: `${c.name} · ${c.sheetName}`, url: c.url })}
                                                onMouseLeave={() => setPreview(null)}
                                            >
                                                ✓{c.name}
                                            </span>
                                        ))}
                                        {s.missing.map(c => (
                                            <span
                                                key={c}
                                                className="rounded px-0.5 -mx-0.5 text-amber-600 dark:text-amber-400 cursor-default hover:bg-amber-50 dark:hover:bg-amber-900/30"
                                                onMouseEnter={e => openPreview(e, { name: c, missing: true })}
                                                onMouseLeave={() => setPreview(null)}
                                            >
                                                ⚠{c}
                                            </span>
                                        ))}
                                        {!s.characters.length && !s.missing.length && (
                                            <span className="text-gray-400">无角色（空镜段）</span>
                                        )}
                                    </span>
                                </div>
                            ))}
                            {planPreflight.some(s => s.missing.length) && (
                                <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                                    ⚠ 有角色未绑定设定图——可先 Alt+S 生成设定图并在资产库绑定，再提交；仍提交则缺图角色不做形象锁定。
                                </p>
                            )}
                        </div>
                    )}
                    {aiMode === 'VIDEO_PLAN' && aiState.suggestion && onSubmitPlanToH3 && (
                        <div className="px-4 pb-1">
                            <button
                                onClick={onSubmitPlanToH3}
                                disabled={!!planH3Progress}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm font-semibold disabled:opacity-60"
                            >
                                {planH3Progress
                                    ? `提交中 ${planH3Progress.current}/${planH3Progress.total} …`
                                    : '逐段提交 MiniMax H3 生成视频'}
                            </button>
                            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 text-center">
                                prompt = 各段时间轴节拍 · 参考图 = 已绑定的角色设定图 · 无需白模视频
                            </p>
                        </div>
                    )}
                    {aiState.error && (
                        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-xl border border-red-100 dark:border-red-900/50">
                            {aiState.error}
                            <button
                                onClick={() => {
                                    const debug = collectDebugInfo(aiState.error);
                                    navigator.clipboard?.writeText(debug).catch(() => {});
                                }}
                                className="mt-2 block text-[10px] underline text-red-400 hover:text-red-600"
                            >
                                复制调试信息
                            </button>
                        </div>
                    )}

                    {aiState.suggestion && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            {aiMode === 'IDEAS' && (
                                <p className="text-[11px] text-indigo-600 dark:text-indigo-400">{t.aiIdeasHint}</p>
                            )}
                            {aiMode === 'STORYBOARD' && (
                                <p className="text-[11px] text-indigo-600 dark:text-indigo-400">{t.storyboardHint}</p>
                            )}
                            {aiMode === 'GRAYBOX' && (
                                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{t.grayboxHint}</p>
                            )}
                            {aiMode === 'GRAYBOX' && aiState.grayboxDraft && !aiState.grayboxDraft.error && (
                                <p className="px-1 text-[10px] leading-snug text-emerald-600 dark:text-emerald-400 font-sans">
                                    {grayboxOverviewLine(aiState.grayboxDraft)}
                                </p>
                            )}
                            <div className="p-4 bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-gray-100 dark:border-zinc-800 text-sm font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-gray-800 dark:text-gray-300 shadow-inner">
                                {aiState.suggestion}
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setAIState({isLoading:false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null})}
                                    className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                                >
                                    {t.aiDiscard}
                                </button>
                                {(aiMode === 'STORYBOARD' || aiMode === 'GRAYBOX') && (
                                    <button
                                        onClick={() => { void copyToClipboard(aiState.suggestion || ''); }}
                                        className="flex-1 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <Cloud className="w-3.5 h-3.5" />
                                        {aiMode === 'GRAYBOX' ? t.grayboxCopy : t.aiCopyPrompt}
                                    </button>
                                )}
                                <button
                                    onClick={onAccept}
                                    disabled={aiMode === 'GRAYBOX' && !aiState.grayboxDraft}
                                    className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                                >
                                    {aiMode === 'IDEAS' ? t.aiCopyIdeas : aiMode === 'STORYBOARD' ? t.aiSavePrompt : aiMode === 'GRAYBOX' ? t.grayboxSave : aiMode === 'VIDEO_PLAN' ? (t.cancel || 'Close') : t.aiInsert}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        {/* Hover preview portaled outside the modal — immune to its
            overflow-hidden/transform clipping. Flips below the chip when
            there is no room above. */}
        {preview && createPortal(
            <div
                className="fixed z-[100] pointer-events-none"
                style={{
                    left: preview.x,
                    top: preview.y,
                    transform: preview.y < 300 ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 8px))',
                }}
            >
                {preview.missing ? (
                    <div className="flex items-center justify-center w-44 h-28 rounded-lg border-2 border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-[10px] text-amber-600 dark:text-amber-400 text-center px-2 shadow-xl">
                        {preview.name}：未绑定设定图——将无参考提交，形象可能漂移
                    </div>
                ) : (
                    <div>
                        <img src={preview.url} alt={preview.name} className="w-44 rounded-lg border border-gray-200 dark:border-zinc-600 shadow-xl bg-white dark:bg-zinc-900" />
                        <div className="text-center text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">{preview.name}</div>
                    </div>
                )}
            </div>,
            document.body,
        )}
        </>
    );
};
