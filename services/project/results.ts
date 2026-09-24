/**
 * Results repository — durable, addressable generation outputs
 * (P3 of docs/storyflow-adoption-plan.md).
 *
 * The address is `(runId, output)`, exactly as Hypit's `(build, output)`:
 *   <project-dir>/.storyflow/results/<runId>/result.json   outputs + receipts
 *   <project-dir>/.storyflow/results/<runId>/files/…       the bytes
 *   <project-dir>/.storyflow/results/<runId>/files/…       the bytes
 *
 * Directory backend (project open): full fidelity — bytes on disk survive
 * expired signed URLs, export by address works, forwards copy nothing.
 * Local backend (no project): receipts/history survive (the old h3_tasks
 * 50-cap is gone) but output bytes are session-ephemeral and flagged so.
 * Opening a project directory is how outputs become durable.
 */
import {
  newRunId,
  parseResultFile,
  resolveOutputRecord,
  serializeResultFile,
  type ResultOutputRecord,
  type ResultRecord,
  type ResultTaskReceipt,
} from './files';

const ROOT_DIR = '.storyflow';
const RESULTS_DIR = 'results';
const RESULT_JSON = 'result.json';
const FILES_DIR = 'files';
const LOCAL_INDEX_KEY = 'storyflow_results_index';

export interface ResultSummary {
  runId: string;
  runName: string;
  createdAt: number;
  status: ResultRecord['status'];
  outputCount: number;
  taskCount: number;
}

export interface ReadOutput {
  record: ResultOutputRecord;
  /** Null when bytes are absent (local-ephemeral or missing file). */
  blob: Blob | null;
}

export interface ResultsStore {
  readonly kind: 'directory' | 'local';
  /** Fresh run identity for one frozen-plan execution. */
  beginRun(runName: string, plan?: unknown): string;
  list(): Promise<ResultSummary[]>;
  get(runId: string): Promise<ResultRecord | null>;
  save(record: ResultRecord): Promise<void>;
  /** Persist output bytes (directory: files/, local: session-ephemeral). */
  writeOutput(
    runId: string,
    runName: string,
    name: string,
    kind: ResultOutputRecord['kind'],
    blob: Blob,
    meta?: Partial<Pick<ResultOutputRecord, 'blockId' | 'taskId' | 'service' | 'params' | 'prompt'>>,
  ): Promise<ResultOutputRecord>;
  /** Record a reuse edge without copying bytes (Hypit forwarding). */
  writeForward(runId: string, runName: string, name: string, forward: { runId: string; output: string }): Promise<void>;
  /** Record an external-file candidate (pre-approved bytes, referenced not copied). */
  writeExternal(runId: string, runName: string, name: string, externalFile: string): Promise<void>;
  addTaskReceipt(runId: string, runName: string, receipt: ResultTaskReceipt): Promise<void>;
  readOutput(runId: string, name: string): Promise<ReadOutput | null>;
  /** Browser download of one `(runId, output)` address. */
  exportOutput(runId: string, name: string): Promise<boolean>;
}

const sha256Hex = async (blob: Blob): Promise<string | undefined> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined; // non-secure context — record without hash
  }
};

