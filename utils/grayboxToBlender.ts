import { GrayboxData, GrayboxObject } from '../types';
import { whiteModelCharColor } from './whiteModelPrompt';

/**
 * grayboxToBlender — compile ONE block's graybox payload into a self-contained
 * Blender Python script (phase-1 one-way export; the id-anchored round-trip is
 * phase 2). The user runs the script in Blender's Scripting tab and gets the
 * graybox rebuilt as real objects — characters as colored capsules with facing
 * cones, and for shots a real camera keyframed along the movement curves.
 *
 * Design rules:
 *  - ALL coordinate conversion happens here; the emitted .py is "dumb" data.
 *      position: (x, y, z)_yUp -> (x, -z, y)_zUp   (proper rotation, det = +1)
 *      euler:    (rx, ry, rz)  -> (rx, -rz, ry)     (exact for single-axis
 *      rotations — the dominant case in AI payloads)
 *      planes:   vertical base in three.js vs horizontal base in Blender, so
 *                plane eulers carry a +pi/2 X baseline (flat planes with no
 *                rotation cancel to exactly (0,0,0))
 *  - The script builds meshes with bmesh directly (no bpy.ops), so it runs
 *    both from the Scripting tab AND headless via
 *    `blender --background --python script.py` (the future Tauri CLI path).
 *  - Idempotent: re-running wipes and rebuilds the "StoryFlow_Graybox"
 *    collection, leaving everything else in the .blend untouched.
 *  - Character capsule colors reuse whiteModelCharColor so the Blender blocking
 *    reads with the SAME capsule->reference-image mapping as the white model.
 */

export interface BlenderExportInput {
  kind: 'scene' | 'shot';
  /** The block's own payload (shot: supplies the camera). */
  graybox: GrayboxData;
  /** Owning scene's graybox — shot mode renders THIS geometry under the camera
   *  (mirrors Graybox3DView's POV behavior). */
  sceneGraybox?: GrayboxData | null;
  sceneHeading?: string;
  beat?: { type: string; content: string } | null;
}

/** Semantic role colors — mirrors ROLE_COLORS in Graybox3DView. */
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

/** Vertical FOV per shot type — mirrors the viewer's povFov switch. */
const POV_FOV: Record<string, number> = {
  'extreme-wide': 30,
  'wide': 38,
  'medium': 48,
  'close-up': 55,
  'extreme-close-up': 62,
  'over-the-shoulder': 48,
  'top-down': 55,
  'pov': 48,
};

const DEFAULT_FPS = 24;
/** Fallback duration for shots with a 0/missing movement.duration. */
const FALLBACK_SECONDS = 3;

type V3 = [number, number, number];

/** y-up -> z-up point transform. */
const toB = (p: V3): V3 => [p[0], -p[2], p[1]];

const r6 = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(6).replace(/\.?0+$/, '') || '0';

const vec = (p: V3): string => `(${p.map(r6).join(', ')})`;

/** Escape a JS string for embedding inside generated Python source. */
const py = (s: string): string => JSON.stringify(s);

interface ObjectEntry {
  name: string;
  sfId: string;
  kind: 'box' | 'plane' | 'cylinder' | 'sphere';
  role: string;
  label?: string;
  loc: V3;      // Blender space, object center
  scale: V3;    // unit-geometry scale (Blender axes: X=x, Y=-z, Z=y of source)
  rot: V3;      // Blender euler
  hex: string;
}

