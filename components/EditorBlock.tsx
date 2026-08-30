import React, { useRef, useEffect } from 'react';
import { ScriptBlock, BlockType, Theme } from '../types';
import { clsx } from 'clsx';
import { Image as ImageIcon, Boxes } from 'lucide-react';
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
  imagePromptOpenLabel?: string;
  onOpenImagePrompt?: (id: string) => void;
  isImagePromptPanelOpen?: boolean;
  /** Graybox (3D previs) chip — scene layout on SCENE_HEADING, camera/运镜 on
   *  ACTION/DIALOGUE. Emerald accent to distinguish from the indigo
   *  image-prompt chip when an ACTION block carries both. */
  grayboxLabel?: string;
  grayboxOpenLabel?: string;
  onOpenGraybox?: (id: string) => void;
  isGrayboxPanelOpen?: boolean;
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
  imagePromptOpenLabel = 'View',
  onOpenImagePrompt,
  isImagePromptPanelOpen = false,
  grayboxLabel = 'Graybox',
  grayboxOpenLabel = 'View',
  onOpenGraybox,
  isGrayboxPanelOpen = false
}: EditorBlockProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

      {/* Storyboard image prompt chip (ACTION / CHARACTER blocks).
          Clicking it opens the prompt in a right-side drawer (handled in App)
          instead of expanding inline, so it costs only one line of editor space. */}
      {block.imagePrompt && block.imagePrompt.trim() && (block.type === 'ACTION' || block.type === 'CHARACTER') && (
        <button
          type="button"
          onClick={() => onOpenImagePrompt?.(block.id)}
          className={clsx(
            "mt-2 ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-colors",
            isImagePromptPanelOpen
              ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800"
              : "bg-indigo-50/60 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400 border-indigo-200/60 dark:border-indigo-900/40 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/20"
          )}
        >
          <ImageIcon className="w-3 h-3" />
          <span>{imagePromptLabel}</span>
          <span className="font-sans normal-case tracking-normal opacity-60">· {imagePromptOpenLabel}</span>
        </button>
      )}

      {/* Graybox (3D previs) chip (SCENE_HEADING / ACTION / DIALOGUE blocks).
          Mirrors the image-prompt chip but emerald-accented so the two are
          visually distinct when an ACTION carries both. CHARACTER is excluded —
          it owns the image-prompt design sheet, graybox is space + camera. */}
      {block.graybox && (block.type === 'SCENE_HEADING' || block.type === 'ACTION' || block.type === 'DIALOGUE') && (
        <button
          type="button"
          onClick={() => onOpenGraybox?.(block.id)}
          className={clsx(
            "mt-2 ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-colors",
            isGrayboxPanelOpen
              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
              : "bg-emerald-50/60 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-900/40 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/20"
          )}
        >
          <Boxes className="w-3 h-3" />
          <span>{grayboxLabel}</span>
          <span className="font-sans normal-case tracking-normal opacity-60">· {grayboxOpenLabel}</span>
        </button>
      )}
    </div>
  );
};