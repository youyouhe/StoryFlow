export type BlockType = 
  | 'SCENE_HEADING'
  | 'ACTION'
  | 'CHARACTER'
  | 'DIALOGUE'
  | 'PARENTHETICAL'
  | 'TRANSITION';

export interface ScriptBlock {
  id: string;
  type: BlockType;
  content: string;
  /** Optional text-to-image prompt attached to ACTION blocks (storyboard). */
  imagePrompt?: string;
}

export type ScriptLanguage = 'en' | 'zh' | 'dual';

export interface ScriptMetadata {
  title: string;
  author: string;
  draft: string;
  templateId?: string;
  scriptLanguage: ScriptLanguage;
}

export interface Screenplay {
  id: string;
  metadata: ScriptMetadata;
  blocks: ScriptBlock[];
  lastModified: number;
}

export interface ScriptTemplate {
  id: string;
  nameKey: string; // Key for translation
  descKey: string; // Key for translation
  systemPrompt: string; // The "Master" persona
  initialBlocks: ScriptBlock[];
  initialBlocksZh?: ScriptBlock[];
}

export type Theme = 'light' | 'dark';

export type Language = 'en' | 'zh';

export type LLMProvider = 'gemini' | 'deepseek';

/** Gemini reasoning effort (maps to @google/genai thinkingLevel). 'none' disables thinking. */
export type GeminiThinkingLevel = 'none' | 'low' | 'medium' | 'high';

export type ColorSettings = Record<BlockType, string>;

export interface KeyboardShortcuts {
  aiContinue: string;
  aiIdeas: string;
  aiRewrite: string;
  aiStoryboard: string;
}

/** AI assistant operating modes. STORYBOARD generates a text-to-image prompt. */
export type AIMode = 'CONTINUE' | 'IDEAS' | 'REWRITE' | 'STORYBOARD';

export interface AppSettings {
  provider: LLMProvider;
  deepseekApiKey: string;
  deepseekModel: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiThinkingLevel: GeminiThinkingLevel;
  colorSettings: ColorSettings;
  shortcuts: KeyboardShortcuts;
  autoAcceptAI: boolean;
  aiContextBlocks: number;
  aiOutputBlocks: number;
}

export interface AIState {
  isLoading: boolean;
  suggestion: string | null;
  error: string | null;
}

export interface PDFOptions {
  titlePage?: boolean;
  filename?: string;
  colors?: ColorSettings;
}