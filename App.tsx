import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Screenplay, ScriptBlock, BlockType, AIState, Language, ScriptMetadata, AppSettings, ScriptTemplate, AIMode, ExportFormat, ExportOptions, GrayboxData, RefImage, RefBindings, H3Task, GalleryUser, SyncStatus } from './types';
import { DEFAULT_SCRIPT, TRANSLATIONS, TEMPLATES, DEFAULT_APP_SETTINGS } from './constants';
import { EditorBlock } from './components/EditorBlock';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { SettingsModal } from './components/SettingsModal';
import { StyleHeadModal } from './components/StyleHeadModal';
import { generateContinuation, suggestIdeas, rewriteBlock, generateImagePrompt, generateGraybox, generateSegmentGraybox, decideSceneTransition, generateOpenings, OpeningCandidate, analyzeDubbing, generateSequences, screenplayFromPrompt } from './services/geminiService';
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
import { buildSegmentVideoPrompt, clampSegmentSeconds, resolveSegmentRefs } from './utils/videoSegmentSubmit';
import { MINIMAX_VIDEO_MODELS } from './constants';
import type { VideoPlan } from './utils/videoPlan';

// Boot ping — a mere page load produces a log entry, proving the debug
// shipping pipeline works end-to-end and telling us which build the user runs.
shipLog('boot', 'info', `app loaded @ ${new Date().toISOString()} · UA=${navigator.userAgent.slice(0, 60)} · ${screen.width}x${screen.height}`);
import { copyToClipboard } from './utils/clipboard';
import { planVideoSegments, formatVideoPlan } from './utils/videoPlan';
import { sanitizeParsedBlocks } from './utils/scriptParse';
import { listRefImages, addRefImage, updateRefImageMeta, removeRefImage as removeStoredRefImage, computeVersionGroup, promoteVersion, RefImageMetaPatch } from './services/refImageStore';
import {
  isDirStoreAvailable, pickAssetDir, persistDirHandle, loadPersistedDirHandle,
  queryDirPermission, requestDirPermission, listDirAssets, addAssetToDir,
  updateAssetMetaInDir, removeAssetFromDir, mergeIdbIntoDir,
} from './services/assetDirStore';
import { RefAssetLibraryModal, REF_LIBRARY_LABELS } from './components/RefAssetLibraryModal';
import { GalleryModal } from './components/GalleryModal';
import { AIModal } from './components/AIModal';
import { TemplateModal } from './components/TemplateModal';
import { OpeningPicker } from './components/OpeningPicker';
import { PromptPanel } from './components/PromptPanel';
import { uploadH3Video, createH3Task, queryH3Task, estimateH3Cost, validateH3Submission, H3ReferenceImage, generateImages } from './services/minimaxService';
import { comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask } from './services/comfyService';
import { getAiLog } from './services/aiLog';
import { galleryClient, syncEngine, readAllSyncStatuses, syncStore } from './services/gallery';
import { initSSO, getSsoToken, clearToken, requireLogin, logoutEverywhere } from './services/auth4a';
import { isGalleryApiError } from './services/apiClient';
import type { ScriptVisibility } from './services/apiClient';
import { exportMarkdown, exportJSON } from './utils/exportData';
import { Menu, Moon, Sun, PanelLeft, Cloud, Check, Loader2, Languages } from 'lucide-react';
import { clsx } from 'clsx';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 11);

/** Full-field mapper — every library-loading path MUST carry the v2 identity
 *  fields (kind/charName/variant/sceneKey/scriptIds/version*), or category
 *  tabs, script filters and version badges silently break (live bug). */
const toRefImage = (s: {
  id: string; name: string; size: number; createdAt: number;
  blob?: Blob; url?: string; type?: string;
  subject?: string; kind?: RefImage['kind']; charName?: string; variant?: string;
  sceneKey?: string; scriptIds?: string[]; versionGroup?: string; version?: number;
  isSelected?: boolean; source?: RefImage['source']; sourcePrompt?: string;
}): RefImage => ({
  id: s.id,
  name: s.name,
  type: s.type ?? (s.blob?.type || 'image/*'),
  size: s.size,
  createdAt: s.createdAt,
  url: s.url ?? (s.blob ? URL.createObjectURL(s.blob) : ''),
  subject: s.subject,
  kind: s.kind,
  charName: s.charName,
  variant: s.variant,
  sceneKey: s.sceneKey,
  scriptIds: s.scriptIds ?? [],
  versionGroup: s.versionGroup,
  version: s.version,
  isSelected: s.isSelected,
  source: s.source ?? 'upload',
  sourcePrompt: s.sourcePrompt,
});

// Storage Constants
const STORAGE_KEYS = {
    LEGACY_AUTOSAVE: 'screenplay_autosave',
    SCRIPT_INDEX: 'script_index',
    SCRIPT_PREFIX: 'script_',
    APP_SETTINGS: 'screenplay_app_settings'
};

interface ScriptSummary {
    id: string;
    title: string;
    lastModified: number;
}

