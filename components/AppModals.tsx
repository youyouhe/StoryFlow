import React from 'react';
import { Screenplay, ScriptMetadata, AIState, AIMode, AppSettings, RefBindings, RefImage, H3Task, ScriptTemplate } from '../types';
import { SettingsModal } from './SettingsModal';
import { StyleHeadModal } from './StyleHeadModal';
import { GalleryModal } from './GalleryModal';
import { RefAssetLibraryModal, REF_LIBRARY_LABELS } from './RefAssetLibraryModal';
import { ExportMenu } from './ExportMenu';
import { AIModal } from './AIModal';
import { TemplateModal } from './TemplateModal';
import { OpeningPicker } from './OpeningPicker';
import { RefImage as RefImageType } from '../types';

/**
 * AppModals — the app-level modal stack: style head, AI, gallery, settings,
 * reference-asset library, export menu, template gallery and opening picker.
 *
 * Wave-2 UI split: pure presentation wiring. Every open/close flag stays
 * owned by App (the Sidebar and Toolbar are the openers); each modal receives
 * the handlers it had before, verbatim.
 */
interface AppModalsProps {
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  appSettings: AppSettings;
  t: typeof import('../constants').TRANSLATIONS['en'];
  lang: 'en' | 'zh';
  theme: 'light' | 'dark';
  // flags + openers
  showStyleHeadModal: boolean;
  setShowStyleHeadModal: React.Dispatch<React.SetStateAction<boolean>>;
  showAIModal: boolean;
  setShowAIModal: React.Dispatch<React.SetStateAction<boolean>>;
  showGallery: boolean;
  setShowGallery: React.Dispatch<React.SetStateAction<boolean>>;
  showSettingsModal: boolean;
  setShowSettingsModal: React.Dispatch<React.SetStateAction<boolean>>;
  showAssetLibrary: boolean;
  setShowAssetLibrary: React.Dispatch<React.SetStateAction<boolean>>;
  showExportMenu: boolean;
  setShowExportMenu: React.Dispatch<React.SetStateAction<boolean>>;
  // AI
  aiMode: AIMode;
  setAIMode: React.Dispatch<React.SetStateAction<AIMode>>;
  aiState: AIState;
  setAIState: React.Dispatch<React.SetStateAction<AIState>>;
  transitionHeadingDraft: string;
  setTransitionHeadingDraft: React.Dispatch<React.SetStateAction<string>>;
  promptSource: string;
  setPromptSource: React.Dispatch<React.SetStateAction<string>>;
  executeAI: (modeOverride?: AIMode) => Promise<void>;
  runContinuation: (directive?: { allowTransition: boolean; targetSceneHeading?: string }) => Promise<void>;
  acceptAISuggestion: () => void;
  // H3 plan
  submitPlanToH3: () => Promise<void>;
  planH3Progress: { current: number; total: number } | null;
  planPreflight: ReturnType<typeof import('../hooks/useH3VideoPlan').useH3VideoPlan>['planPreflight'];
  planTasks: H3Task[];
  planCostTotal: number;
  videoPlanModelId: string;
  videoPlanModel: { id: string; min: number; resolutions: { id: string }[] };
  onVideoPlanModelChange: (id: string) => void;
  videoPlanDuration: number;
  setVideoPlanDuration: React.Dispatch<React.SetStateAction<number>>;
  planResolution: '480P' | '768P' | '2K';
  setPlanResolution: React.Dispatch<React.SetStateAction<'480P' | '768P' | '2K'>>;
  // settings modal account tab
  onUpdateSettings: (newMetadata: ScriptMetadata, newAppSettings: AppSettings) => void;
  galleryUser: { id: string; email: string; displayName: string } | null;
  syncError: string | null;
  creditBalance: number | null;
  onSsoLogin: () => void;
  onSsoLogoutEverywhere: () => void;
  onGalleryLogout: () => Promise<void>;
  onSyncAll: () => Promise<void>;
  onRefreshGalleryView: () => void;
  // asset library
  refImages: RefImageType[];
  onUpdateRefImageMeta: (id: string, patch: { name?: string; subject?: string }) => void;
  onRemoveRefImage: (id: string) => void;
  assetDirName?: string;
  dirBackend: 'dir' | 'idb';
  dirAvailable: boolean;
  onOpenDir: () => Promise<void>;
  onSwitchDir: () => Promise<void>;
  onRescan: () => Promise<void>;
  savedScriptOptions: { id: string; title: string }[];
  // export
  onExport: (format: import('../types').ExportFormat, options: import('../types').ExportOptions) => Promise<void>;
  onImportScript: (file: File) => Promise<void>;
  onExportAssetPack: () => Promise<void>;
  onImportAssetPack: (file: File) => Promise<void>;
  // template flow
  showTemplateModal: boolean;
  setShowTemplateModal: React.Dispatch<React.SetStateAction<boolean>>;
  viewingTemplate: ScriptTemplate | null;
  setViewingTemplate: React.Dispatch<React.SetStateAction<ScriptTemplate | null>>;
  openOpeningPicker: (template: ScriptTemplate) => void;
  handleCreateBlankScript: (templateId: string) => void;
  openingPicker: ScriptTemplate | null;
  setOpeningPicker: React.Dispatch<React.SetStateAction<ScriptTemplate | null>>;
  openingOptions: import('../services/geminiService').OpeningCandidate[] | null;
  openingsLoading: boolean;
  openingsError: string | null;
  chosenOpening: number | null;
  setChosenOpening: React.Dispatch<React.SetStateAction<number | null>>;
  handleCreateFromTemplate: (templateId: string, opening?: import('../services/geminiService').OpeningCandidate) => void;
}

