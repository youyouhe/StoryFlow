import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logAiCall, classifyError } from "./aiLog";
import { buildSequenceContext } from '../utils/sequence';
import { BlockType, ScriptBlock, ScriptLanguage, AppSettings, SceneTransitionDecision, GrayboxData, GrayboxObject, GrayboxCharacter, GrayboxCamera, StyleHead, DubEmotion, CharacterWardrobe, ScriptSequence } from "../types";

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

// Generic AI Call Handler — every call is timed and logged (services/aiLog).
// DeepSeek gets a hard timeout (180s) plus one automatic retry on
// timeout/network/5xx — the continuation API is intermittently slow.
const callAIProvider = async (
  settings: AppSettings,
  messages: { system: string, user: string },
  jsonMode = false,
  op = 'unknown',
): Promise<string> => {
  const started = performance.now();
  const promptChars = messages.system.length + messages.user.length;
  const finish = (model: string, outcome: 'ok' | 'error' | 'timeout', text: string,
                  extra: { errorType?: string; error?: string; attempt?: number } = {}) => {
    logAiCall({
      ts: Date.now(), durationMs: Math.round(performance.now() - started),
      op, provider: settings.provider, model, outcome,
      promptChars, responseChars: outcome === 'ok' ? text.length : undefined,
      ...extra,
    });
    return text;
  };

  // 1. DeepSeek Provider
  if (settings.provider === 'deepseek') {
    if (!settings.deepseekApiKey) throw new Error("DEEPSEEK_KEY_MISSING");
    const model = settings.deepseekModel || 'deepseek-v4-flash';

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.deepseekApiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: messages.system },
              { role: "user", content: messages.user }
            ],
            stream: false,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
          }),
          signal: AbortSignal.timeout(180_000),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          const message = err.error?.message || `DeepSeek API Error: ${response.statusText}`;
          if (response.status >= 500 && attempt === 1) {
            lastErr = new Error(message);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          // Log the attempt, then THROW: silent empty-string returns made hard
          // failures (余额不足, invalid key, content policy) indistinguishable
          // from success downstream — the UI showed a generic retry message
          // while the real reason sat in a local log.
          finish(model, 'error', '', { errorType: `http:${response.status}`, error: message, attempt });
          throw new Error(message);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return finish(model, 'ok', text, { attempt });
      } catch (e) {
        const { errorType, message } = classifyError(e);
        const transient = errorType === 'timeout' || errorType === 'network';
        if (attempt === 1 && transient) {
          lastErr = e;
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        console.error("DeepSeek API Error:", e);
        finish(model, errorType === 'timeout' ? 'timeout' : 'error', '',
          { errorType, error: message, attempt });
        throw new Error(message);
      }
    }
    const { errorType, message } = classifyError(lastErr);
    finish(model, 'error', '', { errorType, error: message, attempt: 2 });
    throw new Error(message);
  }

  // 2. Google Gemini Provider (Default)
  const key = settings.geminiApiKey || process.env.API_KEY;
  if (!key) throw new Error("GEMINI_KEY_MISSING");
  const model = settings.geminiModel || 'gemini-3.7-flash';
  const ai = new GoogleGenAI({ apiKey: key });

  const combinedPrompt = `${messages.system}\n\n${messages.user}`;

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
      model,
      contents: combinedPrompt,
      config: {
        temperature: 0.9,
        thinkingConfig,
        ...(jsonMode ? { responseMimeType: 'application/json' as const } : {}),
      }
    });
    return finish(model, 'ok', response.text || '');
  } catch (error) {
    const { errorType, message } = classifyError(error);
    console.error("Gemini Generate Error:", error);
    finish(model, 'error', '', { errorType, error: message });
    // Same contract as the DeepSeek branch: hard failures THROW the real
    // message so the UI shows 余额不足/invalid key instead of a generic retry.
    throw new Error(message);
  }
};


/**
 * FROM_PROMPT — derive a screenplay from a finished PRODUCTION prompt.
 *
 * The user pastes a complete AI-video / directorial prompt (scene + camera
 * rules, costume list, timeline with verbatim dialogue, subtitle UI, audio,
 * negative list). The LLM's job is NOT to write a new story — it is to
 * TRANSCRIBE that prompt into the standard labeled block format the app
 * parses, so the whole downstream pipeline (variant sheets, Sequence
 * wardrobe, storyboard frames) applies to an already-authored video idea.
 *
 * Encoding rules taught here (these make the pipeline light up):
 *  - One [SCENE] per location/time; a fixed-camera single-location video is
 *    ONE scene.
 *  - The timeline becomes ordered beats: staging/movement → [ACTION], spoken
 *    lines → [CHARACTER] + [DIALOGUE] with the dialogue VERBATIM.
 *  - A costume change is encoded as a re-cue with the costume in parentheses
 *    (`女主（学院风）`) — the base name stays identical. This is exactly the
 *    variant convention the storyboard pipeline resolves.
 *  - Off-screen voices are cued as their own character (`男声（画外）`) so
 *    dialogue attribution survives.
 *  - Never invent characters, lines, or scenes that the prompt does not
 *    contain; never merge or drop timeline beats.
 */
