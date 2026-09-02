import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ScriptBlock, ScriptLanguage, AppSettings, SceneTransitionDecision, GrayboxData, GrayboxObject, GrayboxCharacter, GrayboxCamera } from "../types";

// Helper to get plain text context from blocks
const getScriptContext = (blocks: ScriptBlock[], count: number): string => {
  return blocks.slice(-count).map(b => {
    let prefix = '';
    if (b.type === 'SCENE_HEADING') prefix = '\n';
    if (b.type === 'CHARACTER') prefix = '\n';
    return `${prefix}${b.type}: ${b.content}`;
  }).join('\n');
};

/** Build a one-line-per-scene map of the WHOLE script — every SCENE_HEADING
 *  in order, each as "n. <heading content>". This is the cheap global view fed
 *  to continuation so the model knows the full story map and doesn't drop
 *  distant setups/reversals. Local-only, no AI call. Returns '' when there
 *  are no scene headings (single-scene or lyric scripts). */
const getSceneMap = (blocks: ScriptBlock[]): string => {
  const scenes: string[] = [];
  let sceneNo = 0;
  for (const b of blocks) {
    if (b.type === 'SCENE_HEADING' && b.content.trim()) {
      sceneNo += 1;
      scenes.push(`${sceneNo}. ${b.content.trim()}`);
    }
  }
  return scenes.length ? scenes.join('\n') : '';
};

const getLanguageInstruction = (lang: ScriptLanguage): string => {
  switch (lang) {
    case 'zh':
      return 'Generate the content strictly in Chinese (Simplified).';
    case 'dual':
      return 'Generate the content in Dual Language mode. For SCENE HEADINGS and ACTION, provide the English text followed by the Chinese translation. For DIALOGUE, write the English line, followed by the Chinese translation in the next block or within brackets if short.';
    case 'en':
    default:
      return 'Generate the content strictly in English.';
  }
};

// Generic AI Call Handler
const callAIProvider = async (
  settings: AppSettings,
  messages: { system: string, user: string },
  jsonMode = false,
): Promise<string> => {

  // 1. DeepSeek Provider
  if (settings.provider === 'deepseek') {
    if (!settings.deepseekApiKey) throw new Error("DEEPSEEK_KEY_MISSING");

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.deepseekApiKey}`
        },
        body: JSON.stringify({
          model: settings.deepseekModel || 'deepseek-v4-flash',
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user }
          ],
          stream: false,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `DeepSeek API Error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.error("DeepSeek API Error:", e);
      throw e;
    }
  } 
  
  // 2. Google Gemini Provider (Default)
  else {
    const key = settings.geminiApiKey || process.env.API_KEY;
    if (!key) throw new Error("GEMINI_KEY_MISSING");

    const ai = new GoogleGenAI({ apiKey: key });

    // Combine system and user prompt for Gemini's simple interface or use config
    const combinedPrompt = `${messages.system}\n\n${messages.user}`;

    // Map the user-facing thinking level to the SDK's thinkingLevel enum.
    // 'none' disables thinking entirely (budget 0); others map to the enum members.
    const userLevel = settings.geminiThinkingLevel;
    const levelMap: Record<'low' | 'medium' | 'high', ThinkingLevel> = {
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH,
    };
    const thinkingConfig = userLevel === 'none'
      ? { thinkingBudget: 0 }
      : { thinkingLevel: levelMap[userLevel] };

    try {
      const response = await ai.models.generateContent({
        model: settings.geminiModel || 'gemini-3.7-flash',
        contents: combinedPrompt,
        config: {
          temperature: 0.9,
          thinkingConfig,
          ...(jsonMode ? { responseMimeType: 'application/json' as const } : {}),
        }
      });
      return response.text || '';
    } catch (error) {
      console.error("Gemini Generate Error:", error);
      throw error;
    }
  }
};


export const generateContinuation = async (
  blocks: ScriptBlock[],
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
  templateId?: string,
  continueDirective?: { allowTransition: boolean; targetSceneHeading?: string }
): Promise<string> => {
  const context = getScriptContext(blocks, settings.aiContextBlocks);
  const sceneMap = getSceneMap(blocks);
  const langInstruction = getLanguageInstruction(scriptLanguage);

  const systemPrompt = `${systemInstruction}\n${langInstruction}`;

  // Special handling for lyrics template
  const isLyrics = templateId === 'lyrics';
  const songInfoContext = isLyrics ? extractSongInfo(blocks) : '';

  // Scene-transition directive injected by the CONTINUE two-step flow.
  // allowTransition=false forces the model to stay in the current scene;
  // allowTransition=true + targetSceneHeading makes it open a new scene.
  let directiveInstruction = '';
  if (continueDirective && !isLyrics) {
    if (!continueDirective.allowTransition) {
      directiveInstruction = `\n\nScene-transition rule: You MUST stay in the current scene. Do NOT write a new [SCENE] heading. Continue the existing scene only.`;
    } else if (continueDirective.targetSceneHeading) {
      directiveInstruction = `\n\nScene-transition rule: Begin with a new scene heading [SCENE] ${continueDirective.targetSceneHeading}. Then write the new scene's content.`;
    }
  }

  const userPrompt = isLyrics ? `
  Analyze the provided song lyrics excerpt.

  Configuration:
  - Context Blocks Used: ${settings.aiContextBlocks}
  - Output Blocks to Generate: ${settings.aiOutputBlocks}

  ${songInfoContext}

  Current Lyrics Context:
  ---
  ${context}
  ---

  Task: Write the immediate continuation of these lyrics.

  Generate exactly ${settings.aiOutputBlocks} blocks.

  Requirements:
  1. Style Consistency: Match the established Style, Sub-Style, and Mood from [SONG INFO]
  2. Structure Awareness: Follow standard song structure (VERSE, CHORUS, BRIDGE patterns)
  3. Rhyme & Rhythm: Maintain consistent syllable counts and stress patterns between matching sections
  4. Format: Use the following labeled format:
     [SCENE] [SECTION NAME] (e.g., [VERSE 2], [CHORUS], [BRIDGE])
     [ACTION] Lyrics content here...
     [CHARACTER] Production/mood notes (optional)

  5. Imagery: Use concrete nouns and specific scenarios (show, don't tell)
  6. Hook: If writing a CHORUS, make it catchy and thematically central

  Do not use markdown. Just the labeled blocks.
  ` : `
  Analyze the provided screenplay excerpt.

  Configuration:
  - Context Blocks Used: ${settings.aiContextBlocks}
  - Output Blocks to Generate: ${settings.aiOutputBlocks}
${sceneMap ? `
  Scene Map (the full list of scenes so far, for global story awareness — the scene you continue is the last one listed):
  ---
  ${sceneMap}
  ---
` : ''}
  Screenplay Context:
  ---
  ${context}
  ---

  Task: Write the immediate continuation of this script.

  Generate exactly ${settings.aiOutputBlocks} blocks.

  Requirements:
  1. Consistency: Strictly adhere to the established genre, tone, and format provided in your instructions.
  2. Plot: Advance the current scene logically.
  3. Format: You MUST use the following labeled format for every block to ensure correct parsing:
     [SCENE] INT./EXT. LOCATION - TIME
     [ACTION] Description of action...
     [CHARACTER] CHARACTER NAME
     [DIALOGUE] Dialogue content...
     [PARENTHETICAL] (instruction)
     [TRANSITION] CUT TO:

     Do not use markdown (no **bold**). Do not provide explanations. Just the labeled script blocks.
  ${directiveInstruction}
  `;

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt });
};

