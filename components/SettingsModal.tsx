import React, { useState } from 'react';
import { ScriptMetadata, ScriptLanguage, AppSettings, LLMProvider, BlockType, ColorSettings, KeyboardShortcuts } from '../types';
import { TRANSLATIONS, COLOR_PRESETS } from '../constants';
import { X, Settings as SettingsIcon, Database, Cpu, Palette, LayoutGrid, Keyboard } from 'lucide-react';

interface SettingsModalProps {
  metadata: ScriptMetadata;
  appSettings: AppSettings;
  onSave: (metadata: ScriptMetadata, appSettings: AppSettings) => void;
  onClose: () => void;
  t: typeof TRANSLATIONS['en'];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ metadata, appSettings, onSave, onClose, t }) => {
  const [metaDataForm, setMetaDataForm] = useState<ScriptMetadata>(metadata);
  const [appSettingsForm, setAppSettingsForm] = useState<AppSettings>(appSettings);
  const [activeTab, setActiveTab] = useState<'script' | 'ai' | 'appearance' | 'shortcuts'>('script');
  const [recordingKey, setRecordingKey] = useState<keyof KeyboardShortcuts | null>(null);

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
                            Select custom text colors for your script elements. Clear the color to revert to the theme default.
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
                            <input 
                                type="password" 
                                value={appSettingsForm.deepseekApiKey} 
                                onChange={e => setAppSettingsForm({...appSettingsForm, deepseekApiKey: e.target.value})}
                                placeholder="sk-..."
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            />
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
                                <option value="deepseek-chat">deepseek-chat (V3)</option>
                                <option value="deepseek-reasoner">deepseek-reasoner (R1)</option>
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
                            <input 
                                type="password" 
                                value={appSettingsForm.geminiApiKey} 
                                onChange={e => setAppSettingsForm({...appSettingsForm, geminiApiKey: e.target.value})}
                                placeholder="Overwrite env variable..."
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all dark:text-white"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">Leave empty to use the system default key.</p>
                        </div>
                    </div>
                 )}
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
                            { key: 'aiRewrite', label: t.modes.rewrite }
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