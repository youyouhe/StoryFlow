/**
 * Project directory store — the P1 file-backed project
 * (docs/storyflow-adoption-plan.md).
 *
 * The "backend" is a folder on the user's own disk, picked through the File
 * System Access API (same gate as the asset dir in assetDirStore.ts — Chrome/
 * Edge in a secure context; elsewhere callers show the projectUnavailable
 * message and localStorage remains the only store).
 *
 * Directory layout:
 *   <project-dir>/
 *     story.sfstory        ← content (Screenplay)
 *     style.sfstyle        ← style (StyleHead + colors + prompt overrides)
 *     runs/<name>.sfrun    ← intent (one file per deliberate run)
 *
 * The chosen directory handle is persisted (IndexedDB, structured-clone) so a
 * reload re-opens the same project after a permission check. Tauri native fs
 * (tauri-plugin-fs) is the planned second backend; until it lands, the
 * desktop build uses the WebView's File System Access where available.
 */
import {
  isDirStoreAvailable,
  persistDirHandle,
  loadPersistedDirHandle,
  forgetDirHandle,
  queryDirPermission,
  requestDirPermission,
} from '../assetDirStore';
import type { ColorSettings, Screenplay, StyleHead } from '../../types';
import {
  RUNS_DIR,
  RUN_EXTENSION,
  STORY_FILE,
  STYLE_FILE,
  ProjectFileError,
  parseRunFile,
  parseStoryFile,
  parseStyleFile,
  runFileName,
  runNameFromFile,
  serializeRunFile,
  serializeStoryFile,
  serializeStyleFile,
  type RunFileData,
  type StyleFileData,
} from './files';
import { buildProjectScaffold, buildStyleFileData } from './migrate';
import { parseRuntimeProfile, serializeRuntimeProfile } from '../providers';
import type { RuntimeProfile } from '../providers';

const PROJECT_HANDLE_KEY = 'projectDir';

export { ProjectFileError, queryDirPermission, requestDirPermission };
export type { StyleFileData };

export const isProjectStoreAvailable = isDirStoreAvailable;

export const persistProjectDir = (h: FileSystemDirectoryHandle): Promise<void> =>
  persistDirHandle(h, PROJECT_HANDLE_KEY);

export const loadPersistedProjectDir = (): Promise<FileSystemDirectoryHandle | null> =>
  loadPersistedDirHandle(PROJECT_HANDLE_KEY);

export const forgetProjectDir = (): Promise<void> =>
  forgetDirHandle(PROJECT_HANDLE_KEY);

/** Must be called from a user gesture (button click). */
export const pickProjectDir = async (): Promise<FileSystemDirectoryHandle> => {
  if (!isProjectStoreAvailable()) {
    throw new ProjectFileError('This browser has no File System Access API');
  }
  return window.showDirectoryPicker!({ id: 'storyflow-project', mode: 'readwrite' });
};

// ---- low-level text I/O -----------------------------------------------------

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch {
    return null; // absent is the only quiet case; parse errors surface loudly
  }
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function runsDir(dir: FileSystemDirectoryHandle, create: boolean): Promise<FileSystemDirectoryHandle> {
  return dir.getDirectoryHandle(RUNS_DIR, { create });
}

// ---- typed reads/writes -----------------------------------------------------

export const loadStoryFile = async (dir: FileSystemDirectoryHandle): Promise<Screenplay | null> => {
  const text = await readText(dir, STORY_FILE);
  return text === null ? null : parseStoryFile(text).screenplay;
};

export const saveStoryFile = (dir: FileSystemDirectoryHandle, screenplay: Screenplay): Promise<void> =>
  writeText(dir, STORY_FILE, serializeStoryFile(screenplay));

export const loadStyleFile = async (dir: FileSystemDirectoryHandle): Promise<StyleFileData | null> => {
  const text = await readText(dir, STYLE_FILE);
  return text === null ? null : parseStyleFile(text);
};

export const saveStyleFile = (dir: FileSystemDirectoryHandle, style: StyleFileData): Promise<void> =>
  writeText(dir, STYLE_FILE, serializeStyleFile(style));

export const saveStyleBundle = (
  dir: FileSystemDirectoryHandle,
  styleHead: StyleHead | null | undefined,
  colorSettings: ColorSettings | null | undefined,
): Promise<void> =>
  saveStyleFile(dir, buildStyleFileData(styleHead, colorSettings));

export const listRunFiles = async (dir: FileSystemDirectoryHandle): Promise<string[]> => {
  try {
    const runs = await runsDir(dir, false);
    const names: string[] = [];
    for await (const entry of (runs as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }).values()) {
      if (entry.kind === 'file' && entry.name.endsWith(RUN_EXTENSION)) {
        names.push(runNameFromFile(entry.name));
      }
    }
    return names.sort();
  } catch {
    return [];
  }
};

export const loadRunFile = async (dir: FileSystemDirectoryHandle, name: string): Promise<RunFileData | null> => {
  const runs = await runsDir(dir, false).catch(() => null);
  if (!runs) return null;
  const text = await readText(runs, runFileName(name));
  return text === null ? null : parseRunFile(text);
};

export const saveRunFile = async (dir: FileSystemDirectoryHandle, run: RunFileData): Promise<void> => {
  const runs = await runsDir(dir, true);
  await writeText(runs, runFileName(run.name), serializeRunFile(run));
};

/** P5: plain project docs (BRIEF.md / TREATMENT.md / PROGRESS.md / FEEDBACK.json
 *  — files ARE the memory for the agent loop). */
export const readProjectText = (dir: FileSystemDirectoryHandle, name: string): Promise<string | null> =>
  readText(dir, name);

export const writeProjectText = (dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> =>
  writeText(dir, name, content);

export const RUNTIME_FILE_NAME = 'storyflow.runtime.json';

/** P4: the project's service selection (endpoints + credential refs + bindings). */
export const loadRuntimeProfile = async (dir: FileSystemDirectoryHandle): Promise<RuntimeProfile | null> => {
  const text = await readText(dir, RUNTIME_FILE_NAME);
  return text === null ? null : parseRuntimeProfile(text);
};

export const saveRuntimeProfile = (dir: FileSystemDirectoryHandle, profile: RuntimeProfile): Promise<void> =>
  writeText(dir, RUNTIME_FILE_NAME, serializeRuntimeProfile(profile));

export interface OpenedProject {
  screenplay: Screenplay;
  /** true = the folder had no story file and was initialized from `current`. */
  created: boolean;
}

/**
 * Open a directory for editing. With an existing story.sfstory the directory
 * wins (it is the truth); without one the current in-memory work is written in
 * as a full scaffold (story + style + default run) — the localStorage → file
 * migration path.
 */
export const openProject = async (
  dir: FileSystemDirectoryHandle,
  current: Screenplay,
  styleHead?: StyleHead | null,
  colorSettings?: ColorSettings | null,
): Promise<OpenedProject> => {
  const existing = await loadStoryFile(dir);
  if (existing) return { screenplay: existing, created: false };

  const scaffold = buildProjectScaffold(current, { styleHead, colorSettings });
  await writeText(dir, STORY_FILE, scaffold.story);
  await writeText(dir, STYLE_FILE, scaffold.style);
  const runs = await runsDir(dir, true);
  for (const [name, content] of Object.entries(scaffold.runs)) {
    await writeText(runs, name, content);
  }
  return { screenplay: current, created: true };
};
