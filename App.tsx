import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Screenplay, AIState, Language, AppSettings, AIMode, RefBindings } from './types';
import { DEFAULT_SCRIPT, TRANSLATIONS, TEMPLATES, DEFAULT_APP_SETTINGS, MINIMAX_VIDEO_MODELS } from './constants';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { registerStoryflowWebMcpTools, StoryflowWebMcpAccessor } from './services/webmcp';
import { createWebMcpAccessor } from './services/webmcpAccessor';
import { shipLog } from './services/debugLog';

// Boot ping — a mere page load produces a log entry, proving the debug
// shipping pipeline works end-to-end and telling us which build the user runs.
shipLog('boot', 'info', `app loaded @ ${new Date().toISOString()} · UA=${navigator.userAgent.slice(0, 60)} · ${screen.width}x${screen.height}`);
import { isDirStoreAvailable } from './services/assetDirStore';
import { paginateBlocks } from './utils/pagination';
import { PanelLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { clearToken, requireLogin, logoutEverywhere } from './services/auth4a';
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

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 11);

function App() {
  // ---- Script library domain (index + active lib.screenplay + autosave) --------
  const lib = useScriptLibrary();

  // ---- App settings domain (persisted settings + migrations + save) --------
  const settings = useAppSettings({ setScreenplay: lib.setScreenplay });
  const { appSettings, setAppSettings, handleUpdateSettings } = settings;

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState<Language>('en');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // ---- Gallery sync domain (4A SSO session, badges, cloud visibility) ------
  const sync = useGallerySync({ savedScripts: lib.savedScripts, refreshSavedScripts: lib.refreshSavedScripts });
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
  // Bindings now live INSIDE the lib.screenplay (travel with export/import);
  // localStorage `ref_bindings_*` is migrated once below.
  const refBindings: RefBindings = lib.screenplay.referenceBindings ?? { characters: {} };
  const handleRefBindingsChange = useCallback((next: RefBindings) => {
    lib.setScreenplay(prev => ({ ...prev, referenceBindings: next, lastModified: Date.now() }));
  }, []);
  // ---- Reference-asset library domain (images + folder backend) ------------
  const assets = useRefAssetLibrary({
    scriptId: lib.screenplay.id,
    referenceBindings: lib.screenplay.referenceBindings,
    onBindingsChange: handleRefBindingsChange,
  });
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  // ---- H3 video-plan domain (tasks, VIDEO_PLAN knobs, submission, polling) -
  const h3 = useH3VideoPlan({
    appSettings,
    screenplayBlocks: lib.screenplay.blocks,
    refBindings,
    refImages: assets.refImages,
    setAIState,
  });


  
  // Title-editing draft state moved into components/AppTopBar.tsx.

  // ---- WebMCP (Web Model Context Protocol) ---------------------------------
  // Exposes StoryFlow operations as standardized in-browser tools for AI
  // agents (ChatGPT's browser etc.). Experimental API, secure contexts only —
  // on the LAN-IP dev setup registration quietly no-ops. The accessor is
  // refreshed every render into a latest-ref so tool executions always see
  // current state without re-registering.
  const webmcpAccessorRef = useRef<StoryflowWebMcpAccessor | null>(null);
  useEffect(() => registerStoryflowWebMcpTools(webmcpAccessorRef as { current: StoryflowWebMcpAccessor }), []);

  // One-time migration: old per-script localStorage bindings → lib.screenplay.
  useEffect(() => {
    const key = `ref_bindings_${lib.screenplay.id}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw && !lib.screenplay.referenceBindings) {
        const parsed = JSON.parse(raw) as RefBindings;
        lib.setScreenplay(prev => prev.id === lib.screenplay.id
          ? { ...prev, referenceBindings: { characters: {}, ...parsed }, lastModified: Date.now() }
          : prev);
        localStorage.removeItem(key);
      }
    } catch { /* malformed legacy entry — drop */ }
  }, [lib.screenplay.id, lib.screenplay.referenceBindings]);


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
    screenplay: lib.screenplay, setScreenplay: lib.setScreenplay, savedScripts: lib.savedScripts, appSettings, lang, refImages: assets.refImages,
    handleUploadRefImage: assets.handleUploadRefImage, effectiveImageProvider, imageReady, setSelectedBlockId: lib.setSelectedBlockId,
  });


  const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];
  const pages = useMemo(() => paginateBlocks(lib.screenplay.blocks), [lib.screenplay.blocks]);

  // ---- Script management orchestration (load/delete/rename) ----------------
  const mgmt = useScriptManagement({
    screenplay: lib.screenplay, setScreenplay: lib.setScreenplay,
    savedScripts: lib.savedScripts, setSavedScripts: lib.setSavedScripts,
    loadScript: lib.loadScript, createDefaultScript: lib.createDefaultScript,
    setSyncError: sync.setSyncError, setSyncStatusMap: sync.setSyncStatusMap,
    setSidebarOpen, t,
  });

  // ---- Template flow domain (gallery modal + opening picker + creators) ----
  const tpl = useTemplateFlow({
    screenplay: lib.screenplay, setScreenplay: lib.setScreenplay, setSelectedBlockId: lib.setSelectedBlockId,
    lang, t, appSettings,
    setSidebarOpen, setShowStyleHeadModal, setIsReadOnly,
  });

  // ---- Import/export domain (JSON import, PDF/MD/JSON export, asset pack) --
  const io = useImportExport({
    screenplay: lib.screenplay,
    setScreenplay: lib.setScreenplay,
    setSelectedBlockId: lib.setSelectedBlockId,
    setIsReadOnly,
    appSettings, t,
    refImages: assets.refImages,
    handleUploadRefImage: assets.handleUploadRefImage,
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
  // Sync engine subscription + sync.refreshGalleryView — moved into hooks/useGallerySync.
  // App Settings Autosave — moved into hooks/useAppSettings.



  // ---- Block editing domain (content/type mutations, payload deletes) ------
  const { handleBlockChange, handleTypeChange, handleDeleteImagePrompt, handleDeleteGraybox } =
    useBlockEditing({ setScreenplay: lib.setScreenplay, isReadOnly });

  // ---- AI orchestration domain (ai.executeAI + accept/replan effects) ---------
  const ai = useAIExecutor({
    appSettings,
    screenplay: lib.screenplay,
    setScreenplay: lib.setScreenplay,
    selectedBlockId: lib.selectedBlockId,
    setSelectedBlockId: lib.setSelectedBlockId,
    aiMode, aiState, setAIState,
    setShowAIModal, setTransitionHeadingDraft,
    setVideoPlan: h3.setVideoPlan,
    videoPlanDuration: h3.videoPlanDuration,
    promptSource, t, isReadOnly, handleBlockChange,
  });

  // ---- Editor keyboard domain (shortcuts + editing keys) -------------------
  const { handleKeyDown } = useEditorKeyboard({
    appSettings,
    screenplay: lib.screenplay,
    setScreenplay: lib.setScreenplay,
    setSelectedBlockId: lib.setSelectedBlockId,
    handleTypeChange, isReadOnly, t,
    executeAI: ai.executeAI,
    handleSyncScript: sync.handleSyncScript,
    setSyncError: sync.setSyncError,
    setAIMode, setShowAIModal,
  });



  const scrollToBlock = (id: string) => {
    lib.setSelectedBlockId(id);
    const element = document.getElementById(`block-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Derive the scene (nearest preceding SCENE_HEADING) that owns the currently
  // selected block, so the sidebar outline can highlight + auto-scroll to the
  // scene the user is actually editing. Scan-back is the same pattern already
  // inlined in ai.executeAI (3 sites) — kept local here for clarity; extracting a
  // shared helper would touch those sites too, out of scope for this fix.
  const activeSceneId = useMemo(() => {
    const idx = lib.screenplay.blocks.findIndex(b => b.id === lib.selectedBlockId);
    if (idx < 0) return null;
    for (let i = idx; i >= 0; i--) {
      if (lib.screenplay.blocks[i].type === 'SCENE_HEADING') return lib.screenplay.blocks[i].id;
    }
    return null; // blocks before the first scene heading — nothing to highlight
  }, [lib.screenplay.blocks, lib.selectedBlockId]);


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
            blocks={lib.screenplay.blocks}
            onScrollToBlock={scrollToBlock}
            activeSceneId={activeSceneId}
            metadata={lib.screenplay.metadata}
            isOpen={true} 
            onToggle={() => setSidebarOpen(!sidebarOpen)}
            onNewScript={() => tpl.setShowTemplateModal(true)}
            onScriptSettings={() => setShowSettingsModal(true)}
            t={t}
            savedScripts={lib.savedScripts}
            onLoadScript={mgmt.handleLoadScript}
            onDeleteScript={mgmt.handleDeleteScript}
            onRenameScript={mgmt.handleRenameScript}
            currentScriptId={lib.screenplay.id}
            onExport={() => setShowExportMenu(true)}
            onOpenAssetLibrary={() => setShowAssetLibrary(true)}
            assetLibraryLabel={t.assetLibraryLabel}
            syncStatus={sync.syncStatusMap}
            gallerySignedIn={!!sync.galleryUser}
            onSyncScript={sync.handleSyncScript}
            cloudVisibility={sync.cloudVisMap}
            onChangeVisibility={sync.handleChangeVisibility}
            onOpenGallery={() => setShowGallery(true)}
        />
      </div>

      <div className="flex-1 flex flex-col h-full relative overflow-hidden transition-all duration-300">

        <AppTopBar
          screenplay={lib.screenplay}
          setScreenplay={lib.setScreenplay}
          onRename={mgmt.handleRenameScript}
          saveStatus={lib.saveStatus}
          theme={theme}
          setTheme={setTheme}
          lang={lang}
          setLang={setLang}
          t={t}
        />

        <EditorCanvas
          screenplay={lib.screenplay}
          setScreenplay={lib.setScreenplay}
          selectedBlockId={lib.selectedBlockId}
          setSelectedBlockId={lib.setSelectedBlockId}
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
          refImages={assets.refImages}
          refBindings={refBindings}
          onRefBindingsChange={handleRefBindingsChange}
          onUploadRefImage={assets.handleUploadRefImage}
          onRemoveRefImage={assets.handleRemoveRefImage}
          setShowAssetLibrary={setShowAssetLibrary}
          onSubmitH3={h3.handleSubmitH3}
          h3Tasks={h3.h3Tasks}
          h3Ready={h3.h3Ready}
          imageReady={imageReady}
          effectiveImageProvider={effectiveImageProvider}
        />

        <Toolbar
            currentType={lib.screenplay.blocks.find(b => b.id === lib.selectedBlockId)?.type || 'ACTION'}
            onSetType={(t) => handleTypeChange(lib.selectedBlockId, t)}
            onAIAction={ai.handleAIAction}
            isAILoading={aiState.isLoading}
            t={t}
            isReadOnly={isReadOnly}
            onToggleReadOnly={() => setIsReadOnly(!isReadOnly)}
            styleHeadName={lib.screenplay.metadata.styleHead?.name}
            onOpenStyleHead={() => setShowStyleHeadModal(true)}
        />

        <AppModals
          lib={lib}
          sync={sync}
          assets={assets}
          h3={h3}
          ai={ai}
          tpl={tpl}
          io={io}
          settings={settings}
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
          onSsoLogin={() => requireLogin()}
          onSsoLogoutEverywhere={() => { clearToken(); logoutEverywhere(); }}
        />

      </div>
    </div>
  );
}

export default App;