function App() {
  // Load Script List (Index)
  const [savedScripts, setSavedScripts] = useState<ScriptSummary[]>(() => {
      try {
          const indexJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_INDEX);
          return indexJson ? JSON.parse(indexJson) : [];
      } catch (e) {
          console.warn("Failed to load script index", e); shipLog("script", "error", "Failed to load script index", e);
          return [];
      }
  });

  // Load Initial Screenplay
  const [screenplay, setScreenplay] = useState<Screenplay>(() => {
    // 1. Try migration from legacy system first
    try {
        const legacySave = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTOSAVE);
        if (legacySave) {
            const parsed = JSON.parse(legacySave);
            if (parsed && Array.isArray(parsed.blocks)) {
                // Ensure it has an ID
                if (!parsed.id) parsed.id = generateId();
                if (!parsed.metadata.scriptLanguage) parsed.metadata.scriptLanguage = 'en';
                
                // Return legacy script to be set as current, migration happens in useEffect
                return parsed;
            }
        }
    } catch (e) {
        console.warn("Legacy migration check failed", e);
    }

    // 2. Try loading the most recent script from the index
    try {
        const indexJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_INDEX);
        if (indexJson) {
            const index: ScriptSummary[] = JSON.parse(indexJson);
            if (index.length > 0) {
                // Sort by recency
                index.sort((a, b) => b.lastModified - a.lastModified);
                const mostRecentId = index[0].id;
                const scriptJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_PREFIX + mostRecentId);
                if (scriptJson) {
                    return JSON.parse(scriptJson);
                }
            }
        }
    } catch (e) {
        console.warn("Failed to load recent script", e); shipLog("script", "error", "Failed to load recent script", e);
    }

    // 3. Fallback to default
    const newScript = { ...DEFAULT_SCRIPT, id: generateId() };
    return newScript;
  });

  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.APP_SETTINGS);
        if (saved) {
            const parsed = JSON.parse(saved);
            return {
                ...DEFAULT_APP_SETTINGS,
                ...parsed,
                colorSettings: { ...DEFAULT_APP_SETTINGS.colorSettings, ...(parsed.colorSettings || {}) },
                shortcuts: { ...DEFAULT_APP_SETTINGS.shortcuts, ...(parsed.shortcuts || {}) },
                // Ensure autoAcceptAI has a value (for backward compatibility)
                autoAcceptAI: parsed.autoAcceptAI ?? DEFAULT_APP_SETTINGS.autoAcceptAI,
                // Migrate deprecated Gemini model names to the current default (3.7 Flash)
                geminiModel: ['gemini-2.0-flash', 'gemini-2.5-flash'].includes(parsed.geminiModel)
                    ? DEFAULT_APP_SETTINGS.geminiModel
                    : (parsed.geminiModel || DEFAULT_APP_SETTINGS.geminiModel),
                // Ensure geminiThinkingLevel has a value (added when thinking controls shipped)
                geminiThinkingLevel: parsed.geminiThinkingLevel || DEFAULT_APP_SETTINGS.geminiThinkingLevel,
                // Migrate deprecated DeepSeek model names to the current default (V4 Flash)
                deepseekModel: ['deepseek-chat', 'deepseek-reasoner'].includes(parsed.deepseekModel)
                    ? DEFAULT_APP_SETTINGS.deepseekModel
                    : (parsed.deepseekModel || DEFAULT_APP_SETTINGS.deepseekModel),
                // Migrate the old direct MiniMax URL to the dev proxy: settings saved
                // before the proxy shipped carry the old default verbatim and would
                // otherwise override it forever.
                minimaxBaseUrl: parsed.minimaxBaseUrl === 'https://api.minimaxi.com'
                    ? DEFAULT_APP_SETTINGS.minimaxBaseUrl
                    : (parsed.minimaxBaseUrl || DEFAULT_APP_SETTINGS.minimaxBaseUrl)
            };
        }
    } catch (e) {
        console.warn("Failed to load app settings", e);
    }
    return DEFAULT_APP_SETTINGS;
  });
  
  const [selectedBlockId, setSelectedBlockId] = useState<string>(() => {
      return screenplay.blocks.length > 0 ? screenplay.blocks[0].id : '';
  });
  
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState<Language>('en');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  // Gallery cloud sync (P1): signed-in user, per-script badge statuses, last error.
  // 4A SSO first: recover the sso_token (URL ?sso_token= → localStorage →
  // shared cookie) so the exchange effect below can establish the session.
  initSSO();
  const [galleryUser, setGalleryUser] = useState<GalleryUser | null>(galleryClient.user);
  const [syncStatusMap, setSyncStatusMap] = useState<Record<string, SyncStatus>>(readAllSyncStatuses);
  const [cloudVisMap, setCloudVisMap] = useState<Record<string, ScriptVisibility>>({});
  const [syncError, setSyncError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [aiState, setAIState] = useState<AIState>({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
  const [showAIModal, setShowAIModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [openingPicker, setOpeningPicker] = useState<ScriptTemplate | null>(null);
  const [openingOptions, setOpeningOptions] = useState<OpeningCandidate[] | null>(null);
  const [openingsLoading, setOpeningsLoading] = useState(false);
  const [openingsError, setOpeningsError] = useState<string | null>(null);
  const [chosenOpening, setChosenOpening] = useState<number | null>(null);
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
  // White-model reference-image library (global, IndexedDB-backed) and the
  // per-screenplay capsule→image bindings (localStorage). Blobs stay out of
  // the screenplay JSON so exports remain clean; object URLs are session-only.
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  // Directory-backed asset backend (File System Access API). Null = IndexedDB
  // fallback (LAN-IP context / Firefox / Safari / not picked yet).
  const [assetDir, setAssetDir] = useState<FileSystemDirectoryHandle | null>(null);
  // Bindings now live INSIDE the screenplay (travel with export/import);
  // localStorage `ref_bindings_*` is migrated once below.
  const refBindings: RefBindings = screenplay.referenceBindings ?? { characters: {} };
  const handleRefBindingsChange = useCallback((next: RefBindings) => {
    setScreenplay(prev => ({ ...prev, referenceBindings: next, lastModified: Date.now() }));
  }, []);
  // MiniMax H3 generation tasks (white-model submission pipeline)
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGenError, setImageGenError] = useState<string | null>(null);
  // Inline success preview at the click site (the image is already in the
  // library; this just shows it where the user generated it).
  const [imageGenPreview, setImageGenPreview] = useState<{ blockId: string; url: string; subject: string } | null>(null);
  const [h3Tasks, setH3Tasks] = useState<H3Task[]>(() => {
    try {
      const raw = localStorage.getItem('h3_tasks');
      return raw ? (JSON.parse(raw) as H3Task[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('h3_tasks', JSON.stringify(h3Tasks.slice(0, 50))); } catch { /* ignore */ }
  }, [h3Tasks]);
  // Per-segment H3 submission progress for the VIDEO_PLAN batch button.
  const [planH3Progress, setPlanH3Progress] = useState<{ current: number; total: number } | null>(null);
  // VIDEO_PLAN knobs: which CN model renders, and the per-segment window.
  // The window is BOTH the planner grouping target and the submitted
  // duration cap — one knob, no drift between plan and submission.
  const [videoPlanModelId, setVideoPlanModelId] = useState(MINIMAX_VIDEO_MODELS[0].id);
  const videoPlanModel = MINIMAX_VIDEO_MODELS.find(m => m.id === videoPlanModelId) ?? MINIMAX_VIDEO_MODELS[0];
  const [videoPlanDuration, setVideoPlanDuration] = useState(10);
  const [planResolution, setPlanResolution] = useState<'480P' | '768P' | '2K'>('768P');
  // The live plan (replaces the old window stash — state is reactive and dies
  // with the script, so a stale plan can never cross-submit into another one).
  const [videoPlan, setVideoPlan] = useState<VideoPlan | null>(null);
  // Live H3 tasks belonging to the current plan's chain — rendered in the
  // modal so simple-mode users see progress WITHOUT opening the graybox 3D
  // view (where task lists used to live, invisible in simple mode).
  const planChainId = videoPlan ? `videoplan-${videoPlan.segments[0].blockIds[0]}` : null;
  const planTasks = useMemo(() => {
    if (!planChainId) return [];
    // Collapse history: every submit attempt creates new records with the
    // same chainId — show ONLY the newest task per segment.
    const newest = new Map<number, H3Task>();
    for (const t of h3Tasks) {
      if (t.chainId !== planChainId) continue;
      const k = t.segmentIndex ?? 0;
      const cur = newest.get(k);
      if (!cur || t.createdAt > cur.createdAt) newest.set(k, t);
    }
    return [...newest.values()].sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
  }, [h3Tasks, planChainId]);

  // Pre-flight scan: which cast members of each segment have bound sheets.
  // Recomputed whenever bindings/images change, so the checklist in the modal
  // is always current at the moment the user reads it.
  const planPreflight = useMemo(() => {
    if (!videoPlan) return null;
    return videoPlan.segments.map((seg, i) => {
      const refs = resolveSegmentRefs(seg, screenplay.blocks, refBindings, refImages);
      const seconds = clampSegmentSeconds(seg.duration, videoPlanModel.min, videoPlanDuration);
      return {
        index: i + 1,
        seconds,
        span: Math.round(seg.duration * 10) / 10,
        beatCount: seg.beats.length,
        characters: refs.bound,
        missing: refs.missing,
        offScreen: refs.offScreen,
        sceneEnv: refs.sceneEnv,
        cost: estimateH3Cost({
          outputSeconds: seconds,
          imageCount: refs.bound.length,
          resolution: planResolution,
          model: videoPlanModel.id,
        }),
      };
    });
  }, [videoPlan, screenplay.blocks, refBindings, refImages, videoPlanModel, videoPlanDuration, planResolution]);
  const planCostTotal = useMemo(
    () => (planPreflight ?? []).reduce((a, s) => a + s.cost, 0),
    [planPreflight],
  );
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

  const [viewingTemplate, setViewingTemplate] = useState<ScriptTemplate | null>(null);

  // ---- WebMCP (Web Model Context Protocol) ---------------------------------
  // Exposes StoryFlow operations as standardized in-browser tools for AI
  // agents (ChatGPT's browser etc.). Experimental API, secure contexts only —
  // on the LAN-IP dev setup registration quietly no-ops. The accessor is
  // refreshed every render into a latest-ref so tool executions always see
  // current state without re-registering.
  const webmcpAccessorRef = useRef<StoryflowWebMcpAccessor | null>(null);
  useEffect(() => registerStoryflowWebMcpTools(webmcpAccessorRef as { current: StoryflowWebMcpAccessor }), []);

  // ---- white-model reference images + bindings ------------------------------
  // Library load: prefer the persisted asset FOLDER (cross-device "backend"),
  // fall back to IndexedDB. Object URLs are session-scoped.
  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    (async () => {
      try {
        const h = await loadPersistedDirHandle();
        if (h && (await queryDirPermission(h)) === 'granted') {
          const assets = await listDirAssets(h);
          if (cancelled) return;
          setAssetDir(h);
          setRefImages(assets.map((a) => toRefImage(a)));
          return;
        }
      } catch { /* dir unreadable — fall through */ }
      const stored = await listRefImages().catch(() => []);
      if (cancelled) return;
      const mapped = stored.map((s) => toRefImage(s));
      urls.push(...mapped.map((m) => m.url));
      setRefImages(mapped);
    })();
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

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

  const handleUploadRefImage = useCallback(async (
    file: File,
    subject?: string,
    sourcePrompt?: string,
    source: 'upload' | 'ai-generate' | 'video-frame' = 'upload',
    identity?: { kind: 'character' | 'environment' | 'prop' | 'action'; charName?: string; variant?: string; sceneKey?: string },
  ): Promise<string | null> => {
    // v2 identity: pin to the current script; same-identity regenerations join
    // one version group (history kept, the newest becomes the selected one).
    const kind = identity?.kind ?? 'environment';
    const scriptIds = [screenplay.id];
    const versionGroup = computeVersionGroup({ kind, charName: identity?.charName ?? subject, variant: identity?.variant, sceneKey: identity?.sceneKey, scriptIds });
    const siblings = refImages.filter(r => r.versionGroup === versionGroup);
    const version = siblings.length ? Math.max(...siblings.map(r => r.version ?? 1)) + 1 : 1;
    const meta: RefImageMetaPatch = {
      subject, source, sourcePrompt,
      kind, charName: identity?.charName, variant: identity?.variant, sceneKey: identity?.sceneKey,
      scriptIds, versionGroup, version, isSelected: true,
    };
    try {
      if (assetDir) {
        const a = await addAssetToDir(assetDir, file, meta);
        setRefImages((prev) => [...prev.map(r => r.versionGroup === versionGroup ? { ...r, isSelected: false } : r), {
          id: a.id, name: a.name, type: file.type || 'image/*', size: a.size, createdAt: a.createdAt,
          url: a.url, subject: a.subject, source: a.source ?? 'upload', sourcePrompt: a.sourcePrompt,
          kind: a.kind, charName: a.charName, variant: a.variant, sceneKey: a.sceneKey, scriptIds: a.scriptIds,
          versionGroup: a.versionGroup, version: a.version, isSelected: a.isSelected ?? true,
        }]);
        if (siblings.length) promoteVersion(versionGroup, a.id).catch(() => {});
        return a.id;
      } else {
        const stored = await addRefImage(file, meta);
        setRefImages((prev) => [...prev.map(r => r.versionGroup === versionGroup ? { ...r, isSelected: false } : r), {
          id: stored.id, name: stored.name, type: stored.type, size: stored.size, createdAt: stored.createdAt,
          url: URL.createObjectURL(stored.blob),
          subject: stored.subject, source: stored.source ?? 'upload', sourcePrompt: stored.sourcePrompt,
          kind: stored.kind, charName: stored.charName, variant: stored.variant, sceneKey: stored.sceneKey, scriptIds: stored.scriptIds,
          versionGroup: stored.versionGroup, version: stored.version, isSelected: stored.isSelected ?? true,
        }]);
        if (siblings.length) promoteVersion(versionGroup, stored.id).catch(() => {});
        return stored.id;
      }
    } catch (e) {
      console.warn('Failed to store reference image', e); shipLog("asset", "error", "Failed to store reference image", e);
      return null;
    }
  }, [assetDir, screenplay.id, refImages]);

  /** Library metadata edits (rename / re-tag subject) — persisted, UI state synced. */
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const handleUpdateRefImageMeta = useCallback((id: string, patch: { name?: string; subject?: string }) => {
    setRefImages((prev) => prev.map((im) => im.id === id ? { ...im, ...patch, subject: patch.subject || undefined } : im));
    if (assetDir) updateAssetMetaInDir(assetDir, id, patch).catch((e) => console.warn('Failed to update asset meta', e));
    else updateRefImageMeta(id, patch).catch((e) => console.warn('Failed to update asset meta', e));
  }, [assetDir]);

  /** User gesture: pick/restore the asset folder (the disk "backend"). */
  const handleOpenAssetDir = useCallback(async () => {
    if (!isDirStoreAvailable()) {
      alert('当前环境不支持文件夹资产库（需要 Chrome/Edge + localhost 或 HTTPS）。已使用浏览器本地存储。');
      return;
    }
    const h = assetDir ?? await pickAssetDir();
    if (!h) return;
    if ((await queryDirPermission(h)) !== 'granted') {
      if (!(await requestDirPermission(h))) return;
    }
    try {
      await persistDirHandle(h);
      // One-time migration: bring the browser-storage library (with identity,
      // versions, provenance) into the folder. Idempotent by asset id.
      let migratedNote = '';
      try {
        const idbRecords = await listRefImages();
        const n = await mergeIdbIntoDir(h, idbRecords);
        if (n) migratedNote = `（已自动迁移 ${n} 张浏览器存量资产）`;
      } catch (e) {
        console.warn('IDB→folder migration failed', e);
      }
      const assets = await listDirAssets(h);
      setAssetDir(h);
      if (migratedNote) console.info('[assets]', migratedNote);
      setRefImages(assets.map((a) => toRefImage(a)));
    } catch (e) {
      console.warn('Failed to open asset folder', e); shipLog("asset", "error", "Failed to open asset folder", e);
    }
  }, [assetDir]);

  /** Switch the asset folder to a DIFFERENT directory. Unlike
   *  handleOpenAssetDir (first-time adopt, which migrates browser-storage
   *  assets in), switching re-points the library at the newly picked folder
   *  and reloads its contents — no migration, no side effects on the old
   *  folder. */
  const handleSwitchAssetDir = useCallback(async () => {
    if (!isDirStoreAvailable()) {
      alert('当前环境不支持文件夹资产库（需要 Chrome/Edge + localhost 或 HTTPS）。');
      return;
    }
    const h = await pickAssetDir();
    if (!h) return;
    if ((await queryDirPermission(h)) !== 'granted') {
      if (!(await requestDirPermission(h))) return;
    }
    try {
      await persistDirHandle(h);
      const assets = await listDirAssets(h);
      setAssetDir(h);
      setRefImages(assets.map((a) => toRefImage(a)));
    } catch (e) {
      console.warn('Failed to switch asset folder', e); shipLog("asset", "error", "Failed to switch asset folder", e);
    }
  }, []);

  /** Re-scan the asset store — manual button + auto-triggered when a phone
   *  drop (LocalSend) lands new files or a cloud download imports locally. */
  const reloadAssets = useCallback(async () => {
    if (!assetDir) {
      // IndexedDB backend: re-read the store into display state.
      const stored = await listRefImages().catch(() => []);
      setRefImages(stored.map((s) => toRefImage(s)));
      return;
    }
    try {
      const assets = await listDirAssets(assetDir);
      setRefImages(assets.map((a) => toRefImage(a)));
    } catch (e) {
      console.warn('Failed to rescan asset folder', e); shipLog("asset", "warn", "Failed to rescan asset folder", e);
    }
  }, [assetDir]);
  const handleRemoveRefImage = useCallback((id: string) => {
    if (assetDir) removeAssetFromDir(assetDir, id).catch((e) => console.warn('Failed to delete asset file', e));
    else removeStoredRefImage(id).catch((e) => console.warn('Failed to delete reference image', e));
    setRefImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
    // scrub bindings pointing at the removed image
    if (screenplay.referenceBindings) {
      const prev = screenplay.referenceBindings;
      const characters = Object.fromEntries(Object.entries(prev.characters).filter(([, v]) => v !== id));
      const environment = prev.environment === id ? undefined : prev.environment;
      handleRefBindingsChange({ characters, environment });
    }
  }, [assetDir, screenplay.referenceBindings, handleRefBindingsChange]);

  // ---- MiniMax H3 submission (white-model → generated video, BYOK) --------
  const h3Ready = !!appSettings.minimaxApiKey.trim();

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

  /** Submit a recorded white-model video to H3. The view records first, then
   *  hands the blob here; App owns IO, keys, and the task record. */
  const handleSubmitH3 = useCallback(async (payload: {
    blockId: string;
    blockContent: string;
    /** White-model reference video. ABSENT in simple mode: H3 generates
     *  text-to-video conditioned only on prompt + character reference images. */
    videoBlob?: Blob;
    videoSeconds?: number;
    prompt: string;
    resolution: '480P' | '768P' | '2K';
    outputSeconds: number;
    model?: string;
    referenceImageUrls: string[];
    targetSeconds?: number;
    segmentIndex?: number;
    segmentCount?: number;
    chainId?: string;
  }): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> => {
    if (!appSettings.minimaxApiKey.trim()) {
      return { ok: false, error: '未配置 MiniMax API Key——请在 Settings → 视频生成中填写。' };
    }
    // resolve bound reference images (object URLs → blobs)
    const images: H3ReferenceImage[] = [];
    for (const url of payload.referenceImageUrls.slice(0, 9)) {
      try {
        const blob = await (await fetch(url)).blob();
        images.push({ name: `ref-${images.length + 1}`, blob });
      } catch { /* skip unreadable */ }
    }
    const invalid = validateH3Submission({
      prompt: payload.prompt,
      videoBlob: payload.videoBlob,
      videoSeconds: payload.videoSeconds,
      referenceImages: images,
      resolution: payload.resolution,
      outputSeconds: payload.outputSeconds,
    });
    if (invalid) return { ok: false, error: invalid };

    const localId = generateId();
    const estimatedCost = estimateH3Cost({
      videoSeconds: payload.videoSeconds,
      outputSeconds: payload.outputSeconds,
      imageCount: images.length,
      resolution: payload.resolution,
      model: payload.model,
    });
    const baseTask: H3Task = {
      id: localId,
      blockId: payload.blockId,
      blockContent: payload.blockContent.slice(0, 60),
      status: 'uploading',
      prompt: payload.prompt,
      resolution: payload.resolution,
      videoSeconds: payload.videoSeconds,
      outputSeconds: payload.outputSeconds,
      ...(payload.targetSeconds != null ? { targetSeconds: payload.targetSeconds } : {}),
      ...(payload.segmentIndex != null ? { segmentIndex: payload.segmentIndex } : {}),
      ...(payload.segmentCount != null ? { segmentCount: payload.segmentCount } : {}),
      ...(payload.chainId ? { chainId: payload.chainId } : {}),
      estimatedCost,
      createdAt: Date.now(),
    };
    setH3Tasks(prev => [baseTask, ...prev].slice(0, 50));

    const cfg = { apiKey: appSettings.minimaxApiKey.trim(), baseUrl: appSettings.minimaxBaseUrl };
    try {
      setH3Tasks(prev => prev.map(t => t.id === localId ? { ...t, status: 'submitting' } : t));
      // Simple mode: no white-model video — H3 generates text-to-video
      // conditioned on prompt + character reference images only.
      const fileUri = payload.videoBlob ? await uploadH3Video(cfg, payload.videoBlob) : undefined;
      const taskId = await createH3Task(cfg, {
        prompt: payload.prompt,
        videoBlob: payload.videoBlob,
        videoSeconds: payload.videoSeconds,
        referenceImages: images,
        resolution: payload.resolution,
        outputSeconds: payload.outputSeconds,
        model: payload.model,
      }, fileUri);
      setH3Tasks(prev => prev.map(t => t.id === localId ? { ...t, taskId, status: 'queued' } : t));
      return { ok: true, taskId };
    } catch (e: any) {
      const msg = String(e?.message || e);
      setH3Tasks(prev => prev.map(t => t.id === localId ? { ...t, status: 'failed', error: msg } : t));
      return { ok: false, error: msg };
    }
  }, [appSettings.minimaxApiKey, appSettings.minimaxBaseUrl]);

  /** Submit every VIDEO_PLAN segment to H3 as text-to-video (simple mode):
   *  prompt = the segment's timed beats, references = bound character sheets,
   *  no white-model video. Sequential — H3 bills per task and the user reads
   *  progress one segment at a time. */
  const sceneEnvTag = (refs: { sceneEnv?: { name: string; url: string } }): string | null =>
    refs.sceneEnv ? '<Picture 1> is the scene/background reference — keep the desktop, sofa, lighting and composition exactly as shown.' : null;

  const submitPlanToH3 = useCallback(async () => {
    if (!videoPlan || !videoPlan.segments.length) {
      setAIState(prev => ({ ...prev, error: '没有可提交的视频分段计划——请先运行 视频分段。' }));
      return;
    }
    const plan = videoPlan;
    setPlanH3Progress({ current: 0, total: plan.segments.length });
    shipLog('flow', 'info', `H3 plan submission start: ${plan.segments.length} segments`);
    let okCount = 0;
    let firstErr: string | null = null;
    const chainId = `videoplan-${plan.segments[0].blockIds[0]}`;
    for (let si = 0; si < plan.segments.length; si++) {
      const seg = plan.segments[si];
      setPlanH3Progress({ current: si + 1, total: plan.segments.length });
      const refs = resolveSegmentRefs(seg, screenplay.blocks, refBindings, refImages);
      const prompt = buildSegmentVideoPrompt(seg, si + 1, plan.segments.length);
      shipLog('flow', 'info', `H3 segment ${si + 1}/${plan.segments.length}: refs=${refs.bound.length}${refs.missing.length ? ` missing=[${refs.missing.join(',')}]` : ''} prompt=${prompt.length}ch`);

      // ---- Self-hosted ComfyUI path (R2V with refs, else T2V) ----
      // Generation runs on the user's GPU box at near-zero marginal cost;
      // tasks reuse the H3Task record (backend: 'comfy') and the shared
      // poller branches on it.
      if (appSettings.videoBackend === 'comfy' && appSettings.comfyServerUrl.trim()) {
        const comfyCfg = { serverUrl: appSettings.comfyServerUrl };
        const hasT2V = !!appSettings.comfyWorkflowT2V.trim();
        const useR2V = refs.urls.length > 0 && !!appSettings.comfyWorkflowR2V.trim();
        const graphJson = useR2V ? appSettings.comfyWorkflowR2V : appSettings.comfyWorkflowT2V;
        if (!graphJson.trim()) {
          const need = refs.urls.length ? 'R2V（有参考图）' : 'T2V（纯文生图）';
          setPlanH3Progress(null);
          setAIState(prev => ({ ...prev, error: `ComfyUI 缺少${need}工作流——请在 Settings → AI 里导入对应 API 格式 JSON。` }));
          return;
        }
        setPlanH3Progress({ current: si + 1, total: plan.segments.length });
        shipLog('flow', 'info', `COMFY segment ${si + 1}/${plan.segments.length}: ${useR2V ? 'R2V' : 'T2V'} refs=${refs.urls.length} prompt=${prompt.length}ch`);
        try {
          // R2V prompts must reference the materials by tag (pack contract):
          // <Picture 1> = scene env, <Picture N> = each cast sheet in order.
          const refNames: string[] = [];
          for (let ri = 0; ri < refs.urls.length; ri++) {
            const blob = await (await fetch(refs.urls[ri])).blob();
            refNames.push(await comfyUploadImage(comfyCfg, blob, `sf-seg${si + 1}-${ri}.png`));
          }
          const tagLines = [
            ...(sceneEnvTag(refs) ? [sceneEnvTag(refs)!] : []),
            ...refs.bound.map((c, i) => `<Picture ${(sceneEnvTag(refs) ? 1 : 0) + i + 2}> is the design sheet of ${c.name} — the character's identity and face must come from it.`),
          ];
          const comfyPrompt = tagLines.length
            ? `${prompt}\n\nReference materials:\n${tagLines.join('\n')}`
            : prompt;
          const graph = comfyPatchWorkflow(graphJson, { prompt: comfyPrompt, refImageNames: refNames });
          const promptId = await comfyQueuePrompt(comfyCfg, graph);
          shipLog('flow', 'info', `COMFY segment ${si + 1}: queued ${promptId}`);
          const localId = generateId();
          setH3Tasks(prev => [{
            id: localId,
            taskId: promptId,
            blockId: seg.blockIds[0],
            blockContent: (seg.beats[0]?.text ?? seg.sceneHeading).slice(0, 60),
            status: 'queued',
            prompt,
            resolution: planResolution,
            videoSeconds: 0,
            outputSeconds: clampSegmentSeconds(seg.duration, videoPlanModel.min, videoPlanDuration),
            estimatedCost: 0, // self-hosted GPU — no API billing
            segmentIndex: si + 1,
            segmentCount: plan.segments.length,
            chainId,
            backend: 'comfy',
            createdAt: Date.now(),
          }, ...prev]);
          okCount++;
          continue;
        } catch (e) {
          const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
          if (!firstErr) firstErr = msg;
          shipLog('flow', 'error', `COMFY segment ${si + 1} FAILED: ${msg}`);
          continue;
        }
      }
      // ---- MiniMax cloud API path (default) ----
      if (refs.missing.length) {
        shipLog('flow', 'warn', `H3 segment ${si + 1}: characters without sheets: ${refs.missing.join(', ')}`);
      }
      const submitRes = await handleSubmitH3({
        blockId: seg.blockIds[0],
        blockContent: seg.beats[0]?.text ?? seg.sceneHeading,
        prompt,
        resolution: planResolution,
        model: videoPlanModel.id,
        outputSeconds: clampSegmentSeconds(seg.duration, videoPlanModel.min, videoPlanDuration),
        referenceImageUrls: refs.urls,
        videoSeconds: 0, // text-to-video: no white-model input, cost = output only
        targetSeconds: Math.round(seg.duration),
        segmentIndex: si + 1,
        segmentCount: plan.segments.length,
        chainId,
      });
      // `in`-narrowing: this project runs without strictNullChecks, which
      // widens the `ok: true|false` literal discriminant and breaks boolean
      // narrowing — `'error' in` stays reliable under both configs.
      if ('error' in submitRes) {
        if (!firstErr) firstErr = submitRes.error;
        shipLog('flow', 'error', `H3 segment ${si + 1} FAILED: ${submitRes.error}`);
      } else {
        okCount++;
        shipLog('flow', 'info', `H3 segment ${si + 1}: task ${submitRes.taskId}`);
      }
    }
    setPlanH3Progress(null);
    if (firstErr) {
      setAIState(prev => ({ ...prev, error: `${plan.segments.length - okCount}/${plan.segments.length} 段提交失败——${firstErr}` }));
    } else {
      shipLog('flow', 'info', `H3 plan submission done: ${okCount}/${plan.segments.length} tasks created`);
    }
  }, [videoPlan, videoPlanModel, videoPlanDuration, planResolution, screenplay.blocks, refBindings, refImages, handleSubmitH3]);

  // Poll active tasks every 10s while the app is open (official cadence).
  const h3PollInFlight = useRef(false);
  // Guards the one-time background sequence refresh on first scene-level Alt+G.
  const hasSequenceRun = useRef(false);
  useEffect(() => {
    // Failed tasks whose error was serialized as '[object Object]' get ONE
    // more query after the reason-extraction fix, to recover the real
    // server-side failure message.
    const staleErrors = h3Tasks.filter(t =>
      t.status === 'failed' && t.taskId && t.error?.includes('[object Object]'));
    const active = [
      ...h3Tasks.filter(t => (t.status === 'queued' || t.status === 'running') && t.taskId),
      ...staleErrors,
    ];
    if (!active.length || !h3Ready) return;
    const cfg = { apiKey: appSettings.minimaxApiKey.trim(), baseUrl: appSettings.minimaxBaseUrl };
    const timer = window.setInterval(async () => {
      if (h3PollInFlight.current) return;
      h3PollInFlight.current = true;
      try {
        for (const t of active) {
          // stale guard: give up after 30 minutes
          if (Date.now() - t.createdAt > 30 * 60 * 1000) {
            setH3Tasks(prev => prev.map(x => x.id === t.id ? { ...x, status: 'failed', error: '轮询超时（30 分钟）——任务可能仍在 MiniMax 控制台完成，可手动查看。' } : x));
            continue;
          }
          try {
            const s = t.backend === 'comfy'
              ? await comfyQueryTask({ serverUrl: appSettings.comfyServerUrl }, t.taskId!)
              : await queryH3Task(cfg, t.taskId!);
            setH3Tasks(prev => prev.map(x => x.id === t.id
              ? {
                  ...x,
                  status: x.status === 'failed' ? 'failed' as const
                    : s.status === 'cancelled' ? 'failed' as const : s.status,
                  resultUrl: s.videoUrl ?? x.resultUrl,
                  error: s.errorMessage || (s.status === 'cancelled' ? '任务已取消' : x.error),
                }
              : x));
          } catch { /* transient network error — retry next tick */ }
        }
      } finally {
        h3PollInFlight.current = false;
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [h3Tasks, h3Ready, appSettings.minimaxApiKey, appSettings.minimaxBaseUrl, appSettings.videoBackend, appSettings.comfyServerUrl]);

  const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];
  const pages = useMemo(() => paginateBlocks(screenplay.blocks), [screenplay.blocks]);

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

  // Migration & Autosave Logic
  useEffect(() => {
    setSaveStatus('saving');
    
    // Migration Logic: If legacy exists, save it to new format and delete legacy key
    const legacySave = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTOSAVE);
    if (legacySave) {
        try {
             // We are currently working with the migrated object in state 'screenplay'
             // Just ensure the legacy key is removed so we don't migrate again on refresh
             localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTOSAVE);
        } catch(e) { console.error("Migration cleanup failed", e); }
    }

    const timer = setTimeout(() => {
      try {
        // 1. Save Content
        localStorage.setItem(STORAGE_KEYS.SCRIPT_PREFIX + screenplay.id, JSON.stringify(screenplay));

        // 2. Update Index
        const newSummary: ScriptSummary = {
            id: screenplay.id,
            title: screenplay.metadata.title,
            lastModified: Date.now()
        };

        setSavedScripts(prev => {
            const filtered = prev.filter(s => s.id !== screenplay.id);
            const newList = [...filtered, newSummary];
            localStorage.setItem(STORAGE_KEYS.SCRIPT_INDEX, JSON.stringify(newList));
            return newList;
        });

        setSaveStatus('saved');

        // Gallery sync: mirror the local save into the engine. Cloud-backed
        // scripts flip to 'dirty' and flush on the engine's own debounce;
        // never-synced ('local') scripts are intentionally left alone — the
        // first push is always the explicit one-click sync.
        syncEngine.markDirty(screenplay);
      } catch (e) {
        console.error("Autosave failed", e); shipLog("autosave", "error", "Autosave failed", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [screenplay]);

  // Gallery sync engine subscription: keep badge statuses + script index fresh.
  const refreshSavedScripts = useCallback(() => {
    try {
      const idx = JSON.parse(localStorage.getItem(STORAGE_KEYS.SCRIPT_INDEX) || '[]');
      if (Array.isArray(idx)) setSavedScripts(idx);
    } catch { /* ignore */ }
  }, []);

  const refreshGalleryView = useCallback(() => {
    refreshSavedScripts();
    setSyncStatusMap(readAllSyncStatuses());
  }, [refreshSavedScripts]);

  useEffect(() => {
    const off = syncEngine.on(e => {
      if (e.type === 'status') {
        setSyncStatusMap(prev => ({ ...prev, [e.scriptId]: e.status }));
      } else if (e.type === 'synced') {
        setSyncStatusMap(prev => ({ ...prev, [e.scriptId]: 'synced' }));
      } else if (e.type === 'error') {
        setSyncError(e.message);
      } else {
        // 'pulled' | 'conflict-forked': a new local screenplay appeared.
        refreshGalleryView();
      }
    });
    return off;
  }, [refreshGalleryView]);

  // App Settings Autosave
  useEffect(() => {
      localStorage.setItem(STORAGE_KEYS.APP_SETTINGS, JSON.stringify(appSettings));
  }, [appSettings]);

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

  /** P5-openings: template card click opens the opening picker instead of
   *  creating instantly — the user picks the template default or an
   *  AI-invented random opening. */
  /** Import a screenplay from an exported JSON file. Creates a NEW script with
   *  a fresh id (no collision with existing entries); identity fields travel
   *  with the object — referenceBindings, sequences, sourcePrompt, imageResult. */
  const handleImportScript = useCallback(async (file: File) => {
      try {
          const parsed = JSON.parse(await file.text()) as Screenplay;
          if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
              throw new Error('bad-format');
          }
          const imported: Screenplay = {
              ...DEFAULT_SCRIPT,
              ...parsed,
              id: generateId(),
              blocks: parsed.blocks.map(b => ({ ...b, id: generateId() })),
              lastModified: Date.now(),
          };
          setScreenplay(imported);
          setSelectedBlockId(imported.blocks[0].id);
          setIsReadOnly(false);
      } catch (e) {
          console.warn('Import failed:', e); shipLog("import", "error", "Import failed", e);
          alert(t.importScriptError);
      }
  }, [t]);

  /** Export the whole reference library into ONE portable pack file
   *  (metadata + base64 images). The offline answer to "move my assets to
   *  another machine" when cloud sync is unavailable (test env, no balance).
   *  Identity fields travel so the importing side rebuilds the same
   *  version groups / variant slots / bindings targets. */
  const handleExportAssetPack = useCallback(async () => {
      if (!refImages.length) { alert(t.assetPackEmpty); return; }
      const assets: Array<Record<string, unknown>> = [];
      for (const r of refImages) {
          try {
              const blob = await (await fetch(r.url)).blob();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                  const fr = new FileReader();
                  fr.onload = () => resolve(fr.result as string);
                  fr.onerror = () => reject(new Error('read failed'));
                  fr.readAsDataURL(blob);
              });
              assets.push({
                  name: r.name, type: r.type || blob.type || 'image/png',
                  subject: r.subject, kind: r.kind, charName: r.charName, variant: r.variant,
                  sceneKey: r.sceneKey, scriptIds: r.scriptIds, isSelected: r.isSelected,
                  source: r.source, sourcePrompt: r.sourcePrompt, dataUrl,
              });
          } catch (e) { console.warn('Asset pack: skipped unreadable asset', r.id, e); }
      }
      const pack = { storyflowAssetPack: 1 as const, exportedAt: new Date().toISOString(), assets };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(pack)], { type: 'application/json' }));
      a.download = `storyflow-assets-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
  }, [refImages, t]);

  /** Import a pack produced by handleExportAssetPack. Each entry re-enters
   *  through the normal identity-aware upload (handleUploadRefImage), so
   *  version groups / variant slots rebuild exactly as if generated here. */
  const handleImportAssetPack = useCallback(async (file: File) => {
      try {
          const pack = JSON.parse(await file.text()) as { storyflowAssetPack?: number; assets?: Array<Record<string, unknown>> };
          if (pack?.storyflowAssetPack !== 1 || !Array.isArray(pack.assets)) throw new Error('bad pack');
          let ok = 0;
          for (const a of pack.assets) {
              try {
                  const blob = await (await fetch(String(a.dataUrl))).blob();
                  const id = await handleUploadRefImage(
                      new File([blob], String(a.name || 'asset.png'), { type: String(a.type || 'image/png') }),
                      a.subject ? String(a.subject) : undefined,
                      a.sourcePrompt ? String(a.sourcePrompt) : undefined,
                      (a.source as 'upload' | 'ai-generate' | 'video-frame') ?? 'upload',
                      { kind: (a.kind as 'character' | 'environment' | 'prop' | 'action') ?? 'character',
                        charName: a.charName ? String(a.charName) : undefined,
                        variant: a.variant ? String(a.variant) : undefined,
                        sceneKey: a.sceneKey ? String(a.sceneKey) : undefined,
                        },
                  );
                  if (id) ok++;
              } catch (e) { console.warn('Asset pack: failed to import one asset', e); }
          }
          alert(t.assetPackImported.replace('{ok}', String(ok)).replace('{total}', String(pack.assets.length)));
      } catch (e) {
          console.warn('Asset pack import failed:', e);
          alert(t.importScriptError);
      }
  }, [handleUploadRefImage, t]);

  /** Blank start from the OpeningPicker: no AI opening, no template skeleton —
   *  a single empty SCENE_HEADING so the user has a cursor to type into. The
   *  picked template still applies (its systemPrompt/style rules drive later
   *  AI generation). */
  const handleCreateBlankScript = (templateId: string) => {
      const template = TEMPLATES.find(tm => tm.id === templateId) || TEMPLATES[0];
      let newScriptLanguage = screenplay.metadata.scriptLanguage;
      if (newScriptLanguage === 'en' && lang === 'zh') newScriptLanguage = 'zh';
      const firstBlock: ScriptBlock = { id: generateId(), type: 'SCENE_HEADING', content: '' };
      const newScript: Screenplay = {
          id: generateId(),
          metadata: {
              title: 'Untitled ' + (t.templates[template.nameKey as keyof typeof t.templates] || 'Script'),
              author: 'Unknown',
              draft: 'First Draft',
              templateId: template.id,
              scriptLanguage: newScriptLanguage
          },
          blocks: [firstBlock],
          lastModified: Date.now()
      };
      setScreenplay(newScript);
      setSelectedBlockId(firstBlock.id);
      setOpeningPicker(null);
      setShowTemplateModal(false);
      setIsReadOnly(false);
  };

  /** P5-openings: template card click opens the opening picker instead of
   *  creating instantly — the user picks the template default or an
   *  AI-invented random opening. */
  const openOpeningPicker = (template: ScriptTemplate) => {
    setOpeningPicker(template);
    setOpeningOptions(null);
    setOpeningsError(null);
    setChosenOpening(null);
    setOpeningsLoading(true);
    let newScriptLanguage = screenplay.metadata.scriptLanguage;
    if (newScriptLanguage === 'en' && lang === 'zh') newScriptLanguage = 'zh';
    generateOpenings(
      t.templates[template.nameKey as keyof typeof t.templates] || template.id,
      template.systemPrompt,
      newScriptLanguage,
      appSettings
    )
      .then(setOpeningOptions)
      .catch(e => setOpeningsError(String(e?.message || e)))
      .finally(() => setOpeningsLoading(false));
  };

  const handleCreateFromTemplate = (templateId: string, opening?: OpeningCandidate) => {
    const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
    let initialBlocks: Array<Omit<ScriptBlock, 'id'>> = template.initialBlocks;

    let newScriptLanguage = screenplay.metadata.scriptLanguage;
    if (newScriptLanguage === 'en' && lang === 'zh') {
        newScriptLanguage = 'zh';
    }

    if ((newScriptLanguage === 'zh' || newScriptLanguage === 'dual') && template.initialBlocksZh) {
        initialBlocks = template.initialBlocksZh;
    }
    if (opening) initialBlocks = opening.blocks;

    const blocksWithNewIds = initialBlocks.map(b => ({
        ...b,
        id: generateId()
    }));

    // Create NEW Script Object
    const newScript: Screenplay = {
      id: generateId(), // New Unique ID
      metadata: {
        title: 'Untitled ' + (t.templates[template.nameKey as keyof typeof t.templates] || 'Script'),
        author: 'Unknown',
        draft: 'First Draft',
        templateId: template.id,
        scriptLanguage: newScriptLanguage
      },
      blocks: blocksWithNewIds,
      lastModified: Date.now()
    };

    setScreenplay(newScript);
    setSelectedBlockId(blocksWithNewIds[0].id);
    setShowTemplateModal(false);
    setOpeningPicker(null);
    setSidebarOpen(false);
    setIsReadOnly(false);
    setTimeout(() => setSidebarOpen(true), 300);
    // Style head comes first: pick the visual DNA before writing, so every
    // later image prompt locks to one consistent look.
    if (!newScript.metadata.styleHead) setShowStyleHeadModal(true);
  };

  const handleLoadScript = (id: string) => {
      try {
          const scriptJson = localStorage.getItem(STORAGE_KEYS.SCRIPT_PREFIX + id);
          if (scriptJson) {
              const loadedScript = JSON.parse(scriptJson);
              setScreenplay(loadedScript);
              if (loadedScript.blocks.length > 0) {
                  setSelectedBlockId(loadedScript.blocks[0].id);
              }
              // Force sidebar open on mobile if loading
              setSidebarOpen(true);
          }
      } catch (e) {
          console.error("Failed to load script", e); shipLog("script", "error", "Failed to load script", e);
      }
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
                   const newScript = { ...DEFAULT_SCRIPT, id: generateId() };
                   setScreenplay(newScript);
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

  const handleUpdateSettings = (newMetadata: ScriptMetadata, newAppSettings: AppSettings) => {
      setScreenplay(prev => ({
          ...prev,
          metadata: newMetadata,
          lastModified: Date.now()
      }));
      setAppSettings(newAppSettings);
      setShowSettingsModal(false);
  };

  // ---- Gallery account & sync handlers (SettingsModal account tab) ----

  /** Cloud visibility per local script id (cloud-backed only) — powers the
   *  Sidebar lock/globe chip. */
  const refreshCloudVis = useCallback(async () => {
      if (!galleryClient.isAuthenticated) { setCloudVisMap({}); return; }
      try {
          const list = await galleryClient.listScripts();
          const byCloud = new Map(list.map(s => [s.id, s.visibility]));
          const next: Record<string, ScriptVisibility> = {};
          for (const localId of syncStore.allScreenplayIds()) {
              const cloudId = syncStore.getSyncState(localId)?.cloudId;
              const v = cloudId ? byCloud.get(cloudId) : undefined;
              if (v) next[localId] = v;
          }
          setCloudVisMap(next);
      } catch { /* keep last-known map */ }
  }, []);

  /** Cycle a cloud-backed script's visibility from the Sidebar chip. */
  const handleChangeVisibility = useCallback(async (id: string, v: ScriptVisibility) => {
      const cloudId = syncStore.getSyncState(id)?.cloudId;
      if (!cloudId) return;
      setCloudVisMap(prev => ({ ...prev, [id]: v })); // optimistic
      try {
          await galleryClient.setVisibility(cloudId, v);
      } catch (e) {
          setSyncError(e instanceof Error ? e.message : String(e));
          void refreshCloudVis(); // revert to server truth
      }
  }, [refreshCloudVis]);

  /** 4A SSO: exchange the browser's sso_token for a gallery session. */
  const handleSSOExchange = useCallback(async () => {
      const ssoToken = getSsoToken();
      if (!ssoToken || galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          await galleryClient.ssoExchange(ssoToken);
          setGalleryUser(galleryClient.user);
          await syncEngine.onSignedIn();
          refreshGalleryView();
          void refreshCloudVis();
      } catch (e) {
          // 4A rejected the token (expired / revoked / superseded by another
          // device): drop it and return to anonymous instead of retrying a
          // dead token on every reload.
          if (isGalleryApiError(e) && (e.code === 'INVALID_TOKEN' || e.code === 'AUTH_REQUIRED')) {
              clearToken();
          }
          setSyncError(e instanceof Error ? e.message : String(e));
      }
  }, [refreshGalleryView, refreshCloudVis]);

  // SSO token arriving via URL/cookie (login redirect or cross-subdomain):
  // exchange it into a gallery session once, on mount.
  useEffect(() => {
      if (!getSsoToken()) return;
      void handleSSOExchange();
  }, [handleSSOExchange]);

  /** App-level logout: drop the 4A token + gallery session. */
  const handleGalleryLogout = useCallback(async () => {
      const auth = galleryClient.isAuthenticated;
      if (auth) await galleryClient.logout();
      clearToken();
      setGalleryUser(null);
      setCloudVisMap({});
  }, []);

  // Session dropped at runtime (refresh rejected after supersede/revoke):
  // reflect the anonymous state immediately instead of waiting for a reload.
  useEffect(() => {
      galleryClient.onAuthLost = () => {
          setGalleryUser(null);
          setCloudVisMap({});
      };
      return () => { galleryClient.onAuthLost = null; };
  }, []);


  /** One-click sync for a single script (sidebar badge click). */
  const handleSyncScript = useCallback(async (id: string) => {
      if (!galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          await syncEngine.syncNow(id);
      } catch { /* already surfaced via the engine event listener */ }
      refreshGalleryView();
      void refreshCloudVis();
  }, [refreshGalleryView, refreshCloudVis]);



  /** Push every script in the index (account tab button). */
  const handleSyncAll = useCallback(async () => {
      if (!galleryClient.isAuthenticated) return;
      setSyncError(null);
      try {
          for (const s of savedScripts) {
              await syncEngine.syncNow(s.id);
          }
      } catch { /* surfaced via events */ }
      refreshGalleryView();
      void refreshCloudVis();
  }, [savedScripts, refreshGalleryView, refreshCloudVis]);
  // Returning signed-in user: reconcile with the cloud once on app start.
  useEffect(() => {
    if (!galleryClient.isAuthenticated) return;
    void syncEngine.onSignedIn().then(() => { refreshGalleryView(); void refreshCloudVis(); });
  }, [refreshGalleryView, refreshCloudVis]);

  // P5: keep the credit balance in sync with the signed-in 4A identity.
  useEffect(() => {
    if (!galleryUser) { setCreditBalance(null); return; }
    galleryClient.getCreditBalance()
      .then(r => setCreditBalance(r.balance))
      .catch(() => setCreditBalance(null));
  }, [galleryUser]);

  // Unified export dispatcher. The ExportMenu picks a format + options; this
  // routes to the right backend (print pipeline for PDF, Blob download for
  // Markdown/JSON). AI payloads (imagePrompt / graybox) are bundled per the
  // chosen options so the user can grab the whole set at once instead of
  // copying block-by-block.
  const handleExport = useCallback(async (format: ExportFormat, options: ExportOptions) => {
      try {
          if (format === 'pdf') {
              const filename = `${screenplay.metadata.title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
              await exportToPDF(screenplay.metadata, screenplay.blocks, {
                  filename,
                  titlePage: true,
                  colors: appSettings.colorSettings,
                  includeImagePrompts: options.includeImagePrompts,
                  includeGraybox: options.includeGraybox,
                  grayboxFormat: options.grayboxFormat,
                  includeBlockIds: options.includeBlockIds,
              });
              return;
          }
          // Markdown / JSON share the same option set; grayboxFormat is only
          // meaningful for Markdown (JSON is always lossless raw), but passing
          // it through is harmless.
          const sp: Screenplay = { ...screenplay, metadata: { ...screenplay.metadata } };
          if (format === 'markdown') {
              exportMarkdown(sp, options);
          } else {
              exportJSON(sp, options);
          }
      } catch (error) {
          console.error('Export failed:', error); shipLog("export", "error", "Export failed", error);
          // Surface the error without reloading the page \u2014 autosave may not
          // have captured the very latest edits, and a reload would discard them.
          window.alert(t.pdfExportError);
      }
  }, [screenplay, appSettings.colorSettings, t]);

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

  const executeAI = useCallback(async (modeOverride?: AIMode) => {
    const effectiveMode = modeOverride || aiMode;

    if (appSettings.provider === 'gemini' && !appSettings.geminiApiKey && !process.env.API_KEY) {
        setAIState(prev => ({ ...prev, error: t.aiErrorKeyMissing, grayboxDraft: null, batchProgress: null }));
        return;
    }
    if (appSettings.provider === 'deepseek' && !appSettings.deepseekApiKey) {
        setAIState(prev => ({ ...prev, error: t.aiErrorKeyMissing, grayboxDraft: null, batchProgress: null }));
        return;
    }

    setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });

    const currentTemplateId = screenplay.metadata.templateId || 'standard';
    const activeTemplate = TEMPLATES.find(t => t.id === currentTemplateId) || TEMPLATES[0];
    const systemInstruction = activeTemplate.systemPrompt;
    const scriptLanguage = screenplay.metadata.scriptLanguage || 'en';

    try {
      let result = '';
      if (effectiveMode !== 'VIDEO_PLAN') setVideoPlan(null);
      if (effectiveMode === 'CONTINUE') {
        // Lyrics has no scene concept — skip the transition-decision step and
        // continue directly, preserving the original one-shot behavior.
        if (currentTemplateId === 'lyrics') {
          result = await generateContinuation(screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId);
          setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
        } else {
          // Two-step CONTINUE: first judge whether to stay or transition.
          const decision = await decideSceneTransition(screenplay.blocks, systemInstruction, scriptLanguage, appSettings);
          setTransitionHeadingDraft(decision.sceneHeading || '');
          setAIState({ isLoading: false, suggestion: null, error: null, decision, grayboxDraft: null, batchProgress: null });
          return;
        }
      } else if (effectiveMode === 'IDEAS') {
        const ideas = await suggestIdeas(screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId);
        result = ideas.join('\n\n');
      } else if (effectiveMode === 'REWRITE') {
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (currentBlock) {
          result = await rewriteBlock(currentBlock.content, "dramatic", systemInstruction, scriptLanguage, appSettings, currentTemplateId, screenplay.blocks);
        } else {
            result = t.aiErrorGeneric;
        }
      } else if (effectiveMode === 'STORYBOARD') {
        shipLog('flow', 'info', `STORYBOARD batch start: ${screenplay.blocks.length} blocks`);
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (!currentBlock || (currentBlock.type !== 'ACTION' && currentBlock.type !== 'CHARACTER' && currentBlock.type !== 'SCENE_HEADING')) {
            setAIState({ isLoading: false, suggestion: null, error: t.storyboardWrongBlock, decision: null, grayboxDraft: null, batchProgress: null });
            return;
        }
        // Slice the current scene: from the nearest preceding SCENE_HEADING
        // through the target block (inclusive), so the prompt inherits the
        // scene's environment/time/mood.
        const targetIdx = screenplay.blocks.findIndex(b => b.id === selectedBlockId);
        let sceneStart = 0;
        for (let i = targetIdx; i >= 0; i--) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneStart = i; break; }
        }

        // --- Cascading batch: Alt+S on a SCENE_HEADING ---
        // Generate this scene's ENVIRONMENT image (the heading), then a
        // CHARACTER design sheet for every distinct character acting/speaking,
        // then an ACTION storyboard frame for every action beat — each only
        // when its block lacks an imagePrompt. Mirrors GRAYBOX's Alt+G cascade:
        // every result is written straight back to its block live so progress
        // is durable and the chips light up as each lands. Single-block Alt+S
        // on ACTION/CHARACTER/SCENE_HEADING still works (no cascade).
        if (currentBlock.type === 'SCENE_HEADING') {
          let sceneEnd = screenplay.blocks.length;
          for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneEnd = i; break; }
          }
          const sceneFull = screenplay.blocks.slice(sceneStart, sceneEnd);

          // SCRIPT-WIDE character identity table (① text): every CHARACTER
          // block in the whole screenplay that carries a design sheet. Fed to
          // every prompt so a character defined in an EARLIER scene still
          // resolves here (cross-scene consistency) — the per-scene slice alone
          // would forget it.
          const globalCharDesigns = new Map<string, string>();
          for (const b of screenplay.blocks) {
            if (b.type === 'CHARACTER' && b.imagePrompt?.trim()) {
              const n = baseCharName(b.content.trim());
              if (n && !globalCharDesigns.has(n)) globalCharDesigns.set(n, b.imagePrompt!.trim());
            }
          }

          // Ordered work: env → distinct characters (by BASE name, tracking the
          // costume variant per slot) → actions. Each entry only if the block
          // lacks a prompt already. A `张三（浴袍）` slot is its OWN sheet — env/
          // char/other variants not merged.
          const jobs: { blockId: string; kind: 'environment' | 'character' | 'action'; charName?: string; variant?: string }[] = [];
          const sceneHeadingBlock = screenplay.blocks[sceneStart];
          if (sceneHeadingBlock && !sceneHeadingBlock.imagePrompt?.trim()) {
            jobs.push({ blockId: sceneHeadingBlock.id, kind: 'environment' });
          }
          const seenCharSlots = new Set<string>();
          for (let i = sceneStart + 1; i < sceneEnd; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'CHARACTER') {
              const pc = parseCharacterName(b.content);
              const slotKey = b.content.trim();
              if (!pc.base || seenCharSlots.has(slotKey)) continue;
              seenCharSlots.add(slotKey);
              if (!b.imagePrompt?.trim()) jobs.push({ blockId: b.id, kind: 'character', charName: pc.base, variant: pc.variant });
            }
          }
          for (let i = sceneStart + 1; i < sceneEnd; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'ACTION' && !b.imagePrompt?.trim()) jobs.push({ blockId: b.id, kind: 'action' });
          }

          const total = jobs.length;
          if (total === 0) {
            // Whole scene already storyboarded — say so instead of silently
            // closing (a silent no-op reads as "it's broken").
            setShowAIModal(true);
            setAIState({ isLoading: false, suggestion: null, error: null, info: t.storyboardAllDone, decision: null, grayboxDraft: null, batchProgress: null });
            return;
          }

          let failures = 0;
          let firstError: string | null = null;
          for (let s = 0; s < total; s++) {
            const job = jobs[s];
            const jobBlock = screenplay.blocks.find(b => b.id === job.blockId);
            setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: { current: s + 1, total } });
            try {
              // Full-scene context so each prompt sees all beats; ACTION frames
              // get their own shot graybox as composition lock (option A).
              const shotGraybox = job.kind === 'action' && jobBlock?.graybox?.kind === 'shot' && !jobBlock.graybox.error
                ? jobBlock.graybox : undefined;
              const prompt = await generateImagePrompt(
                sceneFull, job.blockId, systemInstruction, appSettings, job.kind,
                screenplay.metadata.styleHead, shotGraybox,
                globalCharDesigns,
                job.kind === 'character' || job.kind === 'action' ? wardrobeIn(sequenceAt(screenplay.sequences, screenplay.blocks.findIndex(b => b.id === job.blockId)), job.charName ?? '') : undefined,
                job.kind === 'character' || job.kind === 'action' ? job.charName : undefined,
                job.kind === 'character' ? job.variant : undefined,
              );
              // A blank/empty response is a failed job, not a success to persist
              // (it would light an empty chip). Count it and move on.
              if (!prompt || !prompt.trim()) {
                failures++;
                if (!firstError) firstError = t.aiErrorGeneric;
                console.warn(`Storyboard for block ${job.blockId} returned empty`); shipLog("storyboard", "warn", "Storyboard returned empty");
                continue;
              }
              // Write live. CHARACTER prompts propagate to the same BASE+variant
              // slot only — so the bathrobe sheet doesn't overwrite the base
              // 张三 sheet.
              setScreenplay(prev => ({
                ...prev,
                blocks: prev.blocks.map(b => {
                  if (b.id === job.blockId) return { ...b, imagePrompt: prompt };
                  if (job.kind === 'character' && job.charName && b.type === 'CHARACTER' &&
                      baseCharName(b.content.trim()) === job.charName && parseCharacterName(b.content.trim()).variant === job.variant) {
                    return { ...b, imagePrompt: prompt };
                  }
                  return b;
                }),
                lastModified: Date.now(),
              }));
            } catch (err: any) {
              failures++;
              if (!firstError) firstError = err?.message || t.aiErrorGeneric;
              console.warn(`Storyboard for block ${job.blockId} failed:`, err); shipLog("storyboard", "error", `Storyboard for block ${job.blockId} failed`, err); shipLog("storyboard", "error", `Storyboard for block ${job.blockId} failed`, err);
            }
          }

          // Done. Everything already saved live. If anything failed, keep the
          // modal open with the error (or partial note); else close — the one
          // click is complete and needs no accept.
          if (firstError) {
            setAIState({
              isLoading: false,
              suggestion: null,
              error: failures === total ? (firstError || t.aiErrorGeneric) : t.storyboardBatchPartial.replace('{failed}', String(failures)).replace('{total}', String(total)),
              decision: null, grayboxDraft: null, batchProgress: null,
            });
            return;
          }
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }

        const sceneBlocks = screenplay.blocks.slice(sceneStart, targetIdx + 1);
        // After the SCENE_HEADING batch branch above returned, only ACTION /
        // CHARACTER remain here. kind: character vs action.
        const kind = currentBlock.type === 'CHARACTER' ? 'character' : 'action';
        // Composition lock: if this beat already has a SHOT graybox, feed it so
        // the image prompt reproduces the same camera (graybox is the framing
        // source of truth). Only ACTION beats carry a shot camera.
        const shotGraybox = kind === 'action' && currentBlock.graybox?.kind === 'shot' && !currentBlock.graybox.error
          ? currentBlock.graybox
          : undefined;
        // Global identity table (①) so even the single-block path sees a
        // character defined in an earlier scene.
        const globalCharDesigns = new Map<string, string>();
        for (const b of screenplay.blocks) {
          if (b.type === 'CHARACTER' && b.imagePrompt?.trim()) {
            const n = baseCharName(b.content.trim());
            if (n && !globalCharDesigns.has(n)) globalCharDesigns.set(n, b.imagePrompt!.trim());
          }
        }
        const pc = kind === 'character' ? parseCharacterName(currentBlock.content.trim()) : { base: '' };
        const charName = kind === 'character' ? pc.base : undefined;
        const variant = kind === 'character' ? pc.variant : undefined;
        const wardrobe = (kind === 'character' || kind === 'action') && charName
          ? wardrobeIn(sequenceAt(screenplay.sequences, targetIdx), charName)
          : undefined;
        result = await generateImagePrompt(sceneBlocks, selectedBlockId, systemInstruction, appSettings, kind, screenplay.metadata.styleHead, shotGraybox, globalCharDesigns, wardrobe, charName, variant);
      } else if (effectiveMode === 'GRAYBOX') {
        shipLog('flow', 'info', `GRAYBOX batch start: ${screenplay.blocks.length} blocks`);
        // Graybox: structured 3D previs JSON (scene layout or shot camera).
        // Mirrors the STORYBOARD scene-slice, but emits a GrayboxData object
        // stored in `grayboxDraft` (never `suggestion`).
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (!currentBlock || (currentBlock.type !== 'SCENE_HEADING' && currentBlock.type !== 'ACTION' && currentBlock.type !== 'DIALOGUE')) {
            setAIState({ isLoading: false, suggestion: null, error: t.grayboxWrongBlock, decision: null, grayboxDraft: null, batchProgress: null });
            return;
        }
        const targetIdx = screenplay.blocks.findIndex(b => b.id === selectedBlockId);
        let sceneStart = 0;
        for (let i = targetIdx; i >= 0; i--) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneStart = i; break; }
        }
        const sceneBlocks = screenplay.blocks.slice(sceneStart, targetIdx + 1);

        // --- Cascading batch: Alt+G on a SCENE_HEADING ---
        // Generate the scene graybox first; then, if the scene heading lacks a
        // graybox or just got one, walk forward through every ACTION/DIALOGUE
        // in this scene (up to the next SCENE_HEADING) and generate a shot
        // graybox for each that doesn't already have one. Each result is
        // written straight back to its block (real-time) so progress is
        // durable even if the run is interrupted. Single-block Alt+G on an
        // ACTION/DIALOGUE still works (no cascade). Directional guidance only:
        // we don't prescribe shot choices here; the prompt carries that.
        if (currentBlock.type === 'SCENE_HEADING') {
          // --- Direction 1: same-heading scene graybox reuse ---
          // A screenplay often repeats a scene heading ("INT. 宫廷寝殿 - 日")
          // across CUT TO beats to denote time jumps within the same room.
          // Regenerating the layout each time yields inconsistent geometry, and
          // shot coords then stop lining up with any single layout. So before
          // generating, look BACKWARD for an earlier SCENE_HEADING with the
          // same content that already has a scene graybox; if found, reuse it
          // verbatim (no AI call). Only the first sighting of a space designs
          // it; every later revisit inherits that layout. The model still has
          // full design freedom the first time — we only enforce consistency,
          // not style.
          let sceneGraybox: GrayboxData;
          if (currentBlock.graybox) {
            sceneGraybox = currentBlock.graybox;
          } else {
            let reuse: GrayboxData | null = null;
            for (let i = 0; i < sceneStart; i++) {
              const b = screenplay.blocks[i];
              if (b.type === 'SCENE_HEADING' && b.content === currentBlock.content && b.graybox && b.graybox.kind === 'scene' && !b.graybox.error) {
                reuse = b.graybox;
                break;
              }
            }
            if (reuse) {
              sceneGraybox = reuse;
            } else {
              // The scene graybox must see the WHOLE scene, not just the
              // heading: character blocking depends on who appears in the
              // beats below. Alt+G on a heading means targetIdx === sceneStart,
              // so `sceneBlocks` would carry the heading alone — no CHARACTER
              // cues, no beats, nothing to block. Slice sceneStart → the next
              // SCENE_HEADING (or EOF) instead.
              let sceneEnd = screenplay.blocks.length;
              for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
                if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneEnd = i; break; }
              }
              const sceneFullBlocks = screenplay.blocks.slice(sceneStart, sceneEnd);
              sceneGraybox = await generateGraybox(sceneFullBlocks, selectedBlockId, systemInstruction, appSettings, 'scene');
            }
            // Persist immediately so a later failure doesn't lose it.
            if (!sceneGraybox.error) {
              setScreenplay(prev => ({
                ...prev,
                blocks: prev.blocks.map(b => b.id === selectedBlockId ? { ...b, graybox: sceneGraybox } : b),
                lastModified: Date.now(),
              }));
            }
          }

          // 2. Collect shot blocks in this scene lacking a graybox.
          //    Read from the latest screenplay (scene graybox may have just
          //    been written) by snapshotting via a functional update check.
          //    We gather indices, not stale block refs.
          const shotIndices: number[] = [];
          for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'SCENE_HEADING') break; // next scene
            if ((b.type === 'ACTION' || b.type === 'DIALOGUE') && !b.graybox) {
              shotIndices.push(i);
            }
          }

          if (sceneGraybox.error && shotIndices.length === 0) {
            // Nothing to cascade and scene graybox failed — surface it.
            setAIState({ isLoading: false, suggestion: null, error: sceneGraybox.error, decision: null, grayboxDraft: sceneGraybox, batchProgress: null });
            return;
          }

          // 3. Run shot generation sequentially, writing each back live.
          //    --- Directions A+B: feed the scene layout + the shots already
          //    generated earlier in THIS scene back into each call, so the
          //    cinematographer (a) places the camera against the real layout
          //    and (b) can see the rhythm built so far and vary it. We collect
          //    priorShots live as each succeeds (including any that pre-existed
          //    on earlier beats in this scene before the cascade started).
          const priorShots: GrayboxData[] = [];
          // Seed with shot grayboxes already present on beats before the first
          // missing one, so the rhythm reflects the whole scene, not just what
          // this run produces.
          for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'SCENE_HEADING') break;
            if ((b.type === 'ACTION' || b.type === 'DIALOGUE') && b.graybox && b.graybox.kind === 'shot' && !b.graybox.error) {
              priorShots.push(b.graybox);
            }
          }
          const sceneLayoutForShots = (!sceneGraybox.error && sceneGraybox.kind === 'scene') ? sceneGraybox : null;

          const total = shotIndices.length;
          let failures = 0;
          let firstError: string | null = null;
          let lastShotGraybox: GrayboxData | null = null;
          for (let s = 0; s < total; s++) {
            const blockIdx = shotIndices[s];
            const block = screenplay.blocks[blockIdx];
            setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: { current: s + 1, total } });
            try {
              // Slice this shot's scene context up to and including its block.
              const shotSceneBlocks = screenplay.blocks.slice(sceneStart, blockIdx + 1);
              const shotGraybox = await generateGraybox(
                shotSceneBlocks, block.id, systemInstruction, appSettings, 'shot',
                { sceneLayout: sceneLayoutForShots, priorShots: [...priorShots] },
              );
              if (shotGraybox.error) {
                failures++;
                if (!firstError) firstError = shotGraybox.error;
                console.warn(`Graybox for block ${block.id} degraded:`, shotGraybox.error); shipLog("graybox", "warn", `Graybox degraded: ${shotGraybox.error}`);
              } else {
                setScreenplay(prev => ({
                  ...prev,
                  blocks: prev.blocks.map(b => b.id === block.id ? { ...b, graybox: shotGraybox } : b),
                  lastModified: Date.now(),
                }));
                priorShots.push(shotGraybox);   // feed the next beat
                lastShotGraybox = shotGraybox;
              }
            } catch (err: any) {
              failures++;
              if (!firstError) firstError = err?.message || t.aiErrorGeneric;
              console.warn(`Graybox for block ${block.id} failed:`, err); shipLog("graybox", "error", `Graybox for block ${block.id} failed`, err);
            }
          }

          // 4. Done. Show the scene graybox (or last shot) as the modal draft,
          //    and report partial failures if any. If everything succeeded
          //    silently, close-style "done" state: we keep the scene draft
          //    visible so the user can review/accept.
          const doneDraft = sceneGraybox.error ? (lastShotGraybox ?? sceneGraybox) : sceneGraybox;
          const doneError = firstError && failures === total
            ? (firstError || t.aiErrorGeneric)
            : (firstError ? t.grayboxBatchPartial.replace('{failed}', String(failures)).replace('{total}', String(total)) : null);
          setAIState({
            isLoading: false,
            suggestion: JSON.stringify(doneDraft, null, 2),
            error: doneError,
            decision: null,
            grayboxDraft: doneDraft,
            batchProgress: null,
          });
          return;
        }

        // --- Single-block shot graybox (ACTION/DIALOGUE) ---
        // Direction A+B also applies here: a standalone Alt+G on one beat should
        // still see the scene it lives in (so the camera lands on real layout
        // coordinates) and any shots already designed for earlier beats in the
        // same scene (so it joins an existing rhythm instead of ignoring it).
        // Look up the scene graybox on the sceneStart heading, and gather prior
        // shot grayboxes on beats between sceneStart+1 and targetIdx.
        const sceneHeadingBlock = screenplay.blocks[sceneStart];
        const sceneLayoutForSingle = sceneHeadingBlock?.graybox && sceneHeadingBlock.graybox.kind === 'scene' && !sceneHeadingBlock.graybox.error
          ? sceneHeadingBlock.graybox : null;
        const priorShotsSingle: GrayboxData[] = [];
        for (let i = sceneStart + 1; i < targetIdx; i++) {
          const b = screenplay.blocks[i];
          if (b.type === 'SCENE_HEADING') break;
          if ((b.type === 'ACTION' || b.type === 'DIALOGUE') && b.graybox && b.graybox.kind === 'shot' && !b.graybox.error) {
            priorShotsSingle.push(b.graybox);
          }
        }
        const kind: 'scene' | 'shot' = 'shot';
        const graybox = await generateGraybox(
          sceneBlocks, selectedBlockId, systemInstruction, appSettings, kind,
          { sceneLayout: sceneLayoutForSingle, priorShots: priorShotsSingle },
        );
        // Surface a degrade error in the error field; otherwise show the JSON
        // in the suggestion box and hold the object for saving.
        if (graybox.error) {
          setAIState({ isLoading: false, suggestion: null, error: graybox.error, decision: null, grayboxDraft: graybox, batchProgress: null });
        } else {
          setAIState({ isLoading: false, suggestion: JSON.stringify(graybox, null, 2), error: null, decision: null, grayboxDraft: graybox, batchProgress: null });
        }
        return;
      } else if (effectiveMode === 'DUB') {
        // Dub sheet: analyze EVERY dialogue line in the script and write each
        // block's dubEmotion back in place. Batch — runs across the whole
        // screenplay, not a selected window.
        const dubMap = await analyzeDubbing(screenplay.blocks, systemInstruction, appSettings);
        const total = screenplay.blocks.filter(b => b.type === 'DIALOGUE').length;
        const applied = Object.keys(dubMap).length;
        if (applied === 0) {
          setAIState({ isLoading: false, suggestion: null, error: t.aiErrorGeneric, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        setScreenplay(prev => ({
          ...prev,
          blocks: prev.blocks.map(b => dubMap[b.id] ? { ...b, dubEmotion: dubMap[b.id] } : b),
          lastModified: Date.now(),
        }));
        result = `Dubbing direction written to ${applied}/${total} dialogue line${total === 1 ? '' : 's'}. (emotion + delivery + intensity per line)`;
      } else if (effectiveMode === 'FROM_PROMPT') {
        shipLog('flow', 'info', `FROM_PROMPT start: promptSource ${promptSource.length} chars`);
        // FROM_PROMPT: transcribe a pasted production prompt into a full
        // screenplay. The result flows through the normal suggestion → accept
        // path; accept creates a NEW script (not an append).
        if (!promptSource.trim()) {
          setAIState({ isLoading: false, suggestion: null, error: t.fromPromptEmpty, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        result = await screenplayFromPrompt(promptSource, activeTemplate.systemPrompt, screenplay.metadata.scriptLanguage, appSettings);
        if (!result || !result.trim()) {
          setAIState({ isLoading: false, suggestion: null, error: t.aiErrorGeneric, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
      } else if (effectiveMode === 'VIDEO_PLAN') {
        // Deterministic planner — no AI call. Reads each beat's timestamp
        // prefix, groups consecutive beats into ≤target generation windows
        // (scene changes force a boundary; beats are atomic, never split).
        shipLog('flow', 'info', `VIDEO_PLAN start: ${screenplay.blocks.length} blocks, mode=${screenplay.productionMode ?? '?'}`);
        const target = videoPlanDuration; // per-segment window (user-selected)
        const plan = planVideoSegments(screenplay.blocks, target);
        shipLog('flow', 'info', `VIDEO_PLAN planned: ${plan.segments.length} segments [${plan.segments.map(s => `${s.beats.length}b/${Math.round(s.duration)}s`).join(', ')}]`);
        // Per-beat breakdown so span/compression questions can be answered
        // from the server log alone (beat ranges are the ground truth).
        for (const seg of plan.segments) {
          shipLog('flow', 'info', `VIDEO_PLAN seg${seg.index + 1} beats: ${seg.beats.map(b => `${b.range}(${Math.round((b.end - b.start) * 10) / 10}s)`).join(' + ')} = span ${Math.round(seg.duration * 10) / 10}s${seg.oversize ? ' [OVERSIZE]' : ''}`);
        }
        if (!plan.segments.length || plan.segments.every(s => s.beats.length === 0)) {
          shipLog('flow', 'warn', 'VIDEO_PLAN early-return: no timeline beats found');
          setAIState({ isLoading: false, suggestion: null, error: t.videoPlanNoTimeline, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        result = formatVideoPlan(plan);
        setVideoPlan(plan);

        // Per-segment graybox generation: after the plan, generate ONE
        // continuous camera per segment (LLM reads all beats + scene blocking).
        // Results land in screenplay.segmentGrayboxes keyed by the segment's
        // first block id — the white-model render / H3 flow reads them.
        // SKIPPED in simple production mode (no spatial blocking needed).
        if (screenplay.productionMode === 'simple') {
          shipLog('flow', 'info', 'VIDEO_PLAN: simple mode — skipping segment graybox batch');
          setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        const segLayout = (() => {
          const h = screenplay.blocks.find(b => b.type === 'SCENE_HEADING');
          return h?.graybox && h.graybox.kind === 'scene' && !h.graybox.error ? h.graybox : null;
        })();
        const segGrayboxes: Record<string, GrayboxData> = {};
        let segFailures = 0;
        let segFirstError: string | null = null;
        for (let si = 0; si < plan.segments.length; si++) {
          const seg = plan.segments[si];
          setAIState({ isLoading: true, suggestion: result || null, error: null, info: null, decision: null, grayboxDraft: null, batchProgress: { current: si + 1, total: plan.segments.length } });
          const segBlocks = screenplay.blocks.filter(b => seg.blockIds.includes(b.id));
          shipLog('flow', 'info', `VIDEO_PLAN segment ${si + 1}/${plan.segments.length}: calling LLM (${seg.beats.length} beats, ${Math.round(seg.duration)}s, layout=${segLayout ? 'yes' : 'none'})`);
          const gb = await generateSegmentGraybox(
            segBlocks, seg.beats, segLayout, seg.sceneHeading,
            Math.round(seg.duration * 10) / 10, appSettings, activeTemplate.systemPrompt,
          );
          shipLog('flow', gb.error ? 'warn' : 'info', `VIDEO_PLAN segment ${si + 1}/${plan.segments.length}: ${gb.error ? `FAILED — ${gb.error}` : 'ok'}`);
          if (!gb.error) {
            segGrayboxes[seg.blockIds[0]] = gb;
            setScreenplay(prev => ({
              ...prev,
              segmentGrayboxes: { ...(prev.segmentGrayboxes ?? {}), [seg.blockIds[0]]: gb },
              lastModified: Date.now(),
            }));
          } else {
            segFailures++;
            if (!segFirstError) segFirstError = gb.error;
            console.warn('Segment graybox failed:', gb.error); shipLog("segment-graybox", "error", `Segment graybox failed: ${gb.error}`);
          }
        }
        shipLog('flow', segFailures ? 'warn' : 'info', `VIDEO_PLAN batch done: ${plan.segments.length - segFailures}/${plan.segments.length} ok`);
        if (segFailures) {
          setAIState({ isLoading: false, suggestion: result || null, error: `${segFailures}/${plan.segments.length} 段灰盒生成失败——${segFirstError ?? '未知原因'}`, decision: null, grayboxDraft: null, batchProgress: null });
        }
      }
      setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    } catch (err: any) {
      shipLog('flow', 'error', `executeAI(${effectiveMode}) threw`, err);
      const msg = err?.message || '';
      // Map known sentinel errors from the service layer to localized messages
      const friendly = msg === 'GEMINI_KEY_MISSING' || msg === 'DEEPSEEK_KEY_MISSING'
        ? t.aiErrorKeyMissing
        : (err?.message || t.aiErrorGeneric);
      setAIState({ isLoading: false, suggestion: null, error: friendly, decision: null, grayboxDraft: null, batchProgress: null });
    }
  }, [aiMode, appSettings, screenplay.blocks, screenplay.metadata.scriptLanguage, screenplay.metadata.templateId, selectedBlockId, t, promptSource, videoPlanDuration]);

  // Re-plan immediately when the window knob changes. The planner is
  // deterministic and AI-free, so replanning is instant — but it MUST run
  // from an effect (post-commit), not from the select's onChange: executeAI
  // closes over the duration state, and calling it inside the same handler
  // that sets the state captured the PREVIOUS value (the 'lags one beat' bug).
  const executeAIRef = useRef(executeAI);
  executeAIRef.current = executeAI;
  useEffect(() => {
    if (aiMode !== 'VIDEO_PLAN' || !aiState.suggestion) return;
    executeAIRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPlanDuration]);

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

  const handleAIAction = async () => {
    if (isReadOnly) return;
    setShowAIModal(true);
    setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
  };

  /**
   * Second step of the CONTINUE flow: actually generate the continuation,
   * constrained by the user's confirmed transition directive.
   *   - allowTransition=false  → stay in the current scene (no new [SCENE])
   *   - allowTransition=true   → open a new scene with the (edited) heading
   * Called from the decision card's "Continue current scene" / "Accept transition"
   * buttons. Undefined directive (lyrics / fallback) preserves the original one-shot.
   */
  const runContinuation = useCallback(async (directive?: { allowTransition: boolean; targetSceneHeading?: string }) => {
    const currentTemplateId = screenplay.metadata.templateId || 'standard';
    const activeTemplate = TEMPLATES.find(t => t.id === currentTemplateId) || TEMPLATES[0];
    const systemInstruction = activeTemplate.systemPrompt;
    const scriptLanguage = screenplay.metadata.scriptLanguage || 'en';

    setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    try {
      const result = await generateContinuation(
        screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId, directive
      );
      setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    } catch (err: any) {
      const msg = err?.message || '';
      const friendly = msg === 'GEMINI_KEY_MISSING' || msg === 'DEEPSEEK_KEY_MISSING'
        ? t.aiErrorKeyMissing
        : (err?.message || t.aiErrorGeneric);
      setAIState({ isLoading: false, suggestion: null, error: friendly, decision: null, grayboxDraft: null, batchProgress: null });
    }
  }, [screenplay.blocks, screenplay.metadata.scriptLanguage, screenplay.metadata.templateId, appSettings, t]);

  const acceptAISuggestion = useCallback(() => {
      // GRAYBOX saves the structured draft onto the selected block (no body edit).
      // Guarded separately from `suggestion` since GRAYBOX never sets it.
      if (aiMode === 'GRAYBOX') {
          const graybox = aiState.grayboxDraft;
          if (!graybox) return;
          setScreenplay(prev => ({
              ...prev,
              blocks: prev.blocks.map(b => b.id === selectedBlockId ? { ...b, graybox } : b),
              lastModified: Date.now()
          }));
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      if (!aiState.suggestion) return;

      // VIDEO_PLAN + DUB results are INFORMATIONAL — the plan/state was
      // already written elsewhere (window.__stashed plan / dubEmotion fields).
      // Falling through to the block-insertion path below is exactly how a
      // formatted plan once landed in the user's script as junk ACTION rows.
      if (aiMode === 'VIDEO_PLAN' || aiMode === 'DUB') {
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      // IDEAS mode returns creative directions for reference, not script content.
      // Copy to clipboard instead of inserting into the script body.
      if (aiMode === 'IDEAS') {
          void copyToClipboard(aiState.suggestion);
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      // REWRITE replaces the selected block in place.
      if (aiMode === 'REWRITE') {
           const content = aiState.suggestion.replace(/^\[.*?\]\s*/, '');
           handleBlockChange(selectedBlockId, content);
           setShowAIModal(false);
           setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null }); // Clear suggestion to prevent re-insertion
           return;
      }

      // STORYBOARD: save the generated image prompt onto the selected block.
      // Does not touch the script body — the prompt lives in block.imagePrompt.
      // For CHARACTER blocks, the same character (matched by name/content) may
      // appear in multiple blocks: keep ONE prompt per character by writing it
      // to every CHARACTER block with the same name, so re-running on any
      // occurrence updates the single shared design sheet.
      if (aiMode === 'STORYBOARD') {
          const prompt = aiState.suggestion;
          const targetBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
          const isCharacter = targetBlock?.type === 'CHARACTER';
          const charName = isCharacter ? targetBlock!.content.trim() : '';
          setScreenplay(prev => ({
              ...prev,
              blocks: prev.blocks.map(b => {
                  if (b.id === selectedBlockId) return { ...b, imagePrompt: prompt };
                  // Propagate to same-name CHARACTER blocks so there's one prompt per character.
                  if (isCharacter && b.type === 'CHARACTER' && b.content.trim() === charName) {
                      return { ...b, imagePrompt: prompt };
                  }
                  return b;
              }),
              lastModified: Date.now()
          }));
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      // CONTINUE: append generated blocks to the end of the script (not after the
      // currently selected block, which may sit mid-document).
      const lines = aiState.suggestion.split('\n').filter(l => l.trim().length > 0);
      const newBlocks: ScriptBlock[] = lines.map(line => {
          let type: BlockType = 'ACTION';
          let content = line.trim();

          const tagMatch = content.match(/^\[(SCENE|ACTION|CHARACTER|DIALOGUE|PARENTHETICAL|TRANSITION)\]\s?(.*)/i);

          if (tagMatch) {
              const tagName = tagMatch[1].toUpperCase();
              content = tagMatch[2];

              if (tagName === 'SCENE') type = 'SCENE_HEADING';
              else if (tagName === 'ACTION') type = 'ACTION';
              else if (tagName === 'CHARACTER') type = 'CHARACTER';
              else if (tagName === 'DIALOGUE') type = 'DIALOGUE';
              else if (tagName === 'PARENTHETICAL') type = 'PARENTHETICAL';
              else if (tagName === 'TRANSITION') type = 'TRANSITION';
          } else {
               if (content.match(/^(INT\.|EXT\.|内\.|外\.)/i)) {
                   type = 'SCENE_HEADING';
               } else if (content === content.toUpperCase() && content.length < 20 && !content.includes('。') && !content.includes('.')) {
                   type = 'CHARACTER';
               }
          }

          return { id: generateId(), type, content };
      });
      // Structural repair for LLM output: drop empties, collapse consecutive
      // duplicates, guarantee a leading SCENE_HEADING. Deterministic — no model
      // behavior trusted here.
      const safeBlocks = sanitizeParsedBlocks(newBlocks);

      // FROM_PROMPT: the transcribed screenplay becomes a NEW script — the
      // pasted production prompt is a whole work, not a continuation of
      // whatever is currently open. Title derives from the first scene heading
      // so the sidebar shows something meaningful.
      if (aiMode === 'FROM_PROMPT') {
          if (!safeBlocks.length) {
              setAIState({ isLoading: false, suggestion: null, error: t.aiErrorGeneric, decision: null, grayboxDraft: null, batchProgress: null });
              return;
          }
          const firstScene = safeBlocks.find(b => b.type === 'SCENE_HEADING')?.content?.trim();
          // Auto-detect production mode: fixed-camera keywords → simple
          const fp = promptSource.toLowerCase();
          const isFixedCam = /固定机位|一镜到底|固定镜头|fixed camera|single take|static shot|desktop|录屏/.test(fp);
          const newScript: Screenplay = {
              id: generateId(),
              metadata: {
                  ...screenplay.metadata,
                  title: firstScene ? firstScene.slice(0, 40) : (screenplay.metadata.title || 'Prompt Script'),
                  draft: 'First Draft',
              },
              blocks: safeBlocks,
              sourcePrompt: promptSource,
              productionMode: isFixedCam ? 'simple' : 'cinematic',
              lastModified: Date.now(),
          };
          setScreenplay(newScript);
          setSelectedBlockId(safeBlocks[0].id);
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      setScreenplay(prev => {
          const updatedBlocks = [...prev.blocks, ...newBlocks];
          return { ...prev, blocks: updatedBlocks };
      });

      // Focus the first newly appended block
      if (newBlocks.length > 0) {
          setSelectedBlockId(newBlocks[0].id);
      }

      setShowAIModal(false);
      setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null }); // Clear suggestion to prevent re-insertion
  }, [aiState.suggestion, aiState.grayboxDraft, aiMode, selectedBlockId, handleBlockChange]);

  // Auto-accept AI suggestions when enabled.
  // Gated on !aiState.decision: the CONTINUE judgment step produces a decision
  // (not a suggestion), so it must NOT trigger auto-insert — only the actual
  // continuation suggestion (decision already consumed) should auto-accept.
  // GRAYBOX also auto-saves its draft when enabled.
  useEffect(() => {
      if (appSettings.autoAcceptAI && !aiState.isLoading && !aiState.decision) {
          if (aiState.suggestion || aiState.grayboxDraft) {
              acceptAISuggestion();
          }
      }
  }, [aiState.suggestion, aiState.grayboxDraft, aiState.isLoading, aiState.decision, appSettings.autoAcceptAI, acceptAISuggestion]);

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
                onSave={handleUpdateSettings}
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