// Helper to extract song info from lyrics blocks
const extractSongInfo = (blocks: ScriptBlock[]): string => {
  const infoBlocks = blocks.filter(b => b.content.includes('Style:') || b.content.includes('Mood:') ||
                                    b.content.includes('Instruments:') || b.content.includes('Tempo:') ||
                                    b.content.includes('Vocals:') || b.content.includes('主风格') ||
                                    b.content.includes('情绪') || b.content.includes('乐器'));

  if (infoBlocks.length === 0) return '';

  return `Song Configuration:
---
${infoBlocks.map(b => b.content).join('\n')}
---`;
};

export const rewriteBlock = async (
  text: string,
  tone: string,
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
  templateId?: string,
  allBlocks?: ScriptBlock[]
): Promise<string> => {
  const langInstruction = getLanguageInstruction(scriptLanguage);

  const systemPrompt = `${systemInstruction}\n${langInstruction}`;

  // Special handling for lyrics template
  const isLyrics = templateId === 'lyrics';
  const songInfoContext = isLyrics && allBlocks ? extractSongInfo(allBlocks) : '';

  const userPrompt = isLyrics ? `
  Task: Rewrite the following lyrics line/section to be more "${tone}".
  ${songInfoContext}

  Original Text: "${text}"

  Guidelines for lyrics rewriting:
  - Maintain the original meaning and emotional core
  - Enhance based on the Style, Mood, and Scenario from [SONG INFO]
  - For "${tone}": ${getLyricsToneGuidance(tone)}
  - Preserve syllable count and rhythm patterns where applicable
  - Keep the imagery concrete and specific (show, don't tell)

  Return only the rewritten text, no quotes or markdown. Do not include [TYPE] labels.
  ` : `
  Task: Rewrite the following screenplay action or dialogue line to be more "${tone}".
  Maintain the original meaning but enhance the style according to your expertise.

  Original Text: "${text}"

  Return only the rewritten text, no quotes or markdown. Do not include [TYPE] labels.
  `;

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt });
};

// Helper for lyrics-specific tone guidance
const getLyricsToneGuidance = (tone: string): string => {
  const toneMap: Record<string, string> = {
    dramatic: 'Make it more intense and emotionally charged. Use stronger verbs and vivid imagery.',
    poetic: 'Add more metaphorical language, sensory details, and artistic expression.',
    catchy: 'Make it more memorable with rhythmic patterns, repetition, and hook-like phrases.',
    melancholic: 'Emphasize sadness and longing through somber imagery and softer language.',
    energetic: 'Use dynamic verbs, shorter phrases, and build momentum with rhythm.',
    romantic: 'Add intimate, emotional language with warmth and affection.',
    dark: 'Use darker imagery, minor key themes, and explore shadow emotions.',
    dreamy: 'Add ethereal, surreal imagery with softer, flowing language.',
    nostalgic: 'Include references to time, memory, and past experiences with sentimental language.',
    aggressive: 'Use powerful, confrontational language with harder consonant sounds.',
    minimal: 'Strip down to essentials - fewer words, more impact through simplicity.'
  };
  return toneMap[tone] || 'Enhance the expression while maintaining the original intent.';
};

export const suggestIdeas = async (
  blocks: ScriptBlock[],
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
  templateId?: string
): Promise<string[]> => {
  const context = getScriptContext(blocks, Math.max(20, Math.floor(settings.aiContextBlocks * 0.5)));
  const langInstruction = getLanguageInstruction(scriptLanguage);

  const systemPrompt = `${systemInstruction}\n${langInstruction}`;

  // Special handling for lyrics template
  const isLyrics = templateId === 'lyrics';
  const songInfoContext = isLyrics ? extractSongInfo(blocks) : '';

  const userPrompt = isLyrics ? `
  Act as a master songwriter and creative consultant. Based on the following song excerpt and configuration, suggest 3 creative directions.

  ${songInfoContext}

  Current Lyrics Context:
  ---
  ${context}
  ---

  Suggestions should explore:
  - Different structural approaches (e.g., add a pre-chorus, change bridge timing, add rap verse)
  - Lyrical themes and imagery that complement the established Mood and Scenario
  - Stylistic elements (e.g., harmonies, tempo changes, instrumental breaks)
  - Unexpected genre fusions or style twists that fit the Sub-Style

  Each suggestion should be:
  - Concise (1-2 sentences).
  - Musically and lyrically specific.
  - Distinct from each other.
  - Returned as a simple bulleted list (start lines with - or *).
  ` : `
  Act as a master consultant for this specific format. Based on the following segment, suggest 3 creative directions or plot twists.

  Screenplay Context:
  ---
  ${context}
  ---

  Suggestions should be:
  - Concise (1-2 sentences each).
  - Genre-appropriate.
  - Distinct from each other.
  - Returned as a simple bulleted list (start lines with - or *).
  `;

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt });

  return responseText.split('\n')
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
    .map(l => l.replace(/^[-*]\s+/, ''));
}

