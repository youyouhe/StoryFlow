/**
 * Project file formats — content / style / intent
 * (P1 of docs/storyflow-adoption-plan.md).
 *
 * A StoryFlow project is a plain directory of three text formats:
 *
 *   story.sfstory    content  — the Screenplay (blocks + grayboxes + bindings)
 *   style.sfstyle    style    — visual DNA + color settings + prompt overrides
 *   runs/<name>.sfrun  intent — what to produce and what to reuse
 *
 * Every file is a JSON envelope `{ format, data }` with a stamped format id
 * (`storyflow.<kind>@1`). The envelope — not the domain types — carries the
 * version, so types.ts stays clean and future fields evolve without guessing.
 * Parsing is strict on the format id: a different major is refused by name
 * rather than silently misread.
 *
 * Pure module: no filesystem, no DOM. projectStore.ts does the I/O.
 */
import type { ColorSettings, Screenplay, StyleHead } from '../../types';

export const STORY_FORMAT = 'storyflow.story@1';
export const STYLE_FORMAT = 'storyflow.style@1';
export const RUN_FORMAT = 'storyflow.run@1';

export const STORY_FILE = 'story.sfstory';
export const STYLE_FILE = 'style.sfstyle';
export const RUNS_DIR = 'runs';
export const RUN_EXTENSION = '.sfrun';
export const DEFAULT_RUN_NAME = 'main';

/** Refusal of a project file: wrong shape, wrong format id, or broken JSON. */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

export interface StoryFileData {
  screenplay: Screenplay;
  /** Informational write stamp; screenplay.lastModified stays authoritative. */
  savedAt?: number;
}

export interface StyleFileData {
  styleHead: StyleHead | null;
  colorSettings: Partial<ColorSettings> | null;
  /** Prompt-template overrides keyed by kit id; defaults stay in constants.ts. */
  promptOverrides: Record<string, string> | null;
}

/** Which blocks a run covers. P1 keeps this minimal; P2 re-anchors it to words. */
export type RunSelection = { kind: 'all' } | { kind: 'blocks'; blockIds: string[] };

/** Reserved for P3's build-record/satisfy protocol — always empty in P1. */
export interface RunCandidate {
  id: string;
  fromRun?: string;
  output?: string;
  file?: string;
}

export interface RunFileData {
  name: string;
  createdAt: number;
  selection: RunSelection;
  productionMode?: Screenplay['productionMode'];
  candidates: RunCandidate[];
}

interface Envelope<D> {
  format: string;
  data: D;
}

const pretty = (envelope: Envelope<unknown>): string =>
  JSON.stringify(envelope, null, 2) + '\n';

function parseEnvelope(text: string, expectedFormat: string, fileLabel: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectFileError(`${fileLabel} is not valid JSON`);
  }
  const envelope = parsed as Partial<Envelope<unknown>>;
  if (!envelope || typeof envelope !== 'object' || typeof envelope.format !== 'string') {
    throw new ProjectFileError(`${fileLabel} has no "format" envelope — not a StoryFlow project file`);
  }
  if (envelope.format !== expectedFormat) {
    throw new ProjectFileError(
      `${fileLabel} has format "${envelope.format}"; this build understands "${expectedFormat}"`
    );
  }
  return envelope.data;
}

// ---- story.sfstory ----------------------------------------------------------

export const serializeStoryFile = (screenplay: Screenplay): string =>
  pretty({
    format: STORY_FORMAT,
    data: { screenplay, savedAt: Date.now() } satisfies StoryFileData,
  });

export const parseStoryFile = (text: string): StoryFileData => {
  const data = parseEnvelope(text, STORY_FORMAT, STORY_FILE) as Partial<StoryFileData> | null;
  const screenplay = data?.screenplay;
  if (
    !screenplay || typeof screenplay !== 'object' ||
    typeof screenplay.id !== 'string' || !Array.isArray(screenplay.blocks)
  ) {
    throw new ProjectFileError(`${STORY_FILE} has no screenplay with id + blocks`);
  }
  return { screenplay: screenplay as Screenplay, savedAt: typeof data?.savedAt === 'number' ? data.savedAt : undefined };
};

// ---- style.sfstyle ----------------------------------------------------------

export const serializeStyleFile = (style: StyleFileData): string =>
  pretty({ format: STYLE_FORMAT, data: style });

export const parseStyleFile = (text: string): StyleFileData => {
  const data = parseEnvelope(text, STYLE_FORMAT, STYLE_FILE) as Partial<StyleFileData> | null;
  return {
    styleHead: data?.styleHead ?? null,
    colorSettings: data?.colorSettings ?? null,
    promptOverrides: data?.promptOverrides ?? null,
  };
};

// ---- runs/<name>.sfrun ------------------------------------------------------

export const runFileName = (name: string): string =>
  (name.endsWith(RUN_EXTENSION) ? name : name + RUN_EXTENSION);

export const runNameFromFile = (fileName: string): string =>
  fileName.endsWith(RUN_EXTENSION) ? fileName.slice(0, -RUN_EXTENSION.length) : fileName;

export const serializeRunFile = (run: RunFileData): string =>
  pretty({ format: RUN_FORMAT, data: run });

export const parseRunFile = (text: string): RunFileData => {
  const data = parseEnvelope(text, RUN_FORMAT, 'run file') as Partial<RunFileData> | null;
  if (!data || typeof data.name !== 'string') {
    throw new ProjectFileError('run file has no name');
  }
  const selection = data.selection as RunSelection | undefined;
  if (!selection || (selection.kind !== 'all' && selection.kind !== 'blocks')) {
    throw new ProjectFileError(`run "${data.name}" has no valid selection`);
  }
  return {
    name: data.name,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    selection,
    productionMode: data.productionMode,
    candidates: Array.isArray(data.candidates) ? data.candidates : [],
  };
};