export const screenplayFromPrompt = async (
  source: string,
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
): Promise<string> => {
  const langInstruction = getLanguageInstruction(scriptLanguage);
  const systemPrompt = `${systemInstruction}
You are also a Screenplay Transcriber: you convert finished production prompts (AI-video prompts, directorial briefs) into standard screenplay format.
${langInstruction}`;

  const userPrompt = `Convert the production prompt below into a screenplay.

The input may take ANY shape — adapt to what you receive:
  - a formal production brief (scene + camera + costumes + timeline + NEGATIVE), OR
  - an informal description, a voice-memo brain dump, a few fragmentary sentences, OR
  - dialogue-only, action-only, a treatment outline, or any mix, in any language.
It may lack a timeline, lack costume info, lack character names, or refer to the
same person inconsistently (她 / 女孩 / 女主). Handle all of it:
  - No timeline → still output beats, in narrative order, without timestamps.
  - No costume info → plain NAME cues everywhere; never invent a costume.
  - Same person referred to inconsistently → normalize to ONE base name (the most
    specific proper name used); do this silently, never comment on it.
  - Dialogue embedded inside narration (她说："……") → split into [CHARACTER] + [DIALOGUE].
  - Multiple locations/times → multiple [SCENE] blocks, in narrative order.
  - Very short input → a valid minimal script (one scene, one or two beats).
  - Long input with repetition → one block-group per distinct story step; dedupe.
Never refuse, never ask questions, never output an empty script. Whatever the
input quality, you always produce a valid labeled-block screenplay.

The prompt is a finished creative work — your job is faithful transcription into block format, not rewriting. Preserve its story, dialogue, order, and staging exactly. Where the input is vague, stay vague — do not invent detail to fill gaps.

Rules:
1. One [SCENE] per location/time — only if the input actually has them. A fixed-camera single-location video is exactly ONE [SCENE]. If the input never states a location/time, derive the most plausible one from context.
2. Walk the story in order (follow the timeline if the input has one; otherwise the narrative flow). Each beat becomes blocks in this labeled format:
     [SCENE] INT./EXT. LOCATION - TIME
     [ACTION] staging, movement, entrances/exits
     [CHARACTER] NAME — or NAME（COSTUME）when that character is wearing a named costume
     [DIALOGUE] the spoken line, VERBATIM from the prompt
     [PARENTHETICAL] (delivery/voice direction, when the prompt gives one)
3. STORY ONLY — the single most important rule. Production prompts contain large non-story sections that exist to constrain the video model, NOT to appear on screen as story beats. Do NOT transcribe them as blocks — not even once, not condensed, not as a summary:
     - visual-style / 画面风格 sections (超真实、电影级、录屏质感…)
     - camera rules (固定机位、一镜到底、不切镜不推拉摇移变焦…)
     - reference-image layout instructions (左右分屏、参考图区域、左侧用于锁定场景…)
     - character-consistency rules (不换脸、不改变年龄/发型/身份…)
     - subtitle/字幕 UI rules and rendering notes (字幕位置、字体、颜色、扬声器图标、音频波形…)
     - audio engineering rules (音效、脚步声、口型同步、不要背景音乐…)
     - global acting style sections (表演风格、自然克制…)
     - 画面一致性 sections, NEGATIVE lists
   What survives into the script is ONLY what a viewer sees as story: who is present, what they do, what they say.
   Exception: a delivery note that belongs to ONE specific spoken line goes in that line's [PARENTHETICAL] (e.g. （语气俏皮，带展示感）).
4. NEVER write subtitle/waveform rendering notes (字幕逐字显示…、波形随声音跳动…) — not once, and not after every line. Subtitle behavior is a video-model rule, already excluded by rule 3.
5. Costume changes: when the input changes a character's outfit, re-cue them as NAME（SHORT COSTUME LABEL）at the beat where they re-enter. Derive ONE short label per outfit from its most distinctive feature (e.g. 女主（学院风JK）), and reuse THE SAME label every time that outfit is worn. The base name stays IDENTICAL. At the beat where the outfit FIRST appears, write the FULL outfit description into that beat's [ACTION] (e.g. 已换成第一套学院风服装：蓝黑格纹百褶短裙、白色过膝袜…); afterwards use only the short label.
6. Off-screen / voice-over lines: cue the voice as its own character with （画外） — e.g. [CHARACTER] 男声（画外） — then [DIALOGUE] with the line verbatim.
7. Dialogue must be transcribed VERBATIM. Do not paraphrase, translate, add, or drop lines.
8. Do NOT invent characters, lines, scenes, or camera moves the input does not contain. Exactly ONE block-group per story beat — never split one beat into overlapping blocks, never describe the same beat twice.
9. If the input has timestamps, keep each beat's time range at the START of its [ACTION] (e.g. "00:10-00:14。她…"), so shot durations survive.
10. Output ONLY labeled blocks — no markdown, no explanations, no section headings of your own.

Production prompt:
---
${source.trim()}
---`;

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt }, false, 'from-prompt');
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
     Costume variants: when a character's OUTFIT changes from earlier (bathrobe after a shower, armor after a battle, plain clothes at home), re-cue the character with the costume in parentheses BEFORE their next beat — e.g. [CHARACTER] 张三（浴袍） — and keep using that cue until they change again. Keep the base name IDENTICAL; only the parenthetical differs. Never invent a new character name for the same person. This is how the storyboard pipeline knows which outfit to draw.
  ${directiveInstruction}
  `;

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt }, false, 'continue');
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

  return callAIProvider(settings, { system: systemPrompt, user: userPrompt }, false, 'rewrite');
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

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, false, 'ideas');

  return responseText.split('\n')
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
    .map(l => l.replace(/^[-*]\s+/, ''));
}

/**
 * Generate candidate "style heads" for a screenplay: a few distinct visual
 * DNA presets (art style + world/scene + a ready-to-use English prompt
 * prefix). The user picks ONE at script start; it is then locked into the
 * script so all downstream text-to-image prompts share the same look.
 *
 * Returns 3 candidates. Response is JSON — parsed leniently (fences,
 * preamble chatter tolerated).
 */
export const generateStyleHeads = async (
  blocks: ScriptBlock[],
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
  templateId?: string,
): Promise<StyleHead[]> => {
  const context = getScriptContext(blocks, Math.max(30, Math.floor(settings.aiContextBlocks * 0.5)));
  const langInstruction = getLanguageInstruction(scriptLanguage);
  const persona = systemInstruction ? `\nThe script's persona for tone-matching:\n${systemInstruction}` : '';
  const genreHint = templateId ? `The script uses the "${templateId}" template/genre.` : '';

  const systemPrompt = `You are a Production Designer and Visual Development lead for film/animation.
You invent DISTINCT visual directions for a screenplay so the team can lock one look before storyboarding begins.
${langInstruction}${persona}`;

  const userPrompt = `Invent 3 visually DISTINCT style heads for this screenplay. Each is a complete look: medium/art style, era + world flavor, lighting and palette personality.
${genreHint}

Screenplay context:
---
${context || '(script is still empty — infer from the title/genre and be creative)'}
---

Requirements:
- The 3 candidates must feel like different productions (e.g. live-action realism vs. painterly animation vs. retro grain), not minor variations.
- "name": short, evocative, in the script's language (${scriptLanguage}).
- "artStyle": the 画风 — medium, rendering, palette (in the script's language).
- "scenePreset": the 场景/世界 — era, location flavor, atmosphere (in the script's language).
- "promptPrefix": ENGLISH ONLY. A dense single-line prompt prefix (~30-60 words) that can be prepended to ANY text-to-image prompt to reproduce this look: medium, style, era, lighting, palette, texture. No aspect-ratio or quality-booster terms.

Return ONLY a JSON array (no markdown fences, no commentary):
[{"name":"...","artStyle":"...","scenePreset":"...","promptPrefix":"..."}, ...] exactly 3 items.`;

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true, 'style-heads');

  // Lenient JSON extraction: strip fences, take the outermost array.
  const cleaned = responseText.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('STYLE_HEAD_PARSE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('STYLE_HEAD_PARSE');
  }
  if (!Array.isArray(parsed)) throw new Error('STYLE_HEAD_PARSE');
  const heads = parsed
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map(h => ({
      name: String(h.name ?? '').trim(),
      artStyle: String(h.artStyle ?? '').trim(),
      scenePreset: String(h.scenePreset ?? '').trim(),
      promptPrefix: String(h.promptPrefix ?? '').trim()
    }))
    .filter(h => h.promptPrefix);
  if (!heads.length) throw new Error('STYLE_HEAD_PARSE');
  return heads;
};

