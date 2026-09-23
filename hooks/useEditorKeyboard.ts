import { useCallback, useRef } from 'react';
import { BlockType, ScriptBlock, Screenplay, AppSettings, AIMode } from '../types';
import { generateSequences } from '../services/geminiService';
import { galleryClient } from '../services/gallery';

const generateId = () => Math.random().toString(36).substring(2, 11);

const getNextType = (currentType: BlockType): BlockType => {
  switch (currentType) {
    case 'SCENE_HEADING': return 'ACTION';
    case 'ACTION': return 'ACTION';
    case 'CHARACTER': return 'DIALOGUE';
    case 'DIALOGUE': return 'CHARACTER';
    case 'PARENTHETICAL': return 'DIALOGUE';
    case 'TRANSITION': return 'SCENE_HEADING';
    default: return 'ACTION';
  }
};

const getCycledType = (currentType: BlockType, shiftKey: boolean): BlockType => {
  const cycleOrder: BlockType[] = ['SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE', 'PARENTHETICAL', 'TRANSITION'];
  const idx = cycleOrder.indexOf(currentType);
  if (shiftKey) {
     return cycleOrder[(idx - 1 + cycleOrder.length) % cycleOrder.length];
  }
  return cycleOrder[(idx + 1) % cycleOrder.length];
};

const checkShortcut = (e: React.KeyboardEvent, shortcut: string): boolean => {
    if (!shortcut) return false;
    const parts = shortcut.split('+');
    const mainKey = parts.pop()?.toUpperCase();
    const modifiers = parts;

    const meta = e.metaKey;
    const ctrl = e.ctrlKey;
    const alt = e.altKey;
    const shift = e.shiftKey;

    // Check main key
    if (e.key.toUpperCase() !== mainKey) return false;

    // Check modifiers
    const hasMeta = modifiers.includes('Meta');
    const hasCtrl = modifiers.includes('Ctrl');
    const hasAlt = modifiers.includes('Alt');
    const hasShift = modifiers.includes('Shift');

    return meta === hasMeta && ctrl === hasCtrl && alt === hasAlt && shift === hasShift;
};

/**
 * The EDITOR KEYBOARD domain: per-block key handling — the configurable AI
 * shortcuts (including the one-shot background sequence refresh on scene-level
 * Alt+G), the cloud-sync shortcut, and the hardcoded editing keys (Enter/merge/
 * Tab cycle/arrow navigation).
 *
 * Extracted verbatim from App.tsx (wave 2 of the App split); the three pure
 * helpers above moved with it. AI triggering arrives as `executeAI`, sync as
 * `handleSyncScript`/`setSyncError`.
 */
