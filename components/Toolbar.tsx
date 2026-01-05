import React from 'react';
import { BlockType } from '../types';
import { clsx } from 'clsx';
import { Wand2, Type, Eye, Edit3 } from 'lucide-react';
import { TRANSLATIONS } from '../constants';

interface ToolbarProps {
  currentType: BlockType;
  onSetType: (type: BlockType) => void;
  onAIAction: () => void;
  isAILoading: boolean;
  t: typeof TRANSLATIONS['en'];
  isReadOnly: boolean;
  onToggleReadOnly: () => void;
}

const TYPES: BlockType[] = ['SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE', 'PARENTHETICAL', 'TRANSITION'];

export const Toolbar: React.FC<ToolbarProps> = ({ currentType, onSetType, onAIAction, isAILoading, t, isReadOnly, onToggleReadOnly }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center pb-8">
      <div className="pointer-events-auto bg-white/90 dark:bg-[#18181b]/90 backdrop-blur-xl border border-gray-200/50 dark:border-zinc-700/50 shadow-2xl shadow-gray-200/50 dark:shadow-black/50 rounded-2xl px-2 py-2 flex items-center gap-1 sm:gap-1.5 mx-4 overflow-x-auto max-w-full no-scrollbar ring-1 ring-black/5 dark:ring-white/10">
        
        {/* View/Edit Mode Toggle */}
        <button
          onClick={onToggleReadOnly}
          className={clsx(
             "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 mr-1 border",
             isReadOnly 
               ? "bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400" 
               : "bg-gray-100 border-gray-200 text-gray-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-gray-300"
          )}
          title={isReadOnly ? t.editMode : t.viewMode}
        >
             {isReadOnly ? <Edit3 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
             <span className="hidden sm:inline">{isReadOnly ? t.viewMode : t.editMode}</span>
        </button>

        {/* Formatting Tools (Hidden in Read Only) */}
        {!isReadOnly && (
            <>
                {/* Mobile Type Icon */}
                <div className="sm:hidden flex items-center px-2 border-r border-gray-200 dark:border-zinc-700">
                    <Type className="w-4 h-4 text-gray-400" />
                </div>

                {TYPES.map((type) => (
                <button
                    key={type}
                    onClick={() => onSetType(type)}
                    className={clsx(
                    "px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200",
                    currentType === type
                        ? "bg-gray-900 dark:bg-white text-white dark:text-black shadow-md transform scale-100 font-bold"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-200"
                    )}
                    title={`Set to ${t.blockLabels[type]}`}
                >
                    {t.blockLabels[type]}
                </button>
                ))}

                <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700 mx-1" />

                <button
                onClick={onAIAction}
                disabled={isAILoading}
                className={clsx(
                    "flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm",
                    isAILoading 
                    ? "bg-indigo-400 cursor-not-allowed" 
                    : "bg-indigo-600 hover:bg-indigo-500 dark:bg-indigo-600 dark:hover:bg-indigo-500 hover:shadow-indigo-500/20"
                )}
                >
                <Wand2 className={clsx("w-3.5 h-3.5", isAILoading && "animate-spin")} />
                <span className="hidden sm:inline">{isAILoading ? t.aiWorking : t.aiButton}</span>
                </button>
            </>
        )}
      </div>
    </div>
  );
};