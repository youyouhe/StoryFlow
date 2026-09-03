import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GrayboxData, GrayboxObject, GrayboxCharacter, GrayboxCamera, RefImage, RefBindings, H3Task } from '../types';
import { whiteModelCharColor, buildSeedancePrompt, buildH3Prompt, copyTextToClipboard, WHITE_MODEL_STYLE_TEMPLATES } from '../utils/whiteModelPrompt';
import { checkGrayboxHealth, HealthReport } from '../utils/grayboxHealth';
import { resolveRefBindings, writeRefBindings } from '../utils/refBindings';
import { ReferenceBindingPanel, REF_BINDING_LABELS } from './ReferenceBindingPanel';
import { estimateH3Cost } from '../services/minimaxService';

/**
 * Graybox3DView — renders a GrayboxData payload as an interactive 3D previs.
 *
 * Two paths keyed on `graybox.kind`:
 *  - 'scene' (SCENE_HEADING): layout primitives + character blocking markers,
 *    orbitable top-down-ish view.
 *  - 'shot'  (ACTION/DIALOGUE): two view modes —
 *    · 'orbit': god view — camera marker + movement path polylines animating
 *      over `movement.duration`, with play/pause + progress UI.
 *    · 'pov':  the shot AS SEEN THROUGH ITS OWN LENS (body on `path`, aim on
 *      `lookPath`), rendering the owning scene's layout + characters. This is
 *      the white-model (白模) view that gets recorded for Seedance / MiniMax
 *      H3: the exported video must be the camera language itself, not a
 *      diagram of a camera moving.
 *
 * The Canvas is entirely declarative (R3F auto-disposes geometry/material on
 * unmount), so this file needs no manual cleanup.
 */

/** White-model export recording spec (Seedance/H3 reference-video input). */
const EXPORT_W = 1920;
const EXPORT_H = 1080;
const EXPORT_FPS = 24;
const EXPORT_BITRATE = 10_000_000;
/** Fallback clip length for shots whose movement.duration is 0/missing. */
const EXPORT_FALLBACK_SECONDS = 3;

/** MediaRecorder mime candidates — MP4/H.264 preferred (即梦/Ark upload),
 *  WebM as the universal Chromium fallback. */
const EXPORT_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

interface Graybox3DViewProps {
  graybox: GrayboxData;
  theme: 'light' | 'dark';
  label?: string;
  /** Owning scene's graybox (layout + character blocking). Shot views render
   *  this geometry so the POV / white-model export frames real space instead
   *  of an empty grid. Null when the scene heading has no graybox. */
  sceneGraybox?: GrayboxData | null;
  /** The block owning `graybox` (type + content) — quoted by the white-model
   *  prompt builders as the beat text. */
  beat?: { type: string; content: string } | null;
  /** Owning scene heading text, for prompt environment context. */
  sceneHeading?: string;
  /** shotTypes of every shot graybox in the owning scene — feeds the W001
   *  shot-variety check in the health report. Optional. */
  sceneShotTypes?: string[];
  /** White-model reference-image library (object URLs, session-managed in
   *  App state; blobs live in IndexedDB). */
  refImages?: RefImage[];
  /** Per-screenplay capsule→image bindings, persisted by App. */
  refBindings?: RefBindings;
  onRefBindingsChange?: (next: RefBindings) => void;
  onUploadRefImage?: (file: File, subject?: string) => void;
  onRemoveRefImage?: (id: string) => void;
  /** Opens the global asset-library management modal. */
  onOpenAssetLibrary?: () => void;
  /** Originating block id — scopes H3 task records to this shot. */
  blockId?: string;
  /** Submit the recorded white-model video to MiniMax H3 (App owns IO/keys). */
  onSubmitH3?: (payload: {
    blockId: string;
    blockContent: string;
    videoBlob: Blob;
    videoSeconds: number;
    prompt: string;
    resolution: '768P' | '2K';
    outputSeconds: number;
    referenceImageUrls: string[];
  }) => Promise<{ ok: boolean; taskId?: string; error?: string }>;
  /** H3 task records (all blocks; filtered to this blockId for display). */
  h3Tasks?: H3Task[];
  /** True when a MiniMax API key is configured. */
  h3Ready?: boolean;
}

// ---- semantic default colors per layout role (used when obj.color omitted) ----
const ROLE_COLORS: Record<GrayboxObject['role'], string> = {
  wall: '#9ca3af',
  floor: '#6b7280',
  ceiling: '#d1d5db',
  door: '#92400e',
  window: '#67e8f9',
  prop: '#60a5fa',
  furniture: '#a78b5f',
  environment: '#6b7a5e',
};

const toHex = (c?: string, role?: GrayboxObject['role']): string =>
  c && /^#?[0-9a-fA-F]{6}$/.test(c)
    ? (c.startsWith('#') ? c : `#${c}`)
    : (role ? ROLE_COLORS[role] : '#9ca3af');

// ============================================================================
// SCENE graybox pieces
// ============================================================================

const LayoutObject: React.FC<{
  obj: GrayboxObject;
  /** White-model (POV/export) mode: uniform neutral gray so the only color
   *  signal in frame is the character capsules the prompt maps to images. */
  clean?: boolean;
}> = ({ obj, clean }) => {
  const color = clean ? '#a8abb3' : toHex(obj.color, obj.role);
  const [w, h, d] = obj.size;
  const rot = obj.rotation
    ? obj.rotation as [number, number, number]
    : undefined;

  let geometry: React.ReactNode;
  switch (obj.type) {
    case 'box':
      geometry = <boxGeometry args={[w, h, d]} />;
      break;
    case 'plane':
      // plane uses w,h; rotate to be horizontal (floor/ceiling) by default
      geometry = <planeGeometry args={[w, h]} />;
      break;
    case 'cylinder':
      geometry = <cylinderGeometry args={[Math.max(w, d) / 2, Math.max(w, d) / 2, h, 20]} />;
      break;
    case 'sphere':
      geometry = <sphereGeometry args={[Math.max(w, d) / 2, 20, 20]} />;
      break;
    default:
      geometry = <boxGeometry args={[w, h, d]} />;
  }

  // A plane is horizontal when it reads as a ground/floor/ceiling surface —
  // indoors (floor/ceiling) or outdoors (environment ground plane). Without
  // this, an outdoor ground plane with role:'environment' renders vertical.
  // If the model explicitly gave a rotation, respect it.
  const needsFlat = obj.type === 'plane' && (obj.role === 'floor' || obj.role === 'ceiling' || obj.role === 'environment');
  const rotation = needsFlat && !rot ? [-Math.PI / 2, 0, 0] as [number, number, number] : rot;

  return (
    <group position={obj.position as [number, number, number]} rotation={rotation}>
      <mesh castShadow receiveShadow>
        {geometry}
        <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
      </mesh>
      {obj.label && !clean && (
        <Html position={[0, h / 2 + 0.15, 0]} center distanceFactor={10} occlude>
          <span style={{
            fontSize: '10px',
            whiteSpace: 'nowrap',
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            padding: '1px 5px',
            borderRadius: '4px',
            pointerEvents: 'none',
          }}>{obj.label}</span>
        </Html>
      )}
    </group>
  );
};

