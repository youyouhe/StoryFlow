import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Screenplay, ScriptBlock, BlockType, AIState, Language, ScriptMetadata, AppSettings, ScriptTemplate } from './types';
import { DEFAULT_SCRIPT, TRANSLATIONS, TEMPLATES, DEFAULT_APP_SETTINGS } from './constants';
import { EditorBlock } from './components/EditorBlock';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { SettingsModal } from './components/SettingsModal';
import { generateContinuation, suggestIdeas, rewriteBlock } from './services/geminiService';
import { paginateBlocks } from './utils/pagination';
import { exportToPDF } from './utils/pdfExport';
import { Menu, Moon, Sun, PanelLeft, Bot, Sparkles, X, Cloud, Check, Loader2, Wand2, Languages, LayoutTemplate, Eye } from 'lucide-react';
import { clsx } from 'clsx';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

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
                autoAcceptAI: parsed.autoAcceptAI ?? DEFAULT_APP_SETTINGS.autoAcceptAI
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
  const [aiState, setAIState] = useState<AIState>({ isLoading: false, suggestion: null, error: null });
  const [showAIModal, setShowAIModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [aiMode, setAIMode] = useState<'CONTINUE' | 'IDEAS' | 'REWRITE'>('CONTINUE');
  const [isReadOnly, setIsReadOnly] = useState(false);
  
  // States for title editing
  const [headerTitleEditing, setHeaderTitleEditing] = useState(false);
  const [headerTitleVal, setHeaderTitleVal] = useState('');

  const [viewingTemplate, setViewingTemplate] = useState<ScriptTemplate | null>(null);

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

  const handleExportPDF = useCallback(async () => {
      try {
          const filename = `${screenplay.metadata.title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
          await exportToPDF(screenplay.metadata, screenplay.blocks, {
              filename,
              titlePage: true,
              colors: appSettings.colorSettings
          });
      } catch (error) {
          console.error('PDF export failed:', error);
          // Restore page on error
          window.location.reload();
      }
  }, [screenplay.metadata, screenplay.blocks, appSettings.colorSettings]);

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

  const executeAI = useCallback(async (modeOverride?: 'CONTINUE' | 'IDEAS' | 'REWRITE') => {
    const effectiveMode = modeOverride || aiMode;

    if (appSettings.provider === 'gemini' && !appSettings.geminiApiKey && !process.env.API_KEY) {
        setAIState(prev => ({ ...prev, error: "Gemini API Key is missing. Please configure it in settings." }));
        return;
    }
    if (appSettings.provider === 'deepseek' && !appSettings.deepseekApiKey) {
        setAIState(prev => ({ ...prev, error: "DeepSeek API Key is missing. Please configure it in settings." }));
        return;
    }

    setAIState({ isLoading: true, suggestion: null, error: null });
    
    const currentTemplateId = screenplay.metadata.templateId || 'standard';
    const activeTemplate = TEMPLATES.find(t => t.id === currentTemplateId) || TEMPLATES[0];
    const systemInstruction = activeTemplate.systemPrompt;
    const scriptLanguage = screenplay.metadata.scriptLanguage || 'en';

    try {
      let result = '';
      if (effectiveMode === 'CONTINUE') {
        result = await generateContinuation(screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId);
      } else if (effectiveMode === 'IDEAS') {
        const ideas = await suggestIdeas(screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId);
        result = ideas.join('\n\n');
      } else if (effectiveMode === 'REWRITE') {
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (currentBlock) {
          result = await rewriteBlock(currentBlock.content, "dramatic", systemInstruction, scriptLanguage, appSettings, currentTemplateId, screenplay.blocks);
        } else {
            result = "Please select a block to rewrite.";
        }
      }
      setAIState({ isLoading: false, suggestion: result, error: null });
    } catch (err: any) {
      setAIState({ isLoading: false, suggestion: null, error: err.message || "Failed to generate content. Please try again." });
    }
  }, [aiMode, appSettings, screenplay.blocks, screenplay.metadata.scriptLanguage, screenplay.metadata.templateId, selectedBlockId]);

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

  const handleAIAction = async () => {
    if (isReadOnly) return;
    setShowAIModal(true);
    setAIState({ isLoading: false, suggestion: null, error: null });
  };

  const acceptAISuggestion = useCallback(() => {
      if (!aiState.suggestion) return;

      if (aiMode === 'REWRITE') {
           const content = aiState.suggestion.replace(/^\[.*?\]\s*/, '');
           handleBlockChange(selectedBlockId, content);
           setShowAIModal(false);
           setAIState({ isLoading: false, suggestion: null, error: null }); // Clear suggestion to prevent re-insertion
           return;
      }

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
          const idx = prev.blocks.findIndex(b => b.id === selectedBlockId);
          const updatedBlocks = [...prev.blocks];
          updatedBlocks.splice(idx + 1, 0, ...newBlocks);
          return { ...prev, blocks: updatedBlocks };
      });

      setShowAIModal(false);
      setAIState({ isLoading: false, suggestion: null, error: null }); // Clear suggestion to prevent re-insertion
  }, [aiState.suggestion, aiMode, selectedBlockId, handleBlockChange]);

  // Auto-accept AI suggestions when enabled
  useEffect(() => {
      if (appSettings.autoAcceptAI && aiState.suggestion && !aiState.isLoading) {
          acceptAISuggestion();
      }
  }, [aiState.suggestion, aiState.isLoading, appSettings.autoAcceptAI, acceptAISuggestion]);

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
            onExportPDF={handleExportPDF}
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
                            />
                        </div>
                    ))}
                 </div>
                 {pageIndex === pages.length - 1 && <div className="h-48" />}
             </div>
          ))}
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
                            {(['CONTINUE', 'IDEAS', 'REWRITE'] as const).map(m => (
                                <button 
                                    key={m}
                                    onClick={() => { setAIMode(m); setAIState({isLoading:false, suggestion:null, error:null})}}
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
                                </button>
                            ))}
                        </div>

                        {!aiState.suggestion && (
                             <div className="text-center py-6">
                                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-500 dark:text-indigo-400">
                                    <Bot className="w-8 h-8" />
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 px-4">
                                    {aiMode === 'CONTINUE' && t.prompts.continue}
                                    {aiMode === 'IDEAS' && t.prompts.ideas}
                                    {aiMode === 'REWRITE' && t.prompts.rewrite}
                                </p>
                                <button 
                                    onClick={() => executeAI()}
                                    disabled={aiState.isLoading}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-xl active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {aiState.isLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Wand2 className="w-4 h-4" />}
                                    {aiState.isLoading ? t.aiGenerating : t.aiGenerate}
                                </button>
                             </div>
                        )}

                        {aiState.error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-xl border border-red-100 dark:border-red-900/50">
                                {aiState.error}
                            </div>
                        )}

                        {aiState.suggestion && (
                            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                                <div className="p-4 bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-gray-100 dark:border-zinc-800 text-sm font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-gray-800 dark:text-gray-300 shadow-inner">
                                    {aiState.suggestion}
                                </div>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setAIState({isLoading:false, suggestion: null, error: null})}
                                        className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                                    >
                                        {t.aiDiscard}
                                    </button>
                                    <button 
                                        onClick={acceptAISuggestion}
                                        className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all"
                                    >
                                        {t.aiInsert}
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