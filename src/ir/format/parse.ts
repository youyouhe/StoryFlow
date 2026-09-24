/**
 * ③反向入口(P7)—— StoryFlowXML → StoryFlowIR(`renderStoryFlowXML` 的逆)。
 *
 * 双固定点 golden 锁定:parse(render(ir)) ≡ ir、render(parse(xml)) ≡ xml。
 * 词锚**从散文恢复**:时刻标记 `@{id!}` 的插入位置即 wordIndex(对去标记前缀
 * 文本用 splitAnchorWords 数 token;渲染保证标记落在 token 边界)。v0.1 文档
 * 照常可解析(新节/新属性缺省走回退)。
 *
 * 记档:边缘空白 trim 归一(pretty 缩进所致);词锚降级形态(selection.end)
 * 不可逆回 word;`@{` 为标记语法保留字。
 */
import type {
  StoryFlowIR, Shot, FrameDesc, CameraMove, RefRegistry, CharacterRef, PropRef,
  SceneRef, ExtraStyleRef, ActionRef, SpatialLayout, SpatialObject, SpatialCharacter,
  TtsClip, BgmClip, SfxClip, Transition, ShotStatus, GenerationParams, AssetProvenance,
} from '../types';
import type { WordTimingCorrection } from '../audio/types';
import type { IRVersion } from '../types';
import { splitAnchorWords } from '../shared';
import type { PriceBooks, StoryFlowAnnotations } from '../annotations';
import { readXml, type XmlNode } from './xmlReader';

const MARK_RE = /@\{([^}]*)\}/g;
const unmark = (s: string): string => s.replace(MARK_RE, '');

const num = (s: string | undefined, what: string): number => {
  const n = Number(s);
  if (s == null || Number.isNaN(n)) throw new Error(`StoryFlowXML: 非法数值 ${what}=${s}`);
  return n;
};
const optNum = (s: string | undefined): number | undefined =>
  s == null ? undefined : num(s, 'number');

const vec3 = (s: string | undefined, what: string): [number, number, number] => {
  const parts = (s ?? '').split(',').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`StoryFlowXML: 非法三元组 ${what}=${s}`);
  }
  return [parts[0], parts[1], parts[2]];
};

const selToShotId = (sid: string): string => `SHOT_${sid.slice('shot-'.length)}`;
const refToSid = (ref: string, scriptId: string, kind: 'selection' | 'moment'): string => {
  // 允许 .dialogue/.start/.end 接尾(绑定与端点引用共用捕获)
  const re = new RegExp(`^\\{${scriptId}\\.${kind}\\.([^.}]+)(?:\\.(?:dialogue|start|end))?\\}$`);
  const m = re.exec(ref);
  if (!m) throw new Error(`StoryFlowXML: 非法锚引用 ${ref}`);
  return m[1];
};

const SHOT_STATUSES: ShotStatus[] = ['draft', 'generated', 'locked', 'exported'];

const parseAsset = (attrs: Record<string, string>): AssetProvenance | undefined => {
  const a: AssetProvenance = {};
  if (attrs['asset-id']) a.assetId = attrs['asset-id'];
  if (attrs['source']) a.source = attrs['source'] as AssetProvenance['source'];
  if (attrs['source-prompt']) a.sourcePrompt = attrs['source-prompt'];
  if (attrs['version-group']) a.versionGroup = attrs['version-group'];
  const v = optNum(attrs['version']);
  if (v != null) a.version = v;
  return Object.keys(a).length ? a : undefined;
};

const descriptionOf = (node: XmlNode): string =>
  node.children.find(c => c.tag === 'description')?.text.trim() ?? '';

const parseCamera = (node: XmlNode): CameraMove => {
  const mvNode = node.children.find(c => c.tag === 'movement');
  if (!mvNode) throw new Error('StoryFlowXML: camera 缺 movement');
  const pathNode = mvNode.children.find(c => c.tag === 'path');
  const lookNode = mvNode.children.find(c => c.tag === 'look-path');
  const pointsOf = (p: XmlNode | undefined): [number, number, number][] | undefined =>
    p ? p.children.filter(c => c.tag === 'point').map(c => vec3(c.text.trim(), 'point')) : undefined;
  const movement: CameraMove['movement'] = {
    type: mvNode.attrs['type'] as CameraMove['movement']['type'],
    duration: num(mvNode.attrs['duration'], 'movement.duration'),
  };
  const ts = optNum(mvNode.attrs['target-seconds']);
  if (ts != null) movement.targetSeconds = ts;
  const path = pointsOf(pathNode);
  if (path?.length) movement.path = path;
  const lookPath = pointsOf(lookNode);
  if (lookPath?.length) movement.lookPath = lookPath;
  const cam: CameraMove = {
    shotType: node.attrs['shot-type'] as CameraMove['shotType'],
    position: vec3(node.attrs['position'], 'camera.position'),
    lookAt: vec3(node.attrs['look-at'], 'camera.lookAt'),
    movement,
  };
  if (node.attrs['description']) cam.description = node.attrs['description'];
  if (node.attrs['focus']) cam.focus = node.attrs['focus'];
  return cam;
};

