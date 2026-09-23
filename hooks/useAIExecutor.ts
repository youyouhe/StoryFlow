import { useEffect, useCallback, useRef } from 'react';
import { AIState, AIMode, AppSettings, BlockType, GrayboxData, Screenplay, ScriptBlock } from '../types';
import { TEMPLATES } from '../constants';
import { generateContinuation, suggestIdeas, rewriteBlock, generateImagePrompt, generateGraybox, generateSegmentGraybox, decideSceneTransition, analyzeDubbing, screenplayFromPrompt } from '../services/geminiService';
import { shipLog } from '../services/debugLog';
import { planVideoSegments, formatVideoPlan } from '../utils/videoPlan';
import { sanitizeParsedBlocks } from '../utils/scriptParse';
import { copyToClipboard } from '../utils/clipboard';
import { parseCharacterName, baseCharName } from '../utils/beatCast';
import { sequenceAt, wardrobeIn } from '../utils/sequence';

const generateId = () => Math.random().toString(36).substring(2, 11);

/**
 * The AI ORCHESTRATION domain: executeAI (all eight mode branches including
 * the STORYBOARD/GRAYBOX scene cascades), the CONTINUE two-step continuation,
 * suggestion acceptance and the auto-accept effect, plus the VIDEO_PLAN
 * instant-replan effect.
 *
 * Extracted verbatim from App.tsx (wave 2 of the App split): same bodies,
 * same dependency arrays. Editor/sync/UI pieces it consumes arrive as
 * parameters (handleBlockChange, modal setters, the plan setter…).
 */
