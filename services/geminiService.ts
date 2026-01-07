import { GoogleGenAI } from "@google/genai";
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
    if (!settings.deepseekApiKey) throw new Error("DeepSeek API Key is missing. Please configure it in Settings.");
    
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.deepseekApiKey}`
        },
        body: JSON.stringify({
          model: settings.deepseekModel || 'deepseek-chat',
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
    if (!key) throw new Error("Gemini API Key is missing. Please set it in Settings or environment variables.");
    
    const ai = new GoogleGenAI({ apiKey: key });
    
    // Combine system and user prompt for Gemini's simple interface or use config
    const combinedPrompt = `${messages.system}\n\n${messages.user}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: combinedPrompt,
        config: {
          temperature: 0.9,
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