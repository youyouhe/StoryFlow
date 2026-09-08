import React, { useState, useEffect, useCallback } from 'react';
import { Globe, X, Search, RefreshCw, Copy, ChevronLeft, Users, Plus, Trash2, Loader2, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import { TRANSLATIONS } from '../constants';
import { galleryClient } from '../services/gallery';
import { syncStore } from '../services/gallery';
import type { Screenplay } from '../types';
import type { CloudScript, GalleryCard, ScriptVisibility } from '../services/apiClient';
import { isGalleryApiError } from '../services/apiClient';

/**
 * GalleryModal (P2) — public feed browsing, read-only preview, one-click fork,
 * per-script visibility control, and minimal group management.
 * Reads/writes go through the galleryClient singleton; forked scripts are
 * materialized locally via syncStore (putScreenplay upserts the index).
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  signedIn: boolean;
  /** Called after a fork materializes a new local screenplay. */
  onLocalChange: () => void;
  t: typeof TRANSLATIONS['en'];
}

type Tab = 'browse' | 'mine' | 'groups';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString() + ' ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const GalleryModal: React.FC<Props> = ({ isOpen, onClose, signedIn, onLocalChange, t }) => {
  const [tab, setTab] = useState<Tab>('browse');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // browse
  const [cards, setCards] = useState<GalleryCard[] | null>(null);
  const [query, setQuery] = useState('');
  // detail
  const [detail, setDetail] = useState<{ card: GalleryCard; doc: Screenplay } | null>(null);
  const [forking, setForking] = useState(false);
  const [forkedId, setForkedId] = useState<string | null>(null);
  // mine
  const [mine, setMine] = useState<CloudScript[] | null>(null);
  // groups
  const [groups, setGroups] = useState<Array<{ id: string; name: string; role?: string; memberCount?: number }> | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ userId: string; displayName: string; email: string; role: string }> | null>(null);
  const [memberEmail, setMemberEmail] = useState('');

  const errMsg = (e: unknown) => (isGalleryApiError(e) ? e.message : String(e));

  const loadFeed = useCallback(async (q = '') => {
    setLoading(true);
    setError(null);
    try {
      setCards(await galleryClient.galleryList(q || undefined));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMine(await galleryClient.listScripts());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups(await galleryClient.listGroups());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (gid: string) => {
    setError(null);
    try {
      setMembers(await galleryClient.listGroupMembers(gid));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setDetail(null);
    setForkedId(null);
    setOpenGroupId(null);
    setMembers(null);
    if (!signedIn) return;
    if (tab === 'browse') void loadFeed('');
    else if (tab === 'mine') void loadMine();
    else void loadGroups();
  }, [isOpen, tab, signedIn, loadFeed, loadMine, loadGroups]);

  if (!isOpen) return null;

  const openDetail = async (card: GalleryCard) => {
    setLoading(true);
    setError(null);
    try {
      const full = await galleryClient.galleryGet(card.id);
      setDetail({ card, doc: full.doc });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const doFork = async (cloudId: string) => {
    setForking(true);
    setError(null);
    try {
      const res = await galleryClient.forkScript(cloudId, crypto.randomUUID());
      // The fork is ours (private) — fetch the doc and materialize locally.
      // Row title carries the "(fork)" marker; doc stays lossless.
      const full = await galleryClient.getScript(res.id);
      const local: Screenplay = {
        ...full.doc,
        id: crypto.randomUUID(),
        lastModified: Date.now(),
        metadata: { ...full.doc.metadata, title: full.script.title }
      };
      syncStore.putScreenplay(local);
      syncStore.setSyncState(local.id, {
        cloudId: res.id,
        baseRevision: full.revision,
        status: 'synced',
        syncedAt: Date.now()
      });
      setForkedId(res.id);
      onLocalChange();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setForking(false);
    }
  };

  const changeVisibility = async (cloudId: string, v: ScriptVisibility) => {
    setError(null);
    try {
      await galleryClient.setVisibility(cloudId, v);
      setMine(prev => prev?.map(s => (s.id === cloudId ? { ...s, visibility: v } : s)) ?? prev);
    } catch (e) {
      setError(errMsg(e));
      void loadMine();
    }
  };

  const visLabel = (v: ScriptVisibility) =>
    v === 'public' ? t.gallery_vis_public : v === 'group' ? t.gallery_vis_group : t.gallery_vis_private;

  const renderPreview = (doc: Screenplay) => (
    <div className="space-y-1 font-mono text-xs">
      {doc.blocks.slice(0, 80).map(b => (
        <div
          key={b.id}
          className={clsx(
            b.type === 'SCENE_HEADING' && 'font-bold uppercase text-indigo-600 dark:text-indigo-400 mt-3',
            b.type === 'CHARACTER' && 'uppercase font-bold text-center mt-2',
            b.type === 'DIALOGUE' && 'text-center text-gray-700 dark:text-gray-300',
            b.type === 'PARENTHETICAL' && 'text-center text-gray-400 italic',
            b.type === 'TRANSITION' && 'text-right uppercase text-orange-600',
            b.type === 'ACTION' && 'text-gray-800 dark:text-gray-200'
          )}
        >
          {b.content || '\u00A0'}
        </div>
      ))}
      {doc.blocks.length > 80 && (
        <div className="text-center text-gray-400 pt-2">… +{doc.blocks.length - 80} {t.galleryBlocks}</div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col border border-gray-200 dark:border-zinc-800">
        {/* header */}
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center gap-3 shrink-0">
          <Globe className="w-5 h-5 text-indigo-600" />
          <span className="font-bold text-gray-900 dark:text-white">{t.galleryTabBrowse}</span>
          {detail ? (
            <button
              onClick={() => setDetail(null)}
              className="ml-auto flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
            >
              <ChevronLeft className="w-4 h-4" /> {t.galleryDetailBack}
            </button>
          ) : (
            <div className="ml-auto flex gap-1">
              {(['browse', 'mine', 'groups'] as Tab[]).map(tb => (
                <button
                  key={tb}
                  onClick={() => setTab(tb)}
                  className={clsx(
                    'px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-colors',
                    tab === tb
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                  )}
                >
                  {tb === 'browse' ? t.galleryTabBrowse : tb === 'mine' ? t.galleryTabMine : t.galleryTabGroups}
                </button>
              ))}
            </div>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4">
          {!signedIn && (
            <div className="text-center text-sm text-gray-400 py-16">{t.gallerySignInPrompt}</div>
          )}

          {signedIn && error && (
            <div className="mb-3 text-[11px] px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 break-all">
              {error}
            </div>
          )}

          {signedIn && loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-16">
              <Loader2 className="w-4 h-4 animate-spin" /> {t.galleryLoading}
            </div>
          )}

          {/* browse tab */}
          {signedIn && tab === 'browse' && !detail && !loading && (
            <>
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void loadFeed(query)}
                    placeholder={t.gallerySearchPlaceholder}
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  />
                </div>
                <button
                  onClick={() => void loadFeed(query)}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> {t.galleryRefresh}
                </button>
              </div>
              {!cards?.length && <div className="text-center text-sm text-gray-400 py-16">{t.galleryEmpty}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {cards?.map(card => (
                  <button
                    key={card.id}
                    onClick={() => void openDetail(card)}
                    className="text-left p-3 rounded-xl border border-gray-200 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-700 bg-gray-50 dark:bg-zinc-900/60 transition-colors"
                  >
                    <div className="font-bold text-sm text-gray-800 dark:text-gray-100 truncate">{card.title}</div>
                    <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2">
                      <span className="truncate">{card.ownerName}</span>
                      <span>·</span>
                      <span>{card.blockCount} {t.galleryBlocks}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{fmtDate(card.updatedAt)}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* detail */}
          {signedIn && detail && (
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-bold text-lg text-gray-900 dark:text-white">{detail.card.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {detail.card.ownerName} · {detail.card.blockCount} {t.galleryBlocks} · {fmtDate(detail.card.updatedAt)}
                  </div>
                </div>
                <button
                  onClick={() => void doFork(detail.card.id)}
                  disabled={forking || forkedId === detail.card.id}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg"
                >
                  {forking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : forkedId === detail.card.id ? <Eye className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {forkedId === detail.card.id ? t.galleryForked : t.galleryFork}
                </button>
              </div>
              <div className="p-4 rounded-xl bg-yellow-50/60 dark:bg-zinc-900/80 border border-yellow-100 dark:border-zinc-800">
                {renderPreview(detail.doc)}
              </div>
            </div>
          )}

          {/* mine tab */}
          {signedIn && tab === 'mine' && !loading && (
            <div className="space-y-2">
              {!mine?.length && <div className="text-center text-sm text-gray-400 py-16">{t.galleryMineEmpty}</div>}
              {mine?.map(s => (
                <div key={s.id} className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-gray-800 dark:text-gray-100 truncate">{s.title}</div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      rev {s.latestRevision} · {s.blockCount} {t.galleryBlocks} · {fmtDate(s.updatedAt)}
                    </div>
                  </div>
                  <select
                    value={s.visibility}
                    onChange={e => void changeVisibility(s.id, e.target.value as ScriptVisibility)}
                    className="text-xs bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 dark:text-white outline-none"
                  >
                    {(['private', 'group', 'public'] as ScriptVisibility[]).map(v => (
                      <option key={v} value={v}>{visLabel(v)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* groups tab */}
          {signedIn && tab === 'groups' && !loading && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  placeholder={t.galleryGroupName}
                  className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
                <button
                  onClick={async () => {
                    if (!newGroupName.trim()) return;
                    setError(null);
                    try {
                      await galleryClient.createGroup(newGroupName.trim());
                      setNewGroupName('');
                      void loadGroups();
                    } catch (e) {
                      setError(errMsg(e));
                    }
                  }}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> {t.galleryCreateGroup}
                </button>
              </div>

              {!groups?.length && <div className="text-center text-sm text-gray-400 py-10">{t.galleryNoGroups}</div>}
              {groups?.map(g => (
                <div key={g.id} className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                  <button
                    onClick={() => {
                      if (openGroupId === g.id) { setOpenGroupId(null); setMembers(null); return; }
                      setOpenGroupId(g.id);
                      void loadMembers(g.id);
                    }}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-zinc-900"
                  >
                    <Users className="w-4 h-4 text-indigo-500" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-gray-800 dark:text-gray-100 truncate">{g.name}</div>
                      <div className="text-[10px] text-gray-400">
                        {g.role} · {g.memberCount ?? 0} {t.galleryMembers}
                      </div>
                    </div>
                  </button>
                  {openGroupId === g.id && (
                    <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-zinc-800 pt-2">
                      {members?.map(m => (
                        <div key={m.userId} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                            {m.displayName} <span className="text-gray-400">({m.email})</span>
                          </span>
                          <span className="text-[10px] uppercase font-bold text-gray-400">{m.role}</span>
                          {m.role !== 'owner' && (
                            <button
                              onClick={async () => {
                                try {
                                  await galleryClient.removeGroupMember(g.id, m.userId);
                                  void loadMembers(g.id);
                                  void loadGroups();
                                } catch (e) {
                                  setError(errMsg(e));
                                }
                              }}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <input
                          value={memberEmail}
                          onChange={e => setMemberEmail(e.target.value)}
                          placeholder={t.galleryAddMember}
                          className="flex-1 px-2.5 py-1.5 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs outline-none dark:text-white"
                        />
                        <button
                          onClick={async () => {
                            if (!memberEmail.trim() || !openGroupId) return;
                            try {
                              await galleryClient.addGroupMember(openGroupId, memberEmail.trim());
                              setMemberEmail('');
                              void loadMembers(openGroupId);
                              void loadGroups();
                            } catch (e) {
                              setError(errMsg(e));
                            }
                          }}
                          className="px-2.5 py-1.5 bg-gray-800 dark:bg-zinc-700 text-white rounded-lg text-xs font-bold"
                        >
                          {t.galleryAdd}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
