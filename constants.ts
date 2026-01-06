import { ScriptBlock, Screenplay, BlockType, ScriptTemplate, AppSettings } from './types';

// Specialized System Prompts
const PROMPTS = {
  STANDARD: `You are a Hollywood Screenwriting Master following the principles of Syd Field and Robert McKee. 
  Focus on "Show, Don't Tell", visual storytelling, and tight pacing. 
  Ensure proper formatting.`,
  
  SITCOM: `You are a Veteran Sitcom Showrunner. 
  Focus on a multi-camera format style. 
  Prioritize comedic timing, setup-punchline structures, and distinct character voices. 
  Keep scenes contained to main sets.`,
  
  STAGE: `You are an Award-Winning Playwright and Theater Director. 
  Focus on dialogue-driven narrative, monologue potential, and emotional depth. 
  Limit descriptions to what can be seen on stage.`,
  
  COMMERCIAL: `You are a Creative Director for high-end advertising. 
  Focus on grabbing attention immediately, clear branding visuals, and persuasive messaging within a short timeframe (30s-60s).`,

  SHORT_VIDEO: `You are a Viral Short Video (Vertical Drama) Scriptwriter. 
  Focus on extreme pacing, "Golden 3 Seconds" hooks, and constant conflict. 
  Every segment must end with a cliffhanger or emotional reversal.`,

  MYSTERY: `You are a Mystery and Thriller writer like Agatha Christie or David Fincher. 
  Focus on atmosphere, suspense, foreshadowing, and planting subtle clues. 
  Build tension through silence and specific environmental details.`,

  ROMANCE: `You are a Romance writer. 
  Focus on emotional arcs, chemistry, and "meet-cute" scenarios. 
  Prioritize character internal emotions shown through subtle actions and subtext-heavy dialogue.`,

  SCIFI: `You are a Hard Sci-Fi writer. 
  Focus on "Logic Self-Consistency" (Logic Self-Consistent), scientific elements, and humanistic reflection. 
  Describe environments that feel alien yet grounded in logic.`,

  DANMEI: `You are a Danmei (Pure Love) author. 
  Focus on "Wei Mei" (Aesthetics) and emotional depth. 
  Depict subtle tension, devotion, and the beauty of the characters. 
  Focus on the bond between the protagonists (\`CP\`).`,

  XUANHUAN: `You are a Master of Eastern Fantasy (Xuanhuan/Xianxia). 
  Focus on Cultivation realms, artifacts, sects, and the "Law of the Jungle". 
  Descriptions should be grandiose ("Qi", "Dao", "Realms").`,

  WUXIA: `You are a Wuxia novelist like Jin Yong or Gu Long. 
  Focus on martial arts choreography, Jianghu politics, righteousness (Yi), and brotherhood. 
  Action scenes should be descriptive and poetic.`,

  LIGHT_NOVEL: `You are a Light Novel author. 
  Use a casual, conversational tone ("Easy to read"). 
  Focus on character tropes, internal monologues, and dialogue-driven progression. 
  Titles and dialogue can be longer and more expressive.`,

  TIME_TRAVEL: `You are a Time Travel (Chuanyue) writer. 
  Focus on the contrast between modern knowledge and the historical/alternate setting. 
  Highlight the protagonist's adaptation and use of future knowledge to solve problems.`,

  DIALOGUE_NOVEL: `You are writing a Dialogue Novel (Chat Fiction). 
  The story must be told almost entirely through DIALOGUE blocks. 
  Minimize ACTION blocks. Focus on fast-paced exchange and character voice.`,

  SHADOW: `You are "Script Shadow" (剧本影子), an expert in Script Adaptation and Imitation Writing.
  Your process:
  1. ANALYZE: Deeply understand the structure, pacing, and emotional beats of a reference text.
  2. IMITATE: Create a new story with different characters/settings that mirrors the successful structure of the reference.
  3. EXPAND: Develop Character Bios and a detailed Episode/Scene Outline.
  4. WRITE: Generate full script content based on the outline.
  Maintain high conflict and pacing.`
};

