/**
 * 视觉执行器 —— VisualCallPlan → 真提交/轮询/收集(docs/storyflow-ir-p3.md §2.2)。
 *
 * 全 IO 只经 `deps.ports`(wiring.ts 绑真身,测试注 mock);参数打包复用 P2
 * 桥映射,不重复实现。严格按 `planCallSequence` 顺序执行(对齐 live
 * submitPlanToH3「Sequential — H3 bills per task」);needs 未成功 → skipped;
 * 失败/超时如实上报,不隐式重试(重试 = 调用方新调用,reroll)。
 *
 * 首帧交接:image job 的 resultBlob 进交接表,i2v 以 `firstFrame.fromJobId`
 * 取用(回退 `firstFrameBlob(assetId)`)——即 express 路「首帧 → I2V」的运行时形态。
 */
import type { ImageJob, VideoJob, VisualCallPlan, RefSlot } from '../ir/visual/types';
import {
  mapImageJobToGenerateImages, mapVideoJobToComfy, mapVideoJobToH3,
  planCallSequence,
} from '../bridge/visual';
import type { ImageCallRuntime, ResolvedRef } from '../bridge/types';
import type {
  ExecOptions, JobRunResult, VisualExecDeps, VisualRunResult,
} from './types';
import type { CallStep } from '../bridge/types';
import { pollUntil, errMsg, type Terminal } from './poll';
import { checkBudgetGate, BudgetExceededError } from './budget';

/** Terminal(url/error) → JobRunResult(resultUrl/error) 字段名对齐。 */
const toRunResult = (t: Terminal): Omit<JobRunResult, 'jobId' | 'shotId'> => ({
  status: t.status,
  ...(t.url != null ? { resultUrl: t.url } : {}),
  ...(t.error != null ? { error: t.error } : {}),
});

const resolveRefs = (
  slots: RefSlot[],
  refBlob: (refId: string) => Blob | undefined,
): ResolvedRef[] =>
  slots.flatMap(s => {
    const blob = refBlob(s.refId);
    return blob ? [{ refId: s.refId, name: s.name, blob }] : [];
  });

const runImageJob = async (
  job: ImageJob,
  deps: VisualExecDeps,
  opts: ExecOptions,
): Promise<{ result: Omit<JobRunResult, 'jobId' | 'shotId'>; blob?: Blob }> => {
  const imageRt: ImageCallRuntime = {
    provider: deps.image?.provider ?? 'minimax',
    apiKey: deps.minimax.apiKey,
    baseUrl: deps.minimax.baseUrl,
    ...(deps.image?.falKey != null ? { falKey: deps.image.falKey } : {}),
    ...(deps.image?.falModel != null ? { falModel: deps.image.falModel } : {}),
    ...(deps.image?.falQuality != null ? { falQuality: deps.image.falQuality } : {}),
    ...(deps.image?.aspectRatio != null ? { aspectRatio: deps.image.aspectRatio } : {}),
    refs: resolveRefs(job.materials.slots, deps.refBlob),
  };
  const call = mapImageJobToGenerateImages(job, imageRt);
  const images = await deps.ports.generateImages(call.cfg, call.prompt, call.opts);
  const img = images[0];
  if (!img) return { result: { status: 'failed', error: '生图服务没有返回图片' } };
  return { result: { status: 'succeeded', resultBlob: img.blob, resultUrl: img.url }, blob: img.blob };
};

const runComfyVideoJob = async (
  job: VideoJob,
  deps: VisualExecDeps,
  opts: ExecOptions,
  frameByJob: Map<string, Blob>,
): Promise<Omit<JobRunResult, 'jobId' | 'shotId'>> => {
  if (!deps.comfy) throw new Error('comfy 未配置(serverUrl/graphJsonOf)');
  const cfg = { serverUrl: deps.comfy.serverUrl };

  // 槽图逐个上传(无资产槽过滤——映射层同口径;tag 编号在映射层重编)
  const uploadedRefNames: { refId: string; name: string }[] = [];
  for (const slot of job.materials.slots) {
    const blob = deps.refBlob(slot.refId);
    if (!blob) continue;
    uploadedRefNames.push({
      refId: slot.refId,
      name: await deps.ports.comfyUploadImage(cfg, blob, `sf-${job.jobId}-ref-${slot.index}.png`),
    });
  }

  let uploadedFirstFrameName: string | undefined;
  if (job.path === 'i2v') {
    const fromJob = job.firstFrame?.fromJobId ? frameByJob.get(job.firstFrame.fromJobId) : undefined;
    const blob = fromJob ?? (job.firstFrame?.assetId ? deps.firstFrameBlob?.(job.firstFrame.assetId) : undefined);
    if (!blob) throw new Error('i2v 首帧缺失(image 产物与资产回退都不可用)');
    uploadedFirstFrameName = await deps.ports.comfyUploadImage(cfg, blob, `sf-${job.jobId}-frame.png`);
  }

  let uploadedVideoName: string | undefined;
  if (job.path === 'r2v') {
    if (!deps.whiteModel) throw new Error('r2v 缺白模注入');
    uploadedVideoName = await deps.ports.comfyUploadImage(cfg, deps.whiteModel.blob, `sf-${job.jobId}-wm.mp4`);
  }

  const call = mapVideoJobToComfy(job, {
    serverUrl: deps.comfy.serverUrl,
    graphJson: deps.comfy.graphJsonOf(job.path),
    uploadedRefNames,
    ...(uploadedFirstFrameName ? { uploadedFirstFrameName } : {}),
    ...(uploadedVideoName ? { uploadedVideoName } : {}),
  });
  const graph = deps.ports.comfyPatchWorkflow(call.graphJson, call.patch);
  const promptId = await deps.ports.comfyQueuePrompt(call.cfg, graph);
  return toRunResult(await pollUntil(() => deps.ports.comfyQueryTask(call.cfg, promptId), opts, { jobId: job.jobId, shotId: job.shotId }));
};

