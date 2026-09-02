import React, { useRef, useState } from 'react';
import { GrayboxCharacter, RefBindings, RefImage } from '../types';
import { whiteModelCharColor } from '../utils/whiteModelPrompt';

/**
 * ReferenceBindingPanel — the slim version of the product spec's chapter-4
 * binding UI: capsule (scene character) ↔ reference image, plus one
 * environment/style image slot. Lives inside the white-model prompt modal;
 * the mapping it produces is consumed directly by the Seedance/H3 prompt
 * builders (bound images get real file names and stable upload numbering).
 *
 * Bindings persist per screenplay (App.tsx); images live in the IndexedDB
 * library. The capsule color dot matches the 3D POV render's index-based
 * assignment, so "the blue capsule on screen" is "the blue row here".
 */

interface Labels {
  title: string;
  env: string;
  unbound: string;
  upload: string;
  library: string;
  clear: string;
  emptyLibrary: string;
  removeImage: string;
  smartBind: string;
  manageLibrary: string;
  recommended: string;
  smartBindNone: string;
}

export const REF_BINDING_LABELS: Record<'en' | 'zh', Labels> = {
  en: {
    title: 'Character → reference image',
    env: 'Scene / style image',
    unbound: 'not bound',
    upload: 'Upload',
    library: 'Library',
    clear: 'Clear',
    emptyLibrary: 'Library is empty — upload an image first.',
    removeImage: 'Remove from library',
    smartBind: 'Smart bind',
    manageLibrary: 'Manage library',
    recommended: 'subject match',
    smartBindNone: 'No subject-matched images to auto-bind — tag assets with character names in the library.',
  },
  zh: {
    title: '角色 → 参考图绑定',
    env: '场景 / 风格图',
    unbound: '未绑定',
    upload: '上传图片',
    library: '图库',
    clear: '清除',
    emptyLibrary: '图库为空——请先上传图片。',
    removeImage: '从图库删除',
    smartBind: '智能绑定',
    manageLibrary: '管理图库',
    recommended: 'subject 匹配',
    smartBindNone: '没有可自动绑定的 subject 匹配——请在图库里给资产打上角色名标签。',
  },
};

interface Props {
  characters: GrayboxCharacter[];
  images: RefImage[];
  bindings: RefBindings;
  onChange: (next: RefBindings) => void;
  /** subject = slot identity (character name or '环境') when uploading from a slot. */
  onUpload: (file: File, subject?: string) => void;
  onRemoveImage: (id: string) => void;
  onOpenLibrary?: () => void;
  labels: Labels;
}

/** Which slot the image picker popover is open for: 'env' or a char name. */
type PickerTarget = string | null;

