import { useCallback } from 'react';
import { AppSettings, Screenplay, ExportFormat, ExportOptions, RefImage } from '../types';
import { DEFAULT_SCRIPT } from '../constants';
import { shipLog } from '../services/debugLog';
import { exportToPDF } from '../utils/pdfExport';
import { exportMarkdown, exportJSON } from '../utils/exportData';

const generateId = () => Math.random().toString(36).substring(2, 11);

/**
 * The IMPORT/EXPORT domain: screenplay JSON import, the unified export
 * dispatcher (PDF / Markdown / JSON) and the portable reference-asset pack
 * (export + re-import through the identity-aware upload).
 *
 * Extracted verbatim from App.tsx (wave 2 of the App split).
 */
export function useImportExport({
  screenplay, setScreenplay, setSelectedBlockId, setIsReadOnly,
  appSettings, t, refImages, handleUploadRefImage,
}: {
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  setSelectedBlockId: React.Dispatch<React.SetStateAction<string>>;
  setIsReadOnly: React.Dispatch<React.SetStateAction<boolean>>;
  appSettings: AppSettings;
  t: typeof import('../constants').TRANSLATIONS['en'];
  refImages: RefImage[];
  handleUploadRefImage: (
    file: File,
    subject?: string,
    sourcePrompt?: string,
    source?: 'upload' | 'ai-generate' | 'video-frame',
    identity?: { kind: 'character' | 'environment' | 'prop' | 'action'; charName?: string; variant?: string; sceneKey?: string },
  ) => Promise<string | null>;
}) {
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




  return { handleImportScript, handleExport, handleExportAssetPack, handleImportAssetPack };
}
