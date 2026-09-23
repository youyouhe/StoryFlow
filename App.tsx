import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Screenplay, ScriptBlock, BlockType, AIState, Language, ScriptMetadata, AppSettings, ScriptTemplate, AIMode, ExportFormat, ExportOptions, GrayboxData, RefImage, RefBindings, H3Task, GalleryUser, SyncStatus } from './types';
import { DEFAULT_SCRIPT, TRANSLATIONS, TEMPLATES, DEFAULT_APP_SETTINGS, MINIMAX_VIDEO_MODELS } from './constants';
import { EditorBlock } from './components/EditorBlock';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { SettingsModal } from './components/SettingsModal';
import { StyleHeadModal } from './components/StyleHeadModal';
import { generateOpenings, OpeningCandidate } from './services/geminiService';
import { ExportMenu } from './components/ExportMenu';
import { paginateBlocks } from './utils/pagination';
import { exportToPDF } from './utils/pdfExport';
import { registerStoryflowWebMcpTools, StoryflowWebMcpAccessor } from './services/webmcp';
import { createWebMcpAccessor } from './services/webmcpAccessor';
import { buildSeedancePrompt, buildH3Prompt } from './utils/whiteModelPrompt';
import { checkGrayboxHealth } from './utils/grayboxHealth';
import { resolveActionRef } from './utils/refBindings';
import { sequenceAt, wardrobeIn } from './utils/sequence';
import { parseCharacterName, baseCharName } from './utils/beatCast';
import { shipLog } from './services/debugLog';
import { generateImages } from './services/minimaxService';

// Boot ping — a mere page load produces a log entry, proving the debug
// shipping pipeline works end-to-end and telling us which build the user runs.
shipLog('boot', 'info', `app loaded @ ${new Date().toISOString()} · UA=${navigator.userAgent.slice(0, 60)} · ${screen.width}x${screen.height}`);
import { isDirStoreAvailable } from './services/assetDirStore';
import { RefAssetLibraryModal, REF_LIBRARY_LABELS } from './components/RefAssetLibraryModal';
import { GalleryModal } from './components/GalleryModal';
import { AIModal } from './components/AIModal';
import { TemplateModal } from './components/TemplateModal';
import { OpeningPicker } from './components/OpeningPicker';
import { PromptPanel } from './components/PromptPanel';
import { getAiLog } from './services/aiLog';
import { galleryClient, syncEngine } from './services/gallery';
import { clearToken, requireLogin, logoutEverywhere } from './services/auth4a';
import { exportMarkdown, exportJSON } from './utils/exportData';
import { useScriptLibrary, STORAGE_KEYS, type ScriptSummary } from './hooks/useScriptLibrary';
import { useGallerySync } from './hooks/useGallerySync';
import { useRefAssetLibrary } from './hooks/useRefAssetLibrary';
import { useH3VideoPlan } from './hooks/useH3VideoPlan';
import { useAIExecutor } from './hooks/useAIExecutor';
import { useEditorKeyboard } from './hooks/useEditorKeyboard';
import { useTemplateFlow } from './hooks/useTemplateFlow';
import { useImportExport } from './hooks/useImportExport';
import { useAppSettings } from './hooks/useAppSettings';
import { useBlockEditing } from './hooks/useBlockEditing';
import { Menu, Moon, Sun, PanelLeft, Cloud, Check, Loader2, Languages } from 'lucide-react';
import { clsx } from 'clsx';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 11);

