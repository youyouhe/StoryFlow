import React, { useRef, useEffect, useState } from 'react';
import { ScriptBlock, BlockType, Theme } from '../types';
import { clsx } from 'clsx';
import { Image as ImageIcon, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { adaptColorForTheme } from '../utils/color';

interface EditorBlockProps {
  block: ScriptBlock;
  isSelected: boolean;
  onChange: (id: string, content: string) => void;
  onKeyDown: (e: React.KeyboardEvent, id: string, selectionStart: number) => void;
  onFocus: (id: string) => void;
  onChangeType: (id: string, type: BlockType) => void;
  showControls?: boolean;
  placeholders: Record<BlockType, string>;
  readOnly?: boolean;
  customColor?: string;
  theme?: Theme;
  imagePromptLabel?: string;
  imagePromptCopyLabel?: string;
}

// Map styles for screenplay formatting with distinct light/dark themes
const getTypeStyles = (type: BlockType): string => {
  switch (type) {
    case 'SCENE_HEADING':
      return 'font-bold uppercase mb-4 mt-8 text-black dark:text-white tracking-wide';
    case 'ACTION':
      return 'mb-4 text-gray-900 dark:text-gray-300 leading-relaxed';
    case 'CHARACTER':
      return 'uppercase font-bold mt-4 mb-0 text-center w-2/3 mx-auto tracking-wider text-teal-700 dark:text-teal-400';
    case 'DIALOGUE':
      return 'mb-4 text-center w-3/4 mx-auto text-gray-900 dark:text-gray-300 leading-relaxed';
    case 'PARENTHETICAL':
      return 'mb-0 text-center w-1/2 mx-auto italic text-gray-600 dark:text-gray-500';
    case 'TRANSITION':
      return 'uppercase font-bold text-right mt-6 mb-4 mr-0 ml-auto w-1/3 text-black dark:text-white';
    default:
      return '';
  }
};

export const EditorBlock: React.FC<EditorBlockProps> = ({ 
  block, 
  isSelected, 
  onChange, 
  onKeyDown, 
  onFocus,
  onChangeType,
  showControls,
  placeholders,
  readOnly = false,
  customColor,
  theme = 'light',
  imagePromptLabel = 'Image Prompt',
  imagePromptCopyLabel = 'Copy'
}: EditorBlockProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [promptExpanded, setPromptExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [block.content, block.type]);

  // Focus management
  useEffect(() => {
    if (isSelected && textareaRef.current && !readOnly) {
      textareaRef.current.focus();
    }
  }, [isSelected, readOnly]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let val = e.target.value;
    if (block.type === 'SCENE_HEADING' || block.type === 'CHARACTER' || block.type === 'TRANSITION') {
      val = val.toUpperCase();
    }
    onChange(block.id, val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown(e, block.id, e.currentTarget.selectionStart);
  };

  // Build style object for custom colors.
  // The user picks colors tuned for light mode; in dark mode we auto-derive a
  // legible variant (hue preserved, lightness/saturation adjusted) so a single
  // palette works across both themes. Empty values fall back to Tailwind theme classes.
  const resolvedColor = adaptColorForTheme(customColor, theme);
  const styles = resolvedColor ? { color: resolvedColor } : {};

  return (
    <div className="relative group block-container rounded px-2 -mx-2">
      {/* Type Indicator / Quick Switcher (Visible on hover or focus) - Hide in Read Only */}
      {!readOnly && (
        <div className={clsx(
            "absolute -left-16 top-1.5 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-end gap-1 pr-4 select-none w-16",
            isSelected && "opacity-100"
        )}>
            <span className="font-sans text-[10px] uppercase tracking-tighter font-semibold text-gray-400 dark:text-gray-600">{block.type.replace('_', ' ')}</span>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={block.content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => !readOnly && onFocus(block.id)}
        readOnly={readOnly}
        placeholder={isSelected && !readOnly ? placeholders[block.type] : ''}
        style={styles}
        className={clsx(
          "w-full resize-none bg-transparent outline-none border-none overflow-hidden font-mono text-base md:text-[1.05rem] caret-indigo-600 dark:caret-indigo-400 selection:bg-indigo-100 dark:selection:bg-indigo-500/30 placeholder:text-gray-300 dark:placeholder:text-zinc-700",
          getTypeStyles(block.type),
          readOnly && "cursor-default"
        )}
        rows={1}
        spellCheck={false}
      />

      {/* Storyboard image prompt (ACTION blocks only, when a prompt is saved) */}
      {block.type === 'ACTION' && block.imagePrompt && block.imagePrompt.trim() && (
        <div className="mt-2 ml-2 rounded-lg border border-indigo-200/60 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-900/10 overflow-hidden">
          <button
            type="button"
            onClick={() => setPromptExpanded(v => !v)}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <ImageIcon className="w-3 h-3" />
            <span>{imagePromptLabel}</span>
            {promptExpanded
              ? <ChevronDown className="w-3 h-3 ml-auto" />
              : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {promptExpanded && (
            <div className="px-3 pb-2.5 pt-0.5">
              <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-indigo-900/80 dark:text-indigo-200/70 select-text">
                {block.imagePrompt}
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(block.imagePrompt || '').catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied ? '✓' : imagePromptCopyLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};