const CharacterMarker: React.FC<{
  char: GrayboxCharacter;
  /** Distinct capsule color (white-model mode maps this color to a reference
   *  image in the Seedance/H3 prompt). Falls back to the default green. */
  color?: string;
  /** Hide the floating name/pose text — text must not leak into an exported
   *  white-model frame; identity rides on the capsule color instead. */
  showLabel?: boolean;
}> = ({ char, color, showLabel = true }) => {
  const [x, z] = char.position;
  const facing = char.facing ?? 0;
  const body = color ?? '#10b981';
  return (
    <group position={[x, 0, z]}>
      {/* capsule body (height 1.6, standing roughly human-scale in this toy scene) */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <capsuleGeometry args={[0.25, 1.0, 8, 16]} />
        <meshStandardMaterial color={body} roughness={0.6} emissive={body} emissiveIntensity={0.12} />
      </mesh>
      {/* facing arrow: a small cone pointing +Z, rotated about Y by `facing` */}
      <mesh position={[0, 0.2, 0]} rotation={[0, facing, 0]}>
        <coneGeometry args={[0.12, 0.3, 12]} />
        <meshStandardMaterial color={body} />
      </mesh>
      {showLabel && (
        <>
          <Text
            position={[0, 2.1, 0]}
            fontSize={0.32}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#000000"
          >
            {char.name}
          </Text>
          {char.pose && (
            <Text
              position={[0, 1.75, 0]}
              fontSize={0.2}
              color="#a7f3d0"
              anchorX="center"
              anchorY="middle"
            >
              {char.pose}
            </Text>
          )}
        </>
      )}
    </group>
  );
};

const SceneCanvas: React.FC<{ graybox: GrayboxData; theme: 'light' | 'dark' }> = ({ graybox, theme }) => {
  return (
    <Canvas
      shadows
      camera={{ position: [7, 7, 9], fov: 50 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 12, 6]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      <hemisphereLight args={['#ffffff', '#374151', 0.4]} />

      <Grid
        args={[30, 30]}
        cellSize={1}
        cellThickness={0.6}
        cellColor={theme === 'dark' ? '#374151' : '#cbd5e1'}
        sectionSize={5}
        sectionThickness={1}
        sectionColor={theme === 'dark' ? '#4b5563' : '#94a3b8'}
        fadeDistance={28}
        fadeStrength={1}
        position={[0, 0, 0]}
        infiniteGrid
      />

      {(graybox.layout ?? []).map((obj) => (
        <LayoutObject key={obj.id} obj={obj} />
      ))}

      {(graybox.characters ?? []).map((char, i) => (
        <CharacterMarker key={`${char.name}-${i}`} char={char} />
      ))}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={3}
        maxDistance={40}
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  );
};

// ============================================================================
// SHOT graybox pieces (camera + path + playback)
// ============================================================================

/** Normalize a path: ensure at least the static position is present. */
const usePath = (camera: GrayboxCamera): [number, number, number][] => {
  return useMemo(() => {
    const p = camera.movement?.path;
    if (p && p.length >= 2) return p as [number, number, number][];
    if (p && p.length === 1) return [p[0] as [number, number, number], p[0] as [number, number, number]];
    return [camera.position as [number, number, number], camera.position as [number, number, number]];
  }, [camera]);
};

/** Segment-length-weighted interpolation along a polyline. t in [0,1]. */
const pointAt = (path: [number, number, number][], t: number): THREE.Vector3 => {
  if (path.length === 0) return new THREE.Vector3();
  if (path.length === 1) return new THREE.Vector3(...path[0]);
  const clamped = Math.max(0, Math.min(1, t));
  // total length
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = Math.hypot(
      path[i + 1][0] - path[i][0],
      path[i + 1][1] - path[i][1],
      path[i + 1][2] - path[i][2],
    );
    segs.push(d);
    total += d;
  }
  if (total === 0) return new THREE.Vector3(...path[0]);
  let dist = clamped * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i] || i === segs.length - 1) {
      const local = segs[i] === 0 ? 0 : dist / segs[i];
      const a = new THREE.Vector3(...path[i]);
      const b = new THREE.Vector3(...path[i + 1]);
      return a.clone().lerp(b, local);
    }
    dist -= segs[i];
  }
  return new THREE.Vector3(...path[path.length - 1]);
};

/** Same as `pointAt` but writes into a reusable target (no allocation). */
const pointAtInto = (path: [number, number, number][], t: number, out: THREE.Vector3): void => {
  if (path.length === 0) { out.set(0, 0, 0); return; }
  if (path.length === 1) { out.set(...path[0]); return; }
  const clamped = Math.max(0, Math.min(1, t));
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = Math.hypot(
      path[i + 1][0] - path[i][0],
      path[i + 1][1] - path[i][1],
      path[i + 1][2] - path[i][2],
    );
    segs.push(d);
    total += d;
  }
  if (total === 0) { out.set(...path[0]); return; }
  let dist = clamped * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i] || i === segs.length - 1) {
      const local = segs[i] === 0 ? 0 : dist / segs[i];
      out.set(
        path[i][0] + (path[i + 1][0] - path[i][0]) * local,
        path[i][1] + (path[i + 1][1] - path[i][1]) * local,
        path[i][2] + (path[i + 1][2] - path[i][2]) * local,
      );
      return;
    }
    dist -= segs[i];
  }
  out.set(...path[path.length - 1]);
};