export interface OpeningCandidate {
  logline: string;
  blocks: Array<{ type: BlockType; content: string }>;
}

/** Classify [TYPE]-tagged lines into screenplay blocks — same classification
 *  rules as the WebMCP import parser (tags, INT./EXT. heuristics, fallback
 *  ACTION). Drops empty lines. */
const parseTypedLines = (text: string): OpeningCandidate['blocks'] => {
  const blocks: OpeningCandidate['blocks'] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^\[?([A-Za-z-]+)\]?\s*[:：]?\s*(.*)$/);
    const tag = (m?.[1] ?? '').toUpperCase().replace(/-/g, '_');
    const rest = (m?.[2] ?? t).trim();
    if (tag === 'SCENE' || /^(INT\.|EXT\.|内\.|外\.|内景|外景)/.test(t)) {
      blocks.push({ type: 'SCENE_HEADING', content: rest || t });
    } else if (tag === 'ACTION') {
      blocks.push({ type: 'ACTION', content: rest || t });
    } else if (tag === 'CHARACTER' || (/^[A-Z一-龥 ]{1,20}$/.test(t) && !t.includes('.'))) {
      blocks.push({ type: 'CHARACTER', content: rest || t });
    } else if (tag === 'DIALOGUE') {
      blocks.push({ type: 'DIALOGUE', content: rest || t });
    } else if (tag === 'PARENTHETICAL' || /^\(.*\)$/.test(t)) {
      blocks.push({ type: 'PARENTHETICAL', content: rest || t });
    } else if (tag === 'TRANSITION') {
      blocks.push({ type: 'TRANSITION', content: rest || t });
    } else {
      blocks.push({ type: 'ACTION', content: t });
    }
  }
  return blocks.filter(b => b.content);
};

