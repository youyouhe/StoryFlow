import { useCallback, useMemo } from 'react';
import { AIState, AIMode, Language, RefBindings } from '../types';
import { TRANSLATIONS } from '../constants';
import { useScriptLibrary } from './useScriptLibrary';
import { useAppSettings } from './useAppSettings';
import { useGallerySync } from './useGallerySync';
import { useRefAssetLibrary } from './useRefAssetLibrary';
import { useH3VideoPlan } from './useH3VideoPlan';
import { useBlockEditing } from './useBlockEditing';
import { useAIExecutor } from './useAIExecutor';
import { useEditorKeyboard } from './useEditorKeyboard';
import { useTemplateFlow } from './useTemplateFlow';
import { useImportExport } from './useImportExport';
import { useScriptManagement } from './useScriptManagement';

/**
 * Composition root — assembles every domain hook in dependency order and
 * returns the whole application controller. App.tsx owns pure UI state
 * (theme, modals, read-only, drafts) and renders; this owns the wiring
 * between domains.
 *
 * `ui` carries the App-owned state pieces the domains read or write. Every
 * hook below is invoked exactly as it was inline in App.tsx during the
 * wave-2 split — same arguments, same dependency chains.
 */
export function useStoryFlowApp(ui: {
  lang: Language;
  aiMode: AIMode;
  setAIMode: React.Dispatch<React.SetStateAction<AIMode>>;
  aiState: AIState;
  setAIState: React.Dispatch<React.SetStateAction<AIState>>;
  setShowAIModal: React.Dispatch<React.SetStateAction<boolean>>;
  setIsReadOnly: React.Dispatch<React.SetStateAction<boolean>>;
  isReadOnly: boolean;
  promptSource: string;
  setTransitionHeadingDraft: React.Dispatch<React.SetStateAction<string>>;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowStyleHeadModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    lang, aiMode, setAIMode, aiState, setAIState, setShowAIModal,
    setIsReadOnly, isReadOnly, promptSource, setTransitionHeadingDraft,
    setSidebarOpen, setShowStyleHeadModal,
  } = ui;

  // ---- Script library domain (index + active screenplay + autosave) --------
  const lib = useScriptLibrary();

  // ---- App settings domain (persisted settings + migrations + save) --------
  const settings = useAppSettings({ setScreenplay: lib.setScreenplay });
  const { appSettings } = settings;

  // ---- Gallery sync domain (4A SSO session, badges, cloud visibility) ------
  const sync = useGallerySync({ savedScripts: lib.savedScripts, refreshSavedScripts: lib.refreshSavedScripts });

  // Bindings live INSIDE the screenplay; the writer + derived view sit here.
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

  // ---- H3 video-plan domain (tasks, VIDEO_PLAN knobs, submission, polling) -
  const h3 = useH3VideoPlan({
    appSettings,
    screenplayBlocks: lib.screenplay.blocks,
    refBindings,
    refImages: assets.refImages,
    setAIState,
  });

  // ---- Block editing domain (content/type mutations, payload deletes) ------
  const ed = useBlockEditing({ setScreenplay: lib.setScreenplay, isReadOnly });

  const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];

  // ---- AI orchestration domain (executeAI + accept/replan effects) ---------
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
    promptSource, t, isReadOnly,
    handleBlockChange: ed.handleBlockChange,
  });

  // ---- Editor keyboard domain (shortcuts + editing keys) -------------------
  const kb = useEditorKeyboard({
    appSettings,
    screenplay: lib.screenplay,
    setScreenplay: lib.setScreenplay,
    setSelectedBlockId: lib.setSelectedBlockId,
    handleTypeChange: ed.handleTypeChange,
    isReadOnly, t,
    executeAI: ai.executeAI,
    handleSyncScript: sync.handleSyncScript,
    setSyncError: sync.setSyncError,
    setAIMode, setShowAIModal,
  });

  // ---- Script management orchestration (load/delete/rename) ----------------
  const mgmt = useScriptManagement({
    screenplay: lib.screenplay,
    setScreenplay: lib.setScreenplay,
    savedScripts: lib.savedScripts,
    setSavedScripts: lib.setSavedScripts,
    loadScript: lib.loadScript,
    createDefaultScript: lib.createDefaultScript,
    setSyncError: sync.setSyncError,
    setSyncStatusMap: sync.setSyncStatusMap,
    setSidebarOpen, t,
  });

  // ---- Template flow domain (gallery modal + opening picker + creators) ----
  const tpl = useTemplateFlow({
    screenplay: lib.screenplay,
    setScreenplay: lib.setScreenplay,
    setSelectedBlockId: lib.setSelectedBlockId,
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

  const activeSceneId = useMemo(() => {
    const idx = lib.screenplay.blocks.findIndex(b => b.id === lib.selectedBlockId);
    if (idx < 0) return null;
    for (let i = idx; i >= 0; i--) {
      if (lib.screenplay.blocks[i].type === 'SCENE_HEADING') return lib.screenplay.blocks[i].id;
    }
    return null; // blocks before the first scene heading — nothing to highlight
  }, [lib.screenplay.blocks, lib.selectedBlockId]);

  const scrollToBlock = useCallback((id: string) => {
    lib.setSelectedBlockId(id);
    const element = document.getElementById(`block-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [lib]);

  return { lib, settings, sync, assets, h3, ed, ai, kb, mgmt, tpl, io, refBindings, handleRefBindingsChange, t, activeSceneId, scrollToBlock };
}