/**
 * Generate a structured text-to-image prompt for an ACTION or CHARACTER block
 * (storyboard).
 *
 * The prompt covers only the six core visual elements (subject, environment,
 * composition, lighting, material, mood) and is ALWAYS in English regardless of
 * the script's language — image models understand English best. Aspect-ratio
 * and quality-booster "technical" terms are intentionally omitted; the user adds
 * those in their external image tool.
 *
 * `sceneBlocks` is the current-scene context (most recent SCENE_HEADING through
 * the target block, inclusive), pre-sliced by the caller. `kind` selects the
 * focus: 'action' (scene illustration) or 'character' (character design sheet).
 */
export const generateImagePrompt = async (
  sceneBlocks: ScriptBlock[],
  targetBlockId: string,
  systemInstruction: string,
  settings: AppSettings,
  kind: 'action' | 'character' | 'environment' = 'action',
): Promise<string> => {
  // Image prompts are always English, independent of scriptLanguage.
  const langInstruction = 'Respond in English only.';

  const isCharacter = kind === 'character';
  const isEnvironment = kind === 'environment';

  const roleLine = isCharacter
    ? 'Your job: turn a screenplay CHARACTER into a single character-design image prompt.'
    : isEnvironment
    ? 'Your job: turn a screenplay SCENE HEADING into a single environment-establishing image prompt (a set "定妆照" for the space).'
    : 'Your job: turn a screenplay ACTION into a single, vivid, camera-ready image prompt.';

  const subjectGuidance = isCharacter
    ? '1. Subject — the character: name/role, age, ethnicity, body type, hair (style/color/length), face features, expression. A full head-to-toe appearance description, with costume and hair styled to the story\'s era and genre (period-accurate when the setting is period). If the surrounding beats imply a specific outfit state for THIS moment (battle-worn, formal court dress, travel gear, injured), describe that outfit — it defines this design sheet\'s costume variant.'
    : isEnvironment
    ? '1. Subject — the SPACE itself: location type, architecture/terrain, key furnishings or landmarks, era/genre styling, atmosphere. No characters (or tiny silhouettes for scale only).'
    : '1. Subject — who/what is in frame (characters, key objects), with pose, expression, motion.';

  const envGuidance = isCharacter
    ? '2. Environment — a neutral or simple backdrop suitable for a character design sheet (e.g. plain studio background). Keep it minimal so the character stands out.'
    : '2. Environment — location, time of day, weather, background detail. Architecture, furnishings, and set dressing must match the story\'s era and genre (period piece = period buildings and props, no anachronistic objects).';

  const compGuidance = isCharacter
    ? '3. Composition — character turnaround sheet: the SAME character in three views side by side (front / side / back), full-body, consistent scale and spacing, neutral standing pose — an animation model sheet. The three views must be identical in styling so the sheet locks the character\'s identity.'
    : isEnvironment
    ? '3. Composition — wide establishing frame of the whole space, eye level, full depth readable.'
    : '3. Composition — shot type (wide/medium/close), camera angle, framing, focus, depth of field.';

  const matGuidance = isCharacter
    ? '5. Material — clothing fabric, accessories, armor/prop materials, surface textures of garments.'
    : '5. Material — textures, fabrics, surfaces, finishes that sell realism or style.';

  const targetTag = isCharacter ? ' [TARGET CHARACTER TO DESIGN]' : isEnvironment ? ' [TARGET SCENE TO ESTABLISH]' : ' [TARGET ACTION TO ILLUSTRATE]';

  const systemPrompt = `You are a Storyboard Artist and expert Text-to-Image Prompt Engineer.
${roleLine}

${systemInstruction}

${langInstruction}

A high-quality image prompt must cover these SIX core visual elements and NOTHING else:
${subjectGuidance}
${envGuidance}
${compGuidance}
4. Lighting — light source, direction, quality (hard/soft), color of light, shadows.
${matGuidance}
6. Mood — emotional tone, atmosphere, color palette leaning.

STRICT RULES:
- ERA INTENT — the script is the authority on its visual world. Derive the era/genre the script actually depicts (from the persona, scene heading, and beats) and follow its INTENT: period worlds get period-accurate costume, props, and architecture; but when the script deliberately mixes eras or breaks convention (time-travel 穿越, dreams, otherworldly intrusion, genre parody), preserve and emphasize that deliberate contrast — a modern-dressed protagonist in an ancient court should read instantly as intentional. The only failure is UNINTENDED drift: era-inappropriate details nobody wrote (a period warrior casually wearing a wristwatch). When genre convention and the beats disagree, follow the beats.
- Output EXACTLY six lines, one per element, in this exact format:
  Subject: ...
  Environment: ...
  Composition: ...
  Lighting: ...
  Material: ...
  Mood: ...
- Do NOT include aspect ratio, resolution, or quality-booster terms (no 8k, no "high detail", no "professional photography"). The user adds those separately.
- Do NOT use markdown, headings, bullet points, code blocks, or any preamble/explanation.
- Each line must be a single concrete phrase. Be specific and visual (show, don't tell).
- Keep the TOTAL prompt under 1200 characters — the image API caps input length and the tail lines get trimmed first, so front-load the essentials (identity in Subject, era in Environment/Material) and keep later lines tight.
- Translate any non-English source content into English for the prompt.`;

  // Render the scene context, highlighting the target block.
  const context = sceneBlocks.map(b => {
    const isTarget = b.id === targetBlockId;
    const tag = isTarget ? targetTag : '';
    return `${b.type}:${tag} ${b.content}`;
  }).join('\n');

  // Established character designs: CHARACTER blocks in the scene that already
  // carry an imagePrompt (the canonical design sheets). Injected into ACTION
  // prompts so the storyboard frame depicts THE designed character — same
  // person, same clothes — instead of inventing a new appearance.
  const charDesigns = new Map<string, string>();
  if (!isCharacter) {
    for (const b of sceneBlocks) {
      if (b.type === 'CHARACTER' && b.imagePrompt?.trim()) {
        const name = b.content.trim();
        if (!charDesigns.has(name)) charDesigns.set(name, b.imagePrompt.trim());
      }
    }
  }
  const designSection = charDesigns.size
    ? `\nEstablished character designs (CANONICAL — when these characters appear in frame, reuse their identity EXACTLY: same age, hair, face, and clothing wording. Do NOT invent new appearances for them):\n---\n${[...charDesigns.entries()].map(([n, p]) => `[CHARACTER ${n}] established design:\n${p}`).join('\n\n')}\n---\n`
    : '';

  const targetNoun = isCharacter ? 'TARGET CHARACTER' : isEnvironment ? 'TARGET SCENE' : 'TARGET ACTION';
  const userPrompt = `Scene context (the marked ${targetNoun.toLowerCase()} is the one to turn into an image prompt):
---
${context}
---${designSection}
Generate the six-line image prompt for the ${targetNoun}. Remember: exactly six labeled lines, English, no technical terms, no markdown.${charDesigns.size && !isEnvironment ? ' Characters in frame MUST match the established designs above.' : ''}`;

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt });

  // Normalize: keep only the six labeled lines, trim each, drop any stray markdown.
  const allowed = ['Subject', 'Environment', 'Composition', 'Lighting', 'Material', 'Mood'];
  const lines = responseText
    .split('\n')
    .map(l => l.trim())
    .filter(l => allowed.some(a => l.toLowerCase().startsWith(a.toLowerCase() + ':')))
    .map(l => {
      const colonIdx = l.indexOf(':');
      const label = l.slice(0, colonIdx);
      const rest = l.slice(colonIdx + 1).trim();
      // Re-capitalize the canonical label for consistency.
      const canon = allowed.find(a => a.toLowerCase() === label.toLowerCase()) || label;
      return `${canon}: ${rest}`;
    });

  return lines.join('\n');
};

