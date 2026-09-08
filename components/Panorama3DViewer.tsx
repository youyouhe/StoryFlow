import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';

/**
 * Panorama3DViewer (P4, design §2) — equirectangular 360° viewer.
 * Reuses the three.js dependency already pulled in by Graybox3DView:
 * camera at the center of a BackSide sphere; pointer drag = yaw/pitch,
 * wheel = fov. No three/examples controls (bundle size).
 */

interface Panorama3DViewerProps {
  src: string;                 // signed URL (assets readUrl)
  initialYaw?: number;         // radians, default 0
  initialPitch?: number;       // radians, default 0
  maxFov?: number;             // default 100
  minFov?: number;             // default 30
  onViewChange?: (yaw: number, pitch: number, fov: number) => void;
  onLoaded?: (w: number, h: number) => void;  // 2:1 ratio check is the caller's
  className?: string;
}

const DEG = Math.PI / 180;

/** Inner sphere + drag/wheel-driven camera. lives inside <Canvas>. */
function PanoramaScene({
  src, yawRef, pitchRef, fovRef, onLoaded, onViewChange
}: {
  src: string;
  yawRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  fovRef: React.MutableRefObject<number>;
  onLoaded?: (w: number, h: number) => void;
  onViewChange?: (yaw: number, pitch: number, fov: number) => void;
}) {
  const { camera, gl } = useThree();
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      src,
      tex => {
        if (cancelled) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
        const img = tex.image as { width?: number; height?: number } | undefined;
        if (onLoaded && img?.width && img?.height) onLoaded(img.width, img.height);
      },
      undefined,
      () => { if (!cancelled) setError('load-failed'); }
    );
    return () => { cancelled = true; };
  }, [src, onLoaded]);

  // Camera follows the refs each frame; input handlers live on the canvas DOM.
  useFrame(() => {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current;
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== fovRef.current) {
      cam.fov = fovRef.current;
      cam.updateProjectionMatrix();
    }
  });

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const FOV_STEP = 4;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const SPEED = 0.0031; // rad/px ≈ fov-adjusted feel at default 75
      yawRef.current -= (e.clientX - lastX) * SPEED;
      pitchRef.current -= (e.clientY - lastY) * SPEED;
      pitchRef.current = Math.max(-89 * DEG, Math.min(89 * DEG, pitchRef.current));
      lastX = e.clientX;
      lastY = e.clientY;
      onViewChange?.(yawRef.current, pitchRef.current, fovRef.current);
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      fovRef.current = Math.max(30, Math.min(100, fovRef.current + (e.deltaY > 0 ? FOV_STEP : -FOV_STEP)));
      onViewChange?.(yawRef.current, pitchRef.current, fovRef.current);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, yawRef, pitchRef, fovRef, onViewChange]);

  if (error) return null;
  return texture ? (
    <mesh>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  ) : null;
}

export const Panorama3DViewer: React.FC<Panorama3DViewerProps> = ({
  src,
  initialYaw = 0,
  initialPitch = 0,
  maxFov = 100,
  minFov = 30,
  onViewChange,
  onLoaded,
  className
}) => {
  const yawRef = useRef(initialYaw);
  const pitchRef = useRef(initialPitch);
  const fovRef = useRef(Math.min(maxFov, Math.max(minFov, 75)));
  const [loading, setLoading] = useState(true);

  // Stable callback refs so the scene effects don't rebind per render.
  const loadedCb = useMemo(() => onLoaded, [onLoaded]);
  const viewCb = useMemo(() => onViewChange, [onViewChange]);

  return (
    <div className={className} style={{ position: 'relative', touchAction: 'none' }}>
      <Canvas
        camera={{ fov: fovRef.current, position: [0, 0, 0.01], near: 0.1, far: 1100 }}
        gl={{ antialias: false }}
        onCreated={({ scene }) => { scene.background = new THREE.Color('#000'); }}
      >
        <PanoramaScene
          src={src}
          yawRef={yawRef}
          pitchRef={pitchRef}
          fovRef={fovRef}
          onLoaded={(w, h) => { setLoading(false); loadedCb?.(w, h); }}
          onViewChange={viewCb}
        />
      </Canvas>
      {loading && !src.includes('data:') && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-white/70" />
        </div>
      )}
    </div>
  );
};
