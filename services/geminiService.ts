import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ScriptBlock, ScriptLanguage, AppSettings } from "../types";

// Helper to get plain text context from blocks
const getScriptContext = (blocks: ScriptBlock[], count: number): string => {
  return blocks.slice(-count).map(b => {
    let prefix = '';
    if (b.type === 'SCENE_HEADING') prefix = '\n';
    if (b.type === 'CHARACTER') prefix = '\n';
    return `${prefix}${b.type}: ${b.content}`;
  }).join('\n');
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
  messages: { system: string, user: string }
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
          stream: false
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
  templateId?: string
): Promise<string> => {
  const context = getScriptContext(blocks, settings.aiContextBlocks);
  const langInstruction = getLanguageInstruction(scriptLanguage);

  const systemPrompt = `${systemInstruction}\n${langInstruction}`;

  // Special handling for lyrics template
  const isLyrics = templateId === 'lyrics';
  const songInfoContext = isLyrics ? extractSongInfo(blocks) : '';

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
  kind: 'action' | 'character' = 'action',
): Promise<string> => {
  // Image prompts are always English, independent of scriptLanguage.
  const langInstruction = 'Respond in English only.';

  const isCharacter = kind === 'character';

  const roleLine = isCharacter
    ? 'Your job: turn a screenplay CHARACTER into a single character-design image prompt.'
    : 'Your job: turn a screenplay ACTION into a single, vivid, camera-ready image prompt.';

  const subjectGuidance = isCharacter
    ? '1. Subject — the character: name/role, age, ethnicity, body type, hair (style/color/length), face features, expression. A full head-to-toe appearance description.'
    : '1. Subject — who/what is in frame (characters, key objects), with pose, expression, motion.';

  const envGuidance = isCharacter
    ? '2. Environment — a neutral or simple backdrop suitable for a character design sheet (e.g. plain studio background). Keep it minimal so the character stands out.'
    : '2. Environment — location, time of day, weather, background detail.';

  const compGuidance = isCharacter
    ? '3. Composition — full-body standing pose, centered, character turnaround reference (front view preferred).'
    : '3. Composition — shot type (wide/medium/close), camera angle, framing, focus, depth of field.';

  const matGuidance = isCharacter
    ? '5. Material — clothing fabric, accessories, armor/prop materials, surface textures of garments.'
    : '5. Material — textures, fabrics, surfaces, finishes that sell realism or style.';

  const targetTag = isCharacter ? ' [TARGET CHARACTER TO DESIGN]' : ' [TARGET ACTION TO ILLUSTRATE]';

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
- Translate any non-English source content into English for the prompt.`;

  // Render the scene context, highlighting the target block.
  const context = sceneBlocks.map(b => {
    const isTarget = b.id === targetBlockId;
    const tag = isTarget ? targetTag : '';
    return `${b.type}:${tag} ${b.content}`;
  }).join('\n');

  const targetNoun = isCharacter ? 'TARGET CHARACTER' : 'TARGET ACTION';
  const userPrompt = `Scene context (the marked ${targetNoun.toLowerCase()} is the one to turn into an image prompt):
---
${context}
---

Generate the six-line image prompt for the ${targetNoun}. Remember: exactly six labeled lines, English, no technical terms, no markdown.`;

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