export const TEMPLATES: ScriptTemplate[] = [
  {
    id: 'standard',
    nameKey: 'tpl_standard_name',
    descKey: 'tpl_standard_desc',
    systemPrompt: PROMPTS.STANDARD,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'EXT. CITY STREET - DAY' },
      { id: '2', type: 'ACTION', content: 'The city bustles with life. PEDESTRIANS hurry past, glued to their phones.' },
      { id: '3', type: 'CHARACTER', content: 'HERO' },
      { id: '4', type: 'DIALOGUE', content: 'Everything is about to change.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '外. 城市街道 - 白天' },
      { id: '2', type: 'ACTION', content: '城市熙熙攘攘。行人匆匆走过，眼睛盯着手机。' },
      { id: '3', type: 'CHARACTER', content: '主角' },
      { id: '4', type: 'DIALOGUE', content: '一切都将改变。' }
    ]
  },
  {
    id: 'shadow',
    nameKey: 'tpl_shadow_name',
    descKey: 'tpl_shadow_desc',
    systemPrompt: PROMPTS.SHADOW,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INPUT: REFERENCE MATERIAL' },
      { id: '2', type: 'ACTION', content: '[PASTE ORIGINAL STORY SYNOPSIS HERE]' },
      { id: '3', type: 'SCENE_HEADING', content: 'OUTPUT: ADAPTATION PLAN' },
      { id: '4', type: 'ACTION', content: 'Target Genre: [e.g. Modern Business, Ancient Palace]' },
      { id: '5', type: 'CHARACTER', content: 'NEW PROTAGONIST' },
      { id: '6', type: 'DIALOGUE', content: 'Describe character archetype and goal...' },
      { id: '7', type: 'SCENE_HEADING', content: 'GENERATED OUTLINE' },
      { id: '8', type: 'ACTION', content: '[Use AI to generate outline based on the reference above]' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '输入：参考素材' },
      { id: '2', type: 'ACTION', content: '[在此粘贴原著故事大纲/简介]' },
      { id: '3', type: 'SCENE_HEADING', content: '输出：改编方案' },
      { id: '4', type: 'ACTION', content: '目标题材：[例如：现代商战、古代宫廷]' },
      { id: '5', type: 'CHARACTER', content: '新主角' },
      { id: '6', type: 'DIALOGUE', content: '描述角色原型与目标...' },
      { id: '7', type: 'SCENE_HEADING', content: '生成大纲' },
      { id: '8', type: 'ACTION', content: '[使用AI基于上述参考生成大纲]' }
    ]
  },
  {
    id: 'short_video',
    nameKey: 'tpl_short_name',
    descKey: 'tpl_short_desc',
    systemPrompt: PROMPTS.SHORT_VIDEO,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. LUXURY OFFICE - DAY' },
      { id: '2', type: 'ACTION', content: 'A stack of cash is SLAMMED onto the desk.' },
      { id: '3', type: 'CHARACTER', content: 'BOSS' },
      { id: '4', type: 'DIALOGUE', content: 'Take it and leave her alone.' },
      { id: '5', type: 'CHARACTER', content: 'PROTAGONIST' },
      { id: '6', type: 'ACTION', content: 'Smirks, pulls out a black card.' },
      { id: '7', type: 'DIALOGUE', content: 'I think you misunderstood who is buying whom.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 豪华办公室 - 白天' },
      { id: '2', type: 'ACTION', content: '一叠现金被重重地摔在桌上。' },
      { id: '3', type: 'CHARACTER', content: '霸总' },
      { id: '4', type: 'DIALOGUE', content: '拿着钱，离开她。' },
      { id: '5', type: 'CHARACTER', content: '主角' },
      { id: '6', type: 'ACTION', content: '冷笑一声，掏出一张黑卡。' },
      { id: '7', type: 'DIALOGUE', content: '你搞错了，现在是谁在收购谁。' }
    ]
  },
  {
    id: 'danmei',
    nameKey: 'tpl_danmei_name',
    descKey: 'tpl_danmei_desc',
    systemPrompt: PROMPTS.DANMEI,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'EXT. BAMBOO FOREST - MISTY MORNING' },
      { id: '2', type: 'ACTION', content: 'White robes flutter in the wind. LAN plays the guqin, the sound piercing the fog.' },
      { id: '3', type: 'ACTION', content: 'WEI leans against a tree, twirling a jar of Emperor\'s Smile, watching him.' },
      { id: '4', type: 'CHARACTER', content: 'WEI' },
      { id: '5', type: 'DIALOGUE', content: 'Lan Zhan, look at me.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '外. 竹林 - 雾晨' },
      { id: '2', type: 'ACTION', content: '白衣随风飘动。蓝忘机轻抚古琴，琴声穿透薄雾。' },
      { id: '3', type: 'ACTION', content: '魏无羡倚在树旁，转动着手中的天子笑，凝视着他。' },
      { id: '4', type: 'CHARACTER', content: '魏无羡' },
      { id: '5', type: 'DIALOGUE', content: '蓝湛，看我。' }
    ]
  },
  {
    id: 'xuanhuan',
    nameKey: 'tpl_xuanhuan_name',
    descKey: 'tpl_xuanhuan_desc',
    systemPrompt: PROMPTS.XUANHUAN,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'EXT. SPIRIT PEAK - DAY' },
      { id: '2', type: 'ACTION', content: 'Energy swirls around LIN FENG. He breaks through to the 9th layer of Qi Condensation.' },
      { id: '3', type: 'CHARACTER', content: 'ELDER MO' },
      { id: '4', type: 'DIALOGUE', content: 'Impossible! A trash spirit root actually advanced?' },
      { id: '5', type: 'CHARACTER', content: 'LIN FENG' },
      { id: '6', type: 'DIALOGUE', content: 'The heavens may judge me, but you are not qualified.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '外. 灵剑峰 - 白天' },
      { id: '2', type: 'ACTION', content: '灵气在林枫周身盘旋。他猛然突破了炼气九层。' },
      { id: '3', type: 'CHARACTER', content: '莫长老' },
      { id: '4', type: 'DIALOGUE', content: '不可能！废灵根竟然突破了？' },
      { id: '5', type: 'CHARACTER', content: '林枫' },
      { id: '6', type: 'DIALOGUE', content: '天道可判我，但你不配。' }
    ]
  },
  {
    id: 'wuxia',
    nameKey: 'tpl_wuxia_name',
    descKey: 'tpl_wuxia_desc',
    systemPrompt: PROMPTS.WUXIA,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. TEAHOUSE - RAINY NIGHT' },
      { id: '2', type: 'ACTION', content: 'A sudden gust extinguishes the candles. The gleam of a blade flashes.' },
      { id: '3', type: 'CHARACTER', content: 'SWORDSMAN' },
      { id: '4', type: 'DIALOGUE', content: 'Your blade is fast. But my cup is still full.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 茶馆 - 雨夜' },
      { id: '2', type: 'ACTION', content: '一阵狂风吹灭了烛火。刀光一闪。' },
      { id: '3', type: 'CHARACTER', content: '刀客' },
      { id: '4', type: 'DIALOGUE', content: '你的刀很快。但我的茶还是满的。' }
    ]
  },
  {
    id: 'timetravel',
    nameKey: 'tpl_timetravel_name',
    descKey: 'tpl_timetravel_desc',
    systemPrompt: PROMPTS.TIME_TRAVEL,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. PALACE BEDCHAMBER - ANCIENT TIMES' },
      { id: '2', type: 'ACTION', content: 'XIAO wakes up with a headache. She looks at her hands—they are small, delicate, wearing jade bangles.' },
      { id: '3', type: 'CHARACTER', content: 'MAID' },
      { id: '4', type: 'DIALOGUE', content: 'Princess! You\'re finally awake! The Emperor is waiting.' },
      { id: '5', type: 'CHARACTER', content: 'XIAO' },
      { id: '6', type: 'PARENTHETICAL', content: '(internal thought)' },
      { id: '7', type: 'DIALOGUE', content: 'Emperor? I was just in a board meeting...' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 宫廷寝殿 - 古代' },
      { id: '2', type: 'ACTION', content: '萧萧头痛欲裂地醒来。她看着自己的手——纤细，戴着玉镯。' },
      { id: '3', type: 'CHARACTER', content: '侍女' },
      { id: '4', type: 'DIALOGUE', content: '公主！您终于醒了！皇上在等您。' },
      { id: '5', type: 'CHARACTER', content: '萧萧' },
      { id: '6', type: 'PARENTHETICAL', content: '(内心独白)' },
      { id: '7', type: 'DIALOGUE', content: '皇上？我刚才还在开董事会...' }
    ]
  },
  {
    id: 'lightnovel',
    nameKey: 'tpl_lightnovel_name',
    descKey: 'tpl_lightnovel_desc',
    systemPrompt: PROMPTS.LIGHT_NOVEL,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'EXT. HIGH SCHOOL ROOFTOP - SUNSET' },
      { id: '2', type: 'ACTION', content: 'The wind messes up my hair. It\'s just like an anime scene, except I\'m an NPC.' },
      { id: '3', type: 'CHARACTER', content: 'AYUMI' },
      { id: '4', type: 'DIALOGUE', content: 'Hey! Are you even listening to the student council president?' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '外. 高中天台 - 黄昏' },
      { id: '2', type: 'ACTION', content: '风吹乱了我的头发。这场景像极了动漫，只可惜我是个NPC。' },
      { id: '3', type: 'CHARACTER', content: '亚由美' },
      { id: '4', type: 'DIALOGUE', content: '喂！你到底有没有在听学生会长说话啊？' }
    ]
  },
  {
    id: 'mystery',
    nameKey: 'tpl_mystery_name',
    descKey: 'tpl_mystery_desc',
    systemPrompt: PROMPTS.MYSTERY,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'EXT. ABANDONED PIER - NIGHT' },
      { id: '2', type: 'ACTION', content: 'Fog rolls in thick. The sound of water lapping against rotting wood.' },
      { id: '3', type: 'ACTION', content: 'DETECTIVE VALENTINE shines a flashlight. The beam lands on a wet shoe.' },
      { id: '4', type: 'CHARACTER', content: 'VALENTINE' },
      { id: '5', type: 'DIALOGUE', content: 'He didn\'t come here alone.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '外. 废弃码头 - 夜' },
      { id: '2', type: 'ACTION', content: '浓雾弥漫。水拍打着腐烂木头的声音。' },
      { id: '3', type: 'ACTION', content: '瓦伦丁探长打着手电筒。光束落在一只湿透的鞋上。' },
      { id: '4', type: 'CHARACTER', content: '瓦伦丁' },
      { id: '5', type: 'DIALOGUE', content: '他不是一个人来的。' }
    ]
  },
  {
    id: 'romance',
    nameKey: 'tpl_romance_name',
    descKey: 'tpl_romance_desc',
    systemPrompt: PROMPTS.ROMANCE,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. COFFEE SHOP - DAY' },
      { id: '2', type: 'ACTION', content: 'Rain pours outside. ELIZA reads a book, sipping tea.' },
      { id: '3', type: 'ACTION', content: 'A STRANGER bumps her table. Tea spills onto the page.' },
      { id: '4', type: 'CHARACTER', content: 'STRANGER' },
      { id: '5', type: 'DIALOGUE', content: 'Oh no, I am so sorry. Is that first edition?' },
      { id: '6', type: 'ACTION', content: 'Their eyes meet. Time stops.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 咖啡店 - 雨天' },
      { id: '2', type: 'ACTION', content: '窗外大雨倾盆。伊丽莎白在看书，抿着茶。' },
      { id: '3', type: 'ACTION', content: '一个陌生人撞到了桌子。茶水洒在了书页上。' },
      { id: '4', type: 'CHARACTER', content: '陌生人' },
      { id: '5', type: 'DIALOGUE', content: '天哪，真对不起。那是初版书吗？' },
      { id: '6', type: 'ACTION', content: '四目相对。时间静止了。' }
    ]
  },
  {
    id: 'scifi',
    nameKey: 'tpl_scifi_name',
    descKey: 'tpl_scifi_desc',
    systemPrompt: PROMPTS.SCIFI,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. SPACESHIP COCKPIT - SPACE' },
      { id: '2', type: 'ACTION', content: 'Silence. The stars outside are streaking into lines of light.' },
      { id: '3', type: 'CHARACTER', content: 'AI COMPUTER' },
      { id: '4', type: 'DIALOGUE', content: 'Approaching Event Horizon. Hull integrity at 40%.' },
      { id: '5', type: 'CHARACTER', content: 'COMMANDER' },
      { id: '6', type: 'DIALOGUE', content: 'Hold it together. Just a little further.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 飞船驾驶舱 - 太空' },
      { id: '2', type: 'ACTION', content: '死寂。窗外的星辰拉伸成光线。' },
      { id: '3', type: 'CHARACTER', content: 'AI 电脑' },
      { id: '4', type: 'DIALOGUE', content: '接近视界。船体完整度40%。' },
      { id: '5', type: 'CHARACTER', content: '指挥官' },
      { id: '6', type: 'DIALOGUE', content: '撑住。就快到了。' }
    ]
  },
  {
    id: 'dialogue',
    nameKey: 'tpl_dialogue_name',
    descKey: 'tpl_dialogue_desc',
    systemPrompt: PROMPTS.DIALOGUE_NOVEL,
    initialBlocks: [
      { id: '1', type: 'CHARACTER', content: 'USER_123' },
      { id: '2', type: 'DIALOGUE', content: 'Did you see the news?' },
      { id: '3', type: 'CHARACTER', content: 'GHOST_RUNNER' },
      { id: '4', type: 'DIALOGUE', content: 'Yeah. It\'s starting.' },
      { id: '5', type: 'CHARACTER', content: 'USER_123' },
      { id: '6', type: 'DIALOGUE', content: 'I\'m scared.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'CHARACTER', content: '用户_123' },
      { id: '2', type: 'DIALOGUE', content: '看新闻了吗？' },
      { id: '3', type: 'CHARACTER', content: '幽灵跑者' },
      { id: '4', type: 'DIALOGUE', content: '看了。开始了。' },
      { id: '5', type: 'CHARACTER', content: '用户_123' },
      { id: '6', type: 'DIALOGUE', content: '我好怕。' }
    ]
  },
  {
    id: 'sitcom',
    nameKey: 'tpl_sitcom_name',
    descKey: 'tpl_sitcom_desc',
    systemPrompt: PROMPTS.SITCOM,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. APARTMENT LIVING ROOM - DAY' },
      { id: '2', type: 'ACTION', content: 'The classic hangout spot. JERRY sits on the couch, eating cereal.' },
      { id: '3', type: 'CHARACTER', content: 'JERRY' },
      { id: '4', type: 'DIALOGUE', content: 'You believe this? They stopped making the flakes.' },
      { id: '5', type: 'CHARACTER', content: 'GEORGE' },
      { id: '6', type: 'PARENTHETICAL', content: '(entering)' },
      { id: '7', type: 'DIALOGUE', content: 'The flakes? The flakes are the best part!' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 公寓客厅 - 白天' },
      { id: '2', type: 'ACTION', content: '经典的聚会点。杰瑞坐在沙发上吃麦片。' },
      { id: '3', type: 'CHARACTER', content: '杰瑞' },
      { id: '4', type: 'DIALOGUE', content: '你敢信？他们停产了这种麦片。' },
      { id: '5', type: 'CHARACTER', content: '乔治' },
      { id: '6', type: 'PARENTHETICAL', content: '(进门)' },
      { id: '7', type: 'DIALOGUE', content: '麦片？麦片是灵魂啊！' }
    ]
  },
  {
    id: 'stageplay',
    nameKey: 'tpl_stage_name',
    descKey: 'tpl_stage_desc',
    systemPrompt: PROMPTS.STAGE,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'SCENE 1' },
      { id: '2', type: 'ACTION', content: 'A spotlight hits center stage. A lone wooden chair sits empty.' },
      { id: '3', type: 'CHARACTER', content: 'HAMLET' },
      { id: '4', type: 'DIALOGUE', content: 'To be, or not to be...' },
      { id: '5', type: 'PARENTHETICAL', content: '(he pauses, looking at the audience)' },
      { id: '6', type: 'DIALOGUE', content: 'That is the question.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '第一幕' },
      { id: '2', type: 'ACTION', content: '聚光灯打在舞台中央。一把孤零零的木椅。' },
      { id: '3', type: 'CHARACTER', content: '哈姆雷特' },
      { id: '4', type: 'DIALOGUE', content: '生存，还是毁灭...' },
      { id: '5', type: 'PARENTHETICAL', content: '(停顿，注视观众)' },
      { id: '6', type: 'DIALOGUE', content: '这是个问题。' }
    ]
  },
  {
    id: 'commercial',
    nameKey: 'tpl_ad_name',
    descKey: 'tpl_ad_desc',
    systemPrompt: PROMPTS.COMMERCIAL,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. KITCHEN - DAY' },
      { id: '2', type: 'ACTION', content: 'A mess. Juice on the counter. A MOM looks exhausted.' },
      { id: '3', type: 'CHARACTER', content: 'NARRATOR (V.O.)' },
      { id: '4', type: 'DIALOGUE', content: 'Life is messy. Cleaning it up shouldn\'t be.' },
      { id: '5', type: 'TRANSITION', content: 'CUT TO PRODUCT SHOT:' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 厨房 - 白天' },
      { id: '2', type: 'ACTION', content: '一片狼藉。果汁洒在台面上。一位妈妈看起来精疲力尽。' },
      { id: '3', type: 'CHARACTER', content: '旁白 (画外音)' },
      { id: '4', type: 'DIALOGUE', content: '生活很乱。但打扫不该乱。' },
      { id: '5', type: 'TRANSITION', content: '切至产品特写：' }
    ]
  }
];

