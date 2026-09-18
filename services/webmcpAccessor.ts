import type { Dispatch, SetStateAction } from 'react';
import type {
  Screenplay,
  ScriptBlock,
  BlockType,
  AppSettings,
  Language,
  GrayboxData,
  RefImage,
} from '../types';
import { TEMPLATES } from '../constants';
import type { StoryflowWebMcpAccessor } from './webmcp';
import { generateContinuation, generateImagePrompt, generateGraybox } from './geminiService';
import { generateImages } from './minimaxService';
import { getAiLog } from './aiLog';
import { buildSeedancePrompt, buildH3Prompt } from '../utils/whiteModelPrompt';
import { checkGrayboxHealth } from '../utils/grayboxHealth';
import { resolveActionRef, resolveFrameRefs, resolveCharacterSheet, resolveBeatRefs } from '../utils/refBindings';
import { sequenceAt, wardrobeIn } from '../utils/sequence';
import { parseCharacterName, baseCharName, resolveBeatVariant } from '../utils/beatCast';

/** Summary of one saved script (the App's localStorage index rows). */
interface ScriptSummary {
  id: string;
  title: string;
  lastModified: number;
}

/** App-owned reactive state + callbacks the accessor closes over. Module-level
 *  pure helpers are imported directly instead of passed here. */
export interface WebMcpDeps {
  screenplay: Screenplay;
  setScreenplay: Dispatch<SetStateAction<Screenplay>>;
  savedScripts: ScriptSummary[];
  appSettings: AppSettings;
  lang: Language;
  refImages: RefImage[];
  handleUploadRefImage: (
    file: File,
    subject?: string,
    sourcePrompt?: string,
    source?: 'upload' | 'ai-generate' | 'video-frame',
    identity?: { kind: 'character' | 'environment' | 'prop' | 'action'; charName?: string; variant?: string; sceneKey?: string },
  ) => Promise<string | null>;
  effectiveImageProvider: 'minimax' | 'fal';
  imageReady: boolean;
  setSelectedBlockId: Dispatch<SetStateAction<string>>;
}

/** Nearby-unique block/script ids (mirrors App.tsx's private helper). */
const generateId = () => Math.random().toString(36).substring(2, 11);

/** Preserve the `String(e?.message || e)` behavior without any `any`. */
const errMsg = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message?: unknown }).message ?? e)
    : String(e);

/**
 * Build the WebMCP accessor object literal. MUST be called during render
 * (latest-ref pattern) so tool executions observe current state — assign the
 * result to `webmcpAccessorRef.current`, NOT inside an effect.
 */