interface ParsedDocument {
  ir: StoryFlowIR;
  annotations?: StoryFlowAnnotations;
}

/** P10:全量解析(IR + 可选创作注释节)。 */
export const parseStoryFlowDocument = (xml: string): ParsedDocument => {
  const root = readXml(xml);
  if (root.tag !== 'storyflow') throw new Error(`StoryFlowXML: 根元素应为 <storyflow>,实为 <${root.tag}>`);

  const version = (root.attrs['ir-version'] ?? '0.1.0') as IRVersion;
  if (version !== '0.1.0' && version !== '0.2.0') {
    throw new Error(`StoryFlowXML: 未知 ir-version ${version}`);
  }
  const mode = root.attrs['mode'] === 'express' ? 'express' as const
    : root.attrs['mode'] === 'pro' || root.attrs['mode'] == null ? 'pro' as const
      : (() => { throw new Error(`StoryFlowXML: 非法 mode ${root.attrs['mode']}`); })();

  const section = (tag: string): XmlNode | undefined => root.children.find(c => c.tag === tag);
  const scriptNode = section('script');
  if (!scriptNode) throw new Error('StoryFlowXML: 缺 <script>');
  const scriptId = scriptNode.attrs['id'] ?? 'story';

  // ---- script:标记状态机(选区开合/时刻落点/逐字文本) ---------------------
  interface Draft {
    sid: string;
    motionRaw: string;
    dialogueRaw: string;
    displayRaw?: string;
    spokenRaw?: string | null;
    roleName?: string;
    sawRole: boolean;
  }
  const drafts: Draft[] = [];
  const momentAt = new Map<string, { sid: string; wordIndex: number }>();
  // 状态容器:feedText 闭包内赋值会让 TS 对 let 过度窄化,属性访问不受此害
  const state: { cur: Draft | null } = { cur: null };

  // 域路由**逐 chunk**判定:一个文本段可跨「闭上一镜+开下一镜」,按段路由会
  // 把下一镜的 motion 误喂 dialogue 域;role 内文本强制 dialogue。
  const domainOf = (force?: 'dialogue'): 'motion' | 'dialogue' =>
    force ?? (state.cur?.sawRole ? 'dialogue' : 'motion');
  const appendChunk = (chunk: string, into: 'motion' | 'dialogue'): void => {
    const cur = state.cur;
    if (!cur || !chunk) return;
    if (into === 'motion') cur.motionRaw += chunk;
    else cur.dialogueRaw += chunk;
  };
  const feedText = (raw: string, force?: 'dialogue'): void => {
    let last = 0;
    for (const m of raw.matchAll(MARK_RE)) {
      appendChunk(raw.slice(last, m.index), domainOf(force));
      last = (m.index ?? 0) + m[0].length;
      const name = m[1];
      if (name.startsWith('/')) {
        if (!state.cur || state.cur.sid !== name.slice(1)) {
          throw new Error(`StoryFlowXML: 选区错配 @{/${name.slice(1)}}`);
        }
        drafts.push(state.cur);
        state.cur = null;
      } else if (name.endsWith('!')) {
        const id = name.slice(0, -1);
        if (!state.cur) throw new Error(`StoryFlowXML: 时刻标记 @{${name}} 在选区外`);
        // 标记落在 token 边界:去标记前缀的 token 数 = wordIndex
        const into = domainOf(force);
        const acc = into === 'motion' ? state.cur.motionRaw : state.cur.dialogueRaw;
        momentAt.set(id, { sid: state.cur.sid, wordIndex: splitAnchorWords(unmark(acc)).length });
      } else {
        if (state.cur) throw new Error(`StoryFlowXML: 嵌套选区 @{${name}}`);
        state.cur = { sid: name, motionRaw: '', dialogueRaw: '', sawRole: false };
      }
    }
    appendChunk(raw.slice(last), domainOf(force));
  };

  for (const part of scriptNode.parts) {
    if (typeof part === 'string') {
      feedText(part);
    } else if (part.tag === 'role') {
      if (!state.cur) throw new Error('StoryFlowXML: <role> 在选区外');
      state.cur.sawRole = true;
      state.cur.roleName = part.attrs['name'] ?? '';
      // P12 显读分离:say 属性载朗读(词锚标记随属性);文本载显示
      const say = part.attrs['say'];
      state.cur.spokenRaw = say ?? null;
      feedText(say ?? part.text, 'dialogue');
      if (say != null && part.text.trim()) state.cur.displayRaw = part.text;
    } else {
      throw new Error(`StoryFlowXML: <script> 内不支持 <${part.tag}>`);
    }
  }
  if (state.cur) throw new Error(`StoryFlowXML: 选区 @{${state.cur.sid}} 未闭合`);

  // ---- refs / spatial / generation / audio / transition / film -------------
  const refsNode = section('refs');
  const parseRegistry = (): RefRegistry => {
    const reg: RefRegistry = { characters: [], props: [], scenes: [], styles: [] };
    if (!refsNode) return reg;
    for (const n of refsNode.children) {
      const base = { id: n.attrs['id'], name: n.attrs['name'], description: descriptionOf(n) };
      if (n.attrs['id'] == null || n.attrs['name'] == null) {
        throw new Error(`StoryFlowXML: <${n.tag}> 缺 id/name`);
      }
      const asset = parseAsset(n.attrs);
      if (n.tag === 'character') {
        const c: CharacterRef = { ...base, ...(n.attrs['variant'] ? { variant: n.attrs['variant'] } : {}), ...(asset ? { asset } : {}) };
        reg.characters.push(c);
      } else if (n.tag === 'prop') {
        reg.props.push({ ...base, ...(asset ? { asset } : {}) } as PropRef);
      } else if (n.tag === 'scene') {
        reg.scenes.push({
          ...base,
          ...(n.attrs['scene-heading'] ? { sceneHeading: n.attrs['scene-heading'] } : {}),
          ...(n.attrs['spatial-id'] ? { spatialId: n.attrs['spatial-id'] } : {}),
          ...(asset ? { asset } : {}),
        } as SceneRef);
      } else if (n.tag === 'style-ref') {
        reg.styles.push({ ...base, ...(asset ? { asset } : {}) } as ExtraStyleRef);
      } else if (n.tag === 'action') {
        const list = reg.actions ?? (reg.actions = []);
        list.push({ ...base, ...(asset ? { asset } : {}) } as ActionRef);
      }
    }
    return reg;
  };

  const parseSpatial = (): SpatialLayout[] => {
    const node = section('spatial');
    if (!node) return [];
    return node.children.filter(c => c.tag === 'layout').map(layout => ({
      id: layout.attrs['id'],
      sceneHeading: layout.attrs['scene-heading'],
      objects: layout.children.filter(c => c.tag === 'object').map(o => {
        const obj: SpatialObject = {
          id: o.attrs['id'],
          type: o.attrs['type'] as SpatialObject['type'],
          role: o.attrs['role'] as SpatialObject['role'],
          position: vec3(o.attrs['position'], 'object.position'),
          size: vec3(o.attrs['size'], 'object.size'),
        };
        if (o.attrs['label']) obj.label = o.attrs['label'];
        if (o.attrs['rotation']) obj.rotation = vec3(o.attrs['rotation'], 'object.rotation');
        if (o.attrs['color']) obj.color = o.attrs['color'];
        return obj;
      }),
      characters: layout.children.filter(c => c.tag === 'character').map(c => {
        const ch: SpatialCharacter = {
          name: c.attrs['name'],
          position: ((): [number, number] => {
            const p = (c.attrs['position'] ?? '').split(',').map(Number);
            if (p.length !== 2 || p.some(Number.isNaN)) throw new Error(`StoryFlowXML: 非法二元组 position=${c.attrs['position']}`);
            return [p[0], p[1]];
          })(),
        };
        const facing = optNum(c.attrs['facing']);
        if (facing != null) ch.facing = facing;
        if (c.attrs['pose']) ch.pose = c.attrs['pose'];
        return ch;
      }),
    }));
  };

  interface GenDraft {
    imagePrompt: string;
    shotDuration: number;
    status: ShotStatus;
    generation?: GenerationParams;
    firstFrame: FrameDesc;
    lastFrame?: FrameDesc;
    whiteModel?: Shot['whiteModel'];
    camera?: CameraMove;
    refBindings: string[];
  }
  const genBySid = new Map<string, GenDraft>();
  const genNode = section('generation');
  for (const n of genNode?.children ?? []) {
    if (n.tag !== 'shot') continue;
    const sid = refToSid(n.attrs['ref'] ?? '', scriptId, 'selection');
    const ff = n.children.find(c => c.tag === 'first-frame');
    const lf = n.children.find(c => c.tag === 'last-frame');
    const wm = n.children.find(c => c.tag === 'white-model');
    const cam = n.children.find(c => c.tag === 'camera');
    const vendor: Record<string, string | number | boolean> = {};
    for (const p of n.children.filter(c => c.tag === 'param')) {
      const t = p.attrs['type'];
      const raw = p.attrs['value'] ?? '';
      vendor[p.attrs['name']] = t === 'number' ? num(raw, 'param')
        : t === 'boolean' ? raw === 'true'
          : raw;
    }
    const backend = n.attrs['backend'];
    const status = (n.attrs['status'] ?? 'draft') as ShotStatus;
    if (!SHOT_STATUSES.includes(status)) throw new Error(`StoryFlowXML: 非法 status ${status}`);
    genBySid.set(sid, {
      imagePrompt: (ff?.text ?? '').trim(),
      shotDuration: num(n.attrs['seconds'], 'seconds'),
      status,
      ...(backend
        ? {
            generation: {
              backend: backend as GenerationParams['backend'],
              steps: optNum(n.attrs['steps']) ?? 1,
              ...(optNum(n.attrs['seed']) != null ? { seed: optNum(n.attrs['seed']) } : {}),
              ...(Object.keys(vendor).length ? { vendor } : {}),
            },
          }
        : {}),
      firstFrame: {
        description: ff?.attrs['description'] ?? '',
        ...(ff?.attrs['asset-id'] ? { assetId: ff.attrs['asset-id'] } : {}),
      },
      ...(lf ? {
        lastFrame: {
          description: lf.text.trim(),
          ...(lf.attrs['asset-id'] ? { assetId: lf.attrs['asset-id'] } : {}),
        } satisfies FrameDesc,
      } : {}),
      ...(wm ? {
        whiteModel: {
          ...(wm.attrs['asset-id'] ? { assetId: wm.attrs['asset-id'] } : {}),
          durationSeconds: num(wm.attrs['duration-seconds'], 'white-model.duration-seconds'),
        },
      } : {}),
      ...(cam ? { camera: parseCamera(cam) } : {}),
      refBindings: n.children.filter(c => c.tag === 'ref').map(c => c.text.trim()),
    });
    // firstFrame.description 缺省 = motion(装配时回填)
    void 0;
  }

  // ---- audio(装配需要 anchor clip 的 tts-floor → 先解) --------------------
  type Clip = TtsClip | BgmClip | SfxClip;
  const audio: Clip[] = [];
  const ttsFloorBySid = new Map<string, number>();
  const measuredBySid = new Map<string, number>();
  const audioNode = section('audio');
  for (const n of audioNode?.children ?? []) {
    const id = n.attrs['id'];
    if (!id) throw new Error(`StoryFlowXML: <${n.tag}> 缺 id`);
    if (n.tag === 'tts') {
      const isAnchor = n.attrs['text'] != null;
      // shot-id 属性直载 SHOT_001;缺省从绑定引用的 selection id 反推
      const shotId = n.attrs['shot-id']
        ?? (isAnchor ? selToShotId(refToSid(n.attrs['text'], scriptId, 'selection')) : undefined);
      if (!shotId) throw new Error(`StoryFlowXML: <tts ${id}> 无 shot-id 且非锚行`);
      const clip: TtsClip = {
        id,
        kind: 'tts',
        shotId,
        text: isAnchor ? '' : n.text.trim(), // 锚行 text 装配时回填(绑定 script)
        voice: n.attrs['voice'] ?? '',
        ...(n.attrs['role'] ? { character: n.attrs['role'] } : {}),
        ...(optNum(n.attrs['speed']) != null ? { speed: optNum(n.attrs['speed']) } : {}),
        ...(optNum(n.attrs['volume']) != null ? { volume: optNum(n.attrs['volume']) } : {}),
        ...(n.attrs['watermark'] != null ? { watermark: n.attrs['watermark'] === 'true' } : {}),
        ...(optNum(n.attrs['gain']) != null ? { gain: optNum(n.attrs['gain']) } : {}),
        ...(optNum(n.attrs['measured-seconds']) != null ? { measuredSeconds: optNum(n.attrs['measured-seconds']) } : {}),
      };
      if (isAnchor && n.attrs['tts-floor'] != null) ttsFloorBySid.set(shotId, num(n.attrs['tts-floor'], 'tts-floor'));
      if (optNum(n.attrs['measured-seconds']) != null) measuredBySid.set(shotId, optNum(n.attrs['measured-seconds'])!);
      audio.push(clip);
    } else if (n.tag === 'bgm') {
      const fromSid = refToSid(n.attrs['from'] ?? '', scriptId, 'selection');
      const toSid = n.attrs['to'] ? refToSid(n.attrs['to'], scriptId, 'selection') : undefined;
      const clip: BgmClip = {
        id,
        kind: 'bgm',
        fromShotId: selToShotId(fromSid),
        ...(toSid ? { toShotId: selToShotId(toSid) } : {}),
        prompt: n.text.trim(),
        ...(n.attrs['loop'] != null ? { loop: n.attrs['loop'] === 'true' } : {}),
        ...(optNum(n.attrs['gain']) != null ? { gain: optNum(n.attrs['gain']) } : {}),
      };
      audio.push(clip);
    } else if (n.tag === 'sfx') {
      const at = n.attrs['at'] ?? '';
      let anchor: SfxClip['anchor'];
      let shotId: string;
      const selMatch = /^\{[^}]+\.selection\.([^.]+)\.(start|end)\}$/.exec(at);
      const momMatch = /^\{[^}]+\.moment\.([^.]+)\}$/.exec(at);
      if (selMatch) {
        shotId = selToShotId(selMatch[1]);
        anchor = selMatch[2] === 'start' ? { kind: 'shot-start' } : { kind: 'shot-end' };
      } else if (momMatch) {
        const loc = momentAt.get(momMatch[1]);
        if (!loc) throw new Error(`StoryFlowXML: 悬空时刻引用 ${at}`);
        shotId = selToShotId(loc.sid);
        anchor = { kind: 'word', wordIndex: loc.wordIndex };
      } else {
        throw new Error(`StoryFlowXML: 非法 at 引用 ${at}`);
      }
      const clip: SfxClip = {
        id,
        kind: 'sfx',
        shotId,
        name: n.attrs['name'] ?? '',
        anchor,
        ...(n.attrs['missing'] != null ? { missing: n.attrs['missing'] === 'true' } : {}),
        ...(optNum(n.attrs['gain']) != null ? { gain: optNum(n.attrs['gain']) } : {}),
      };
      audio.push(clip);
    }
  }

  // ---- shots 装配(script 序 = 镜头序) -------------------------------------
  const shots: Shot[] = drafts.map((d, i) => {
    const sid = d.sid;
    const gen = genBySid.get(sid);
    if (!gen) throw new Error(`StoryFlowXML: <script> 的 @{${sid}} 无 <generation> 对应`);
    const motionPrompt = unmark(d.motionRaw).trim();
    const dialogueText = d.sawRole ? unmark(d.dialogueRaw).trim() : '';
    // 锚 tts 行回填 text(绑定 script,不复制正文)
    for (const clip of audio) {
      if (clip.kind === 'tts' && clip.shotId === selToShotId(sid) && clip.text === '') {
        clip.text = dialogueText;
      }
    }
    const measured = measuredBySid.get(selToShotId(sid));
    const ttsFloor = ttsFloorBySid.get(selToShotId(sid))
      ?? (measured != null ? Math.ceil(measured + 0.3) : 0);
    const firstFrame: FrameDesc = {
      description: gen.firstFrame.description || motionPrompt,
      ...(gen.firstFrame.assetId ? { assetId: gen.firstFrame.assetId } : {}),
    };
    const shot: Shot = {
      id: selToShotId(sid),
      sequence: i + 1,
      imagePrompt: gen.imagePrompt,
      motionPrompt,
      shotDuration: gen.shotDuration,
      firstFrame,
      refBindings: gen.refBindings,
      status: gen.status,
      ...(gen.lastFrame ? { lastFrame: gen.lastFrame } : {}),
      ...(gen.whiteModel ? { whiteModel: gen.whiteModel } : {}),
      ...(gen.camera ? { camera: gen.camera } : {}),
      ...(dialogueText ? {
        character: d.roleName,
        dialogue: {
          text: d.spokenRaw != null ? unmark(d.spokenRaw).trim() : dialogueText,
          ...(d.displayRaw != null && unmark(d.displayRaw).trim() !== dialogueText
            ? { display: unmark(d.displayRaw).trim() }
            : {}),
          ttsFloor,
        },
      } : {}),
      ...(gen.generation ? { generation: gen.generation } : {}),
    };
    return shot;
  });

  // ---- transitions ---------------------------------------------------------
  const transitions: Transition[] = [];
  const trNode = section('transition');
  trNode?.children.forEach((n, i) => {
    const to = refToSid(n.attrs['to'] ?? '', scriptId, 'selection');
    const from = n.attrs['from'] ? refToSid(n.attrs['from'], scriptId, 'selection') : undefined;
    const t: Transition = {
      id: `tr-${String(i + 1).padStart(3, '0')}`,
      type: n.tag as Transition['type'],
      target: selToShotId(to),
      ...(from ? { from: selToShotId(from) } : {}),
      ...(optNum(n.attrs['seconds']) != null ? { durationSeconds: optNum(n.attrs['seconds']) } : {}),
    };
    transitions.push(t);
  });

  // ---- style / film --------------------------------------------------------
  const styleNode = section('style');
  const style = styleNode
    ? {
        name: styleNode.attrs['name'] ?? '未设定',
        artStyle: styleNode.attrs['art-style'] ?? '未设定',
        scenePreset: styleNode.attrs['scene-preset'] ?? '未设定',
        promptPrefix: styleNode.attrs['prompt-prefix'] ?? '',
      }
    : { name: '未设定', artStyle: '未设定', scenePreset: '未设定', promptPrefix: '' };
  const title = section('film')?.attrs['title'];
  if (!title) throw new Error('StoryFlowXML: <film> 缺 title');

  // ---- annotations(P10 可选创作注释节) ------------------------------------
  const annNode = section('annotations');
  let annotations: StoryFlowAnnotations | undefined;
  if (annNode) {
    const timing: Record<string, WordTimingCorrection[]> = {};
    for (const t of annNode.children.filter(c => c.tag === 'timing')) {
      const clipId = t.attrs['clip-id'];
      if (!clipId) throw new Error('StoryFlowXML: <timing> 缺 clip-id');
      timing[clipId] = t.children.filter(c => c.tag === 'fix').map(f => ({
        tokenIndex: num(f.attrs['token-index'], 'token-index'),
        startMs: num(f.attrs['start-ms'], 'start-ms'),
        endMs: num(f.attrs['end-ms'], 'end-ms'),
      }));
    }
    const pbNode = annNode.children.find(c => c.tag === 'price-books');
    let priceBooks: PriceBooks | undefined;
    if (pbNode) {
      const img = pbNode.children.find(c => c.tag === 'image');
      const tts = pbNode.children.find(c => c.tag === 'tts');
      const bgm = pbNode.children.find(c => c.tag === 'bgm');
      priceBooks = {
        ...(img ? { image: { perImageFen: num(img.attrs['per-image-fen'], 'per-image-fen') } } : {}),
        ...(tts ? { tts: { perCharFen: num(tts.attrs['per-char-fen'], 'per-char-fen') } } : {}),
        ...(bgm ? { bgm: { perRequestFen: num(bgm.attrs['per-request-fen'], 'per-request-fen') } } : {}),
      };
      if (!Object.keys(priceBooks).length) priceBooks = undefined;
    }
    annotations = { version: '0.1.0', timing, ...(priceBooks ? { priceBooks } : {}) };
  }

  return {
    ir: {
      version,
      mode,
      title,
      style,
      refs: parseRegistry(),
      shots,
      audio,
      transitions,
      spatial: parseSpatial(),
    },
    ...(annotations ? { annotations } : {}),
  };
};

/** P7 签名保持:只取 IR(注释经 parseStoryFlowDocument 取)。 */
export const parseStoryFlowXML = (xml: string): StoryFlowIR => parseStoryFlowDocument(xml).ir;
