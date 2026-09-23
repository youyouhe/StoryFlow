import { useCallback } from 'react';
import { BlockType, Screenplay } from '../types';

/**
 * The BLOCK-EDITING domain: the four screenplay mutation handlers the editor
 * and the side panel share (content edit, type change, image-prompt delete
 * with same-character propagation, graybox delete).
 *
 * Extracted verbatim from App.tsx (wave 2 of the App split).
 */
export function useBlockEditing({ setScreenplay, isReadOnly }: {
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  isReadOnly: boolean;
}) {
  const handleBlockChange = useCallback((id: string, content: string) => {
    if (isReadOnly) return;
    setScreenplay(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => b.id === id ? { ...b, content } : b),
      lastModified: Date.now()
    }));
  }, [isReadOnly]);

  const handleTypeChange = useCallback((id: string, type: BlockType) => {
    if (isReadOnly) return;
    setScreenplay(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => b.id === id ? { ...b, type } : b)
    }));
  }, [isReadOnly]);

  // Delete a block's storyboard image prompt. For CHARACTER blocks, the same
  // character may appear in multiple blocks sharing one prompt — deleting on
  // one occurrence clears the prompt from ALL same-name CHARACTER blocks, so
  // "one prompt per character" stays consistent (mirrors the save propagation).
  const handleDeleteImagePrompt = useCallback((id: string) => {
    if (isReadOnly) return;
    setScreenplay(prev => {
      const target = prev.blocks.find(b => b.id === id);
      const isCharacter = target?.type === 'CHARACTER';
      const charName = isCharacter ? target!.content.trim() : '';
      return {
        ...prev,
        blocks: prev.blocks.map(b => {
          if (b.id === id) {
            const { imagePrompt, ...rest } = b;
            return imagePrompt ? rest : b;
          }
          if (isCharacter && b.type === 'CHARACTER' && b.content.trim() === charName && b.imagePrompt) {
            const { imagePrompt, ...rest } = b;
            return rest;
          }
          return b;
        }),
        lastModified: Date.now()
      };
    });
  }, [isReadOnly]);

  // Delete the graybox payload from a single block. Unlike image prompts there
  // is no same-name CHARACTER propagation — graybox is per-block (a scene
  // heading owns the layout; each action/dialogue owns its own camera).
  const handleDeleteGraybox = useCallback((id: string) => {
    if (isReadOnly) return;
    setScreenplay(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => {
        if (b.id === id) {
          const { graybox, ...rest } = b;
          return graybox ? rest : b;
        }
        return b;
      }),
      lastModified: Date.now()
    }));
  }, [isReadOnly]);

  return { handleBlockChange, handleTypeChange, handleDeleteImagePrompt, handleDeleteGraybox };
}
