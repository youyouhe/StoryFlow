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
import { useAskDialog } from './hooks/useAskDialog';
import { useStoryFlowApp } from './hooks/useStoryFlowApp';
import { checkModeSwitch, hasProFeatureData } from './utils/modeSwitch';
import { AppTopBar } from './components/AppTopBar';
import { EditorCanvas } from './components/EditorCanvas';
import { AppModals } from './components/AppModals';
import { CandidatesPanel } from './components/CandidatesPanel';
import { ComposeExportModal } from './components/ComposeExportModal';
import { IRPipelineModal } from './components/IRPipelineModal';
import {
  defaultRegistry, defaultProfile, createServiceHub, type ServiceHub,
} from './services/providers';
import type { RuntimeProfile } from './services/providers';
import {
  isProjectStoreAvailable, pickProjectDir, persistProjectDir, loadPersistedProjectDir,
  forgetProjectDir, requestDirPermission, openProject, loadRuntimeProfile,
} from './services/project/projectStore';
import {
  getSessionCredential, setSessionCredential, clearSessionCredentials,
  sessionCredentialSnapshot, SLOT_FOR_FIELD, exportCredentialFile, importCredentialFile,
} from './services/credentials';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 11);
const L_T = (t: Record<string, unknown>, key: string, fallback: string): string =>
  typeof t?.[key] === 'string' ? (t[key] as string) : fallback;