export const createWebMcpAccessor = (deps: WebMcpDeps): StoryflowWebMcpAccessor => {
  const {
    screenplay,
    setScreenplay,
    savedScripts,
    appSettings,
    lang,
    refImages,
    handleUploadRefImage,
    effectiveImageProvider,
    imageReady,
    setSelectedBlockId,
  } = deps;

  return {
    getAppInfo: () => ({
      app: 'StoryFlow' as const,
      uiLanguage: lang,
      scriptLanguage: screenplay.metadata.scriptLanguage,
      provider: appSettings.provider,
      currentScriptId: screenplay.id,
      currentScriptTitle: screenplay.metadata.title,
      blockCount: screenplay.blocks.length,
      savedScriptCount: savedScripts.length,
    }),
    listScripts: () => savedScripts.map(s => ({ id: s.id, title: s.title, lastModified: s.lastModified })),
    getBlocks: ({ from, to, types }) => {
      const total = screenplay.blocks.length;
      const start = Math.max(0, from ?? 0);
      const end = Math.min(total - 1, to ?? Math.min(start + 199, total - 1));
      const slice = screenplay.blocks.slice(start, end + 1)
        .filter(b => !types || types.length === 0 || types.includes(b.type))
        .map((b, i) => ({
          index: start + i,
          id: b.id,
          type: b.type,
          content: b.content,
          hasGraybox: !!b.graybox,
          grayboxKind: b.graybox?.kind,
          hasImagePrompt: !!b.imagePrompt?.trim(),
        }));
      return { total, returned: slice.length, blocks: slice };
    },
    getGraybox: ({ blockIndex, blockId }) => {
      const idx = blockIndex != null
        ? blockIndex
        : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (!b.graybox) return { error: `Block ${idx} (${b.type}) has no graybox payload.` };
      return { blockIndex: idx, blockType: b.type, content: b.content, graybox: b.graybox };
    },
    appendBlocks: (blocks) => {
      const firstIndex = screenplay.blocks.length;
      setScreenplay(prev => ({
        ...prev,
        blocks: [...prev.blocks, ...blocks.map(nb => ({
          id: generateId(),
          type: nb.type,
          content: nb.content,
        }))],
        lastModified: Date.now(),
      }));
      return { added: blocks.length, firstIndex, total: firstIndex + blocks.length };
    },
    generateVideoPrompt: ({ blockIndex, blockId }, target) => {
      const idx = blockIndex != null
        ? blockIndex
        : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (!b.graybox || b.graybox.kind !== 'shot' || !b.graybox.camera) {
        return { error: `Block ${idx} is not a shot with a camera graybox. Only ACTION/DIALOGUE blocks with a shot graybox have video prompts.` };
      }
      // owning scene: nearest SCENE_HEADING at/above the block
      let sceneG: GrayboxData | null = null;
      let sceneHead = '';
      for (let i = idx; i >= 0; i--) {
        const sb = screenplay.blocks[i];
        if (sb.type === 'SCENE_HEADING') {
          sceneHead = sb.content;
          if (sb.graybox && sb.graybox.kind === 'scene' && !sb.graybox.error) sceneG = sb.graybox;
          break;
        }
      }
      const input = {
        beatContent: b.content,
        beatType: b.type,
        camera: b.graybox.camera,
        characters: sceneG?.characters ?? [],
        sceneHeading: sceneHead,
      };
      return { target, prompt: target === 'h3' ? buildH3Prompt(input) : buildSeedancePrompt(input) };
    },
    checkGrayboxHealth: ({ blockIndex, blockId }) => {
      const idx = blockIndex != null
        ? blockIndex
        : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (!b.graybox || b.graybox.kind !== 'shot' || !b.graybox.camera) {
        return { error: `Block ${idx} is not a shot with a camera graybox.` };
      }
      // owning scene: blocking + every shot's shotType in that scene
      let sceneG: GrayboxData | null = null;
      let sceneStart = 0;
      for (let i = idx; i >= 0; i--) {
        if (screenplay.blocks[i].type === 'SCENE_HEADING') {
          sceneStart = i;
          const sb = screenplay.blocks[i];
          if (sb.graybox && sb.graybox.kind === 'scene' && !sb.graybox.error) sceneG = sb.graybox;
          break;
        }
      }
      const sceneShotTypes: string[] = [];
      for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
        const sb = screenplay.blocks[i];
        if (sb.type === 'SCENE_HEADING') break;
        if (sb.graybox?.kind === 'shot' && sb.graybox.camera && !sb.graybox.error) {
          sceneShotTypes.push(sb.graybox.camera.shotType);
        }
      }
      return checkGrayboxHealth(
        { camera: b.graybox.camera, characters: sceneG?.characters ?? [], sceneShotTypes },
        lang,
      );
    },
    continueScript: async ({ hint }) => {
      try {
        const activeTemplate = TEMPLATES.find(t => t.id === (screenplay.metadata.templateId ?? TEMPLATES[0].id)) || TEMPLATES[0];
        const raw = await generateContinuation(
          screenplay.blocks,
          activeTemplate.systemPrompt + (hint ? `\nAdditional directive for this continuation: ${hint}` : ''),
          screenplay.metadata.scriptLanguage,
          appSettings,
          screenplay.metadata.templateId,
        );
        // Parse the [TYPE]-prefixed draft into blocks (same classification
        // rules as the in-app suggestion parser, simplified for the tool).
        const blocks: Array<{ type: BlockType; content: string }> = [];
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          const m = t.match(/^\[?([A-Za-z-]+)\]?\s*[:：]?\s*(.*)$/);
          const tag = (m?.[1] ?? '').toUpperCase().replace(/-/g, '_');
          const rest = (m?.[2] ?? t).trim();
          if (tag === 'SCENE' || /^(INT\.|EXT\.|内\.|外\.|内景|外景)/.test(t)) {
            blocks.push({ type: 'SCENE_HEADING', content: rest || t });
          } else if (tag === 'ACTION') {
            blocks.push({ type: 'ACTION', content: rest || t });
          } else if (tag === 'CHARACTER' || (/^[A-Z一-龥 ]{1,20}$/.test(t) && !t.includes('.'))) {
            blocks.push({ type: 'CHARACTER', content: rest || t });
          } else if (tag === 'DIALOGUE') {
            blocks.push({ type: 'DIALOGUE', content: rest || t });
          } else if (tag === 'PARENTHETICAL' || /^\(.*\)$/.test(t)) {
            blocks.push({ type: 'PARENTHETICAL', content: rest || t });
          } else if (tag === 'TRANSITION') {
            blocks.push({ type: 'TRANSITION', content: rest || t });
          } else {
            blocks.push({ type: 'ACTION', content: t });
          }
        }
        return { ok: true, raw, blocks };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },
    importScript: ({ json }) => {
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks) || !parsed.metadata) {
          return { ok: false, error: 'Invalid screenplay JSON: expected { metadata: {...}, blocks: [{ type, content }] }.' };
        }
        const validTypes: BlockType[] = ['SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE', 'PARENTHETICAL', 'TRANSITION'];
        const blocks: ScriptBlock[] = parsed.blocks
          .filter((b: unknown): b is { content?: string; type?: unknown } =>
            !!b && typeof b === 'object' && typeof (b as { content?: unknown }).content === 'string' && validTypes.includes((b as { type?: unknown }).type as BlockType))
          .slice(0, 5000)
          .map((b: { content?: string; type?: unknown }) => ({ id: generateId(), type: b.type as BlockType, content: (b.content ?? '').slice(0, 5000) }));
        if (!blocks.length) return { ok: false, error: 'No valid blocks found (each needs type + content).' };
        const next: Screenplay = {
          id: generateId(),
          metadata: {
            title: String(parsed.metadata.title || 'Imported Screenplay').slice(0, 120),
            author: String(parsed.metadata.author || ''),
            draft: String(parsed.metadata.draft || 'Draft 1'),
            templateId: typeof parsed.metadata.templateId === 'string' ? parsed.metadata.templateId : undefined,
            scriptLanguage: ['en', 'zh', 'dual'].includes(parsed.metadata.scriptLanguage) ? parsed.metadata.scriptLanguage : 'en',
          },
          blocks,
          lastModified: Date.now(),
          // bindings travel with the script (asset ids refer to the shared library)
          referenceBindings: parsed.referenceBindings?.characters
            ? { characters: parsed.referenceBindings.characters, environment: parsed.referenceBindings.environment }
            : undefined,
        };
        setSelectedBlockId(blocks[0].id);
        setScreenplay(next); // autosave persists script + index
        return { ok: true, title: next.metadata.title, blockCount: blocks.length };
      } catch (e) {
        return { ok: false, error: `JSON parse failed: ${errMsg(e)}` };
      }
    },
    exportScript: () => ({ ok: true, json: JSON.stringify(screenplay) }),
    updateBlock: ({ blockIndex, blockId }, patch, expectedContent) => {
      const idx = blockIndex != null ? blockIndex : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { ok: false, error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (b.content !== expectedContent) {
        return { ok: false, error: 'Content drifted — the block changed since you last read it (a human may have edited). Re-read with storyflow_get_blocks, then retry with the fresh content.' };
      }
      setScreenplay(prev => ({
        ...prev,
        blocks: prev.blocks.map(x => x.id === b.id
          ? { ...x, ...(patch.content != null ? { content: patch.content } : {}), ...(patch.type ? { type: patch.type } : {}) }
          : x),
        lastModified: Date.now(),
      }));
      return { ok: true };
    },
    deleteBlock: ({ blockIndex, blockId }, expectedContent) => {
      const idx = blockIndex != null ? blockIndex : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { ok: false, error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (screenplay.blocks.length <= 1) return { ok: false, error: 'Refusing to delete the last remaining block.' };
      if (b.content !== expectedContent) {
        return { ok: false, error: 'Content drifted — the block changed since you last read it. Re-read with storyflow_get_blocks, then retry.' };
      }
      setScreenplay(prev => ({ ...prev, blocks: prev.blocks.filter(x => x.id !== b.id), lastModified: Date.now() }));
      return { ok: true };
    },
    insertBlocks: (atIndex, blocks) => {
      const firstIndex = Math.max(0, Math.min(atIndex, screenplay.blocks.length));
      setScreenplay(prev => ({
        ...prev,
        blocks: [
          ...prev.blocks.slice(0, firstIndex),
          ...blocks.map(nb => ({ id: generateId(), type: nb.type, content: nb.content })),
          ...prev.blocks.slice(firstIndex),
        ],
        lastModified: Date.now(),
      }));
      return { ok: true, firstIndex, total: screenplay.blocks.length + blocks.length };
    },
    generateGraybox: async ({ blockIndex, blockId }) => {
      const idx = blockIndex != null ? blockIndex : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { ok: false, error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (b.type !== 'SCENE_HEADING' && b.type !== 'ACTION' && b.type !== 'DIALOGUE') {
        return { ok: false, error: `Block ${idx} (${b.type}) cannot hold a graybox. Target a SCENE_HEADING, ACTION, or DIALOGUE.` };
      }
      const kind: 'scene' | 'shot' = b.type === 'SCENE_HEADING' ? 'scene' : 'shot';
      let sceneStart = idx;
      for (let i = idx; i >= 0; i--) {
        if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneStart = i; break; }
      }
      const activeTemplate = TEMPLATES.find(t => t.id === (screenplay.metadata.templateId ?? TEMPLATES[0].id)) || TEMPLATES[0];
      try {
        let result: GrayboxData;
        let ctxBlocks: ScriptBlock[];
        let shotContext: { sceneLayout?: GrayboxData | null; priorShots?: GrayboxData[] } | undefined;
        if (kind === 'scene') {
          let sceneEnd = screenplay.blocks.length;
          for (let i = idx + 1; i < screenplay.blocks.length; i++) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneEnd = i; break; }
          }
          ctxBlocks = screenplay.blocks.slice(sceneStart, sceneEnd); // whole scene — characters need the beats
        } else {
          ctxBlocks = screenplay.blocks.slice(sceneStart, idx + 1);
          const sceneHeading = screenplay.blocks[sceneStart];
          const sceneLayout = sceneHeading?.graybox?.kind === 'scene' && !sceneHeading.graybox.error
            ? sceneHeading.graybox : null;
          const priorShots: GrayboxData[] = [];
          for (let i = sceneStart + 1; i < idx; i++) {
            const pb = screenplay.blocks[i];
            if (pb.type === 'SCENE_HEADING') break;
            if (pb.graybox?.kind === 'shot' && !pb.graybox.error) priorShots.push(pb.graybox);
          }
          shotContext = { sceneLayout, priorShots };
        }
        result = await generateGraybox(ctxBlocks, b.id, activeTemplate.systemPrompt, appSettings, kind, shotContext);
        if (result.error) return { ok: false, error: result.error };
        setScreenplay(prev => ({
          ...prev,
          blocks: prev.blocks.map(x => x.id === b.id ? { ...x, graybox: result } : x),
          lastModified: Date.now(),
        }));
        return { ok: true, kind };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },
    generateImagePrompt: async ({ blockIndex, blockId }) => {
      const idx = blockIndex != null ? blockIndex : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { ok: false, error: 'Block not found. Use storyflow_get_blocks to list valid indices/ids.' };
      if (b.type !== 'SCENE_HEADING' && b.type !== 'ACTION' && b.type !== 'CHARACTER') {
        return { ok: false, error: `Block ${idx} (${b.type}) cannot hold an image prompt. Target a SCENE_HEADING, ACTION, or CHARACTER.` };
      }
      const kind = b.type === 'CHARACTER' ? 'character' as const : b.type === 'SCENE_HEADING' ? 'environment' as const : 'action' as const;
      let sceneStart = idx;
      for (let i = idx; i >= 0; i--) {
        if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneStart = i; break; }
      }
      const activeTemplate = TEMPLATES.find(t => t.id === (screenplay.metadata.templateId ?? TEMPLATES[0].id)) || TEMPLATES[0];
      const sceneBlocks = screenplay.blocks.slice(sceneStart, idx + 1);
      try {
        // Composition lock: feed the beat's own SHOT graybox so the image
        // prompt reproduces the same camera indexing. ACTION beats only.
        const shotGraybox = kind === 'action' && b.graybox?.kind === 'shot' && !b.graybox.error ? b.graybox : undefined;
        // Global identity table (①) so even the tool path sees a character
        // defined in an earlier scene.
        const globalCharDesigns = new Map<string, string>();
        for (const sb of screenplay.blocks) {
          if (sb.type === 'CHARACTER' && sb.imagePrompt?.trim()) {
            const n = baseCharName(sb.content.trim());
            if (n && !globalCharDesigns.has(n)) globalCharDesigns.set(n, sb.imagePrompt!.trim());
          }
        }
        const pc = b.type === 'CHARACTER' ? parseCharacterName(b.content.trim()) : { base: '' };
        const charName = b.type === 'CHARACTER' ? pc.base : undefined;
        const variant = b.type === 'CHARACTER' ? pc.variant : undefined;
        const wardrobe = charName ? wardrobeIn(sequenceAt(screenplay.sequences, idx), charName) : undefined;
        const prompt = await generateImagePrompt(sceneBlocks, b.id, activeTemplate.systemPrompt, appSettings, kind, screenplay.metadata.styleHead, shotGraybox, globalCharDesigns, wardrobe, charName, variant);
        // Mirror the in-app save: CHARACTER prompts propagate to same-name blocks.
        const isCharacter = b.type === 'CHARACTER';
        // A variant cue propagates only to same BASE-and-variant blocks, so the
        // bathrobe sheet doesn't overwrite the base 张三 sheet.
        const charNameOut = isCharacter ? pc.base : '';
        const charVariantOut = isCharacter ? pc.variant : undefined;
        setScreenplay(prev => ({
          ...prev,
          blocks: prev.blocks.map(x => {
            if (x.id === b.id) return { ...x, imagePrompt: prompt };
            if (isCharacter && x.type === 'CHARACTER' && baseCharName(x.content.trim()) === charNameOut && parseCharacterName(x.content.trim()).variant === charVariantOut) return { ...x, imagePrompt: prompt };
            return x;
          }),
          lastModified: Date.now(),
        }));
        return { ok: true, kind };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },
    generateImage: async ({ blockIndex, blockId }) => {
      const idx = blockIndex != null ? blockIndex : screenplay.blocks.findIndex(b => b.id === blockId);
      const b = idx != null && idx >= 0 ? screenplay.blocks[idx] : undefined;
      if (!b) return { ok: false, error: 'Block not found.' };
      if (!b.imagePrompt?.trim()) return { ok: false, error: `Block ${idx} has no imagePrompt — run storyflow_generate_image_prompt first.` };
      if (!imageReady) return { ok: false, error: effectiveImageProvider === 'fal' ? '未配置 FAL API Key（Settings → AI）。' : '未配置 MiniMax API Key（Settings → 视频生成）。' };
      try {
        const subject = b.type === 'CHARACTER' ? b.content.trim().slice(0, 40) : '环境';
        let sceneHead = '';
        for (let i = idx; i >= 0; i--) {
          if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneHead = screenplay.blocks[i].content; break; }
        }
        // Age-aware, sequence-aware reference resolution + scene backdrop (③).
        const seq = sequenceAt(screenplay.sequences, idx);
        // Frame refs: CHARACTER → own sheet (no env); ACTION/DIALOGUE → primary
        // cast sheet + env backdrop.
        let frameRefs: { character?: RefImage; environment?: RefImage } = {};
        if (b.type === 'CHARACTER') {
          const pc = parseCharacterName(b.content.trim());
          const age = wardrobeIn(seq, pc.base).age;
          frameRefs = { character: resolveCharacterSheet(pc.base, screenplay.referenceBindings, refImages, sceneHead, age, pc.variant) };
        } else if (b.type === 'ACTION') {
          const sceneNames: string[] = [];
          for (let i = idx; i >= 0; i--) {
            const sb = screenplay.blocks[i];
            if (sb.type === 'SCENE_HEADING') {
              for (const c of sb.graybox?.characters ?? []) sceneNames.push(c.name);
              break;
            }
          }
          const res = resolveActionRef(screenplay.blocks, idx, sceneNames, screenplay.referenceBindings, refImages, sceneHead);
          const age = res.kind === 'ready' || res.kind === 'needs-image' ? wardrobeIn(seq, res.characterName).age : undefined;
          if (res.kind === 'needs-image') {
            return { ok: false, error: `角色「${res.characterName}」还没有设定图——请先生成该角色的 image，再进行本镜的图生图。` };
          }
          if (res.kind === 'ready') {
            frameRefs = resolveFrameRefs('action', res.characterName, sceneHead, screenplay.referenceBindings, refImages, age, res.variant);
          }
        } else if (b.type === 'DIALOGUE') {
          // dialogue: nearest cue name
          let diagName = '';
          for (let i = idx - 1; i >= 0; i--) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') break;
            if (screenplay.blocks[i].type === 'CHARACTER') { diagName = baseCharName(screenplay.blocks[i].content.trim()); break; }
          }
          if (diagName) {
            const age = wardrobeIn(seq, diagName).age;
            const diagVar = resolveBeatVariant(screenplay.blocks, idx, diagName);
            frameRefs = resolveFrameRefs('dialogue', diagName, sceneHead, screenplay.referenceBindings, refImages, age, diagVar);
          }
        }
        let subjectRef: Blob | undefined;
        let lockName: string | undefined;
        if (frameRefs.character) {
          subjectRef = await (await fetch(frameRefs.character.url)).blob().catch(() => undefined);
          lockName = (frameRefs.character.subject ?? '').split('/')[0];
        }
        // ACTION multi-character: every cast sheet conditions the frame.
        let charRefs: Blob[] = [];
        if (b.type === 'ACTION') {
          const beat = resolveBeatRefs(screenplay.blocks, idx, [], screenplay.referenceBindings, refImages, sceneHead, screenplay.sequences);
          for (const m of [beat.primary, ...beat.others]) {
            if (!m) continue;
            try { charRefs.push(await (await fetch(m.image.url)).blob()); } catch { /* skip */ }
          }
        }
        let envRefB: Blob | undefined;
        if (b.type !== 'CHARACTER' && frameRefs.environment) envRefB = await (await fetch(frameRefs.environment.url)).blob().catch(() => undefined);
        const imgs = await generateImages(
          { apiKey: appSettings.minimaxApiKey.trim(), baseUrl: appSettings.minimaxBaseUrl,
            ...(effectiveImageProvider === 'fal' ? { provider: 'fal' as const, falKey: appSettings.falKey, falModel: appSettings.falModel, falQuality: appSettings.falQuality } : {}) },
          b.imagePrompt,
          { n: 1, aspectRatio: '16:9', subjectReference: subjectRef,
            references: {
              ...(charRefs.length ? { characters: charRefs } : {}),
              ...(b.type !== 'CHARACTER' && envRefB ? { landscape: envRefB } : {}),
            } },
        );
        const stamp = Date.now().toString(36);
        const name = b.type === 'CHARACTER'
          ? `${subject}-gen-${stamp}.png`
          : `scene-gen-${stamp}.png`;
        const stored = await handleUploadRefImage(
          new File([imgs[0].blob], name, { type: imgs[0].blob.type || 'image/png' }),
          subject || '环境',
          b.imagePrompt,
          'ai-generate',
          b.type === 'CHARACTER'
            ? { kind: 'character', charName: subject }
            : { kind: 'environment', sceneKey: sceneHead },
        );
        if (!stored) return { ok: false, error: '图片已生成但入库失败（存储后端异常）——详见控制台。' };
        // Persist the prompt→asset link on the block so the main-editor chip
        // thumbnail survives reload + regenerating other blocks.
        deps.setScreenplay(prev => ({
          ...prev,
          blocks: prev.blocks.map(x => x.id === b.id ? { ...x, imageResult: { assetId: stored, subject: subject || '环境' } } : x),
          lastModified: Date.now(),
        }));
        return { ok: true, subject, ...(lockName ? { characterLock: lockName } : {}) };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    },
    getAiLog: (opts) => getAiLog(opts) as unknown as Array<Record<string, unknown>>,
  };
};