/**
 * Generate 3 DISTINCT cold-open candidates for a NEW screenplay (replaces the
 * fixed template opening when the user wants a random start). Returns each
 * candidate as a logline plus ready-to-insert typed blocks.
 */
export const generateOpenings = async (
  templateName: string,
  systemInstruction: string,
  scriptLanguage: ScriptLanguage,
  settings: AppSettings,
): Promise<OpeningCandidate[]> => {
  const langInstruction = getLanguageInstruction(scriptLanguage);
  const systemPrompt = `You are a staff writer pitching alternate openings for a screenplay.\n${systemInstruction}\n${langInstruction}`;

  const userPrompt = `Invent 3 DISTINCT cold-open choices for a NEW "${templateName}" screenplay. The script does not exist yet — invent freely inside the genre.

Requirements:
- Each opening is 3-6 short lines: one scene heading ([SCENE]) plus action/character/dialogue ([ACTION]/[CHARACTER]/[DIALOGUE]) that hooks immediately.
- The 3 openings must use DIFFERENT hook strategies (e.g. in-media-res vs. quiet character beat vs. mystery teaser) — not minor rephrasing.
- "logline": one sentence, in the script's language, teasing this opening's hook.
- "script": the opening itself — one block per line, each line starting with its [SCENE]/[ACTION]/[CHARACTER]/[DIALOGUE] tag, in the script's language.

Return ONLY a JSON array (no markdown fences, no commentary):
[{"logline":"...","script":"[SCENE] ...\\n[ACTION] ..."}, ...] exactly 3 items.`;

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true, 'openings');

  const cleaned = responseText.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('OPENINGS_PARSE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('OPENINGS_PARSE');
  }
  if (!Array.isArray(parsed)) throw new Error('OPENINGS_PARSE');
  const candidates = parsed
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map(o => ({
      logline: String(o.logline ?? '').trim(),
      blocks: parseTypedLines(String(o.script ?? ''))
    }))
    .filter(o => o.blocks.length >= 2);
  if (!candidates.length) throw new Error('OPENINGS_PARSE');
  return candidates;
};

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
 *
 * `shotGraybox` — the target beat's own SHOT graybox (camera), injected as a
 * COMPOSITION LOCK so the generated image reproduces the same camera the
 * graybox pipeline will render (option A: graybox is the single source of
 * truth for framing). When present, the model's Composition line is anchored to
 * the graybox's shotType + intent + focus instead of inventing a camera.
 *
 * `globalCharDesigns` — a SCRIPT-WIDE name→design-text map (from every
 * CHARACTER block across ALL scenes, not just this scene). ACTION/DIALOGUE
 * prompts use it so a character defined in an EARLIER scene still resolves its
 * identity here (cross-scene consistency). For a CHARACTER (isCharacter) target
 * that already has a design (present in this map), the prompt KEEPS that
 * identity and only re-skins the costume variant — it must not invent a new
 * person.
 *
 * `wardrobe` — the character's costume/age state within its Sequence (from the
 * split). Injected so a shot depicts the right outfit/age at this story point.
 *
 * `variant` — a costume VARIANT (from `张三（浴袍）`). When set for a CHARACTER,
 * the model generates a variant design sheet: reuse the base person EXACTLY
 * and only change to this costume. When set for an ACTION batch frame, the
 * wardrobe note names the variant so the shot shows the right outfit.
 */
