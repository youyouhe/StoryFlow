# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StoryFlow** is an AI-powered screenplay/script editor built with React 19 + TypeScript + Vite. It runs both as a web app and as a Tauri 2 desktop app. It supports multiple script formats (standard Hollywood, sitcom, stage play, commercial, short video, and Chinese genres like danmei, xuanhuan, wuxia) with AI assistance via Gemini or DeepSeek APIs.

## Development Commands

```bash
npm install          # install dependencies
npm run dev          # web dev server → http://localhost:3000 (strictPort)
npm run build        # production build (outputs to dist/)
npm run preview      # preview the production build

# Tauri desktop app (wraps the Vite dev/build pipeline)
npm run tauri:dev          # desktop dev (launches npm run dev, then Tauri window)
npm run tauri:build        # release desktop build
npm run tauri:build-debug  # debug desktop build
```

There is no lint or test script configured — type checking is done implicitly via `vite build` (tsconfig has `noEmit: true`).

**API keys**: Set `GEMINI_API_KEY` (and optionally `DEEPSEEK_API_KEY`) in `.env.local`. `vite.config.ts` injects these into `process.env.API_KEY` and `process.env.GEMINI_API_KEY` at build time. Keys can also be entered at runtime via the Settings UI (stored in localStorage and take precedence over the env fallback).

## Architecture

This is a flat-layout React app (no `src/` for app code; entry is root `index.tsx` → `App.tsx`). Styling is Tailwind CSS v4 (`@tailwindcss/postcss`).

```
App.tsx                  # All state & logic (~950 lines). The single source of truth.
types.ts                 # TypeScript domain types
constants.ts             # TEMPLATES, TRANSLATIONS (en/zh), PROMPTS, DEFAULT_APP_SETTINGS
components/
  EditorBlock.tsx        # One editable script block; keyboard handling per block
  Sidebar.tsx            # Script list, navigation, settings entry
  Toolbar.tsx            # Block type selector + AI mode trigger
  SettingsModal.tsx      # Provider/keys/colors/shortcuts/AI params UI
services/geminiService.ts # AI calls — both Gemini and DeepSeek providers
utils/pagination.ts      # Page-break calc for print view (~55 blocks/page)
utils/pdfExport.ts       # PDF export via html2pdf.js
src-tauri/               # Tauri 2 Rust desktop shell (tauri.conf.json)
```

### Core Data Model (`types.ts`)

- **Screenplay**: `{ id, metadata: ScriptMetadata, blocks: ScriptBlock[], lastModified }`
- **ScriptMetadata**: `{ title, author, draft, templateId?, scriptLanguage }`
- **ScriptBlock**: `{ id, type: BlockType, content }`
- **BlockType**: `SCENE_HEADING | ACTION | CHARACTER | DIALOGUE | PARENTHETICAL | TRANSITION`
- **ScriptLanguage** (script content): `en | zh | dual`
- **Language** (UI): `en | zh` — separate from script language
- **Theme**: `light | dark | sepia`
- **AppSettings**: `{ provider, deepseekApiKey, deepseekModel, geminiApiKey, colorSettings, shortcuts, autoAcceptAI, aiContextBlocks, aiOutputBlocks }`

### State Management

All state lives in `App.tsx` — there is no external store. Key pieces: `screenplay` (current script + blocks), `appSettings` (provider, keys, colors, shortcuts, AI params), `savedScripts` (multi-script index), `aiState` (`{isLoading, suggestion, error}`).

**Storage** is localStorage with a two-tier per-script system plus settings:
- `script_index`: array of `{id, title, lastModified}` summaries
- `script_{id}`: full screenplay JSON per script
- `screenplay_app_settings`: persisted `appSettings`
- Legacy migration from the old single-script `screenplay_autosave` key runs on load (App.tsx ~150).

Autosave debounces 1s (`setTimeout` in App.tsx:159-182), persisting both the current script and the index.

### AI Integration (`services/geminiService.ts`)

- **Two providers** selected by `appSettings.provider`: `gemini` (default, via `@google/genai`) or `deepseek` (raw `fetch` to `https://api.deepseek.com/chat/completions`). Both are served from one service module.
- **Three modes**: `generateContinuation`, `suggestIdeas`, `rewriteBlock`. The mode is injected as `systemInstruction` built from the template's `systemPrompt` + `scriptLanguage`.
- **Context window is configurable**, not fixed: `appSettings.aiContextBlocks` (default in `constants.ts`) controls how many trailing blocks are sent; `aiOutputBlocks` controls how many blocks the model is asked to generate.
- **Response parsing**: AI text is expected to contain `[TYPE]`-prefixed lines (e.g. `[SCENE]`, `[ACTION]`). Parsed in `App.tsx` ~554-572 via regex against the `BlockType` union; bare lines are classified by heuristics (e.g. `INT./EXT./内./外.` → `SCENE_HEADING`). When `autoAcceptAI` is on, suggestions are inserted automatically.

### Keyboard Shortcuts

Defined in `appSettings.shortcuts` (defaults in `constants.ts`). Editing keys (Tab cycle, Enter new block with smart type inference, Backspace-at-start merge, Ctrl/Meta+Arrow navigation) are hardcoded in `App.tsx`/`EditorBlock.tsx`; the three AI shortcuts (`aiContinue`, `aiIdeas`, `aiRewrite`) are user-configurable and parsed from `key+modifier` strings (App.tsx ~360).

### Tauri Notes

`src-tauri/tauri.conf.json` runs `npm run dev` (port 3000) in dev and `npm run build` for the desktop bundle. The CSP allows `connect-src` only to `self`, `api.deepseek.com`, and `generativelanguage.googleapis.com` — adding a new AI provider host requires updating this CSP.

## Adding a New Template

1. Add the prompt text to `PROMPTS` in `constants.ts`.
2. Add a `ScriptTemplate` entry to `TEMPLATES[]` with `nameKey`, `descKey`, `systemPrompt`, `initialBlocks` (English), and optionally `initialBlocksZh`.
3. Add matching translations under `TRANSLATIONS.en.templates` and `TRANSLATIONS.zh.templates`.
