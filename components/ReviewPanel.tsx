import React, { useEffect, useRef, useState } from 'react';
import { X, MessageSquare, Check, RotateCcw, Trash2, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import type { FeedbackFile } from '../services/project/feedback';

/**
 * Review mode (P5b) — watch the export, pin comments at timestamps, resolve
 * them as they get fixed. Everything lands in FEEDBACK.json so the Agent
 * reads the same notes the human wrote (files are the memory; done means
 * watched).
 */
interface ReviewPanelProps {
  open: boolean;
  feedback: FeedbackFile;
  previewUrl?: string;
  t: any;
  onAdd: (text: string, atSec: number) => void;
  onSetStatus: (id: string, status: 'open' | 'resolved') => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({
  open, feedback, previewUrl, t, onAdd, onSetStatus, onDelete, onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [atSec, setAtSec] = useState(0);
  const [text, setText] = useState('');

  // slider ↔ player sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = (): void => setAtSec(Math.round(video.currentTime * 10) / 10);
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [previewUrl]);

  if (!open) return null;

  const seek = (sec: number): void => {
    setAtSec(sec);
    if (videoRef.current) videoRef.current.currentTime = sec;
  };

  const submit = (): void => {
    if (!text.trim()) return;
    onAdd(text.trim(), atSec);
    setText('');
  };

  const sorted = [...feedback.comments].sort((a, b) => a.atSec - b.atSec);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 inline-flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> {t.reviewTitle || 'Review · FEEDBACK.json'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 dark:border-zinc-800 space-y-2">
          <p className="text-[10px] text-gray-400">{t.reviewHint || 'Watch the export, pin a note at the frame that needs work. The Agent reads FEEDBACK.json and fixes each open comment.'}</p>
          {previewUrl ? (
            <video ref={videoRef} src={previewUrl} controls className="w-full rounded-lg bg-black max-h-56" />
          ) : (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">{t.reviewNoPreview || 'No preview loaded — enter the timestamp manually (watch the export side by side).'}</p>
          )}
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <input
              type="number" step="0.1" min="0" value={atSec}
              onChange={e => seek(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-20 px-2 py-1 text-xs font-mono bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded"
            />
            <input
              type="range" min="0" max={Math.max(30, atSec + 10)} step="0.1" value={atSec}
              onChange={e => seek(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-[10px] font-mono text-gray-400">{atSec.toFixed(1)}s</span>
          </div>
          <div className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={2}
              placeholder={t.reviewPlaceholder || 'What should change at this moment?'}
              className="flex-1 px-2 py-1 text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded"
            />
            <button
              type="button"
              onClick={submit}
              className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
            >
              {t.reviewAdd || 'Add'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
          {sorted.length === 0 && (
            <p className="text-xs text-gray-400 py-4 text-center">{t.reviewEmpty || 'No comments yet.'}</p>
          )}
          {sorted.map(c => (
            <div
              key={c.id}
              className={clsx(
                'p-2 rounded-lg border flex items-start gap-2',
                c.status === 'resolved'
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10 opacity-70'
                  : 'border-gray-200 dark:border-zinc-700',
              )}
            >
              <button type="button" onClick={() => seek(c.atSec)} className="text-[11px] font-mono text-indigo-500 shrink-0 pt-0.5">
                {c.atSec.toFixed(1)}s
              </button>
              <p className="flex-1 text-xs text-gray-700 dark:text-gray-200 break-words">{c.text}</p>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title={c.status === 'resolved' ? (t.reviewReopen || 'reopen') : (t.reviewResolve || 'resolve')}
                  onClick={() => onSetStatus(c.id, c.status === 'resolved' ? 'open' : 'resolved')}
                  className={clsx(
                    'p-1 rounded border',
                    c.status === 'resolved'
                      ? 'border-gray-200 dark:border-zinc-700 text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
                      : 'border-emerald-300 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
                  )}
                >
                  {c.status === 'resolved' ? <RotateCcw className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  className="p-1 rounded border border-gray-200 dark:border-zinc-700 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
