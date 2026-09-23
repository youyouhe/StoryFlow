import { useState } from 'react';
import { AIMode, AppSettings, Language, Screenplay, ScriptBlock, ScriptTemplate } from '../types';
import { TEMPLATES } from '../constants';
import { generateOpenings, OpeningCandidate } from '../services/geminiService';

const generateId = () => Math.random().toString(36).substring(2, 11);

/**
 * The TEMPLATE FLOW domain: the template gallery modal, the P5 opening picker
 * (AI-invented cold opens vs template defaults) and the three script-creation
 * entry points (blank skeleton / picked opening / template default).
 *
 * Extracted verbatim from App.tsx (wave 2 of the App split). Sidebar and the
 * style-head modal stay host-side; their setters arrive as parameters.
 */
export function useTemplateFlow({
  screenplay, setScreenplay, setSelectedBlockId,
  lang, t, appSettings,
  setSidebarOpen, setShowStyleHeadModal, setIsReadOnly,
}: {
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  setSelectedBlockId: React.Dispatch<React.SetStateAction<string>>;
  lang: Language;
  t: typeof import('../constants').TRANSLATIONS['en'];
  appSettings: AppSettings;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowStyleHeadModal: React.Dispatch<React.SetStateAction<boolean>>;
  setIsReadOnly: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [openingPicker, setOpeningPicker] = useState<ScriptTemplate | null>(null);
  const [openingOptions, setOpeningOptions] = useState<OpeningCandidate[] | null>(null);
  const [openingsLoading, setOpeningsLoading] = useState(false);
  const [openingsError, setOpeningsError] = useState<string | null>(null);
  const [chosenOpening, setChosenOpening] = useState<number | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<ScriptTemplate | null>(null);

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

  return {
    showTemplateModal, setShowTemplateModal,
    openingPicker, setOpeningPicker,
    openingOptions, openingsLoading, openingsError, chosenOpening, setChosenOpening,
    viewingTemplate, setViewingTemplate,
    handleCreateBlankScript,
    openOpeningPicker,
    handleCreateFromTemplate,
  };
}