const convertObject = (o: GrayboxObject): ObjectEntry | null => {
  if (!Array.isArray(o.position) || !Array.isArray(o.size)) return null;
  const [x, y, z] = o.position;
  const [w, h, d] = o.size;
  if (![x, y, z, w, h, d].every(Number.isFinite)) return null;
  const rot = (o.rotation && o.rotation.every(Number.isFinite) ? o.rotation : [0, 0, 0]) as V3;
  // three.js: plane base is VERTICAL (faces +Z); Blender plane base is
  // horizontal. Baseline X rotation +pi/2 reconciles them; a flat floor plane
  // with three's [-pi/2,0,0] cancels to exactly zero.
  const rotB: V3 = o.type === 'plane'
    ? [Math.PI / 2 + rot[0], -rot[2], rot[1]]
    : [rot[0], -rot[2], rot[1]];
  // three (w, h, d) axes -> Blender (X, Y, Z): local Y becomes -z, so d rides Y.
  // Per-kind unit geometry (all span ±0.5 on their axes in the generated
  // script), so scale carries the real dims — matching the viewer exactly:
  //   box      scale (w, d, h)
  //   plane    scale (w, h, 1)
  //   cylinder radius = max(w,d)/2, height h -> scale (R, R, h)
  //   sphere   radius = max(w,d)/2          -> scale (R, R, R)
  const R = Math.max(w, d) / 2;
  const scale: V3 =
    o.type === 'box' ? [w, d, h]
      : o.type === 'plane' ? [w, h, 1]
        : o.type === 'cylinder' ? [R, R, h]
          : [R, R, R];
  return {
    name: `SF_${o.id}`,
    sfId: o.id,
    kind: o.type,
    role: o.role,
    label: o.label,
    loc: toB([x, y, z]),
    scale,
    rot: rotB,
    hex: toHex(o.color, o.role),
  };
};

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Polyline -> arc-length-parameterized keyframes (constant speed across the
 *  whole path, exactly like the viewer's `pointAt` interpolation). */
const pathToKeys = (path: V3[], seconds: number, fps: number): Array<{ f: number; p: V3 }> => {
  if (path.length === 0) return [];
  if (path.length === 1) return [{ f: 1, p: toB(path[0]) }];
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = dist(path[i], path[i + 1]);
    segs.push(d);
    total += d;
  }
  const end = Math.max(1, seconds * fps);
  if (total <= 1e-9) return [{ f: 1, p: toB(path[0]) }];
  const keys: Array<{ f: number; p: V3 }> = [];
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += segs[i - 1];
    keys.push({ f: Math.max(1, Math.round((acc / total) * end)), p: toB(path[i]) });
  }
  // guarantee the last key lands on the final frame
  keys[keys.length - 1].f = Math.round(end);
  return keys;
};