export function useAIExecutor({
  appSettings, screenplay, setScreenplay,
  selectedBlockId, setSelectedBlockId,
  aiMode, aiState, setAIState,
  setShowAIModal, setTransitionHeadingDraft,
  setVideoPlan, videoPlanDuration,
  promptSource, t, isReadOnly, handleBlockChange,
}: {
  appSettings: AppSettings;
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  selectedBlockId: string;
  setSelectedBlockId: React.Dispatch<React.SetStateAction<string>>;
  aiMode: AIMode;
  aiState: AIState;
  setAIState: React.Dispatch<React.SetStateAction<AIState>>;
  setShowAIModal: React.Dispatch<React.SetStateAction<boolean>>;
  setTransitionHeadingDraft: React.Dispatch<React.SetStateAction<string>>;
  setVideoPlan: React.Dispatch<React.SetStateAction<import('../utils/videoPlan').VideoPlan | null>>;
  videoPlanDuration: number;
  promptSource: string;
  t: typeof import('../constants').TRANSLATIONS['en'];
  isReadOnly: boolean;
  handleBlockChange: (id: string, content: string) => void;
}) {
  const executeAI = useCallback(async (modeOverride?: AIMode) => {
    const effectiveMode = modeOverride || aiMode;

    if (appSettings.provider === 'gemini' && !appSettings.geminiApiKey && !process.env.API_KEY) {
        setAIState(prev => ({ ...prev, error: t.aiErrorKeyMissing, grayboxDraft: null, batchProgress: null }));
        return;
    }
    if (appSettings.provider === 'deepseek' && !appSettings.deepseekApiKey) {
        setAIState(prev => ({ ...prev, error: t.aiErrorKeyMissing, grayboxDraft: null, batchProgress: null }));
        return;
    }

    setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });

    const currentTemplateId = screenplay.metadata.templateId || 'standard';
    const activeTemplate = TEMPLATES.find(t => t.id === currentTemplateId) || TEMPLATES[0];
    const systemInstruction = activeTemplate.systemPrompt;
    const scriptLanguage = screenplay.metadata.scriptLanguage || 'en';

    try {
      let result = '';
      if (effectiveMode !== 'VIDEO_PLAN') setVideoPlan(null);
      if (effectiveMode === 'CONTINUE') {
        // Lyrics has no scene concept — skip the transition-decision step and
        // continue directly, preserving the original one-shot behavior.
        if (currentTemplateId === 'lyrics') {
          result = await generateContinuation(screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId);
          setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
        } else {
          // Two-step CONTINUE: first judge whether to stay or transition.
          const decision = await decideSceneTransition(screenplay.blocks, systemInstruction, scriptLanguage, appSettings);
          setTransitionHeadingDraft(decision.sceneHeading || '');
          setAIState({ isLoading: false, suggestion: null, error: null, decision, grayboxDraft: null, batchProgress: null });
          return;
        }
      } else if (effectiveMode === 'IDEAS') {
        const ideas = await suggestIdeas(screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId);
        result = ideas.join('\n\n');
      } else if (effectiveMode === 'REWRITE') {
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (currentBlock) {
          result = await rewriteBlock(currentBlock.content, "dramatic", systemInstruction, scriptLanguage, appSettings, currentTemplateId, screenplay.blocks);
        } else {
            result = t.aiErrorGeneric;
        }
      } else if (effectiveMode === 'STORYBOARD') {
        shipLog('flow', 'info', `STORYBOARD batch start: ${screenplay.blocks.length} blocks`);
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (!currentBlock || (currentBlock.type !== 'ACTION' && currentBlock.type !== 'CHARACTER' && currentBlock.type !== 'SCENE_HEADING')) {
            setAIState({ isLoading: false, suggestion: null, error: t.storyboardWrongBlock, decision: null, grayboxDraft: null, batchProgress: null });
            return;
        }
        // Slice the current scene: from the nearest preceding SCENE_HEADING
        // through the target block (inclusive), so the prompt inherits the
        // scene's environment/time/mood.
        const targetIdx = screenplay.blocks.findIndex(b => b.id === selectedBlockId);
        let sceneStart = 0;
        for (let i = targetIdx; i >= 0; i--) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneStart = i; break; }
        }

        // --- Cascading batch: Alt+S on a SCENE_HEADING ---
        // Generate this scene's ENVIRONMENT image (the heading), then a
        // CHARACTER design sheet for every distinct character acting/speaking,
        // then an ACTION storyboard frame for every action beat — each only
        // when its block lacks an imagePrompt. Mirrors GRAYBOX's Alt+G cascade:
        // every result is written straight back to its block live so progress
        // is durable and the chips light up as each lands. Single-block Alt+S
        // on ACTION/CHARACTER/SCENE_HEADING still works (no cascade).
        if (currentBlock.type === 'SCENE_HEADING') {
          let sceneEnd = screenplay.blocks.length;
          for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneEnd = i; break; }
          }
          const sceneFull = screenplay.blocks.slice(sceneStart, sceneEnd);

          // SCRIPT-WIDE character identity table (① text): every CHARACTER
          // block in the whole screenplay that carries a design sheet. Fed to
          // every prompt so a character defined in an EARLIER scene still
          // resolves here (cross-scene consistency) — the per-scene slice alone
          // would forget it.
          const globalCharDesigns = new Map<string, string>();
          for (const b of screenplay.blocks) {
            if (b.type === 'CHARACTER' && b.imagePrompt?.trim()) {
              const n = baseCharName(b.content.trim());
              if (n && !globalCharDesigns.has(n)) globalCharDesigns.set(n, b.imagePrompt!.trim());
            }
          }

          // Ordered work: env → distinct characters (by BASE name, tracking the
          // costume variant per slot) → actions. Each entry only if the block
          // lacks a prompt already. A `张三（浴袍）` slot is its OWN sheet — env/
          // char/other variants not merged.
          const jobs: { blockId: string; kind: 'environment' | 'character' | 'action'; charName?: string; variant?: string }[] = [];
          const sceneHeadingBlock = screenplay.blocks[sceneStart];
          if (sceneHeadingBlock && !sceneHeadingBlock.imagePrompt?.trim()) {
            jobs.push({ blockId: sceneHeadingBlock.id, kind: 'environment' });
          }
          const seenCharSlots = new Set<string>();
          for (let i = sceneStart + 1; i < sceneEnd; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'CHARACTER') {
              const pc = parseCharacterName(b.content);
              const slotKey = b.content.trim();
              if (!pc.base || seenCharSlots.has(slotKey)) continue;
              seenCharSlots.add(slotKey);
              if (!b.imagePrompt?.trim()) jobs.push({ blockId: b.id, kind: 'character', charName: pc.base, variant: pc.variant });
            }
          }
          for (let i = sceneStart + 1; i < sceneEnd; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'ACTION' && !b.imagePrompt?.trim()) jobs.push({ blockId: b.id, kind: 'action' });
          }

          const total = jobs.length;
          if (total === 0) {
            // Whole scene already storyboarded — say so instead of silently
            // closing (a silent no-op reads as "it's broken").
            setShowAIModal(true);
            setAIState({ isLoading: false, suggestion: null, error: null, info: t.storyboardAllDone, decision: null, grayboxDraft: null, batchProgress: null });
            return;
          }

          let failures = 0;
          let firstError: string | null = null;
          for (let s = 0; s < total; s++) {
            const job = jobs[s];
            const jobBlock = screenplay.blocks.find(b => b.id === job.blockId);
            setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: { current: s + 1, total } });
            try {
              // Full-scene context so each prompt sees all beats; ACTION frames
              // get their own shot graybox as composition lock (option A).
              const shotGraybox = job.kind === 'action' && jobBlock?.graybox?.kind === 'shot' && !jobBlock.graybox.error
                ? jobBlock.graybox : undefined;
              const prompt = await generateImagePrompt(
                sceneFull, job.blockId, systemInstruction, appSettings, job.kind,
                screenplay.metadata.styleHead, shotGraybox,
                globalCharDesigns,
                job.kind === 'character' || job.kind === 'action' ? wardrobeIn(sequenceAt(screenplay.sequences, screenplay.blocks.findIndex(b => b.id === job.blockId)), job.charName ?? '') : undefined,
                job.kind === 'character' || job.kind === 'action' ? job.charName : undefined,
                job.kind === 'character' ? job.variant : undefined,
              );
              // A blank/empty response is a failed job, not a success to persist
              // (it would light an empty chip). Count it and move on.
              if (!prompt || !prompt.trim()) {
                failures++;
                if (!firstError) firstError = t.aiErrorGeneric;
                console.warn(`Storyboard for block ${job.blockId} returned empty`); shipLog("storyboard", "warn", "Storyboard returned empty");
                continue;
              }
              // Write live. CHARACTER prompts propagate to the same BASE+variant
              // slot only — so the bathrobe sheet doesn't overwrite the base
              // 张三 sheet.
              setScreenplay(prev => ({
                ...prev,
                blocks: prev.blocks.map(b => {
                  if (b.id === job.blockId) return { ...b, imagePrompt: prompt };
                  if (job.kind === 'character' && job.charName && b.type === 'CHARACTER' &&
                      baseCharName(b.content.trim()) === job.charName && parseCharacterName(b.content.trim()).variant === job.variant) {
                    return { ...b, imagePrompt: prompt };
                  }
                  return b;
                }),
                lastModified: Date.now(),
              }));
            } catch (err: any) {
              failures++;
              if (!firstError) firstError = err?.message || t.aiErrorGeneric;
              console.warn(`Storyboard for block ${job.blockId} failed:`, err); shipLog("storyboard", "error", `Storyboard for block ${job.blockId} failed`, err); shipLog("storyboard", "error", `Storyboard for block ${job.blockId} failed`, err);
            }
          }

          // Done. Everything already saved live. If anything failed, keep the
          // modal open with the error (or partial note); else close — the one
          // click is complete and needs no accept.
          if (firstError) {
            setAIState({
              isLoading: false,
              suggestion: null,
              error: failures === total ? (firstError || t.aiErrorGeneric) : t.storyboardBatchPartial.replace('{failed}', String(failures)).replace('{total}', String(total)),
              decision: null, grayboxDraft: null, batchProgress: null,
            });
            return;
          }
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }

        const sceneBlocks = screenplay.blocks.slice(sceneStart, targetIdx + 1);
        // After the SCENE_HEADING batch branch above returned, only ACTION /
        // CHARACTER remain here. kind: character vs action.
        const kind = currentBlock.type === 'CHARACTER' ? 'character' : 'action';
        // Composition lock: if this beat already has a SHOT graybox, feed it so
        // the image prompt reproduces the same camera (graybox is the framing
        // source of truth). Only ACTION beats carry a shot camera.
        const shotGraybox = kind === 'action' && currentBlock.graybox?.kind === 'shot' && !currentBlock.graybox.error
          ? currentBlock.graybox
          : undefined;
        // Global identity table (①) so even the single-block path sees a
        // character defined in an earlier scene.
        const globalCharDesigns = new Map<string, string>();
        for (const b of screenplay.blocks) {
          if (b.type === 'CHARACTER' && b.imagePrompt?.trim()) {
            const n = baseCharName(b.content.trim());
            if (n && !globalCharDesigns.has(n)) globalCharDesigns.set(n, b.imagePrompt!.trim());
          }
        }
        const pc = kind === 'character' ? parseCharacterName(currentBlock.content.trim()) : { base: '' };
        const charName = kind === 'character' ? pc.base : undefined;
        const variant = kind === 'character' ? pc.variant : undefined;
        const wardrobe = (kind === 'character' || kind === 'action') && charName
          ? wardrobeIn(sequenceAt(screenplay.sequences, targetIdx), charName)
          : undefined;
        result = await generateImagePrompt(sceneBlocks, selectedBlockId, systemInstruction, appSettings, kind, screenplay.metadata.styleHead, shotGraybox, globalCharDesigns, wardrobe, charName, variant);
      } else if (effectiveMode === 'GRAYBOX') {
        shipLog('flow', 'info', `GRAYBOX batch start: ${screenplay.blocks.length} blocks`);
        // Graybox: structured 3D previs JSON (scene layout or shot camera).
        // Mirrors the STORYBOARD scene-slice, but emits a GrayboxData object
        // stored in `grayboxDraft` (never `suggestion`).
        const currentBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
        if (!currentBlock || (currentBlock.type !== 'SCENE_HEADING' && currentBlock.type !== 'ACTION' && currentBlock.type !== 'DIALOGUE')) {
            setAIState({ isLoading: false, suggestion: null, error: t.grayboxWrongBlock, decision: null, grayboxDraft: null, batchProgress: null });
            return;
        }
        const targetIdx = screenplay.blocks.findIndex(b => b.id === selectedBlockId);
        let sceneStart = 0;
        for (let i = targetIdx; i >= 0; i--) {
            if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneStart = i; break; }
        }
        const sceneBlocks = screenplay.blocks.slice(sceneStart, targetIdx + 1);

        // --- Cascading batch: Alt+G on a SCENE_HEADING ---
        // Generate the scene graybox first; then, if the scene heading lacks a
        // graybox or just got one, walk forward through every ACTION/DIALOGUE
        // in this scene (up to the next SCENE_HEADING) and generate a shot
        // graybox for each that doesn't already have one. Each result is
        // written straight back to its block (real-time) so progress is
        // durable even if the run is interrupted. Single-block Alt+G on an
        // ACTION/DIALOGUE still works (no cascade). Directional guidance only:
        // we don't prescribe shot choices here; the prompt carries that.
        if (currentBlock.type === 'SCENE_HEADING') {
          // --- Direction 1: same-heading scene graybox reuse ---
          // A screenplay often repeats a scene heading ("INT. 宫廷寝殿 - 日")
          // across CUT TO beats to denote time jumps within the same room.
          // Regenerating the layout each time yields inconsistent geometry, and
          // shot coords then stop lining up with any single layout. So before
          // generating, look BACKWARD for an earlier SCENE_HEADING with the
          // same content that already has a scene graybox; if found, reuse it
          // verbatim (no AI call). Only the first sighting of a space designs
          // it; every later revisit inherits that layout. The model still has
          // full design freedom the first time — we only enforce consistency,
          // not style.
          let sceneGraybox: GrayboxData;
          if (currentBlock.graybox) {
            sceneGraybox = currentBlock.graybox;
          } else {
            let reuse: GrayboxData | null = null;
            for (let i = 0; i < sceneStart; i++) {
              const b = screenplay.blocks[i];
              if (b.type === 'SCENE_HEADING' && b.content === currentBlock.content && b.graybox && b.graybox.kind === 'scene' && !b.graybox.error) {
                reuse = b.graybox;
                break;
              }
            }
            if (reuse) {
              sceneGraybox = reuse;
            } else {
              // The scene graybox must see the WHOLE scene, not just the
              // heading: character blocking depends on who appears in the
              // beats below. Alt+G on a heading means targetIdx === sceneStart,
              // so `sceneBlocks` would carry the heading alone — no CHARACTER
              // cues, no beats, nothing to block. Slice sceneStart → the next
              // SCENE_HEADING (or EOF) instead.
              let sceneEnd = screenplay.blocks.length;
              for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
                if (screenplay.blocks[i].type === 'SCENE_HEADING') { sceneEnd = i; break; }
              }
              const sceneFullBlocks = screenplay.blocks.slice(sceneStart, sceneEnd);
              sceneGraybox = await generateGraybox(sceneFullBlocks, selectedBlockId, systemInstruction, appSettings, 'scene');
            }
            // Persist immediately so a later failure doesn't lose it.
            if (!sceneGraybox.error) {
              setScreenplay(prev => ({
                ...prev,
                blocks: prev.blocks.map(b => b.id === selectedBlockId ? { ...b, graybox: sceneGraybox } : b),
                lastModified: Date.now(),
              }));
            }
          }

          // 2. Collect shot blocks in this scene lacking a graybox.
          //    Read from the latest screenplay (scene graybox may have just
          //    been written) by snapshotting via a functional update check.
          //    We gather indices, not stale block refs.
          const shotIndices: number[] = [];
          for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'SCENE_HEADING') break; // next scene
            if ((b.type === 'ACTION' || b.type === 'DIALOGUE') && !b.graybox) {
              shotIndices.push(i);
            }
          }

          if (sceneGraybox.error && shotIndices.length === 0) {
            // Nothing to cascade and scene graybox failed — surface it.
            setAIState({ isLoading: false, suggestion: null, error: sceneGraybox.error, decision: null, grayboxDraft: sceneGraybox, batchProgress: null });
            return;
          }

          // 3. Run shot generation sequentially, writing each back live.
          //    --- Directions A+B: feed the scene layout + the shots already
          //    generated earlier in THIS scene back into each call, so the
          //    cinematographer (a) places the camera against the real layout
          //    and (b) can see the rhythm built so far and vary it. We collect
          //    priorShots live as each succeeds (including any that pre-existed
          //    on earlier beats in this scene before the cascade started).
          const priorShots: GrayboxData[] = [];
          // Seed with shot grayboxes already present on beats before the first
          // missing one, so the rhythm reflects the whole scene, not just what
          // this run produces.
          for (let i = sceneStart + 1; i < screenplay.blocks.length; i++) {
            const b = screenplay.blocks[i];
            if (b.type === 'SCENE_HEADING') break;
            if ((b.type === 'ACTION' || b.type === 'DIALOGUE') && b.graybox && b.graybox.kind === 'shot' && !b.graybox.error) {
              priorShots.push(b.graybox);
            }
          }
          const sceneLayoutForShots = (!sceneGraybox.error && sceneGraybox.kind === 'scene') ? sceneGraybox : null;

          const total = shotIndices.length;
          let failures = 0;
          let firstError: string | null = null;
          let lastShotGraybox: GrayboxData | null = null;
          for (let s = 0; s < total; s++) {
            const blockIdx = shotIndices[s];
            const block = screenplay.blocks[blockIdx];
            setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: { current: s + 1, total } });
            try {
              // Slice this shot's scene context up to and including its block.
              const shotSceneBlocks = screenplay.blocks.slice(sceneStart, blockIdx + 1);
              const shotGraybox = await generateGraybox(
                shotSceneBlocks, block.id, systemInstruction, appSettings, 'shot',
                { sceneLayout: sceneLayoutForShots, priorShots: [...priorShots] },
              );
              if (shotGraybox.error) {
                failures++;
                if (!firstError) firstError = shotGraybox.error;
                console.warn(`Graybox for block ${block.id} degraded:`, shotGraybox.error); shipLog("graybox", "warn", `Graybox degraded: ${shotGraybox.error}`);
              } else {
                setScreenplay(prev => ({
                  ...prev,
                  blocks: prev.blocks.map(b => b.id === block.id ? { ...b, graybox: shotGraybox } : b),
                  lastModified: Date.now(),
                }));
                priorShots.push(shotGraybox);   // feed the next beat
                lastShotGraybox = shotGraybox;
              }
            } catch (err: any) {
              failures++;
              if (!firstError) firstError = err?.message || t.aiErrorGeneric;
              console.warn(`Graybox for block ${block.id} failed:`, err); shipLog("graybox", "error", `Graybox for block ${block.id} failed`, err);
            }
          }

          // 4. Done. Show the scene graybox (or last shot) as the modal draft,
          //    and report partial failures if any. If everything succeeded
          //    silently, close-style "done" state: we keep the scene draft
          //    visible so the user can review/accept.
          const doneDraft = sceneGraybox.error ? (lastShotGraybox ?? sceneGraybox) : sceneGraybox;
          const doneError = firstError && failures === total
            ? (firstError || t.aiErrorGeneric)
            : (firstError ? t.grayboxBatchPartial.replace('{failed}', String(failures)).replace('{total}', String(total)) : null);
          setAIState({
            isLoading: false,
            suggestion: JSON.stringify(doneDraft, null, 2),
            error: doneError,
            decision: null,
            grayboxDraft: doneDraft,
            batchProgress: null,
          });
          return;
        }

        // --- Single-block shot graybox (ACTION/DIALOGUE) ---
        // Direction A+B also applies here: a standalone Alt+G on one beat should
        // still see the scene it lives in (so the camera lands on real layout
        // coordinates) and any shots already designed for earlier beats in the
        // same scene (so it joins an existing rhythm instead of ignoring it).
        // Look up the scene graybox on the sceneStart heading, and gather prior
        // shot grayboxes on beats between sceneStart+1 and targetIdx.
        const sceneHeadingBlock = screenplay.blocks[sceneStart];
        const sceneLayoutForSingle = sceneHeadingBlock?.graybox && sceneHeadingBlock.graybox.kind === 'scene' && !sceneHeadingBlock.graybox.error
          ? sceneHeadingBlock.graybox : null;
        const priorShotsSingle: GrayboxData[] = [];
        for (let i = sceneStart + 1; i < targetIdx; i++) {
          const b = screenplay.blocks[i];
          if (b.type === 'SCENE_HEADING') break;
          if ((b.type === 'ACTION' || b.type === 'DIALOGUE') && b.graybox && b.graybox.kind === 'shot' && !b.graybox.error) {
            priorShotsSingle.push(b.graybox);
          }
        }
        const kind: 'scene' | 'shot' = 'shot';
        const graybox = await generateGraybox(
          sceneBlocks, selectedBlockId, systemInstruction, appSettings, kind,
          { sceneLayout: sceneLayoutForSingle, priorShots: priorShotsSingle },
        );
        // Surface a degrade error in the error field; otherwise show the JSON
        // in the suggestion box and hold the object for saving.
        if (graybox.error) {
          setAIState({ isLoading: false, suggestion: null, error: graybox.error, decision: null, grayboxDraft: graybox, batchProgress: null });
        } else {
          setAIState({ isLoading: false, suggestion: JSON.stringify(graybox, null, 2), error: null, decision: null, grayboxDraft: graybox, batchProgress: null });
        }
        return;
      } else if (effectiveMode === 'DUB') {
        // Dub sheet: analyze EVERY dialogue line in the script and write each
        // block's dubEmotion back in place. Batch — runs across the whole
        // screenplay, not a selected window.
        const dubMap = await analyzeDubbing(screenplay.blocks, systemInstruction, appSettings);
        const total = screenplay.blocks.filter(b => b.type === 'DIALOGUE').length;
        const applied = Object.keys(dubMap).length;
        if (applied === 0) {
          setAIState({ isLoading: false, suggestion: null, error: t.aiErrorGeneric, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        setScreenplay(prev => ({
          ...prev,
          blocks: prev.blocks.map(b => dubMap[b.id] ? { ...b, dubEmotion: dubMap[b.id] } : b),
          lastModified: Date.now(),
        }));
        result = `Dubbing direction written to ${applied}/${total} dialogue line${total === 1 ? '' : 's'}. (emotion + delivery + intensity per line)`;
      } else if (effectiveMode === 'FROM_PROMPT') {
        shipLog('flow', 'info', `FROM_PROMPT start: promptSource ${promptSource.length} chars`);
        // FROM_PROMPT: transcribe a pasted production prompt into a full
        // screenplay. The result flows through the normal suggestion → accept
        // path; accept creates a NEW script (not an append).
        if (!promptSource.trim()) {
          setAIState({ isLoading: false, suggestion: null, error: t.fromPromptEmpty, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        result = await screenplayFromPrompt(promptSource, activeTemplate.systemPrompt, screenplay.metadata.scriptLanguage, appSettings);
        if (!result || !result.trim()) {
          setAIState({ isLoading: false, suggestion: null, error: t.aiErrorGeneric, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
      } else if (effectiveMode === 'VIDEO_PLAN') {
        // Deterministic planner — no AI call. Reads each beat's timestamp
        // prefix, groups consecutive beats into ≤target generation windows
        // (scene changes force a boundary; beats are atomic, never split).
        shipLog('flow', 'info', `VIDEO_PLAN start: ${screenplay.blocks.length} blocks, mode=${screenplay.productionMode ?? '?'}`);
        const target = videoPlanDuration; // per-segment window (user-selected)
        const plan = planVideoSegments(screenplay.blocks, target);
        shipLog('flow', 'info', `VIDEO_PLAN planned: ${plan.segments.length} segments [${plan.segments.map(s => `${s.beats.length}b/${Math.round(s.duration)}s`).join(', ')}]`);
        // Per-beat breakdown so span/compression questions can be answered
        // from the server log alone (beat ranges are the ground truth).
        for (const seg of plan.segments) {
          shipLog('flow', 'info', `VIDEO_PLAN seg${seg.index + 1} beats: ${seg.beats.map(b => `${b.range}(${Math.round((b.end - b.start) * 10) / 10}s)`).join(' + ')} = span ${Math.round(seg.duration * 10) / 10}s${seg.oversize ? ' [OVERSIZE]' : ''}`);
        }
        if (!plan.segments.length || plan.segments.every(s => s.beats.length === 0)) {
          shipLog('flow', 'warn', 'VIDEO_PLAN early-return: no timeline beats found');
          setAIState({ isLoading: false, suggestion: null, error: t.videoPlanNoTimeline, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        result = formatVideoPlan(plan);
        setVideoPlan(plan);

        // Per-segment graybox generation: after the plan, generate ONE
        // continuous camera per segment (LLM reads all beats + scene blocking).
        // Results land in screenplay.segmentGrayboxes keyed by the segment's
        // first block id — the white-model render / H3 flow reads them.
        // SKIPPED in simple production mode (no spatial blocking needed).
        if (screenplay.productionMode === 'simple') {
          shipLog('flow', 'info', 'VIDEO_PLAN: simple mode — skipping segment graybox batch');
          setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
        }
        const segLayout = (() => {
          const h = screenplay.blocks.find(b => b.type === 'SCENE_HEADING');
          return h?.graybox && h.graybox.kind === 'scene' && !h.graybox.error ? h.graybox : null;
        })();
        const segGrayboxes: Record<string, GrayboxData> = {};
        let segFailures = 0;
        let segFirstError: string | null = null;
        for (let si = 0; si < plan.segments.length; si++) {
          const seg = plan.segments[si];
          setAIState({ isLoading: true, suggestion: result || null, error: null, info: null, decision: null, grayboxDraft: null, batchProgress: { current: si + 1, total: plan.segments.length } });
          const segBlocks = screenplay.blocks.filter(b => seg.blockIds.includes(b.id));
          shipLog('flow', 'info', `VIDEO_PLAN segment ${si + 1}/${plan.segments.length}: calling LLM (${seg.beats.length} beats, ${Math.round(seg.duration)}s, layout=${segLayout ? 'yes' : 'none'})`);
          const gb = await generateSegmentGraybox(
            segBlocks, seg.beats, segLayout, seg.sceneHeading,
            Math.round(seg.duration * 10) / 10, appSettings, activeTemplate.systemPrompt,
          );
          shipLog('flow', gb.error ? 'warn' : 'info', `VIDEO_PLAN segment ${si + 1}/${plan.segments.length}: ${gb.error ? `FAILED — ${gb.error}` : 'ok'}`);
          if (!gb.error) {
            segGrayboxes[seg.blockIds[0]] = gb;
            setScreenplay(prev => ({
              ...prev,
              segmentGrayboxes: { ...(prev.segmentGrayboxes ?? {}), [seg.blockIds[0]]: gb },
              lastModified: Date.now(),
            }));
          } else {
            segFailures++;
            if (!segFirstError) segFirstError = gb.error;
            console.warn('Segment graybox failed:', gb.error); shipLog("segment-graybox", "error", `Segment graybox failed: ${gb.error}`);
          }
        }
        shipLog('flow', segFailures ? 'warn' : 'info', `VIDEO_PLAN batch done: ${plan.segments.length - segFailures}/${plan.segments.length} ok`);
        if (segFailures) {
          setAIState({ isLoading: false, suggestion: result || null, error: `${segFailures}/${plan.segments.length} 段灰盒生成失败——${segFirstError ?? '未知原因'}`, decision: null, grayboxDraft: null, batchProgress: null });
        }
      }
      setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    } catch (err: any) {
      shipLog('flow', 'error', `executeAI(${effectiveMode}) threw`, err);
      const msg = err?.message || '';
      // Map known sentinel errors from the service layer to localized messages
      const friendly = msg === 'GEMINI_KEY_MISSING' || msg === 'DEEPSEEK_KEY_MISSING'
        ? t.aiErrorKeyMissing
        : (err?.message || t.aiErrorGeneric);
      setAIState({ isLoading: false, suggestion: null, error: friendly, decision: null, grayboxDraft: null, batchProgress: null });
    }
  }, [aiMode, appSettings, screenplay.blocks, screenplay.metadata.scriptLanguage, screenplay.metadata.templateId, selectedBlockId, t, promptSource, videoPlanDuration]);

  // Re-plan immediately when the window knob changes. The planner is
  // deterministic and AI-free, so replanning is instant — but it MUST run
  // from an effect (post-commit), not from the select's onChange: executeAI
  // closes over the duration state, and calling it inside the same handler
  // that sets the state captured the PREVIOUS value (the 'lags one beat' bug).
  const executeAIRef = useRef(executeAI);
  executeAIRef.current = executeAI;
  useEffect(() => {
    if (aiMode !== 'VIDEO_PLAN' || !aiState.suggestion) return;
    executeAIRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPlanDuration]);

  const handleAIAction = async () => {
    if (isReadOnly) return;
    setShowAIModal(true);
    setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
  };

  /**
   * Second step of the CONTINUE flow: actually generate the continuation,
   * constrained by the user's confirmed transition directive.
   *   - allowTransition=false  → stay in the current scene (no new [SCENE])
   *   - allowTransition=true   → open a new scene with the (edited) heading
   * Called from the decision card's "Continue current scene" / "Accept transition"
   * buttons. Undefined directive (lyrics / fallback) preserves the original one-shot.
   */
  const runContinuation = useCallback(async (directive?: { allowTransition: boolean; targetSceneHeading?: string }) => {
    const currentTemplateId = screenplay.metadata.templateId || 'standard';
    const activeTemplate = TEMPLATES.find(t => t.id === currentTemplateId) || TEMPLATES[0];
    const systemInstruction = activeTemplate.systemPrompt;
    const scriptLanguage = screenplay.metadata.scriptLanguage || 'en';

    setAIState({ isLoading: true, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    try {
      const result = await generateContinuation(
        screenplay.blocks, systemInstruction, scriptLanguage, appSettings, currentTemplateId, directive
      );
      setAIState({ isLoading: false, suggestion: result, error: null, decision: null, grayboxDraft: null, batchProgress: null });
    } catch (err: any) {
      const msg = err?.message || '';
      const friendly = msg === 'GEMINI_KEY_MISSING' || msg === 'DEEPSEEK_KEY_MISSING'
        ? t.aiErrorKeyMissing
        : (err?.message || t.aiErrorGeneric);
      setAIState({ isLoading: false, suggestion: null, error: friendly, decision: null, grayboxDraft: null, batchProgress: null });
    }
  }, [screenplay.blocks, screenplay.metadata.scriptLanguage, screenplay.metadata.templateId, appSettings, t]);

  const acceptAISuggestion = useCallback(() => {
      // GRAYBOX saves the structured draft onto the selected block (no body edit).
      // Guarded separately from `suggestion` since GRAYBOX never sets it.
      if (aiMode === 'GRAYBOX') {
          const graybox = aiState.grayboxDraft;
          if (!graybox) return;
          setScreenplay(prev => ({
              ...prev,
              blocks: prev.blocks.map(b => b.id === selectedBlockId ? { ...b, graybox } : b),
              lastModified: Date.now()
          }));
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      if (!aiState.suggestion) return;

      // VIDEO_PLAN + DUB results are INFORMATIONAL — the plan/state was
      // already written elsewhere (window.__stashed plan / dubEmotion fields).
      // Falling through to the block-insertion path below is exactly how a
      // formatted plan once landed in the user's script as junk ACTION rows.
      if (aiMode === 'VIDEO_PLAN' || aiMode === 'DUB') {
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      // IDEAS mode returns creative directions for reference, not script content.
      // Copy to clipboard instead of inserting into the script body.
      if (aiMode === 'IDEAS') {
          void copyToClipboard(aiState.suggestion);
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      // REWRITE replaces the selected block in place.
      if (aiMode === 'REWRITE') {
           const content = aiState.suggestion.replace(/^\[.*?\]\s*/, '');
           handleBlockChange(selectedBlockId, content);
           setShowAIModal(false);
           setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null }); // Clear suggestion to prevent re-insertion
           return;
      }

      // STORYBOARD: save the generated image prompt onto the selected block.
      // Does not touch the script body — the prompt lives in block.imagePrompt.
      // For CHARACTER blocks, the same character (matched by name/content) may
      // appear in multiple blocks: keep ONE prompt per character by writing it
      // to every CHARACTER block with the same name, so re-running on any
      // occurrence updates the single shared design sheet.
      if (aiMode === 'STORYBOARD') {
          const prompt = aiState.suggestion;
          const targetBlock = screenplay.blocks.find(b => b.id === selectedBlockId);
          const isCharacter = targetBlock?.type === 'CHARACTER';
          const charName = isCharacter ? targetBlock!.content.trim() : '';
          setScreenplay(prev => ({
              ...prev,
              blocks: prev.blocks.map(b => {
                  if (b.id === selectedBlockId) return { ...b, imagePrompt: prompt };
                  // Propagate to same-name CHARACTER blocks so there's one prompt per character.
                  if (isCharacter && b.type === 'CHARACTER' && b.content.trim() === charName) {
                      return { ...b, imagePrompt: prompt };
                  }
                  return b;
              }),
              lastModified: Date.now()
          }));
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      // CONTINUE: append generated blocks to the end of the script (not after the
      // currently selected block, which may sit mid-document).
      const lines = aiState.suggestion.split('\n').filter(l => l.trim().length > 0);
      const newBlocks: ScriptBlock[] = lines.map(line => {
          let type: BlockType = 'ACTION';
          let content = line.trim();

          const tagMatch = content.match(/^\[(SCENE|ACTION|CHARACTER|DIALOGUE|PARENTHETICAL|TRANSITION)\]\s?(.*)/i);

          if (tagMatch) {
              const tagName = tagMatch[1].toUpperCase();
              content = tagMatch[2];

              if (tagName === 'SCENE') type = 'SCENE_HEADING';
              else if (tagName === 'ACTION') type = 'ACTION';
              else if (tagName === 'CHARACTER') type = 'CHARACTER';
              else if (tagName === 'DIALOGUE') type = 'DIALOGUE';
              else if (tagName === 'PARENTHETICAL') type = 'PARENTHETICAL';
              else if (tagName === 'TRANSITION') type = 'TRANSITION';
          } else {
               if (content.match(/^(INT\.|EXT\.|内\.|外\.)/i)) {
                   type = 'SCENE_HEADING';
               } else if (content === content.toUpperCase() && content.length < 20 && !content.includes('。') && !content.includes('.')) {
                   type = 'CHARACTER';
               }
          }

          return { id: generateId(), type, content };
      });
      // Structural repair for LLM output: drop empties, collapse consecutive
      // duplicates, guarantee a leading SCENE_HEADING. Deterministic — no model
      // behavior trusted here.
      const safeBlocks = sanitizeParsedBlocks(newBlocks);

      // FROM_PROMPT: the transcribed screenplay becomes a NEW script — the
      // pasted production prompt is a whole work, not a continuation of
      // whatever is currently open. Title derives from the first scene heading
      // so the sidebar shows something meaningful.
      if (aiMode === 'FROM_PROMPT') {
          if (!safeBlocks.length) {
              setAIState({ isLoading: false, suggestion: null, error: t.aiErrorGeneric, decision: null, grayboxDraft: null, batchProgress: null });
              return;
          }
          const firstScene = safeBlocks.find(b => b.type === 'SCENE_HEADING')?.content?.trim();
          // Auto-detect production mode: fixed-camera keywords → simple
          const fp = promptSource.toLowerCase();
          const isFixedCam = /固定机位|一镜到底|固定镜头|fixed camera|single take|static shot|desktop|录屏/.test(fp);
          const newScript: Screenplay = {
              id: generateId(),
              metadata: {
                  ...screenplay.metadata,
                  title: firstScene ? firstScene.slice(0, 40) : (screenplay.metadata.title || 'Prompt Script'),
                  draft: 'First Draft',
              },
              blocks: safeBlocks,
              sourcePrompt: promptSource,
              productionMode: isFixedCam ? 'simple' : 'cinematic',
              lastModified: Date.now(),
          };
          setScreenplay(newScript);
          setSelectedBlockId(safeBlocks[0].id);
          setShowAIModal(false);
          setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null });
          return;
      }

      setScreenplay(prev => {
          const updatedBlocks = [...prev.blocks, ...newBlocks];
          return { ...prev, blocks: updatedBlocks };
      });

      // Focus the first newly appended block
      if (newBlocks.length > 0) {
          setSelectedBlockId(newBlocks[0].id);
      }

      setShowAIModal(false);
      setAIState({ isLoading: false, suggestion: null, error: null, decision: null, grayboxDraft: null, batchProgress: null }); // Clear suggestion to prevent re-insertion
  }, [aiState.suggestion, aiState.grayboxDraft, aiMode, selectedBlockId, handleBlockChange]);

  // Auto-accept AI suggestions when enabled.
  // Gated on !aiState.decision: the CONTINUE judgment step produces a decision
  // (not a suggestion), so it must NOT trigger auto-insert — only the actual
  // continuation suggestion (decision already consumed) should auto-accept.
  // GRAYBOX also auto-saves its draft when enabled.
  useEffect(() => {
      if (appSettings.autoAcceptAI && !aiState.isLoading && !aiState.decision) {
          if (aiState.suggestion || aiState.grayboxDraft) {
              acceptAISuggestion();
          }
      }
  }, [aiState.suggestion, aiState.grayboxDraft, aiState.isLoading, aiState.decision, appSettings.autoAcceptAI, acceptAISuggestion]);

  return { executeAI, handleAIAction, runContinuation, acceptAISuggestion };
}
