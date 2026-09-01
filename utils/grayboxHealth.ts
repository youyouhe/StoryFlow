import { GrayboxCamera, GrayboxCharacter } from '../types';

/**
 * Graybox health check (白模体检) — pure geometry logic that runs BEFORE a
 * white-model export / video-model submission and catches the common
 * authoring mistakes that would otherwise silently ruin the generated video:
 * zero/over-length durations, camera-on-character overlaps, discontinuous
 * movement paths, subjects framed out, empty blocking, and monotonous shot
 * size across a scene.
 *
 * Codes follow the product spec's appendix C:
 *   E001 camera-subject overlap (fail)
 *   E002 subject outside the camera's view (fail/warn)
 *   E003 movement path discontinuity (fail/warn)
 *   E004 duration missing / over the 30s model limit (fail)
 *   W001 whole scene at one shot size (warn)
 *   W002 character staging too spread for one framing (warn)
 *   W010 scene has no character blocking (warn)
 *   W011 undefined lens aim — lookAt equals camera position (fail)
 *
 * Pure and synchronous: same input → same report, no Three.js needed, so the
 * same function powers the panel checklist, the export gate, and the WebMCP
 * tool that lets AI agents self-check a graybox.
 */

export type HealthStatus = 'pass' | 'warn' | 'fail';

export interface HealthItem {
  code: string;
  status: HealthStatus;
  message: string;
}

export interface HealthReport {
  /** True when no item failed (warnings allowed). */
  passed: boolean;
  counts: { pass: number; warn: number; fail: number };
  items: HealthItem[];
}

export interface GrayboxHealthInput {
  camera: GrayboxCamera;
  /** The owning scene's character blocking (may be empty — that's W010). */
  characters: GrayboxCharacter[];
  /** shotTypes of every shot in the owning scene, for the W001 variety check.
   *  Optional — omit when unknown. */
  sceneShotTypes?: string[];
}

type Lang = 'en' | 'zh';