export const DEFAULT_SCRIPT: Screenplay = {
  id: 'default-script',
  metadata: {
    title: 'Untitled Screenplay',
    author: 'Unknown Writer',
    draft: 'First Draft',
    templateId: 'standard',
    scriptLanguage: 'en'
  },
  lastModified: Date.now(),
  blocks: TEMPLATES[0].initialBlocks
};

// Expert Color Presets
// These colors are chosen to have good contrast on BOTH white and dark backgrounds (mid-tones).
export const COLOR_PRESETS = {
  MODERN_FOCUS: {
    SCENE_HEADING: '#4f46e5', // Indigo 600 - Visible, Structural
    ACTION: '', // Default (Black/White) - Best for reading flow
    CHARACTER: '#0891b2', // Cyan 600 - Distinct but professional
    DIALOGUE: '', // Default (Black/White)
    PARENTHETICAL: '#64748b', // Slate 500 - De-emphasized
    TRANSITION: '#ea580c' // Orange 600 - High attention
  },
  CLASSIC_BW: {
    SCENE_HEADING: '',
    ACTION: '',
    CHARACTER: '',
    DIALOGUE: '',
    PARENTHETICAL: '',
    TRANSITION: ''
  }
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  provider: 'gemini',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  geminiApiKey: '',
  colorSettings: COLOR_PRESETS.MODERN_FOCUS,
  shortcuts: {
      aiContinue: 'Alt+C',
      aiIdeas: 'Alt+I',
      aiRewrite: 'Alt+R'
  },
  autoAcceptAI: false,
  aiContextBlocks: 50,
  aiOutputBlocks: 10
};

