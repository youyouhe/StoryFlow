import React, { useState } from 'react';
import { X, Cloud, Trash2, Boxes, Image as ImageIcon, ZoomIn } from 'lucide-react';
import { clsx } from 'clsx';
import { TRANSLATIONS } from '../constants';
import type { ScriptBlock, Screenplay, GrayboxData, RefImage, RefBindings, H3Task, AppSettings, Language } from '../types';
import { Graybox3DView } from './Graybox3DView';
import { resolveActionRef, resolveFrameRefs, resolveCharacterSheet } from '../utils/refBindings';
import { sequenceAt, wardrobeIn } from '../utils/sequence';
import { computeBeatCast, parseCharacterName, resolveBeatVariant } from '../utils/beatCast';
import { grayboxOverviewLine } from '../utils/exportData';
import { buildBlenderScript, downloadBlenderScript, blenderScriptFilename } from '../utils/grayboxToBlender';
import { generateImages } from '../services/minimaxService';

interface PromptPanelProps {
  /** The block whose AI payload this panel shows. Non-null: the parent only
   *  renders the panel when a valid block is selected. */
  panelBlock: ScriptBlock;
  panelTab: 'prompt' | 'graybox' | 'graybox3d';
  setPanelTab: React.Dispatch<React.SetStateAction<'prompt' | 'graybox' | 'graybox3d'>>;
  setPromptPanelBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  screenplay: Screenplay;
  theme: 'light' | 'dark';
  lang: Language;
  t: typeof TRANSLATIONS['en'];
  refImages: RefImage[];
  refBindings: RefBindings;
  onRefBindingsChange: (next: RefBindings) => void;
  onUploadRefImage: (
    file: File,
    subject?: string,
    sourcePrompt?: string,
    source?: 'upload' | 'ai-generate' | 'video-frame',
    identity?: { kind: 'character' | 'environment' | 'prop' | 'action'; charName?: string; variant?: string; sceneKey?: string },
  ) => Promise<string | null>;
  onRemoveRefImage: (id: string) => void;
  setShowAssetLibrary: React.Dispatch<React.SetStateAction<boolean>>;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  onSubmitH3: (payload: {
    blockId: string;
    blockContent: string;
    videoBlob: Blob;
    videoSeconds: number;
    prompt: string;
    resolution: '768P' | '2K';
    outputSeconds: number;
    referenceImageUrls: string[];
    targetSeconds?: number;
    segmentIndex?: number;
    segmentCount?: number;
    chainId?: string;
  }) => Promise<{ ok: true; taskId: string } | { ok: false; error: string }>;
  h3Tasks: H3Task[];
  h3Ready: boolean;
  imageReady: boolean;
  effectiveImageProvider: 'minimax' | 'fal';
  appSettings: AppSettings;
  imageGenerating: boolean;
  setImageGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  imageGenError: string | null;
  setImageGenError: React.Dispatch<React.SetStateAction<string | null>>;
  imageGenPreview: { blockId: string; url: string; subject: string } | null;
  setImageGenPreview: React.Dispatch<React.SetStateAction<{ blockId: string; url: string; subject: string } | null>>;
  isReadOnly: boolean;
  onDeleteGraybox: (id: string) => void;
  onDeleteImagePrompt: (id: string) => void;
}