const M = {
  en: {
    durationOk: (d: number) => `Duration ${d.toFixed(1)}s — within limits.`,
    durationZero: (d: number) => `Duration is ${d}s — playback and export need a positive value (E004).`,
    durationShort: (d: number) => `Duration ${d.toFixed(1)}s is very short; under 1s barely reads as a shot.`,
    durationOver: (d: number) => `Duration ${d.toFixed(1)}s exceeds the 30s model limit — split the shot (E004).`,
    clearanceOk: (name: string, d: number) => `Nearest character "${name}" is ${d.toFixed(1)}m from the camera — clear.`,
    overlap: (name: string, d: number) => `Camera overlaps character "${name}" (${d.toFixed(2)}m apart) — keep ≥1m or the lens is inside the body (E001).`,
    pathOk: () => `Movement path is continuous and starts at the camera position.`,
    pathStart: (d: number) => `Path starts ${d.toFixed(1)}m away from camera.position — playback begins at the path, so frame 0 jumps (E003).`,
    pathJump: (seg: number, i: number) => `Path segment ${i + 1} jumps ${seg.toFixed(1)}m — likely a discontinuity between waypoints ${i + 1} and ${i + 2} (E003).`,
    framingOk: (name: string, deg: number) => `Subject "${name}" is ${deg.toFixed(0)}° off the lens axis — in frame.`,
    offAxis: (name: string, deg: number) => `Subject "${name}" sits ${deg.toFixed(0)}° off the lens axis on the first frame — may be half/out of frame (E002).`,
    behind: (name: string) => `Subject "${name}" is BEHIND the camera on the first frame — check lookAt (E002).`,
    noAim: () => `lookAt equals the camera position — lens aim is undefined and the render orientation breaks (W011).`,
    blockingOk: (n: number) => `${n} character${n > 1 ? 's' : ''} blocked in the scene.`,
    noChars: () => `Scene has no character blocking — the white model renders an empty set (W010). Run Alt+G on the scene heading.`,
    varietyOk: (types: string[]) => `Scene shot sizes vary (${[...new Set(types)].join(', ')}).`,
    monotony: (t: string, n: number) => `All ${n} shots in this scene are ${t} — mixing sizes gives the scene rhythm (W001).`,
    spreadOk: (d: number) => `Blocking spans ${d.toFixed(0)}m — coverable.`,
    spread: (d: number) => `Character staging spans ${d.toFixed(0)}m — a single framing may not hold everyone (W002).`,
  },
  zh: {
    durationOk: (d: number) => `时长 ${d.toFixed(1)}s，在限制内。`,
    durationZero: (d: number) => `时长为 ${d}s——播放与导出需要正值（E004）。`,
    durationShort: (d: number) => `时长 ${d.toFixed(1)}s 过短，不足 1s 几乎不成镜头。`,
    durationOver: (d: number) => `时长 ${d.toFixed(1)}s 超过模型 30s 上限——请拆分镜头（E004）。`,
    clearanceOk: (name: string, d: number) => `最近角色「${name}」距镜头 ${d.toFixed(1)}m，无重叠。`,
    overlap: (name: string, d: number) => `镜头与角色「${name}」重叠（相距 ${d.toFixed(2)}m）——请保持 ≥1m，否则镜头在人身体里（E001）。`,
    pathOk: () => `运动路径连续，且起点与镜头位置一致。`,
    pathStart: (d: number) => `路径起点距 camera.position ${d.toFixed(1)}m——播放从路径开始，第 0 帧会跳切（E003）。`,
    pathJump: (seg: number, i: number) => `路径第 ${i + 1} 段跳变 ${seg.toFixed(1)}m——路径点 ${i + 1}→${i + 2} 之间疑似断裂（E003）。`,
    framingOk: (name: string, deg: number) => `主体「${name}」偏离镜头轴线 ${deg.toFixed(0)}°，在画内。`,
    offAxis: (name: string, deg: number) => `主体「${name}」首帧偏离镜头轴线 ${deg.toFixed(0)}°——可能出画/半出画（E002）。`,
    behind: (name: string) => `主体「${name}」首帧在镜头背后——请检查 lookAt（E002）。`,
    noAim: () => `lookAt 与镜头位置重合——视线朝向未定义，渲染朝向会失效（W011）。`,
    blockingOk: (n: number) => `场景已放置 ${n} 个角色。`,
    noChars: () => `场景未放置人物——白模画面将是空场景（W010）。请在场景标题上 Alt+G 生成场景灰模。`,
    varietyOk: (types: string[]) => `本场景别有变化（${[...new Set(types)].join('、')}）。`,
    monotony: (t: string, n: number) => `本场 ${n} 个镜头全部是 ${t}——建议混用景别增强节奏（W001）。`,
    spreadOk: (d: number) => `站位跨度 ${d.toFixed(0)}m，可覆盖。`,
    spread: (d: number) => `角色站位跨度 ${d.toFixed(0)}m——单一取景可能装不下所有人（W002）。`,
  },
} as const;

