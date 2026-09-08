/**
 * Gallery cloud API client (P1: auth + script sync).
 *
 * Two layers:
 *  - GalleryApi      raw transport. HttpGalleryApi talks to the real server
 *                    (contract below); MockGalleryApi simulates the cloud in
 *                    localStorage so the client can be built before the
 *                    backend exists.
 *  - GalleryClient   auth wrapper: persists the token pair (`gallery_auth`),
 *                    single-flight refresh on INVALID_TOKEN, and exposes
 *                    authenticated operations with no token plumbing.
 *
 * Server contract (P1):
 *   POST /auth/register|login|refresh|logout
 *   GET    /scripts                          → CloudScript[]
 *   POST   /scripts            {doc}         → {id, revision}      (Idempotency-Key header)
 *   PUT    /scripts/:id?ifMatch=N {doc}       → {revision} | 409 {error:{code,serverRevision}}
 *   GET    /scripts/:id                      → {script, doc, revision}
 *   DELETE /scripts/:id                      → 204
 * Errors: {error:{code, message, serverRevision?}}; success = JSON body.
 */
import { GalleryTokens, GalleryUser, Screenplay } from '../types';

export type GalleryErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'BAD_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'REVISION_CONFLICT'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'SERVER';

export class GalleryApiError extends Error {
  constructor(
    readonly code: GalleryErrorCode,
    message: string,
    readonly status = 0,
    /** Server's latest revision, present on REVISION_CONFLICT. */
    readonly serverRevision?: number
  ) {
    super(message);
    this.name = 'GalleryApiError';
  }
}

export const isGalleryApiError = (e: unknown): e is GalleryApiError => e instanceof GalleryApiError;

export type ScriptVisibility = 'private' | 'group' | 'public';

export interface CloudScript {
  id: string;
  title: string;
  visibility: ScriptVisibility;
  latestRevision: number;
  blockCount: number;
  updatedAt: number;
}

/** Public gallery feed card (P2). */
export interface GalleryCard extends CloudScript {
  templateId: string | null;
  ownerType: 'user' | 'group';
  ownerName: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  deviceName: string;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceName: string;
}

export interface AuthResult {
  user: GalleryUser;
  tokens: GalleryTokens;
}

export interface GalleryApi {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  logout(accessToken: string, refreshToken: string): Promise<void>;
  listScripts(accessToken: string): Promise<CloudScript[]>;
  createScript(accessToken: string, doc: Screenplay, idempotencyKey: string): Promise<{ id: string; revision: number }>;
  pushScript(accessToken: string, cloudId: string, ifMatch: number, doc: Screenplay): Promise<{ revision: number }>;
  getScript(accessToken: string, cloudId: string): Promise<{ script: CloudScript; doc: Screenplay; revision: number }>;
  deleteScript(accessToken: string, cloudId: string): Promise<void>;
  // ---- P2: gallery browse / fork / visibility / groups ----
  galleryList(accessToken: string, q?: string): Promise<GalleryCard[]>;
  galleryGet(accessToken: string, cloudId: string): Promise<{ script: GalleryCard; doc: Screenplay; revision: number }>;
  forkScript(accessToken: string, cloudId: string, idempotencyKey: string): Promise<{ id: string; revision: number; doc?: Screenplay }>;
  setVisibility(accessToken: string, cloudId: string, visibility: ScriptVisibility): Promise<{ visibility: ScriptVisibility }>;
  listGroups(accessToken: string): Promise<GroupInfo[]>;
  createGroup(accessToken: string, name: string): Promise<GroupInfo>;
  listGroupMembers(accessToken: string, groupId: string): Promise<GroupMember[]>;
  addGroupMember(accessToken: string, groupId: string, email: string): Promise<{ userId: string; role: string }>;
  removeGroupMember(accessToken: string, groupId: string, userId: string): Promise<void>;
}

