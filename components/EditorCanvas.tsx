import React, { useState, useCallback } from 'react';
import { Screenplay, ScriptBlock, AIState, AIMode, AppSettings, RefBindings, RefImage, H3Task } from '../types';
import { EditorBlock } from './EditorBlock';
import { PromptPanel } from './PromptPanel';
import { paginateBlocks } from '../utils/pagination';

/**
 * EditorCanvas — the paginated page stack: every EditorBlock plus the
 * storyboard/graybox side drawer (PromptPanel).
 *
 * Wave-2 UI split: the side-panel open state (which block, which tab) and the
 * inline image-generation feedback (busy flag, error, preview) are LOCAL to
 * the canvas — their only consumers are the blocks and the drawer below.
 */
interface EditorCanvasProps {
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  selectedBlockId: string;
  setSelectedBlockId: React.Dispatch<React.SetStateAction<string>>;
  handleKeyDown: (e: React.KeyboardEvent, id: string, selectionStart: number) => void;
  handleBlockChange: (id: string, content: string) => void;
  handleTypeChange: (id: string, type: ScriptBlock['type']) => void;
  handleDeleteGraybox: (id: string) => void;
  handleDeleteImagePrompt: (id: string) => void;
  t: typeof import('../constants').TRANSLATIONS['en'];
  theme: 'light' | 'dark';
  lang: 'en' | 'zh';
  appSettings: AppSettings;
  isReadOnly: boolean;
  refImages: RefImage[];
  refBindings: RefBindings;
  onRefBindingsChange: (next: RefBindings) => void;
  onUploadRefImage: EditorCanvasUploadFn;
  onRemoveRefImage: (id: string) => void;
  setShowAssetLibrary: React.Dispatch<React.SetStateAction<boolean>>;
  onSubmitH3: React.ComponentProps<typeof PromptPanel>['onSubmitH3'];
  h3Tasks: H3Task[];
  h3Ready: boolean;
  imageReady: boolean;
  effectiveImageProvider: 'minimax' | 'fal';
}

/** Mirrors App.tsx's upload signature (identity-aware asset creation). */
type EditorCanvasUploadFn = (
  file: File,
  subject?: string,
  sourcePrompt?: string,
  source?: 'upload' | 'ai-generate' | 'video-frame',
  identity?: { kind: 'character' | 'environment' | 'prop' | 'action'; charName?: string; variant?: string; sceneKey?: string },
) => Promise<string | null>;