export const generateImagePrompt = async (
  sceneBlocks: ScriptBlock[],
  targetBlockId: string,
  systemInstruction: string,
  settings: AppSettings,
  kind: 'action' | 'character' | 'environment' = 'action',
  styleHead?: StyleHead,
  shotGraybox?: GrayboxData,
  globalCharDesigns?: Map<string, string>,
  wardrobe?: { costume?: string; age?: string },
  charName?: string,
  variant?: string,
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
    ? '3. Composition — character turnaround sheet with EXACTLY THREE figures side by side, each full-body and identical in scale, styling and spacing: the LEFT figure faces the camera (front view), the CENTER figure is a strict profile side view (90°, looking right), the RIGHT figure shows the back (back view, head turned away). All three wear the identical outfit and share the same neutral standing pose — an animation model sheet.'
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

${styleHead ? `GLOBAL STYLE LOCK — this script has a fixed visual head that OVERRIDES your own style inference. Weave its art style, era and palette into Environment, Lighting, Material and Mood (never contradict it):\n---\n${styleHead.promptPrefix}\n---` : ''}
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
- CONTENT-SAFE WARDROBE (these prompts go to image models whose content checkers reject ambiguous ages or fetish-coded clothing): describe wardrobe factually — garment, color, fabric. Always state adult characters are ADULT in the Subject line. Never use fetish-coded slang or abbreviations (e.g. "JK", "制服诱惑") — translate such cues into their neutral fashion wording with explicit adult context (e.g. "adult woman in a Japanese school-fashion outfit: pleated skirt, white shirt, knee-high socks"). Avoid emphasizing hosiery/garment straps over the overall look. This keeps the image model's content checker from rejecting an otherwise legitimate fashion beat.
- Translate any non-English source content into English for the prompt.`;

  // Render the scene context, highlighting the target block.
  const context = sceneBlocks.map(b => {
    const isTarget = b.id === targetBlockId;
    const tag = isTarget ? targetTag : '';
    return `${b.type}:${tag} ${b.content}`;
  }).join('\n');

  // Established character designs: CHARACTER blocks that already carry an
  // imagePrompt (the canonical design sheets). Prefer the SCRIPT-WIDE map so a
  // character defined in an EARLIER scene resolves here (cross-scene identity);
  // fall back to scanning this scene (legacy path / local-only calls).
  const charDesigns = new Map<string, string>();
  if (globalCharDesigns && globalCharDesigns.size) {
    for (const [n, p] of globalCharDesigns) {
      if (p?.trim()) charDesigns.set(n, p.trim());
    }
  } else if (!isCharacter) {
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

  // When generating a CHARACTER VARIANT (isCharacter) whose base design already
  // exists, keep the same person and only swap costume — not a new design.
  const selfDesignForChar = isCharacter && charName ? (charDesigns.get(charName) ?? '') : '';
  const variantSection =
    (kind === 'character' && selfDesignForChar)
      ? `\nThis is a VARIANT of the established design above. Reuse the person EXACTLY (same face, body, hair style/color) and change ONLY the ${variant ? `costume (${variant})` : (wardrobe?.age ? `age (to ${wardrobe.age})` : 'costume/age')}${!variant && wardrobe?.costume ? ` and wardrobe (${wardrobe.costume})` : ''} per the story. Do NOT alter the base identity.\n`
      : '';

  // Sequence wardrobe/age / costume variant note for action/dialogue frames.
  const wardrobeNote =
    (kind !== 'character' && (wardrobe?.costume || wardrobe?.age || variant))
      ? `\nAt this story point the character is ${[variant, wardrobe?.age, wardrobe?.costume].filter(Boolean).join(', ')}. Portray that state (outfit/age) for ${charName ?? 'the subject'}, keeping the established identity.\n`
      : '';

  const targetNoun = isCharacter ? 'TARGET CHARACTER' : isEnvironment ? 'TARGET SCENE' : 'TARGET ACTION';

  // Composition lock (option A): when the beat already has a SHOT graybox, its
  // camera is the single source of truth for framing. Anchor the Composition
  // line to the graybox's shotType + intent + focus so the generated image and
  // the graybox pipeline render the SAME camera. Only meaningful for 'action'
  // beats (character sheets / establishing environments have their own fixed
  // framing and no shot camera to lock to).
  let compLock = '';
  if (kind === 'action' && shotGraybox && shotGraybox.kind === 'shot' && shotGraybox.camera && !shotGraybox.error) {
    const cam = shotGraybox.camera;
    const move = cam.movement ? cam.movement.type : 'static';
    compLock = `\nCOMPOSITION LOCK — this beat's shot is already blocked in the graybox. Anchor the Composition line EXACTLY to this camera (do not invent a different shot type, angle, or framing):\n` +
      `- shot type: ${cam.shotType}\n` +
      `- movement: ${move}${cam.movement?.duration ? ` (${cam.movement.duration}s)` : ''}\n` +
      `${cam.shotDescription ? `- director's intent: ${cam.shotDescription}\n` : ''}` +
      `${cam.focus ? `- subject in focus: ${cam.focus}\n` : ''}` +
      `The Composition line must describe this framing and how the subject sits in it. Keep the other five lines (Subject/Environment/Lighting/Material/Mood) as the script + designs dictate.`;
  }

  const userPrompt = `Scene context (the marked ${targetNoun.toLowerCase()} is the one to turn into an image prompt):
---
${context}
---${designSection}${variantSection}${wardrobeNote}${compLock}
Generate the six-line image prompt for the ${targetNoun}. Remember: exactly six labeled lines, English, no technical terms, no markdown.${charDesigns.size && !isEnvironment ? ' Characters in frame MUST match the established designs above.' : ''}`;

  const responseText = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, false, 'image-prompt');

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

  // Deterministic style consistency: the fixed head is prepended verbatim so
  // every image for this script shares the exact same style tokens, even if
  // the model paraphrases them inside the six lines.
  if (styleHead?.promptPrefix?.trim()) {
    lines.unshift(`Global Style: ${styleHead.promptPrefix.trim()}`);
  }

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
    raw = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true, 'scene-transition');
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
const VALID_SHOT_TYPES = ['extreme-wide', 'wide', 'medium', 'close-up', 'extreme-close-up', 'over-the-shoulder', 'top-down', 'pov'] as const;
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
      const targ = typeof movementRaw.targetSeconds === 'number'
        ? movementRaw.targetSeconds
        : parseFloat(movementRaw.targetSeconds);
      const lookPathRaw = Array.isArray(movementRaw.lookPath) ? movementRaw.lookPath : undefined;
      const lookPath: [number, number, number][] | undefined = lookPathRaw
        ? lookPathRaw.slice(0, 40).map((p: any) => asVec3(p))
        : undefined;
      const movement: GrayboxCamera['movement'] = {
        type: oneOf(movementRaw.type, VALID_MOVE_TYPES, 'static'),
        duration: Number.isFinite(dur) && dur > 0 ? dur : 3,
        path: path && path.length ? path : undefined,
        lookPath: lookPath && lookPath.length ? lookPath : undefined,
      };
      if (Number.isFinite(targ) && targ > 0) movement.targetSeconds = targ;
      const camera: GrayboxCamera = {
        shotType: oneOf(cam.shotType, VALID_SHOT_TYPES, 'medium'),
        position: asVec3(cam.position, [0, 1.6, 5]),
        lookAt: asVec3(cam.lookAt),
        movement,
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
/**
 * Sequence boundary judgment + wardrobe/age state for the WHOLE script — one
 * LLM pass.
 *
 * The LLM reads the scene map + which characters are present in each scene and
 * decides (a) where costume/age-change boundaries fall (a new Sequence begins
 * only when the STORY demands it — 换衣、穿越、时间跳跃 — NOT every scene change)
 * and (b) for each sequence, each character's costume/age state within it.
 * Returns `ScriptSequence[]` (block-index spans + wardrobe) ready to persist on
 * `Screenplay.sequences`. On any failure returns a single implicit sequence
 * covering the whole script (safe degrade — frames then read no change).
 */
export const generateSequences = async (
  blocks: ScriptBlock[],
  settings: AppSettings,
): Promise<ScriptSequence[]> => {
  const sceneFull = buildSequenceContext(blocks);
  try {
    const raw = await callAIProvider(settings, {
      system: `You are a film-continuity supervisor. Judge costume/age continuity across the scene list.
A NEW SEQUENCE begins only when the STORY demands a costume/age change (character changes clothes, leaves a location where a different outfit is worn, 穿越, a time jump). Consecutive scenes that share the same wardrobe/age form ONE sequence — do NOT split at every scene heading.
For each sequence, also state each present character's costume and age for that span (omit a character who keeps their base design).
Output STRICT JSON only:
{"sequences":[{"id":"seq1","scenes":[1,2],"label":"短句","wardrobe":{"张三":{"costume":"浴袍"},"李四":{"age":"中年"}}}]}
scenes are 1-based SCENE numbers, consecutive and non-overlapping, covering all scenes exactly once. Use the character names as they appear in the input.`,
      user: sceneFull,
    }, true, 'sequences');
    const parsed = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    const data = JSON.parse(parsed);
    const list = Array.isArray(data?.sequences) ? data.sequences : [];
    // map scene number → start block index of its first SCENE_HEADING
    const sceneBlocks: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'SCENE_HEADING' && blocks[i].content.trim()) sceneBlocks.push(i);
    }
    const out: ScriptSequence[] = [];
    for (const seq of list) {
      const seen = Array.isArray(seq?.scenes) ? seq.scenes.map(Number).sort((a, b) => a - b) : [];
      if (!seen.length) continue;
      const start = sceneBlocks[Math.max(0, Math.min(seen[0] - 1, sceneBlocks.length - 1))];
      const last = sceneBlocks[Math.max(0, Math.min(seen[seen.length - 1] - 1, sceneBlocks.length - 1))];
      const end = last !== undefined && sceneBlocks.length
        ? (seen[seen.length - 1] < sceneBlocks.length ? (sceneBlocks[seen[seen.length - 1]] ?? blocks.length) : blocks.length)
        : blocks.length;
      const wardrobe: Record<string, CharacterWardrobe> = {};
      if (seq?.wardrobe && typeof seq.wardrobe === 'object') {
        for (const [nm, w] of Object.entries(seq.wardrobe as Record<string, { costume?: string; age?: string }>)) {
          if (!w) continue;
          const cw: CharacterWardrobe = {};
          if (w.costume?.trim()) cw.costume = w.costume.trim();
          if (w.age?.trim()) cw.age = w.age.trim();
          if (Object.keys(cw).length) wardrobe[nm] = cw;
        }
      }
      out.push({ id: String(seq?.id ?? `seq${out.length + 1}`), start, end, wardrobe, label: seq?.label ? String(seq.label) : undefined });
    }
    if (!out.length) {
      return [{ id: 'seq1', start: 0, end: blocks.length, wardrobe: {}, label: 'sequence' }];
    }
    // sort and clip defensively (guard against overlaps / gaps)
    out.sort((a, b) => a.start - b.start);
    for (let i = 1; i < out.length; i++) {
      if (out[i].start < out[i - 1].end) out[i].start = out[i - 1].end;
    }
    if (out[0].start > 0) out[0].start = 0;
    return out;
  } catch {
    return [{ id: 'seq1', start: 0, end: blocks.length, wardrobe: {}, label: 'sequence' }];
  }
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