function App() {
  // ---- Script library domain (index + active screenplay + autosave) --------
  const {
    savedScripts, setSavedScripts,
    screenplay, setScreenplay,
    selectedBlockId, setSelectedBlockId,
    saveStatus,
    refreshSavedScripts,
    loadScript,
    createDefaultScript,
  } = useScriptLibrary();

  // ---- App settings domain (persisted settings + migrations + save) --------
  const { appSettings, setAppSettings, handleUpdateSettings } = useAppSettings({ setScreenplay });

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState<Language>('en');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // ---- Gallery sync domain (4A SSO session, badges, cloud visibility) ------
  const {
    galleryUser,
    syncStatusMap, setSyncStatusMap,
    cloudVisMap,
    syncError, setSyncError,
    creditBalance,
    refreshGalleryView,
    handleChangeVisibility,
    handleGalleryLogout,
    handleSyncScript,
    handleSyncAll,
  } = useGallerySync({ savedScripts, refreshSavedScripts });
  const [aiState, setAIState] = useState<AIState>({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
  const [showAIModal, setShowAIModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showStyleHeadModal, setShowStyleHeadModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [aiMode, setAIMode] = useState<AIMode>('CONTINUE');
  const [isReadOnly, setIsReadOnly] = useState(false);
  // Editable draft of the AI-suggested transition scene heading, so the user
  // can tweak it before accepting a transition in the CONTINUE two-step flow.
  const [transitionHeadingDraft, setTransitionHeadingDraft] = useState('');
  // FROM_PROMPT: the pasted production prompt the user wants transcribed.
  const [promptSource, setPromptSource] = useState('');
  // Storyboard prompt side-panel: when a block's prompt chip is clicked, its
  // full content is shown in a right-side drawer instead of expanding inline
  // (which ate editor space). Holds the block id whose prompt is open, or null.
  const [promptPanelBlockId, setPromptPanelBlockId] = useState<string | null>(null);
  // Which payload the side panel shows when a block holds both an imagePrompt
  // and a graybox. The opener handlers set this so the panel opens on the
  // payload whose chip was clicked.
  const [panelTab, setPanelTab] = useState<'prompt' | 'graybox' | 'graybox3d'>('prompt');
  // Bindings now live INSIDE the screenplay (travel with export/import);
  // localStorage `ref_bindings_*` is migrated once below.
  const refBindings: RefBindings = screenplay.referenceBindings ?? { characters: {} };
  const handleRefBindingsChange = useCallback((next: RefBindings) => {
    setScreenplay(prev => ({ ...prev, referenceBindings: next, lastModified: Date.now() }));
  }, []);
  // ---- Reference-asset library domain (images + folder backend) ------------
  const {
    refImages, setRefImages,
    assetDir,
    handleUploadRefImage,
    handleUpdateRefImageMeta,
    handleOpenAssetDir,
    handleSwitchAssetDir,
    reloadAssets,
    handleRemoveRefImage,
  } = useRefAssetLibrary({
    scriptId: screenplay.id,
    referenceBindings: screenplay.referenceBindings,
    onBindingsChange: handleRefBindingsChange,
  });
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  // MiniMax H3 generation tasks (white-model submission pipeline)
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGenError, setImageGenError] = useState<string | null>(null);
  // Inline success preview at the click site (the image is already in the
  // library; this just shows it where the user generated it).
  const [imageGenPreview, setImageGenPreview] = useState<{ blockId: string; url: string; subject: string } | null>(null);
  // ---- H3 video-plan domain (tasks, VIDEO_PLAN knobs, submission, polling) -
  const {
    h3Tasks, setH3Tasks,
    planH3Progress,
    videoPlanModelId, setVideoPlanModelId, videoPlanModel,
    videoPlanDuration, setVideoPlanDuration,
    planResolution, setPlanResolution,
    videoPlan, setVideoPlan,
    planTasks, planPreflight, planCostTotal,
    h3Ready,
    handleSubmitH3,
    submitPlanToH3,
  } = useH3VideoPlan({
    appSettings,
    screenplayBlocks: screenplay.blocks,
    refBindings,
    refImages,
    setAIState,
  });
  const openImagePromptPanel = useCallback((id: string) => {
    setPanelTab('prompt');
    setPromptPanelBlockId(id);
  }, []);
  const openGrayboxPanel = useCallback((id: string) => {
    setPanelTab('graybox3d');
    setPromptPanelBlockId(id);
  }, []);
  
  // States for title editing
  const [headerTitleEditing, setHeaderTitleEditing] = useState(false);
  const [headerTitleVal, setHeaderTitleVal] = useState('');

  // ---- WebMCP (Web Model Context Protocol) ---------------------------------
  // Exposes StoryFlow operations as standardized in-browser tools for AI
  // agents (ChatGPT's browser etc.). Experimental API, secure contexts only —
  // on the LAN-IP dev setup registration quietly no-ops. The accessor is
  // refreshed every render into a latest-ref so tool executions always see
  // current state without re-registering.
  const webmcpAccessorRef = useRef<StoryflowWebMcpAccessor | null>(null);
  useEffect(() => registerStoryflowWebMcpTools(webmcpAccessorRef as { current: StoryflowWebMcpAccessor }), []);

  // One-time migration: old per-script localStorage bindings → screenplay.
  useEffect(() => {
    const key = `ref_bindings_${screenplay.id}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw && !screenplay.referenceBindings) {
        const parsed = JSON.parse(raw) as RefBindings;
        setScreenplay(prev => prev.id === screenplay.id
          ? { ...prev, referenceBindings: { characters: {}, ...parsed }, lastModified: Date.now() }
          : prev);
        localStorage.removeItem(key);
      }
    } catch { /* malformed legacy entry — drop */ }
  }, [screenplay.id, screenplay.referenceBindings]);


  // ---- Image generation backend — FAL preferred, fall back to MiniMax ----
  // User picks a provider in Settings, but FAL only actually wins when its
  // key is configured; otherwise we silently use MiniMax (so an empty FAL key
  // never bricks image generation). single decision point both call sites and
  // the button gate read.
  const effectiveImageProvider: 'minimax' | 'fal' =
    appSettings.imageProvider === 'fal' && appSettings.falKey.trim()
      ? 'fal'
      : 'minimax';
  const imageReady =
    effectiveImageProvider === 'fal'
      ? !!appSettings.falKey.trim()
      : !!appSettings.minimaxApiKey.trim();

  // Refreshed every render (latest-ref) so tool executions always see current
  // state without re-registering. MUST stay in the render body, not an effect —
  // the useEffect above only hands the ref to the registry after it is filled.
  webmcpAccessorRef.current = createWebMcpAccessor({
    screenplay, setScreenplay, savedScripts, appSettings, lang, refImages,
    handleUploadRefImage, effectiveImageProvider, imageReady, setSelectedBlockId,
  });


  const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];
  const pages = useMemo(() => paginateBlocks(screenplay.blocks), [screenplay.blocks]);

  // ---- Template flow domain (gallery modal + opening picker + creators) ----
  const {
    showTemplateModal, setShowTemplateModal,
    openingPicker, setOpeningPicker,
    openingOptions, openingsLoading, openingsError, chosenOpening, setChosenOpening,
    viewingTemplate, setViewingTemplate,
    handleCreateBlankScript,
    openOpeningPicker,
    handleCreateFromTemplate,
  } = useTemplateFlow({
    screenplay, setScreenplay, setSelectedBlockId,
    lang, t, appSettings,
    setSidebarOpen, setShowStyleHeadModal, setIsReadOnly,
  });

  // ---- Import/export domain (JSON import, PDF/MD/JSON export, asset pack) --
  const {
    handleImportScript,
    handleExport,
    handleExportAssetPack,
    handleImportAssetPack,
  } = useImportExport({
    screenplay, setScreenplay, setSelectedBlockId, setIsReadOnly,
    appSettings, t, refImages, handleUploadRefImage,
  });

  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Migration & Autosave Logic — moved into hooks/useScriptLibrary.
  // Sync engine subscription + refreshGalleryView — moved into hooks/useGallerySync.
  // App Settings Autosave — moved into hooks/useAppSettings.



  // ---- Block editing domain (content/type mutations, payload deletes) ------
  const { handleBlockChange, handleTypeChange, handleDeleteImagePrompt, handleDeleteGraybox } =
    useBlockEditing({ setScreenplay, isReadOnly });

  // ---- AI orchestration domain (executeAI + accept/replan effects) ---------
  const {
    executeAI,
    handleAIAction,
    runContinuation,
    acceptAISuggestion,
  } = useAIExecutor({
    appSettings, screenplay, setScreenplay,
    selectedBlockId, setSelectedBlockId,
    aiMode, aiState, setAIState,
    setShowAIModal, setTransitionHeadingDraft,
    setVideoPlan, videoPlanDuration,
    promptSource, t, isReadOnly, handleBlockChange,
  });

  // ---- Editor keyboard domain (shortcuts + editing keys) -------------------
  const { handleKeyDown } = useEditorKeyboard({
    appSettings, screenplay, setScreenplay, setSelectedBlockId,
    handleTypeChange, isReadOnly, t, executeAI, handleSyncScript, setSyncError,
    setAIMode, setShowAIModal,
  });


  const handleLoadScript = (id: string) => {
      // Load + select first block in the library domain; the sidebar pop is
      // the App-level UI side effect (only on a successful load, as before).
      if (loadScript(id)) setSidebarOpen(true);
  };

  const handleDeleteScript = (id: string) => {
      if (!window.confirm(t.confirmDelete)) return;

      try {
          // Remove Content
          localStorage.removeItem(STORAGE_KEYS.SCRIPT_PREFIX + id);

          // Cloud bookkeeping: drop local sync state; soft-delete the cloud
          // copy too so pullAll won't resurrect it on the next sign-in.
          const cloudId = syncEngine.cloudIdOf(id);
          syncEngine.forgetScript(id);
          if (cloudId && galleryClient.isAuthenticated) {
              galleryClient.deleteScript(cloudId).catch(e => {
                  setSyncError(`删除云端副本失败: ${e instanceof Error ? e.message : String(e)}`);
              });
          }
          setSyncStatusMap(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
          });

          // Update Index
          const newIndex = savedScripts.filter(s => s.id !== id);
          localStorage.setItem(STORAGE_KEYS.SCRIPT_INDEX, JSON.stringify(newIndex));
          setSavedScripts(newIndex);

          // If deleted current script, load another or create default
          if (id === screenplay.id) {
              if (newIndex.length > 0) {
                  handleLoadScript(newIndex[0].id);
              } else {
                  // Reset to default
                  createDefaultScript();
              }
          }
      } catch (e) {
          console.error("Failed to delete script", e); shipLog("script", "error", "Failed to delete script", e);
      }
  };

  const handleRenameScript = (id: string, newTitle: string) => {
      // 1. Update Index
      const updatedScripts = savedScripts.map(s => 
          s.id === id ? { ...s, title: newTitle, lastModified: Date.now() } : s
      );
      setSavedScripts(updatedScripts);
      localStorage.setItem(STORAGE_KEYS.SCRIPT_INDEX, JSON.stringify(updatedScripts));

      // 2. Update Active State if matched
      if (id === screenplay.id) {
          setScreenplay(prev => ({
              ...prev,
              metadata: { ...prev.metadata, title: newTitle },
              lastModified: Date.now()
          }));
      } else {
          // 3. Update Storage for inactive script
          try {
              const scriptJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_PREFIX + id);
              if (scriptJson) {
                  const s = JSON.parse(scriptJson);
                  s.metadata.title = newTitle;
                  s.lastModified = Date.now();
                  localStorage.setItem(STORAGE_KEYS.SCRIPT_PREFIX + id, JSON.stringify(s));
              }
          } catch(e) { console.error(e); }
      }
  };


  const scrollToBlock = (id: string) => {
    setSelectedBlockId(id);
    const element = document.getElementById(`block-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Derive the scene (nearest preceding SCENE_HEADING) that owns the currently
  // selected block, so the sidebar outline can highlight + auto-scroll to the
  // scene the user is actually editing. Scan-back is the same pattern already
  // inlined in executeAI (3 sites) — kept local here for clarity; extracting a
  // shared helper would touch those sites too, out of scope for this fix.
  const activeSceneId = useMemo(() => {
    const idx = screenplay.blocks.findIndex(b => b.id === selectedBlockId);
    if (idx < 0) return null;
    for (let i = idx; i >= 0; i--) {
      if (screenplay.blocks[i].type === 'SCENE_HEADING') return screenplay.blocks[i].id;
    }
    return null; // blocks before the first scene heading — nothing to highlight
  }, [screenplay.blocks, selectedBlockId]);


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-desk dark:bg-desk-dark text-gray-900 dark:text-gray-100 font-sans transition-colors duration-300">
      
      <button 
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-40 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-md md:hidden text-gray-600 dark:text-gray-300"
      >
         <PanelLeft className="w-5 h-5" />
      </button>

      <div className={clsx(
          "fixed inset-y-0 left-0 z-30 transform transition-transform duration-300 md:relative md:translate-x-0 shadow-xl md:shadow-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <Sidebar
            blocks={screenplay.blocks}
            onScrollToBlock={scrollToBlock}
            activeSceneId={activeSceneId}
            metadata={screenplay.metadata}
            isOpen={true} 
            onToggle={() => setSidebarOpen(!sidebarOpen)}
            onNewScript={() => setShowTemplateModal(true)}
            onScriptSettings={() => setShowSettingsModal(true)}
            t={t}
            savedScripts={savedScripts}
            onLoadScript={handleLoadScript}
            onDeleteScript={handleDeleteScript}
            onRenameScript={handleRenameScript}
            currentScriptId={screenplay.id}
            onExport={() => setShowExportMenu(true)}
            onOpenAssetLibrary={() => setShowAssetLibrary(true)}
            assetLibraryLabel={t.assetLibraryLabel}
            syncStatus={syncStatusMap}
            gallerySignedIn={!!galleryUser}
            onSyncScript={handleSyncScript}
            cloudVisibility={cloudVisMap}
            onChangeVisibility={handleChangeVisibility}
            onOpenGallery={() => setShowGallery(true)}
        />
      </div>

      <div className="flex-1 flex flex-col h-full relative overflow-hidden transition-all duration-300">
        
        {/* Top Bar */}
        <div className="h-14 border-b border-gray-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-4 ml-10 md:ml-0">
             <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-widest font-mono">
                 {headerTitleEditing ? (
                    <input 
                        value={headerTitleVal}
                        onChange={(e) => setHeaderTitleVal(e.target.value)}
                        onBlur={() => {
                            if (headerTitleVal.trim()) {
                                handleRenameScript(screenplay.id, headerTitleVal.trim());
                            }
                            setHeaderTitleEditing(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (headerTitleVal.trim()) {
                                    handleRenameScript(screenplay.id, headerTitleVal.trim());
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
             {/* Production mode badge: shows the pipeline level, click to toggle */}
             <button
               onClick={() => setScreenplay(prev => ({
                   ...prev,
                   productionMode: prev.productionMode === 'simple' ? 'cinematic' : 'simple',
                   lastModified: Date.now(),
               }))}
               title={screenplay.productionMode === 'simple'
                   ? '简易模式——无灰盒/白模，适合固定机位内容'
                   : '专业模式——含灰盒+白模完整管线'}
               className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border transition-colors ${
                   screenplay.productionMode === 'simple'
                       ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                       : 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-800'
               }`}
             >
                 {screenplay.productionMode === 'simple' ? '简易' : '专业'}
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
                onRefBindingsChange={handleRefBindingsChange}
                onUploadRefImage={handleUploadRefImage}
                onRemoveRefImage={handleRemoveRefImage}
                setShowAssetLibrary={setShowAssetLibrary}
                setScreenplay={setScreenplay}
                onSubmitH3={handleSubmitH3}
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

        <Toolbar 
            currentType={screenplay.blocks.find(b => b.id === selectedBlockId)?.type || 'ACTION'}
            onSetType={(t) => handleTypeChange(selectedBlockId, t)}
            onAIAction={handleAIAction}
            isAILoading={aiState.isLoading}
            t={t}
            isReadOnly={isReadOnly}
            onToggleReadOnly={() => setIsReadOnly(!isReadOnly)}
            styleHeadName={screenplay.metadata.styleHead?.name}
            onOpenStyleHead={() => setShowStyleHeadModal(true)}
        />

        {showStyleHeadModal && (
            <StyleHeadModal
                current={screenplay.metadata.styleHead}
                blocks={screenplay.blocks}
                templateId={screenplay.metadata.templateId}
                scriptLanguage={screenplay.metadata.scriptLanguage}
                appSettings={appSettings}
                t={t}
                onClose={() => setShowStyleHeadModal(false)}
                onApply={(head) => {
                    setScreenplay(prev => ({
                        ...prev,
                        metadata: { ...prev.metadata, styleHead: head },
                        lastModified: Date.now()
                    }));
                    setShowStyleHeadModal(false);
                }}
            />
        )}

        {/* AI Modal */}
        {showAIModal && (
            <AIModal
                aiMode={aiMode}
                setAIMode={setAIMode}
                aiState={aiState}
                setAIState={setAIState}
                t={t}
                onClose={() => setShowAIModal(false)}
                onExecute={() => { void executeAI(); }}
                onAccept={acceptAISuggestion}
                transitionHeadingDraft={transitionHeadingDraft}
                setTransitionHeadingDraft={setTransitionHeadingDraft}
                promptSource={promptSource}
                onPromptSourceChange={setPromptSource}
                runContinuation={runContinuation}
                onSubmitPlanToH3={() => { void submitPlanToH3(); }}
                planH3Progress={planH3Progress}
                planPreflight={planPreflight}
                videoPlanModelId={videoPlanModel.id}
                onVideoPlanModelChange={(id) => {
                    setVideoPlanModelId(id);
                    // Keep both knobs legal on switch: H3-Max has no 4s window,
                    // and resolution lists differ per model (H3: 768P/2K, Max: 480P/768P).
                    const m = MINIMAX_VIDEO_MODELS.find(x => x.id === id);
                    if (m && videoPlanDuration < m.min) setVideoPlanDuration(m.min);
                    if (m && !m.resolutions.some(r => r.id === planResolution)) {
                        setPlanResolution(m.resolutions[m.resolutions.length - 1].id);
                    }
                }}
                videoPlanDuration={videoPlanDuration}
                onVideoPlanDurationChange={setVideoPlanDuration}
                planResolution={planResolution}
                onPlanResolutionChange={setPlanResolution}
                planTasks={planTasks}
                planCostTotal={planCostTotal}
                planNextHint={screenplay.productionMode === 'simple'
                    ? '提交后任务状态实时显示在下方，生成完成可直接下载'
                    : t.videoPlanNext}
            />
        )}

        {/* Gallery browse (P2) */}
        {showGallery && (
            <GalleryModal
                isOpen={showGallery}
                onClose={() => setShowGallery(false)}
                signedIn={!!galleryUser}
                onLocalChange={refreshGalleryView}
                t={t}
            />
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <SettingsModal
                metadata={screenplay.metadata}
                appSettings={appSettings}
                onSave={(newMetadata, newAppSettings) => {
                    handleUpdateSettings(newMetadata, newAppSettings);
                    setShowSettingsModal(false);
                }}
                onClose={() => setShowSettingsModal(false)}
                t={t}
                galleryUser={galleryUser}
                syncError={syncError}
                creditBalance={creditBalance}
                onSsoLogin={() => requireLogin()}
                onSsoLogoutEverywhere={() => { clearToken(); logoutEverywhere(); }}
                onGalleryLogout={handleGalleryLogout}
                onSyncAll={handleSyncAll}
            />
        )}

        {/* Reference Asset Library (white-model digital assets) */}
        {showAssetLibrary && (
            <RefAssetLibraryModal
                images={refImages}
                onUpdateMeta={handleUpdateRefImageMeta}
                onDelete={handleRemoveRefImage}
                onClose={() => setShowAssetLibrary(false)}
                labels={REF_LIBRARY_LABELS[lang]}
                scriptId={screenplay.id}
                scripts={savedScripts.map(sc => ({ id: sc.id, title: sc.title }))}
                backend={assetDir ? 'dir' : 'idb'}
                backendName={assetDir?.name}
                dirAvailable={isDirStoreAvailable()}
                onOpenDir={handleOpenAssetDir}
                onSwitchDir={handleSwitchAssetDir}
                onRescan={reloadAssets}
            />
        )}

        {/* Export Menu (format + payload options) */}
        <ExportMenu
            open={showExportMenu}
            onClose={() => setShowExportMenu(false)}
            onExport={handleExport}
            onImportJson={(f) => { void handleImportScript(f); }}
            onExportAssetPack={() => { void handleExportAssetPack(); }}
            onImportAssetPack={(f) => { void handleImportAssetPack(f); }}
            t={t}
        />

        {/* Templates Modal */}
        {showTemplateModal && (
          <TemplateModal
            t={t}
            viewingTemplate={viewingTemplate}
            setViewingTemplate={setViewingTemplate}
            setShowTemplateModal={setShowTemplateModal}
            openOpeningPicker={openOpeningPicker}
            onBlank={() => handleCreateBlankScript('standard')}
          />
        )}

        {/* Opening Picker (P5-openings) — template default vs AI-invented cold opens */}
        {openingPicker && (
          <OpeningPicker
            openingPicker={openingPicker}
            openingOptions={openingOptions}
            openingsLoading={openingsLoading}
            openingsError={openingsError}
            chosenOpening={chosenOpening}
            setChosenOpening={setChosenOpening}
            screenplay={screenplay}
            t={t}
            onClose={() => setOpeningPicker(null)}
            onReroll={() => openOpeningPicker(openingPicker)}
            onConfirm={handleCreateFromTemplate}
            onBlank={() => handleCreateBlankScript(openingPicker.id)}
          />
        )}
      </div>
    </div>
  );
}

export default App;