export function useEditorKeyboard({
  appSettings, screenplay, setScreenplay, setSelectedBlockId,
  handleTypeChange, isReadOnly, t, executeAI, handleSyncScript, setSyncError,
  setAIMode, setShowAIModal,
}: {
  appSettings: AppSettings;
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  setSelectedBlockId: React.Dispatch<React.SetStateAction<string>>;
  handleTypeChange: (id: string, type: BlockType) => void;
  isReadOnly: boolean;
  t: typeof import('../constants').TRANSLATIONS['en'];
  executeAI: (modeOverride?: AIMode) => Promise<void>;
  handleSyncScript: (id: string) => Promise<void>;
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  setAIMode: React.Dispatch<React.SetStateAction<AIMode>>;
  setShowAIModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // Guards the one-time background sequence refresh on first scene-level Alt+G.
  const hasSequenceRun = useRef(false);
  const handleKeyDown = useCallback((e: React.KeyboardEvent, id: string, selectionStart: number) => {
    if (isReadOnly) return;

    // Check AI Shortcuts - Trigger executeAI immediately
    if (appSettings.shortcuts) {
        if (checkShortcut(e, appSettings.shortcuts.aiContinue)) {
            e.preventDefault();
            setAIMode('CONTINUE');
            setShowAIModal(true);
            executeAI('CONTINUE');
            return;
        }
        if (checkShortcut(e, appSettings.shortcuts.aiIdeas)) {
            e.preventDefault();
            setAIMode('IDEAS');
            setShowAIModal(true);
            executeAI('IDEAS');
            return;
        }
        if (checkShortcut(e, appSettings.shortcuts.aiRewrite)) {
            e.preventDefault();
            setAIMode('REWRITE');
            setShowAIModal(true);
            executeAI('REWRITE');
            return;
        }
        if (checkShortcut(e, appSettings.shortcuts.aiStoryboard)) {
            // Trigger on SCENE_HEADING (environment sheet), ACTION (storyboard
            // frame), or CHARACTER (design sheet) blocks.
            const currentBlock = screenplay.blocks.find(b => b.id === id);
            if (currentBlock?.type === 'ACTION' || currentBlock?.type === 'CHARACTER' || currentBlock?.type === 'SCENE_HEADING') {
                e.preventDefault();
                setAIMode('STORYBOARD');
                setShowAIModal(true);
                executeAI('STORYBOARD');
                return;
            }
        }
        if (checkShortcut(e, appSettings.shortcuts.syncCloud)) {
            e.preventDefault();
            if (!galleryClient.isAuthenticated) {
                setSyncError(t.gallery_signInToSync);
                return;
            }
            void handleSyncScript(screenplay.id);
            return;
        }
        if (checkShortcut(e, appSettings.shortcuts.aiGraybox)) {
            // Trigger on SCENE_HEADING (layout + blocking), ACTION, or DIALOGUE
            // (camera/运镜). CHARACTER is excluded — it owns the image-prompt
            // design sheet, graybox is about space + camera.
            // Skipped in simple production mode (no spatial blocking needed).
            if (screenplay.productionMode === 'simple') return;
            const currentBlock = screenplay.blocks.find(b => b.id === id);
            if (currentBlock?.type === 'SCENE_HEADING' || currentBlock?.type === 'ACTION' || currentBlock?.type === 'DIALOGUE') {
                e.preventDefault();
                setAIMode('GRAYBOX');
                setShowAIModal(true);
                executeAI('GRAYBOX');
                // Refresh the script's Sequence segmentation + per-character
                // wardrobe/age in the background whenever a scene-level previs
                // runs. This keeps `screenplay.sequences` fresh so later frames
                // (frame gen / storyboard) read the right costume/age. Fires
                // only on a SCENE_HEADING target; single-shot / other targets
                // skip the (relatively costly) full-script continuity pass.
                if (currentBlock.type === 'SCENE_HEADING' && screenplay.blocks.length > 0 && !hasSequenceRun.current) {
                    hasSequenceRun.current = true;
                    void (async () => {
                        try {
                            const seqs = await generateSequences(screenplay.blocks, appSettings);
                            if (seqs.length) {
                                setScreenplay(prev => ({ ...prev, sequences: seqs, lastModified: Date.now() }));
                            }
                        } catch { /* sequence refresh is best-effort — frames degrade to no-wardrobe */ }
                    })();
                }
                return;
            }
        }
    }
    
    const currentIndex = screenplay.blocks.findIndex(b => b.id === id);
    const currentBlock = screenplay.blocks[currentIndex];

    if (e.key === 'Enter') {
      e.preventDefault();
      
      if (currentBlock.content.trim() === '' && currentBlock.type === 'DIALOGUE') {
         handleTypeChange(id, 'ACTION');
         return;
      }

      const nextType = getNextType(currentBlock.type);
      const newBlock: ScriptBlock = { id: generateId(), type: nextType, content: '' };
      
      setScreenplay(prev => {
        const newBlocks = [...prev.blocks];
        newBlocks.splice(currentIndex + 1, 0, newBlock);
        return { ...prev, blocks: newBlocks };
      });
      setSelectedBlockId(newBlock.id);
    }

    if (e.key === 'Backspace' && selectionStart === 0 && currentIndex > 0) {
      e.preventDefault();
      const prevBlock = screenplay.blocks[currentIndex - 1];
      
      setScreenplay(prev => {
        const newBlocks = [...prev.blocks];
        newBlocks[currentIndex - 1] = {
           ...prevBlock,
           content: prevBlock.content + currentBlock.content
        };
        newBlocks.splice(currentIndex, 1);
        return { ...prev, blocks: newBlocks };
      });
      setSelectedBlockId(prevBlock.id);
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const nextType = getCycledType(currentBlock.type, e.shiftKey);
      handleTypeChange(id, nextType);
    }

    // Improved Navigation Logic
    if (e.key === 'ArrowUp' && currentIndex > 0) {
      if (e.metaKey || e.ctrlKey || selectionStart === 0) {
        e.preventDefault();
        setSelectedBlockId(screenplay.blocks[currentIndex - 1].id);
      }
    }
    
    if (e.key === 'ArrowDown' && currentIndex < screenplay.blocks.length - 1) {
      if (e.metaKey || e.ctrlKey || selectionStart === currentBlock.content.length) {
        e.preventDefault();
        setSelectedBlockId(screenplay.blocks[currentIndex + 1].id);
      }
    }
    
    if (e.key === 'ArrowLeft' && selectionStart === 0 && currentIndex > 0) {
        e.preventDefault();
        setSelectedBlockId(screenplay.blocks[currentIndex - 1].id);
    }
    if (e.key === 'ArrowRight' && selectionStart === currentBlock.content.length && currentIndex < screenplay.blocks.length - 1) {
        e.preventDefault();
        setSelectedBlockId(screenplay.blocks[currentIndex + 1].id);
    }

  }, [screenplay.blocks, handleTypeChange, isReadOnly, appSettings.shortcuts, executeAI, handleSyncScript, screenplay.id, t]);
  return { handleKeyDown };
}