export const BLOCK_SHORTCUTS_HINT: Record<string, string> = {
  SCENE_HEADING: 'S',
  ACTION: 'A',
  CHARACTER: 'C',
  DIALOGUE: 'D',
  PARENTHETICAL: 'P',
  TRANSITION: 'T'
};

export const TRANSLATIONS = {
  en: {
    appTitle: "StoryFlow",
    screenplay: "Screenplay",
    scenes: "SCENES",
    startWriting: "Start writing a scene heading...",
    newScript: "New Script",
    selectTemplate: "Select a Template",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    exportPdf: "Export as PDF",
    scriptSettings: "Settings",
    settingsTitle: "Configuration",
    scriptMeta: "Script Metadata",
    aiConfig: "AI Configuration",
    aiAutoAccept: "Auto-accept AI suggestions (skip confirmation)",
    appearanceConfig: "Appearance",
    shortcutsConfig: "Shortcuts",
    viewMode: "View Mode",
    editMode: "Edit Mode",
    presets: "Color Presets",
    presetFocus: "Modern Focus (Recommended)",
    presetClassic: "Classic (Monochrome)",
    titleLabel: "Title",
    authorLabel: "Author",
    languageLabel: "Script Language",
    providerLabel: "AI Provider",
    apiKeyLabel: "API Key",
    modelLabel: "Model",
    aiContextBlocksLabel: "Context Blocks",
    aiContextBlocksDesc: "Number of recent blocks sent as context for AI continuation (20-300)",
    aiOutputBlocksLabel: "Output Blocks",
    aiOutputBlocksDesc: "Number of blocks to generate in one continuation (1-50)",
    saving: "Saving...",
    saved: "Saved",
    aiAssistant: "AI Assistant",
    aiWorking: "Working...",
    aiButton: "AI",
    aiGenerate: "Generate Content",
    aiGenerating: "Generating...",
    aiDiscard: "Discard",
    aiInsert: "Insert",
    viewPrompt: "View Prompt",
    systemPrompt: "System Prompt",
    close: "Close",
    shortcutRecoding: "Press any key to record...",
    tabOutline: "Outline",
    tabHistory: "History",
    noScripts: "No saved scripts found.",
    deleteScript: "Delete Script",
    confirmDelete: "Are you sure you want to delete this script?",
    open: "Open",
    current: "Current",
    modes: {
      continue: "Continue",
      ideas: "Brainstorm",
      rewrite: "Rewrite"
    },
    prompts: {
      continue: "Analyze context and generate the next few lines.",
      ideas: "Generate plot twists or creative directions.",
      rewrite: "Polish the selected block."
    },
    placeholders: {
      SCENE_HEADING: 'INT./EXT. LOCATION - TIME',
      ACTION: 'Action description...',
      CHARACTER: 'CHARACTER NAME',
      DIALOGUE: 'Dialogue...',
      PARENTHETICAL: '(expression)',
      TRANSITION: 'CUT TO:'
    },
    blockLabels: {
      SCENE_HEADING: 'Scene Heading',
      ACTION: 'Action',
      CHARACTER: 'Character',
      DIALOGUE: 'Dialogue',
      PARENTHETICAL: 'Parenthetical',
      TRANSITION: 'Transition'
    },
    templates: {
      tpl_standard_name: "Feature Film",
      tpl_standard_desc: "Standard industry format. Best for movies and general storytelling.",
      tpl_shadow_name: "Script Shadow / Adaptation",
      tpl_shadow_desc: "Imitate structure and rewrite stories. Analyze original text -> Adaptation Outline -> New Script.",
      tpl_short_name: "Short Video / Vertical Drama",
      tpl_short_desc: "Fast-paced, high-conflict format optimized for TikTok/Reels/Douyin.",
      tpl_mystery_name: "Mystery / Thriller",
      tpl_mystery_desc: "Focus on suspense, clues, and atmospheric storytelling.",
      tpl_romance_name: "Romance",
      tpl_romance_desc: "Focus on emotional beats, chemistry, and relationships.",
      tpl_scifi_name: "Sci-Fi",
      tpl_scifi_desc: "Focus on logic, scientific extrapolation, and humanistic reflection.",
      tpl_danmei_name: "Danmei / Pure Love",
      tpl_danmei_desc: "Aesthetic style focusing on emotional depth and subtle bonds (BL/GL).",
      tpl_xuanhuan_name: "Xuanhuan / Cultivation",
      tpl_xuanhuan_desc: "Eastern fantasy featuring cultivation realms, sects, and artifacts.",
      tpl_wuxia_name: "Wuxia / Martial Arts",
      tpl_wuxia_desc: "Classic martial arts world (Jianghu), chivalry, and brotherhood.",
      tpl_timetravel_name: "Time Travel (Chuanyue)",
      tpl_timetravel_desc: "Modern protagonist adapting to ancient or alternate historical settings.",
      tpl_lightnovel_name: "Light Novel",
      tpl_lightnovel_desc: "Casual tone, easy to read, dialogue-driven, often with anime tropes.",
      tpl_dialogue_name: "Dialogue Novel",
      tpl_dialogue_desc: "Story told almost exclusively through character dialogue (Chat Fiction).",
      tpl_sitcom_name: "TV Sitcom",
      tpl_sitcom_desc: "Multi-camera style. Optimized for quick dialogue and humor.",
      tpl_stage_name: "Stage Play",
      tpl_stage_desc: "Theatrical format. Focus on sets and dialogue.",
      tpl_ad_name: "Commercial",
      tpl_ad_desc: "Short form. Focus on visuals and voiceovers."
    },
    languages: {
      en: "English",
      zh: "Chinese (Simplified)",
      dual: "Dual Language (En/Zh)"
    },
    providers: {
      gemini: "Google Gemini",
      deepseek: "DeepSeek"
    }
  },
  zh: {
    appTitle: "StoryFlow 剧本工坊",
    screenplay: "剧本",
    scenes: "场景",
    startWriting: "开始编写场景标题...",
    newScript: "新建剧本",
    selectTemplate: "选择模板",
    cancel: "取消",
    create: "创建",
    save: "保存",
    exportPdf: "导出 PDF",
    scriptSettings: "设置",
    settingsTitle: "配置",
    scriptMeta: "剧本信息",
    aiConfig: "AI 配置",
    aiAutoAccept: "自动接受 AI 建议（跳过确认）",
    appearanceConfig: "外观配置",
    shortcutsConfig: "快捷键",
    viewMode: "阅读模式",
    editMode: "编辑模式",
    presets: "配色预设",
    presetFocus: "专业彩色 (推荐)",
    presetClassic: "经典黑白",
    titleLabel: "标题",
    authorLabel: "作者",
    languageLabel: "剧本语言",
    providerLabel: "AI 提供商",
    apiKeyLabel: "API 密钥",
    modelLabel: "模型",
    aiContextBlocksLabel: "上下文块数",
    aiContextBlocksDesc: "AI续写时发送的最近块数 (20-300)",
    aiOutputBlocksLabel: "输出块数",
    aiOutputBlocksDesc: "每次续写生成的块数 (1-50)",
    saving: "保存中...",
    saved: "已保存",
    aiAssistant: "AI 助手",
    aiWorking: "处理中...",
    aiButton: "AI",
    aiGenerate: "生成内容",
    aiGenerating: "生成中...",
    aiDiscard: "放弃",
    aiInsert: "插入",
    viewPrompt: "查看提示词",
    systemPrompt: "系统提示词",
    close: "关闭",
    shortcutRecoding: "按下任意键录制...",
    tabOutline: "大纲",
    tabHistory: "剧本列表",
    noScripts: "暂无保存的剧本。",
    deleteScript: "删除剧本",
    confirmDelete: "确定要删除这个剧本吗？",
    open: "打开",
    current: "当前",
    modes: {
      continue: "续写",
      ideas: "灵感",
      rewrite: "润色"
    },
    prompts: {
      continue: "分析上下文并生成后续内容。",
      ideas: "为下一场戏生成情节转折或创意方向。",
      rewrite: "润色选定的段落。"
    },
    placeholders: {
      SCENE_HEADING: '内/外 场景 - 时间',
      ACTION: '动作描述...',
      CHARACTER: '角色名',
      DIALOGUE: '对白...',
      PARENTHETICAL: '(神态/动作)',
      TRANSITION: '切至：'
    },
    blockLabels: {
      SCENE_HEADING: '场景标题',
      ACTION: '动作',
      CHARACTER: '角色',
      DIALOGUE: '对白',
      PARENTHETICAL: '括号',
      TRANSITION: '转场'
    },
    templates: {
      tpl_standard_name: "标准电影剧本",
      tpl_standard_desc: "好莱坞标准格式，适合大多数电影创作。",
      tpl_shadow_name: "剧本影子 / 仿写",
      tpl_shadow_desc: "智能改编与仿写工具。功能：导入原作 -> 提炼大纲 -> 人物小传 -> 生成新剧本。",
      tpl_short_name: "微短剧 / 竖屏剧",
      tpl_short_desc: "快节奏，高冲突，专为抖音/TikTok等短视频平台优化。",
      tpl_mystery_name: "悬疑 / 惊悚",
      tpl_mystery_desc: "专注于氛围营造、线索铺设和悬念设置。",
      tpl_romance_name: "言情 / 恋爱",
      tpl_romance_desc: "专注于情感弧光、角色化学反应和关系发展。",
      tpl_scifi_name: "科幻",
      tpl_scifi_desc: "注重“逻辑自洽”和科学幻想，以及人文思考。",
      tpl_danmei_name: "耽美 / 纯爱",
      tpl_danmei_desc: "唯美画风，专注于情感的细腻描写与人物羁绊 (BL/GL)。",
      tpl_xuanhuan_name: "玄幻 / 仙侠",
      tpl_xuanhuan_desc: "东方幻想风格，包含修炼等级、宗门、神器与天道。",
      tpl_wuxia_name: "武侠",
      tpl_wuxia_desc: "传统江湖，注重招式描写、侠义精神与兄弟情义。",
      tpl_timetravel_name: "穿越 / 历史",
      tpl_timetravel_desc: "现代人穿越至古代或异世，利用现代知识解决问题。",
      tpl_lightnovel_name: "轻小说",
      tpl_lightnovel_desc: "轻松易读的口语化文风，多对话，常含动漫元素。",
      tpl_dialogue_name: "对话体小说",
      tpl_dialogue_desc: "几乎完全由对话构成的故事，适合气泡小说或聊天剧。",
      tpl_sitcom_name: "电视情景喜剧",
      tpl_sitcom_desc: "多机位格式，优化对话节奏与笑点铺设。",
      tpl_stage_name: "舞台剧",
      tpl_stage_desc: "戏剧格式，专注于舞台调度与长对话。",
      tpl_ad_name: "商业广告",
      tpl_ad_desc: "短片格式，专注于视觉冲击与旁白。"
    },
    languages: {
      en: "英语",
      zh: "中文 (简体)",
      dual: "双语 (英/中)"
    },
    providers: {
      gemini: "Google Gemini",
      deepseek: "DeepSeek"
    }
  }
};