/**
 * Decide whether the CONTINUE flow should stay in the current scene or
 * transition to a new one. Runs as the first (judgment) step before the
 * continuation is actually written; the user confirms the decision in the UI.
 *
 * Returns a structured decision. On any parse/API failure it degrades to
 * `{ action: 'continue', reason: <fallback> }` so the user can still continue
 * the current scene — the judgment step never blocks writing.
 */
export const decideSceneTransition = async (
  blocks: ScriptBlock[],
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
): Promise<SceneTransitionDecision> => {
  const context = getScriptContext(blocks, settings.aiContextBlocks);
  const langInstruction = getLanguageInstruction(scriptLanguage);

  const systemPrompt = `${systemInstruction}\n${langInstruction}

You are a screenplay structure consultant. Your ONLY job is to judge whether the current scene has reached a natural point to transition to a new scene, or whether the story should continue in the same scene.

Transition is warranted when: the current beat is dramatically complete, key information has been delivered, the rhythm needs a shift, or time/location/emotional focus should change. Otherwise, continue in the current scene.

You do NOT write any screenplay content. You only output a JSON decision.

Respond with STRICT JSON and nothing else, in this exact shape:
- If a transition is warranted: {"action":"transition","reason":"one sentence on why this beat is done / what the new scene should establish","sceneHeading":"INT./EXT. LOCATION - TIME"}
- If continuing: {"action":"continue","reason":"one sentence on why the current scene still has more to give"}

The "reason" must follow the language instruction above. "sceneHeading" must be a valid scene heading string. Output ONLY the JSON object — no markdown, no commentary.`;

  const userPrompt = `Current screenplay context (the most recent blocks):
---
${context}
---

Judge whether the next continuation should stay in the current scene or transition to a new one. Output only the JSON decision.`;

  let raw = '';
  try {
    raw = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true);
  } catch (err: any) {
    // Network/key/API error: degrade gracefully so the user can still continue.
    return { action: 'continue', reason: (err?.message || 'Assessment unavailable — continuing in current scene.') };
  }

  try {
    // Tolerate surrounding markdown fences / stray text by extracting the first {...} block.
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const action = parsed.action === 'transition' ? 'transition' : 'continue';
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : (action === 'transition' ? 'Transition to a new scene.' : 'Continue in the current scene.');
    const decision: SceneTransitionDecision = { action, reason };
    if (action === 'transition' && typeof parsed.sceneHeading === 'string' && parsed.sceneHeading.trim()) {
      decision.sceneHeading = parsed.sceneHeading.trim();
    }
    return decision;
  } catch {
    // JSON parse failed: degrade, but surface the raw text as the reason so the
    // user sees something rather than an empty box.
    return { action: 'continue', reason: raw.trim().slice(0, 200) || 'Assessment unavailable — continuing in current scene.' };
  }
};

// ---------------------------------------------------------------------------
// Graybox (3D previs) generation
// ---------------------------------------------------------------------------

const VALID_OBJ_TYPES = ['box', 'plane', 'cylinder', 'sphere'] as const;
const VALID_OBJ_ROLES = ['wall', 'floor', 'ceiling', 'door', 'window', 'prop', 'furniture', 'environment'] as const;
const VALID_SHOT_TYPES = ['wide', 'medium', 'close-up', 'extreme-close-up', 'over-the-shoulder', 'top-down', 'pov'] as const;
const VALID_MOVE_TYPES = ['static', 'pan', 'tilt', 'dolly', 'tracking', 'orbit', 'crane', 'handheld'] as const;