function App() {
  // ---- App-owned UI state (theme, modals, drafts) — see useStoryFlowApp ----
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState<Language>('en');
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
  // In-app choice dialog for the privacy prompts (cookie login, pull ask).
  const { ask, dialog: askDialog } = useAskDialog();
  // Privacy-remediation toasts: conflict forks + first pushes surface here.
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast({ msg, key: Date.now() });

  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showExpressWorkbench, setShowExpressWorkbench] = useState(false);
  // ---- Composition root: every domain hook wired in dependency order -------
  const {
    lib, settings, sync, assets, h3, ed, ai, kb, mgmt, tpl, io,
    refBindings, handleRefBindingsChange, t, activeSceneId, scrollToBlock,
  } = useStoryFlowApp({
    lang, onToast: showToast, ask, aiMode, setAIMode, aiState, setAIState, setShowAIModal,
    setIsReadOnly, isReadOnly, promptSource, setTransitionHeadingDraft,
    setSidebarOpen, setShowStyleHeadModal,
  });
  const { appSettings, setAppSettings, handleUpdateSettings } = settings;
  // ---- Mode-switch rules (one-way valve; see utils/modeSwitch.ts) ----------
  const hasProData = hasProFeatureData(lib.screenplay);
  const applyMode = useCallback((mode: 'simple' | 'cinematic') => {
    lib.setScreenplay(prev => ({ ...prev, productionMode: mode, lastModified: Date.now() }));
  }, [lib]);
  const handleProductionModeChange = useCallback((target: 'simple' | 'cinematic') => {
    const current = lib.screenplay.productionMode ?? 'simple';
    const check = checkModeSwitch(target, current, hasProData);
    if (!check.allowed) {
      showToast(t[check.reasonCode === 'pro-data' ? 'modeSwitchDataReason' : 'modeSwitchProReason']);
      return;
    }
    if (!check.needsConfirm) { applyMode(target); return; }
    void ask({
      title: t.modeUpgradeTitle,
      body: t.modeUpgradeBody,
      buttons: [
        { label: t.modeUpgradeOk, value: 'ok', kind: 'primary' },
        { label: t.cancel, value: 'no' },
      ],
    }).then(v => { if (v === 'ok') applyMode('cinematic'); });
  }, [lib.screenplay.productionMode, hasProData, ask, applyMode, showToast, t]);
  const handleModeBadgeClick = useCallback(() => {
    const current = lib.screenplay.productionMode ?? 'simple';
    handleProductionModeChange(current === 'simple' ? 'cinematic' : 'simple');
  }, [lib.screenplay.productionMode, handleProductionModeChange]);
  const { handleKeyDown } = kb;
  // Image-generation backend — FAL wins only when its key is configured; an
  // empty FAL key never bricks image generation (falls back to MiniMax).
  const effectiveImageProvider: 'minimax' | 'fal' =
    appSettings.imageProvider === 'fal' && appSettings.falKey.trim()
      ? 'fal'
      : 'minimax';
  const imageReady =
    effectiveImageProvider === 'fal'
      ? !!appSettings.falKey.trim()
      : !!appSettings.minimaxApiKey.trim();

  // ---- P1/P4 merged subsystems: project dir + provider hub -----------------
  // (feat/p1-project-files, re-mounted on the split-app hook architecture)
  const [projectDir, setProjectDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runtimeProfile, setRuntimeProfile] = useState<RuntimeProfile | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [showIRPipeline, setShowIRPipeline] = useState(false);

  useEffect(() => {
    loadPersistedProjectDir().then(h => { if (h) setProjectDir(h); }).catch(() => { /* none persisted */ });
  }, []);
  useEffect(() => {
    if (!projectDir) { setRuntimeProfile(null); return; }
    let cancelled = false;
    void loadRuntimeProfile(projectDir)
      .then(p => { if (!cancelled) setRuntimeProfile(p); })
      .catch(() => { if (!cancelled) setRuntimeProfile(null); });
    return () => { cancelled = true; };
  }, [projectDir]);
  const services: ServiceHub = useMemo(() => createServiceHub(
    defaultRegistry(),
    runtimeProfile ?? defaultProfile(appSettings),
    getSessionCredential,
  ), [runtimeProfile, appSettings]);

  const handleOpenProject = useCallback(async () => {
    if (!isProjectStoreAvailable()) {
      setProjectError(t.projectUnavailable || '此浏览器不支持项目目录(File System Access API)——请用 Chrome/Edge。');
      return;
    }
    try {
      setProjectError(null);
      const h = await pickProjectDir();
      if (!(await requestDirPermission(h))) {
        setProjectError('Permission denied for the project folder');
        return;
      }
      const opened = await openProject(h, lib.screenplay, lib.screenplay.metadata.styleHead, appSettings.colorSettings);
      await persistProjectDir(h);
      setProjectDir(h);
      if (!opened.created) lib.setScreenplay(opened.screenplay);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
      shipLog('project', 'error', 'Open project failed', e);
    }
  }, [lib, appSettings.colorSettings, t]);

  const handleCloseProject = useCallback(async () => {
    await forgetProjectDir();
    setProjectDir(null);
    setRuntimeProfile(null);
  }, []);

  // P4 credential file (session memory ⇄ encrypted file, keyring 层见 services/desktop.ts)
  const handleExportCredentials = useCallback(async () => {
    const slots: Record<string, string> = {};
    for (const [field, slot] of Object.entries(SLOT_FOR_FIELD)) {
      const v = (appSettings as unknown as Record<string, string>)[field];
      if (v) slots[slot] = v;
    }
    for (const [slot, v] of Object.entries(sessionCredentialSnapshot())) if (!slots[slot]) slots[slot] = v;
    const passphrase = window.prompt(L_T(t, 'credPassphraseSet', '设置凭证文件口令（用于加密导出）'));
    if (!passphrase) return;
    const blob = await exportCredentialFile(slots, passphrase);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'storyflow-credentials.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [appSettings, t]);

  const handleImportCredentials = useCallback(async (file: File) => {
    const passphrase = window.prompt(L_T(t, 'credPassphraseEnter', '输入凭证文件口令'));
    if (!passphrase) return;
    try {
      const slots = await importCredentialFile(file, passphrase);
      const fieldForSlot: Record<string, string> = Object.fromEntries(
        Object.entries(SLOT_FOR_FIELD).map(([field, slot]) => [slot, field]),
      );
      const patch: Record<string, string> = {};
      for (const [slot, v] of Object.entries(slots)) {
        const field = fieldForSlot[slot];
        if (field) { patch[field] = v; setSessionCredential(slot, v); }
      }
      setAppSettings(prev => ({ ...prev, ...patch } as typeof prev));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }, [setAppSettings, showToast]);

  const handleClearCredentials = useCallback(() => {
    clearSessionCredentials();
    setAppSettings(prev => ({
      ...prev,
      geminiApiKey: '', deepseekApiKey: '', minimaxApiKey: '', asrApiKey: '', falKey: '',
    }));
  }, [setAppSettings]);

  // Theme: honor the OS preference once on mount, then reflect state on <html>.

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

  // One-time migration: old per-script localStorage bindings → screenplay.
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

  // ---- WebMCP (Web Model Context Protocol) ---------------------------------
  // Exposes StoryFlow operations as standardized in-browser tools for AI
  // agents (ChatGPT's browser etc.). Experimental API, secure contexts only —
  // on the LAN-IP dev setup registration quietly no-ops. The accessor is
  // refreshed every render into a latest-ref so tool executions always see
  // current state without re-registering.
  const webmcpAccessorRef = useRef<StoryflowWebMcpAccessor | null>(null);
  useEffect(() => registerStoryflowWebMcpTools(webmcpAccessorRef as { current: StoryflowWebMcpAccessor }), []);

  // Refreshed every render (latest-ref) so tool executions always see current
  // state without re-registering. MUST stay in the render body, not an effect —
  // the useEffect above only hands the ref to the registry after it is filled.
  webmcpAccessorRef.current = createWebMcpAccessor({
    screenplay: lib.screenplay, setScreenplay: lib.setScreenplay, savedScripts: lib.savedScripts, appSettings, lang,
    refImages: assets.refImages,
    handleUploadRefImage: assets.handleUploadRefImage, effectiveImageProvider, imageReady, setSelectedBlockId: lib.setSelectedBlockId,
  });
  const { handleBlockChange, handleTypeChange, handleDeleteGraybox, handleDeleteImagePrompt } = ed;




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
          onRename={mgmt.handleRenameScript}
          hasProData={hasProData}
          onModeBadgeClick={handleModeBadgeClick}
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
          services={services}
        />


        <Toolbar
            productionMode={lib.screenplay.productionMode ?? 'simple'}
            onOpenExpressWorkbench={() => setShowExpressWorkbench(true)}
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
          onToast={showToast}
          onProductionModeChange={(mode) => lib.setScreenplay(prev => ({ ...prev, productionMode: mode, lastModified: Date.now() }))}
          showExpressWorkbench={showExpressWorkbench}
          setShowExpressWorkbench={setShowExpressWorkbench}
          services={services}
          projectName={projectDir?.name ?? null}
          projectAvailable={isProjectStoreAvailable()}
          projectError={projectError}
          onOpenProject={handleOpenProject}
          onCloseProject={handleCloseProject}
          onExportCredentials={handleExportCredentials}
          onImportCredentials={handleImportCredentials}
          onClearCredentials={handleClearCredentials}
          runtimeProfileInfo={runtimeProfile
            ? { source: 'file' as const, bindings: runtimeProfile.bindings ?? {}, endpoints: Object.keys(runtimeProfile.endpoints ?? {}) }
            : { source: 'default' as const, bindings: {}, endpoints: Object.keys(defaultProfile(appSettings).endpoints ?? {}) }}
          onOpenCompose={() => setShowCompose(true)}
          onOpenCandidates={() => setShowCandidates(true)}
          onOpenIRPipeline={() => setShowIRPipeline(true)}
        />

      {askDialog}

      {/* P1/P4/P5 merged subsystems + IR pipeline entry (三线合并接线) */}
      <ComposeExportModal
          open={showCompose}
          screenplay={lib.screenplay}
          t={t}
          onClose={() => setShowCompose(false)}
      />
      <CandidatesPanel
          open={showCandidates}
          dir={projectDir}
          t={t}
          onClose={() => setShowCandidates(false)}
      />
      <IRPipelineModal
          open={showIRPipeline}
          screenplay={lib.screenplay}
          t={t}
          onClose={() => setShowIRPipeline(false)}
      />

      {toast && (
        <div
          key={toast.key}
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg bg-zinc-900/95 text-gray-100 text-sm border border-zinc-700 animate-[fadeIn_.2s_ease-out]"
        >
          {toast.msg}
        </div>
      )}
      </div>
    </div>
  );
}

export default App;