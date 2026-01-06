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

export type Theme = 'light' | 'dark' | 'sepia';

export type Language = 'en' | 'zh';

export type LLMProvider = 'gemini' | 'deepseek';

export type ColorSettings = Record<BlockType, string>;

export interface KeyboardShortcuts {
  aiContinue: string;
  aiIdeas: string;
  aiRewrite: string;
}

export interface AppSettings {
  provider: LLMProvider;
  deepseekApiKey: string;
  deepseekModel: string;
  geminiApiKey: string;
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
}