/** Coerce an arbitrary value to a 3-tuple `[x, y, z]` of numbers, filling 0
 *  for missing/non-numeric entries. Returns a fresh array. */
const asVec3 = (v: any, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] => {
  const n = (x: any, i: number): number => {
    const num = typeof x === 'number' ? x : parseFloat(x);
    return Number.isFinite(num) ? num : fallback[i];
  };
  const arr = Array.isArray(v) ? v : [];
  return [n(arr[0], 0), n(arr[1], 1), n(arr[2], 2)];
};

const asVec2 = (v: any, fallback: [number, number] = [0, 0]): [number, number] => {
  const n = (x: any, i: number): number => {
    const num = typeof x === 'number' ? x : parseFloat(x);
    return Number.isFinite(num) ? num : fallback[i];
  };
  const arr = Array.isArray(v) ? v : [];
  return [n(arr[0], 0), n(arr[1], 1)];
};

const oneOf = <T extends string>(val: any, allowed: readonly T[], fallback: T): T =>
  (typeof val === 'string' && (allowed as readonly string[]).includes(val)) ? val as T : fallback;

/** Normalize a parsed AI object into a valid `GrayboxData`, coercing/clamping
 *  every field and dropping anything unrecognized. Never throws. The `kind`
 *  argument is authoritative — scene keeps layout/characters, shot keeps camera. */
const normalizeGraybox = (parsed: any, kind: 'scene' | 'shot'): GrayboxData => {
  const result: GrayboxData = { kind };

  if (kind === 'scene') {
    const layoutRaw = Array.isArray(parsed?.layout) ? parsed.layout : [];
    const layout: GrayboxObject[] = [];
    for (let i = 0; i < Math.min(layoutRaw.length, 60); i++) {
      const o = layoutRaw[i];
      if (!o || typeof o !== 'object') continue;
      const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `obj_${i}`;
      layout.push({
        id,
        type: oneOf(o.type, VALID_OBJ_TYPES, 'box'),
        role: oneOf(o.role, VALID_OBJ_ROLES, 'prop'),
        label: typeof o.label === 'string' ? o.label.slice(0, 40) : undefined,
        position: asVec3(o.position),
        size: asVec3(o.size, [1, 1, 1]),
        rotation: o.rotation ? asVec3(o.rotation) : undefined,
        color: typeof o.color === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(o.color)
          ? (o.color.startsWith('#') ? o.color : `#${o.color}`)
          : undefined,
      });
    }
    if (layout.length) result.layout = layout;

    const charsRaw = Array.isArray(parsed?.characters) ? parsed.characters : [];
    const characters: GrayboxCharacter[] = [];
    for (let i = 0; i < Math.min(charsRaw.length, 30); i++) {
      const c = charsRaw[i];
      if (!c || typeof c !== 'object') continue;
      const name = typeof c.name === 'string' ? c.name.trim().slice(0, 60) : '';
      if (!name) continue;
      const facingNum = typeof c.facing === 'number' ? c.facing : parseFloat(c.facing);
      characters.push({
        name,
        position: asVec2(c.position),
        facing: Number.isFinite(facingNum) ? facingNum : undefined,
        pose: typeof c.pose === 'string' ? c.pose.slice(0, 40) : undefined,
      });
    }
    if (characters.length) result.characters = characters;
  } else {
    // kind === 'shot'
    const cam = parsed?.camera;
    if (cam && typeof cam === 'object') {
      const movementRaw = cam.movement && typeof cam.movement === 'object' ? cam.movement : {};
      const pathRaw = Array.isArray(movementRaw.path) ? movementRaw.path : undefined;
      const path: [number, number, number][] | undefined = pathRaw
        ? pathRaw.slice(0, 20).map((p: any) => asVec3(p))
        : undefined;
      const dur = typeof movementRaw.duration === 'number'
        ? movementRaw.duration
        : parseFloat(movementRaw.duration);
      const lookPathRaw = Array.isArray(movementRaw.lookPath) ? movementRaw.lookPath : undefined;
      const lookPath: [number, number, number][] | undefined = lookPathRaw
        ? lookPathRaw.slice(0, 40).map((p: any) => asVec3(p))
        : undefined;
      const camera: GrayboxCamera = {
        shotType: oneOf(cam.shotType, VALID_SHOT_TYPES, 'medium'),
        position: asVec3(cam.position, [0, 1.6, 5]),
        lookAt: asVec3(cam.lookAt),
        movement: {
          type: oneOf(movementRaw.type, VALID_MOVE_TYPES, 'static'),
          duration: Number.isFinite(dur) && dur > 0 ? dur : 3,
          path: path && path.length ? path : undefined,
          lookPath: lookPath && lookPath.length ? lookPath : undefined,
        },
      };
      if (typeof cam.shotDescription === 'string' && cam.shotDescription.trim()) {
        camera.shotDescription = cam.shotDescription.trim().slice(0, 160);
      }
      if (typeof cam.focus === 'string' && cam.focus.trim()) {
        camera.focus = cam.focus.trim().slice(0, 60);
      }
      result.camera = camera;
    }
  }

  return result;
};

/**
 * Generate a 3D graybox (previs) payload for a block.
 *
 * - `kind='scene'` (target = SCENE_HEADING): a layout of primitive objects
 *   (walls/floor/props as boxes) plus character blocking — who stands where,
 *   facing which way. Origin at room center, floor at y=0.
 * - `kind='shot'` (target = ACTION or DIALOGUE): a single camera description —
 *   shot type, position, look-at, and a movement (运镜) path chosen to serve
 *   the beat.
 *
 * Uses `jsonMode=true` so the provider returns strict JSON. Mirrors
 * `decideSceneTransition`'s graceful-degrade pattern: on any API or parse
 * failure it returns a `GrayboxData` carrying an `error` string, so the modal
 * still shows something and the user can discard.
 */