export function EditorCanvas({
  screenplay, setScreenplay,
  selectedBlockId, setSelectedBlockId,
  handleKeyDown, handleBlockChange, handleTypeChange,
  handleDeleteGraybox, handleDeleteImagePrompt,
  t, theme, lang, appSettings, isReadOnly,
  refImages, refBindings, onRefBindingsChange, onUploadRefImage, onRemoveRefImage,
  setShowAssetLibrary,
  onSubmitH3, h3Tasks, h3Ready, imageReady, effectiveImageProvider,
}: EditorCanvasProps) {
  // Storyboard prompt side-panel: when a block's prompt chip is clicked, its
  // full content is shown in a right-side drawer instead of expanding inline
  // (which ate editor space). Holds the block id whose prompt is open, or null.
  const [promptPanelBlockId, setPromptPanelBlockId] = useState<string | null>(null);
  // Which payload the side panel shows when a block holds both an imagePrompt
  // and a graybox. The opener handlers set this so the panel opens on the
  // payload whose chip was clicked.
  const [panelTab, setPanelTab] = useState<'prompt' | 'graybox' | 'graybox3d'>('prompt');
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGenError, setImageGenError] = useState<string | null>(null);
  // Inline success preview at the click site (the image is already in the
  // library; this just shows it where the user generated it).
  const [imageGenPreview, setImageGenPreview] = useState<{ blockId: string; url: string; subject: string } | null>(null);
  const openImagePromptPanel = useCallback((id: string) => {
    setPanelTab('prompt');
    setPromptPanelBlockId(id);
  }, []);
  const openGrayboxPanel = useCallback((id: string) => {
    setPanelTab('graybox3d');
    setPromptPanelBlockId(id);
  }, []);

  const pages = paginateBlocks(screenplay.blocks);

  return (
    <>
        {/* Editor Canvas (Pagination Implemented) */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden bg-desk dark:bg-desk-dark flex flex-col items-center py-8 px-4 sm:px-8 pb-32 scroll-smooth space-y-8"
          onClick={(e) => {
              // Click on background logic to focus end
              if (e.target === e.currentTarget && screenplay.blocks.length === 0 && !isReadOnly) {
                 // handle empty script case if needed
              }
          }}
        >
          {pages.map((pageBlocks, pageIndex) => (
             <div
                key={pageIndex}
                className="w-full max-w-3xl min-h-[1056px] bg-paper dark:bg-paper-dark shadow-2xl shadow-gray-300/50 dark:shadow-black/60 rounded-sm p-8 sm:p-16 transition-all duration-300 relative border border-transparent dark:border-zinc-800"
             >
                 <div className="absolute top-4 right-6 text-[10px] text-gray-300 dark:text-zinc-700 font-mono select-none">
                     p. {pageIndex + 1}
                 </div>
                 <div className="space-y-1">
                    {pageBlocks.map(block => (
                        <div id={`block-${block.id}`} key={block.id}>
                            <EditorBlock
                                block={block}
                                isSelected={selectedBlockId === block.id}
                                onChange={handleBlockChange}
                                onKeyDown={handleKeyDown}
                                onFocus={setSelectedBlockId}
                                onChangeType={handleTypeChange}
                                placeholders={t.placeholders}
                                readOnly={isReadOnly}
                                customColor={appSettings.colorSettings[block.type]}
                                theme={theme}
                                imagePromptLabel={t.storyboardPromptLabel}
                                imagePromptOpenLabel={t.imagePromptOpen}
                                onOpenImagePrompt={openImagePromptPanel}
                                isImagePromptPanelOpen={promptPanelBlockId === block.id}
                                imageThumbUrl={
                                  block.imageResult
                                    ? refImages.find(r => r.id === block.imageResult?.assetId)?.url
                                    : undefined
                                }
                                grayboxLabel={t.grayboxLabel}
                                grayboxOpenLabel={t.grayboxOpen}
                                onOpenGraybox={openGrayboxPanel}
                                isGrayboxPanelOpen={promptPanelBlockId === block.id}
                            />
                        </div>
                    ))}
                 </div>
                 {pageIndex === pages.length - 1 && <div className="h-48" />}
             </div>
          ))}

          {/* Storyboard prompt / Graybox side-panel.
              Instead of expanding the prompt inline (which consumed editor
              vertical space), clicking a block's prompt/graybox chip opens
              this right-side drawer. A block may hold BOTH an imagePrompt and a
              graybox (e.g. an ACTION with a storyboard + a camera shot) — in
              that case a tiny segmented toggle switches the payload shown. */}
          {(() => {
            const panelBlock = promptPanelBlockId
              ? screenplay.blocks.find(b => b.id === promptPanelBlockId)
              : null;
            if (!panelBlock) return null;
            return (
              <PromptPanel
                panelBlock={panelBlock}
                panelTab={panelTab}
                setPanelTab={setPanelTab}
                setPromptPanelBlockId={setPromptPanelBlockId}
                screenplay={screenplay}
                theme={theme}
                lang={lang}
                t={t}
                refImages={refImages}
                refBindings={refBindings}
                onRefBindingsChange={onRefBindingsChange}
                onUploadRefImage={onUploadRefImage}
                onRemoveRefImage={onRemoveRefImage}
                setShowAssetLibrary={setShowAssetLibrary}
                setScreenplay={setScreenplay}
                onSubmitH3={onSubmitH3}
                h3Tasks={h3Tasks}
                h3Ready={h3Ready}
                imageReady={imageReady}
                effectiveImageProvider={effectiveImageProvider}
                appSettings={appSettings}
                imageGenerating={imageGenerating}
                setImageGenerating={setImageGenerating}
                imageGenError={imageGenError}
                setImageGenError={setImageGenError}
                imageGenPreview={imageGenPreview}
                setImageGenPreview={setImageGenPreview}
                isReadOnly={isReadOnly}
                onDeleteGraybox={handleDeleteGraybox}
                onDeleteImagePrompt={handleDeleteImagePrompt}
              />
            );
          })()}
        </div>

    </>
  );
}
