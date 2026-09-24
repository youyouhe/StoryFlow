/**
 * Composite scene — the P5a track model (docs/storyflow-adoption-plan.md).
 *
 * A composite scene is Hypit's composition contract reduced to StoryFlow's
 * needs: overlay tracks (caption / title / sticker) stacked over a base
 * video, every timed element hanging on P2 word anchors (caption cues ARE
 * the token windows — the audio/字幕 alignment identity). This module is
 * PURE: `compositeSceneAt(scene, t)` resolves exactly what is on screen at
 * time t, and the canvas renderer + capture simply draw that plan.
 * Zero generation cost: captions/titles/stickers are code-rendered.
 */
import type { CaptionCue } from '../timing/timeline';

export interface CaptionStyle {
  /** px, canvas units (canvas is authored at composition size). */
  size: number;
  fill: string;
  /** karaoke highlight for the active word */
  activeFill: string;
  background?: string;
  strokeColor?: string;
  strokeWidth?: number;
  /** 0..1 vertical position (baseline block bottom). */
  y: number;
  maxWordsPerLine: number;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  size: 52,
  fill: '#FFFFFF',
  activeFill: '#FFD54A',
  background: '#09090BCC',
  strokeColor: '#09090B',
  strokeWidth: 4,
  y: 0.8,
  maxWordsPerLine: 4,
};

export interface CaptionTrackSpec {
  kind: 'caption';
  /** Word-timed cues (P2's projectCaptionCues — windows == token windows). */
  cues: CaptionCue[];
  style: CaptionStyle;
  /** stack-order: higher paints later (on top). */
  order: number;
}

export interface TitleTrackSpec {
  kind: 'title';
  text: string;
  placement: 'top' | 'center' | 'bottom';
  color: string;
  size: number;
  /** Visible window in seconds; defaults to the whole program. */
  startSec?: number;
  endSec?: number;
  order: number;
}

export interface StickerTrackSpec {
  kind: 'sticker';
  id: string;
  text: string;
  author?: string;
  /** Window center + duration (seconds). */
  atSec: number;
  durationSec: number;
  order: number;
}

export type OverlayTrackSpec = CaptionTrackSpec | TitleTrackSpec | StickerTrackSpec;

export interface CompositeScene {
  width: number;
  height: number;
  /** Playback/capture frame rate. */
  fps: number;
  background: string;
  /** Base footage (generated clips etc.). Absent = title/card-only video. */
  base?: { src: Blob | string; fit: 'cover' | 'contain' };
  overlays: OverlayTrackSpec[];
  /** Total duration when no base video decides it. */
  durationSec?: number;
}

// ---- resolved plans (what the renderer draws at time t) ---------------------

export interface ActiveCaptionWord {
  text: string;
  start: number;
  end: number;
  active: boolean;
}

export interface ResolvedCaption {
  style: CaptionStyle;
  /** Wrapped lines of words; the active word is highlighted. */
  lines: ActiveCaptionWord[][];
}

export interface ResolvedTitle {
  text: string;
  placement: 'top' | 'center' | 'bottom';
  color: string;
  size: number;
}

export interface ResolvedSticker {
  id: string;
  text: string;
  author?: string;
  /** 0..1 fade progress (in/out over 200ms edges). */
  opacity: number;
}

export interface CompositeFramePlan {
  caption?: ResolvedCaption;
  title?: ResolvedTitle;
  stickers: ResolvedSticker[];
}

const wordVisible = (word: { start: number; end: number }, t: number): boolean =>
  t >= word.start && t < word.end; // half-open: exact boundary contract

/** The karaoke word active at t (≤1-frame accuracy: the boundary IS exact). */
export const activeWordAt = (words: { start: number; end: number }[], t: number): number =>
  words.findIndex(w => wordVisible(w, t));

const FADE_SEC = 0.2;

/** Resolve every overlay track at time t. Pure and synchronous. */
export const compositeSceneAt = (scene: CompositeScene, t: number): CompositeFramePlan => {
  const plan: CompositeFramePlan = { stickers: [] };
  const byOrder = [...scene.overlays].sort((a, b) => a.order - b.order);

  for (const track of byOrder) {
    if (track.kind === 'caption') {
      const cue = track.cues.find(c => t >= c.start && t < c.end);
      if (!cue) continue;
      const activeIndex = activeWordAt(cue.words, t);
      const words: ActiveCaptionWord[] = cue.words.map((w, i) => ({
        text: w.text, start: w.start, end: w.end, active: i === activeIndex,
      }));
      const max = Math.max(1, track.style.maxWordsPerLine);
      const lines: ActiveCaptionWord[][] = [];
      for (let i = 0; i < words.length; i += max) lines.push(words.slice(i, i + max));
      plan.caption = { style: track.style, lines };
    } else if (track.kind === 'title') {
      const start = track.startSec ?? -Infinity;
      const end = track.endSec ?? Infinity;
      if (t >= start && t < end) {
        plan.title = { text: track.text, placement: track.placement, color: track.color, size: track.size };
      }
    } else if (track.kind === 'sticker') {
      const start = track.atSec;
      const end = track.atSec + track.durationSec;
      if (t < start || t >= end) continue;
      const edge = Math.min(1, (t - start) / FADE_SEC, (end - t) / FADE_SEC);
      plan.stickers.push({ id: track.id, text: track.text, author: track.author, opacity: Math.max(0, edge) });
    }
  }
  return plan;
};

/** Program duration: base/declared wins; else the last overlay's extent. */
export const compositeDurationSec = (scene: CompositeScene, baseDuration?: number): number => {
  if (baseDuration && baseDuration > 0) return baseDuration;
  if (scene.durationSec && scene.durationSec > 0) return scene.durationSec;
  let end = 3;
  for (const track of scene.overlays) {
    if (track.kind === 'caption') {
      for (const cue of track.cues) end = Math.max(end, cue.end);
    } else if (track.kind === 'sticker') {
      end = Math.max(end, track.atSec + track.durationSec);
    } else if (track.kind === 'title' && track.endSec) {
      end = Math.max(end, track.endSec);
    }
  }
  return end;
};