/** The moving camera marker. Driven by external `progressRef` so the parent
 *  slider and the R3F loop share one source of truth.
 *
 *  Two interpolated curves:
 *  - body position along `path` (or static `camera.position` if no path)
 *  - lens lookAt along `lookPath` (or static `camera.lookAt` if no lookPath)
 *  A true pan/tilt = body fixed, lookAt sweeps. */
const CameraMarker: React.FC<{
  camera: GrayboxCamera;
  path: [number, number, number][];
  lookPath: [number, number, number][] | undefined;
  progressRef: React.MutableRefObject<number>;
}> = ({ camera, path, lookPath, progressRef }) => {
  const groupRef = useRef<THREE.Group>(null);
  const staticLook = useMemo(() => new THREE.Vector3(...camera.lookAt), [camera.lookAt]);
  // reusable scratch vectors to avoid per-frame allocation
  const lookScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!groupRef.current) return;
    const t = progressRef.current;
    // body position
    const pos = pointAt(path, t);
    groupRef.current.position.copy(pos);
    // lens lookAt: sweep along lookPath if present, else hold static lookAt
    if (lookPath && lookPath.length >= 2) {
      pointAtInto(lookPath, t, lookScratch.current);
      groupRef.current.lookAt(lookScratch.current);
    } else if (lookPath && lookPath.length === 1) {
      lookScratch.current.set(...lookPath[0]);
      groupRef.current.lookAt(lookScratch.current);
    } else {
      groupRef.current.lookAt(staticLook);
    }
  });

  return (
    <group ref={groupRef} position={camera.position as [number, number, number]}>
      {/* body */}
      <mesh castShadow>
        <boxGeometry args={[0.4, 0.3, 0.5]} />
        <meshStandardMaterial color="#ef4444" roughness={0.4} emissive="#7f1d1d" emissiveIntensity={0.3} />
      </mesh>
      {/* lens cone pointing -Z (forward after lookAt) */}
      <mesh position={[0, 0, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.14, 0.25, 16]} />
        <meshStandardMaterial color="#f97316" />
      </mesh>
    </group>
  );
};

/** POV mode: drive the RENDER camera itself through the shot's two curves —
 *  body along `path`, aim along `lookPath` (or static lookAt). What the user
 *  sees (and what captureStream records) is the shot as its own lens sees it.
 *  Mirrors CameraMarker's interpolation exactly, applied to state.camera. */
const PovCamera: React.FC<{
  path: [number, number, number][];
  lookPath: [number, number, number][] | undefined;
  staticLookAt: [number, number, number];
  progressRef: React.MutableRefObject<number>;
}> = ({ path, lookPath, staticLookAt, progressRef }) => {
  const lookScratch = useRef(new THREE.Vector3());
  const staticLook = useMemo(() => new THREE.Vector3(...staticLookAt), [staticLookAt]);
  useFrame(({ camera }) => {
    const t = progressRef.current;
    pointAtInto(path, t, camera.position);
    if (lookPath && lookPath.length >= 1) {
      pointAtInto(lookPath, t, lookScratch.current);
      camera.lookAt(lookScratch.current);
    } else {
      camera.lookAt(staticLook);
    }
  });
  return null;
};