export function AppModals(props: AppModalsProps) {
  const {
    screenplay, setScreenplay, appSettings, t, lang, theme,
    showStyleHeadModal, setShowStyleHeadModal,
    showAIModal, setShowAIModal,
    showGallery, setShowGallery,
    showSettingsModal, setShowSettingsModal,
    showAssetLibrary, setShowAssetLibrary,
    showExportMenu, setShowExportMenu,
    aiMode, setAIMode, aiState, setAIState,
    transitionHeadingDraft, setTransitionHeadingDraft,
    promptSource, setPromptSource,
    executeAI, runContinuation, acceptAISuggestion,
    submitPlanToH3, planH3Progress, planPreflight, planTasks, planCostTotal,
    videoPlanModelId, videoPlanModel, onVideoPlanModelChange,
    videoPlanDuration, setVideoPlanDuration,
    planResolution, setPlanResolution,
    galleryUser, syncError, creditBalance,
    onUpdateSettings,
    onSsoLogin, onSsoLogoutEverywhere, onGalleryLogout, onSyncAll, onRefreshGalleryView,
    refImages, onUpdateRefImageMeta, onRemoveRefImage,
    assetDirName, dirBackend, dirAvailable, onOpenDir, onSwitchDir, onRescan, savedScriptOptions,
    onExport, onImportScript, onExportAssetPack, onImportAssetPack,
    showTemplateModal, setShowTemplateModal,
    viewingTemplate, setViewingTemplate,
    openOpeningPicker, handleCreateBlankScript,
    openingPicker, setOpeningPicker,
    openingOptions, openingsLoading, openingsError, chosenOpening, setChosenOpening,
    handleCreateFromTemplate,
  } = props;

  return (
    <>
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
                onVideoPlanModelChange={onVideoPlanModelChange}
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
                onLocalChange={onRefreshGalleryView}
                t={t}
            />
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <SettingsModal
                metadata={screenplay.metadata}
                appSettings={appSettings}
                onSave={(newMetadata, newAppSettings) => {
                    onUpdateSettings(newMetadata, newAppSettings);
                    setShowSettingsModal(false);
                }}
                onClose={() => setShowSettingsModal(false)}
                t={t}
                galleryUser={galleryUser}
                syncError={syncError}
                creditBalance={creditBalance}
                onSsoLogin={onSsoLogin}
                onSsoLogoutEverywhere={onSsoLogoutEverywhere}
                onGalleryLogout={onGalleryLogout}
                onSyncAll={onSyncAll}
            />
        )}

        {/* Reference Asset Library (white-model digital assets) */}
        {showAssetLibrary && (
            <RefAssetLibraryModal
                images={refImages}
                onUpdateMeta={onUpdateRefImageMeta}
                onDelete={onRemoveRefImage}
                onClose={() => setShowAssetLibrary(false)}
                labels={REF_LIBRARY_LABELS[lang]}
                scriptId={screenplay.id}
                scripts={savedScriptOptions}
                backend={dirBackend}
                backendName={assetDirName}
                dirAvailable={dirAvailable}
                onOpenDir={onOpenDir}
                onSwitchDir={onSwitchDir}
                onRescan={onRescan}
            />
        )}

        {/* Export Menu (format + payload options) */}
        <ExportMenu
            open={showExportMenu}
            onClose={() => setShowExportMenu(false)}
            onExport={onExport}
            onImportJson={(f) => { void onImportScript(f); }}
            onExportAssetPack={() => { void onExportAssetPack(); }}
            onImportAssetPack={(f) => { void onImportAssetPack(f); }}
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
    </>
  );
}
