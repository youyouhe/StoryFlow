# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StoryFlow** is a screenplay-first AI video studio built with React 19 + TypeScript + Vite. It runs as a web app and as a Tauri 2 desktop app. It supports multiple script formats (standard Hollywood, sitcom, stage play, commercial, short video, and Chinese genres like danmei, xuanhuan, wuxia), word-level timing, graybox 3D previs, dual-mode video generation (Express/Pro via MiniMax H3 / ComfyUI / fal), a deterministic IR production pipeline, and AI text assistance via Gemini or DeepSeek (BYOK).

## Development Commands

```bash
npm install          # install dependencies
npm run dev          # web dev server → http://localhost:5173 (strictPort)
npm run dev:https    # OPTIONAL self-signed HTTPS on port 5174 (VITE_HTTPS=1) — makes a LAN
                     # origin a secure context so the folder asset library works from other
                     # devices; first visit must accept the cert warning. Default `dev` stays HTTP.

npm run typecheck        # tsc --noEmit over the root project (includes tests/ and skills/)
npm run typecheck:ir     # tsc -p tsconfig.ir.json — src/ (IR layer) is a separate TS project
npm run test             # vitest run — 54 test files / 548 cases at R0 (pure-function layer;
                         # UI/orchestration still has zero coverage). There is no lint script.

# Tauri desktop app (wraps the Vite dev/build pipeline)
npm run tauri:dev / npm run tauri:build / npm run tauri:build-debug

# Gallery backend lives in the PRIVATE repo youyouhe/storyflow-gallery
# (default port 8787; see its README for deploy). Client↔server verification:
node /tmp/onboard/youyouhe__storyflow-gallery/scripts/server-smoke.mjs   # HTTP contract
npx esbuild scripts/sync-e2e.ts --bundle --platform=node --format=esm --outfile=/tmp/opencode/sync-e2e.mjs && node /tmp/opencode/sync-e2e.mjs
```

**API keys**: Set `GEMINI_API_KEY` (and optionally `DEEPSEEK_API_KEY`) in `.env.local`. Keys can also be entered at runtime via Settings. Never commit or paste keys; never write them into files or logs.

## Architecture

Flat-layout React app (entry is root `index.tsx` → `App.tsx`). Styling is Tailwind CSS v4.

```
App.tsx                  # 487-line COMPOSITION ROOT — state refs, wiring, render. Keep it shrinking.
hooks/                   # 13 domain hooks (extracted verbatim from the old App.tsx):
                         #   useAIExecutor(789, largest — 8-mode AI orchestration + [TYPE] parsing),
                         #   useH3VideoPlan(432, plan gate + H3 tasks), useGallerySync(363),
                         #   useRefAssetLibrary, useEditorKeyboard, useAppSettings (credential
                         #   migration), useScriptLibrary (autosave 1s debounce + legacy migration),
                         #   useImportExport, useStoryFlowApp, useTemplateFlow, useScriptManagement,
                         #   useBlockEditing, useAskDialog
components/              # 27 components (AppTopBar/EditorCanvas/AppModals shell; AIModal,
                         #   PromptPanel, ExpressWorkbench, Graybox3DView, IRPipelineModal,
                         #   SettingsModal, PlanPreviewModal, CandidatesPanel, ComposeExportModal,
                         #   ReviewPanel, GalleryModal, RefAssetLibraryModal, TimingStrip, …)
services/                # 25 top-level services (geminiService, minimaxService, comfyService,
                         #   falService/glmTtsService/sfxService/falMusicService, alignment,
                         #   apiClient, syncEngine, cloudConsent, auth4a, credentials, desktop,
                         #   refImageStore, assetDirStore, assetCloud, expressService, videoExport,
                         #   aiLog, webmcp, webmcpAccessor, gallery, proAudioStore, debugLog)
  project/               # P1 project directory: files.ts (format envelopes), candidates.ts,
                         #   results.ts, feedback.ts, projectStore.ts, migrate.ts
  providers/             # P4: Capability routing (Model/Provider/Endpoint + supports() refusal),
                         #   registry.ts, types.ts (CapabilityId), storyflow.runtime.json
utils/                   # 24 pure-function modules + timing/ + plan/ + compositor/ subdirs
skills/registry.ts       # THE capability roster (21 skills, pure data). See "Skill registry".
skills/storyflow/        # L2 agent docs: SKILL.md + references/*.md
src/                     # IR production pipeline (separate tsconfig.ir.json): extract/ ir/
                         #   bridge/ exec/ captions/ align/
src-tauri/               # Tauri 2 shell (keyring plugin wired; see Tauri notes)
tests/                   # top-level vitest suite (pure functions + skill-registry consistency)
```

