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
import { MINIMAX_VIDEO_MODELS } from '../constants';
import { isDirStoreAvailable } from '../services/assetDirStore';

/**
 * AppModals — the app-level modal stack: style head, AI, gallery, settings,
 * reference-asset library, export menu, template gallery and opening picker.
 *
 * Wave-2 UI split: pure presentation wiring. Every open/close flag stays
 * owned by App (the Sidebar and Toolbar are the openers); each modal receives
 * the handlers it had before, verbatim.
 */
interface AppModalsProps {
  lib: ReturnType<typeof import('../hooks/useScriptLibrary').useScriptLibrary>;
  sync: ReturnType<typeof import('../hooks/useGallerySync').useGallerySync>;
  assets: ReturnType<typeof import('../hooks/useRefAssetLibrary').useRefAssetLibrary>;
  h3: ReturnType<typeof import('../hooks/useH3VideoPlan').useH3VideoPlan>;
  ai: ReturnType<typeof import('../hooks/useAIExecutor').useAIExecutor>;
  tpl: ReturnType<typeof import('../hooks/useTemplateFlow').useTemplateFlow>;
  io: ReturnType<typeof import('../hooks/useImportExport').useImportExport>;
  settings: ReturnType<typeof import('../hooks/useAppSettings').useAppSettings>;
  appSettings: AppSettings;
  t: typeof import('../constants').TRANSLATIONS['en'];
  lang: 'en' | 'zh';
  theme: 'light' | 'dark';
  // Modal open flags — owned by App because the Sidebar/Toolbar are the openers.
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
  aiMode: AIMode;
  setAIMode: React.Dispatch<React.SetStateAction<AIMode>>;
  aiState: AIState;
  setAIState: React.Dispatch<React.SetStateAction<AIState>>;
  transitionHeadingDraft: string;
  setTransitionHeadingDraft: React.Dispatch<React.SetStateAction<string>>;
  promptSource: string;
  setPromptSource: React.Dispatch<React.SetStateAction<string>>;
  onSsoLogin: () => void;
  onSsoLogoutEverywhere: () => void;
  // project-level pipeline mode (lives on Screenplay)
  onProductionModeChange: (mode: 'simple' | 'cinematic') => void;
}

export function AppModals(props: AppModalsProps) {
  const { lib, sync, assets, h3, ai, tpl, io, settings } = props;
  const { appSettings, handleUpdateSettings } = settings;
  const { screenplay, setScreenplay } = lib;
  const { galleryUser, syncError, creditBalance, refreshGalleryView,
          handleGalleryLogout, handleSyncAll,
          syncConsent, enableCloudSync, disableCloudSync,
          pullPolicy, setCloudPullPolicy,
          cloudBusy, exportCloudScripts, deleteCloudData } = sync;
  const { refImages, handleUpdateRefImageMeta, handleRemoveRefImage,
          assetDir, handleOpenAssetDir, handleSwitchAssetDir, reloadAssets } = assets;
  const { executeAI, runContinuation, acceptAISuggestion } = ai;
  const {
    t, lang,
    showStyleHeadModal, setShowStyleHeadModal,
    showAIModal, setShowAIModal,
    showGallery, setShowGallery,
    showSettingsModal, setShowSettingsModal,
    showAssetLibrary, setShowAssetLibrary,
    showExportMenu, setShowExportMenu,
    aiMode, setAIMode, aiState, setAIState,
    transitionHeadingDraft, setTransitionHeadingDraft,
    promptSource, setPromptSource,
    onSsoLogin, onSsoLogoutEverywhere,
    onProductionModeChange,
  } = props;
  const {
    showTemplateModal, setShowTemplateModal,
    openingPicker, setOpeningPicker,
    openingOptions, openingsLoading, openingsError, chosenOpening, setChosenOpening,
    viewingTemplate, setViewingTemplate,
    handleCreateBlankScript, openOpeningPicker, handleCreateFromTemplate,
  } = tpl;
  const { handleImportScript, handleExport, handleExportAssetPack, handleImportAssetPack } = io;
  const {
    planH3Progress, planPreflight, planTasks, planCostTotal,
    videoPlanModel, videoPlanDuration, setVideoPlanDuration,
    planResolution, setPlanResolution, submitPlanToH3,
  } = h3;

  // Keep both knobs legal on model switch: H3-Max has no 4s window, and
  // resolution lists differ per model (H3: 768P/2K, Max: 480P/768P).
  const onVideoPlanModelChange = (id: string) => {
    h3.setVideoPlanModelId(id);
    const m = MINIMAX_VIDEO_MODELS.find(x => x.id === id);
    if (m && h3.videoPlanDuration < m.min) h3.setVideoPlanDuration(m.min);
    if (m && !m.resolutions.some(r => r.id === planResolution)) {
      h3.setPlanResolution(m.resolutions[m.resolutions.length - 1].id);
    }
  };

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
                onLocalChange={refreshGalleryView}
                t={t}
            />
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
            <SettingsModal
                metadata={screenplay.metadata}
                appSettings={appSettings}
                onSave={(newMetadata, newAppSettings) => {
                    handleUpdateSettings(newMetadata, newAppSettings);
                    setShowSettingsModal(false);
                }}
                onClose={() => setShowSettingsModal(false)}
                t={t}
                galleryUser={galleryUser}
                syncError={syncError}
                creditBalance={creditBalance}
                onSsoLogin={onSsoLogin}
                onSsoLogoutEverywhere={onSsoLogoutEverywhere}
                productionMode={screenplay.productionMode ?? 'simple'}
                onProductionModeChange={onProductionModeChange}
                onGalleryLogout={handleGalleryLogout}
                onSyncAll={handleSyncAll}
                syncConsent={syncConsent}
                onEnableCloudSync={enableCloudSync}
                onDisableCloudSync={disableCloudSync}
                pullPolicy={pullPolicy}
                onSetPullPolicy={setCloudPullPolicy}
                cloudBusy={cloudBusy}
                onExportCloudScripts={exportCloudScripts}
                onDeleteCloudData={deleteCloudData}
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
                scripts={lib.savedScripts.map(sc => ({ id: sc.id, title: sc.title }))}
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
    </>
  );
}
