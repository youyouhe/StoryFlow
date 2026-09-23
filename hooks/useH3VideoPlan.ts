import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppSettings, H3Task, RefBindings, RefImage, ScriptBlock, AIState } from '../types';
import { MINIMAX_VIDEO_MODELS } from '../constants';
import { shipLog } from '../services/debugLog';
import { uploadH3Video, createH3Task, queryH3Task, estimateH3Cost, validateH3Submission, H3ReferenceImage } from '../services/minimaxService';
import { comfyUploadImage, comfyPatchWorkflow, comfyQueuePrompt, comfyQueryTask } from '../services/comfyService';
import { buildSegmentVideoPrompt, clampSegmentSeconds, resolveSegmentRefs } from '../utils/videoSegmentSubmit';
import type { VideoPlan } from '../utils/videoPlan';

const generateId = () => Math.random().toString(36).substring(2, 11);

/**
 * The H3 VIDEO-GENERATION state domain: the persisted task list, the
 * VIDEO_PLAN knobs and live plan, per-segment preflight/cost, the white-model
 * + ComfyUI submission paths and the shared poller.
 *
 * Extracted verbatim from App.tsx (wave 1 of the App split). Cross-domain
 * inputs arrive as parameters: settings (keys, backend choice), the active
 * screenplay blocks, the resolved reference bindings/images, and the AI-state
 * setter used to surface batch errors.
 */