### Core Data Model (`types.ts`)

- **Screenplay**: `{ id, metadata: ScriptMetadata, blocks: ScriptBlock[], lastModified, schemaVersion?, characterSheets?, sequences?, referenceBindings?, segmentGrayboxes?, marks?, expressShots? … }`
- **ScriptBlock**: `{ id, type: BlockType (SCENE_HEADING|ACTION|CHARACTER|DIALOGUE|PARENTHETICAL|TRANSITION), content, graybox?, imagePrompt?, timing?, dubEmotion?, director fields … }`
- schemaVersion 3: blocks store STYLE-INCREMENTAL content (styleHead composed on read, fixes STYLE DRIFT); CHARACTER design sheets land once in the `screenplay.characterSheets` registry.
- **ScriptLanguage** (script content) `en|zh|dual` is separate from **Language** (UI) `en|zh`, and from **Theme** `light|dark|sepia`.
- **AppSettings**: provider/model/thinking level, credential fields (`credentialTier: 'session'|'remember'|'keyring'` + legacy plaintext key fields — see credentials below), `videoBackend: 'api'|'comfy'`, Comfy workflows, fal image params, colors, `shortcuts` (6 keys), `autoAcceptAI`, `aiContextBlocks`, `aiOutputBlocks`.

### State Management & Storage

No external store. `App.tsx` composes the 13 domain hooks; `services/webmcpAccessor.ts` receives state via an explicit `WebMcpDeps` interface (latest-ref pattern).

- **localStorage**: `script_index` + `script_{id}` (two-tier per-script), `screenplay_app_settings`, `sync_outbox` + `sync_{id}`, `gallery_auth`, `cloud_sync_consent`, `cloud_pull_policy`, `h3_tasks`, `storyflow_cred_count`/`storyflow_cred_remember`/`storyflow_cred_device_key`, `ai_perf_log`, `sso_access_token`/`sso_logged_out`, `asset_cloud_map`, `assetDir`. Legacy single-script `screenplay_autosave` migrates on load (`hooks/useScriptLibrary.ts`).
- **Project directory (P1)** — when opened (设置 → 项目目录) it is the truth source: `story.sfstory`, `style.sfstyle`, `runs/*.sfrun`, `.storyflow/results/<runId>/{result.json,files/}`, `FEEDBACK.json`, `storyflow.runtime.json`, plus agent memory files `BRIEF.md`/`TREATMENT.md`/`PROGRESS.md`. Every structured file is an envelope `{ format, data }` with a stamped format id (`storyflow.story@1`, `storyflow.style@1`, `storyflow.run@1`, `storyflow.result@1`, `storyflow.feedback@1`) — a different major is refused by name; extend only additively within `@1`.
- Autosave debounces 1s (`hooks/useScriptLibrary.ts`), persists script + index, then `syncEngine.markDirty` for cloud-backed scripts.

### Skill Registry (R0)

`skills/registry.ts` is the single capability roster: 21 skills (14 可用 + ir-pipeline 半成品 + 6 实验/待立项), each declaring `webmcpTools` / `stateFiles` / `uiEntries` / `capabilities` / `referenceDoc`. `tests/skill-registry.test.ts` binds the roster to the code structurally (tools really registered, files really exist, deps acyclic, planned skills stay zero-wired) — **roster, tools, or docs drift = red test**. Agents read the roster at runtime via the `storyflow_list_skills` WebMCP tool.