const safeFileName = (name: string, blob: Blob): string => {
  const ext = blob.type.includes('mp4') ? 'mp4'
    : blob.type.includes('png') ? 'png'
    : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg'
    : blob.type.includes('json') ? 'json'
    : 'bin';
  return `${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const summarize = (record: ResultRecord): ResultSummary => ({
  runId: record.runId,
  runName: record.runName,
  createdAt: record.createdAt,
  status: record.status,
  outputCount: record.outputs.length,
  taskCount: record.tasks.length,
});

// ---------------------------------------------------------------------------
// Local backend — receipts/history durable, bytes session-ephemeral
// ---------------------------------------------------------------------------

class LocalResultsStore implements ResultsStore {
  readonly kind = 'local' as const;
  #bytes = new Map<string, Blob>(); // `${runId}#${name}` → session bytes

  #readIndex(): Record<string, ResultRecord> {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_INDEX_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  #writeIndex(index: Record<string, ResultRecord>): void {
    try {
      localStorage.setItem(LOCAL_INDEX_KEY, JSON.stringify(index));
    } catch { /* quota — history stays in memory for the session */ }
  }

  beginRun(runName: string, plan?: unknown): string {
    const runId = newRunId();
    const record: ResultRecord = {
      format: 'storyflow.result@1',
      runId, runName,
      createdAt: Date.now(),
      status: 'running',
      outputs: [], tasks: [], plan,
    };
    const index = this.#readIndex();
    index[runId] = record;
    this.#writeIndex(index);
    return runId;
  }

  async list(): Promise<ResultSummary[]> {
    return Object.values(this.#readIndex()).map(summarize).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(runId: string): Promise<ResultRecord | null> {
    return this.#readIndex()[runId] ?? null;
  }

  async save(record: ResultRecord): Promise<void> {
    const index = this.#readIndex();
    index[record.runId] = record;
    this.#writeIndex(index);
  }

  async writeOutput(runId: string, runName: string, name: string, kind: ResultOutputRecord['kind'], blob: Blob, meta?: Partial<ResultOutputRecord>): Promise<ResultOutputRecord> {
    const entry: ResultOutputRecord = {
      name, kind,
      bytes: blob.size,
      sha256: await sha256Hex(blob),
      createdAt: Date.now(),
      ...meta,
    };
    this.#bytes.set(`${runId}#${name}`, blob);
    await this.#upsert(runId, runName, record => ({ ...record, outputs: [...record.outputs.filter(o => o.name !== name), entry] }));
    return entry;
  }

  async writeForward(runId: string, runName: string, name: string, forward: { runId: string; output: string }): Promise<void> {
    const entry: ResultOutputRecord = { name, kind: 'video', forward, createdAt: Date.now() };
    await this.#upsert(runId, runName, record => ({ ...record, outputs: [...record.outputs.filter(o => o.name !== name), entry] }));
  }

  async writeExternal(runId: string, runName: string, name: string, externalFile: string): Promise<void> {
    const entry: ResultOutputRecord = { name, kind: 'video', externalFile, createdAt: Date.now() };
    await this.#upsert(runId, runName, record => ({ ...record, outputs: [...record.outputs.filter(o => o.name !== name), entry] }));
  }

  async addTaskReceipt(runId: string, runName: string, receipt: ResultTaskReceipt): Promise<void> {
    await this.#upsert(runId, runName, record => ({
      ...record,
      tasks: [...record.tasks.filter(t => t.id !== receipt.id), receipt],
    }));
  }

  async readOutput(runId: string, name: string): Promise<ReadOutput | null> {
    const index = this.#readIndex();
    const resolved = await resolveOutputRecord(id => index[id], runId, name);
    if (!resolved) return null;
    return { record: resolved.record, blob: this.#bytes.get(`${resolved.runId}#${resolved.name}`) ?? null };
  }

  async exportOutput(runId: string, name: string): Promise<boolean> {
    const out = await this.readOutput(runId, name);
    if (!out?.blob) return false;
    downloadBlob(out.blob, `${runId}-${name}`);
    return true;
  }

  async #upsert(runId: string, runName: string, fn: (record: ResultRecord) => ResultRecord): Promise<void> {
    const index = this.#readIndex();
    const current = index[runId] ?? {
      format: 'storyflow.result@1' as const,
      runId, runName,
      createdAt: Date.now(),
      status: 'running' as const,
      outputs: [], tasks: [],
    };
    index[runId] = fn(current);
    this.#writeIndex(index);
  }
}

// ---------------------------------------------------------------------------
// Directory backend — the project's .storyflow/results tree
// ---------------------------------------------------------------------------