const dist2D = (a: [number, number], b: [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Run all checks. Synchronous, side-effect free. */
export const checkGrayboxHealth = (
  input: GrayboxHealthInput,
  lang: Lang = 'en',
): HealthReport => {
  const t = M[lang];
  const items: HealthItem[] = [];
  const { camera, characters } = input;

  // ---- E004: duration ----
  const dur = camera.movement?.duration ?? 0;
  if (!(dur > 0)) items.push({ code: 'E004', status: 'fail', message: t.durationZero(dur) });
  else if (dur > 30) items.push({ code: 'E004', status: 'fail', message: t.durationOver(dur) });
  else if (dur < 1) items.push({ code: 'E004', status: 'warn', message: t.durationShort(dur) });
  else items.push({ code: 'E004', status: 'pass', message: t.durationOk(dur) });

  // ---- E001: camera-character clearance (horizontal distance) ----
  if (characters.length) {
    let nearest: { name: string; d: number } | null = null;
    for (const c of characters) {
      const d = dist2D(
        [camera.position[0], camera.position[2]],
        [c.position[0], c.position[1]],
      );
      if (!nearest || d < nearest.d) nearest = { name: c.name, d };
    }
    if (nearest) {
      if (nearest.d < 0.5) items.push({ code: 'E001', status: 'fail', message: t.overlap(nearest.name, nearest.d) });
      else items.push({ code: 'E001', status: 'pass', message: t.clearanceOk(nearest.name, nearest.d) });
    }
  }

  // ---- E003: path continuity ----
  const path = camera.movement?.path?.length
    ? camera.movement.path as [number, number, number][]
    : [camera.position as [number, number, number], camera.position as [number, number, number]];
  {
    // frame-0 consistency: playback starts at path[0], not camera.position
    const startDelta = Math.hypot(
      path[0][0] - camera.position[0],
      path[0][1] - camera.position[1],
      path[0][2] - camera.position[2],
    );
    let jump: { seg: number; i: number } | null = null;
    if (path.length >= 2) {
      const segs = path.slice(1).map((p, i) => Math.hypot(
        p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2],
      ));
      const sorted = [...segs].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i] > Math.max(8, median * 4) && segs[i] > 8) {
          if (!jump || segs[i] > jump.seg) jump = { seg: segs[i], i };
        }
      }
    }
    if (startDelta > 2) items.push({ code: 'E003', status: 'warn', message: t.pathStart(startDelta) });
    else if (jump) items.push({ code: 'E003', status: 'warn', message: t.pathJump(jump.seg, jump.i) });
    else items.push({ code: 'E003', status: 'pass', message: t.pathOk() });
  }

  // ---- W011 + E002: lens aim & subject framing (first frame) ----
  const aim = camera.lookAt as [number, number, number];
  const pos = camera.position as [number, number, number];
  const aimLen = Math.hypot(aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]);
  if (aimLen < 1e-6) {
    items.push({ code: 'W011', status: 'fail', message: t.noAim() });
  } else if (characters.length) {
    // subject = character nearest to the lookAt (the presumed focus)
    let subject: { name: string; d: number; x: number; z: number } | null = null;
    for (const c of characters) {
      const d = dist2D([aim[0], aim[2]], [c.position[0], c.position[1]]);
      if (!subject || d < subject.d) subject = { name: c.name, d, x: c.position[0], z: c.position[1] };
    }
    if (subject) {
      const fwd = [aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]];
      const to = [subject.x - pos[0], 1.6 - pos[1], subject.z - pos[2]];
      const toLen = Math.hypot(...to) || 1;
      const dot = (fwd[0] * to[0] + fwd[1] * to[1] + fwd[2] * to[2]) / (aimLen * toLen);
      const deg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      if (dot < -0.1) items.push({ code: 'E002', status: 'fail', message: t.behind(subject.name) });
      else if (deg > 45) items.push({ code: 'E002', status: 'warn', message: t.offAxis(subject.name, deg) });
      else items.push({ code: 'E002', status: 'pass', message: t.framingOk(subject.name, deg) });
    }
  }

  // ---- W010: scene blocking present? ----
  if (characters.length) {
    items.push({ code: 'W010', status: 'pass', message: t.blockingOk(characters.length) });
  } else {
    items.push({ code: 'W010', status: 'warn', message: t.noChars() });
  }

  // ---- W002: staging spread (pairwise max, characters only) ----
  if (characters.length >= 2) {
    let maxD = 0;
    for (let i = 0; i < characters.length; i++) {
      for (let j = i + 1; j < characters.length; j++) {
        maxD = Math.max(maxD, dist2D(characters[i].position, characters[j].position));
      }
    }
    if (maxD > 30) items.push({ code: 'W002', status: 'warn', message: t.spread(maxD) });
    else items.push({ code: 'W002', status: 'pass', message: t.spreadOk(maxD) });
  }

  // ---- W001: shot-size variety across the scene ----
  const types = input.sceneShotTypes ?? [];
  if (types.length >= 4) {
    const uniq = [...new Set(types)];
    if (uniq.length === 1) {
      items.push({ code: 'W001', status: 'warn', message: t.monotony(uniq[0], types.length) });
    } else {
      items.push({ code: 'W001', status: 'pass', message: t.varietyOk(types) });
    }
  }

  const counts = {
    pass: items.filter(i => i.status === 'pass').length,
    warn: items.filter(i => i.status === 'warn').length,
    fail: items.filter(i => i.status === 'fail').length,
  };
  return { passed: counts.fail === 0, counts, items };
};