Coordinates & units (FIXED CONTRACT — never deviate, never invent other units or flip axes; the renderer and every downstream exporter read these literally):
- Meters. y is UP. Floor/ground at y=0.
- Origin = the scene's natural center (room center for an interior, the action's ground zero for an exterior).
- Scale reference: a standing adult is ~1.7m tall (eye ~1.6m) — size walls/props against that, and keep blocking distances realistic for the space you describe.
- Character "facing" is radians about the vertical axis; 0 = +Z, increasing counterclockwise (seen from above). Speakers face each other with roughly opposite values.

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

Coordinates & units (FIXED CONTRACT — never deviate, never invent other units or flip axes; the renderer and every downstream exporter read these literally):
- Meters. y is UP. Floor/ground at y=0. Eye level ~1.6m for a standing adult.
- Origin = the scene's natural center (room center for an interior, the action's ground zero for an exterior).
- Camera aim is expressed ONLY as a lookAt TARGET point in world space (never rotation angles).

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
    "shotType": "extreme-wide" | "wide" | "medium" | "close-up" | "extreme-close-up" | "over-the-shoulder" | "top-down" | "pov",
    "shotDescription": "one short sentence on WHY this shot serves the beat — the director's intent (e.g. 'Crane up to reveal the seal cracking as the elders reel')",
    "position": [x, y, z],
    "lookAt": [x, y, z],
    "movement": {
      "type": "static" | "pan" | "tilt" | "dolly" | "tracking" | "orbit" | "crane" | "handheld",
      "duration": seconds,
      "targetSeconds": seconds,
      "path": [[x,y,z], ...],
      "lookPath": [[x,y,z], ...]
    },
    "focus": "character name or object id the shot emphasizes"
  }
}

