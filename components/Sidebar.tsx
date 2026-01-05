import React, { useState } from 'react';
import { ScriptBlock } from '../types';
import { Clapperboard, Plus, Settings, FileText, ChevronRight, FilePlus, List, Trash2, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { TRANSLATIONS } from '../constants';

interface ScriptSummary {
    id: string;
    title: string;
    lastModified: number;
}

interface SidebarProps {
  blocks: ScriptBlock[];
  onScrollToBlock: (id: string) => void;
  metadata: any;
  isOpen: boolean;
  onToggle: () => void;
  onNewScript: () => void;
  onScriptSettings: () => void;
  t: typeof TRANSLATIONS['en'];
  savedScripts: ScriptSummary[];
  onLoadScript: (id: string) => void;
  onDeleteScript: (id: string) => void;
  onRenameScript: (id: string, newTitle: string) => void;
  currentScriptId: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
    blocks, 
    onScrollToBlock, 
    metadata, 
    isOpen, 
    onToggle, 
    onNewScript, 
    onScriptSettings, 
    t,
    savedScripts,
    onLoadScript,
    onDeleteScript,
    onRenameScript,
    currentScriptId
}) => {
  const [activeTab, setActiveTab] = useState<'outline' | 'history'>('outline');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const scenes = blocks.filter(b => b.type === 'SCENE_HEADING');

  if (!isOpen) return null;

  const formatDate = (ts: number) => {
      return new Date(ts).toLocaleDateString() + ' ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const startEditing = (id: string, currentTitle: string) => {
      setEditingId(id);
      setEditTitle(currentTitle);
  };

  const saveEditing = () => {
      if (editingId && editTitle.trim()) {
          onRenameScript(editingId, editTitle.trim());
      }
      setEditingId(null);
  };

  return (
    <div className="w-64 h-full bg-gray-50 dark:bg-[#0c0c0e] border-r border-gray-200 dark:border-zinc-800 flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out">
      <div className="p-4 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
           <Clapperboard className="w-4 h-4" />
        </div>
        <div className="overflow-hidden">
             <h1 className="font-sans font-bold text-sm text-gray-900 dark:text-gray-100 truncate">
               {t.screenplay}
             </h1>
             <div className="text-[10px] text-gray-500 font-mono truncate uppercase tracking-wider">{metadata.title}</div>
        </div>
      </div>

      <div className="flex border-b border-gray-200 dark:border-zinc-800">
          <button 
             onClick={() => setActiveTab('outline')}
             className={clsx(
                 "flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors border-b-2",
                 activeTab === 'outline' 
                    ? "text-indigo-600 dark:text-indigo-400 border-indigo-600" 
                    : "text-gray-500 dark:text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-300"
             )}
          >
              {t.tabOutline}
          </button>
          <button 
             onClick={() => setActiveTab('history')}
             className={clsx(
                 "flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors border-b-2",
                 activeTab === 'history' 
                    ? "text-indigo-600 dark:text-indigo-400 border-indigo-600" 
                    : "text-gray-500 dark:text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-300"
             )}
          >
              {t.tabHistory}
          </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {activeTab === 'outline' && (
            <>
                <div className="px-3 mt-3 mb-2">
                    <button 
                        onClick={onNewScript}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
                    >
                        <FilePlus className="w-3.5 h-3.5" />
                        {t.newScript}
                    </button>
                </div>
                <div className="px-4 py-2 mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{t.scenes}</span>
                    <span className="text-[10px] text-gray-300 dark:text-gray-600 bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">{scenes.length}</span>
                </div>
                
                <div className="space-y-0.5 px-2">
                {scenes.length === 0 && (
                    <div className="px-4 py-4 text-xs text-gray-400 dark:text-gray-600 italic text-center">
                        {t.startWriting}
                    </div>
                )}
                {scenes.map((scene, idx) => (
                    <button
                    key={scene.id}
                    onClick={() => onScrollToBlock(scene.id)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-zinc-900 hover:shadow-sm hover:text-indigo-600 dark:hover:text-indigo-400 transition-all rounded-md font-mono flex items-center group border border-transparent hover:border-gray-100 dark:hover:border-zinc-800"
                    >
                    <span className="w-5 opacity-40 text-[10px]">{idx + 1}</span>
                    <span className="truncate flex-1 font-medium">{scene.content || 'UNTITLED'}</span>
                    </button>
                ))}
                </div>
            </>
        )}

        {activeTab === 'history' && (
            <div className="px-2 py-3 space-y-2">
                {savedScripts.length === 0 && (
                     <div className="px-4 py-8 text-xs text-gray-400 dark:text-gray-600 italic text-center">
                        {t.noScripts}
                    </div>
                )}
                {savedScripts.sort((a,b) => b.lastModified - a.lastModified).map((script) => (
                    <div 
                        key={script.id}
                        className={clsx(
                            "group relative p-3 rounded-xl border transition-all text-left",
                            script.id === currentScriptId
                                ? "bg-white dark:bg-zinc-900 border-indigo-500 ring-1 ring-indigo-500/20"
                                : "bg-gray-50 dark:bg-zinc-900/50 border-gray-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-700"
                        )}
                    >
                        <div className="flex justify-between items-start mb-1 min-h-[20px]">
                             {editingId === script.id ? (
                                <input 
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    onBlur={saveEditing}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveEditing();
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    autoFocus
                                    className="text-xs font-bold text-gray-800 dark:text-gray-200 bg-white dark:bg-black border border-indigo-500 rounded px-1 py-0.5 w-full outline-none"
                                    onClick={(e) => e.stopPropagation()} 
                                />
                             ) : (
                                <div 
                                    className="font-bold text-xs text-gray-800 dark:text-gray-200 truncate pr-6 cursor-text hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        startEditing(script.id, script.title);
                                    }}
                                    title="Double click to rename"
                                >
                                    {script.title || 'Untitled'}
                                </div>
                             )}
                             
                             {script.id !== currentScriptId && editingId !== script.id && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onDeleteScript(script.id); }}
                                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                    title={t.deleteScript}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                             )}
                             {script.id === currentScriptId && editingId !== script.id && (
                                 <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded uppercase absolute top-2 right-2">
                                     {t.current}
                                 </span>
                             )}
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-500 mb-2 font-mono">
                            {formatDate(script.lastModified)}
                        </div>
                        
                        {script.id !== currentScriptId && (
                            <button
                                onClick={() => onLoadScript(script.id)}
                                className="w-full py-1.5 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center justify-center gap-1.5"
                            >
                                <FolderOpen className="w-3 h-3" />
                                {t.open}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-zinc-800 space-y-1 bg-gray-50/50 dark:bg-zinc-900/50">
        <button className="flex items-center gap-2.5 w-full text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-gray-200/50 dark:hover:bg-zinc-800">
          <FileText className="w-4 h-4 opacity-70" />
          <span>{t.exportPdf}</span>
        </button>
        <button 
          onClick={onScriptSettings}
          className="flex items-center gap-2.5 w-full text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-gray-200/50 dark:hover:bg-zinc-800"
        >
          <Settings className="w-4 h-4 opacity-70" />
          <span>{t.scriptSettings}</span>
        </button>
      </div>
    </div>
  );
};