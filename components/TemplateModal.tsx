import React from 'react';
import { Bot, Eye, LayoutTemplate, X } from 'lucide-react';
import { TEMPLATES, TRANSLATIONS } from '../constants';
import { ScriptTemplate } from '../types';

export interface TemplateModalProps {
  t: typeof TRANSLATIONS['en'];
  viewingTemplate: ScriptTemplate | null;
  setViewingTemplate: React.Dispatch<React.SetStateAction<ScriptTemplate | null>>;
  setShowTemplateModal: React.Dispatch<React.SetStateAction<boolean>>;
  openOpeningPicker: (template: ScriptTemplate) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  t,
  viewingTemplate,
  setViewingTemplate,
  setShowTemplateModal,
  openOpeningPicker,
}) => {
  return (
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
                      onClick={() => openOpeningPicker(tpl)}
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
  );
};