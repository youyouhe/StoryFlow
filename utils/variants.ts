/**
 * Variant mass-production (P5b) — "1 workflow, 100 variants", StoryFlow's
 * half (docs/storyflow-adoption-plan.md).
 *
 * A variant is text substitution over a base screenplay (host name, product,
 * language…) with STABLE block ids — stability is what makes P3's explicit
 * reuse work: unchanged blocks keep byte-identical content, so their outputs
 * are satisfied from a shared run and only the changed blocks send paid
 * requests. The variant run file names those shared outputs as
 * build-record + satisfy edges, and two run files diff in git (A/B).
 */
import type { Screenplay } from '../types';
import type { RunCandidate, RunFileData, RunSatisfaction } from '../services/project/files';

export interface VariantSubstitution {
  from: string;
  to: string;
}

export interface VariantSpec {
  /** Run/variant name (e.g. 'swap-host-banana'). */
  name: string;
  substitutions: VariantSubstitution[];
}

const applySubstitutions = (text: string, subs: VariantSubstitution[]): string =>
  subs.reduce((acc, s) => (s.from ? acc.split(s.from).join(s.to) : acc), text);

/** One variant of a base screenplay. Block ids stay STABLE (reuse keys). */
export const applyVariant = (base: Screenplay, spec: VariantSpec): Screenplay => ({
  ...base,
  metadata: {
    ...base.metadata,
    title: applySubstitutions(base.metadata.title, spec.substitutions),
  },
  blocks: base.blocks.map(b => ({
    ...b,
    content: applySubstitutions(b.content, spec.substitutions),
  })),
});

/** Which blocks a variant changed vs its base (by content). */
export const changedBlockIds = (base: Screenplay, variant: Screenplay): string[] =>
  base.blocks
    .filter(b => {
      const v = variant.blocks.find(x => x.id === b.id);
      return !v || v.content !== b.content;
    })
    .map(b => b.id);

export interface SharedOutput {
  /** Logical output name (e.g. 'video.b1'). */
  name: string;
  /** Which recorded run owns the bytes. */
  fromRun: string;
  /** The output inside that run (defaults to name). */
  output?: string;
}

/**
 * A variant's run file: every unchanged output is a build-record candidate
 * with a satisfy edge (no regeneration), changed outputs simply have no edge
 * (they generate and bill normally).
 */
export const buildVariantRun = (opts: {
  name: string;
  createdAt?: number;
  shared: SharedOutput[];
}): RunFileData => {
  const candidates: RunCandidate[] = opts.shared.map(s => ({
    id: `kept-${s.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    fromRun: s.fromRun,
    output: s.output ?? s.name,
  }));
  const satisfactions: RunSatisfaction[] = opts.shared.map((s, i) => ({
    output: s.name,
    candidate: candidates[i].id,
  }));
  return {
    name: opts.name,
    createdAt: opts.createdAt ?? Date.now(),
    selection: { kind: 'all' },
    candidates,
    satisfactions,
  };
};
