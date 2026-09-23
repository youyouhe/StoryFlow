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
import { useScriptManagement } from './hooks/useScriptManagement';
import { AppTopBar } from './components/AppTopBar';
import { EditorCanvas } from './components/EditorCanvas';
import { AppModals } from './components/AppModals';
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
  // Side-panel open state + inline image-gen feedback moved into
  // components/EditorCanvas.tsx (their only consumers are the blocks and the
  // PromptPanel drawer).
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

  // Keep both knobs legal on model switch: H3-Max has no 4s window, and
  // resolution lists differ per model (H3: 768P/2K, Max: 480P/768P).
  const handleVideoPlanModelChange = (id: string) => {
    setVideoPlanModelId(id);
    const m = MINIMAX_VIDEO_MODELS.find(x => x.id === id);
    if (m && videoPlanDuration < m.min) setVideoPlanDuration(m.min);
    if (m && !m.resolutions.some(r => r.id === planResolution)) {
      setPlanResolution(m.resolutions[m.resolutions.length - 1].id);
    }
  };

  
  // Title-editing draft state moved into components/AppTopBar.tsx.

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

  // ---- Script management orchestration (load/delete/rename) ----------------
  const { handleLoadScript, handleDeleteScript, handleRenameScript } = useScriptManagement({
    screenplay, setScreenplay,
    savedScripts, setSavedScripts,
    loadScript, createDefaultScript,
    setSyncError, setSyncStatusMap,
    setSidebarOpen, t,
  });

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

        <AppTopBar
          screenplay={screenplay}
          setScreenplay={setScreenplay}
          onRename={handleRenameScript}
          saveStatus={saveStatus}
          theme={theme}
          setTheme={setTheme}
          lang={lang}
          setLang={setLang}
          t={t}
        />

        <EditorCanvas
          screenplay={screenplay}
          setScreenplay={setScreenplay}
          selectedBlockId={selectedBlockId}
          setSelectedBlockId={setSelectedBlockId}
          handleKeyDown={handleKeyDown}
          handleBlockChange={handleBlockChange}
          handleTypeChange={handleTypeChange}
          handleDeleteGraybox={handleDeleteGraybox}
          handleDeleteImagePrompt={handleDeleteImagePrompt}
          t={t}
          theme={theme}
          lang={lang}
          appSettings={appSettings}
          isReadOnly={isReadOnly}
          refImages={refImages}
          refBindings={refBindings}
          onRefBindingsChange={handleRefBindingsChange}
          onUploadRefImage={handleUploadRefImage}
          onRemoveRefImage={handleRemoveRefImage}
          setShowAssetLibrary={setShowAssetLibrary}
          onSubmitH3={handleSubmitH3}
          h3Tasks={h3Tasks}
          h3Ready={h3Ready}
          imageReady={imageReady}
          effectiveImageProvider={effectiveImageProvider}
        />

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

        <AppModals
          screenplay={screenplay}
          setScreenplay={setScreenplay}
          appSettings={appSettings}
          t={t}
          lang={lang}
          theme={theme}
          showStyleHeadModal={showStyleHeadModal}
          setShowStyleHeadModal={setShowStyleHeadModal}
          showAIModal={showAIModal}
          setShowAIModal={setShowAIModal}
          showGallery={showGallery}
          setShowGallery={setShowGallery}
          showSettingsModal={showSettingsModal}
          setShowSettingsModal={setShowSettingsModal}
          showAssetLibrary={showAssetLibrary}
          setShowAssetLibrary={setShowAssetLibrary}
          showExportMenu={showExportMenu}
          setShowExportMenu={setShowExportMenu}
          aiMode={aiMode}
          setAIMode={setAIMode}
          aiState={aiState}
          setAIState={setAIState}
          transitionHeadingDraft={transitionHeadingDraft}
          setTransitionHeadingDraft={setTransitionHeadingDraft}
          promptSource={promptSource}
          setPromptSource={setPromptSource}
          executeAI={executeAI}
          runContinuation={runContinuation}
          acceptAISuggestion={acceptAISuggestion}
          submitPlanToH3={submitPlanToH3}
          planH3Progress={planH3Progress}
          planPreflight={planPreflight}
          planTasks={planTasks}
          planCostTotal={planCostTotal}
          videoPlanModelId={videoPlanModelId}
          videoPlanModel={videoPlanModel}
          onVideoPlanModelChange={handleVideoPlanModelChange}
          videoPlanDuration={videoPlanDuration}
          setVideoPlanDuration={setVideoPlanDuration}
          planResolution={planResolution}
          setPlanResolution={setPlanResolution}
          onUpdateSettings={handleUpdateSettings}
          galleryUser={galleryUser}
          syncError={syncError}
          creditBalance={creditBalance}
          onSsoLogin={() => requireLogin()}
          onSsoLogoutEverywhere={() => { clearToken(); logoutEverywhere(); }}
          onGalleryLogout={handleGalleryLogout}
          onSyncAll={handleSyncAll}
          onRefreshGalleryView={refreshGalleryView}
          refImages={refImages}
          onUpdateRefImageMeta={handleUpdateRefImageMeta}
          onRemoveRefImage={handleRemoveRefImage}
          assetDirName={assetDir?.name}
          dirBackend={assetDir ? 'dir' : 'idb'}
          dirAvailable={isDirStoreAvailable()}
          onOpenDir={handleOpenAssetDir}
          onSwitchDir={handleSwitchAssetDir}
          onRescan={reloadAssets}
          savedScriptOptions={savedScripts.map(sc => ({ id: sc.id, title: sc.title }))}
          onExport={handleExport}
          onImportScript={handleImportScript}
          onExportAssetPack={handleExportAssetPack}
          onImportAssetPack={handleImportAssetPack}
          showTemplateModal={showTemplateModal}
          setShowTemplateModal={setShowTemplateModal}
          viewingTemplate={viewingTemplate}
          setViewingTemplate={setViewingTemplate}
          openOpeningPicker={openOpeningPicker}
          handleCreateBlankScript={handleCreateBlankScript}
          openingPicker={openingPicker}
          setOpeningPicker={setOpeningPicker}
          openingOptions={openingOptions}
          openingsLoading={openingsLoading}
          openingsError={openingsError}
          chosenOpening={chosenOpening}
          setChosenOpening={setChosenOpening}
          handleCreateFromTemplate={handleCreateFromTemplate}
        />

      </div>
    </div>
  );
}

export default App;