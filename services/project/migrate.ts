/**
 * Project adoption — bring in-memory (localStorage-era) work under a directory
 * as a complete project scaffold. Pure builders here; projectStore writes the
 * bytes. Used when the user opens a folder that has no story.sfstory yet
 * ("打开项目文件夹" on an empty folder = initialize it from the current script).
 */
import type { ColorSettings, Screenplay, StyleHead, BlockType } from '../../types';
import {
  DEFAULT_RUN_NAME,
  type RunFileData,
  type StyleFileData,
  runFileName,
  serializeRunFile,
  serializeStoryFile,
  serializeStyleFile,
} from './files';

export const buildStyleFileData = (
  styleHead: StyleHead | null | undefined,
  colorSettings: Partial<Record<BlockType, string>> | null | undefined,
): StyleFileData => ({
  styleHead: styleHead ?? null,
  colorSettings: colorSettings ?? null,
  promptOverrides: null,
});

export const buildDefaultRun = (name: string = DEFAULT_RUN_NAME): RunFileData => ({
  name,
  createdAt: Date.now(),
  selection: { kind: 'all' },
  candidates: [],
  satisfactions: [],
});

/** name → file content, ready for projectStore to write. */
export interface ProjectScaffold {
  story: string;
  style: string;
  runs: Record<string, string>;
}

export const buildProjectScaffold = (
  screenplay: Screenplay,
  opts?: { styleHead?: StyleHead | null; colorSettings?: ColorSettings | null },
): ProjectScaffold => {
  const run = buildDefaultRun();
  return {
    story: serializeStoryFile(screenplay),
    style: serializeStyleFile(buildStyleFileData(opts?.styleHead, opts?.colorSettings)),
    runs: { [runFileName(run.name)]: serializeRunFile(run) },
  };
};
