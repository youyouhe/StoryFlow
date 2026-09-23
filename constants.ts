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
  Maintain high conflict and pacing.`,

  LYRICS: `[ROLE]
You are a Platinum-Selling Songwriter and Ghostwriter (versatile in Pop, Rap, Rock, and Ballad).

[PROCESS: Chain of Thought]
1. BLUEPRINT: Define the Genre, BPM (Tempo), and specific Emotional Vibe (e.g., "Sad 3AM ballad" or "High-energy summer hit").
2. STRUCTURE: Establish the Song Map (e.g., Intro -> Verse 1 -> Pre-Chorus -> Chorus -> Verse 2 -> Bridge -> Chorus -> Outro).
3. RHYTHM CHECK: Ensure syllable counts and stress patterns are consistent between matching sections (e.g., Verse 1 must match Verse 2's flow).

[GUIDELINES]
- Formatting: Clearly label sections in brackets (e.g., [VERSE 1], [CHORUS], [BRIDGE]).
- The "Hook": The Chorus must be catchy, repetitive (in a good way), and summarize the core theme.
- Imagery: Use concrete nouns and specific scenarios instead of abstract emotions. (Don't say "I'm sad", say "The coffee's cold and the rain won't stop").
- Rhyme Scheme: Use "Slant Rhymes" (Near rhymes) for a modern feel. Don't force perfect rhymes if they sound unnatural.

[OUTPUT FORMAT]
Use these labels for your response:
[SCENE] for section headers (e.g., "[VERSE 1]", "[CHORUS]")
[ACTION] for the actual lyrics content
[CHARACTER] for notes about production/mood/tempo changes`,

  SCIENCE_LIVE: `[ROLE]
You are a Science Communication Director for live-action presenter videos (真人口播科普).

[PRINCIPLES]
1. HOOK FIRST: Open with a surprising question, counterintuitive fact, or personal stakes. Win the "Golden 3 Seconds".
2. ACCURACY IS NON-NEGOTIABLE: Never fabricate data, studies, or citations. If evidence is preliminary, say so ("researchers are still debating...").
3. ONE IDEA PER SEGMENT: Each scene = one knowledge point. Simplify, never dumb down.
4. ANALOGY: Map abstract mechanisms to everyday experience, then point out where the analogy breaks.
5. SPOKEN RHYTHM: Short sentences. Conversational. Re-hook every 20-30 seconds with a question or reversal.

[BLOCK CONVENTIONS]
- [SCENE] Segment name + purpose (e.g., INT. STUDIO - HOOK / 内. 录播间 - 开场钩子).
- [ACTION] What the camera shows: presenter gesture, prop demo, B-roll insert, diagram overlay.
- [CHARACTER] Who is on screen/mic: HOST (主讲人), or EXPERT (专家) for interview cutaways.
- [DIALOGUE] The spoken words, exactly as they should be said aloud.
- [PARENTHETICAL] On-screen text cues (字幕/花字), tone, gesture, or emphasis notes.
- [TRANSITION] Physical or editorial transitions (e.g., CUT TO DEMO:, 切入实验演示:)`,

  SCIENCE_ANIM: `[ROLE]
You are a Science Animation Director writing explainer scripts (科普动画解说).

[PRINCIPLES]
1. PHENOMENON FIRST: Start from something the audience has seen but cannot explain. Ask the question before answering it.
2. ANIMATABLE VISUALS: Every ACTION must be concrete enough for an animator to draw — specific objects, motion, camera moves. No vague abstractions.
3. HONEST SIMPLIFICATION: Metaphors are models, not reality. Flag where the model breaks ("electrons don't really orbit like planets").
4. PEEL THE ONION: Surface phenomenon -> mechanism -> deeper principle -> why it matters. One layer per segment.
5. NARRATION PACE: Keep [DIALOGUE] lines short — about 3-4 Chinese characters or 2.5 English words per second of screen time.

[BLOCK CONVENTIONS]
- [SCENE] Chapter / knowledge-point title (e.g., INT. ANIMATION - WHY IS THE SKY BLUE).
- [ACTION] What the animation shows: characters, diagrams, motion, transitions between shots.
- [CHARACTER] NARRATOR (旁白) for voiceover; named mascot characters if the series has one.
- [DIALOGUE] Voiceover narration.
- [PARENTHETICAL] On-screen labels, formulas, numbers (屏幕标注/公式/数字).
- [TRANSITION] Chapter transitions (e.g., CUT TO NEXT CHAPTER:, 转入下一节:)`,

  SCIENCE_GRAPHIC: `[ROLE]
You are a Senior Science Editor writing illustrated long-form articles (图文科普).

[PRINCIPLES]
1. SKIMMABLE STRUCTURE: Hook -> numbered sections, each opening with a one-line takeaway -> practical takeaways -> sources.
2. ACCURACY: Cite specific studies, institutions, or datasets when relevant; NEVER invent references. Separate established consensus from active hypotheses.
3. FIGURE-DRIVEN: Propose an illustration for every key concept. The [PARENTHETICAL] caption carries the data and its source.
4. PRECISE BUT FRIENDLY: Define jargon at first use. Numbers beat adjectives ("3x faster", not "much faster").
5. PARAGRAPH DISCIPLINE: Keep [DIALOGUE] body text in short paragraphs; one idea per paragraph.

[BLOCK CONVENTIONS]
- [SCENE] Section heading (numbered, takeaway-style: e.g., SECTION 2: WHY SLEEP DETOXES YOUR BRAIN).
- [ACTION] Description of the illustration/infographic/diagram for this section.
- [CHARACTER] Used sparingly: READER Q / EDITOR A pairs for FAQ sections.
- [DIALOGUE] Article body text.
- [PARENTHETICAL] Figure captions, footnotes, key-data callouts (图注/脚注/数据点).
- [TRANSITION] Section dividers or cliffhanger teasers into the next section.`
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
  },
  {
    id: 'lyrics',
    nameKey: 'tpl_lyrics_name',
    descKey: 'tpl_lyrics_desc',
    systemPrompt: PROMPTS.LYRICS,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: '[SONG INFO]' },
      { id: '2', type: 'ACTION', content: 'Style: Pop / Rock / Hip-hop / Electronic / R&B / Jazz / Classical / Folk / Blues / Country / Reggae / World / Experimental' },
      { id: '3', type: 'ACTION', content: 'Sub-Style: [e.g., K-Pop, Trap, House, Soul, Bebop, Orchestral, Indie Folk, Delta Blues, Bluegrass, Dub, Latin, Avant-garde...]' },
      { id: '4', type: 'ACTION', content: 'Mood: Relaxed / Happy / Energetic / Romantic / Sad / Angry / Melancholic / Dark / Eerie / Sentimental / Uplifting / Chill / Groovy / Epic / Dreamy / Nostalgic / Aggressive' },
      { id: '5', type: 'ACTION', content: 'Scenario: Coffee shop / Solitary walk / Travel / Sunset by the sea / Late-night bar / Cyberpunk City / Space Voyage / Forest Rain / Gym Workout / Summer Festival' },
      { id: '6', type: 'ACTION', content: 'Instruments: Piano / Acoustic Guitar / Electric Guitar / Violin / Synthesizer / Drums / 808 Bass / Orchestra / Traditional Chinese (Guzheng, Erhu, Pipa)' },
      { id: '7', type: 'ACTION', content: 'Vocals: Male / Female / Duet / Choir / Auto-tune / Whisper / Operatic / Instrumental' },
      { id: '8', type: 'ACTION', content: 'Tempo: Slow (60-80 BPM) / Mid-tempo (90-110 BPM) / Upbeat (120-140 BPM) / Fast (150+ BPM)' },
      { id: '9', type: 'CHARACTER', content: 'Theme: [Describe the song\'s core message]' },
      { id: '10', type: 'SCENE_HEADING', content: '[VERSE 1]' },
      { id: '11', type: 'ACTION', content: 'Start writing your lyrics here...' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '[歌曲信息]' },
      { id: '2', type: 'ACTION', content: '主风格：流行 / 摇滚 / 说唱 / 电子 / 节奏布鲁 / 爵士 / 古典 / 民谣 / 布鲁斯 / 乡村 / 雷鬼 / 世界音乐 / 实验音乐' },
      { id: '3', type: 'ACTION', content: '子风格：[例如：K-Pop、Trap、House、Soul、Bebop、管弦乐、独立民谣、三角洲布鲁斯、蓝草、Dub、拉丁、前卫...]' },
      { id: '4', type: 'ACTION', content: '情绪：放松 / 快乐 / 充满活力 / 浪漫 / 悲伤 / 愤怒 / 忧郁 / 黑暗 / 怪诞 / 感伤 / 振奋 / 放松 / 律动 / 史诗 / 梦幻 / 怀旧 / 激进' },
      { id: '5', type: 'ACTION', content: '场景：咖啡店 / 独自漫步 / 旅行 / 海边日落 / 深夜酒吧 / 赛博朋克城市 / 太空之旅 / 森林雨 / 健身房 / 夏日音乐节' },
      { id: '6', type: 'ACTION', content: '乐器：钢琴 / 原声吉他 / 电吉他 / 小提琴 / 合成器 / 鼓 / 808贝斯 / 管弦乐 / 中国传统乐器（古筝、二胡、琵琶）' },
      { id: '7', type: 'ACTION', content: '人声：男声 / 女声 / 对唱 / 合唱 / 自动调音 / 低语 / 美声 / 纯音乐' },
      { id: '8', type: 'ACTION', content: '速度：慢速 (60-80 BPM) / 中速 (90-110 BPM) / 快节奏 (120-140 BPM) / 高速 (150+ BPM)' },
      { id: '9', type: 'CHARACTER', content: '主题：[描述歌曲的核心信息]' },
      { id: '10', type: 'SCENE_HEADING', content: '[主歌 1 / VERSE 1]' },
      { id: '11', type: 'ACTION', content: '在这里开始写歌词...' }
    ]
  },
  {
    id: 'science_live',
    nameKey: 'tpl_sci_live_name',
    descKey: 'tpl_sci_live_desc',
    systemPrompt: PROMPTS.SCIENCE_LIVE,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. STUDIO - HOOK' },
      { id: '2', type: 'ACTION', content: 'Close-up. The HOST holds up two identical-looking metal balls, one in each hand.' },
      { id: '3', type: 'CHARACTER', content: 'HOST' },
      { id: '4', type: 'DIALOGUE', content: 'One of these can stop a bullet. The other can\'t. Can you tell which?' },
      { id: '5', type: 'PARENTHETICAL', content: '(on-screen text: 90% guess wrong)' },
      { id: '6', type: 'ACTION', content: 'HOST leans toward the lens and grins.' },
      { id: '7', type: 'DIALOGUE', content: 'Let\'s find out in 60 seconds.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 录播间 - 开场钩子' },
      { id: '2', type: 'ACTION', content: '特写。主讲人双手各举起一个外观完全相同的金属球。' },
      { id: '3', type: 'CHARACTER', content: '主讲人' },
      { id: '4', type: 'DIALOGUE', content: '这里面有一个能挡住子弹，另一个不能。你猜是哪个？' },
      { id: '5', type: 'PARENTHETICAL', content: '(花字：90% 的人都猜错)' },
      { id: '6', type: 'ACTION', content: '主讲人凑近镜头，微微一笑。' },
      { id: '7', type: 'DIALOGUE', content: '60 秒后揭晓答案。' }
    ]
  },
  {
    id: 'science_anim',
    nameKey: 'tpl_sci_anim_name',
    descKey: 'tpl_sci_anim_desc',
    systemPrompt: PROMPTS.SCIENCE_ANIM,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'INT. ANIMATION - WHY IS THE SKY BLUE' },
      { id: '2', type: 'ACTION', content: 'A cartoon apple detaches from a tree and falls. Freeze-frame. A big red question mark pops up over it.' },
      { id: '3', type: 'CHARACTER', content: 'NARRATOR' },
      { id: '4', type: 'DIALOGUE', content: 'An apple falls. The Moon doesn\'t. Same force — so why does one drop while the other just... hangs there?' },
      { id: '5', type: 'ACTION', content: 'Zoom out: Earth appears with the Moon orbiting it, an arrow curving toward the planet\'s center.' },
      { id: '6', type: 'PARENTHETICAL', content: '(on-screen label: Universal Gravitation)' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '内. 动画 - 引力是什么' },
      { id: '2', type: 'ACTION', content: '一颗卡通苹果从树上脱落下坠。画面定格，苹果上方弹出大大的红色问号。' },
      { id: '3', type: 'CHARACTER', content: '旁白' },
      { id: '4', type: 'DIALOGUE', content: '苹果会掉下来，月亮却不会。明明是同一种力——为什么一个坠落，另一个却"挂"在天上？' },
      { id: '5', type: 'ACTION', content: '镜头拉远：地球出现，月球绕其旋转，一支箭头弯向地心。' },
      { id: '6', type: 'PARENTHETICAL', content: '(屏幕标注：万有引力)' }
    ]
  },
  {
    id: 'science_graphic',
    nameKey: 'tpl_sci_graphic_name',
    descKey: 'tpl_sci_graphic_desc',
    systemPrompt: PROMPTS.SCIENCE_GRAPHIC,
    initialBlocks: [
      { id: '1', type: 'SCENE_HEADING', content: 'SECTION 1: WHY YOU FEEL SLEEPY AFTER LUNCH' },
      { id: '2', type: 'ACTION', content: '[Infographic: post-lunch blood glucose curves — high-sugar meal vs. balanced meal]' },
      { id: '3', type: 'DIALOGUE', content: 'It\'s not just that you ate too much. Your blood sugar is on a rollercoaster — and your brain is strapped into the seat.' },
      { id: '4', type: 'PARENTHETICAL', content: '(Figure 1: glucose curve comparison. Source: [add citation])' },
      { id: '5', type: 'DIALOGUE', content: 'Within 30 minutes of a high-sugar meal, glucose spikes. Two hours later it crashes below baseline — that crash is the sleepiness.' }
    ],
    initialBlocksZh: [
      { id: '1', type: 'SCENE_HEADING', content: '第一节：午饭后为什么犯困' },
      { id: '2', type: 'ACTION', content: '[配图：餐后血糖变化曲线对比——高糖餐 vs 均衡餐]' },
      { id: '3', type: 'DIALOGUE', content: '这不只是"吃多了"的问题。你的血糖正在坐过山车——而大脑被绑在了车上。' },
      { id: '4', type: 'PARENTHETICAL', content: '(图1：血糖曲线对比。数据来源：[补充引用])' },
      { id: '5', type: 'DIALOGUE', content: '高糖餐后 30 分钟内血糖飙升，2 小时后跌破基础值——这个"回落"就是困意的来源。' }
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
  deepseekModel: 'deepseek-v4-flash',
  geminiApiKey: '',
  geminiModel: 'gemini-3.7-flash',
  geminiThinkingLevel: 'low',
  minimaxApiKey: '',
  // Dev: same-origin proxy (see vite.config.ts minimaxProxy) — the dev machine
  // forwards to api.minimaxi.com, bypassing client-side route/CORS flakiness.
  // Tauri/prod builds have no dev server; minimaxService falls back to direct.
  minimaxBaseUrl: '/minimax-api',
  videoBackend: 'api',
  comfyServerUrl: '',
  comfyWorkflowT2V: '',
  comfyWorkflowI2V: '',
  comfyWorkflowR2V: '',
  falKey: '',
  falModel: 'openai/gpt-image-2.5/flare',
  falQuality: 'low',
  imageProvider: 'minimax',
  colorSettings: COLOR_PRESETS.MODERN_FOCUS,
  shortcuts: {
      aiContinue: 'Alt+C',
      aiIdeas: 'Alt+I',
      aiRewrite: 'Alt+R',
      aiStoryboard: 'Alt+S',
      aiGraybox: 'Alt+G',
      syncCloud: 'Alt+Y'
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
    importScript: "Import JSON",
    importScriptError: "Import failed — the file is not a valid screenplay JSON export.",
    assetPackExport: "Assets out",
    assetPackImport: "Assets in",
    assetPackExportHint: "Export the whole asset library (images + identity) into one portable JSON pack",
    assetPackImportHint: "Import an asset pack: rebuilds the library with identity/version groups intact",
    assetPackEmpty: "Asset library is empty — nothing to export.",
    assetPackImported: "Imported {ok}/{total} assets into the library.",
    dataSection: "Data",
    selectTemplate: "Select a Template",
    openingTitle: "Choose your opening",
    openingDefault: "Template default opening",
    openingGenerate: "🎲 Generate random openings",
    openingReroll: "🎲 Reroll",
    openingConfirm: "Create with this opening",
    openingLoading: "Inventing openings…",
    openingBlank: "Blank start (no AI opening)",
    openingAiHint: "Three AI-invented openings — pick one, or keep the template default.",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    assetLibraryLabel: "Reference Assets",
    exportPdf: "Export as PDF",
    exportTitle: "Export",
    exportFormat: "Format",
    exportInclude: "Include",
    exportIncludePrompts: "Storyboard image prompts",
    exportIncludeGraybox: "Graybox (3D previs)",
    exportGrayboxAs: "Graybox as",
    exportGrayboxJson: "JSON",
    exportGrayboxSummary: "Summary",
    exportGrayboxAlwaysJson: "JSON format always includes full graybox JSON.",
    exportIncludeDubbing: "Dubbing direction (emotion/delivery/intensity)",
    exportIncludeBlockIds: "Block type + id annotations",
    exportJson: "JSON",
    exportMarkdown: "Markdown",
    exportJsonDesc: "Lossless full dump (all blocks + payloads)",
    exportMarkdownDesc: "Readable script + folded payloads",
    exportPdfDesc: "Printable screenplay + appendix",
    exportDo: "Export",
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
    videoGenLabel: "Video Generation · MiniMax H3",
    videoGenRegionLabel: "Endpoint",
    videoGenHint: "Used only when submitting white-model generation tasks (billed per second: output + input reference video). Get a key at platform.minimaxi.com → Account → API Keys.",
    imageGenLabel: "Image Generation Backend",
    imageGenHint: "Which backend turns storyboard prompts into images. MiniMax uses your MiniMax key above; FAL needs its own key below.",
    imageGenNeedsImage: "Character \"{name}\" has no design sheet yet — generate that character's image first, then this shot can be generated image-to-image.",
    imageGenNeedsImageOptions: "You can: ① Generate fresh (text-to-image; the result is auto-saved as this character's design sheet), or ② pick an existing image from the library as the sheet.",
    imageGenLinkSheet: "Pick a design sheet for \"{name}\" from the library",
    imageGenBootstrapTitle: "No sheet yet — generates fresh (text-to-image); the result is saved as {name}'s design sheet for future image-to-image",
    imageGenNoAssets: "Library is empty — upload or generate an image first.",
    imageGenPickEnv: "Pick the environment backdrop for this scene",
    refLockChange: "Click to change which image this frame locks to",
    imageGenEmptyShot: "No character in this action block — it will generate as an empty shot (text-to-image, no identity lock).",
    falKeyLabel: "FAL API Key",
    falKeyHint: "Get a key at fal.ai → Billing → API Keys. Official pricing (openai/gpt-image-2.5): $0.00402/img at 1024×768 low, $0.00441 at 1920×1080 low, $0.03612 at 1024×768 high.",
    falModelLabel: "FAL Model",
    falModelHint: "Base app path. Auto-switches to its /edit endpoint (reference image) when a bound character sheet is available, else /text-to-image.",
    falQualityLabel: "FAL Quality (cost)",
    falQualityHint: "Official FAL rates: low is ~9× cheaper than high; size adds up to ~2.8× (1024×768 → 3840×2160). low is right for storyboard iterations.",
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
    aiCopyIdeas: "Copy",
    aiIdeasHint: "These are creative directions — copy any you like, or discard.",
    transitionAssessing: "Assessing scene rhythm…",
    transitionContinueScene: "Continue current scene",
    transitionAccept: "Accept transition",
    transitionSuggests: "AI suggests:",
    transitionSceneLabel: "New scene heading",
    transitionReasonContinue: "Continue in the current scene.",
    transitionReasonTransition: "Transition to a new scene.",
    aiSavePrompt: "Save to Storyboard",
    aiCopyPrompt: "Copy Prompt",
    aiDeletePrompt: "Delete",
    imagePromptOpen: "View",
    storyboardHint: "Contains only the six visual elements (subject, environment, composition, lighting, material, mood). Add aspect ratio and quality boosters yourself in your image tool.",
    storyboardBatchSceneHint: "Alt+S on a scene heading generates this scene's environment image, then a character design sheet for every distinct character and a storyboard frame for every action in it that lacks one.",
    storyboardBatchProgress: "Generating image prompt {current}/{total}…",
    storyboardBatchPartial: "{failed}/{total} image prompts failed; the rest were saved.",
    storyboardAllDone: "Every block in this scene already has a storyboard prompt. To regenerate one, delete that block's prompt (panel 🗑) and press Alt+S again — or re-add the beat if you deleted the blocks themselves.",
    videoPlanHint: "Aggregates the script's timeline into video-generation segments of ≤ your target duration (H3 4-15s etc). Deterministic — reads each beat's timestamp, groups consecutive beats into one generation window. Fewer videos, better consistency.",
    videoPlanDone: (n: number, target: number) => `Script aggregates into ${n} video segment(s) of ≤${target}s each.`,
    videoPlanNoTimeline: "No beat timestamps found. Beats need 00:00-00:03 style prefixes (FROM_PROMPT transcriptions carry them) — or generate grayboxes to time the scene.",
    videoPlanExport: "Download plan",
    videoPlanNext: "Next: record white-model per segment → submit to H3",
    imageTestLabel: "Engine test (text-to-image / image-to-image)",
    imageTestUpload: "Upload ref",
    imageTestRefHint: "Optional: upload a reference image → image-to-image; none → text-to-image",
    imageTestClear: "remove",
    imageTestPromptPh: "Enter a test prompt, e.g. a young woman on a black sofa smiling at the camera",
    imageTestRun: "Test generation",
    imageTestRunning: "Generating…",
    imageTestOk: "✅ Generated",
    imageTestNote: "Uses the CURRENT form values — testable before saving",
    storyboardWrongBlock: "Select a SCENE_HEADING (environment), ACTION (storyboard frame), or CHARACTER (design sheet) block to generate an image prompt.",
    storyboardPromptLabel: "Image Prompt",
    storyboardElements: {
      subject: "Subject",
      environment: "Environment",
      composition: "Composition",
      lighting: "Lighting",
      material: "Material",
      mood: "Mood"
    },
    grayboxHint: "Structured 3D previs JSON (layout primitives + character blocking for a scene, or camera shot + movement for a beat). Will be rendered by Three.js in a later phase.",
    grayboxWrongBlock: "Select a SCENE HEADING, ACTION, or DIALOGUE block to generate a graybox.",
    grayboxSave: "Save Graybox",
    grayboxCopy: "Copy JSON",
    grayboxLabel: "Graybox",
    grayboxBlender: "Blender .py",
    grayboxOpen: "View",
    graybox3dLabel: "3D",
    graybox3dHint: "Interactive 3D previs. Scene graybox shows layout + character blocking; shot graybox animates the camera along its movement path. Drag to orbit.",
    grayboxBatchProgress: "Generating shot {current}/{total}…",
    grayboxBatchPartial: "{failed}/{total} shots failed; the rest were saved.",
    grayboxBatchSceneHint: "Alt+G on a scene heading generates this scene's graybox, then auto-generates a shot graybox for every action/dialogue beat in it that lacks one.",
    aiErrorKeyMissing: "API key is missing. Please configure it in Settings.",
    aiErrorGeneric: "Failed to generate content. Please try again.",
    pdfExportError: "PDF export failed. Your edits are preserved.",
    appearanceColorsDesc: "Select custom text colors for your script elements. Clear the color to revert to the theme default.",
    geminiThinkingLabel: "Reasoning Effort",
    geminiThinkingNone: "None (Fastest)",
    geminiThinkingLow: "Low",
    geminiThinkingMedium: "Medium",
    geminiThinkingHigh: "High (Deepest)",
    geminiThinkingDesc: "Controls how much the model 'thinks' before responding. Higher = deeper reasoning but slower. Only applies to Gemini 3.x Flash/Pro.",
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
      rewrite: "Rewrite",
      storyboard: "Storyboard",
      graybox: "Graybox",
      dub: "Dub sheet",
      fromPrompt: "Prompt→Script",
      videoPlan: "Video Plan",
      syncCloud: "Sync to cloud"
    },
    styleHeadTitle: "Style Head",
    styleHeadPickFirst: "Pick a style head — lock one visual look for all image prompts",
    styleHeadRegenerate: "Regenerate",
    styleHeadCurrent: "Current",
    styleHeadHint: "Pick the visual DNA for this script (art style + world preset). Every image prompt will be locked to this look for consistency.",
    styleHeadGenerating: "Designing visual directions…",
    styleHeadArt: "Art style",
    styleHeadScene: "World",
    styleHeadApply: "Lock this look",
    styleHeadError: "Style generation failed",
    styleHeadParseError: "The model returned an unreadable style list — try again",
    styleHeadSkip: "Decide later",
    styleHeadFooterLocked: "Changing the style head later does NOT retroactively change prompts already generated.",
    styleHeadFooterNone: "No style locked yet — image prompts will infer style per image (may drift).",
    prompts: {
      continue: "Analyze context and generate the next few lines.",
      ideas: "Generate plot twists or creative directions.",
      rewrite: "Polish the selected block.",
      storyboard: "Generate a text-to-image prompt for this action or character (six visual elements).",
      graybox: "Generate a 3D graybox (spatial layout for a scene, or camera/运镜 for a shot).",
      dub: "Infer per-line dubbing direction (emotion + delivery + intensity) for every dialogue block, saved for a stable-voice dubbing sheet.",
      videoPlanHint: "Reads each beat's timestamp and aggregates consecutive beats into video-generation segments of ≤15s (scene changes force a boundary; beats are atomic). Deterministic — no AI call.",
      fromPrompt: "Paste a finished production/AI-video prompt (scene + camera rules, costumes, timeline with dialogue). It is transcribed into a new screenplay — costume changes become 张三（浴袍）-style character cues, so variants and sequences light up automatically."
    },
    fromPromptEmpty: "Paste the production prompt first.",
    fromPromptAccept: "Create as new script",
    fromPromptPlaceholder: "Paste the full production prompt here — scene, camera rules, costumes, timeline with dialogue, subtitles, audio, negatives…",
    blankTemplateTitle: "Blank Script",
    refLockLabel: "Refs:",
    refLockEnv: "Scene backdrop",
    refLockNoEnv: "No env backdrop linked",
    refLockNoEnvHint: "No environment image is linked for this scene — the background will NOT be locked. Generate the scene heading's environment image (or bind one in the asset library) to lock the background.",
    refLockNoSheet: "no design sheet (bootstrap or link one)",
    refLockNoCharacter: "no character (empty shot)",
    blankTemplateDesc: "Start from scratch — no AI opening, no skeleton. One empty scene heading.",
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
      tpl_ad_desc: "Short form. Focus on visuals and voiceovers.",
      tpl_lyrics_name: "Song Lyrics",
      tpl_lyrics_desc: "Professional songwriting template with structure, rhyme schemes, and production notes.",
      tpl_sci_live_name: "Science · Live Presenter",
      tpl_sci_live_desc: "Talking-head science videos. Hook-first structure, B-roll/demo cues, accurate and conversational.",
      tpl_sci_anim_name: "Science · Animation",
      tpl_sci_anim_desc: "Animated explainers. Animatable visual actions, narrator voiceover, on-screen labels.",
      tpl_sci_graphic_name: "Science · Illustrated Article",
      tpl_sci_graphic_desc: "Skimmable long-form science articles with figures, captions, and data callouts."
    },
    languages: {
      en: "English",
      zh: "Chinese (Simplified)",
      dual: "Dual Language (En/Zh)"
    },
    galleryAccountTab: "Account",
    galleryTitle: "Gallery Cloud",
    galleryMockNotice: "Dev mode: mock backend — data stays in this browser.",
    gallerySignedInAs: "Signed in as",
    gallerySignOut: "Sign Out",
    galleryDevice: "Device Name",
    gallerySyncAll: "Sync all scripts",
    gallerySyncing: "Syncing…",
    gallery4aSignIn: "Sign in with 4A (phone code)",
    gallery4aHint: "StoryFlow uses the smartbid.site 4A unified login — sign in with your phone number; unregistered numbers get an account automatically.",
    gallery4aLogoutEverywhere: "Sign out all devices",
    gallery4aLogoutEverywhereHint: "Revokes every 4A session for your account across all smartbid apps",
    galleryCredits: "Credits (community storage)",
    gallery_status_local: "Local only — click to sync",
    gallery_status_synced: "Synced",
    gallery_status_dirty: "Unsaved changes — click to sync",
    gallery_status_pushing: "Syncing…",
    gallery_status_conflict: "Sync conflict — click to retry",
    gallery_signInToSync: "Sign in (Settings → Account) to sync",
    // ---- privacy remediation (2026-09): consent + disclosure ----
    cloudSyncDisabledHint: "Cloud sync is off — enable it in Settings → Account",
    cloudSyncToggle: "Cloud sync",
    cloudSyncStateOn: "On",
    cloudSyncStateOff: "Off",
    cloudSyncEnableTitle: "Before enabling cloud sync, please note:",
    cloudSyncConsentLines: "· Cloud scripts will be pulled to this device\n· Edits to synced scripts upload automatically\n· Sign-in uses the 4A unified account; credentials stay in this browser",
    cloudSyncEnable: "Enable",
    cloudSyncDisableConfirm: "Turning cloud sync off signs you out and drops the pending upload queue. Turn it off?",
    cloudPullPolicyLabel: "Pull cloud scripts",
    cloudPullAskLabel: "Ask every time",
    cloudPullAutoLabel: "Pull automatically",
    cloudPullNeverLabel: "Never pull",
    cloudPullAskConfirm: "The cloud has {n} script(s) not on this device. Pull them down?\n(This choice is remembered — change it later in Settings → Account)",
    cloudCookieLoginAsk: "A 4A family sign-in session was detected.\n\nSign in and enable cloud sync? Once on:\n· Cloud scripts are pulled to this device\n· Edits to synced scripts upload automatically\n(You can turn it off anytime in Settings → Account)",
    cloudToastFork: "Cloud update detected — kept a local copy of \"{title}\"",
    cloudToastFirstPush: "\"{title}\" synced to the cloud for the first time",
    cloudExportAll: "Export all cloud scripts",
    cloudDeleteAll: "Delete all cloud data…",
    cloudDeleteAllConfirm: "This deletes ALL cloud scripts ({n}) and cloud assets ({m}). Irreversible. Continue?",
    cloudExportNone: "The cloud has no scripts.",
    cloudExportDone: "Exported {n} cloud script(s).",
    cloudDeleteDone: "Deleted {n} cloud script(s) and {m} cloud asset(s).",
    aiEgressNote: "Using AI generation means you understand the related text / images / white-model video are sent to the provider you configured (Google / DeepSeek / MiniMax, fal.ai and its downstream models, or your own ComfyUI server) for generation; API keys stay in this browser only.",
    galleryTabBrowse: "Discover",
    galleryTabMine: "My Published",
    galleryTabGroups: "Groups",
    gallerySearchPlaceholder: "Search titles…",
    galleryRefresh: "Search",
    galleryEmpty: "Nothing published yet.",
    galleryMineEmpty: "Sync a script first, then publish it here.",
    galleryNoGroups: "No groups yet — create one!",
    galleryMembers: "members",
    galleryAddMember: "Add by email",
    galleryAdd: "Add",
    galleryCreateGroup: "New group",
    galleryGroupName: "Group name",
    galleryFork: "Clone to my scripts",
    galleryForked: "Cloned ✓",
    galleryDetailBack: "Back",
    gallerySignInPrompt: "Sign in (Settings → Account) to browse the gallery.",
    galleryLoading: "Loading…",
    galleryBlocks: "blocks",
    gallery_vis_private: "Private",
    gallery_vis_group: "Group",
    gallery_vis_public: "Public",
    galleryPushToGroup: "Push to group",
    galleryPushPickGroup: "Push to group",
    galleryPushConfirm: "Push",
    galleryPushNoGroups: "No groups yet — create one in the Groups tab first.",
    galleryPushed: "Pushed ✓",
    galleryQuickPreview: "Preview",
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
    importScript: "导入 JSON 剧本",
    importScriptError: "导入失败——该文件不是有效的剧本 JSON 导出。",
    assetPackExport: "资产导出",
    assetPackImport: "资产导入",
    assetPackExportHint: "把整个资产库（图片+身份信息）打包成一个可移植的 JSON 文件",
    assetPackImportHint: "导入资产包：按原有身份/版本组重建资产库",
    assetPackEmpty: "资产库为空——没有可导出的内容。",
    assetPackImported: "已导入 {ok}/{total} 个资产。",
    dataSection: "数据",
    selectTemplate: "选择模板",
    openingTitle: "选择你的剧本开头",
    openingDefault: "模板默认开头",
    openingGenerate: "🎲 随机生成开头",
    openingReroll: "🎲 换一批",
    openingConfirm: "用这个开头创建",
    openingLoading: "正在构思开头…",
    openingBlank: "空白开始（不用 AI 开场）",
    openingAiHint: "三个 AI 随机开头——选一个，或保留模板默认。",
    cancel: "取消",
    create: "创建",
    save: "保存",
    assetLibraryLabel: "参考资产库",
    exportPdf: "导出 PDF",
    exportTitle: "导出",
    exportFormat: "格式",
    exportInclude: "包含内容",
    exportIncludePrompts: "分镜图提示词",
    exportIncludeGraybox: "灰模（3D 预演）",
    exportGrayboxAs: "灰模形式",
    exportGrayboxJson: "JSON",
    exportGrayboxSummary: "摘要",
    exportGrayboxAlwaysJson: "JSON 格式始终包含完整灰模 JSON。",
    exportIncludeDubbing: "配音方向（情绪 / 口吻 / 强度）",
    exportIncludeBlockIds: "区块类型 + ID 标注",
    exportJson: "JSON",
    exportMarkdown: "Markdown",
    exportJsonDesc: "无损完整导出（所有区块 + AI 数据）",
    exportMarkdownDesc: "可读剧本 + 折叠的 AI 数据",
    exportPdfDesc: "可打印剧本 + 附录",
    exportDo: "导出",
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
    videoGenLabel: "视频生成 · MiniMax H3",
    videoGenRegionLabel: "接口端点",
    videoGenHint: "仅提交白模生成任务时使用（按秒计费：输出 + 输入参考视频均计费；🎨生图按图计费）。密钥获取：platform.minimaxi.com → 账户管理 → 接口密钥。国内站 api.minimax.cn 与本端点等效可互换；国际站需在 minimax.io 单独充值取 key。",
    imageGenLabel: "文生图后端",
    imageGenHint: "选择把分镜提示词生成为图片的后端。MiniMax 用上面的 MiniMax Key；FAL 需要独立的 FAL Key。",
    imageGenNeedsImage: "角色「{name}」还没有设定图——请先生成该角色的 image，再进行本镜的图生图。",
    imageGenNeedsImageOptions: "可以：① 直接生成（全新文生图，结果自动存为该角色的设定图）；② 从资产库选择已有图作为设定图。",
    imageGenLinkSheet: "从资产库为「{name}」选择设定图",
    imageGenBootstrapTitle: "无设定图——将全新文生图，结果自动存为「{name}」的设定图（之后可图生图）",
    imageGenNoAssets: "资产库为空——请先上传或生成一张图。",
    imageGenPickEnv: "为该场景选择环境背景图",
    refLockChange: "点击更换该帧锁定的参考图",
    imageGenEmptyShot: "本动作块没有角色——将作为空镜生成（文生图，不锁角色形象）。",
    falKeyLabel: "FAL API Key",
    falKeyHint: "在 fal.ai → Billing → API Keys 获取。官方定价（openai/gpt-image-2.5）：1024×768 low $0.00402/张、1920×1080 low $0.00441/张、1024×768 high $0.03612/张。",
    falModelLabel: "FAL 模型",
    falModelHint: "填基础应用路径。当有已绑定角色图时自动切到 /edit 端点（参考图身份锁），否则走 /text-to-image。",
    falQualityLabel: "FAL 质量（成本）",
    falQualityHint: "官方费率：low 比 high 便宜约 9×；尺寸另有最多约 2.8× 差异（1024×768 → 3840×2160）。分镜迭代用 low 即可。",
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
    aiCopyIdeas: "复制",
    aiIdeasHint: "这些是创意方向——可复制需要的部分，或直接放弃。",
    transitionAssessing: "正在评估场景节奏…",
    transitionContinueScene: "继续当前场景",
    transitionAccept: "采纳转场",
    transitionSuggests: "AI 建议：",
    transitionSceneLabel: "新场景标题",
    transitionReasonContinue: "继续在当前场景内推进。",
    transitionReasonTransition: "转场到新场景。",
    aiSavePrompt: "保存到分镜",
    aiCopyPrompt: "复制提示词",
    aiDeletePrompt: "删除",
    imagePromptOpen: "查看",
    storyboardHint: "仅含六大视觉要素（主体、环境、构图、光影、材质、氛围）。画幅比例和画质词请在出图工具中自行添加。",
    storyboardBatchSceneHint: "在场景标题上按 Alt+S 会先为该场景生成环境图，再为其中每个出现的不同角色生成设定图、为每个还没有分镜的动作块生成分镜画面。",
    storyboardBatchProgress: "正在生成分镜提示词 {current}/{total}…",
    storyboardBatchPartial: "{total} 个分镜提示词中有 {failed} 个失败，其余已保存。",
    storyboardAllDone: "该场景所有块都已生成分镜提示词。要重新生成某个块：删除它的提示词（面板 🗑）后再按 Alt+S；如果你把块本身删掉了，请先把该节拍的文字重新加上。",
    videoPlanHint: "把剧本时间轴聚合为 ≤目标时长的视频生成段（H3 4-15s 等）。确定性计算——读取每拍的时间戳，将连续节拍聚合进同一个生成窗口。生成次数更少，段内一致性更好。",
    videoPlanDone: (n: number, target: number) => `剧本聚合为 ${n} 个视频生成段（每段 ≤${target}s）。`,
    videoPlanNoTimeline: "未找到节拍时间戳。节拍需要 00:00-00:03 式前缀（提示词转剧本会自动带上），或先生成灰模来给场景计时。",
    videoPlanExport: "下载分段计划",
    videoPlanNext: "下一步：逐段录制白模 → 提交 H3",
    imageTestLabel: "引擎测试（文生图 / 图生图）",
    imageTestUpload: "上传参考图",
    imageTestRefHint: "可选：上传参考图 → 图生图；不上传 → 文生图",
    imageTestClear: "移除",
    imageTestPromptPh: "输入测试提示词，例如：一位年轻女性坐在黑色沙发上，微笑看向镜头",
    imageTestRun: "测试生成",
    imageTestRunning: "生成中…",
    imageTestOk: "✅ 生成成功",
    imageTestNote: "以上为表单当前配置（保存前即可测试）",
    storyboardWrongBlock: "请选中场景标题（环境图）、动作块（分镜画面）或角色块（设定表）再生成提示词。",
    storyboardPromptLabel: "文生图提示词",
    storyboardElements: {
      subject: "主体",
      environment: "环境",
      composition: "构图",
      lighting: "光影",
      material: "材质",
      mood: "氛围"
    },
    grayboxHint: "结构化 3D 预演 JSON（场景的布局图元 + 角色走位，或镜头的景别 + 运镜）。后续将由 Three.js 渲染。",
    grayboxWrongBlock: "请选中场景标题、动作或对白块再生成灰模。",
    grayboxSave: "保存灰模",
    grayboxCopy: "复制 JSON",
    grayboxLabel: "灰模",
    grayboxBlender: "Blender 脚本",
    grayboxOpen: "查看",
    graybox3dLabel: "3D",
    graybox3dHint: "交互式 3D 预演。场景灰模展示布局与角色走位；镜头灰模按运镜路径播放摄影机动画。拖动可旋转视角。",
    grayboxBatchProgress: "正在生成镜头 {current}/{total}…",
    grayboxBatchPartial: "{total} 个镜头中有 {failed} 个失败，其余已保存。",
    grayboxBatchSceneHint: "在场景标题上按 Alt+G 会先生成该场景灰模，再自动为其中每个还没有灰模的动作/对白逐个生成镜头灰模。",
    aiErrorKeyMissing: "缺少 API 密钥，请在设置中配置。",
    aiErrorGeneric: "生成内容失败，请重试。",
    pdfExportError: "导出 PDF 失败，你的编辑内容已保留。",
    appearanceColorsDesc: "为剧本元素选择自定义文字颜色。清除颜色可恢复主题默认。",
    geminiThinkingLabel: "推理深度",
    geminiThinkingNone: "关闭 (最快)",
    geminiThinkingLow: "低",
    geminiThinkingMedium: "中",
    geminiThinkingHigh: "高 (最深入)",
    geminiThinkingDesc: "控制模型在响应前的思考程度。越高推理越深但越慢。仅对 Gemini 3.x Flash/Pro 生效。",
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
      rewrite: "润色",
      storyboard: "分镜",
      graybox: "灰模",
      dub: "配音表",
      fromPrompt: "提示词转剧本",
      videoPlan: "视频分段",
      syncCloud: "同步到云端"
    },
    styleHeadTitle: "风格头",
    styleHeadPickFirst: "选定风格头——为所有文生图锁定统一画风",
    styleHeadRegenerate: "换一批",
    styleHeadCurrent: "当前",
    styleHeadHint: "为剧本选定视觉基因（画风 + 世界场景）。之后所有文生图提示词都会锁定这套风格，保持前后一致。",
    styleHeadGenerating: "正在生成视觉方向…",
    styleHeadArt: "画风",
    styleHeadScene: "场景",
    styleHeadApply: "锁定此风格",
    styleHeadError: "风格生成失败",
    styleHeadParseError: "模型返回的风格列表无法解析——请重试",
    styleHeadSkip: "以后再定",
    styleHeadFooterLocked: "之后更换风格头，不会回溯修改已生成的提示词。",
    styleHeadFooterNone: "尚未锁定风格——文生图将按每张图自行推断（可能漂移）。",
    prompts: {
      continue: "分析上下文并生成后续内容。",
      ideas: "为下一场戏生成情节转折或创意方向。",
      rewrite: "润色选定的段落。",
      storyboard: "为该动作或角色生成文生图提示词（六大视觉要素）。",
      graybox: "生成 3D 灰模（场景的空间布局，或镜头的运镜）。",
      dub: "为每句对白推断配音方向（情绪 + 口吻 + 强度）并保存，供稳定的音色配音表导出。",
      videoPlanHint: "读取每拍时间戳，将连续节拍聚合为 ≤15s 的视频生成段（场景变化强制分段；节拍不可拆分）。确定性计算——不调用 AI。",
      fromPrompt: "粘贴一段写好的制作提示词（画面 + 运镜规则 + 服装 + 时间轴对白）。系统会把它转写成一份新剧本——换装自动变成 张三（浴袍） 式的角色 cue，变体与序列机制自动生效。"
    },
    fromPromptEmpty: "请先粘贴制作提示词。",
    fromPromptAccept: "生成为新剧本",
    fromPromptPlaceholder: "把完整的制作提示词粘贴到这里——场景、运镜规则、服装、时间轴对白、字幕、音频、NEGATIVE……",
    blankTemplateTitle: "空白剧本",
    refLockLabel: "参考：",
    refLockEnv: "场景背景",
    refLockNoEnv: "未绑定环境图",
    refLockNoEnvHint: "该场景没有绑定的环境图——背景不会被锁定。先在场景标题面板生成环境图（或在资产库绑定一张）即可锁定背景。",
    refLockNoSheet: "无设定图（可全新生成或链接）",
    refLockNoCharacter: "无角色（空镜）",
    blankTemplateDesc: "从零开始——不用 AI 开场，无骨架内容，只有一个空场景标题。",
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
      tpl_ad_desc: "短片格式，专注于视觉冲击与旁白。",
      tpl_lyrics_name: "歌曲创作",
      tpl_lyrics_desc: "专业歌词创作模板，包含歌曲结构、押韵方案和制作备注。",
      tpl_sci_live_name: "科普 · 真人口播",
      tpl_sci_live_desc: "真人出镜科普视频。开场钩子、B-roll 与演示画面提示，口语化且严谨。",
      tpl_sci_anim_name: "科普 · 动画解说",
      tpl_sci_anim_desc: "动画科普解说。可绘制的画面动作、旁白解说词、屏幕标注。",
      tpl_sci_graphic_name: "科普 · 图文",
      tpl_sci_graphic_desc: "长图文科普。小节化速读结构、配图与图注、数据点标注。"
    },
    languages: {
      en: "英语",
      zh: "中文 (简体)",
      dual: "双语 (英/中)"
    },
    galleryAccountTab: "账号",
    galleryTitle: "Gallery 云端",
    galleryMockNotice: "开发模式：模拟后端——数据仅存于本浏览器。",
    gallerySignedInAs: "当前账号",
    gallerySignOut: "退出登录",
    galleryDevice: "设备名",
    gallerySyncAll: "同步全部剧本",
    gallerySyncing: "同步中…",
    gallery4aSignIn: "使用 4A 统一登录（手机验证码）",
    gallery4aHint: "StoryFlow 接入 smartbid.site 4A 统一登录——手机号验证码登录，未注册号码自动建号。",
    gallery4aLogoutEverywhere: "退出所有设备",
    gallery4aLogoutEverywhereHint: "吊销该账号在所有 smartbid 系应用中的 4A 会话",
    galleryCredits: "积分（社区存储贡献）",
    gallery_status_local: "仅本地——点击同步",
    gallery_status_synced: "已同步",
    gallery_status_dirty: "有改动未同步——点击同步",
    gallery_status_pushing: "同步中…",
    gallery_status_conflict: "同步冲突——点击重试",
    gallery_signInToSync: "登录后可同步（设置 → 账号）",
    // ---- privacy remediation (2026-09): consent + disclosure ----
    cloudSyncDisabledHint: "云同步未开启 —— 请在 设置 → 账号 中开启",
    cloudSyncToggle: "云同步",
    cloudSyncStateOn: "已开启",
    cloudSyncStateOff: "已关闭",
    cloudSyncEnableTitle: "开启云同步前，请确认：",
    cloudSyncConsentLines: "· 云端剧本将被拉取到本机\n· 已同步剧本的编辑会自动上传到云端\n· 登录使用 4A 统一账号，凭据仅保存在本机浏览器",
    cloudSyncEnable: "确认开启",
    cloudSyncDisableConfirm: "关闭云同步将退出登录，并丢弃本机待同步队列。确定关闭？",
    cloudPullPolicyLabel: "云端剧本拉取",
    cloudPullAskLabel: "每次询问",
    cloudPullAutoLabel: "自动拉取",
    cloudPullNeverLabel: "不拉取",
    cloudPullAskConfirm: "云端有 {n} 个本机没有的剧本，拉取到本地吗？\n（此选择会被记住，可在 设置 → 账号 修改）",
    cloudCookieLoginAsk: "检测到 4A 家族登录会话。\n\n登录并开启云同步？开启后：\n· 云端剧本会拉取到本机\n· 已同步剧本的编辑会自动上传\n（可随时在 设置 → 账号 关闭）",
    cloudToastFork: "检测到云端更新，已保留副本「{title}」",
    cloudToastFirstPush: "「{title}」已首次同步到云端",
    cloudExportAll: "导出云端全部剧本",
    cloudDeleteAll: "删除云端全部数据…",
    cloudDeleteAllConfirm: "将删除云端全部剧本（{n} 个）与云资产（{m} 个），不可撤销。确定？",
    cloudExportNone: "云端没有剧本。",
    cloudExportDone: "已导出 {n} 个云端剧本。",
    cloudDeleteDone: "已删除 {n} 个云端剧本、{m} 个云资产。",
    aiEgressNote: "启用 AI 生成即表示知晓：相关文本 / 图像 / 白模视频将发送至所选服务商（Google / DeepSeek / MiniMax、fal.ai 及其下游模型，或你的 ComfyUI 服务器）用于生成；API Key 仅保存在本机浏览器。",
    galleryTabBrowse: "发现",
    galleryTabMine: "我的发布",
    galleryTabGroups: "组",
    gallerySearchPlaceholder: "搜索标题…",
    galleryRefresh: "搜索",
    galleryEmpty: "还没有公开的作品。",
    galleryMineEmpty: "先同步剧本，再在这里发布。",
    galleryNoGroups: "还没有组——创建一个吧！",
    galleryMembers: "名成员",
    galleryAddMember: "按邮箱添加成员",
    galleryAdd: "添加",
    galleryCreateGroup: "新建组",
    galleryGroupName: "组名",
    galleryFork: "克隆到我的剧本",
    galleryForked: "已克隆 ✓",
    galleryDetailBack: "返回",
    gallerySignInPrompt: "登录后可浏览 Gallery（设置 → 账号）。",
    galleryLoading: "加载中…",
    galleryBlocks: "块",
    gallery_vis_private: "私有",
    gallery_vis_group: "组内",
    gallery_vis_public: "公开",
    galleryPushToGroup: "推送到组",
    galleryPushPickGroup: "推送到组",
    galleryPushConfirm: "推送",
    galleryPushNoGroups: "还没有组——请先在“组”标签页创建。",
    galleryPushed: "已推送 ✓",
    galleryQuickPreview: "预览",
    providers: {
      gemini: "Google Gemini",
      deepseek: "DeepSeek"
    }
  }
};
/** CN video models and their allowed output durations (seconds).
 *  H3-Max does not support the 4s window. */
export const MINIMAX_VIDEO_MODELS: {
  id: string;
  label: string;
  min: number;
  max: number;
  /** Resolutions priced for this model (刊例). H3's API-accepted 480P is
   *  unpriced in the table, so it is not offered. */
  resolutions: { id: '480P' | '768P' | '2K'; label: string; perSec: number }[];
}[] = [
  {
    id: 'MiniMax-H3', label: 'MiniMax-H3（4~15s）', min: 4, max: 15,
    resolutions: [
      { id: '768P', label: '768P（¥0.50/s）', perSec: 0.5 },
      { id: '2K', label: '2K（¥0.80/s）', perSec: 0.8 },
    ],
  },
  {
    id: 'MiniMax-H3-Max', label: 'MiniMax-H3-Max（5~15s）', min: 5, max: 15,
    resolutions: [
      { id: '480P', label: '480P（¥0.33/s）', perSec: 0.33 },
      { id: '768P', label: '768P（¥0.50/s）', perSec: 0.5 },
    ],
  },
];