async function readTextFile(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

async function writeTextFile(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

class DirectoryResultsStore implements ResultsStore {
  readonly kind = 'directory' as const;
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async #resultsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      const sf = await this.root.getDirectoryHandle(ROOT_DIR, { create });
      return await sf.getDirectoryHandle(RESULTS_DIR, { create });
    } catch {
      return null;
    }
  }

  async #runDir(runId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    const results = await this.#resultsDir(create);
    if (!results) return null;
    try {
      return await results.getDirectoryHandle(runId, { create });
    } catch {
      return null;
    }
  }

  beginRun(runName: string, plan?: unknown): string {
    const runId = newRunId();
    // fire the record write; callers await get/save around real work
    void this.save({
      format: 'storyflow.result@1',
      runId, runName,
      createdAt: Date.now(),
      status: 'running',
      outputs: [], tasks: [], plan,
    });
    return runId;
  }

  async list(): Promise<ResultSummary[]> {
    const results = await this.#resultsDir(false);
    if (!results) return [];
    const out: ResultSummary[] = [];
    for await (const entry of (results as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }).values()) {
      if (entry.kind !== 'directory') continue;
      const record = await this.get(entry.name);
      if (record) out.push(summarize(record));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(runId: string): Promise<ResultRecord | null> {
    const dir = await this.#runDir(runId, false);
    if (!dir) return null;
    const text = await readTextFile(dir, RESULT_JSON);
    return text ? parseResultFile(text) : null;
  }

  async save(record: ResultRecord): Promise<void> {
    const dir = await this.#runDir(record.runId, true);
    if (!dir) return;
    await writeTextFile(dir, RESULT_JSON, serializeResultFile(record));
  }

  async writeOutput(runId: string, runName: string, name: string, kind: ResultOutputRecord['kind'], blob: Blob, meta?: Partial<ResultOutputRecord>): Promise<ResultOutputRecord> {
    const runDir = await this.#runDir(runId, true);
    if (!runDir) throw new Error('结果目录不可写');
    const files = await runDir.getDirectoryHandle(FILES_DIR, { create: true });
    const fileName = safeFileName(name, blob);
    const handle = await files.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

    const entry: ResultOutputRecord = {
      name, kind,
      file: `${FILES_DIR}/${fileName}`,
      bytes: blob.size,
      sha256: await sha256Hex(blob),
      createdAt: Date.now(),
      ...meta,
    };
    await this.#upsert(runId, runName, record => ({
      ...record,
      outputs: [...record.outputs.filter(o => o.name !== name), entry],
    }));
    return entry;
  }

  async writeForward(runId: string, runName: string, name: string, forward: { runId: string; output: string }): Promise<void> {
    const entry: ResultOutputRecord = { name, kind: 'video', forward, createdAt: Date.now() };
    await this.#upsert(runId, runName, record => ({
      ...record,
      outputs: [...record.outputs.filter(o => o.name !== name), entry],
    }));
  }

  async writeExternal(runId: string, runName: string, name: string, externalFile: string): Promise<void> {
    const entry: ResultOutputRecord = { name, kind: 'video', externalFile, createdAt: Date.now() };
    await this.#upsert(runId, runName, record => ({
      ...record,
      outputs: [...record.outputs.filter(o => o.name !== name), entry],
    }));
  }

  async addTaskReceipt(runId: string, runName: string, receipt: ResultTaskReceipt): Promise<void> {
    await this.#upsert(runId, runName, record => ({
      ...record,
      tasks: [...record.tasks.filter(t => t.id !== receipt.id), receipt],
    }));
  }

  async readOutput(runId: string, name: string): Promise<ReadOutput | null> {
    const resolved = await resolveOutputRecord(id => this.get(id), runId, name);
    if (!resolved) return null;
    if (!resolved.record.file) return { record: resolved.record, blob: null };
    const runDir = await this.#runDir(resolved.runId, false);
    if (!runDir) return { record: resolved.record, blob: null };
    try {
      const files = await runDir.getDirectoryHandle(FILES_DIR, { create: false });
      const handle = await files.getFileHandle(resolved.record.file.split('/').pop()!);
      return { record: resolved.record, blob: await handle.getFile() };
    } catch {
      return { record: resolved.record, blob: null };
    }
  }

  async exportOutput(runId: string, name: string): Promise<boolean> {
    const out = await this.readOutput(runId, name);
    if (!out?.blob) return false;
    const fileName = out.record.file?.split('/').pop() ?? `${name}`;
    downloadBlob(out.blob, fileName);
    return true;
  }

  async #upsert(runId: string, runName: string, fn: (record: ResultRecord) => ResultRecord): Promise<void> {
    const current = (await this.get(runId)) ?? {
      format: 'storyflow.result@1' as const,
      runId, runName,
      createdAt: Date.now(),
      status: 'running' as const,
      outputs: [], tasks: [],
    };
    await this.save(fn(current));
  }
}

/** Project open → durable directory store; otherwise the local fallback. */
export const resultsStoreFor = (dir: FileSystemDirectoryHandle | null): ResultsStore =>
  dir ? new DirectoryResultsStore(dir) : new LocalResultsStore();