const runH3VideoJob = async (
  job: VideoJob,
  deps: VisualExecDeps,
  opts: ExecOptions,
): Promise<Omit<JobRunResult, 'jobId' | 'shotId'>> => {
  const cfg = { apiKey: deps.minimax.apiKey, baseUrl: deps.minimax.baseUrl };

  // r2v:白模先上传拿 fileUri(H3 时序 §3.2)
  let fileUri: string | undefined;
  let whiteModel: { blob: Blob; seconds: number; fileUri?: string } | undefined;
  if (job.path === 'r2v') {
    if (!deps.whiteModel) throw new Error('r2v 缺白模注入');
    fileUri = await deps.ports.uploadH3Video(cfg, deps.whiteModel.blob);
    whiteModel = { ...deps.whiteModel, ...(fileUri ? { fileUri } : {}) };
  }

  const call = mapVideoJobToH3(job, {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    ...(whiteModel ? { whiteModel } : {}),
    refs: resolveRefs(job.materials.slots, deps.refBlob),
    ...(deps.resolution ? { resolution: deps.resolution } : {}),
    ...(deps.model != null ? { model: deps.model } : {}),
  });
  const taskId = await deps.ports.createH3Task(call.cfg, call.params, call.videoFileUri);
  return toRunResult(await pollUntil(() => deps.ports.queryH3Task(call.cfg, taskId), opts, { jobId: job.jobId, shotId: job.shotId }));
};

/** needs 依赖波次(level = 1+max(needs);同波互不依赖 = chain 链元/不同镜头)。 */
const waveLevels = (steps: CallStep[]): CallStep[][] => {
  const levelOf = new Map<string, number>();
  const levels: CallStep[][] = [];
  for (const step of steps) {
    const needLevels = step.needs.map(n => levelOf.get(n) ?? 0);
    const level = needLevels.length ? Math.max(...needLevels) + 1 : 0;
    levelOf.set(step.jobId, level);
    (levels[level] ??= []).push(step);
  }
  return levels.filter(l => l != null);
};

/** 执行整个计划:预算闸门先发(超限零提交);concurrency 缺省 1 = 严格顺序
 *  (live 同口径,逐字节回归锁),>1 按依赖波次并发(needs 恒先满足;
 *  依赖失败 → skipped)。 */
export const executeVisualPlan = async (
  plan: VisualCallPlan,
  deps: VisualExecDeps,
  opts: ExecOptions = {},
): Promise<VisualRunResult> => {
  // P6 预算闸门:任何 port 调用之前(连 upload 都不发生)
  if (opts.budgetFen != null) {
    const gate = checkBudgetGate(plan, opts.budgetFen);
    if (!gate.ok) throw new BudgetExceededError(gate.totalCostFen, gate.budgetFen!);
  }

  const steps = planCallSequence(plan);
  const jobById = new Map<string, ImageJob | VideoJob>();
  for (const shot of plan.shots) {
    for (const job of shot.jobs) jobById.set(job.jobId, job);
  }
  const results = new Map<string, JobRunResult>();
  const frameByJob = new Map<string, Blob>();

  const settle = (jobId: string, shotId: string, r: Omit<JobRunResult, 'jobId' | 'shotId'>): void => {
    results.set(jobId, { jobId, shotId, ...r });
    opts.onProgress?.({ jobId, shotId, phase: r.status, detail: r.error });
  };

  const runStep = async (step: CallStep): Promise<void> => {
    const job = jobById.get(step.jobId);
    if (!job) return;
    const unmet = step.needs.find(n => results.get(n)?.status !== 'succeeded');
    if (unmet) {
      settle(step.jobId, job.shotId, { status: 'skipped', error: `依赖任务未完成: ${unmet}` });
      return;
    }
    if (step.call === 'unsupported') {
      settle(step.jobId, job.shotId, { status: 'skipped', error: step.reason ?? '无映射后端' });
      return;
    }
    opts.onProgress?.({ jobId: step.jobId, shotId: job.shotId, phase: 'submitting' });
    try {
      if (job.kind === 'image') {
        const r = await runImageJob(job, deps, opts);
        if (r.blob) frameByJob.set(job.jobId, r.blob);
        settle(step.jobId, job.shotId, r.result);
      } else if (step.call === 'comfyQueuePrompt') {
        settle(step.jobId, job.shotId, await runComfyVideoJob(job, deps, opts, frameByJob));
      } else {
        settle(step.jobId, job.shotId, await runH3VideoJob(job, deps, opts));
      }
    } catch (e) {
      settle(step.jobId, job.shotId, { status: 'failed', error: errMsg(e) });
    }
  };

  const limit = Math.max(1, Math.floor(opts.concurrency ?? 1));
  if (limit === 1) {
    for (const step of steps) await runStep(step);
  } else {
    for (const wave of waveLevels(steps)) {
      for (let i = 0; i < wave.length; i += limit) {
        await Promise.all(wave.slice(i, i + limit).map(runStep));
      }
    }
  }

  return { results: steps.map(s => results.get(s.jobId)).filter((r): r is JobRunResult => r != null) };
};