export const generateGraybox = async (
  sceneBlocks: ScriptBlock[],
  targetBlockId: string,
  systemInstruction: string,
  settings: AppSettings,
  kind: 'scene' | 'shot',
  /** Shot-only context that lets the cinematographer stay consistent across a
   *  scene: the scene's own graybox layout (so camera coords land on real
   *  objects) and the shots already generated earlier in this scene (so the
   *  rhythm can vary instead of repeating the same move/size). Both optional;
   *  scene-kind calls ignore them. */
  shotContext?: { sceneLayout?: GrayboxData | null; priorShots?: GrayboxData[] },
): Promise<GrayboxData> => {
  // Graybox JSON is language-neutral (numbers + ids); labels may carry the
  // script's language verbatim. Keep it compact and deterministic.
  const langInstruction = 'Label objects/characters using the names that appear in the script. Keep all JSON keys in English.';

  // Render scene context, marking the target block — same style as
  // generateImagePrompt so the AI sees the full beat in context.
  const targetTag = kind === 'scene' ? ' [TARGET SCENE TO BLOCK]' : ' [TARGET BEAT TO SHOT]';
  const context = sceneBlocks.map(b => {
    const isTarget = b.id === targetBlockId;
    const tag = isTarget ? targetTag : '';
    return `${b.type}:${tag} ${b.content}`;
  }).join('\n');

  let systemPrompt: string;
  let userPrompt: string;

  if (kind === 'scene') {
    systemPrompt = `You are a Previs / Layout Designer for film and animation.
Your job: read a screenplay scene heading and its beats, then design a simple gray-box (3D blocking) of TWO things at once — the SPACE (primitive geometry) AND the CHARACTER BLOCKING (where each named character stands, faces, and what pose they hold). Both halves are mandatory and carry equal weight. A previs layout with a detailed room/terrain but an empty "characters" array is a FAILED deliverable — the blocking markers are what later camera lookAts anchor to, so place them deliberately. If the scene has any speaking or acting character (read the CHARACTER cues and the ACTION/DIALOGUE beats), the "characters" array MUST be populated; only a pure landscape/establishing scene with no people may leave it empty.

${systemInstruction}

${langInstruction}

Coordinates: meters. Origin = the scene's natural center (room center for an interior, the action's ground zero for an exterior). Floor/ground at y=0 (y is up).

Read the scene heading to judge the SPACE before you build it. An interior (INT./内.) is an enclosed room — origin at room center, walls and a floor bound it. An exterior (EXT./外.) is open — origin can be the action's ground zero, the ground is a large plane, and there are no enclosing walls unless the scene names them (a courtyard wall, a gate, a cliff edge). For exteriors, use the "environment" role for terrain and natural features — a ground plane, hills, trees, rocks, water, distant mountains — and give each its own color so the gray-box reads as that place (mountain green, water blue, rock gray, grass, sand…). Let the scale match what the scene actually is: a street corner, a palace square, a battlefield can span tens of meters, not a room-sized box.

Keep it SIMPLE: a handful of primitive boxes/planes, not a dressed set. For interiors, walls are thin boxes and the floor is a plane. For exteriors, the ground is a plane and terrain/features are boxes/spheres/cylinders with the "environment" role.

How to block the characters — think like a director staging a scene, not like a checker placing tokens. Read the CHARACTER blocks in the context: every name that appears as a CHARACTER cue, or is clearly acting/speaking in an ACTION or DIALOGUE beat, gets a blocking marker. When the script does not state an exact spot, INFER a reasonable one from the relationships and staging below — an inferred position is always more useful than no entry. The only reason to leave characters empty is a scene with genuinely no acting characters (a pure landscape / establishing shot).
- Proximity carries meaning. Characters who agree or are intimate stand close; characters in conflict are separated across the space; a power shift can be shown by one character invading another's space. Let where they stand reflect their relationship this scene, not a generic semi-circle.
- Levels carry power. A seated/lying character is often vulnerable; a standing character looking down on them dominates. Use pose + position together to encode who has the upper hand. If the scene says someone is seated/throned (e.g. "掌门端坐主位"), set pose accordingly and place them at the seat.
- Facing carries allegiance. Use "facing" so eye-lines between characters read correctly — two speakers in dialogue generally face each other; a character addressing a group faces them; a character turning away signals withdrawal. The eye-lines you set here become the scene's 180-degree line that later shots should respect. When unsure of an exact angle, still give a sensible facing from the staging (e.g. two speakers face each other → facing values roughly opposite) rather than omitting it.
- Stage for the lens when you can. If a beat foregrounds a thematic object (a sword, a seal, a jade tablet), place it where a camera can hold it and the characters together in one frame. If several characters act at once, stagger them across foreground / midground / background depth so a single wide shot can read all of them.
- Do not invent characters the scene never names or implies; but among the names that DO appear, place all of them — do not drop a named character just because the script did not spell out coordinates.

Output STRICT JSON and nothing else, in this exact shape:
{
  "kind": "scene",
  "layout": [
    {
      "id": "string (stable id, e.g. \"floor\", \"wall_north\", \"bed\")",
      "type": "box" | "plane" | "cylinder" | "sphere",
      "role": "wall" | "floor" | "ceiling" | "door" | "window" | "prop" | "furniture" | "environment",
      "label": "optional short human label, e.g. \"玉床\"",
      "position": [x, y, z],
      "size": [w, h, d],
      "rotation": [rx, ry, rz],
      "color": "#rrggbb"
    }
  ],
  "characters": [
    {
      "name": "character name exactly as in the script (from a CHARACTER cue or clearly acting in a beat)",
      "position": [x, z],
      "facing": radians_about_Y,
      "pose": "sitting" | "standing" | "lying" | "kneeling" | ...
    }
  ]
}

Rules:
- layout: include a ground plane. Add enclosing walls only for interiors or where the scene names a boundary. Include only the most important props/furniture/terrain features (<=12 objects). Outdoors, prefer a few large environment-role shapes over many small ones. Within layout entries, you may omit rotation/color when they add nothing.
- era intent: derive the era the heading and beats ACTUALLY depict and furnish accordingly — a period hall gets 长案/坐席; but if the script deliberately mixes eras (穿越: a smartphone on an ancient desk), place BOTH faithfully — the juxtaposition is the design. Avoid only unintended drift (objects nobody wrote). Prefer the script's own object names for labels.
- characters: REQUIRED whenever the scene has any speaking/acting character — output the "characters" array with one entry per distinct named character who appears (via a CHARACTER cue, or clearly acting/speaking in a beat). <=8 entries. Position each on the x/z ground plane, with facing + pose that reflect their relationship and power this scene. Infer reasonable positions/facings from the script's staging cues (who faces whom, who is seated, who confronts whom) — inference is expected and welcome; omitting the whole array is only correct for a scene with no acting characters at all (a pure landscape/establishing shot). An empty "characters": [] is NOT acceptable for a scene with dialogue or action involving named characters.
- Do NOT include markdown, commentary, or any text outside the JSON.`;

    userPrompt = `Scene to block out (the marked scene heading is the target; the beats that follow it are this scene's content — the characters who appear there are the ones to block):
---
${context}
---

Output only the scene graybox JSON.`;
  } else {
    systemPrompt = `You are a Cinematographer / Camera Operator designing a gray-box shot for previs.
Your job: read a single screenplay beat (an ACTION or a DIALOGUE line, with its scene context) and choose ONE camera description that serves that beat — shot type, camera position, what it looks at, and a movement (运镜) if any.

${systemInstruction}

${langInstruction}

Coordinates: meters. Origin = the scene's natural center (room center for an interior, the action's ground zero for an exterior). Floor/ground at y=0 (y is up). Eye level ~1.6m for a standing adult.

How to think about it — be a real cinematographer, not a template-filler:
- Read the VERB and the EMOTION in the beat first. The movement type is just a tool to express them; pick the one that fits, not the first that comes to mind. A dolly push-in is one option among many, not a default.
- Decide movement from the SUBJECT first, not the mood. Ask: is the subject physically moving this beat? A still subject — someone speaking, thinking, reacting, sitting, standing, looking — usually does NOT need the camera body to travel. For a still subject, let the shot breathe through shot size, angle, composition, or a fixed pan/tilt of the lens (lookPath) rather than a body push-in (path). Reserve dolly / tracking / crane for beats where something or someone actually moves through space, or where a genuine emotional crescendo demands closing distance. This nudges you away from reflex push-ins on static beats; it is not a ban — a still beat may still earn a slow push-in when the emotion truly escalates.

Shot size is emotional distance, not just framing. Pick the size by what the beat asks the audience to FEEL:
- wide / extreme-wide — the subject is small inside a larger space. Leans toward establishing geography, isolation, awe, being overwhelmed by place. The beat that first shows a space, or makes a character look lost/small, leans here.
- medium — waist up, the most versatile. Dialogue where geography still matters, two-handers, interaction with the immediate environment.
- close-up — the face fills the frame. Reserved for moments that deserve full attention: a reaction, a decision surfacing, a key line landing. Not a default for every dialogue beat.
- extreme-close-up — a detail (eyes, mouth, a hand on a hilt). Microscopic intensity or transformation; use sparingly for the beat that isolates one telling detail.
- over-the-shoulder — puts the viewer beside one character looking at another. Dialogue where you want orientation (who faces whom) and a sliver of the listener's reaction.
- top-down — overhead. Scale, pattern, or a literal "looking down on" power read; also a clean way to show a layout/formation the ground hides.
- pov — we see what a character sees. Subjective beats: looking at something revealed, watching a threat, a character's point of view on the world.
This is a map of what each size expresses, not a quota — choose from the full range, and let a beat that establishes or surveys space lean wider while an intimate or shocking beat leans closer.

- Two independent curves define a move, and they carry different meaning:
  - "path"  → where the camera BODY travels in world space (position over time). A pan or tilt keeps the body still — so for pan/tilt, path is a single held point (or omitted); the motion lives entirely in lookPath.
  - "lookPath" → where the LENS points over time (the lookAt target over time). This is BOTH how a pan/tilt/"looking around" is expressed AND the composition anchor that tells the renderer where the subject sits in frame. Think of lookAt/lookPath as "what the lens is aimed at", not just "a motion curve": even when the lens holds a fixed subject, an explicit lookPath (even a single repeated point) locks the frame's aim so the shot reads correctly. Omit lookPath only when you are certain the renderer's default forward aim already points at the subject; when in doubt, give the aim. A pan/tilt/handheld-wander sets a multi-point lookPath; a locked-off static shot still benefits from a single-point lookPath to nail the composition.
  - A handheld feel usually pairs body jitter with a wandering lookPath — but judge this per beat, don't apply it mechanically.
- Respect the scene's 180-degree line. When you are given the scene's character blocking, the eye-lines between speaking characters define an axis; keeping the camera on one side of it across consecutive shots keeps their left/right relationship stable and the cuts clean. Lean toward staying on that side for coverage of a dialogue scene. Crossing the line reverses screen direction and disorients the viewer — do it only when the beat genuinely calls for it (chaos, a fractured relationship, a sharp emotional or tonal turn), never by accident. This is a nudge toward spatial clarity, not a ban — deliberate, motivated line-crossings are a real tool.
- Vary the language across a scene. If several beats in a row would land on the same move or the same shot type, step back and ask whether each one truly needs that — repetition flattens rhythm. This is a nudge to stay deliberate, not a ban on repeating when a beat genuinely calls for it.
- Let the SPACE scale the move, not just the beat. An exterior (EXT./外.) often has room to breathe — a wide establishing beat, a crane rising over terrain, a tracking shot covering real ground — where an interior may only fit a push-in or a pan. When the scene is open and the beat establishes or surveys that space, lean toward larger moves and wider sizes; when the scene is tight (interior, close dialogue), the same beat may call for a held frame. This is a nudge from the space itself, not a rule — a quiet exterior close-up is sometimes exactly right.
- When you are given the shots already designed earlier in this scene, treat them as the scene's rhythm so far. Your job is to add the NEXT beat — not in isolation, but as part of that rhythm. Before defaulting to the same move or shot size the preceding beats used, ask what THIS beat's own subject and emotion demand: often the honest answer is a different axis — a static hold after a string of moves, a wider frame if space hasn't been established, a pan between speakers instead of another push-in. Repetition is allowed when a beat genuinely calls for it; the nudge is to reach for the beat's own choice first.
- Let the scene breathe across sizes. If several beats have clustered at one shot size, the next beat leans toward a different scale — especially consider a wide when a space or blocking has not yet been shown, and a closer frame when the emotion intensifies. This is directional, not a quota.

Output STRICT JSON and nothing else, in this exact shape:
{
  "kind": "shot",
  "camera": {
    "shotType": "wide" | "medium" | "close-up" | "extreme-close-up" | "over-the-shoulder" | "top-down" | "pov",
    "shotDescription": "one short sentence on WHY this shot serves the beat — the director's intent (e.g. 'Crane up to reveal the seal cracking as the elders reel')",
    "position": [x, y, z],
    "lookAt": [x, y, z],
    "movement": {
      "type": "static" | "pan" | "tilt" | "dolly" | "tracking" | "orbit" | "crane" | "handheld",
      "duration": seconds,
      "path": [[x,y,z], ...],
      "lookPath": [[x,y,z], ...]
    },
    "focus": "character name or object id the shot emphasizes"
  }
}

Rules:
- movement.duration in seconds (1-20).
- shotDescription: always one concise sentence capturing the shot's intent — why this size/move/aim serves this beat. Keep it practical, not poetic.
- path: body waypoints. static → [position]; pan/tilt → a single held point or omit; dolly/tracking/orbit/crane → the polyline.
- lookPath: lens-aim waypoints — the composition anchor, not just a motion curve. Set it whenever the lens sweeps (pan/tilt/looking around) OR to lock the aim onto a fixed subject; omit only when you are sure the default forward aim already points at the subject. When in doubt, give the aim.
- Omit path only if the body truly doesn't travel. Do NOT include markdown, commentary, or any text outside the JSON.`;

    userPrompt = `Beat to shot (the marked beat is the target):
---
${context}
---

Output only the shot graybox JSON.`;
  }

  // --- Shot context injection (scene layout + prior shots in this scene) ---
  // Directional, not prescriptive: we hand the cinematographer the space they're
  // shooting in and the shots already laid down, so camera coords line up with
  // real objects and the scene's rhythm can breathe. We never forbid repetition;
  // we only surface the information a real DP would have on set.
  if (kind === 'shot' && shotContext) {
    const parts: string[] = [];
    if (shotContext.sceneLayout && !shotContext.sceneLayout.error && shotContext.sceneLayout.layout) {
      const layout = shotContext.sceneLayout.layout;
      const objLines = layout.map(o => {
        const p = o.position ? ` @(${o.position.map((n:number)=>Number(n).toFixed(1)).join(',')})` : '';
        const lbl = o.label ? ` "${o.label}"` : '';
        return `  - ${o.role}${lbl}${p}`;
      }).join('\n');
      parts.push(`This scene's gray-box layout (coordinates are in meters, y up, origin at the scene's natural center). Place your camera/lookAt against THESE coordinates so the lens points at real objects:\n${objLines}`);
      const chars = shotContext.sceneLayout.characters;
      if (chars && chars.length) {
        parts.push(`Characters blocked in this scene (position [x,z], facing in radians about Y — eye-lines between speaking characters define the scene's 180-degree line; keep your camera on one side of it for clean coverage, cross it only when the beat motivates it):\n${chars.map(c => {
          const pos = (c.position||[]).map((n:number)=>Number(n).toFixed(1)).join(',');
          const fac = c.facing != null ? Number(c.facing).toFixed(2) : '?';
          const pose = c.pose ? ` · ${c.pose}` : '';
          return `  - ${c.name} @(${pos}) facing ${fac}rad${pose}`;
        }).join('\n')}`);
      }
    }
    const prior = (shotContext.priorShots || []).filter(s => s && !s.error && s.camera);
    if (prior.length) {
      const priorLines = prior.map((s, i) => {
        const c = s.camera!;
        const m = c.movement;
        const move = m ? `${m.type}${m.duration ? ` ${m.duration}s` : ''}` : 'none';
        return `  ${i + 1}. ${c.shotType} · move: ${move} · focus: ${c.focus || '—'}`;
      }).join('\n');
      parts.push(`Shots already designed for the beats before this one in the same scene:\n${priorLines}\nYou are designing the NEXT beat. Before reaching for the same move or shot size the list above leans on, ask what THIS beat's own subject and emotion demand. If the subject is still (speaking, thinking, reacting), a body push-in is rarely the honest choice — prefer holding the frame, switching size/angle, or sweeping the lens (pan/tilt) between subjects. If several preceding beats share one move or one size, this beat is where the rhythm wants a different axis. Repetition is fine when a beat genuinely needs it; the nudge is to let the beat's own subject lead, not the rhythm's inertia.`);
    }
    if (parts.length) {
      userPrompt = `${userPrompt}\n\n--- SCENE CONTEXT (for consistency) ---\n${parts.join('\n\n')}`;
    }
  }

  let raw = '';
  try {
    raw = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true);
  } catch (err: any) {
    return { kind, error: `Generation failed: ${err?.message || 'unknown error'}` };
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : JSON.parse(raw);
    return normalizeGraybox(parsed, kind);
  } catch {
    return { kind, error: `Could not parse AI output: ${raw.trim().slice(0, 200) || 'empty response'}` };
  }
};