Rules:
- movement.duration in seconds (1-20). It is the CAMERA's animation clock — how long the move takes to play.
- movement.targetSeconds: the STORY length this shot should occupy ON SCREEN (its screen time), in seconds (1-60). THIS is what later maps to video-generation output, NOT duration. Separate concerns: duration is the camera move; targetSeconds is how long the audience stays in the shot. The two usually differ — a slow 6s dolly can still be a 5s target, and a fast 2s whip-pan can play inside an 8s target with head/tail hold. Choose targetSeconds from the beat's dramatic weight (dialogue beats often run 3-8s, an establishing wide 4-10s, a punchy action beat 2-5s), independent of the move's own length. If you do not set targetSeconds explicitly, it defaults to the movement duration downstream.
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
    raw = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true, 'graybox');
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
/**
 * Analyze a screenplay's dialogue for DUBBING metadata — one structured entry
 * per DIALOGUE block (emotion + delivery + intensity). Same jsonMode pattern
 * as generateGraybox; returns a map keyed by block id so the caller can write
 * each block's `dubEmotion` back in place. On any failure returns an empty
 * map and lets the caller surface a generic error.
 */
export const analyzeDubbing = async (
  blocks: ScriptBlock[],
  systemInstruction: string,
  settings: AppSettings,
): Promise<Record<string, DubEmotion>> => {
  const dialogueLines = blocks
    .map((b, i) => `${i}\t${b.type}\t${b.content.replace(/\n/g, ' \\n ')}`)
    .join('\n');

  const systemPrompt = `You are a Dubbing Director / voice coach for animation and film.
${systemInstruction}

Read every dialogue line and judge how each should be VOICED for a stable, consistent dub. Output STRICT JSON with no other text, in this exact shape:

{
  "lines": [
    {
      "index": <the line index you were given>,
      "emotion": "<one primary emotion, lowercase English, from this closed vocabulary: anger, joy, sadness, fear, surprise, disgust, neutral, tenderness, menace, excitement, confusion, determination, sorrow, amusement, intensity>",
      "delivery": "<a short, TTS-actionable voicing direction in English, e.g. 'low, slow, threatening' | 'bright and fast' | 'breathy whisper' | 'teary, breaking'>",
      "intensity": <1-10>,
      "parenthetical": "<if the line has an explicit (parenthetical) direction, copy it verbatim here; else omit>"
    }
  ]
}

Rules:
- One entry per DIALOGUE line (index = the number in the input). Ignore non-DIALOGUE blocks.
- emotion must come from the CLOSED vocabulary above so a future TTS maps it to a stable emotional preset. Never invent free-form emotion names.
- delivery is how the VOICE performs it — short (<=8 words), concrete, so a voice actor (human or TTS) can act it without ambiguity. It drives pacing and energy.
- intensity 1-10: how strong the delivery is (1 = near-whisper, 10 = shout). Correlate with punctuation, caps, and the scene's stakes.
- A character's voice (tone/timbre) is stable across the whole script — you only judge THIS line's EMOTION and DELIVERY, never the identity of the voice.
- The parenthetical (e.g. "(whispering)", "(coldly)") is a strong signal — fold its intent into delivery and copy the original into parenthetical.
- Keep every line contiguous with the input order. Do NOT drop lines or reorder.

Keep the emotion/delivery in English regardless of the script language — a dubbing tool will map them to local TTS.`;

  const userPrompt = `Analyze these blocks for dubbing direction (index<TAB>type<TAB>content):
---
${dialogueLines}
---

Output only the JSON.`;

  let raw = '';
  try {
    raw = await callAIProvider(settings, { system: systemPrompt, user: userPrompt }, true, 'dub');
  } catch (err: any) {
    console.warn('analyzeDubbing failed:', err);
    return {};
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : JSON.parse(raw);
    const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
    const result: Record<string, DubEmotion> = {};
    for (const l of lines) {
      const idx = Number(l?.index);
      const b = idx >= 0 ? blocks[idx] : undefined;
      if (!b || b.type !== 'DIALOGUE') continue;
      const emotion = typeof l?.emotion === 'string' && l.emotion.trim() ? l.emotion.trim() : 'neutral';
      const delivery = typeof l?.delivery === 'string' && l.delivery.trim() ? l.delivery.trim() : '';
      const intensity = Number(l?.intensity);
      const entry: DubEmotion = {
        emotion,
        delivery,
        intensity: Number.isFinite(intensity) ? Math.max(1, Math.min(10, Math.round(intensity))) : 5,
      };
      if (typeof l?.parenthetical === 'string' && l.parenthetical.trim()) entry.parenthetical = l.parenthetical.trim().slice(0, 80);
      result[b.id] = entry;
    }
    return result;
  } catch {
    return {};
  }
};
