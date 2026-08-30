import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GrayboxData, GrayboxObject, GrayboxCharacter, GrayboxCamera } from '../types';

/**
 * Graybox3DView — renders a GrayboxData payload as an interactive 3D previs.
 *
 * Two paths keyed on `graybox.kind`:
 *  - 'scene' (SCENE_HEADING): layout primitives + character blocking markers,
 *    orbitable top-down-ish view.
 *  - 'shot'  (ACTION/DIALOGUE): a camera marker + movement path polyline +
 *    playback animation that pushes the marker along `movement.path` over
 *    `movement.duration` seconds, with play/pause + progress UI.
 *
 * The Canvas is entirely declarative (R3F auto-disposes geometry/material on
 * unmount), so this file needs no manual cleanup.
 */

interface Graybox3DViewProps {
  graybox: GrayboxData;
  theme: 'light' | 'dark';
  label?: string;
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
  environment: '#4b5563',
};

const toHex = (c?: string, role?: GrayboxObject['role']): string =>
  c && /^#?[0-9a-fA-F]{6}$/.test(c)
    ? (c.startsWith('#') ? c : `#${c}`)
    : (role ? ROLE_COLORS[role] : '#9ca3af');

// ============================================================================
// SCENE graybox pieces
// ============================================================================

const LayoutObject: React.FC<{ obj: GrayboxObject }> = ({ obj }) => {
  const color = toHex(obj.color, obj.role);
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

  // planes default to facing +Z; floor/ceiling role should lie flat (rotate X)
  const needsFlat = obj.type === 'plane' && (obj.role === 'floor' || obj.role === 'ceiling');
  const rotation = needsFlat && !rot ? [-Math.PI / 2, 0, 0] as [number, number, number] : rot;

  return (
    <group position={obj.position as [number, number, number]} rotation={rotation}>
      <mesh castShadow receiveShadow>
        {geometry}
        <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
      </mesh>
      {obj.label && (
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

const CharacterMarker: React.FC<{ char: GrayboxCharacter }> = ({ char }) => {
  const [x, z] = char.position;
  const facing = char.facing ?? 0;
  return (
    <group position={[x, 0, z]}>
      {/* capsule body (height 1.6, standing roughly human-scale in this toy scene) */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <capsuleGeometry args={[0.25, 1.0, 8, 16]} />
        <meshStandardMaterial color="#10b981" roughness={0.6} emissive="#064e3b" emissiveIntensity={0.15} />
      </mesh>
      {/* facing arrow: a small cone pointing +Z, rotated about Y by `facing` */}
      <mesh position={[0, 0.2, 0]} rotation={[0, facing, 0]}>
        <coneGeometry args={[0.12, 0.3, 12]} />
        <meshStandardMaterial color="#34d399" />
      </mesh>
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

const ShotCanvas: React.FC<{
  graybox: GrayboxData;
  theme: 'light' | 'dark';
  progressRef: React.MutableRefObject<number>;
}> = ({ graybox, theme, progressRef }) => {
  const camera = graybox.camera!;
  const path = usePath(camera);
  const lookPath = camera.movement?.lookPath && camera.movement.lookPath.length
    ? camera.movement.lookPath as [number, number, number][]
    : undefined;

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

  return (
    <Canvas
      shadows
      camera={{ position: orbitPos, fov: 50 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.0} />

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
}> = ({ camera, playing, onTogglePlay, onReset, onSeek, progress }) => {
  const type = camera.movement?.type ?? 'static';
  const duration = camera.movement?.duration ?? 0;
  const isStatic = type === 'static';

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
    </div>
  );
};

// ============================================================================
// Main component
// ============================================================================

export const Graybox3DView: React.FC<Graybox3DViewProps> = ({ graybox, theme }) => {
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
  const hasScene = graybox.kind === 'scene' && ((graybox.layout?.length ?? 0) > 0 || (graybox.characters?.length ?? 0) > 0);
  const hasShot = graybox.kind === 'shot' && !!graybox.camera;
  if (!hasScene && !hasShot) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 dark:text-gray-600 mb-2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" /></svg>
        <p className="text-xs text-gray-400 dark:text-gray-500">No renderable graybox data</p>
      </div>
    );
  }

  // shot playback state
  const isShot = graybox.kind === 'shot';
  const [playing, setPlaying] = useState(false);
  const [progressUI, setProgressUI] = useState(0);
  const progressRef = useRef(0);
  const rafStartRef = useRef<number | null>(null);

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

  const canvasBg = theme === 'dark' ? 'bg-gray-900/40' : 'bg-gray-50';

  return (
    <div className="flex flex-col h-full">
      <div className={`flex-1 min-h-0 ${canvasBg}`}>
        {graybox.kind === 'scene' ? (
          <SceneCanvas graybox={graybox} theme={theme} />
        ) : (
          <ShotCanvas graybox={graybox} theme={theme} progressRef={progressRef} />
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
        />
      )}
    </div>
  );
};
