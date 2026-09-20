import React, { useState } from 'react';
import { ScriptMetadata, ScriptLanguage, AppSettings, LLMProvider, BlockType, ColorSettings, KeyboardShortcuts, GeminiThinkingLevel, GalleryUser } from '../types';
import { TRANSLATIONS, COLOR_PRESETS } from '../constants';
import { X, Settings as SettingsIcon, Database, Cpu, Palette, LayoutGrid, Keyboard, User, Cloud, Loader2, Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { GALLERY_BACKEND } from '../services/gallery';
import { generateImages } from '../services/minimaxService';
import { comfySystemStats } from '../services/comfyService';
import { logAiCall } from '../services/aiLog';

interface SettingsModalProps {
  metadata: ScriptMetadata;
  appSettings: AppSettings;
  onSave: (metadata: ScriptMetadata, appSettings: AppSettings) => void;
  onClose: () => void;
  t: typeof TRANSLATIONS['en'];
  // ---- Gallery account (P1) ----
  galleryUser?: GalleryUser | null;
  syncError?: string | null;
  onSsoLogin?: () => void;
  onSsoLogoutEverywhere?: () => void;
  onGalleryLogout?: () => Promise<void>;
  onSyncAll?: () => Promise<void>;
  /** P5: milli-credit balance for the signed-in 4A identity. */
  creditBalance?: number | null;
}
/** Copy-to-clipboard button for API key fields: keys don't sync across
 *  origins/devices (BYOK), so migrating means re-pasting — this makes that a
 *  one click instead of select-inside-a-password-field. Shows a check for a
 *  moment after copying. */
const CopyKeyButton: React.FC<{ value: string }> = ({ value }) => {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                if (!value) return;
                const ok = await copyToClipboard(value);
                if (ok) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                }
            }}
            disabled={!value}
            title={copied ? 'Copied ✓' : 'Copy'}
            className={`px-2 py-2 rounded-lg border transition-colors ${copied
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                : 'border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed'}`}
        >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
    );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ metadata, appSettings, onSave, onClose, t, galleryUser, syncError, onSsoLogin, onSsoLogoutEverywhere, onGalleryLogout, onSyncAll, creditBalance }) => {

  const [metaDataForm, setMetaDataForm] = useState<ScriptMetadata>(metadata);
  const [appSettingsForm, setAppSettingsForm] = useState<AppSettings>(appSettings);
  const [activeTab, setActiveTab] = useState<'script' | 'ai' | 'appearance' | 'shortcuts' | 'account'>('script');
  const [recordingKey, setRecordingKey] = useState<keyof KeyboardShortcuts | null>(null);

  const [authError, setAuthError] = useState<string | null>(null);
  const [syncAllBusy, setSyncAllBusy] = useState(false);
  // Image-backend test harness state (AI tab → 文生图引擎测试).
  const [testPrompt, setTestPrompt] = useState('');
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testPreview, setTestPreview] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ url: string; ms: number } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [comfyTest, setComfyTest] = useState<{ busy: boolean; ok?: string; error?: string }>({ busy: false });
  /** Fire one generation at the FORM's current backend config (pre-save) —
   *  no reference image = text-to-image; one uploaded = image-to-image. */
  const runImageTest = async () => {
    const prompt = testPrompt.trim();
    if (!prompt) { setTestError('请输入测试提示词。'); return; }
    setTestBusy(true); setTestError(null); setTestResult(null);
    const t0 = performance.now();
    const op = testFile ? 'image-test-ref' : 'image-test';
    const model = appSettingsForm.imageProvider === 'fal'
      ? (appSettingsForm.falModel.trim() || 'openai/gpt-image-2.5/flare')
      : 'image-01';
    try {
      const cfg = appSettingsForm.imageProvider === 'fal'
        ? { provider: 'fal' as const, falKey: appSettingsForm.falKey.trim(), falModel: model, falQuality: appSettingsForm.falQuality, apiKey: appSettingsForm.minimaxApiKey.trim(), baseUrl: appSettingsForm.minimaxBaseUrl }
        : { apiKey: appSettingsForm.minimaxApiKey.trim(), baseUrl: appSettingsForm.minimaxBaseUrl };
      const imgs = await generateImages(cfg, prompt, {
        n: 1, aspectRatio: '16:9',
        ...(testFile ? { references: { landscape: testFile }, subjectReference: testFile } : {}),
      });
      setTestResult({ url: URL.createObjectURL(imgs[0].blob), ms: Math.round(performance.now() - t0) });
      logAiCall({ ts: Date.now(), durationMs: Math.round(performance.now() - t0), op, provider: appSettingsForm.imageProvider, model, outcome: 'ok', promptChars: prompt.length });
    } catch (e) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
      setTestError(msg.slice(0, 300));
      logAiCall({ ts: Date.now(), durationMs: Math.round(performance.now() - t0), op, provider: appSettingsForm.imageProvider, model, outcome: 'error', errorType: 'error', error: msg.slice(0, 200), promptChars: prompt.length });
    } finally {
      setTestBusy(false);
    }
  };


  const handleSignOut = async () => {
    setAuthError(null);
    try {
      await onGalleryLogout?.();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSyncAll = async () => {
    if (syncAllBusy) return;
    setSyncAllBusy(true);
    setAuthError(null);
    try {
      await onSyncAll?.();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncAllBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(metaDataForm, appSettingsForm);
  };

  const handleColorChange = (type: BlockType, color: string) => {
      setAppSettingsForm(prev => ({
          ...prev,
          colorSettings: {
              ...prev.colorSettings,
              [type]: color
          }
      }));
  };

  const applyPreset = (preset: ColorSettings) => {
      setAppSettingsForm(prev => ({
          ...prev,
          colorSettings: { ...preset }
      }));
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent, key: keyof KeyboardShortcuts) => {
      e.preventDefault();
      
      const modifiers = [];
      if (e.metaKey) modifiers.push('Meta');
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');
      
      let mainKey = e.key;
      // Handle special cases
      if (mainKey === ' ') mainKey = 'Space';
      if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(mainKey)) return; // Don't record just modifier

      const shortcut = [...modifiers, mainKey].join('+');
      
      setAppSettingsForm(prev => ({
          ...prev,
          shortcuts: {
              ...prev.shortcuts,
              [key]: shortcut
          }
      }));
      setRecordingKey(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-gray-900 dark:text-white font-bold">
                <SettingsIcon className="w-5 h-5 text-indigo-600" />
                <span>{t.settingsTitle}</span>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                <X className="w-5 h-5" />
            </button>
        </div>
        
        <div className="flex border-b border-gray-100 dark:border-zinc-800 shrink-0 overflow-x-auto no-scrollbar">
           <button 
             onClick={() => setActiveTab('script')}
             className={`flex-1 min-w-[80px] py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'script' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
           >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.scriptMeta}</span>
           </button>
           <button 
             onClick={() => setActiveTab('ai')}
             className={`flex-1 min-w-[80px] py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'ai' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
           >
              <Cpu className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.aiConfig}</span>
           </button>
           <button 
             onClick={() => setActiveTab('appearance')}
             className={`flex-1 min-w-[80px] py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'appearance' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
           >
              <Palette className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.appearanceConfig}</span>
           </button>
           <button 
             onClick={() => setActiveTab('shortcuts')}
             className={`flex-1 min-w-[80px] py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'shortcuts' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
           >
              <Keyboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.shortcutsConfig}</span>
           </button>
           <button 
             onClick={() => setActiveTab('account')}
             className={`flex-1 min-w-[80px] py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'account' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
           >
              <User className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.galleryAccountTab}</span>
           </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1">
            
            {/* Script Metadata Tab */}
            {activeTab === 'script' && (
              <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        {t.titleLabel}
                    </label>
                    <input 
                        type="text" 
                        value={metaDataForm.title} 
                        onChange={e => setMetaDataForm({...metaDataForm, title: e.target.value})}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                    />
                </div>
                
                <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        {t.authorLabel}
                    </label>
                    <input 
                        type="text" 
                        value={metaDataForm.author} 
                        onChange={e => setMetaDataForm({...metaDataForm, author: e.target.value})}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                    />
                </div>

                <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        {t.languageLabel}
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                        {(['en', 'zh', 'dual'] as ScriptLanguage[]).map((lang) => (
                            <label 
                                key={lang}
                                className={`
                                    flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                                    ${metaDataForm.scriptLanguage === lang 
                                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-500/50' 
                                        : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 hover:border-gray-300 dark:hover:border-zinc-600'}
                                `}
                            >
                                <input 
                                    type="radio" 
                                    name="scriptLanguage"
                                    value={lang}
                                    checked={metaDataForm.scriptLanguage === lang}
                                    onChange={() => setMetaDataForm({...metaDataForm, scriptLanguage: lang})}
                                    className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                                />
                                <span className={`text-sm font-medium ${metaDataForm.scriptLanguage === lang ? 'text-indigo-900 dark:text-indigo-100' : 'text-gray-700 dark:text-gray-300'}`}>
                                    {t.languages[lang]}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {activeTab === 'appearance' && (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                           {t.presets}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                           <button 
                             type="button"
                             onClick={() => applyPreset(COLOR_PRESETS.MODERN_FOCUS)}
                             className="px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors flex items-center justify-center gap-2"
                           >
                              <Palette className="w-3 h-3" />
                              {t.presetFocus}
                           </button>
                           <button 
                             type="button"
                             onClick={() => applyPreset(COLOR_PRESETS.CLASSIC_BW)}
                             className="px-3 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2"
                           >
                              <LayoutGrid className="w-3 h-3" />
                              {t.presetClassic}
                           </button>
                        </div>
                    </div>

                    <div className="border-t border-gray-100 dark:border-zinc-800 pt-4">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                            {t.appearanceColorsDesc}
                        </p>
                        <div className="grid grid-cols-1 gap-3">
                            {(Object.keys(t.blockLabels) as BlockType[]).map((type) => (
                                <div key={type} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        {t.blockLabels[type]}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {appSettingsForm.colorSettings[type] && (
                                            <button 
                                                type="button"
                                                onClick={() => handleColorChange(type, '')}
                                                className="text-[10px] text-red-500 hover:text-red-600 underline"
                                            >
                                                Reset
                                            </button>
                                        )}
                                        <div className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-300 dark:border-zinc-600 shadow-sm">
                                            <input 
                                                type="color" 
                                                value={appSettingsForm.colorSettings[type] || '#000000'} 
                                                onChange={(e) => handleColorChange(type, e.target.value)}
                                                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 m-0 border-none cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* AI Settings Tab */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                 <div>
                    <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg cursor-pointer hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
                        <input
                            type="checkbox"
                            checked={appSettingsForm.autoAcceptAI}
                            onChange={e => setAppSettingsForm({...appSettingsForm, autoAcceptAI: e.target.checked})}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t.aiAutoAccept}
                        </span>
                    </label>
                 </div>

                 <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        {t.aiContextBlocksLabel}
                    </label>
                    <input
                        type="number"
                        min="20"
                        max="300"
                        step="10"
                        value={appSettingsForm.aiContextBlocks}
                        onChange={e => {
                            const val = parseInt(e.target.value) || 50;
                            const clamped = Math.max(20, Math.min(300, val));
                            setAppSettingsForm({...appSettingsForm, aiContextBlocks: clamped});
                        }}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">{t.aiContextBlocksDesc}</p>
                 </div>

                 <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        {t.aiOutputBlocksLabel}
                    </label>
                    <input
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={appSettingsForm.aiOutputBlocks}
                        onChange={e => {
                            const val = parseInt(e.target.value) || 10;
                            const clamped = Math.max(1, Math.min(50, val));
                            setAppSettingsForm({...appSettingsForm, aiOutputBlocks: clamped});
                        }}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">{t.aiOutputBlocksDesc}</p>
                 </div>

                 <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                        {t.providerLabel}
                    </label>
                    <select
                        value={appSettingsForm.provider}
                        onChange={e => setAppSettingsForm({...appSettingsForm, provider: e.target.value as LLMProvider})}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white appearance-none"
                    >
                        <option value="gemini">{t.providers.gemini}</option>
                        <option value="deepseek">{t.providers.deepseek}</option>
                    </select>
                 </div>

                 {appSettingsForm.provider === 'deepseek' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                {t.apiKeyLabel} (DeepSeek)
                            </label>
                            <div className="flex items-center gap-2">
                                <input 
                                type="password" 
                                value={appSettingsForm.deepseekApiKey} 
                                onChange={e => setAppSettingsForm({...appSettingsForm, deepseekApiKey: e.target.value})}
                                placeholder="sk-..."
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            />
                                <CopyKeyButton value={appSettingsForm.deepseekApiKey} />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                {t.modelLabel}
                            </label>
                             <select
                                value={appSettingsForm.deepseekModel}
                                onChange={e => setAppSettingsForm({...appSettingsForm, deepseekModel: e.target.value})}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            >
                                <option value="deepseek-v4-flash">deepseek-v4-flash (Fast)</option>
                                <option value="deepseek-v4-pro">deepseek-v4-pro (Pro)</option>
                                <option value="deepseek-v4-flash-vision-exp">deepseek-v4-flash-vision-exp (Vision)</option>
                            </select>
                        </div>
                    </div>
                 )}

                 {appSettingsForm.provider === 'gemini' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                         <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                {t.apiKeyLabel} (Gemini - Optional)
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                type="password"
                                value={appSettingsForm.geminiApiKey}
                                onChange={e => setAppSettingsForm({...appSettingsForm, geminiApiKey: e.target.value})}
                                placeholder="Overwrite env variable..."
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            />
                                <CopyKeyButton value={appSettingsForm.geminiApiKey} />
                            </div>
                            <p className="mt-1 text-[10px] text-gray-400">Leave empty to use the system default key.</p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                {t.modelLabel}
                            </label>
                             <select
                                value={appSettingsForm.geminiModel}
                                onChange={e => setAppSettingsForm({...appSettingsForm, geminiModel: e.target.value})}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            >
                                <option value="gemini-3.7-flash">gemini-3.7-flash (Latest · Fast)</option>
                                <option value="gemini-3.6-flash">gemini-3.6-flash (Cost-efficient)</option>
                                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Fastest)</option>
                                <option value="gemini-2.5-pro">gemini-2.5-pro (Pro)</option>
                                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                {t.geminiThinkingLabel}
                            </label>
                            <select
                                value={appSettingsForm.geminiThinkingLevel}
                                onChange={e => setAppSettingsForm({...appSettingsForm, geminiThinkingLevel: e.target.value as GeminiThinkingLevel})}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            >
                                <option value="none">{t.geminiThinkingNone}</option>
                                <option value="low">{t.geminiThinkingLow}</option>
                                <option value="medium">{t.geminiThinkingMedium}</option>
                                <option value="high">{t.geminiThinkingHigh}</option>
                            </select>
                            <p className="mt-1 text-[10px] text-gray-400">{t.geminiThinkingDesc}</p>
                        </div>
                    </div>
                 )}

                 {/* Video generation — MiniMax H3 BYOK (white-model submission) */}
                 <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                            {t.videoGenLabel || 'Video Generation · MiniMax H3'}
                        </label>
                        <div className="flex items-center gap-2">
                                <input
                            type="password"
                            value={appSettingsForm.minimaxApiKey}
                            onChange={e => setAppSettingsForm({...appSettingsForm, minimaxApiKey: e.target.value})}
                            placeholder="MiniMax API Key..."
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                        />
                                <CopyKeyButton value={appSettingsForm.minimaxApiKey} />
                            </div>
                        <p className="mt-1 text-[10px] text-gray-400">
                            {t.videoGenHint || 'Used only when submitting white-model generation tasks (billed per second: output + input reference video). Get a key at platform.minimaxi.com → 账户管理 → 接口密钥.'}
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                            {t.videoGenRegionLabel || 'Endpoint'}
                        </label>
                        <select
                            value={appSettingsForm.minimaxBaseUrl}
                            onChange={e => setAppSettingsForm({...appSettingsForm, minimaxBaseUrl: e.target.value})}
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                        >
                            <option value="https://api.minimaxi.com">api.minimaxi.com（中国区）</option>
                            <option value="https://api.minimax.io">api.minimax.io（International）</option>
                        </select>
                    </div>
                 </div>

                 {/* Image generation backend — MiniMax image-01 OR FAL queue */}
                 <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                            {t.imageGenLabel || 'Image Generation Backend'}
                        </label>
                        <select
                            value={appSettingsForm.imageProvider}
                            onChange={e => setAppSettingsForm({...appSettingsForm, imageProvider: e.target.value as AppSettings['imageProvider']})}
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                        >
                            <option value="minimax">MiniMax image-01（用上方 MiniMax Key）</option>
                            <option value="fal">FAL（gpt-image-2.5 等，独立 Key）</option>
                        </select>
                        <p className="mt-1 text-[10px] text-gray-400">
                            {t.imageGenHint || 'Which backend turns storyboard prompts into images. MiniMax uses your MiniMax key above; FAL needs its own key below.'}
                        </p>
                    </div>
                    {appSettingsForm.imageProvider === 'fal' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                    {t.falKeyLabel || 'FAL API Key'}
                                </label>
                                <div className="flex items-center gap-2">
                                <input
                                    type="password"
                                    value={appSettingsForm.falKey}
                                    onChange={e => setAppSettingsForm({...appSettingsForm, falKey: e.target.value})}
                                    placeholder="Key <your-fal-key>"
                                    className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                                />
                                <CopyKeyButton value={appSettingsForm.falKey} />
                            </div>
                                <p className="mt-1 text-[10px] text-gray-400">
                                    {t.falKeyHint || 'Get a key at fal.ai → Billing → API Keys. Official pricing (openai/gpt-image-2.5): $0.00402/img at 1024×768 low, $0.00441 at 1920×1080 low, $0.03612 at 1024×768 high.'}
                                </p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                    {t.falModelLabel || 'FAL Model'}
                                </label>
                                <input
                                    type="text"
                                    value={appSettingsForm.falModel}
                                    onChange={e => setAppSettingsForm({...appSettingsForm, falModel: e.target.value})}
                                    placeholder="openai/gpt-image-2.5/flare"
                                    className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                                />
                                <p className="mt-1 text-[10px] text-gray-400">
                                    {t.falModelHint || 'Base app path. Auto-switches to its /edit endpoint (reference image) when a bound character sheet is available, else /text-to-image.'}
                                </p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                    {t.falQualityLabel || 'FAL Quality (cost)'}
                                </label>
                                <select
                                    value={appSettingsForm.falQuality}
                                    onChange={e => setAppSettingsForm({...appSettingsForm, falQuality: e.target.value as AppSettings['falQuality']})}
                                    className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                                >
                                    <option value="low">low · economy（1024×768 $0.00402/张）</option>
                                    <option value="high">high · paid（1024×768 $0.03612/张）</option>
                                </select>
                                <p className="mt-1 text-[10px] text-gray-400">
                                    {t.falQualityHint || 'Official FAL rates: low is ~9× cheaper than high; size adds up to ~2.8× (1024×768 → 3840×2160). low is right for storyboard iterations.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Test harness: text-to-image, or image-to-image with an
                        uploaded reference. Uses the FORM values (test before
                        saving); every run logs to the debug pipeline. */}
                    <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-2">
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t.imageTestLabel || '引擎测试（文生图 / 图生图）'}
                        </label>
                        <div className="flex gap-2 items-start">
                            <div className="shrink-0">
                                <input type="file" accept="image/*" className="hidden" id="sf-imgtest-file"
                                    onChange={e => {
                                        const f = e.target.files?.[0] ?? null;
                                        e.target.value = '';
                                        setTestFile(f);
                                        setTestPreview(f ? URL.createObjectURL(f) : null);
                                    }} />
                                <label htmlFor="sf-imgtest-file"
                                    className="flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-700 hover:border-indigo-400 cursor-pointer overflow-hidden"
                                    title={t.imageTestRefHint || '可选：上传参考图 → 图生图；不上传 → 文生图'}>
                                    {testPreview
                                        ? <img src={testPreview} alt="" className="w-full h-full object-cover" />
                                        : <span className="text-[10px] text-gray-400 text-center px-1">{t.imageTestUpload || '上传参考图'}</span>}
                                </label>
                                {testFile && (
                                    <button type="button" onClick={() => { setTestFile(null); setTestPreview(null); }}
                                        className="mt-0.5 w-full text-[9px] text-gray-400 hover:text-red-500">{t.imageTestClear || '移除'}</button>
                                )}
                            </div>
                            <textarea
                                value={testPrompt}
                                onChange={e => setTestPrompt(e.target.value)}
                                rows={3}
                                placeholder={t.imageTestPromptPh || '输入测试提示词，例如：一位年轻女性坐在黑色沙发上，微笑看向镜头'}
                                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white text-xs"
                            />
                        </div>
                        <button
                            onClick={() => { void runImageTest(); }}
                            disabled={testBusy || !testPrompt.trim()}
                            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                        >
                            {testBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {testBusy ? (t.imageTestRunning || '生成中…') : (t.imageTestRun || '测试生成')}
                        </button>
                        {testError && (
                            <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded-lg border border-red-100 dark:border-red-900/50 break-all">
                                {testError}
                            </div>
                        )}
                        {testResult && (
                            <div className="flex gap-2 items-start p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-900/50">
                                <img src={testResult.url} alt="test result" className="w-28 rounded-lg border border-emerald-200 dark:border-emerald-800" />
                                <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                    <div className="text-emerald-600 dark:text-emerald-400 font-semibold">{t.imageTestOk || '✅ 生成成功'}</div>
                                    <div>后端：{appSettingsForm.imageProvider === 'fal' ? 'FAL' : 'MiniMax image-01'}</div>
                                    <div>{testFile ? '图生图（含参考图）' : '文生图'}</div>
                                    <div>耗时 {testResult.ms}ms</div>
                                    <div className="mt-1 text-gray-400">{t.imageTestNote || '以上为表单当前配置（保存前即可测试）'}</div>
                                </div>
                              </div>
                        )}
                    </div>

                    {/* Self-hosted ComfyUI video backend (H3 workflows on the user's GPU box) */}
                    <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-3">
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            视频生成方式
                        </label>
                        <select
                            value={appSettingsForm.videoBackend}
                            onChange={e => setAppSettingsForm({...appSettingsForm, videoBackend: e.target.value as AppSettings['videoBackend']})}
                            className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                        >
                            <option value="api">MiniMax API（按刊例计费）</option>
                            <option value="comfy">自建 ComfyUI · H3 工作流（自己的 GPU，边际成本≈0）</option>
                        </select>
                        {appSettingsForm.videoBackend === 'comfy' && (
                            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">ComfyUI 服务器地址</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={appSettingsForm.comfyServerUrl}
                                            onChange={e => setAppSettingsForm({...appSettingsForm, comfyServerUrl: e.target.value})}
                                            placeholder="https://8188-xxx.pod.compshare.cn"
                                            className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white text-xs"
                                        />
                                        <button
                                            onClick={() => {
                                                if (!appSettingsForm.comfyServerUrl.trim()) { setComfyTest({ busy: false, error: '请先填写服务器地址' }); return; }
                                                setComfyTest({ busy: true });
                                                comfySystemStats({ serverUrl: appSettingsForm.comfyServerUrl })
                                                    .then(s => setComfyTest({ busy: false, ok: `✓ 已连接 · ComfyUI ${s.version} · ${s.device}` }))
                                                    .catch(e => setComfyTest({ busy: false, error: String((e as Error)?.message ?? e).slice(0, 160) }));
                                            }}
                                            className="shrink-0 px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                        >测试连接</button>
                                    </div>
                                    {comfyTest.busy && <p className="mt-1 text-[10px] text-indigo-400">连接中…</p>}
                                    {comfyTest.ok && <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">{comfyTest.ok}</p>}
                                    {comfyTest.error && <p className="mt-1 text-[10px] text-red-500">{comfyTest.error}</p>}
                                </div>
                                <div className="space-y-2">
                                    <p className="text-[10px] text-gray-400 leading-relaxed">
                                        导入三个 H3 工作流（ComfyUI 网页里加载工作流 → <b>Save (API Format)</b> 导出 JSON → 在此导入）。有参考图的段走 R2V（ref2va），无参考图的空镜段走 T2V（fl2va）。工作流的<b>时长即每段成片时长</b>——导出 10s 的工作流配 10s 段。
                                    </p>
                                    {([
                                        ['comfyWorkflowR2V', 'R2V · 参考生视频（ref2va）'],
                                        ['comfyWorkflowT2V', 'T2V · 文生视频（fl2va）'],
                                        ['comfyWorkflowI2V', 'I2V · 图生视频（fl2va）'],
                                    ] as const).map(([key, label]) => (
                                        <div key={key} className="flex items-center gap-2">
                                            <input type="file" accept=".json,application/json" className="hidden" id={`sf-${key}`}
                                                onChange={e => {
                                                    const f = e.target.files?.[0];
                                                    e.target.value = '';
                                                    if (!f) return;
                                                    void f.text().then(txt => setAppSettingsForm((prev: AppSettings) => ({ ...prev, [key]: txt })));
                                                }} />
                                            <label htmlFor={`sf-${key}`}
                                                className="shrink-0 px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-[11px] font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer">
                                                导入
                                            </label>
                                            <span className={'text-[11px] ' + (appSettingsForm[key] ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400')}>
                                                {label} · {appSettingsForm[key] ? `已导入 (${appSettingsForm[key].length} 字符)` : '未导入'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                 </div>
              </div>
            )}

            {/* Shortcuts Tab */}
            {activeTab === 'shortcuts' && (
                <div className="space-y-4">
                     <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-xs text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                        Click on a shortcut field and press the key combination you want to use.
                     </div>
                     <div className="space-y-3">
                        {([
                            { key: 'aiContinue', label: t.modes.continue },
                            { key: 'aiIdeas', label: t.modes.ideas },
                            { key: 'aiRewrite', label: t.modes.rewrite },
                            { key: 'aiStoryboard', label: t.modes.storyboard },
                            { key: 'aiGraybox', label: t.modes.graybox },
                            { key: 'syncCloud', label: t.modes.syncCloud }
                        ] as const).map(({key, label}) => (
                            <div key={key} className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    {label}
                                </label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        value={recordingKey === key ? t.shortcutRecoding : (appSettingsForm.shortcuts?.[key] || '')}
                                        readOnly
                                        onClick={() => setRecordingKey(key)}
                                        onKeyDown={(e) => handleShortcutKeyDown(e, key)}
                                        onBlur={() => setRecordingKey(null)}
                                        className={`w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border rounded-lg focus:outline-none transition-all font-mono text-sm cursor-pointer
                                            ${recordingKey === key 
                                                ? 'border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-600 dark:text-indigo-400' 
                                                : 'border-gray-200 dark:border-zinc-700 dark:text-white hover:border-gray-300 dark:hover:border-zinc-600'}`
                                        }
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                        <Keyboard className="w-4 h-4" />
                                    </div>
                                </div>
                            </div>
                        ))}
                     </div>
                 </div>
             )}

            {/* Gallery Account Tab */}
            {activeTab === 'account' && (
              <div className="space-y-4 max-w-md">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                    <Cloud className="w-4 h-4 text-indigo-600" />
                    {t.galleryTitle}
                </div>
                {GALLERY_BACKEND === 'mock' && (
                    <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                        {t.galleryMockNotice}
                    </div>
                )}

                {galleryUser ? (
                  <div className="space-y-3">
                    <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-sm">
                        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{t.gallerySignedInAs}</div>
                        <div className="font-bold text-gray-800 dark:text-gray-100">{galleryUser.displayName}</div>
                        <div className="text-xs text-gray-500">{galleryUser.email}</div>
                        {typeof creditBalance === 'number' && (
                            <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 font-semibold">
                                ⭐ {t.galleryCredits}: {(creditBalance / 1000).toFixed(0)}
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleSyncAll}
                            disabled={syncAllBusy}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg"
                        >
                            {syncAllBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                            {syncAllBusy ? t.gallerySyncing : t.gallerySyncAll}
                        </button>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="px-3 py-2 text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg"
                        >
                            {t.gallerySignOut}
                        </button>
                        <button
                            type="button"
                            onClick={onSsoLogoutEverywhere}
                            title={t.gallery4aLogoutEverywhereHint}
                            className="px-3 py-2 text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg"
                        >
                            {t.gallery4aLogoutEverywhere}
                        </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t.gallery4aHint}
                    </p>
                    <button
                        type="button"
                        onClick={onSsoLogin}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                    >
                        <User className="w-4 h-4" />
                        {t.gallery4aSignIn}
                    </button>
                  </div>
                )}

                {(authError || syncError) && (
                    <div className="text-[11px] px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 break-all">
                        {authError || syncError}
                    </div>
                )}
              </div>
            )}
            
            <div className="pt-6 flex justify-end gap-2 border-t border-gray-100 dark:border-zinc-800 mt-4 shrink-0">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg">
                    {t.cancel}
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm">
                    {t.save}
                </button>
            </div>
        </form>
      </div>
    </div>
  );
};