export const PromptPanel: React.FC<PromptPanelProps> = ({
  panelBlock,
  panelTab,
  setPanelTab,
  setPromptPanelBlockId,
  screenplay,
  theme,
  lang,
  t,
  refImages,
  refBindings,
  onRefBindingsChange,
  onUploadRefImage,
  onRemoveRefImage,
  setShowAssetLibrary,
  setScreenplay,
  onSubmitH3,
  h3Tasks,
  h3Ready,
  imageReady,
  effectiveImageProvider,
  appSettings,
  imageGenerating,
  setImageGenerating,
  imageGenError,
  setImageGenError,
  imageGenPreview,
  setImageGenPreview,
  isReadOnly,
  onDeleteGraybox,
  onDeleteImagePrompt,
}) => {
  const hasPrompt = !!panelBlock.imagePrompt?.trim();
  const hasGraybox = !!panelBlock.graybox;
  if (!hasPrompt && !hasGraybox) return null;

  // CHARACTER identity for a variant cue: `张三（浴袍）` → store base 张三 with
  // variant 浴袍 so the sheet lands in the right slot (subject 张三/浴袍).
  const parseIntCtxChar = (b: ScriptBlock, subj: string) => {
    const p = parseCharacterName(b.content.trim());
    const nm = p.base || subj;
    return { kind: 'character' as const, charName: nm, ...(p.variant ? { variant: p.variant } : {}) };
  };

  // When both exist, the chip that opened the panel decides the
  // initial view; the segmented control below lets the user switch.
  // graybox3d = the Three.js previs; graybox = the raw JSON view.
  const showingGrayboxJSON = hasGraybox && panelTab === 'graybox';
  const showing3D = hasGraybox && panelTab === 'graybox3d';
  const showingGraybox = showingGrayboxJSON || showing3D;

  const copyText = showingGraybox
    ? JSON.stringify(panelBlock.graybox, null, 2)
    : (panelBlock.imagePrompt || '');

  // Owning-scene context, lifted so the 3D view AND the footer
  // Blender exporter share one lookup: the nearest SCENE_HEADING
  // at/above the panel block. Its graybox supplies the layout +
  // character blocking that shot views render (the white-model POV
  // export and the Blender export both need real geometry, not an
  // empty grid); its text feeds the Seedance/H3 prompt builder.
  const panelIdx = screenplay.blocks.findIndex(b => b.id === panelBlock.id);
  let panelSceneGraybox: GrayboxData | null = null;
  let panelSceneHeading = '';
  let panelSceneStart = 0;
  for (let i = panelIdx; i >= 0; i--) {
    const b = screenplay.blocks[i];
    if (b.type === 'SCENE_HEADING') {
      panelSceneStart = i;
      panelSceneHeading = b.content;
      if (b.graybox && b.graybox.kind === 'scene' && !b.graybox.error) {
        panelSceneGraybox = b.graybox;
      }
      break;
    }
  }
  // every shot graybox's shotType in the owning scene — feeds
  // the health check's W001 shot-variety warning
  const panelSceneShotTypes: string[] = [];
  for (let i = panelSceneStart + 1; i < screenplay.blocks.length; i++) {
    const b = screenplay.blocks[i];
    if (b.type === 'SCENE_HEADING') break;
    if (b.graybox?.kind === 'shot' && b.graybox.camera && !b.graybox.error) {
      panelSceneShotTypes.push(b.graybox.camera.shotType);
    }
  }
  // Beat cast: characters plausibly IN THIS beat — reference
  // images and capsule mappings are filtered to them.
  const panelSceneCharNames = (panelSceneGraybox?.characters ?? []).map(c => c.name);
  const panelBeatCast = panelBlock.type === 'ACTION' || panelBlock.type === 'DIALOGUE'
    ? computeBeatCast(screenplay.blocks, panelIdx, panelSceneCharNames)
    : undefined;
  // ACTION generation is image-to-image. Resolve the beat's own
  // character sheet up front so the button can gate on it and state
  // WHY when it cannot proceed, instead of silently running
  // text-to-image and letting the character's look drift.
  const panelActionRef = panelBlock.type === 'ACTION'
    ? resolveActionRef(
        screenplay.blocks, panelIdx, panelSceneCharNames,
        screenplay.referenceBindings, refImages, panelSceneHeading,
      )
    : null;

  // Reference-lock preview: what the Generate button will condition this frame
  // on — ① the character identity sheet (variant/age-aware) and ③ the scene
  // environment backdrop. Surfaced as visible chips so a MISSING lock is seen
  // BEFORE spending a generation, instead of silently degrading to text-to-image
  // and producing 穿帮.
  const refPreview = (() => {
    if (showingGraybox || !panelBlock.imagePrompt) return null;
    const seq = sequenceAt(screenplay.sequences, panelIdx);
    if (panelBlock.type === 'CHARACTER') {
      const pc = parseCharacterName(panelBlock.content);
      const sheet = resolveCharacterSheet(pc.base, screenplay.referenceBindings, refImages, panelSceneHeading, wardrobeIn(seq, pc.base).age, pc.variant);
      return {
        character: sheet,
        characterLabel: pc.variant ? `${pc.base}（${pc.variant}）` : pc.base,
        environment: undefined as RefImage | undefined,
        needsImage: false,
      };
    }
    if (panelBlock.type === 'SCENE_HEADING') {
      // The scene's own panel: only ③ applies (this IS the environment slot).
      const fr = resolveFrameRefs('environment', '', panelSceneHeading, screenplay.referenceBindings, refImages);
      return { character: undefined, environment: fr.environment, characterLabel: '', needsImage: false };
    }
    if (panelBlock.type === 'ACTION') {
      if (panelActionRef?.kind === 'ready') {
        const age = wardrobeIn(seq, panelActionRef.characterName).age;
        const fr = resolveFrameRefs('action', panelActionRef.characterName, panelSceneHeading, screenplay.referenceBindings, refImages, age, panelActionRef.variant);
        return { ...fr, characterLabel: panelActionRef.characterName + (panelActionRef.variant ? `（${panelActionRef.variant}）` : ''), needsImage: false };
      }
      if (panelActionRef?.kind === 'needs-image') {
        return { character: null, environment: undefined as RefImage | undefined, characterLabel: panelActionRef.characterName, needsImage: true };
      }
      return { character: undefined, environment: undefined as RefImage | undefined, characterLabel: '', needsImage: false }; // empty shot
    }
    if (panelBlock.type === 'DIALOGUE') {
      const name = panelBeatCast?.[0];
      if (!name) return null;
      const diagVar = resolveBeatVariant(screenplay.blocks, panelIdx, name);
      const fr = resolveFrameRefs('dialogue', name, panelSceneHeading, screenplay.referenceBindings, refImages, wardrobeIn(seq, name).age, diagVar);
      return { ...fr, characterLabel: name + (diagVar ? `（${diagVar}）` : ''), needsImage: false };
    }
    return null;
  })();

  // Generated-result thumbnail: prefer the just-generated session object, else
  // the PERSISTED prompt→asset link resolved against the live library. Object
  // urls are session-scoped, so only the id is stored on the block; we look the
  // url up here each render. null = no image to show.
  let thumb: { url: string; subject: string } | null = null;
  if (imageGenPreview?.blockId === panelBlock.id) {
    thumb = { url: imageGenPreview.url, subject: imageGenPreview.subject };
  } else {
    const link = panelBlock.imageResult
      ? refImages.find(r => r.id === panelBlock.imageResult?.assetId)
      : undefined;
    if (link?.url) thumb = { url: link.url, subject: panelBlock.imageResult?.subject ?? '' };
  }
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);
  // Bootstrap/link escape hatch: when an ACTION's character has no design
  // sheet, the panel offers (a) fresh text-to-image whose result BECOMES the
  // sheet, or (b) linking an existing library asset as the sheet. linkingChar
  // is non-null while the library picker overlay is open.
  const [linkingTarget, setLinkingTarget] = useState<
    | { kind: 'character'; name: string; variant?: string }
    | { kind: 'environment'; sceneHeading: string }
    | null
  >(null);

  return (
    <div className="fixed top-0 right-0 h-full w-full max-w-sm z-40 shadow-2xl bg-white dark:bg-[#18181b] border-l border-gray-200 dark:border-zinc-800 flex flex-col animate-in slide-in-from-right duration-200">
      <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
        <div className={`flex items-center gap-2 font-bold text-sm ${showingGraybox ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
          {showingGraybox ? <Boxes className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
          <span>{showingGraybox ? t.grayboxLabel : t.storyboardPromptLabel}</span>
        </div>
        <button
          onClick={() => { setPromptPanelBlockId(null); setPanelTab('prompt'); }}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* When multiple payloads exist, offer a switcher. Graybox
          contributes two sub-tabs: 3D previs (graybox3d) and raw
          JSON (graybox). Build the tab list dynamically so only
          existing payloads appear. */}
      {(hasPrompt && hasGraybox || hasGraybox) && hasGraybox && (() => {
        const tabs = (['prompt', 'graybox3d', 'graybox'] as const).filter(tab =>
          tab === 'prompt' ? hasPrompt : hasGraybox
        );
        return (
          <div className="px-4 pt-3 flex gap-1 flex-wrap">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setPanelTab(tab)}
                className={clsx(
                  "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-colors",
                  panelTab === tab
                    ? (tab === 'graybox3d'
                        ? "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500"
                        : tab === 'graybox'
                          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
                          : "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800")
                    : "bg-transparent text-gray-500 dark:text-gray-400 border-gray-200 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800"
                )}
              >
                {tab === 'graybox3d' ? (t.graybox3dLabel || '3D') : tab === 'graybox' ? t.grayboxLabel : t.storyboardPromptLabel}
              </button>
            ))}
          </div>
        );
      })()}

      <div className="px-4 py-2 text-[11px] font-mono text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-zinc-800 truncate">
        {panelBlock.type} · {panelBlock.content.slice(0, 40) || '(empty)'}
      </div>
      {showing3D && hasGraybox && panelBlock.graybox && (
        <div className="px-4 pt-2 pb-1">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
            {t.graybox3dHint || 'Interactive 3D previs. Drag to orbit.'}
          </p>
        </div>
      )}
      {showing3D && hasGraybox && panelBlock.graybox ? (
        (() => {
          return (
            <div className="flex-1 min-h-0 p-2">
              <Graybox3DView
                graybox={panelBlock.graybox}
                theme={theme}
                uiLang={lang}
                sceneGraybox={panelSceneGraybox}
                beat={{ type: panelBlock.type, content: panelBlock.content }}
                sceneHeading={panelSceneHeading}
                sceneShotTypes={panelSceneShotTypes}
                beatCastNames={panelBeatCast}
                scriptId={screenplay.id}
                refImages={refImages}
                refBindings={refBindings}
                onRefBindingsChange={onRefBindingsChange}
                onUploadRefImage={onUploadRefImage}
                onRemoveRefImage={onRemoveRefImage}
                onOpenAssetLibrary={() => setShowAssetLibrary(true)}
                onGrayboxChange={(next) => setScreenplay(prev => ({
                  ...prev,
                  blocks: prev.blocks.map(x => x.id === panelBlock.id ? { ...x, graybox: next } : x),
                  lastModified: Date.now(),
                }))}
                blockId={panelBlock.id}
                onSubmitH3={onSubmitH3}
                h3Tasks={h3Tasks}
                h3Ready={h3Ready}
              />
            </div>
          );
        })()
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {showingGrayboxJSON && panelBlock.graybox && (
            <p className="mb-2 px-1 text-[10px] leading-snug text-emerald-600 dark:text-emerald-400 font-sans">
              {grayboxOverviewLine(panelBlock.graybox)}
            </p>
          )}
          <pre className={`text-xs leading-relaxed font-mono whitespace-pre-wrap select-text ${showingGrayboxJSON ? 'text-emerald-900/80 dark:text-emerald-200/70' : 'text-indigo-900/80 dark:text-indigo-200/70'}`}>
            {showingGrayboxJSON ? JSON.stringify(panelBlock.graybox, null, 2) : panelBlock.imagePrompt}
          </pre>
        </div>
      )}
      {/* Reference-lock chips: make the ①/③ conditioning visible. A gray/amber
          chip here is the answer to "为什么这张图穿帮" — the lock was missing. */}
      {refPreview && !showingGraybox && (
        <div className="px-4 pt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="text-gray-400 dark:text-gray-500">{t.refLockLabel}</span>
          {/* Chips are BUTTONS: click to change/link what this frame locks to.
              Never a dead end — 不满意就换绑。 */}
          {panelBlock.type !== 'SCENE_HEADING' && (refPreview.character ? (
            <button type="button" onClick={() => setLinkingTarget({ kind: 'character', name: refPreview.characterLabel.split('（')[0], variant: refPreview.characterLabel.includes('（') ? refPreview.characterLabel.split('（')[1].replace('）','') : undefined })} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:border-indigo-500 cursor-pointer" title={t.refLockChange}>
              <img src={refPreview.character.url} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
              ① {refPreview.characterLabel}
            </button>
          ) : refPreview.needsImage ? (
            <button type="button" onClick={() => setLinkingTarget({ kind: 'character', name: refPreview.characterLabel })} className="px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:border-amber-500 cursor-pointer" title={t.refLockChange}>
              ① {refPreview.characterLabel} · {t.refLockNoSheet}
            </button>
          ) : (
            <span className="px-1.5 py-0.5 rounded-md bg-gray-50 dark:bg-zinc-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-zinc-700">
              ① {t.refLockNoCharacter}
            </span>
          ))}
          {panelBlock.type !== 'CHARACTER' && (refPreview.environment ? (
            <button type="button" onClick={() => setLinkingTarget({ kind: 'environment', sceneHeading: panelSceneHeading })} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-500 cursor-pointer" title={t.refLockChange}>
              <img src={refPreview.environment.url} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
              ③ {t.refLockEnv}
            </button>
          ) : (
            <button type="button" onClick={() => setLinkingTarget({ kind: 'environment', sceneHeading: panelSceneHeading })} className="px-1.5 py-0.5 rounded-md bg-gray-50 dark:bg-zinc-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-zinc-700 hover:border-emerald-500 cursor-pointer" title={t.refLockNoEnvHint}>
              ③ {t.refLockNoEnv}
            </button>
          ))}
        </div>
      )}
      <div className="relative p-4 border-t border-gray-100 dark:border-zinc-800 flex flex-wrap items-center gap-2">
        {!showingGraybox && panelBlock.imagePrompt && (
          <>
            {/* Generated-result thumbnail. Sources the LIVE persisted link
                (block.imageResult → library asset) so the thumbnail survives
                regenerating other blocks and reloads; imageGenPreview is only
                the just-generated session immediate feedback. Clicking enlarges
                the image inline instead of opening the whole asset library. */}
            {thumb && (
              <button
                type="button"
                onClick={() => setZoomedUrl(thumb.url)}
                title={lang === 'zh' ? '点击放大' : 'Click to enlarge'}
                className="flex items-center gap-1.5 shrink-0 group"
              >
                <div className="relative">
                  <img
                    src={thumb.url}
                    alt={thumb.subject}
                    className="w-9 h-9 rounded-md object-cover border border-emerald-400 group-hover:border-emerald-500"
                  />
                  <ZoomIn className="w-3.5 h-3.5 absolute -bottom-1 -right-1 text-white bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="hidden sm:inline text-[10px] text-emerald-600 dark:text-emerald-400 leading-tight">
                  {lang === 'zh' ? '已入库' : 'saved'}<br />
                  <span className="text-gray-400">{thumb.subject}</span>
                </span>
              </button>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id="sf-prompt-asset-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                // subject from the block itself: CHARACTER -> the
                // character name, ACTION -> 环境. The block's
                // imagePrompt rides along as provenance.
                const subject = panelBlock.type === 'CHARACTER'
                  ? panelBlock.content.trim().slice(0, 40)
                  : '环境';
                onUploadRefImage(f, subject || '环境', panelBlock.imagePrompt);
              }}
            />
            <button
              onClick={() => document.getElementById('sf-prompt-asset-file')?.click()}
              className="flex-1 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              title={lang === 'zh'
                ? '外部出图后回传：自动打 subject 并记录生成提示词（溯源）'
                : 'Import the externally-generated image: auto-tags subject and records the source prompt'}
            >
              <span className="text-sm leading-none">📥</span>
              {panelBlock.type === 'CHARACTER'
                ? (lang === 'zh' ? `存为「${panelBlock.content.trim().slice(0, 8)}」资产` : `Save as "${panelBlock.content.trim().slice(0, 12)}" asset`)
                : (lang === 'zh' ? '存为环境资产' : 'Save as env asset')}
            </button>
            <button
              onClick={async () => {
                if (imageGenerating || !imageReady) return;
                setImageGenerating(true);
                setImageGenError(null);
                try {
                  const subject = panelBlock.type === 'CHARACTER'
                    ? panelBlock.content.trim().slice(0, 40)
                    : '环境';
                  // Frame reference resolution: (①) the beat's/CHARACTER's own
                  // identity sheet + (③) the scene's environment backdrop for
                  // DIALOGUE/ACTION frames. A CHARACTER sheet generation gets
                  // NO env reference — 独立背景 rule. Age is taken from the
                  // sequence this block sits in.
                  const panelBlockIdx = screenplay.blocks.findIndex(b => b.id === panelBlock.id);
                  let envScene = '';
                  for (let i = panelBlockIdx; i >= 0; i--) {
                    if (screenplay.blocks[i].type === 'SCENE_HEADING') { envScene = screenplay.blocks[i].content; break; }
                  }
                  const seq = sequenceAt(screenplay.sequences, panelBlockIdx);
                  // needs-image escape hatch (a): this beat generates fresh and
                  // its result is adopted as the character's design sheet.
                  const bootstrapChar = panelBlock.type === 'ACTION' && panelActionRef?.kind === 'needs-image'
                    ? panelActionRef
                    : null;
                  const parsedName = panelBlock.type === 'CHARACTER'
                    ? parseCharacterName(panelBlock.content)
                    : (panelActionRef?.kind === 'ready' || panelActionRef?.kind === 'needs-image')
                      ? parseCharacterName(panelActionRef.characterName || (panelActionRef.kind==='needs-image' ? panelActionRef.characterName : ''))
                      : parseCharacterName('');
                  const base = parsedName.base;
                  const variant = panelBlock.type === 'CHARACTER'
                    ? parsedName.variant
                    : (panelBlock.type === 'ACTION' && panelActionRef?.kind === 'ready' ? panelActionRef.variant : undefined);
                  const ageCtx = seq && base ? wardrobeIn(seq, base).age : undefined;
                  let frameRefs: { character?: RefImage; environment?: RefImage } = {};
                  if (panelBlock.type === 'CHARACTER') {
                    const cs = resolveCharacterSheet(base, screenplay.referenceBindings, refImages, envScene, ageCtx, variant);
                    frameRefs = { character: cs };
                  } else if (panelBlock.type === 'ACTION' && panelActionRef?.kind === 'ready') {
                    const fr = resolveFrameRefs('action', panelActionRef.characterName, envScene, screenplay.referenceBindings, refImages, ageCtx, panelActionRef.variant);
                    frameRefs = fr;
                  } else if (panelBlock.type === 'DIALOGUE') {
                    const castDiag = panelBeatCast?.[0];
                    const diagVar = castDiag ? resolveBeatVariant(screenplay.blocks, panelBlockIdx, castDiag) : undefined;
                    if (castDiag) frameRefs = resolveFrameRefs('dialogue', castDiag, envScene, screenplay.referenceBindings, refImages, ageCtx, diagVar);
                  }
                  // Character context (textual ① backdrop for the prompt) comes
                  // from the block's own imagePrompt already; env ③ is folded
                  // into the prompt text on MiniMax and as a ref image on FAL.
                  let subjectRef: Blob | undefined;
                  if (frameRefs.character) {
                    subjectRef = await (await fetch(frameRefs.character.url)).blob().catch(() => undefined);
                  }
                  // ③ env backdrop: only for DIALOGUE/ACTION (独立背景 for sheets).
                  let envRefB: Blob | undefined;
                  if (panelBlock.type !== 'CHARACTER' && frameRefs.environment) {
                    envRefB = await (await fetch(frameRefs.environment.url)).blob().catch(() => undefined);
                  }
                  const imgs = await generateImages(
                    { apiKey: appSettings.minimaxApiKey.trim(), baseUrl: appSettings.minimaxBaseUrl,
                      ...(effectiveImageProvider === 'fal' ? { provider: 'fal' as const, falKey: appSettings.falKey, falModel: appSettings.falModel, falQuality: appSettings.falQuality } : {}) },
                    panelBlock.imagePrompt!,
                    { n: 1, aspectRatio: '16:9', subjectReference: subjectRef,
                      references: panelBlock.type !== 'CHARACTER' && envRefB ? { landscape: envRefB } : undefined },
                  );
                  const stamp = Date.now().toString(36);
                  const name = panelBlock.type === 'CHARACTER'
                    ? `${subject}-gen-${stamp}.png`
                    : `scene-gen-${stamp}.png`;
                  const objUrl = URL.createObjectURL(new Blob([imgs[0].blob], { type: imgs[0].blob.type || 'image/png' }));
                  // Immediate feedback at the click site.
                  setImageGenPreview({
                    blockId: panelBlock.id,
                    url: objUrl,
                    subject: subject || '环境',
                  });
                  for (const im of imgs) {
                    // route through the active asset backend with
                    // full provenance + v2 identity (pin-script,
                    // version group per character/scene)
                    let envScene = '';
                    for (let i = screenplay.blocks.findIndex(b => b.id === panelBlock.id); i >= 0; i--) {
                      if (screenplay.blocks[i].type === 'SCENE_HEADING') { envScene = screenplay.blocks[i].content; break; }
                    }
                    const assetId = await onUploadRefImage(
                      new File([im.blob], name, { type: im.blob.type || 'image/png' }),
                      subject || '环境',
                      panelBlock.imagePrompt,
                      'ai-generate',
                      panelBlock.type === 'CHARACTER'
                        ? parseIntCtxChar(panelBlock, subject)
                        : bootstrapChar
                          // Bootstrap: the fresh shot BECOMES the character's
                          // design sheet, so later shots can lock to it.
                          ? { kind: 'character' as const, charName: bootstrapChar.characterName, ...(bootstrapChar.variant ? { variant: bootstrapChar.variant } : {}) }
                          : panelBlock.type === 'SCENE_HEADING'
                            ? { kind: 'environment', sceneKey: envScene }
                            : { kind: 'action', sceneKey: envScene },
                    );
                    // Persist the prompt→asset link on the block itself so the
                    // thumbnail survives regenerating other blocks AND reloads.
                    // Only the id is stored; the url is re-derived from the live
                    // library each render (object urls are session-scoped).
                    if (assetId) {
                      setScreenplay(prev => ({
                        ...prev,
                        blocks: prev.blocks.map(b => b.id === panelBlock.id ? { ...b, imageResult: { assetId, subject: subject || '环境' } } : b),
                        lastModified: Date.now(),
                      }));
                    }
                  }
                } catch (e) {
                  // narrow the unknown catch before reading `.message` —
                  // verify the shape instead of trusting it
                  if (e && typeof e === 'object' && 'message' in e) {
                    setImageGenError(String(e.message ?? e));
                  } else {
                    setImageGenError(String(e));
                  }
                } finally {
                  setImageGenerating(false);
                }
              }}
              disabled={imageGenerating || !imageReady}
              title={
                !imageReady
                  ? (effectiveImageProvider === 'fal'
                      ? (lang === 'zh' ? '未配置 FAL API Key（Settings → AI）' : 'No FAL API key (Settings → AI)')
                      : (lang === 'zh' ? '未配置 MiniMax API Key（Settings → 视频生成）' : 'No MiniMax API key (Settings → Video Generation)'))
                  : panelBlock.type === 'ACTION' && panelActionRef?.kind === 'needs-image'
                    ? t.imageGenBootstrapTitle.replace('{name}', panelActionRef.characterName)
                    : panelBlock.type === 'ACTION' && panelActionRef?.kind === 'no-character'
                      ? t.imageGenEmptyShot
                      : (effectiveImageProvider === 'fal'
                          ? (lang === 'zh' ? '用 FAL 直接生图入库（消耗该账号配额，按图计费）' : 'Generate via FAL straight into the library (billed per image)')
                          : (lang === 'zh' ? '用 MiniMax image-01 直接生图入库（消耗该账号配额，按图计费）' : 'Generate via MiniMax image-01 straight into the library (billed per image)'))
              }
              className="flex-1 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <span className="text-sm leading-none">🎨</span>
              {imageGenerating
                ? (lang === 'zh' ? '生成中…' : 'Generating…')
                : (lang === 'zh' ? '生成图片' : 'Generate')}
            </button>
            {/* Why an ACTION is blocked, or what mode it will run in —
                stated in the panel, not only on hover, so the button
                is never just mysteriously disabled. */}
            {panelBlock.type === 'ACTION' && panelActionRef?.kind === 'needs-image' && (
              <>
                <p className="w-full text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  ⚠ {t.imageGenNeedsImage.replace('{name}', panelActionRef.characterName)}
                </p>
                <p className="w-full text-[10px] leading-snug text-gray-500 dark:text-gray-400">
                  {t.imageGenNeedsImageOptions}
                </p>
                <button
                  onClick={() => setLinkingTarget({ kind: 'character', name: panelActionRef.characterName, variant: panelActionRef.variant })}
                  className="w-full py-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                >
                  🔗 {t.imageGenLinkSheet.replace('{name}', panelActionRef.characterName)}
                </button>
              </>
            )}
            {panelBlock.type === 'ACTION' && panelActionRef?.kind === 'no-character' && (
              <p className="w-full text-[10px] leading-snug text-gray-400 dark:text-gray-500">
                {t.imageGenEmptyShot}
              </p>
            )}
            {imageGenError && (
              <div className="w-full mb-1 px-1">
              <p className="text-[10px] leading-snug text-red-500 break-all max-h-16 overflow-y-auto" title={imageGenError}>{imageGenError}</p>
            </div>
            )}
          </>
        )}
        <button
          onClick={() => {
            navigator.clipboard?.writeText(copyText).catch(() => {});
          }}
          className="flex-1 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Cloud className="w-3.5 h-3.5" />
          {showingGraybox ? t.grayboxCopy : t.aiCopyPrompt}
        </button>
        {showingGraybox && panelBlock.graybox && !panelBlock.graybox.error && (
          <button
            onClick={() => {
              const kind = panelBlock.graybox!.kind;
              const py = buildBlenderScript({
                kind,
                graybox: panelBlock.graybox!,
                sceneGraybox: panelSceneGraybox,
                sceneHeading: panelSceneHeading,
                beat: { type: panelBlock.type, content: panelBlock.content },
              });
              downloadBlenderScript(py, blenderScriptFilename(screenplay.metadata.title, kind));
            }}
            title={lang === 'zh'
              ? '导出自包含 .py：在 Blender 的 Scripting 标签打开并运行，即重建灰模（Y-up→Z-up 已转换；镜头含关键帧运镜）'
              : 'Export a self-contained .py: open and run it in Blender\'s Scripting tab to rebuild the graybox (Y-up→Z-up converted; shot cameras come with keyframed moves)'}
            className="flex-1 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Boxes className="w-3.5 h-3.5" />
            {t.grayboxBlender}
          </button>
        )}
        {!isReadOnly && (
          <button
            onClick={() => {
              // delete whichever payload is currently active
              if (showingGraybox) onDeleteGraybox(panelBlock.id);
              else onDeleteImagePrompt(panelBlock.id);
              // If the other payload still exists, keep the panel open
              // on it; otherwise close. When leaving graybox for a
              // still-present prompt, reset to prompt tab.
              if (showingGraybox && hasPrompt) setPanelTab('prompt');
              else if (!showingGraybox && hasGraybox) setPanelTab('graybox3d');
              else { setPromptPanelBlockId(null); setPanelTab('prompt'); }
            }}
            className="flex-1 py-2 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.aiDeletePrompt}
          </button>
        )}
      </div>

      {/* Library picker: link an existing asset as the blocked character's
          design sheet. Setting the binding clears needs-image on the next
          render, so image-to-image proceeds normally. */}
      {linkingTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={() => setLinkingTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-bold text-gray-900 dark:text-white mb-3">
              {linkingTarget.kind === 'character'
                ? t.imageGenLinkSheet.replace('{name}', linkingTarget.name)
                : t.imageGenPickEnv}
            </div>
            {refImages.length === 0 ? (
              <p className="text-xs text-gray-400 py-4">{t.imageGenNoAssets}</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {refImages.map(r => (
                  <button
                    key={r.id}
                    onClick={() => {
                      if (linkingTarget.kind === 'character') {
                        // Script-wide binding: this asset IS the character's sheet.
                        onRefBindingsChange({
                          ...refBindings,
                          characters: { ...refBindings.characters, [linkingTarget.name]: r.id },
                        });
                      } else {
                        // Per-scene binding: this asset is THIS scene's backdrop.
                        // resolveRefBindings gives the scene override precedence,
                        // so it wins over any script-wide environment default.
                        const heading = linkingTarget.sceneHeading;
                        onRefBindingsChange({
                          ...refBindings,
                          scenes: {
                            ...(refBindings.scenes ?? {}),
                            [heading]: {
                              ...(refBindings.scenes?.[heading] ?? {}),
                              environment: r.id,
                            },
                          },
                        });
                      }
                      setLinkingTarget(null);
                    }}
                    className="p-1 rounded-lg border border-gray-200 dark:border-zinc-700 hover:border-indigo-500 transition-colors"
                    title={r.subject || r.name}
                  >
                    <img src={r.url} alt={r.subject || ''} className="w-full aspect-square object-cover rounded" />
                    <div className="text-[9px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{r.subject || r.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Enlarged view of the generated image. Overlay above everything in the
          panel; click anywhere (or the ×) to dismiss. Full-screen-in-panel is
          enough — the source is already in the library for full inspection. */}
      {zoomedUrl && (
        <button
          type="button"
          onClick={() => setZoomedUrl(null)}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8"
        >
          <div className="relative max-w-full max-h-full">
            <img src={zoomedUrl} alt="" className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
            <span className="absolute top-1 right-2 text-white/80 text-2xl leading-none">×</span>
          </div>
        </button>
      )}
    </div>
  );
};