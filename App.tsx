import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Screenplay, ScriptBlock, BlockType, AIState, Language, ScriptMetadata, AppSettings, ScriptTemplate, AIMode, ExportFormat, ExportOptions, GrayboxData, RefImage, RefBindings } from './types';
import { DEFAULT_SCRIPT, TRANSLATIONS, TEMPLATES, DEFAULT_APP_SETTINGS } from './constants';
import { EditorBlock } from './components/EditorBlock';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { SettingsModal } from './components/SettingsModal';
import { generateContinuation, suggestIdeas, rewriteBlock, generateImagePrompt, generateGraybox, decideSceneTransition } from './services/geminiService';
import { Graybox3DView } from './components/Graybox3DView';
import { ExportMenu } from './components/ExportMenu';
import { paginateBlocks } from './utils/pagination';
import { exportToPDF } from './utils/pdfExport';
import { registerStoryflowWebMcpTools, StoryflowWebMcpAccessor } from './services/webmcp';
import { buildSeedancePrompt, buildH3Prompt } from './utils/whiteModelPrompt';
import { checkGrayboxHealth } from './utils/grayboxHealth';
import { listRefImages, addRefImage, removeRefImage as removeStoredRefImage } from './services/refImageStore';
import { exportMarkdown, exportJSON, DEFAULT_EXPORT_OPTIONS } from './utils/exportData';
import { Menu, Moon, Sun, PanelLeft, Bot, Sparkles, X, Cloud, Check, Loader2, Wand2, Languages, LayoutTemplate, Eye, ChevronLeft, Image as ImageIcon, Trash2, Boxes } from 'lucide-react';
import { clsx } from 'clsx';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 11);

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
          console.warn("Failed to load script index", e);
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
        console.warn("Failed to load recent script", e);
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
                    : (parsed.deepseekModel || DEFAULT_APP_SETTINGS.deepseekModel)
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
  const [aiState, setAIState] = useState<AIState>({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
  const [showAIModal, setShowAIModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [aiMode, setAIMode] = useState<AIMode>('CONTINUE');
  const [isReadOnly, setIsReadOnly] = useState(false);
  // Editable draft of the AI-suggested transition scene heading, so the user
  // can tweak it before accepting a transition in the CONTINUE two-step flow.
  const [transitionHeadingDraft, setTransitionHeadingDraft] = useState('');
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
  const [refBindings, setRefBindings] = useState<RefBindings>({ characters: {} });
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
  webmcpAccessorRef.current = {
    getAppInfo: () => ({
      app: 'StoryFlow' as const,
      uiLanguage: lang,
      scriptLanguage: screenplay.metadata.scriptLanguage,
      provider: appSettings.provider,
      currentScriptId: screenplay.id,
      currentScriptTitle: screenplay.metadata.title,
      blockCount: screenplay.blocks.length,
      savedScriptCount: savedScripts.length,
    }),
    listScripts: () => savedScripts.map(s => ({ id: s.id, title: s.title, lastModified: s.lastModified })),
    getBlocks: ({ from, to, types }) => {
      const total = screenplay.blocks.length;
      const start = Math.max(0, from ?? 0);
      const end = Math.min(total - 1, to ?? Math.min(start + 199, total - 1));
      const slice = screenplay.blocks.slice(start, end + 1)
        .filter(b => !types || types.length === 0 || types.includes(b.type))
        .map((b, i) => ({
          index: start + i,
          id: b.id,
          type: b.type,
          content: b.content,
          hasGraybox: !!b.graybox,
          grayboxKind: b.graybox?.kind,
          hasImagePrompt: !!b.imagePrompt?.trim(),
        }));
      return { total, returned: slice.length, blocks: slice };
    },
    getGraybox: ({ blockIndex, blockId }) => {
      const idx = blockIndex != null
        ? blockIndex
        : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (!b.graybox) return { error: `Block ${idx} (${b.type}) has no graybox payload.` };
      return { blockIndex: idx, blockType: b.type, content: b.content, graybox: b.graybox };
    },
    appendBlocks: (blocks) => {
      const firstIndex = screenplay.blocks.length;
      setScreenplay(prev => ({
        ...prev,
        blocks: [...prev.blocks, ...blocks.map(nb => ({
          id: generateId(),
          type: nb.type,
          content: nb.content,
        }))],
        lastModified: Date.now(),
      }));
      return { added: blocks.length, firstIndex, total: firstIndex + blocks.length };
    },
    generateVideoPrompt: ({ blockIndex, blockId }, target) => {
      const idx = blockIndex != null
        ? blockIndex
        : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (!b.graybox || b.graybox.kind !== 'shot' || !b.graybox.camera) {
        return { error: `Block ${idx} is not a shot with a camera graybox. Only ACTION/DIALOGUE blocks with a shot graybox have video prompts.` };
      }
      // owning scene: nearest SCENE_HEADING at/above the block
      let sceneG: GrayboxData | null = null;
      let sceneHead = '';
      for (let i = idx; i >= 0; i--) {
        const sb = screenplay.blocks[i];
        if (sb.type === 'SCENE_HEADING') {
          sceneHead = sb.content;
          if (sb.graybox && sb.graybox.kind === 'scene' && !sb.graybox.error) sceneG = sb.graybox;
          break;
        }
      }
      const input = {
        beatContent: b.content,
        camera: b.graybox.camera,
        characters: sceneG?.characters ?? [],
        sceneHeading: sceneHead,
      };
      return { target, prompt: target === 'h3' ? buildH3Prompt(input) : buildSeedancePrompt(input) };
    },
    checkGrayboxHealth: ({ blockIndex, blockId }) => {
      const idx = blockIndex != null
        ? blockIndex
        : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (!b.graybox || b.graybox.kind !== 'shot' || !b.graybox.camera) {
        return { error: `Block ${idx} is not a shot with a camera graybox.` };
      }
      // owning scene: blocking + every shot's shotType in that scene
      let sceneG: GrayboxData | null = null;
      let sceneStart = 0;
      for (let i = idx; i >= 0; i--) {
        if (screenplay.blocks[i].type === 'SCENE_HEADING') {
          sceneStart = i;
          const sb = screenplay.blocks[i];
          if (sb.graybox && sb.graybox.kind === 'scene' && !sb.graybox.error) sceneG = sb.graybox;
          break;
        }
      }
      const sceneShotTypes: string[] = [];
      for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
        const sb = screenplay.blocks[i];
        if (sb.type === 'SCENE_HEADING') break;
        if (sb.graybox?.kind === 'shot' && sb.graybox.camera && !sb.graybox.error) {
          sceneShotTypes.push(sb.graybox.camera.shotType);
        }
      }
      return checkGrayboxHealth(
        { camera: b.graybox.camera, characters: sceneG?.characters ?? [], sceneShotTypes },
        lang,
      );
    },
  };
  useEffect(() => registerStoryflowWebMcpTools(webmcpAccessorRef as { current: StoryflowWebMcpAccessor }), []);

  // ---- white-model reference images + bindings ------------------------------
  // Library: load once from IndexedDB, expose blobs as session object URLs.
  useEffect(() => {
    let urls: string[] = [];
    listRefImages().then((stored) => {
      setRefImages(stored.map((s) => {
        const url = URL.createObjectURL(s.blob);
        urls.push(url);
        return { id: s.id, name: s.name, type: s.type, size: s.size, createdAt: s.createdAt, url };
      }));
    }).catch((e) => console.warn('Failed to load reference library', e));
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  // Bindings: per-screenplay, persisted in localStorage next to the script.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ref_bindings_${screenplay.id}`);
      setRefBindings(raw ? { characters: {}, ...(JSON.parse(raw) as RefBindings) } : { characters: {} });
    } catch { setRefBindings({ characters: {} }); }
  }, [screenplay.id]);
  useEffect(() => {
    try { localStorage.setItem(`ref_bindings_${screenplay.id}`, JSON.stringify(refBindings)); } catch { /* quota — bindings are tiny; ignore */ }
  }, [refBindings, screenplay.id]);

  const handleUploadRefImage = useCallback(async (file: File) => {
    try {
      const stored = await addRefImage(file);
      setRefImages((prev) => [...prev, {
        id: stored.id, name: stored.name, type: stored.type, size: stored.size, createdAt: stored.createdAt,
        url: URL.createObjectURL(stored.blob),
      }]);
    } catch (e) {
      console.warn('Failed to store reference image', e);
    }
  }, []);
  const handleRemoveRefImage = useCallback((id: string) => {
    removeStoredRefImage(id).catch((e) => console.warn('Failed to delete reference image', e));
    setRefImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
    // scrub bindings pointing at the removed image
    setRefBindings((prev) => {
      const characters = Object.fromEntries(Object.entries(prev.characters).filter(([, v]) => v !== id));
      const environment = prev.environment === id ? undefined : prev.environment;
      return { characters, environment };
    });
  }, []);

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
      } catch (e) {
        console.error("Autosave failed", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [screenplay]);

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

  const handleCreateFromTemplate = (templateId: string) => {
    const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
    
    let newScriptLanguage = screenplay.metadata.scriptLanguage;
    if (newScriptLanguage === 'en' && lang === 'zh') {
        newScriptLanguage = 'zh';
    }

    let initialBlocks = template.initialBlocks;
    if ((newScriptLanguage === 'zh' || newScriptLanguage === 'dual') && template.initialBlocksZh) {
        initialBlocks = template.initialBlocksZh;
    }

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
    setSidebarOpen(false); 
    setIsReadOnly(false); 
    setTimeout(() => setSidebarOpen(true), 300);
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
          console.error("Failed to load script", e);
      }
  };

  const handleDeleteScript = (id: string) => {
      if (!window.confirm(t.confirmDelete)) return;

      try {
          // Remove Content
          localStorage.removeItem(STORAGE_KEYS.SCRIPT_PREFIX + id);
          
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
          console.error("Failed to delete script", e);
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
          console.error('Export failed:', error);
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
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (!currentBlock || (currentBlock.type !== 'ACTION' && currentBlock.type !== 'CHARACTER')) {
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
        const sceneBlocks = screenplay.blocks.slice(sceneStart, targetIdx + 1);
        const kind = currentBlock.type === 'CHARACTER' ? 'character' : 'action';
        result = await generateImagePrompt(sceneBlocks, selectedBlockId, systemInstruction, appSettings, kind);
      } else if (effectiveMode === 'GRAYBOX') {
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
                console.warn(`Graybox for block ${block.id} degraded:`, shotGraybox.error);
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
              console.warn(`Graybox for block ${block.id} failed:`, err);
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
      }
      setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    } catch (err: any) {
      const msg = err?.message || '';
      // Map known sentinel errors from the service layer to localized messages
      const friendly = msg === 'GEMINI_KEY_MISSING' || msg === 'DEEPSEEK_KEY_MISSING'
        ? t.aiErrorKeyMissing
        : (err?.message || t.aiErrorGeneric);
      setAIState({ isLoading: false, suggestion: null, error: friendly, decision: null, grayboxDraft: null, batchProgress: null });
    }
  }, [aiMode, appSettings, screenplay.blocks, screenplay.metadata.scriptLanguage, screenplay.metadata.templateId, selectedBlockId, t]);

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
            // Trigger on ACTION (scene illustration) or CHARACTER (design sheet) blocks.
            const currentBlock = screenplay.blocks.find(b => b.id === id);
            if (currentBlock?.type === 'ACTION' || currentBlock?.type === 'CHARACTER') {
                e.preventDefault();
                setAIMode('STORYBOARD');
                setShowAIModal(true);
                executeAI('STORYBOARD');
                return;
            }
        }
        if (checkShortcut(e, appSettings.shortcuts.aiGraybox)) {
            // Trigger on SCENE_HEADING (layout + blocking), ACTION, or DIALOGUE
            // (camera/运镜). CHARACTER is excluded — it owns the image-prompt
            // design sheet, graybox is about space + camera.
            const currentBlock = screenplay.blocks.find(b => b.id === id);
            if (currentBlock?.type === 'SCENE_HEADING' || currentBlock?.type === 'ACTION' || currentBlock?.type === 'DIALOGUE') {
                e.preventDefault();
                setAIMode('GRAYBOX');
                setShowAIModal(true);
                executeAI('GRAYBOX');
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

  }, [screenplay.blocks, handleTypeChange, isReadOnly, appSettings.shortcuts, executeAI]);

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

      // IDEAS mode returns creative directions for reference, not script content.
      // Copy to clipboard instead of inserting into the script body.
      if (aiMode === 'IDEAS') {
          navigator.clipboard?.writeText(aiState.suggestion).catch(() => {});
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
            const hasPrompt = !!panelBlock.imagePrompt?.trim();
            const hasGraybox = !!panelBlock.graybox;
            if (!hasPrompt && !hasGraybox) return null;

            // When both exist, the chip that opened the panel decides the
            // initial view; the segmented control below lets the user switch.
            // graybox3d = the Three.js previs; graybox = the raw JSON view.
            const showingGrayboxJSON = hasGraybox && panelTab === 'graybox';
            const showing3D = hasGraybox && panelTab === 'graybox3d';
            const showingGraybox = showingGrayboxJSON || showing3D;
            const activeGrayboxView: 'graybox3d' | 'graybox' = showing3D ? 'graybox3d' : 'graybox';

            const copyText = showingGraybox
              ? JSON.stringify(panelBlock.graybox, null, 2)
              : (panelBlock.imagePrompt || '');

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
                    // Owning scene context for the 3D view: the nearest
                    // SCENE_HEADING at/above the panel block. Its graybox
                    // supplies the layout + character blocking that shot
                    // views render (the white-model POV export needs real
                    // geometry under the camera, not an empty grid); its text
                    // and the block itself feed the Seedance/H3 prompt builder.
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
                          refImages={refImages}
                          refBindings={refBindings}
                          onRefBindingsChange={setRefBindings}
                          onUploadRefImage={handleUploadRefImage}
                          onRemoveRefImage={handleRemoveRefImage}
                        />
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex-1 overflow-y-auto p-4">
                    <pre className={`text-xs leading-relaxed font-mono whitespace-pre-wrap select-text ${showingGrayboxJSON ? 'text-emerald-900/80 dark:text-emerald-200/70' : 'text-indigo-900/80 dark:text-indigo-200/70'}`}>
                      {showingGrayboxJSON ? JSON.stringify(panelBlock.graybox, null, 2) : panelBlock.imagePrompt}
                    </pre>
                  </div>
                )}
                <div className="p-4 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(copyText).catch(() => {});
                    }}
                    className="flex-1 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    {showingGraybox ? t.grayboxCopy : t.aiCopyPrompt}
                  </button>
                  {!isReadOnly && (
                    <button
                      onClick={() => {
                        // delete whichever payload is currently active
                        if (showingGraybox) handleDeleteGraybox(panelBlock.id);
                        else handleDeleteImagePrompt(panelBlock.id);
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
              </div>
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
        />

        {/* AI Modal */}
        {showAIModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-zinc-800 transform transition-all scale-100 ring-1 ring-black/5">
                    <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
                            <Sparkles className="w-5 h-5" />
                            <span>{t.aiAssistant}</span>
                        </div>
                        <button onClick={() => setShowAIModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    
                    <div className="p-6 space-y-6">
                        <div className="flex gap-2 p-1 bg-gray-100 dark:bg-zinc-900 rounded-xl">
                            {(['CONTINUE', 'IDEAS', 'REWRITE', 'STORYBOARD', 'GRAYBOX'] as const).map(m => (
                                <button
                                    key={m}
                                    onClick={() => { setAIMode(m); setAIState({isLoading:false, suggestion:null, error:null, decision:null, grayboxDraft:null, batchProgress:null})}}
                                    className={clsx(
                                        "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                                        aiMode === m
                                            ? "bg-white dark:bg-[#27272a] text-indigo-600 dark:text-indigo-400 shadow-sm"
                                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                    )}
                                >
                                    {m === 'CONTINUE' && t.modes.continue}
                                    {m === 'IDEAS' && t.modes.ideas}
                                    {m === 'REWRITE' && t.modes.rewrite}
                                    {m === 'STORYBOARD' && t.modes.storyboard}
                                    {m === 'GRAYBOX' && t.modes.graybox}
                                </button>
                            ))}
                        </div>

                        {aiState.batchProgress && (
                            <div className="text-center py-6 space-y-3">
                                <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mx-auto text-emerald-500 dark:text-emerald-400">
                                    <Boxes className="w-8 h-8 animate-pulse" />
                                </div>
                                <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                                    {t.grayboxBatchProgress
                                        .replace('{current}', String(aiState.batchProgress.current))
                                        .replace('{total}', String(aiState.batchProgress.total))}
                                </p>
                                <div className="w-full h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden mx-auto max-w-[80%]">
                                    <div
                                        className="h-full bg-emerald-500 transition-all duration-300"
                                        style={{ width: `${(aiState.batchProgress.current / Math.max(aiState.batchProgress.total, 1)) * 100}%` }}
                                    />
                                </div>
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 px-4">
                                    {t.graybox3dHint}
                                </p>
                            </div>
                        )}

                        {!aiState.suggestion && !aiState.decision && !aiState.grayboxDraft && !aiState.batchProgress && (
                             <div className="text-center py-6">
                                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-500 dark:text-indigo-400">
                                    <Bot className="w-8 h-8" />
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 px-4">
                                    {aiMode === 'CONTINUE' && t.prompts.continue}
                                    {aiMode === 'IDEAS' && t.prompts.ideas}
                                    {aiMode === 'REWRITE' && t.prompts.rewrite}
                                    {aiMode === 'STORYBOARD' && t.prompts.storyboard}
                                    {aiMode === 'GRAYBOX' && t.prompts.graybox}
                                </p>
                                {aiMode === 'GRAYBOX' && (
                                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-6 px-4 leading-relaxed">
                                        {t.grayboxBatchSceneHint}
                                    </p>
                                )}
                                <button
                                    onClick={() => executeAI()}
                                    disabled={aiState.isLoading}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-xl active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Wand2 className="w-4 h-4" />}
                                    {aiState.isLoading
                                      ? (aiMode === 'CONTINUE' ? t.transitionAssessing : t.aiGenerating)
                                      : (aiMode === 'CONTINUE' ? t.transitionContinueScene : t.aiGenerate)}
                                </button>
                             </div>
                        )}

                        {/* CONTINUE two-step: transition decision card (shown after
                            the judgment step, before the continuation is written). */}
                        {aiMode === 'CONTINUE' && aiState.decision && !aiState.suggestion && (
                            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{t.transitionSuggests}</span>
                                        <span className={clsx(
                                            "text-[11px] font-bold px-2 py-0.5 rounded-full",
                                            aiState.decision.action === 'transition'
                                                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                                : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                        )}>
                                            {aiState.decision.action === 'transition' ? t.transitionReasonTransition : t.transitionReasonContinue}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">{aiState.decision.reason}</p>
                                    {aiState.decision.action === 'transition' && (
                                        <div className="mt-3">
                                            <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                                {t.transitionSceneLabel}
                                            </label>
                                            <input
                                                type="text"
                                                value={transitionHeadingDraft}
                                                onChange={e => setTransitionHeadingDraft(e.target.value)}
                                                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm font-mono dark:text-white"
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setAIState({isLoading:false, suggestion:null, error:null, decision:null, grayboxDraft:null, batchProgress:null})}
                                        className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                                    >
                                        {t.aiDiscard}
                                    </button>
                                    {aiState.decision.action === 'transition' && (
                                        <button
                                            onClick={() => runContinuation({ allowTransition: true, targetSceneHeading: transitionHeadingDraft.trim() })}
                                            disabled={aiState.isLoading || !transitionHeadingDraft.trim()}
                                            className="flex-1 py-2.5 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-lg shadow-amber-100 dark:shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                                        >
                                            {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1"/> : null}
                                            {t.transitionAccept}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => runContinuation({ allowTransition: false })}
                                        disabled={aiState.isLoading}
                                        className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1"/> : null}
                                        {t.transitionContinueScene}
                                    </button>
                                </div>
                            </div>
                        )}

                        {aiState.error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-xl border border-red-100 dark:border-red-900/50">
                                {aiState.error}
                            </div>
                        )}

                        {aiState.suggestion && (
                            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                                {aiMode === 'IDEAS' && (
                                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400">{t.aiIdeasHint}</p>
                                )}
                                {aiMode === 'STORYBOARD' && (
                                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400">{t.storyboardHint}</p>
                                )}
                                {aiMode === 'GRAYBOX' && (
                                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{t.grayboxHint}</p>
                                )}
                                <div className="p-4 bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-gray-100 dark:border-zinc-800 text-sm font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-gray-800 dark:text-gray-300 shadow-inner">
                                    {aiState.suggestion}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setAIState({isLoading:false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null})}
                                        className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                                    >
                                        {t.aiDiscard}
                                    </button>
                                    {(aiMode === 'STORYBOARD' || aiMode === 'GRAYBOX') && (
                                        <button
                                            onClick={() => navigator.clipboard?.writeText(aiState.suggestion || '').catch(() => {})}
                                            className="flex-1 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            <Cloud className="w-3.5 h-3.5" />
                                            {aiMode === 'GRAYBOX' ? t.grayboxCopy : t.aiCopyPrompt}
                                        </button>
                                    )}
                                    <button
                                        onClick={acceptAISuggestion}
                                        disabled={aiMode === 'GRAYBOX' && !aiState.grayboxDraft}
                                        className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        {aiMode === 'IDEAS' ? t.aiCopyIdeas : aiMode === 'STORYBOARD' ? t.aiSavePrompt : aiMode === 'GRAYBOX' ? t.grayboxSave : t.aiInsert}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <SettingsModal
                metadata={screenplay.metadata}
                appSettings={appSettings}
                onSave={handleUpdateSettings}
                onClose={() => setShowSettingsModal(false)}
                t={t}
            />
        )}

        {/* Export Menu (format + payload options) */}
        <ExportMenu
            open={showExportMenu}
            onClose={() => setShowExportMenu(false)}
            onExport={handleExport}
            t={t}
        />

        {/* Templates Modal */}
        {showTemplateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-200 dark:border-zinc-800 max-h-[80vh] flex flex-col relative">
              <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-gray-900 dark:text-white font-bold">
                      <LayoutTemplate className="w-5 h-5 text-indigo-600" />
                      <span>{t.selectTemplate}</span>
                  </div>
                  <button onClick={() => setShowTemplateModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                      <X className="w-5 h-5" />
                  </button>
              </div>
              <div className="p-6 overflow-y-auto">
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {TEMPLATES.map(tpl => (
                       <div 
                          key={tpl.id}
                          className="relative flex flex-col items-start p-4 rounded-xl border border-gray-200 dark:border-zinc-800 hover:border-indigo-500 dark:hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 hover:bg-gray-50 dark:hover:bg-zinc-900 transition-all text-left group"
                       >
                          <button 
                            onClick={() => handleCreateFromTemplate(tpl.id)}
                            className="absolute inset-0 w-full h-full z-0 cursor-pointer"
                            aria-label={`Select ${t.templates[tpl.nameKey as keyof typeof t.templates]}`}
                          />
                          
                          <div className="relative z-10 pointer-events-none pr-6">
                            <span className="font-bold text-gray-900 dark:text-white mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors block">
                                {t.templates[tpl.nameKey as keyof typeof t.templates]}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed block">
                                {t.templates[tpl.descKey as keyof typeof t.templates]}
                            </span>
                          </div>

                          <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setViewingTemplate(tpl);
                            }}
                            className="absolute top-2 right-2 z-20 p-2 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                            title={t.viewPrompt}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                       </div>
                    ))}
                 </div>
              </div>
              <div className="p-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end shrink-0">
                  <button onClick={() => setShowTemplateModal(false)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg">
                    {t.cancel}
                  </button>
              </div>

              {/* Nested Prompt Viewer Modal */}
              {viewingTemplate && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/60 dark:bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 rounded-2xl">
                    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700 w-full max-w-lg p-6 relative flex flex-col max-h-full">
                        <div className="flex items-center justify-between mb-4 shrink-0">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-gray-900 dark:text-white">
                                <Bot className="w-5 h-5 text-indigo-500"/>
                                {t.systemPrompt}
                            </h3>
                            <button onClick={() => setViewingTemplate(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="bg-gray-50 dark:bg-black/30 p-4 rounded-lg text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap overflow-y-auto mb-4 border border-gray-200 dark:border-zinc-800 flex-1">
                            {viewingTemplate.systemPrompt}
                        </div>
                        <div className="flex justify-end shrink-0">
                            <button
                                onClick={() => setViewingTemplate(null)}
                                className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
                            >
                                {t.close}
                            </button>
                        </div>
                    </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;