export const ReferenceBindingPanel: React.FC<Props> = ({
  characters, images, bindings, onChange, onUpload, onRemoveImage, onOpenLibrary, labels,
}) => {
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // pending picker intent: 'bind' (choose for slot) vs 'add' (upload then bind)
  const [uploadForSlot, setUploadForSlot] = useState<PickerTarget>(null);

  const imageById = (id?: string) => images.find((img) => img.id === id);

  /** Does this image's subject identify the given slot (character name / 环境)? */
  const subjectMatches = (img: RefImage, target: PickerTarget): boolean => {
    if (!target || !img.subject) return false;
    const s = img.subject.trim();
    if (target === 'env') return s === '环境' || s.includes('环境');
    return s === target || s.includes(`:${target}`) || s.includes(target);
  };

  const bind = (target: PickerTarget, imageId: string) => {
    if (!target) return;
    if (target === 'env') {
      onChange({ ...bindings, environment: imageId });
    } else {
      onChange({ ...bindings, characters: { ...bindings.characters, [target]: imageId } });
    }
    setPickerFor(null);
  };

  const clear = (target: PickerTarget) => {
    if (!target) return;
    if (target === 'env') {
      onChange({ ...bindings, environment: undefined });
    } else {
      const next = { ...bindings.characters };
      delete next[target];
      onChange({ ...bindings, characters: next });
    }
  };

  /** One-click: fill every unbound slot whose name has a subject-matched
   *  image in the library (deterministic — no AI involved). */
  const smartBind = () => {
    const characters2 = { ...bindings.characters };
    let n = 0;
    for (const c of characters.slice(0, 8)) {
      if (characters2[c.name]) continue;
      const match = images.find((img) => subjectMatches(img, c.name));
      if (match) { characters2[c.name] = match.id; n++; }
    }
    let environment = bindings.environment;
    if (!environment) {
      const env = images.find((img) => subjectMatches(img, 'env'));
      if (env) { environment = env.id; n++; }
    }
    if (n > 0) onChange({ characters: characters2, environment });
    else alert(labels.smartBindNone);
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-choosing the same file
    if (file && uploadForSlot !== null) {
      // Upload from a slot auto-tags the asset with the slot identity, so
      // smart binding and future scripts pick it up automatically.
      onUpload(file, uploadForSlot === 'env' ? '环境' : uploadForSlot);
      setUploadForSlot(null);
    }
  };

  const slotRow = (target: string, colorHex: string | null, label: string, boundId?: string) => {
    const img = imageById(boundId);
    const open = pickerFor === target;
    return (
      <div key={target} className="relative">
        <div className="flex items-center gap-2 py-1">
          {colorHex
            ? <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorHex }} />
            : <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-dashed border-gray-400" />}
          <button
            type="button"
            onClick={() => setPickerFor(open ? null : target)}
            title={img ? img.name : labels.unbound}
            className="w-10 h-10 rounded-md overflow-hidden border border-gray-300 dark:border-zinc-600 bg-gray-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 hover:border-emerald-500 transition-colors"
          >
            {img
              ? <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
              : <span className="text-gray-300 dark:text-gray-600 text-lg leading-none">＋</span>}
          </button>
          <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate flex-1">
            {label}
            {img && <span className="text-gray-400 dark:text-gray-500 ml-1 truncate">{img.name}</span>}
          </span>
          {img && (
            <button
              type="button"
              onClick={() => clear(target)}
              className="text-[10px] text-gray-400 hover:text-red-500 px-1 shrink-0"
            >
              {labels.clear}
            </button>
          )}
        </div>
        {open && (
          <div className="absolute left-0 right-0 z-10 mt-1 p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{labels.library}</span>
              <button
                type="button"
                onClick={() => { setUploadForSlot(target); fileInputRef.current?.click(); }}
                className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {labels.upload}
              </button>
            </div>
            {images.length === 0 ? (
              <p className="text-[10px] text-gray-400 py-2 text-center">{labels.emptyLibrary}</p>
            ) : (
              <div className="grid grid-cols-5 gap-1.5 max-h-40 overflow-y-auto">
                {[...images]
                  .sort((a, b) => Number(subjectMatches(b, target)) - Number(subjectMatches(a, target)))
                  .map((im) => (
                  <div key={im.id} className="relative group">
                    {subjectMatches(im, target) && (
                      <span
                        title={labels.recommended}
                        className="absolute -top-1 -left-1 z-10 px-1 rounded bg-emerald-500 text-white text-[8px] leading-tight"
                      >
                        ★
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => bind(target, im.id)}
                      title={`${im.name}${im.subject ? ` · ${im.subject}` : ''}`}
                      className="w-full aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-zinc-700 hover:border-emerald-500 transition-colors"
                    >
                      <img src={im.url} alt={im.name} className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveImage(im.id)}
                      title={labels.removeImage}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] leading-none hidden group-hover:flex items-center justify-center"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-2 mb-2">
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{labels.title}</p>
        <button
          type="button"
          onClick={smartBind}
          className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
        >
          {labels.smartBind}
        </button>
        {onOpenLibrary && (
          <button
            type="button"
            onClick={onOpenLibrary}
            className="px-1.5 py-0.5 rounded text-[9px] font-semibold border border-gray-300 dark:border-zinc-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {labels.manageLibrary}
          </button>
        )}
      </div>
      {characters.slice(0, 8).map((c, i) =>
        slotRow(c.name, whiteModelCharColor(i).hex, `${c.name}`, bindings.characters[c.name]))}
      {slotRow('env', null, labels.env, bindings.environment)}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChosen}
      />
    </div>
  );
};