const ShotCanvas: React.FC<{
  graybox: GrayboxData;
  sceneGraybox?: GrayboxData | null;
  theme: 'light' | 'dark';
  progressRef: React.MutableRefObject<number>;
  /** 'orbit' = god view with helpers; 'pov' = through-the-lens white model. */
  viewMode: 'orbit' | 'pov';
}> = ({ graybox, sceneGraybox, theme, progressRef, viewMode }) => {
  const camera = graybox.camera!;
  const path = usePath(camera);
  const lookPath = camera.movement?.lookPath && camera.movement.lookPath.length
    ? camera.movement.lookPath as [number, number, number][]
    : undefined;

  const pov = viewMode === 'pov';

  // initial orbit camera position biased by shotType
  const orbitPos: [number, number, number] = useMemo(() => {
    if (camera.shotType === 'top-down') return [0, 12, 0.001];
    return [6, 5, 8];
  }, [camera.shotType]);

  const lineColor = theme === 'dark' ? '#fb923c' : '#ea580c';
  const lookLineColor = theme === 'dark' ? '#facc15' : '#ca8a04';
  const moveType = camera.movement?.type ?? 'static';
  const isStatic = moveType === 'static';
  // body path degenerate? (single point, or two identical points = no body move)
  const bodyStatic = path.length < 2 ||
    (path.length === 2 && path[0][0] === path[1][0] && path[0][1] === path[1][1] && path[0][2] === path[1][2]);
  // does the lens sweep? (the defining trait of pan/tilt/handheld-look)
  const lensSweeps = !!(lookPath && lookPath.length >= 2);

  // The scene's geometry + blocking, rendered under the shot. In POV this is
  // the white model itself; in orbit it contextualizes the camera diagram.
  const sceneLayout = sceneGraybox?.layout ?? [];
  const sceneChars = sceneGraybox?.characters ?? [];

  // POV fov nudged by shot size — wide frames wider, close-ups tighter. The
  // subject distance is already authored in the camera coords; this just
  // keeps the lens reading honestly at both ends of the size spectrum.
  const povFov = useMemo(() => {
    switch (camera.shotType) {
      case 'wide': return 38;
      case 'top-down': return 55;
      case 'extreme-close-up': return 62;
      case 'close-up': return 55;
      default: return 48;
    }
  }, [camera.shotType]);

  return (
    <Canvas
      shadows
      key={viewMode}
      camera={pov
        ? { position: camera.position as [number, number, number], fov: povFov }
        : { position: orbitPos, fov: 50 }}
      gl={{ alpha: !pov, antialias: true }}
      dpr={pov ? 1 : [1, 2]}
      style={{ background: 'transparent' }}
    >
      {/* POV/export needs a solid backdrop — transparent alpha records as
          black in MP4/WebM. Neutral light gray, what-you-record-is-what-you-get. */}
      {pov && <color attach="background" args={['#e8eaee']} />}

      <ambientLight intensity={pov ? 0.8 : 0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow={pov} />

      {/* ---- the scene: layout + characters (white model in POV) ---- */}
      {sceneLayout.map((obj) => (
        <LayoutObject key={obj.id} obj={obj} clean={pov} />
      ))}
      {sceneChars.map((char, i) => (
        <CharacterMarker
          key={`${char.name}-${i}`}
          char={char}
          color={pov ? whiteModelCharColor(i).hex : undefined}
          showLabel={!pov}
        />
      ))}

      {pov ? (
        <PovCamera
          path={path}
          lookPath={lookPath}
          staticLookAt={camera.lookAt as [number, number, number]}
          progressRef={progressRef}
        />
      ) : (
        <>
          <Grid
            args={[30, 30]}
            cellSize={1}
            cellThickness={0.6}
            cellColor={theme === 'dark' ? '#374151' : '#cbd5e1'}
            sectionSize={5}
            sectionThickness={1}
            sectionColor={theme === 'dark' ? '#4b5563' : '#94a3b8'}
            fadeDistance={28}
            fadeStrength={1}
            infiniteGrid
          />

          {/* lookAt focus marker (initial lookAt) */}
          <mesh position={camera.lookAt as [number, number, number]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#fbbf24" emissive="#b45309" emissiveIntensity={0.5} />
          </mesh>
          {camera.focus && (
            <Html position={[camera.lookAt[0], camera.lookAt[1] + 0.5, camera.lookAt[2]]} center distanceFactor={10}>
              <span style={{
                fontSize: '10px',
                whiteSpace: 'nowrap',
                background: 'rgba(180,83,9,0.85)',
                color: '#fff',
                padding: '1px 5px',
                borderRadius: '4px',
                pointerEvents: 'none',
              }}>focus: {camera.focus}</span>
            </Html>
          )}

          {/* body movement path (orange, dashed) — skip if body doesn't travel */}
          {!isStatic && !bodyStatic && (
            <Line points={path} color={lineColor} lineWidth={2} transparent opacity={0.7} dashed dashSize={0.3} gapSize={0.15} />
          )}

          {/* lens sweep path (yellow, dotted-ish) — the pan/tilt "look around" arc.
              Drawn small spheres at each waypoint + a thin connecting line so the
              sweep is legible even when the body is fixed. */}
          {lensSweeps && lookPath && (
            <>
              <Line points={lookPath} color={lookLineColor} lineWidth={1.5} transparent opacity={0.55} dashed dashSize={0.18} gapSize={0.12} />
              {lookPath.map((p, i) => (
                <mesh key={`lp-${i}`} position={p as [number, number, number]}>
                  <sphereGeometry args={[0.08, 10, 10]} />
                  <meshStandardMaterial color={lookLineColor} emissive={lookLineColor} emissiveIntensity={0.4} />
                </mesh>
              ))}
            </>
          )}

          <CameraMarker camera={camera} path={path} lookPath={lookPath} progressRef={progressRef} />

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.1}
            minDistance={3}
            maxDistance={40}
          />
        </>
      )}
    </Canvas>
  );
};

// ---- shot playback controls (outside Canvas) ----

const ShotControls: React.FC<{
  camera: GrayboxCamera;
  playing: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  onSeek: (p: number) => void;
  progress: number; // 0..1 mirror for slider UI
  // white-model export / prompt generation
  viewMode: 'orbit' | 'pov';
  onViewMode: (m: 'orbit' | 'pov') => void;
  onExport: () => void;
  onPrompt: (target: 'seedance' | 'h3') => void;
  exporting: boolean;
  hasSceneGeometry: boolean;
  exportSupported: boolean;
  health: HealthReport | null;
  healthOpen: boolean;
  onToggleHealth: () => void;
  labels: {
    pov: string; orbit: string; exportBtn: string; recording: string;
    seedance: string; h3: string; noScene: string; unsupported: string;
    health: string; healthOpen: string; healthPass: string;
    healthWarn: string; healthFail: string; healthExportBlocked: string;
  };
}> = ({ camera, playing, onTogglePlay, onReset, onSeek, progress,
        viewMode, onViewMode, onExport, onPrompt, exporting,
        hasSceneGeometry, exportSupported, health, healthOpen, onToggleHealth, labels }) => {
  const type = camera.movement?.type ?? 'static';
  const duration = camera.movement?.duration ?? 0;
  const isStatic = type === 'static';
  const shotDesc = camera.shotDescription?.trim();

  return (
    <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/60">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
          {type}
        </span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">
          {duration > 0 ? `${duration.toFixed(1)}s` : '— · 0.0s'}
        </span>
      </div>
      {shotDesc && (
        <p className="mb-1.5 text-[11px] leading-snug text-gray-600 dark:text-gray-300 italic line-clamp-2">
          “{shotDesc}”
        </p>
      )}

      {/* health check summary + collapsible checklist (auto-run upstream) */}
      {health && (
        <div className="mb-2">
          <button
            type="button"
            onClick={onToggleHealth}
            className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[10px] font-semibold border border-gray-200 dark:border-zinc-700/70 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              health.counts.fail > 0 ? 'bg-red-500' : health.counts.warn > 0 ? 'bg-amber-400' : 'bg-emerald-500'
            }`} />
            <span className="text-gray-600 dark:text-gray-300">
              {labels.health}
              {health.counts.fail > 0
                ? ` · ${labels.healthFail}`
                : health.counts.warn > 0
                  ? ` · ${labels.healthWarn.replace('n', String(health.counts.warn))}`
                  : ` · ${labels.healthPass}`}
            </span>
            <span className="ml-auto text-gray-400">{healthOpen ? '▾' : '▸'}</span>
          </button>
          {healthOpen && (
            <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
              {health.items.map((item, i) => (
                <li key={`${item.code}-${i}`} className="flex items-start gap-1.5 px-1.5 text-[10px] leading-snug">
                  <span className="shrink-0">{item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : '❌'}</span>
                  <span className={item.status === 'fail'
                    ? 'text-red-600 dark:text-red-400'
                    : item.status === 'warn'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-gray-400 dark:text-gray-500'}>
                    <span className="font-mono mr-1">{item.code}</span>{item.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* view-mode segmented toggle + white-model export actions */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-zinc-700 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => onViewMode('orbit')}
            disabled={exporting}
            className={`px-2 py-1 transition-colors ${viewMode === 'orbit'
              ? 'bg-orange-500 text-white'
              : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
          >
            {labels.orbit}
          </button>
          <button
            type="button"
            onClick={() => onViewMode('pov')}
            disabled={exporting}
            className={`px-2 py-1 transition-colors ${viewMode === 'pov'
              ? 'bg-orange-500 text-white'
              : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
          >
            {labels.pov}
          </button>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting || !exportSupported || (health ? !health.passed : false)}
          title={!exportSupported
            ? labels.unsupported
            : health && !health.passed
              ? labels.healthExportBlocked
              : (hasSceneGeometry ? labels.exportBtn : labels.noScene)}
          className={`ml-auto px-2 py-1 rounded-md text-[10px] font-semibold transition-colors flex items-center gap-1 ${
            exporting
              ? 'bg-red-500 text-white animate-pulse'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {exporting ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />{labels.recording}</>
          ) : (
            <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="inline"><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>{labels.exportBtn}</>
          )}
        </button>
      </div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <button
          type="button"
          onClick={() => onPrompt('seedance')}
          disabled={exporting}
          className="flex-1 px-2 py-1 rounded-md text-[10px] font-semibold border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
        >
          {labels.seedance}
        </button>
        <button
          type="button"
          onClick={() => onPrompt('h3')}
          disabled={exporting}
          className="flex-1 px-2 py-1 rounded-md text-[10px] font-semibold border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
        >
          {labels.h3}
        </button>
      </div>

      {!isStatic && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-orange-500 hover:bg-orange-600 text-white transition-colors"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3" height="12" /><rect x="7" y="0" width="3" height="12" /></svg>
            ) : (
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0 L10 6 L0 12 Z" /></svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="flex-1 accent-orange-500 h-1"
          />
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-1"
            aria-label="Reset"
          >
            ↺
          </button>
        </div>
      )}
      {isStatic && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500">static shot — no camera movement</p>
      )}
      {!hasSceneGeometry && (
        <p className="mt-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">{labels.noScene}</p>
      )}
    </div>
  );
};

// ============================================================================
// Main component
// ============================================================================

/** UI strings for the white-model export features (kept local — only this
 *  component needs them; two languages, matching TRANSLATIONS' shape). */
const UI_LABELS = {
  en: {
    pov: 'POV', orbit: 'Orbit', exportBtn: 'Export video', recording: 'Recording…',
    seedance: 'Seedance prompt', h3: 'H3 prompt',
    noScene: 'No scene graybox for this shot\'s scene — POV/export frames an empty set. Run Alt+G on the scene heading first.',
    unsupported: 'Video recording is not supported in this browser.',
    promptTitle: 'White-model prompt', copy: 'Copy', copied: 'Copied ✓',
    copyFail: 'Copy failed — select the text and copy manually.', close: 'Close',
    povHint: 'Through-the-lens view — this is exactly what the white-model export records.',
    health: 'Health check', healthOpen: 'Checks', healthPass: 'all clear', healthWarn: 'n warnings', healthFail: 'blocked',
    healthExportBlocked: 'Export blocked — fix the failing checks (❌) first.',
    style: 'Style',
    h3Submit: 'Submit to H3', h3NeedKey: 'No MiniMax API key — add it in Settings → Video Generation.',
    h3Tasks: 'Generation tasks', h3Download: 'Download video', h3Res: 'Resolution',
    h3Confirm: (cost: number, inS: number, outS: number, imgs: number) =>
      `Submit to MiniMax H3?\nEstimated cost ≈ ¥${cost.toFixed(2)} (input ${inS.toFixed(1)}s + output ${outS}s, ${imgs} ref image(s) — input video is billed too).\nThe white model will be recorded first (~${inS.toFixed(0)}s).`,
    h3Status: { uploading: 'Uploading video…', submitting: 'Creating task…', queued: 'Queued', running: 'Generating…', succeeded: 'Done', failed: 'Failed' } as Record<string, string>,
    promptLen: (n: number) => `${n} chars${n > 7000 ? ' — over the H3 7000-char limit!' : ''}`,
  },
  zh: {
    pov: '镜头视角', orbit: '轨道视角', exportBtn: '导出白模视频', recording: '录制中…',
    seedance: 'Seedance 提示词', h3: 'H3 提示词',
    noScene: '该镜头所属场景没有 scene 灰模——POV/导出画面将是空场景。请先在场景标题上 Alt+G 生成场景灰模。',
    unsupported: '当前浏览器不支持视频录制。',
    promptTitle: '白模提示词', copy: '复制', copied: '已复制 ✓',
    copyFail: '复制失败——请手动选择文本复制。', close: '关闭',
    povHint: '过镜视角（镜头所见画面）——白模导出录制的就是这个画面。',
    health: '体检', healthOpen: '检查项', healthPass: '全部通过', healthWarn: 'n 项警告', healthFail: '已拦截',
    healthExportBlocked: '导出已拦截——请先修复 ❌ 未通过项。',
    style: '风格',
    h3Submit: '提交 H3 生成', h3NeedKey: '未配置 MiniMax API Key——请在 Settings → 视频生成中填写。',
    h3Tasks: '生成任务', h3Download: '下载成片', h3Res: '分辨率',
    h3Confirm: (cost: number, inS: number, outS: number, imgs: number) =>
      `提交到 MiniMax H3？\n预估费用 ≈ ¥${cost.toFixed(2)}（输入 ${inS.toFixed(1)}s + 输出 ${outS}s，参考图 ${imgs} 张——输入视频同样计费）。\n将先录制白模视频（约 ${inS.toFixed(0)} 秒）。`,
    h3Status: { uploading: '上传视频中…', submitting: '创建任务…', queued: '排队中', running: '生成中…', succeeded: '已完成', failed: '失败' } as Record<string, string>,
    promptLen: (n: number) => `${n} 字符${n > 7000 ? '——超出 H3 7000 字符上限！' : ''}`,
  },
} as const;

export const Graybox3DView: React.FC<Graybox3DViewProps & { uiLang?: 'en' | 'zh' }> = ({ graybox, theme, sceneGraybox, beat, sceneHeading, sceneShotTypes, refImages = [], refBindings, onRefBindingsChange, onUploadRefImage, onRemoveRefImage, onOpenAssetLibrary, blockId, onSubmitH3, h3Tasks = [], h3Ready, uiLang = 'en' }) => {
  const L = UI_LABELS[uiLang];

  // shot playback state
  const isShot = graybox.kind === 'shot' && !!graybox.camera;

  const [playing, setPlaying] = useState(false);
  const [progressUI, setProgressUI] = useState(0);
  const progressRef = useRef(0);
  const rafStartRef = useRef<number | null>(null);

  // white-model view / export state
  const [viewMode, setViewMode] = useState<'orbit' | 'pov'>('orbit');
  const [exporting, setExporting] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const [promptTarget, setPromptTarget] = useState<'seedance' | 'h3' | null>(null);
  const [copyResult, setCopyResult] = useState<'ok' | 'fail' | null>(null);
  // prompt style preset (appendix B) — session state, defaults to realistic
  const [styleId, setStyleId] = useState<string>(WHITE_MODEL_STYLE_TEMPLATES[0].id);
  // health-check checklist collapsed by default; the summary is always visible
  const [healthOpen, setHealthOpen] = useState(false);
  // H3 submission state
  const [h3Resolution, setH3Resolution] = useState<'768P' | '2K'>('768P');
  const [h3Error, setH3Error] = useState<string | null>(null);
  // Costume variants: bind per-scene instead of script-wide
  const [sceneOnly, setSceneOnly] = useState(false);
  const effBindings = useMemo(
    () => resolveRefBindings(refBindings, sceneHeading),
    [refBindings, sceneHeading],
  );
  const handleBindingsWrite = (next: import('../types').RefBindings) => {
    onRefBindingsChange?.(writeRefBindings(refBindings, sceneHeading, sceneOnly, next));
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const exportRafRef = useRef<number | null>(null);
  const exportTimerRef = useRef<number | null>(null);

  const sceneChars = useMemo(() => sceneGraybox?.characters ?? [], [sceneGraybox]);
  const hasSceneGeometry = (sceneGraybox?.layout?.length ?? 0) > 0 || sceneChars.length > 0;
  const exportSupported = typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';

  // ---- white-model health check (auto-run; pure, cheap) ----
  const health: HealthReport | null = useMemo(
    () => isShot && graybox.camera
      ? checkGrayboxHealth({ camera: graybox.camera, characters: sceneChars, sceneShotTypes }, uiLang)
      : null,
    [isShot, graybox.camera, sceneChars, sceneShotTypes, uiLang],
  );
  const healthBlocksExport = !!health && !health.passed;

  // ALL remaining hooks run BEFORE the early returns below (Rules of Hooks):
  // the same mounted instance can flip between valid/error/empty graybox
  // when the user regenerates or switches blocks — a changing hook count
  // mid-life crashes React ("Rendered more/fewer hooks than previous render").
  const hasScene = graybox.kind === 'scene' && ((graybox.layout?.length ?? 0) > 0 || (graybox.characters?.length ?? 0) > 0);

  // advance progress via requestAnimationFrame (decoupled from R3F's own RAF,
  // so the slider tracks even if Canvas is not the active render target)
  useEffect(() => {
    if (!isShot || !playing) return;
    const cam = graybox.camera!;
    const dur = cam.movement?.duration ?? 0;
    if (dur <= 0) { setPlaying(false); return; }
    const startTs = performance.now() - progressRef.current * dur * 1000;

    const tick = (ts: number) => {
      const elapsed = (ts - startTs) / 1000;
      const p = Math.min(1, elapsed / dur);
      progressRef.current = p;
      setProgressUI(p);
      if (p >= 1) {
        setPlaying(false);
        rafStartRef.current = null;
        return;
      }
      rafStartRef.current = requestAnimationFrame(tick);
    };
    rafStartRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafStartRef.current != null) cancelAnimationFrame(rafStartRef.current);
      rafStartRef.current = null;
    };
  }, [playing, isShot, graybox]);

  // stop any live export when unmounting (recorder, rAF, timers)
  useEffect(() => () => {
    if (exportRafRef.current != null) cancelAnimationFrame(exportRafRef.current);
    if (exportTimerRef.current != null) clearTimeout(exportTimerRef.current);
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* already stopped */ }
    }
  }, []);

  // ---- prompt builder ----
  // Shared input builder so the modal preview and the H3 submission always
  // agree (submission forces the H3 dialect regardless of the open tab).
  // Declared before startH3Submit to keep TDZ order valid.
  const promptInputFor = useCallback((target: 'seedance' | 'h3') => {
    const styleHint = WHITE_MODEL_STYLE_TEMPLATES.find(s => s.id === styleId)?.keywords;
    const imageById = (id?: string) => refImages.find((img) => img.id === id);
    const boundChars = effBindings && refImages.length
      ? Object.fromEntries(
          Object.entries(refBindings.characters)
            .filter(([, id]) => !!imageById(id))
            .map(([name, id]) => [name, imageById(id)!.name]),
        )
      : undefined;
    const hasAnyBinding = boundChars && Object.keys(boundChars).length > 0;
    const envImage = effBindings && refImages.length && imageById(effBindings.environment)?.name;
    return {
      beatContent: beat?.content ?? '',
      beatType: beat?.type,
      camera: graybox.camera!,
      characters: sceneChars,
      sceneHeading,
      styleHint,
      target,
      ...(hasAnyBinding ? { characterImages: boundChars } : {}),
      ...(hasAnyBinding || envImage ? { environmentImage: envImage } : {}),
    };
  }, [styleId, refImages, effBindings, beat, sceneChars, sceneHeading, graybox.camera]);

  // ---- white-model export: record the POV playback as a reference video ----
  // `h3Payload` switches the tail from "download the file" to "hand the blob
  // to App's H3 submission pipeline" (upload → create task → poll).
  const startExport = useCallback((h3Payload?: {
    blockId: string;
    blockContent: string;
    prompt: string;
    resolution: '768P' | '2K';
    outputSeconds: number;
    referenceImageUrls: string[];
  }) => {
    if (exporting || !isShot || !graybox.camera || !wrapRef.current) return;
    if (!exportSupported) return;
    if (healthBlocksExport) return; // failing checks (❌) gate the export

    // measure the panel now — during export the inner canvas is absolutely
    // sized 1920×1080 and CSS-scaled back down so the layout never jumps
    const rect = wrapRef.current.getBoundingClientRect();
    setExportScale(Math.max(0.01, Math.min(rect.width / EXPORT_W, rect.height / EXPORT_H)));

    setPlaying(false);
    setViewMode('pov');   // Canvas remounts in POV at export size
    setExporting(true);
    progressRef.current = 0;
    setProgressUI(0);

    // give the remounted Canvas a few frames to size + render its first frame
    exportTimerRef.current = window.setTimeout(() => {
      const canvas = wrapRef.current?.querySelector('canvas');
      if (!canvas) { setExporting(false); return; }

      const mime = EXPORT_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) { setExporting(false); return; }

      const stream = canvas.captureStream(EXPORT_FPS);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: EXPORT_BITRATE });
      recorderRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        recorderRef.current = null;
        setExporting(false);
        if (h3Payload && onSubmitH3) {
          onSubmitH3({ ...h3Payload, videoBlob: blob, videoSeconds: durSec })
            .then((r) => { if (r.ok) setH3Error(null); else setH3Error(r.error ?? 'unknown error'); })
            .catch((e) => setH3Error(String(e?.message || e)));
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `whitemodel-shot-${Date.now()}.${ext}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      };

      rec.start(250);

      // self-contained playback clock (does not touch the shared `playing`
      // effect): drives progressRef for PovCamera and the slider UI.
      const cam = graybox.camera!;
      const durSec = (cam.movement?.duration ?? 0) > 0
        ? cam.movement.duration
        : EXPORT_FALLBACK_SECONDS;
      const durMs = durSec * 1000;
      const startTs = performance.now();
      const tick = (ts: number) => {
        const p = Math.min(1, (ts - startTs) / durMs);
        progressRef.current = p;
        setProgressUI(p);
        if (p < 1) {
          exportRafRef.current = requestAnimationFrame(tick);
        } else {
          // small tail so the last frame lands in the file, then stop
          exportTimerRef.current = window.setTimeout(() => {
            try { rec.stop(); } catch { /* already stopped */ }
          }, 450);
        }
      };
      exportRafRef.current = requestAnimationFrame(tick);
    }, 450);
  }, [exporting, isShot, graybox, exportSupported, healthBlocksExport, onSubmitH3]);

  // ---- H3 submission: confirm cost → record white model → submit ----
  const startH3Submit = useCallback(() => {
    if (!onSubmitH3 || !isShot || !graybox.camera || !blockId) return;
    if (!h3Ready) { setH3Error(L.h3NeedKey); return; }
    const cam = graybox.camera;
    const durSec = (cam.movement?.duration ?? 0) > 0 ? cam.movement.duration : EXPORT_FALLBACK_SECONDS;
    if (durSec > 15) {
      setH3Error(`H3 参考视频上限 15s——当前 ${durSec.toFixed(1)}s，请先缩短镜头 duration。`);
      return;
    }
    const outputSeconds = Math.max(4, Math.min(15, Math.round(durSec)));
    // bound reference images in scene order + env last (matches the prompt mapping)
    const refImageUrls: string[] = [];
    for (const c of sceneChars) {
      const img = refImages.find((i) => i.id === effBindings.characters[c.name]);
      if (img) refImageUrls.push(img.url);
    }
    const envImg = refImages.find((i) => i.id === effBindings.environment);
    if (envImg) refImageUrls.push(envImg.url);

    const cost = estimateH3Cost({
      videoSeconds: durSec,
      outputSeconds,
      referenceImages: refImageUrls.map((_, i) => ({ name: `ref-${i}`, blob: new Blob() })),
      resolution: h3Resolution,
    });
    if (!window.confirm(L.h3Confirm(cost, durSec, outputSeconds, refImageUrls.length))) return;

    setH3Error(null);
    startExport({
      blockId,
      blockContent: beat?.content ?? '',
      prompt: buildH3Prompt(promptInputFor('h3')),
      resolution: h3Resolution,
      outputSeconds,
      referenceImageUrls: refImageUrls,
    });
  }, [onSubmitH3, isShot, graybox.camera, blockId, h3Ready, sceneChars, refImages, effBindings, h3Resolution, beat, L, startExport, promptInputFor]);

  const promptText = useMemo(() => {
    if (!promptTarget || !graybox.camera) return '';
    return promptTarget === 'seedance' ? buildSeedancePrompt(promptInputFor('seedance')) : buildH3Prompt(promptInputFor('h3'));
  }, [promptTarget, graybox.camera, promptInputFor]);

  // error state
  if (graybox.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
        </div>
        <p className="text-xs text-red-600 dark:text-red-400 font-medium">Graybox generation error</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 break-words">{graybox.error}</p>
      </div>
    );
  }

  // empty state
  if (!isShot && !hasScene) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 dark:text-gray-600 mb-2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" /></svg>
        <p className="text-xs text-gray-400 dark:text-gray-500">No renderable graybox data</p>
      </div>
    );
  }

  const togglePlay = () => {
    if (progressRef.current >= 1) progressRef.current = 0;
    setProgressUI(progressRef.current);
    setPlaying((p) => !p);
  };
  const reset = () => {
    setPlaying(false);
    progressRef.current = 0;
    setProgressUI(0);
  };

  const doCopy = async () => {
    const ok = await copyTextToClipboard(promptText);
    setCopyResult(ok ? 'ok' : 'fail');
    setTimeout(() => setCopyResult(null), 2000);
  };

  const canvasBg = theme === 'dark' ? 'bg-gray-900/40' : 'bg-gray-50';

  return (
    <div className="flex flex-col h-full">
      <div ref={wrapRef} className={`relative flex-1 min-h-0 overflow-hidden ${canvasBg}`}>
        {/* During export the inner box is a REAL 1920×1080 layout (the recording
            resolution). Do NOT scale it back with a CSS transform — r3f's
            measure pass reads the transformed rect and sizes the renderer to
            the DISPLAY size (366×206), which the video API rejects (min side
            256). The overflow is clipped by the parent; the recording overlay
            covers the visual oddity for the few seconds it lasts. */}
        <div
          style={exporting
            ? { position: 'absolute', top: 0, left: 0, width: EXPORT_W, height: EXPORT_H }
            : { width: '100%', height: '100%' }}
        >
          {graybox.kind === 'scene' ? (
            <SceneCanvas graybox={graybox} theme={theme} />
          ) : (
            <ShotCanvas graybox={graybox} sceneGraybox={sceneGraybox} theme={theme} progressRef={progressRef} viewMode={viewMode} />
          )}
        </div>
        {viewMode === 'pov' && !exporting && isShot && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] pointer-events-none max-w-[85%]">
            {L.povHint}
          </div>
        )}
      </div>
      {isShot && graybox.camera && (
        <ShotControls
          camera={graybox.camera}
          playing={playing}
          onTogglePlay={togglePlay}
          onReset={reset}
          onSeek={(p) => { setPlaying(false); progressRef.current = p; setProgressUI(p); }}
          progress={progressUI}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onExport={startExport}
          onPrompt={(target) => { setPromptTarget(target); setCopyResult(null); }}
          exporting={exporting}
          hasSceneGeometry={hasSceneGeometry}
          exportSupported={exportSupported}
          health={health}
          healthOpen={healthOpen}
          onToggleHealth={() => setHealthOpen(o => !o)}
          labels={{
            pov: L.pov, orbit: L.orbit, exportBtn: L.exportBtn, recording: L.recording,
            seedance: L.seedance, h3: L.h3, noScene: L.noScene, unsupported: L.unsupported,
            health: L.health, healthOpen: L.healthOpen, healthPass: L.healthPass,
            healthWarn: L.healthWarn, healthFail: L.healthFail,
            healthExportBlocked: L.healthExportBlocked,
          }}
        />
      )}

      {/* white-model prompt modal (Seedance / H3) */}
      {promptTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPromptTarget(null)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {L.promptTitle} · {promptTarget === 'seedance' ? 'Seedance 2.5' : 'MiniMax H3'}
              </span>
              <button
                type="button"
                onClick={() => setPromptTarget(null)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800"
                aria-label={L.close}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {onRefBindingsChange && refBindings && (
                <ReferenceBindingPanel
                  characters={sceneChars}
                  images={refImages}
                  bindings={effBindings}
                  onChange={handleBindingsWrite}
                  onUpload={onUploadRefImage ?? (() => {})}
                  onRemoveImage={onRemoveRefImage ?? (() => {})}
                  onOpenLibrary={onOpenAssetLibrary}
                  sceneHeading={sceneHeading}
                  sceneOnly={sceneOnly}
                  onSceneOnlyChange={setSceneOnly}
                  labels={REF_BINDING_LABELS[uiLang]}
                />
              )}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 shrink-0">{L.style}</span>
                <select
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
                >
                  {WHITE_MODEL_STYLE_TEMPLATES.map(s => (
                    <option key={s.id} value={s.id}>{s.zh} · {s.keywords}</option>
                  ))}
                </select>
              </div>
              <textarea
                readOnly
                value={promptText}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full h-64 resize-none rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 p-3 text-xs leading-relaxed font-mono text-gray-700 dark:text-gray-200"
              />
              <p className="mt-2 text-[10px] leading-snug text-gray-400 dark:text-gray-500">
                {uiLang === 'zh'
                  ? '上传顺序：@视频1 = 导出的白模视频；@图片1..N = 各角色参考图（按映射表顺序）；最后一张 = 场景风格图。'
                  : 'Upload order: @视频1 = the exported white-model video; @图片1..N = character reference images (in mapping-table order); last image = scene style.'}
              </p>
              <p className="mt-1 text-right text-[10px] tabular-nums text-gray-400 dark:text-gray-500">{L.promptLen(promptText.length)}</p>

              {/* H3 direct submission (browser BYOK) + this shot's task list */}
              {onSubmitH3 && blockId && (
                <div className="mt-3 pt-2 border-t border-gray-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 shrink-0">{L.h3Res}</span>
                    <select
                      value={h3Resolution}
                      onChange={(e) => setH3Resolution(e.target.value as '768P' | '2K')}
                      className="rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
                    >
                      <option value="768P">768P（¥0.50/s）</option>
                      <option value="2K">2K（¥0.80/s）</option>
                    </select>
                    <button
                      type="button"
                      onClick={startH3Submit}
                      disabled={exporting || !h3Ready}
                      title={!h3Ready ? L.h3NeedKey : undefined}
                      className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      {exporting ? L.recording : L.h3Submit}
                    </button>
                  </div>
                  {h3Error && (
                    <p className="mt-1.5 text-[10px] leading-snug text-red-500 dark:text-red-400 break-words">{h3Error}</p>
                  )}
                  {(() => {
                    const blockTasks = h3Tasks.filter(t => t.blockId === blockId).slice(0, 5);
                    if (!blockTasks.length) return null;
                    return (
                      <div className="mt-2">
                        <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">{L.h3Tasks}</p>
                        <ul className="space-y-1">
                          {blockTasks.map(t => (
                            <li key={t.id} className="flex items-center gap-1.5 text-[10px]">
                              <span className={
                                t.status === 'succeeded' ? 'text-emerald-600 dark:text-emerald-400'
                                  : t.status === 'failed' ? 'text-red-500'
                                  : 'text-amber-600 dark:text-amber-400 animate-pulse'
                              }>
                                {['uploading', 'submitting', 'queued', 'running'].includes(t.status) ? '⏳' : t.status === 'succeeded' ? '✅' : '❌'}
                              </span>
                              <span className="text-gray-600 dark:text-gray-300 truncate flex-1">
                                {L.h3Status[t.status] ?? t.status} · {t.resolution} · ¥{t.estimatedCost.toFixed(2)}
                              </span>
                              {t.status === 'succeeded' && t.resultUrl && (
                                <a
                                  href={t.resultUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  download
                                  className="shrink-0 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
                                >
                                  {L.h3Download}
                                </a>
                              )}
                              {t.status === 'failed' && t.error && (
                                <span className="shrink-0 max-w-[45%] truncate text-red-400" title={t.error}>?</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2">
              <button
                type="button"
                onClick={doCopy}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                {copyResult === 'ok' ? L.copied : copyResult === 'fail' ? L.copyFail : L.copy}
              </button>
              <button
                type="button"
                onClick={() => setPromptTarget(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {L.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
