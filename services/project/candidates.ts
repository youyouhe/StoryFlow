/**
 * Candidate editor helpers (Hypit 尾声 ②,issue #4) — the pure layer under the
 * CandidatesPanel UI.
 *
 * P3's build-record/satisfy protocol made reuse EXPLICIT in the run file
 * (`runs/*.sfrun`): zero-input Candidates backed by history (fromRun+output)
 * or files, and satisfy edges naming which Candidate answers which logical
 * output demand. Until now the only way to author them was hand-editing JSON.
 * These helpers + CandidatesPanel turn that into a surface — same protocol,
 * same files, zero new formats (Hypit 本体零改动).
 */
import {
  type RunCandidate,
  type RunFileData,
  type RunSatisfaction,
} from './files';
import type { ResultRecord } from './files';

/** One addressable output in the results repo — the pick-list source. */
export interface OutputAddress {
  runId: string;
  /** Logical output name, e.g. "video.b1" — the satisfy domain. */
  output: string;
  name: string;
  kind: string;
}

/** Flatten a result record into addressable outputs (ResultOutputRecord 的
 *  逻辑输出名就叫 `name`——satisfy 域与 freeze 的 demand.name 同域)。 */
export const outputsOf = (runId: string, record: ResultRecord): OutputAddress[] =>
  record.outputs.map(o => ({ runId, output: o.name, name: o.name, kind: o.kind }));

/** Build a history-backed Candidate from an output address. */
export const candidateFromOutput = (addr: OutputAddress): RunCandidate => ({
  id: `cand-${addr.runId}-${addr.output}`.replace(/[^\w.-]+/g, '_'),
  fromRun: addr.runId,
  output: addr.output,
});

/** True when two candidates answer the same address (dedupe in the picker). */
export const sameCandidateAddress = (a: RunCandidate, b: RunCandidate): boolean =>
  a.id === b.id
  || (a.fromRun != null && a.fromRun === b.fromRun && a.output != null && a.output === b.output);

// ---- immutable run-file editors --------------------------------------------

export const withCandidate = (run: RunFileData, cand: RunCandidate): RunFileData =>
  run.candidates.some(c => sameCandidateAddress(c, cand))
    ? run
    : { ...run, candidates: [...run.candidates, cand] };

export const withoutCandidate = (run: RunFileData, id: string): RunFileData => ({
  // dropping a candidate must drop its satisfy edges — dangling edges would
  // only ever produce warnings downstream (refuse, not clamp: remove here)
  ...run,
  candidates: run.candidates.filter(c => c.id !== id),
  satisfactions: run.satisfactions.filter(s => s.candidate !== id),
});

export const withSatisfaction = (run: RunFileData, output: string, candidate: string): RunFileData => {
  const edge: RunSatisfaction = { output, candidate };
  const rest = run.satisfactions.filter(s => s.output !== output);
  return { ...run, satisfactions: [...rest, edge] };
};

export const withoutSatisfaction = (run: RunFileData, output: string): RunFileData => ({
  ...run,
  satisfactions: run.satisfactions.filter(s => s.output !== output),
});

// ---- validation (warn, never skip — P3 semantics) ---------------------------

export interface CandidateValidation {
  /** satisfy edges naming candidates absent from the run file. */
  danglingSatisfactions: string[];
  /** history-backed candidates whose (fromRun, output) has no result record. */
  missingHistory: string[];
  /** duplicate ids (hand-edited files can collide). */
  duplicateIds: string[];
  ok: boolean;
}

export const validateRunCandidates = (
  run: RunFileData,
  /** fromRun → outputs actually present in the results repo. */
  availableOutputs: Map<string, Set<string>>,
): CandidateValidation => {
  const ids = new Set<string>();
  const duplicateIds: string[] = [];
  for (const c of run.candidates) {
    if (ids.has(c.id)) duplicateIds.push(c.id);
    ids.add(c.id);
  }
  const candidateIds = new Set(run.candidates.map(c => c.id));
  const danglingSatisfactions = run.satisfactions
    .filter(s => !candidateIds.has(s.candidate))
    .map(s => s.output);
  const missingHistory = run.candidates
    .filter(c => c.fromRun != null && c.output != null)
    .filter(c => !availableOutputs.get(c.fromRun!)?.has(c.output!))
    .map(c => c.id);
  return {
    danglingSatisfactions,
    missingHistory,
    duplicateIds,
    ok: danglingSatisfactions.length === 0 && missingHistory.length === 0 && duplicateIds.length === 0,
  };
};
