/**
 * 银盐晨光 Screenplay 形态 fixture(测试与 golden 生成器共用)。
 * 与 docs/storyflow-ir-example.json 同源故事:时间戳节拍 6/5/6/5/4、两句台词、
 * DISSOLVE+FADE OUT、词锚 shutter@3.742s。
 */
import type {
  Screenplay, ScriptBlock, RefImage, GrayboxData,
} from '../../types';

export const PREFIX = 'silver-halide film photograph, soft morning window light, warm golden tones, fine film grain, Kodak Portra palette, subtle vignette, 1990s southern China photo studio, ';

export const sceneGraybox: GrayboxData = {
  kind: 'scene',
  layout: [
    {
      id: 'counter', type: 'box', role: 'furniture', label: '柜台',
      position: [0, 0.55, 0.2], size: [2.4, 1.1, 0.8], color: '#8b5e3c',
    },
    {
      id: 'window_display', type: 'plane', role: 'window', label: '木质橱窗',
      position: [0, 1.5, -2.48], size: [3.2, 2.2, 0], color: '#d9c9a8',
    },
  ],
  characters: [{ name: '苏晚', position: [-0.8, 0.2], facing: 1.57, pose: 'standing' }],
};

export const shotGraybox: GrayboxData = {
  kind: 'shot',
  camera: {
    shotType: 'medium',
    shotDescription: '定场双人:陈默进门,苏晚柜台后回头',
    position: [-0.4, 1.4, 2.6],
    lookAt: [0.1, 1.3, 0.6],
    movement: { type: 'static', duration: 6 },
    focus: '陈默',
  },
};

/** 银盐晨光的 Screenplay 形态(与 docs/storyflow-ir-example.json 同源故事:
 *  时间戳节拍 6/5/6/5/4、两句台词、DISSOLVE+FADE OUT、词锚 shutter@3.742s)。 */