export interface GroupInfo {
  id: string;
  name: string;
  slug?: string;
  role?: string;
  memberCount?: number;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  email: string;
  role: string;
}

// ── HTTP transport ─────────────────────────────────────────────────────────

const TIMEOUT_MS = 15000;

export class HttpGalleryApi implements GalleryApi {
  constructor(private baseUrl: string) {}

  private async req<T>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; idempotencyKey?: string } = {}
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {})
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch {
      throw new GalleryApiError('NETWORK', 'Network request failed');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body?.error ?? {}) as { code?: GalleryErrorCode; message?: string; serverRevision?: number };
      const fallback: GalleryErrorCode =
        res.status === 401 ? 'INVALID_TOKEN'
        : res.status === 404 ? 'NOT_FOUND'
        : res.status === 409 ? 'REVISION_CONFLICT'
        : res.status === 429 ? 'RATE_LIMITED'
        : 'SERVER';
      throw new GalleryApiError(err.code ?? fallback, err.message ?? res.statusText, res.status, err.serverRevision);
    }
    return body as T;
  }

  register(input: RegisterInput) {
    return this.req<AuthResult>('POST', '/auth/register', { body: input });
  }

  login(input: LoginInput) {
    return this.req<AuthResult>('POST', '/auth/login', { body: input });
  }

  refresh(refreshToken: string) {
    return this.req<AuthResult>('POST', '/auth/refresh', { body: { refreshToken } });
  }

  logout(accessToken: string, refreshToken: string) {
    return this.req<void>('POST', '/auth/logout', { token: accessToken, body: { refreshToken } });
  }

  listScripts(accessToken: string) {
    return this.req<CloudScript[]>('GET', '/scripts', { token: accessToken });
  }

  createScript(accessToken: string, doc: Screenplay, idempotencyKey: string) {
    return this.req<{ id: string; revision: number }>('POST', '/scripts', { token: accessToken, body: { doc }, idempotencyKey });
  }

  pushScript(accessToken: string, cloudId: string, ifMatch: number, doc: Screenplay) {
    return this.req<{ revision: number }>('PUT', `/scripts/${cloudId}?ifMatch=${ifMatch}`, { token: accessToken, body: { doc } });
  }

  getScript(accessToken: string, cloudId: string) {
    return this.req<{ script: CloudScript; doc: Screenplay; revision: number }>('GET', `/scripts/${cloudId}`, { token: accessToken });
  }

  deleteScript(accessToken: string, cloudId: string) {
    return this.req<void>('DELETE', `/scripts/${cloudId}`, { token: accessToken });
  }

  // ---- P2 ----

  galleryList(accessToken: string, q?: string) {
    return this.req<GalleryCard[]>('GET', `/gallery${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token: accessToken });
  }

  galleryGet(accessToken: string, cloudId: string) {
    return this.req<{ script: GalleryCard; doc: Screenplay; revision: number }>('GET', `/gallery/${cloudId}`, { token: accessToken });
  }

  forkScript(accessToken: string, cloudId: string, idempotencyKey: string) {
    return this.req<{ id: string; revision: number; doc?: Screenplay }>('POST', `/scripts/${cloudId}/fork`, { token: accessToken, idempotencyKey });
  }

  setVisibility(accessToken: string, cloudId: string, visibility: ScriptVisibility) {
    return this.req<{ visibility: ScriptVisibility }>('PATCH', `/scripts/${cloudId}`, { token: accessToken, body: { visibility } });
  }

  listGroups(accessToken: string) {
    return this.req<GroupInfo[]>('GET', '/groups', { token: accessToken });
  }

  createGroup(accessToken: string, name: string) {
    return this.req<GroupInfo>('POST', '/groups', { token: accessToken, body: { name } });
  }

  listGroupMembers(accessToken: string, groupId: string) {
    return this.req<GroupMember[]>('GET', `/groups/${groupId}/members`, { token: accessToken });
  }

  addGroupMember(accessToken: string, groupId: string, email: string) {
    return this.req<{ userId: string; role: string }>('POST', `/groups/${groupId}/members`, { token: accessToken, body: { email } });
  }

  removeGroupMember(accessToken: string, groupId: string, userId: string) {
    return this.req<void>('DELETE', `/groups/${groupId}/members/${userId}`, { token: accessToken });
  }
}

// ── Mock transport (localStorage "cloud" for pre-backend development) ──────

const MOCK_KEY = 'gallery_mock_cloud';

interface MockScript {
  id: string;
  ownerId: string;
  ownerType?: 'user' | 'group';
  title: string;
  visibility: ScriptVisibility;
  latestRevision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  versions: { revision: number; doc: Screenplay; blockCount: number; createdAt: number; idempotencyKey?: string }[];
}

interface MockCloud {
  users: Record<string, { id: string; email: string; displayName: string; password: string }>;
  refresh: Record<string, { userId: string }>;
  scripts: MockScript[];
  groups?: MockGroup[];
}

interface MockGroup {
  id: string;
  name: string;
  slug: string;
  /** userId → role */
  members: Record<string, string>;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const newId = () => crypto.randomUUID();

export class MockGalleryApi implements GalleryApi {
  /** Test hook: next push to this cloud id returns 409 (simulates another device). */
  simulateConflict: string | null = null;

  constructor(private opts: { latencyMs?: number; accessTtlMs?: number } = {}) {}

  private load(): MockCloud {
    try {
      const c = JSON.parse(localStorage.getItem(MOCK_KEY) || '') as MockCloud;
      if (!c.groups) c.groups = []; // pre-P2 persisted state
      return c;
    } catch {
      return { users: {}, refresh: {}, scripts: [], groups: [] };
    }
  }

  private save(c: MockCloud) {
    localStorage.setItem(MOCK_KEY, JSON.stringify(c));
  }

  private async lag() {
    if (this.opts.latencyMs) await sleep(this.opts.latencyMs);
  }

  private issueTokens(c: MockCloud, userId: string): GalleryTokens {
    const accessToken = `mock-access.${userId}.${Date.now() + (this.opts.accessTtlMs ?? 15 * 60_000)}`;
    const refreshToken = `mock-refresh.${newId()}`;
    c.refresh[refreshToken] = { userId };
    return { accessToken, refreshToken };
  }

  private userIdFromAccess(token: string): string {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'mock-access') {
      throw new GalleryApiError('INVALID_TOKEN', 'Malformed access token', 401);
    }
    if (Number(parts[2]) < Date.now()) {
      throw new GalleryApiError('INVALID_TOKEN', 'Access token expired', 401);
    }
    return parts[1];
  }

  private userFromAccess(c: MockCloud, token: string) {
    const userId = this.userIdFromAccess(token);
    const user = Object.values(c.users).find(u => u.id === userId);
    if (!user) throw new GalleryApiError('INVALID_TOKEN', 'Unknown user', 401);
    return user;
  }

  private latest(s: MockScript) {
    return s.versions[s.versions.length - 1];
  }

  private summary(s: MockScript): CloudScript {
    return {
      id: s.id,
      title: s.title,
      visibility: s.visibility,
      latestRevision: s.latestRevision,
      blockCount: this.latest(s).blockCount,
      updatedAt: s.updatedAt
    };
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    await this.lag();
    const c = this.load();
    if (c.users[input.email]) throw new GalleryApiError('EMAIL_TAKEN', 'Email already registered', 409);
    const user = { id: newId(), email: input.email, displayName: input.displayName, password: input.password };
    c.users[input.email] = user;
    const tokens = this.issueTokens(c, user.id);
    this.save(c);
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, tokens };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    await this.lag();
    const c = this.load();
    const user = c.users[input.email];
    if (!user || user.password !== input.password) {
      throw new GalleryApiError('BAD_CREDENTIALS', 'Invalid email or password', 401);
    }
    const tokens = this.issueTokens(c, user.id);
    this.save(c);
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, tokens };
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    await this.lag();
    const c = this.load();
    const entry = c.refresh[refreshToken];
    if (!entry) throw new GalleryApiError('INVALID_TOKEN', 'Unknown refresh token', 401);
    delete c.refresh[refreshToken]; // rotation: single use
    const user = Object.values(c.users).find(u => u.id === entry.userId);
    if (!user) throw new GalleryApiError('INVALID_TOKEN', 'Unknown user', 401);
    const tokens = this.issueTokens(c, user.id);
    this.save(c);
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, tokens };
  }

  async logout(accessToken: string, refreshToken: string): Promise<void> {
    await this.lag();
    const c = this.load();
    this.userFromAccess(c, accessToken);
    delete c.refresh[refreshToken];
    this.save(c);
  }

  async listScripts(accessToken: string): Promise<CloudScript[]> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    return c.scripts.filter(s => s.ownerId === user.id && !s.deletedAt).map(s => this.summary(s));
  }

  async createScript(accessToken: string, doc: Screenplay, idempotencyKey: string): Promise<{ id: string; revision: number }> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    // Idempotent retry: same key → same script.
    const existing = c.scripts.find(
      s => s.ownerId === user.id && s.versions.some(v => v.idempotencyKey === idempotencyKey)
    );
    if (existing) return { id: existing.id, revision: existing.latestRevision };
    const now = Date.now();
    const script: MockScript = {
      id: newId(),
      ownerId: user.id,
      title: doc.metadata.title,
      visibility: 'private',
      latestRevision: 1,
      createdAt: now,
      updatedAt: now,
      versions: [{ revision: 1, doc, blockCount: doc.blocks.length, createdAt: now, idempotencyKey }]
    };
    c.scripts.push(script);
    this.save(c);
    return { id: script.id, revision: 1 };
  }

  async pushScript(accessToken: string, cloudId: string, ifMatch: number, doc: Screenplay): Promise<{ revision: number }> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const s = c.scripts.find(x => x.id === cloudId && x.ownerId === user.id && !x.deletedAt);
    if (!s) throw new GalleryApiError('NOT_FOUND', 'Script not found', 404);
    if (this.simulateConflict === cloudId) {
      this.simulateConflict = null;
      throw new GalleryApiError('REVISION_CONFLICT', 'Revision mismatch', 409, s.latestRevision);
    }
    if (ifMatch !== s.latestRevision) {
      throw new GalleryApiError('REVISION_CONFLICT', `Expected ifMatch=${s.latestRevision}`, 409, s.latestRevision);
    }
    const revision = s.latestRevision + 1;
    s.versions.push({ revision, doc, blockCount: doc.blocks.length, createdAt: Date.now() });
    s.latestRevision = revision;
    s.title = doc.metadata.title;
    s.updatedAt = Date.now();
    this.save(c);
    return { revision };
  }

  async getScript(accessToken: string, cloudId: string): Promise<{ script: CloudScript; doc: Screenplay; revision: number }> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const s = c.scripts.find(x => x.id === cloudId && x.ownerId === user.id && !x.deletedAt);
    if (!s) throw new GalleryApiError('NOT_FOUND', 'Script not found', 404);
    const latest = this.latest(s);
    return { script: this.summary(s), doc: structuredClone(latest.doc), revision: latest.revision };
  }

  async deleteScript(accessToken: string, cloudId: string): Promise<void> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const s = c.scripts.find(x => x.id === cloudId && x.ownerId === user.id);
    if (!s) throw new GalleryApiError('NOT_FOUND', 'Script not found', 404);
    s.deletedAt = Date.now();
    this.save(c);
  }

  // ---- P2: gallery / fork / visibility / groups (mock) --------------------

  private ownerNameOf(c: MockCloud, s: MockScript): string {
    if (s.ownerType === 'group') {
      return c.groups?.find(g => g.id === s.ownerId)?.name ?? 'group';
    }
    return Object.values(c.users).find(u => u.id === s.ownerId)?.displayName ?? 'unknown';
  }

  private cardOf(c: MockCloud, s: MockScript): GalleryCard {
    return {
      id: s.id,
      title: s.title,
      visibility: s.visibility,
      latestRevision: s.latestRevision,
      blockCount: this.latest(s).blockCount,
      updatedAt: s.updatedAt,
      templateId: null,
      ownerType: s.ownerType ?? 'user',
      ownerName: this.ownerNameOf(c, s)
    };
  }

  async galleryList(accessToken: string, q?: string): Promise<GalleryCard[]> {
    await this.lag();
    const c = this.load();
    this.userFromAccess(c, accessToken);
    return c.scripts
      .filter(s => s.visibility === 'public' && !s.deletedAt && (!q || s.title.toLowerCase().includes(q.toLowerCase())))
      .map(s => this.cardOf(c, s));
  }

  async galleryGet(accessToken: string, cloudId: string): Promise<{ script: GalleryCard; doc: Screenplay; revision: number }> {
    await this.lag();
    const c = this.load();
    this.userFromAccess(c, accessToken);
    const s = c.scripts.find(x => x.id === cloudId && x.visibility === 'public' && !x.deletedAt);
    if (!s) throw new GalleryApiError('NOT_FOUND', 'Script not found', 404);
    const latest = this.latest(s);
    return { script: this.cardOf(c, s), doc: structuredClone(latest.doc), revision: latest.revision };
  }

  async forkScript(accessToken: string, cloudId: string, idempotencyKey: string): Promise<{ id: string; revision: number }> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const existing = c.scripts.find(
      s => s.ownerType !== 'group' && s.ownerId === user.id && s.versions.some(v => v.idempotencyKey === idempotencyKey)
    );
    if (existing) return { id: existing.id, revision: existing.latestRevision };
    const src = c.scripts.find(
      x => x.id === cloudId && !x.deletedAt
        && (x.visibility === 'public' || (x.ownerType !== 'group' && x.ownerId === user.id))
    );
    if (!src) throw new GalleryApiError('NOT_FOUND', 'Script not found', 404);
    const now = Date.now();
    const fork: MockScript = {
      id: newId(),
      ownerId: user.id,
      ownerType: 'user',
      title: `${src.title} (fork)`,
      visibility: 'private',
      latestRevision: 1,
      createdAt: now,
      updatedAt: now,
      versions: [{ revision: 1, doc: structuredClone(this.latest(src).doc), blockCount: this.latest(src).blockCount, createdAt: now, idempotencyKey }]
    };
    c.scripts.push(fork);
    this.save(c);
    return { id: fork.id, revision: 1 };
  }

  async setVisibility(accessToken: string, cloudId: string, visibility: ScriptVisibility): Promise<{ visibility: ScriptVisibility }> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const s = c.scripts.find(x => x.id === cloudId && x.ownerType !== 'group' && x.ownerId === user.id && !x.deletedAt);
    if (!s) throw new GalleryApiError('NOT_FOUND', 'Script not found', 404);
    s.visibility = visibility;
    this.save(c);
    return { visibility };
  }

  async listGroups(accessToken: string): Promise<GroupInfo[]> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    return (c.groups ?? [])
      .filter(g => g.members[user.id])
      .map(g => ({ id: g.id, name: g.name, slug: g.slug, role: g.members[user.id], memberCount: Object.keys(g.members).length }));
  }

  async createGroup(accessToken: string, name: string): Promise<GroupInfo> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    c.groups = c.groups ?? [];
    const g: MockGroup = {
      id: newId(),
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group',
      members: { [user.id]: 'owner' }
    };
    c.groups.push(g);
    this.save(c);
    return { id: g.id, name: g.name, slug: g.slug, role: 'owner', memberCount: 1 };
  }

  async listGroupMembers(accessToken: string, groupId: string): Promise<GroupMember[]> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const g = c.groups?.find(x => x.id === groupId && x.members[user.id]);
    if (!g) throw new GalleryApiError('NOT_FOUND', 'Group not found', 404);
    return Object.entries(g.members).map(([uid, role]) => {
      const u = Object.values(c.users).find(x => x.id === uid);
      return { userId: uid, displayName: u?.displayName ?? '?', email: u?.email ?? '?', role };
    });
  }

  async addGroupMember(accessToken: string, groupId: string, email: string): Promise<{ userId: string; role: string }> {
    await this.lag();
    const c = this.load();
    const user = this.userFromAccess(c, accessToken);
    const g = c.groups?.find(x => x.id === groupId && x.members[user.id]);
    if (!g) throw new GalleryApiError('NOT_FOUND', 'Group not found', 404);
    const target = Object.values(c.users).find(u => u.email === email.toLowerCase());
    if (!target) throw new GalleryApiError('NOT_FOUND', 'No user with that email', 404);
    g.members[target.id] = g.members[target.id] ?? 'member';
    this.save(c);
    return { userId: target.id, role: g.members[target.id] };
  }

  async removeGroupMember(accessToken: string, groupId: string, userId: string): Promise<void> {
    await this.lag();
    const c = this.load();
    const actor = this.userFromAccess(c, accessToken);
    const g = c.groups?.find(x => x.id === groupId);
    if (!g || !g.members[actor.id] || g.members[actor.id] === 'member') {
      throw new GalleryApiError('FORBIDDEN', 'Insufficient group role', 403);
    }
    if (g.members[userId] === 'owner') throw new GalleryApiError('VALIDATION', 'Cannot remove the owner', 422);
    delete g.members[userId];
    this.save(c);
  }

  // ---- test hooks: simulate a SECOND device mutating the cloud directly ----

  /** Push a doc as if another device did (bypasses ifMatch). */
  debugPushExternal(cloudId: string, doc: Screenplay): number {
    const c = this.load();
    const s = c.scripts.find(x => x.id === cloudId);
    if (!s) throw new Error('debugPushExternal: no such script');
    const revision = s.latestRevision + 1;
    s.versions.push({ revision, doc, blockCount: doc.blocks.length, createdAt: Date.now() });
    s.latestRevision = revision;
    s.updatedAt = Date.now();
    this.save(c);
    return revision;
  }

  /** Create a script as if another device did. Returns its cloud id. */
  debugCreateExternal(ownerEmail: string, doc: Screenplay): string {
    const c = this.load();
    const user = c.users[ownerEmail];
    if (!user) throw new Error('debugCreateExternal: no such user');
    const now = Date.now();
    const script: MockScript = {
      id: newId(),
      ownerId: user.id,
      title: doc.metadata.title,
      visibility: 'private',
      latestRevision: 1,
      createdAt: now,
      updatedAt: now,
      versions: [{ revision: 1, doc, blockCount: doc.blocks.length, createdAt: now }]
    };
    c.scripts.push(script);
    this.save(c);
    return script.id;
  }

  debugFindScriptByTitle(title: string): MockScript | null {
    return this.load().scripts.find(s => s.title === title) ?? null;
  }
}

// ── Auth wrapper ───────────────────────────────────────────────────────────

const AUTH_KEY = 'gallery_auth';

interface AuthPersist {
  user: GalleryUser;
  tokens: GalleryTokens;
}

export class GalleryClient {
  private auth: AuthPersist | null;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private api: GalleryApi) {
    try {
      this.auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    } catch {
      this.auth = null;
    }
  }

  get user(): GalleryUser | null {
    return this.auth?.user ?? null;
  }

  get isAuthenticated(): boolean {
    return !!this.auth;
  }

  async register(input: RegisterInput): Promise<GalleryUser> {
    return this.completeAuth(await this.api.register(input));
  }

  async login(input: LoginInput): Promise<GalleryUser> {
    return this.completeAuth(await this.api.login(input));
  }

  private completeAuth(r: AuthResult): GalleryUser {
    this.auth = { user: r.user, tokens: r.tokens };
    localStorage.setItem(AUTH_KEY, JSON.stringify(this.auth));
    return r.user;
  }

  async logout(): Promise<void> {
    if (!this.auth) return;
    const { accessToken, refreshToken } = this.auth.tokens;
    this.auth = null;
    localStorage.removeItem(AUTH_KEY);
    try {
      await this.api.logout(accessToken, refreshToken);
    } catch {
      // best-effort: local sign-out is already complete
    }
  }

  listScripts() {
    return this.authed(t => this.api.listScripts(t));
  }

  createScript(doc: Screenplay, idempotencyKey: string) {
    return this.authed(t => this.api.createScript(t, doc, idempotencyKey));
  }

  pushScript(cloudId: string, ifMatch: number, doc: Screenplay) {
    return this.authed(t => this.api.pushScript(t, cloudId, ifMatch, doc));
  }

  getScript(cloudId: string) {
    return this.authed(t => this.api.getScript(t, cloudId));
  }

  deleteScript(cloudId: string) {
    return this.authed(t => this.api.deleteScript(t, cloudId));
  }

  // ---- P2 ----

  galleryList(q?: string) {
    return this.authed(t => this.api.galleryList(t, q));
  }

  galleryGet(cloudId: string) {
    return this.authed(t => this.api.galleryGet(t, cloudId));
  }

  forkScript(cloudId: string, idempotencyKey: string) {
    return this.authed(t => this.api.forkScript(t, cloudId, idempotencyKey));
  }

  setVisibility(cloudId: string, visibility: ScriptVisibility) {
    return this.authed(t => this.api.setVisibility(t, cloudId, visibility));
  }

  listGroups() {
    return this.authed(t => this.api.listGroups(t));
  }

  createGroup(name: string) {
    return this.authed(t => this.api.createGroup(t, name));
  }

  listGroupMembers(groupId: string) {
    return this.authed(t => this.api.listGroupMembers(t, groupId));
  }

  addGroupMember(groupId: string, email: string) {
    return this.authed(t => this.api.addGroupMember(t, groupId, email));
  }

  removeGroupMember(groupId: string, userId: string) {
    return this.authed(t => this.api.removeGroupMember(t, groupId, userId));
  }

  /** Run an authenticated call; on token rejection refresh once and retry. */
  private async authed<T>(op: (accessToken: string) => Promise<T>): Promise<T> {
    if (!this.auth) throw new GalleryApiError('AUTH_REQUIRED', 'Not signed in');
    try {
      return await op(this.auth.tokens.accessToken);
    } catch (e) {
      if (!isGalleryApiError(e) || e.code !== 'INVALID_TOKEN') throw e;
      const ok = await this.ensureFreshToken();
      if (!ok || !this.auth) throw new GalleryApiError('AUTH_REQUIRED', 'Session expired — sign in again');
      return op(this.auth.tokens.accessToken);
    }
  }

  private ensureFreshToken(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        try {
          if (!this.auth) return false;
          const r = await this.api.refresh(this.auth.tokens.refreshToken);
          this.auth = { user: r.user, tokens: r.tokens };
          localStorage.setItem(AUTH_KEY, JSON.stringify(this.auth));
          return true;
        } catch {
          this.auth = null;
          localStorage.removeItem(AUTH_KEY);
          return false;
        } finally {
          this.refreshInFlight = null;
        }
      })();
    }
    return this.refreshInFlight;
  }
}
