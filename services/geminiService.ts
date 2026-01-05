import { GoogleGenAI } from "@google/genai";
import { ScriptBlock, ScriptLanguage, AppSettings } from "../types";

// Helper to get plain text context from blocks
const getScriptContext = (blocks: ScriptBlock[], count = 20): string => {
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
  settings: AppSettings
): Promise<string> => {
  const context = getScriptContext(blocks, 150); 
  const langInstruction = getLanguageInstruction(scriptLanguage);
  
  const systemPrompt = `${systemInstruction}\n${langInstruction}`;
  
  const userPrompt = `
  Analyze the provided screenplay excerpt.
  
  Screenplay Context:
  ---
  ${context}
  ---
  
  Task: Write the immediate continuation of this script (next 3-5 blocks).
  
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
     
     Do not use markdown (no **bold**). Do not provide explanations. Just the labeled script blocks.`;

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt });
};

export const rewriteBlock = async (
  text: string, 
  tone: string, 
  systemInstruction: string, 
  scriptLanguage: ScriptLanguage,
  settings: AppSettings
): Promise<string> => {
  const langInstruction = getLanguageInstruction(scriptLanguage);
  
  const systemPrompt = `${systemInstruction}\n${langInstruction}`;
  
  const userPrompt = `
  Task: Rewrite the following screenplay action or dialogue line to be more "${tone}".
  Maintain the original meaning but enhance the style according to your expertise.
  
  Original Text: "${text}"
  
  Return only the rewritten text, no quotes or markdown. Do not include [TYPE] labels.`;

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt });
};

export const suggestIdeas = async (
  blocks: ScriptBlock[], 
  systemInstruction: string, 
  scriptLanguage: ScriptLanguage,
  settings: AppSettings
): Promise<string[]> => {
  const context = getScriptContext(blocks, 100); 
  const langInstruction = getLanguageInstruction(scriptLanguage);

  const systemPrompt = `${systemInstruction}\n${langInstruction}`;
  
  const userPrompt = `
  Act as a master consultant for this specific format. Based on the following segment, suggest 3 creative directions or plot twists.
  
  Screenplay Context:
  ---
  ${context}
  ---
  
  Suggestions should be:
  - Concise (1-2 sentences each).
  - Genre-appropriate.
  - Distinct from each other.
  - Returned as a simple bulleted list (start lines with - or *).`;

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt });
  
  return responseText.split('\n')
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
    .map(l => l.replace(/^[-*]\s+/, ''));
}