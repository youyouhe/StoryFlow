import React from 'react';

/**
 * AskDialog — the presentational half of useAskDialog: a minimal in-app
 * replacement for window.confirm. Title + pre-line body + explicit buttons;
 * only a button closes it (consent flows must not be dismissible by accident).
 */
export interface AskButton {
  label: string;
  value: string;
  kind?: 'primary' | 'default';
}

export interface AskOptions {
  title: string;
  body: string;
  buttons: AskButton[];
}

export const AskDialog: React.FC<{ options: AskOptions; onChoose: (value: string) => void }> = ({ options, onChoose }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-label={options.title}
      className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-zinc-700 p-5 space-y-3"
    >
      <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{options.title}</div>
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-gray-600 dark:text-gray-300">
        {options.body}
      </pre>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {options.buttons.map(b => (
          <button
            key={b.value}
            type="button"
            onClick={() => onChoose(b.value)}
            className={
              b.kind === 'primary'
                ? 'px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors'
                : 'px-3.5 py-2 text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg transition-colors'
            }
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  </div>
);