export const fixture = (): { screenplay: Screenplay; refImages: RefImage[] } => {
  const blk = (id: string, type: ScriptBlock['type'], content: string, extra: Partial<ScriptBlock> = {}): ScriptBlock =>
    ({ id, type, content, ...extra });

  const blocks: ScriptBlock[] = [
    blk('b1', 'SCENE_HEADING', 'INT. 国营照相馆 - 清晨', { graybox: sceneGraybox }),
    blk('b2', 'ACTION', '00:00-00:06。镜头极缓慢前推,光柱中尘埃缓缓漂浮,样片墙高光微微呼吸;画面内无人物', { imagePrompt: `${PREFIX}wide interior at dawn, empty counter, no people` }),
    blk('b3', 'ACTION', '00:06-00:11。苏晚双手沿机身缓慢画圆擦拭,软布起伏,快门线轻微晃动;镜头固定', {
      imagePrompt: `${PREFIX}close-up of a young woman's hands polishing a vintage twin-lens reflex camera`,
      imageResult: { assetId: 'asset_sowan_base_01', subject: '苏晚的手与海鸥双反相机' },
    }),
    blk('b4', 'ACTION', '00:11-00:17。陈默推门进店,门铃轻晃;他抬手示意;苏晚在柜台后抬头;镜头固定中景', {
      imagePrompt: `${PREFIX}medium two-shot, a man entering through the studio door`,
      graybox: shotGraybox,
    }),
    blk('b5', 'CHARACTER', '陈默'),
    blk('b6', 'DIALOGUE', '拍一张证件照,要赶九点的火车。'),
    blk('b7', 'ACTION', '00:17-00:22。苏晚抬头,嘴角渐展微笑,围巾边缘随转身轻动;镜头缓慢推近半档', {
      imagePrompt: `${PREFIX}medium close-up of the young woman in a mist-grey knit scarf`,
    }),
    blk('b8', 'CHARACTER', '苏晚（晨雾围巾）'),
    blk('b9', 'DIALOGUE', '好,坐那边,光正好。'),
    blk('b10', 'TRANSITION', 'DISSOLVE TO:'),
    blk('b11', 'ACTION', '00:22-00:26。固定镜头微距:腰平取景器里的倒立窗光微微呼吸,尘埃缓浮,画面渐暗收黑', {
      imagePrompt: `${PREFIX}macro still life, the camera viewfinder catching the window light`,
    }),
    blk('b12', 'TRANSITION', 'FADE OUT.'),
  ];

  const BGM = 'Nostalgic quiet-morning instrumental bed for a 1990s photo studio at dawn. Warm felt piano with soft tape hiss, no vocals, steady loop, 30 seconds.';
  const screenplay: Screenplay = {
    id: 'sp-1',
    lastModified: 0,
    metadata: {
      title: '银盐晨光',
      author: '站长',
      draft: '1',
      scriptLanguage: 'zh',
      styleHead: {
        name: '银盐晨光',
        artStyle: '银盐胶片摄影质感:细腻颗粒、柔和晨光、暖金色调、柯达 Portra 胶片色',
        scenePreset: '1990 年代中国南方小城的国营照相馆,清晨,木质橱窗,尘埃在光柱中漂浮',
        promptPrefix: PREFIX,
      },
    },
    blocks,
    productionMode: 'cinematic',
    referenceBindings: {
      characters: { '苏晚': 'imgA', '陈默': 'imgC' },
      environment: 'imgE',
      scenes: { 'INT. 国营照相馆 - 清晨': { characters: { '苏晚': 'imgA2' } } },
    },
    voiceCast: { '陈默': 'jam', '苏晚': 'tongtong' },
    expressShots: {
      b2: { status: 'image-ready' },
      b3: { status: 'video-ready', locked: true },
    },
    proAudio: {
      // targetSeconds=6 时每拍一段:段键 = 段首块 id
      b2: { bgm: { prompt: BGM, url: 'bgm://x' } },
      b3: { bgm: { prompt: BGM, url: 'bgm://x' } },
      b4: {
        tts: [{ line: '拍一张证件照,要赶九点的火车。', charName: '陈默', voice: 'jam', url: 'tts://1', seconds: 3.4 }],
        bgm: { prompt: BGM, url: 'bgm://x' },
        sfx: [{ name: 'ding', url: 'sfx://ding', at: 0 }],
      },
      b7: {
        tts: [{ line: '好,坐那边,光正好。', charName: '苏晚（晨雾围巾）', voice: 'tongtong', url: 'tts://2', seconds: 2.6 }],
        bgm: { prompt: BGM, url: 'bgm://x' },
      },
      b11: {
        bgm: { prompt: BGM, url: 'bgm://x' },
        sfx: [{ name: 'shutter', missing: true, at: 3.742 }],
      },
    },
  };

  const refImages: RefImage[] = [
    {
      id: 'imgA', name: '苏晚', type: 'image/png', size: 1, createdAt: 0, url: 'blob:a',
      kind: 'character', charName: '苏晚', subject: '苏晚',
      source: 'ai-generate', sourcePrompt: '女照相师,28 岁,齐肩黑发,米白的确良衬衫,神情安静专注',
      versionGroup: 'sowan', version: 1,
    },
    {
      id: 'imgA2', name: '苏晚/晨雾围巾', type: 'image/png', size: 1, createdAt: 0, url: 'blob:a2',
      kind: 'character', charName: '苏晚', variant: '晨雾围巾', subject: '苏晚/晨雾围巾',
      source: 'ai-generate', sourcePrompt: '苏晚加一条雾灰色针织围巾,其余形象与主设定一致',
      versionGroup: 'sowan', version: 2,
    },
    {
      id: 'imgC', name: '陈默', type: 'image/png', size: 1, createdAt: 0, url: 'blob:c',
      kind: 'character', charName: '陈默', subject: '陈默',
      source: 'upload', sourcePrompt: '常客,火车司机,深绿色旧工装外套,眉眼温和',
      versionGroup: 'chenmo', version: 1,
    },
    {
      id: 'imgE', name: '照相馆', type: 'image/png', size: 1, createdAt: 0, url: 'blob:e',
      kind: 'environment', sceneKey: '照相馆', subject: '环境',
      source: 'ai-generate', sourcePrompt: '老式照相馆内景:北面木质橱窗透进晨光,砖墙挂褪色样片',
    },
  ];
  return { screenplay, refImages };
};