export function useH3VideoPlan({ appSettings, screenplayBlocks, refBindings, refImages, setAIState }: {
  appSettings: AppSettings;
  screenplayBlocks: ScriptBlock[];
  refBindings: RefBindings;
  refImages: RefImage[];
  setAIState: React.Dispatch<React.SetStateAction<AIState>>;
}) {
  // MiniMax H3 generation tasks (white-model submission pipeline)
  const [h3Tasks, setH3Tasks] = useState<H3Task[]>(() => {
    try {
      const raw = localStorage.getItem('h3_tasks');
      return raw ? (JSON.parse(raw) as H3Task[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('h3_tasks', JSON.stringify(h3Tasks.slice(0, 50))); } catch { /* ignore */ }
  }, [h3Tasks]);
  // Per-segment H3 submission progress for the VIDEO_PLAN batch button.
  const [planH3Progress, setPlanH3Progress] = useState<{ current: number; total: number } | null>(null);
  // VIDEO_PLAN knobs: which CN model renders, and the per-segment window.
  // The window is BOTH the planner grouping target and the submitted
  // duration cap — one knob, no drift between plan and submission.
  const [videoPlanModelId, setVideoPlanModelId] = useState(MINIMAX_VIDEO_MODELS[0].id);
  const videoPlanModel = MINIMAX_VIDEO_MODELS.find(m => m.id === videoPlanModelId) ?? MINIMAX_VIDEO_MODELS[0];
  const [videoPlanDuration, setVideoPlanDuration] = useState(10);
  const [planResolution, setPlanResolution] = useState<'480P' | '768P' | '2K'>('768P');
  // The live plan (replaces the old window stash — state is reactive and dies
  // with the script, so a stale plan can never cross-submit into another one).
  const [videoPlan, setVideoPlan] = useState<VideoPlan | null>(null);
  // Live H3 tasks belonging to the current plan's chain — rendered in the
  // modal so simple-mode users see progress WITHOUT opening the graybox 3D
  // view (where task lists used to live, invisible in simple mode).
  const planChainId = videoPlan ? `videoplan-${videoPlan.segments[0].blockIds[0]}` : null;
  const planTasks = useMemo(() => {
    if (!planChainId) return [];
    // Collapse history: every submit attempt creates new records with the
    // same chainId — show ONLY the newest task per segment.
    const newest = new Map<number, H3Task>();
    for (const t of h3Tasks) {
      if (t.chainId !== planChainId) continue;
      const k = t.segmentIndex ?? 0;
      const cur = newest.get(k);
      if (!cur || t.createdAt > cur.createdAt) newest.set(k, t);
    }
    return [...newest.values()].sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
  }, [h3Tasks, planChainId]);

  // Pre-flight scan: which cast members of each segment have bound sheets.
  // Recomputed whenever bindings/images change, so the checklist in the modal
  // is always current at the moment the user reads it.
  const planPreflight = useMemo(() => {
    if (!videoPlan) return null;
    return videoPlan.segments.map((seg, i) => {
      const refs = resolveSegmentRefs(seg, screenplayBlocks, refBindings, refImages);
      const seconds = clampSegmentSeconds(seg.duration, videoPlanModel.min, videoPlanDuration);
      return {
        index: i + 1,
        seconds,
        span: Math.round(seg.duration * 10) / 10,
        beatCount: seg.beats.length,
        characters: refs.bound,
        missing: refs.missing,
        offScreen: refs.offScreen,
        sceneEnv: refs.sceneEnv,
        cost: estimateH3Cost({
          outputSeconds: seconds,
          imageCount: refs.bound.length,
          resolution: planResolution,
          model: videoPlanModel.id,
        }),
      };
    });
  }, [videoPlan, screenplayBlocks, refBindings, refImages, videoPlanModel, videoPlanDuration, planResolution]);
  const planCostTotal = useMemo(
    () => (planPreflight ?? []).reduce((a, s) => a + s.cost, 0),
    [planPreflight],
  );

  // ---- MiniMax H3 submission (white-model → generated video, BYOK) --------
  const h3Ready = !!appSettings.minimaxApiKey.trim();

  /** Submit a recorded white-model video to H3. The view records first, then
   *  hands the blob here; this owns IO, keys, and the task record. */
  const handleSubmitH3 = useCallback(async (payload: {
    blockId: string;
    blockContent: string;
    /** White-model reference video. ABSENT in simple mode: H3 generates
     *  text-to-video conditioned only on prompt + character reference images. */
    videoBlob?: Blob;
    videoSeconds?: number;
    prompt: string;
    resolution: '480P' | '768P' | '2K';
    outputSeconds: number;
    model?: string;
    referenceImageUrls: string[];
    targetSeconds?: number;
    segmentIndex?: number;
    segmentCount?: number;
    chainId?: string;
  }): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> => {
    if (!appSettings.minimaxApiKey.trim()) {
      return { ok: false, error: '未配置 MiniMax API Key——请在 Settings → 视频生成中填写。' };
    }
    // resolve bound reference images (object URLs → blobs)
    const images: H3ReferenceImage[] = [];
    for (const url of payload.referenceImageUrls.slice(0, 9)) {
      try {
        const blob = await (await fetch(url)).blob();
        images.push({ name: `ref-${images.length + 1}`, blob });
      } catch { /* skip unreadable */ }
    }
    // Self-hosted ComfyUI (R2V): the white-model recording becomes <Video 1>
    // (motion/staging/timing reference), the bound sheets ride as <Picture N>.
    // Replaces the paid API reference-video path entirely on this backend.
    if (appSettings.videoBackend === 'comfy') {
      const graphJson = appSettings.comfyWorkflowR2V;
      if (!appSettings.comfyServerUrl.trim() || !graphJson.trim()) {
        return { ok: false, error: 'ComfyUI 未配置——请在 Settings → AI 填写服务器地址并导入 R2V 工作流。' };
      }
      const comfyCfg = { serverUrl: appSettings.comfyServerUrl };
      try {
        const refNames: string[] = [];
        for (let i = 0; i < images.length; i++) {
          refNames.push(await comfyUploadImage(comfyCfg, images[i].blob, `sf-ref-${Date.now()}-${i}.png`));
        }
        let videoName: string | undefined;
        if (payload.videoBlob) {
          videoName = await comfyUploadImage(comfyCfg, payload.videoBlob, `sf-white-${Date.now()}.mp4`);
        }
        const tags = [
          ...images.map((_, i) => `<Picture ${i + 1}> is a design/scene reference — preserve the identity and background shown in it.`),
          ...(videoName ? ['<Video 1> is the white-model motion reference — follow its staging, camera move and timing exactly.'] : []),
        ];
        const comfyPrompt = `${payload.prompt}\n\nReference materials:\n${tags.join('\n')}`;
        const graph = comfyPatchWorkflow(graphJson, {
          prompt: comfyPrompt,
          refImageNames: refNames,
          refVideoNames: videoName ? [videoName] : undefined,
        });
        const promptId = await comfyQueuePrompt(comfyCfg, graph);
        const localId = generateId();
        setH3Tasks(prev => [{
          id: localId,
          taskId: promptId,
          blockId: payload.blockId,
          blockContent: payload.blockContent.slice(0, 60),
          status: 'queued',
          prompt: payload.prompt,
          resolution: payload.resolution,
          videoSeconds: payload.videoSeconds ?? 0,
          outputSeconds: payload.outputSeconds,
          estimatedCost: 0, // self-hosted GPU — no API billing
          targetSeconds: payload.targetSeconds,
          segmentIndex: payload.segmentIndex,
          segmentCount: payload.segmentCount,
          chainId: payload.chainId,
          backend: 'comfy',
          createdAt: Date.now(),
        }, ...prev]);
        shipLog('flow', 'info', `COMFY white-model task queued: ${promptId} (refs=${refNames.length}, video=${videoName ? 'yes' : 'no'})`);
        return { ok: true, taskId: promptId };
      } catch (e) {
        const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
        shipLog('flow', 'error', `COMFY submit FAILED: ${msg}`);
        return { ok: false, error: msg.slice(0, 250) };
      }
    }

    const invalid = validateH3Submission({
      prompt: payload.prompt,
      videoBlob: payload.videoBlob,
      videoSeconds: payload.videoSeconds,
      referenceImages: images,
      resolution: payload.resolution,
      outputSeconds: payload.outputSeconds,
    });
    if (invalid) return { ok: false, error: invalid };

    const localId = generateId();
    const estimatedCost = estimateH3Cost({
      videoSeconds: payload.videoSeconds,
      outputSeconds: payload.outputSeconds,
      imageCount: images.length,
      resolution: payload.resolution,
      model: payload.model,
    });
    const baseTask: H3Task = {
      id: localId,
      blockId: payload.blockId,
      blockContent: payload.blockContent.slice(0, 60),
      status: 'uploading',
      prompt: payload.prompt,
      resolution: payload.resolution,
      videoSeconds: payload.videoSeconds,
      outputSeconds: payload.outputSeconds,
      ...(payload.targetSeconds != null ? { targetSeconds: payload.targetSeconds } : {}),
      ...(payload.segmentIndex != null ? { segmentIndex: payload.segmentIndex } : {}),
      ...(payload.segmentCount != null ? { segmentCount: payload.segmentCount } : {}),
      ...(payload.chainId ? { chainId: payload.chainId } : {}),
      estimatedCost,
      createdAt: Date.now(),
    };
    setH3Tasks(prev => [baseTask, ...prev].slice(0, 50));

    const cfg = { apiKey: appSettings.minimaxApiKey.trim(), baseUrl: appSettings.minimaxBaseUrl };
    try {
      setH3Tasks(prev => prev.map(t => t.id === localId ? { ...t, status: 'submitting' } : t));
      // Simple mode: no white-model video — H3 generates text-to-video
      // conditioned on prompt + character reference images only.
      const fileUri = payload.videoBlob ? await uploadH3Video(cfg, payload.videoBlob) : undefined;
      const taskId = await createH3Task(cfg, {
        prompt: payload.prompt,
        videoBlob: payload.videoBlob,
        videoSeconds: payload.videoSeconds,
        referenceImages: images,
        resolution: payload.resolution,
        outputSeconds: payload.outputSeconds,
        model: payload.model,
      }, fileUri);
      setH3Tasks(prev => prev.map(t => t.id === localId ? { ...t, taskId, status: 'queued' } : t));
      return { ok: true, taskId };
    } catch (e: any) {
      const msg = String(e?.message || e);
      setH3Tasks(prev => prev.map(t => t.id === localId ? { ...t, status: 'failed', error: msg } : t));
      return { ok: false, error: msg };
    }
  }, [appSettings.minimaxApiKey, appSettings.minimaxBaseUrl]);

  /** Submit every VIDEO_PLAN segment to H3 as text-to-video (simple mode):
   *  prompt = the segment's timed beats, references = bound character sheets,
   *  no white-model video. Sequential — H3 bills per task and the user reads
   *  progress one segment at a time. */
  const sceneEnvTag = (refs: { sceneEnv?: { name: string; url: string } }): string | null =>
    refs.sceneEnv ? '<Picture 1> is the scene/background reference — keep the desktop, sofa, lighting and composition exactly as shown.' : null;

  const submitPlanToH3 = useCallback(async () => {
    if (!videoPlan || !videoPlan.segments.length) {
      setAIState(prev => ({ ...prev, error: '没有可提交的视频分段计划——请先运行 视频分段。' }));
      return;
    }
    const plan = videoPlan;
    setPlanH3Progress({ current: 0, total: plan.segments.length });
    shipLog('flow', 'info', `H3 plan submission start: ${plan.segments.length} segments`);
    let okCount = 0;
    let firstErr: string | null = null;
    const chainId = `videoplan-${plan.segments[0].blockIds[0]}`;
    for (let si = 0; si < plan.segments.length; si++) {
      const seg = plan.segments[si];
      setPlanH3Progress({ current: si + 1, total: plan.segments.length });
      const refs = resolveSegmentRefs(seg, screenplayBlocks, refBindings, refImages);
      const prompt = buildSegmentVideoPrompt(seg, si + 1, plan.segments.length);
      shipLog('flow', 'info', `H3 segment ${si + 1}/${plan.segments.length}: refs=${refs.bound.length}${refs.missing.length ? ` missing=[${refs.missing.join(',')}]` : ''} prompt=${prompt.length}ch`);

      // ---- Self-hosted ComfyUI path (R2V with refs, else T2V) ----
      // Generation runs on the user's GPU box at near-zero marginal cost;
      // tasks reuse the H3Task record (backend: 'comfy') and the shared
      // poller branches on it.
      if (appSettings.videoBackend === 'comfy' && appSettings.comfyServerUrl.trim()) {
        const comfyCfg = { serverUrl: appSettings.comfyServerUrl };
        const hasT2V = !!appSettings.comfyWorkflowT2V.trim();
        const useR2V = refs.urls.length > 0 && !!appSettings.comfyWorkflowR2V.trim();
        const graphJson = useR2V ? appSettings.comfyWorkflowR2V : appSettings.comfyWorkflowT2V;
        if (!graphJson.trim()) {
          const need = refs.urls.length ? 'R2V（有参考图）' : 'T2V（纯文生图）';
          setPlanH3Progress(null);
          setAIState(prev => ({ ...prev, error: `ComfyUI 缺少${need}工作流——请在 Settings → AI 里导入对应 API 格式 JSON。` }));
          return;
        }
        setPlanH3Progress({ current: si + 1, total: plan.segments.length });
        shipLog('flow', 'info', `COMFY segment ${si + 1}/${plan.segments.length}: ${useR2V ? 'R2V' : 'T2V'} refs=${refs.urls.length} prompt=${prompt.length}ch`);
        try {
          // R2V prompts must reference the materials by tag (pack contract):
          // <Picture 1> = scene env, <Picture N> = each cast sheet in order.
          const refNames: string[] = [];
          for (let ri = 0; ri < refs.urls.length; ri++) {
            const blob = await (await fetch(refs.urls[ri])).blob();
            refNames.push(await comfyUploadImage(comfyCfg, blob, `sf-seg${si + 1}-${ri}.png`));
          }
          const tagLines = [
            ...(sceneEnvTag(refs) ? [sceneEnvTag(refs)!] : []),
            ...refs.bound.map((c, i) => `<Picture ${(sceneEnvTag(refs) ? 1 : 0) + i + 2}> is the design sheet of ${c.name} — the character's identity and face must come from it.`),
          ];
          const comfyPrompt = tagLines.length
            ? `${prompt}\n\nReference materials:\n${tagLines.join('\n')}`
            : prompt;
          const graph = comfyPatchWorkflow(graphJson, { prompt: comfyPrompt, refImageNames: refNames, stripFirstFrame: refs.urls.length === 0 });
          const promptId = await comfyQueuePrompt(comfyCfg, graph);
          shipLog('flow', 'info', `COMFY segment ${si + 1}: queued ${promptId}`);
          const localId = generateId();
          setH3Tasks(prev => [{
            id: localId,
            taskId: promptId,
            blockId: seg.blockIds[0],
            blockContent: (seg.beats[0]?.text ?? seg.sceneHeading).slice(0, 60),
            status: 'queued',
            prompt,
            resolution: planResolution,
            videoSeconds: 0,
            outputSeconds: clampSegmentSeconds(seg.duration, videoPlanModel.min, videoPlanDuration),
            estimatedCost: 0, // self-hosted GPU — no API billing
            segmentIndex: si + 1,
            segmentCount: plan.segments.length,
            chainId,
            backend: 'comfy',
            createdAt: Date.now(),
          }, ...prev]);
          okCount++;
          continue;
        } catch (e) {
          const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
          if (!firstErr) firstErr = msg;
          shipLog('flow', 'error', `COMFY segment ${si + 1} FAILED: ${msg}`);
          continue;
        }
      }
      // ---- MiniMax cloud API path (default) ----
      if (refs.missing.length) {
        shipLog('flow', 'warn', `H3 segment ${si + 1}: characters without sheets: ${refs.missing.join(', ')}`);
      }
      const submitRes = await handleSubmitH3({
        blockId: seg.blockIds[0],
        blockContent: seg.beats[0]?.text ?? seg.sceneHeading,
        prompt,
        resolution: planResolution,
        model: videoPlanModel.id,
        outputSeconds: clampSegmentSeconds(seg.duration, videoPlanModel.min, videoPlanDuration),
        referenceImageUrls: refs.urls,
        videoSeconds: 0, // text-to-video: no white-model input, cost = output only
        targetSeconds: Math.round(seg.duration),
        segmentIndex: si + 1,
        segmentCount: plan.segments.length,
        chainId,
      });
      // `in`-narrowing: this project runs without strictNullChecks, which
      // widens the `ok: true|false` literal discriminant and breaks boolean
      // narrowing — `'error' in` stays reliable under both configs.
      if ('error' in submitRes) {
        if (!firstErr) firstErr = submitRes.error;
        shipLog('flow', 'error', `H3 segment ${si + 1} FAILED: ${submitRes.error}`);
      } else {
        okCount++;
        shipLog('flow', 'info', `H3 segment ${si + 1}: task ${submitRes.taskId}`);
      }
    }
    setPlanH3Progress(null);
    if (firstErr) {
      setAIState(prev => ({ ...prev, error: `${plan.segments.length - okCount}/${plan.segments.length} 段提交失败——${firstErr}` }));
    } else {
      shipLog('flow', 'info', `H3 plan submission done: ${okCount}/${plan.segments.length} tasks created`);
    }
  }, [videoPlan, videoPlanModel, videoPlanDuration, planResolution, screenplayBlocks, refBindings, refImages, handleSubmitH3]);

  // Poll active tasks every 10s while the app is open (official cadence).
  const h3PollInFlight = useRef(false);
  useEffect(() => {
    // Failed tasks whose error was serialized as '[object Object]' get ONE
    // more query after the reason-extraction fix, to recover the real
    // server-side failure message.
    const staleErrors = h3Tasks.filter(t =>
      t.status === 'failed' && t.taskId && t.error?.includes('[object Object]'));
    const active = [
      ...h3Tasks.filter(t => (t.status === 'queued' || t.status === 'running') && t.taskId),
      ...staleErrors,
    ];
    if (!active.length || !h3Ready) return;
    const cfg = { apiKey: appSettings.minimaxApiKey.trim(), baseUrl: appSettings.minimaxBaseUrl };
    const timer = window.setInterval(async () => {
      if (h3PollInFlight.current) return;
      h3PollInFlight.current = true;
      try {
        for (const t of active) {
          // stale guard: give up after 30 minutes
          if (Date.now() - t.createdAt > 30 * 60 * 1000) {
            setH3Tasks(prev => prev.map(x => x.id === t.id ? { ...x, status: 'failed', error: '轮询超时（30 分钟）——任务可能仍在 MiniMax 控制台完成，可手动查看。' } : x));
            continue;
          }
          try {
            const s = t.backend === 'comfy'
              ? await comfyQueryTask({ serverUrl: appSettings.comfyServerUrl }, t.taskId!)
              : await queryH3Task(cfg, t.taskId!);
            setH3Tasks(prev => prev.map(x => x.id === t.id
              ? {
                  ...x,
                  status: x.status === 'failed' ? 'failed' as const
                    : s.status === 'cancelled' ? 'failed' as const : s.status,
                  resultUrl: s.videoUrl ?? x.resultUrl,
                  error: s.errorMessage || (s.status === 'cancelled' ? '任务已取消' : x.error),
                }
              : x));
          } catch { /* transient network error — retry next tick */ }
        }
      } finally {
        h3PollInFlight.current = false;
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [h3Tasks, h3Ready, appSettings.minimaxApiKey, appSettings.minimaxBaseUrl, appSettings.videoBackend, appSettings.comfyServerUrl]);

  return {
    h3Tasks, setH3Tasks,
    planH3Progress,
    videoPlanModelId, setVideoPlanModelId, videoPlanModel,
    videoPlanDuration, setVideoPlanDuration,
    planResolution, setPlanResolution,
    videoPlan, setVideoPlan,
    planChainId, planTasks, planPreflight, planCostTotal,
    h3Ready,
    handleSubmitH3,
    submitPlanToH3,
  };
}