### Gallery Cloud Sync

Local-first whole-doc sync + monotonic revision; the cloud is never required for editing. `services/apiClient.ts` (mock/HTTP backend switch in `services/gallery.ts`), `services/syncEngine.ts` (outbox state machine; 409 conflict forks the cloud copy locally, then local wins — nothing is lost). **Consent layer** (`services/cloudConsent.ts`): sync consent (unset/granted/denied) + pull policy (ask/auto/never) gate every download; 4A SSO cookies are never adopted silently (`services/auth4a.ts`). Visibility is three-state (private/group/public). Server: private repo `youyouhe/storyflow-gallery` (Hono + raw pg, scrypt auth, `SELECT … FOR UPDATE` revision guard).

### AI Integration (`services/geminiService.ts` + `hooks/useAIExecutor.ts`)

- **Two providers** (gemini via `@google/genai`, deepseek via raw fetch), **8 `AIMode`s** served by 13 generate/analyze functions; mode is injected as `systemInstruction` from the template's prompt + `scriptLanguage`.
- Response parsing (`[TYPE]`-prefixed lines, bare-line heuristics like `INT./EXT./内./外.` → SCENE_HEADING) lives in `hooks/useAIExecutor.ts`, not App.tsx.
- Context window is configurable (`aiContextBlocks` trailing blocks in, `aiOutputBlocks` blocks out).
- **Credentials (three tiers, issue #9)**: session-only / encrypted remember blob (device passphrase + PBKDF2/AES-GCM) / OS keyring (desktop). `services/credentials.ts` strips secrets before any persistence (`stripSecrets` + one-shot `migrateAndHydrate`); desktop keyring via `services/desktop.ts` + `src-tauri` plugin. **Known debt (D5)**: plaintext key fields still exist on AppSettings and in SettingsModal inputs — persistence is stripped, but do NOT add new consumers of those fields; the two-step removal (move UI input to credential slots, then delete fields) is planned.
- AI call log (ring buffer): `services/aiLog.ts` (localStorage `ai_perf_log`), surfaced by `storyflow_get_ai_log`.

### Video Generation (dual mode)

- **Express 抽卡**: per-beat first frame → I2V clip → lock/re-roll (`components/ExpressWorkbench.tsx`, `services/expressService.ts`); results persist on `screenplay.expressShots`.
- **Pro 导演流**: white-model submission via MiniMax H3 BYOK or self-hosted ComfyUI (`hooks/useH3VideoPlan.ts`, `services/minimaxService.ts`, `services/comfyService.ts`); task queue `h3_tasks`. Mode switch rules in `utils/modeSwitch.ts` (Pro→Express forbidden once Pro feature data exists; Express→Pro confirmed + one-way).
- **Plan gate (P3)**: every paid submission passes a frozen plan (`utils/plan/freeze.ts`, `components/PlanPreviewModal.tsx`, gate wired at `hooks/useH3VideoPlan.ts` `submitPlanToH3`); candidate reuse + results repo in `services/project/candidates.ts` / `results.ts`.
- Pro audio workbench (GLM-TTS + fal BGM + SFX + amix): `components/ProAudioPanel.tsx` + `services/proAudioStore.ts` (session memory only, never localStorage).
- Final concat: ffmpeg.wasm (`services/videoExport.ts`, pinned 0.12.6, UMD lazy-load, concat-list fallback).

### Timing / Captions / Speech Rate

Word-level tokens (`utils/timing/tokenize.ts`), three-level time source (manual 校时 > ASR-aligned > estimate), anchor identity (2M+2N+2), program timeline projection, automatic reflow. Speech-rate model: 4.5 字/秒 base (configurable constants in `utils/timing/estimate.ts`). Caption compilers under `src/captions/` (SRT/VTT + ASS karaoke `\k`).

### IR Production Pipeline (`src/`)

Screenplay → StoryFlowIR (`src/extract/`) → schema validation with additive version union (`src/ir/schema.ts`) → visual/audio/captions compilers → StoryFlowXML interchange (`src/ir/format/`) → bridge (`src/bridge/`) → real executors with budget gate + multi-provider pricing (`src/exec/`). **Status: executors are NOT wired to the UI main path** — `components/IRPipelineModal.tsx` exposes the zero-cost face only (compile/serialize/price preview; IR JSON / SRT / VTT / ASS are browser downloads). Design docs: `docs/storyflow-ir-schema.md`, `docs/storyflow-ir-p0..p14.md`.

### Keyboard Shortcuts

Six configurable AI shortcuts in `appSettings.shortcuts` (`aiContinue`, `aiIdeas`, `aiRewrite`, `aiStoryboard`, `aiGraybox`, `syncCloud`; defaults in `constants.ts`, parsed from `key+modifier`). Editing keys (Tab cycle, Enter smart-type inference, Backspace-at-start merge, Ctrl/Meta+Arrow navigation) are hardcoded in `hooks/useEditorKeyboard.ts` / `hooks/useBlockEditing.ts`.

### Tauri Notes

`src-tauri/tauri.conf.json` runs `npm run dev` (port 5173) in dev and `npm run build` for the bundle. The CSP `connect-src` is currently the permissive `'self' https: http:` (widened for fal/ComfyUI) — new external hosts therefore work without a CSP edit, but **record every new outbound host**; tightening the CSP is tracked debt. The keyring plugin (get/set/delete) is registered in `src-tauri/src/main.rs`; desktop real-hardware verification is still outstanding.

## WebMCP / Agent Surface

StoryFlow exposes 18 `storyflow_*` tools to in-page agents (10 annotated read-only; the rest are write or generation actions that consume the user's quota) — `services/webmcp.ts` owns definitions; `services/webmcpAccessor.ts` implements ops over explicit deps. Write tools are guarded: `update_block`/`delete_block` require `expectedContent` echoing the block's CURRENT content (optimistic concurrency — human edits win); `append_blocks`/`insert_blocks` are bounded; `import_script` replaces the open script. `storyflow_list_skills` returns the capability roster.

**Operating the running app**: ensure `scripts/dev.sh start` (Vite + headless Chromium with `--enable-features=WebMCP`, CDP on 127.0.0.1:9222, opening http://localhost:5173/), then use the `storyflow_*` tools through the **`storyflow` stdio MCP bridge** (https://github.com/youyouhe/webmcp-retrofit, cloned at `~/webmcp-retrofit`; regression test: `cd ~/webmcp-retrofit/mcp-bridge && node test-client.mjs`). If tools report "No StoryFlow page open", relaunch the launcher (secure context = localhost, not a LAN IP). Fallback: the `chrome-devtools` MCP `evaluate_script` can call `document.modelContext.getTools()/executeTool()`; do NOT simulate human clicks.

Agent-side operating docs: `skills/storyflow/SKILL.md` + `references/*.md` — kept in sync with code by `tests/skill-registry.test.ts`.

## Change Discipline (必须遵守)

1. **App.tsx 只减不增.** It is a composition root (487 lines). Never grow it; new state/logic goes to a domain hook or a pure module.
2. **新编排逻辑直接落在 `hooks/` 或纯函数/`utils/`,禁止回流 App.tsx.** (Same for new UI: prefer standalone components wired via `AppModals.tsx`.)
3. **三件套**: a new user-facing capability ships as **implementation + `skills/registry.ts` roster entry + `skills/storyflow/references/` doc page**, in one PR, with `npm run typecheck`, `npm run typecheck:ir`, `npm run test` all green. No reference page ⇒ the consistency test refuses the roster entry.

## Adding a New Template

1. Add the prompt text to `PROMPTS` in `constants.ts`.
2. Add a `ScriptTemplate` entry to `TEMPLATES[]` with `nameKey`, `descKey`, `systemPrompt`, `initialBlocks` (English), and optionally `initialBlocksZh`.
3. Add matching translations under `TRANSLATIONS.en.templates` and `TRANSLATIONS.zh.templates`.
