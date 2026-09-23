import React, { useState } from 'react';
import { Check, Loader2, Languages, Lock, Moon, Sun } from 'lucide-react';
import { Screenplay } from '../types';

/**
 * AppTopBar — the editor's top bar: inline rename (double-click the title),
 * the save-status indicator, the production-mode badge (simple/cinematic
 * toggle) and the language/theme switches.
 *
 * Wave-2 UI split: the title-editing draft state is local to the bar; rename
 * and the screenplay toggle arrive as callbacks.
 */
interface AppTopBarProps {
  screenplay: Screenplay;
  onRename: (id: string, newTitle: string) => void;
  /** Mode-switch rules live in App; the badge reports the attempt. */
  hasProData?: boolean;
  onModeBadgeClick?: () => void;
  saveStatus: 'saved' | 'saving';
  theme: 'light' | 'dark';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
  lang: 'en' | 'zh';
  setLang: React.Dispatch<React.SetStateAction<'en' | 'zh'>>;
  t: typeof import('../constants').TRANSLATIONS['en'];
}

export function AppTopBar({ screenplay, onRename, saveStatus, theme, setTheme, lang, setLang, t, hasProData, onModeBadgeClick }: AppTopBarProps) {
  const mode = screenplay.productionMode ?? 'simple';
  const modeLocked = mode === 'cinematic' || hasProData;
  // Rule-3 reason wins: a project carrying Pro data reports the data-lock,
  // matching the click toast from App's handleProductionModeChange.
  const modeTitle = hasProData
    ? t.modeSwitchDataReason
    : mode === 'cinematic' ? t.modeSwitchProReason : t.modeUpgradeBody;
  const modeLabel = mode === 'simple' ? '简易' : '专业';
  const [headerTitleEditing, setHeaderTitleEditing] = useState(false);
  const [headerTitleVal, setHeaderTitleVal] = useState('');

  return (
        <div className="h-14 border-b border-gray-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-4 ml-10 md:ml-0">
             <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-widest font-mono">
                 {headerTitleEditing ? (
                    <input
                        value={headerTitleVal}
                        onChange={(e) => setHeaderTitleVal(e.target.value)}
                        onBlur={() => {
                            if (headerTitleVal.trim()) {
                                onRename(screenplay.id, headerTitleVal.trim());
                            }
                            setHeaderTitleEditing(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (headerTitleVal.trim()) {
                                    onRename(screenplay.id, headerTitleVal.trim());
                                }
                                setHeaderTitleEditing(false);
                            }
                            if (e.key === 'Escape') {
                                setHeaderTitleEditing(false);
                            }
                        }}
                        autoFocus
                        className="bg-transparent border-b border-indigo-500 outline-none text-gray-900 dark:text-gray-100 min-w-[200px]"
                    />
                 ) : (
                    <span
                        onDoubleClick={() => {
                            setHeaderTitleVal(screenplay.metadata.title);
                            setHeaderTitleEditing(true);
                        }}
                        className="cursor-text hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title="Double click to rename"
                    >
                        {screenplay.metadata.title}
                    </span>
                 )}
             </div>
             <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 transition-opacity duration-300">
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{t.saving}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3" />
                    <span>{t.saved}</span>
                  </>
                )}
             </div>
             {/* Pipeline mode badge: Express upgrades on click (with the
                 one-way confirm); Pro is locked — click explains why. */}
             <button
               type="button"
               aria-disabled={modeLocked}
               onClick={onModeBadgeClick}
               title={modeTitle}
               className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border transition-colors flex items-center gap-1 ${
                   mode === 'simple'
                       ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                       : 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-800'
               }`}
             >
                 {modeLocked && <Lock className="w-2.5 h-2.5" />}
                 {modeLabel}
                 {hasProData && <span className="normal-case">·</span>}
             </button>
           </div>
          <div className="flex items-center gap-2">
             <button
                onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
                className="p-2 flex items-center gap-1 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800"
                title="Switch Language"
             >
                 <Languages className="w-5 h-5" />
                 <span className="text-xs font-bold w-4">{lang === 'en' ? 'EN' : '中'}</span>
             </button>
             <button
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className="p-2 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800"
                title="Toggle Theme"
             >
                 {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
             </button>
          </div>
        </div>
  );
}
