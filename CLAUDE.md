# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StoryFlow** is an AI-powered screenplay/script editor built with React + TypeScript + Vite. It supports multiple script formats (standard Hollywood, sitcom, stage play, commercial, short video, and various Chinese genres like danmei, xuanhuan, wuxia, etc.) with AI assistance via Gemini or DeepSeek APIs.

## Development Commands

```bash
# Install dependencies
npm install

# Run dev server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**API Key Required**: Set `GEMINI_API_KEY` in `.env.local` or configure via app settings.

## Architecture

### File Structure

```
StoryFlow/
├── App.tsx                  # Main application, all state & logic
├── index.tsx                # React entry point
├── index.html               # HTML template
├── types.ts                 # TypeScript definitions
├── constants.ts             # Templates, translations, prompts, defaults
├── components/
│   ├── EditorBlock.tsx      # Individual script block editor
│   ├── Sidebar.tsx          # Script list, navigation, settings
│   ├── Toolbar.tsx          # Block type selector + AI button
│   └── SettingsModal.tsx    # App/metadata settings UI
├── services/
│   └── geminiService.ts     # AI calls (Gemini/DeepSeek providers)
└── utils/
    └── pagination.ts        # Page break calculation (1 page ~55-60 blocks)
```

### Core Data Model

- **Screenplay**: `{ id, metadata: {title, author, draft, templateId, scriptLanguage}, blocks: ScriptBlock[], lastModified }`
- **ScriptBlock**: `{ id, type: BlockType, content }`
- **BlockType**: `SCENE_HEADING | ACTION | CHARACTER | DIALOGUE | PARENTHETICAL | TRANSITION`
- **ScriptLanguage**: `en | zh | dual`

### Key Concepts

1. **Storage**: Uses localStorage with two-tier system:
   - `script_index`: Array of `{id, title, lastModified}` summaries
   - `script_{id}`: Full screenplay JSON per script
   - Legacy migration from old `screenplay_autosave` key handled in App.tsx:142-154

2. **Templates**: Defined in `constants.ts`. Each has:
   - `systemPrompt`: The "AI persona" (Hollywood Master, Sitcom Showrunner, etc.)
   - `initialBlocks`: English starting blocks
   - `initialBlocksZh`: Chinese starting blocks (optional)

3. **AI Service** (`services/geminiService.ts`):
   - Two providers: `gemini` (default) or `deepseek`
   - Three modes: `generateContinuation`, `suggestIdeas`, `rewriteBlock`
   - Expects `[TYPE]` prefixed labels in AI responses for parsing (App.tsx:540-551)

4. **Pagination**: `utils/pagination.ts` splits blocks into pages (~55 blocks/page) for print-like rendering

### State Management Flow

All state lives in `App.tsx`:
- `screenplay`: Current script + blocks
- `appSettings`: Provider (gemini/deepseek), API keys, colors, keyboard shortcuts
- `savedScripts`: Index for multi-script management
- `aiState`: `{isLoading, suggestion, error}` for AI modal

Autosave debounces 1s (App.tsx:156-182), saves both content and index.

### Keyboard Shortcuts

Defined in `appSettings.shortcuts` (defaults in `constants.ts`):
- `Tab` / `Shift+Tab`: Cycle block types
- `Enter`: Create new block (smart type inference)
- `Backspace` at start: Merge with previous block
- Arrow keys with Ctrl/Meta: Navigate between blocks
- AI shortcuts (configurable): Trigger continue/ideas/rewrite

## Adding a New Template

1. Add prompt to `PROMPTS` in `constants.ts`
2. Add entry to `TEMPLATES[]` with `nameKey`, `descKey`, `systemPrompt`, `initialBlocks`
3. Add translations to `TRANSLATIONS.en.templates` and `TRANSLATIONS.zh.templates`

## AI Integration Notes

- AI responses must include `[TYPE]` prefixes (e.g., `[SCENE]`, `[ACTION]`) for proper parsing
- Language instruction injected based on `scriptLanguage` setting
- Last 20-150 blocks sent as context (varies by mode)
- Temperature set to 0.9 for creative output