/** Compile one graybox payload into a runnable Blender script. */
export const buildBlenderScript = (input: BlenderExportInput): string => {
  const { kind, graybox, sceneGraybox, sceneHeading, beat } = input;

  const isShot = kind === 'shot' && !!graybox.camera && !graybox.error;
  const geo: GrayboxData | null = isShot
    ? (sceneGraybox && !sceneGraybox.error ? sceneGraybox : null)
    : (graybox.error ? null : graybox);

  const objects = (geo?.layout ?? []).map(convertObject).filter((o): o is ObjectEntry => !!o);
  const characters = (geo?.characters ?? []).filter(
    (c) => Array.isArray(c.position) && c.position.every(Number.isFinite),
  );

  const cam = isShot ? graybox.camera! : null;
  const duration = cam && cam.movement?.duration > 0 ? cam.movement.duration : FALLBACK_SECONDS;
  const bodyPath: V3[] = cam
    ? (cam.movement?.path?.length ? cam.movement.path : [cam.position]).filter((p) => Array.isArray(p) && p.every(Number.isFinite))
    : [];
  const lookPath: V3[] = cam
    ? (cam.movement?.lookPath?.length ? cam.movement.lookPath : [cam.lookAt]).filter((p) => Array.isArray(p) && p.every(Number.isFinite))
    : [];
  const fov = cam ? (POV_FOV[cam.shotType] ?? 48) : 48;

  const bodyKeys = cam ? pathToKeys(bodyPath, duration, DEFAULT_FPS) : [];
  const lookKeys = cam ? pathToKeys(lookPath, duration, DEFAULT_FPS) : [];

  const header: string[] = [];
  header.push('# StoryFlow graybox -> Blender (one-way export)');
  header.push(`# kind: ${kind}`);
  if (sceneHeading) header.push(`# scene: ${sceneHeading.replace(/\s+/g, ' ').slice(0, 120)}`);
  if (isShot && beat) header.push(`# beat: [${beat.type}] ${beat.content.replace(/\s+/g, ' ').slice(0, 120)}`);
  if (cam?.shotDescription) header.push(`# shot intent: ${cam.shotDescription.replace(/\s+/g, ' ').slice(0, 120)}`);
  header.push(`# generated: ${new Date().toISOString()}`);
  header.push('#');
  header.push('# Source data is meters / y-up (Three.js); this script builds Blender');
  header.push('# z-up equivalents via (x,y,z) -> (x,-z,y). Re-running rebuilds the');
  header.push('# "StoryFlow_Graybox" collection from scratch and leaves the rest of');
  header.push('# your file untouched. View the shot camera with Numpad 0.');

  const objectEntries = objects.map((o) => {
    const lines: string[] = [];
    lines.push('    {');
    lines.push(`        'name': ${py(o.name)}, 'sf_id': ${py(o.sfId)}, 'kind': '${o.kind}',`);
    lines.push(`        'role': ${py(o.role)}, 'label': ${py(o.label ?? '')}, 'hex': '${o.hex}',`);
    lines.push(`        'loc': ${vec(o.loc)}, 'scale': ${vec(o.scale)}, 'rot': (${o.rot.map(r6).join(', ')}),`);
    lines.push('    },');
    return lines.join('\n');
  }).join('\n');

  const charEntries = characters.map((c, i) => {
    const [x, z] = c.position;
    const facing = Number.isFinite(c.facing) ? (c.facing as number) : 0;
    const hex = whiteModelCharColor(i).hex;
    const lines: string[] = [];
    lines.push('    {');
    lines.push(`        'name': ${py(c.name)}, 'pose': ${py(c.pose ?? '')}, 'hex': '${hex}',`);
    lines.push(`        'loc': ${vec(toB([x, 0, z]))}, 'facing': ${r6(facing)},`);
    lines.push('    },');
    return lines.join('\n');
  }).join('\n');

  const bodyKeyLines = bodyKeys.map((k) => `    (${Math.round(k.f)}, ${vec(k.p)}),`).join('\n');
  const lookKeyLines = lookKeys.map((k) => `    (${Math.round(k.f)}, ${vec(k.p)}),`).join('\n');

  const pyScript = `${header.join('\n')}
import bpy
import bmesh
import math
from mathutils import Matrix

COLLECTION = 'StoryFlow_Graybox'
FPS = max(1, int(bpy.context.scene.render.fps or ${DEFAULT_FPS}))

# ---- idempotent rebuild -----------------------------------------------------
old = bpy.data.collections.get(COLLECTION)
if old:
    for ob in list(old.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.collections.remove(old)
col = bpy.data.collections.new(COLLECTION)
bpy.context.scene.collection.children.link(col)


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


def make_material(name, h):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    r, g, b = hex_rgb(h)
    m.diffuse_color = (r, g, b, 1.0)
    for node in m.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            node.inputs['Base Color'].default_value = (r, g, b, 1.0)
            node.inputs['Roughness'].default_value = 0.85
            break
    return m


def new_mesh_object(name, h):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.data.materials.append(make_material(name, h))
    return ob


def fill(bm, create, **kw):
    """Run a bmesh.ops.create_* primitive and return only its new verts."""
    before = set(bm.verts)
    create(bm, **kw)
    return [v for v in bm.verts if v not in before]


def place(ob, loc, rot, scale):
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = scale


def build_geometry(ob, kind):
    """Unit primitive in a fresh bmesh (all span +/-0.5 on their axes)."""
    bm = bmesh.new()
    if kind == 'box':
        fill(bm, bmesh.ops.create_cube, size=1.0)
    elif kind == 'plane':
        fill(bm, bmesh.ops.create_grid, x_segments=1, y_segments=1, size=0.5)
    elif kind == 'cylinder':
        fill(bm, bmesh.ops.create_cone, cap_ends=True, cap_tris=False,
             segments=24, radius1=1.0, radius2=1.0, depth=1.0)
    else:  # sphere
        fill(bm, bmesh.ops.create_uvsphere, u_segments=24, v_segments=16, radius=1.0)
    bm.to_mesh(ob.data)
    bm.free()


# ---- layout objects ---------------------------------------------------------
OBJECTS = [
${objectEntries || '    # (no layout objects)'}
]
for o in OBJECTS:
    ob = new_mesh_object(o['name'], o['hex'])
    build_geometry(ob, o['kind'])
    place(ob, o['loc'], o['rot'], o['scale'])
    ob['sf_id'] = o['sf_id']
    ob['sf_role'] = o['role']
    if o['label']:
        ob['sf_label'] = o['label']

# ---- character capsules (colors match the white-model capsule mapping) ------
CHARACTERS = [
${charEntries || '    # (no character blocking)'}
]
for i, c in enumerate(CHARACTERS):
    bm = bmesh.new()
    body = fill(bm, bmesh.ops.create_cone, cap_ends=True, cap_tris=False,
                segments=24, radius1=0.25, radius2=0.25, depth=1.0)
    bmesh.ops.translate(bm, verts=body, vec=(0, 0, 0.8))
    top = fill(bm, bmesh.ops.create_uvsphere, u_segments=20, v_segments=12, radius=0.25)
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, 1.3))
    bot = fill(bm, bmesh.ops.create_uvsphere, u_segments=20, v_segments=12, radius=0.25)
    bmesh.ops.translate(bm, verts=bot, vec=(0, 0, 0.3))
    # facing cone: apex tilted from +Z to horizontal, then aimed by 'facing'
    cone = fill(bm, bmesh.ops.create_cone, cap_ends=True, cap_tris=False,
                segments=12, radius1=0.12, radius2=0.0, depth=0.3)
    bmesh.ops.rotate(bm, verts=cone, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=cone, vec=(0, 0, 0.2))
    name = 'CHAR_' + c['name']
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.data.materials.append(make_material(name, c['hex']))
    ob.location = c['loc']
    ob.rotation_euler = (0, 0, c['facing'])
    ob['sf_character'] = c['name']
    if c['pose']:
        ob['sf_pose'] = c['pose']
${characters.length ? '' : "# (none)"}

# ---- shot camera (only for shot payloads) -----------------------------------
${cam ? `CAMERA_BODY_KEYS = [
${bodyKeyLines || '    # (static body)'}
]
CAMERA_LOOK_KEYS = [
${lookKeyLines || '    # (static aim)'}
]
DURATION = ${r6(duration)}

cam_data = bpy.data.cameras.new('SF_Camera')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle = math.radians(${fov})
cam_obj = bpy.data.objects.new('SF_Camera', cam_data)
col.objects.link(cam_obj)

if CAMERA_BODY_KEYS:
    cam_obj.location = CAMERA_BODY_KEYS[0][1]
    for f, p in CAMERA_BODY_KEYS:
        cam_obj.keyframe_insert(data_path='location', frame=f)
else:
    cam_obj.location = (0.0, 0.0, 1.6)

aim = bpy.data.objects.new('SF_Camera_Aim', None)
col.objects.link(aim)
if CAMERA_LOOK_KEYS:
    aim.location = CAMERA_LOOK_KEYS[0][1]
    for f, p in CAMERA_LOOK_KEYS:
        aim.keyframe_insert(data_path='location', frame=f)
else:
    aim.location = (0.0, 0.0, 1.0)

con = cam_obj.constraints.new('TRACK_TO')
con.target = aim
con.track_axis = 'TRACK_NEGATIVE_Z'
con.up_axis = 'UP_Y'

# linear interpolation: constant speed along the polyline, exactly like the
# in-app player (Blender defaults to bezier, which would ease and overshoot)
for ob2 in (cam_obj, aim):
    try:
        for fc in ob2.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    except Exception:
        pass

end_frame = max(2, int(round(DURATION * FPS)))
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = end_frame
bpy.context.scene.camera = cam_obj` : '# (scene payload — orbit the viewport; no camera exported)'}

# ---- light so the graybox reads in rendered views ---------------------------
if not any(ob.type == 'LIGHT' for ob in bpy.data.objects):
    ld = bpy.data.lights.new('SF_Sun', 'SUN')
    ld.energy = 3.0
    lo = bpy.data.objects.new('SF_Sun', ld)
    col.objects.link(lo)

print('StoryFlow graybox: ${objects.length} objects, ${characters.length} characters${cam ? ', camera' : ''} -> collection "' + COLLECTION + '"')
`;

  return pyScript;
};

/** Download the generated script as a .py file. */
export const downloadBlenderScript = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'text/x-python' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Filename stem sanitizer (same rules as exportData's safeName). */
const safeStem = (s: string): string =>
  s.replace(/[^a-z0-9一-龥]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'graybox';

export const blenderScriptFilename = (title: string, kind: 'scene' | 'shot'): string =>
  `${safeStem(title)}_graybox_${kind}.py`;
