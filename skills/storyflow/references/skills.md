# Skill registry — what StoryFlow can do (one-page index)

Read this when: you need to know which capability covers a job, where its code
and state live, or which page documents it. This is the L2 index over the L1
roster in `skills/registry.ts` — the roster is data, this page is prose; the
consistency test (`tests/skill-registry.test.ts`) keeps them structurally
bound to the code (tools, files, components). At runtime the same roster is
readable via the `storyflow_list_skills` WebMCP tool.

Rule of three (CLAUDE.md 变更纪律): a new user-facing capability ships as
**implementation + roster entry + a page here**, in one PR. A skill with
`maturity: 实验` is an id and a boundary only — no code, no tools, no state.

## Routing table

| Skill | Maturity | Dedicated page |
|---|---|---|
| screenplay-editor | 可用 | `references/files.md` |
| ai-writing | 可用 | § AI writing (below) |
| character-assets | 可用 | § Reference assets (below) |
| graybox-previz | 可用 | § Graybox previs (below) |
| video-gen | 可用 | § Video generation, dual mode (below) |
| ir-pipeline | 半成品 | § IR production pipeline (below) |
| timing | 可用 | `references/timing.md` |
| plan-gate | 可用 | `references/builds.md` |
| provider-credentials | 可用 | `references/providers.md` |
| compositor | 可用 | `references/review.md` (composite export checks) |
| gallery-sync | 可用 | § Cloud sync & consent (below) |
| variants | 可用 | `references/variants.md` |
| review-loop | 可用 | `references/review.md` |
| agent-ops | 可用 | `../SKILL.md` |
| desktop-shell | 可用 | § Desktop shell (below) |
| brief-align | 实验 | § Planned skills (below) |
| shot-breakdown | 实验 | § Planned skills (below) |
| continuity-bible | 实验 | § Planned skills (below) |
| prompt-compiler | 实验 | § Planned skills (below) |
| frame-qa | 实验 | § Planned skills (below) |
| edit-repair | 实验 | § Planned skills (below) |

Source-of-truth anchor: the roster lives at `skills/registry.ts` (pure data,
zero behavior; `SKILLS` + the `SkillId` union must stay 1:1 — the test and a
compile-time guard enforce it). Plan documents: `docs/architecture/` on the
`sf-arch-review` branch (`skill-architecture.md`, `capability-inventory.md`).

## AI writing (ai-writing)

Eight `AIMode`s (续写/灵感/润色/分镜图提示词/灰盒生成/配音元数据/FROM_PROMPT/
序列连戏) served by `services/geminiService.ts` (13 generate/analyze
functions) and orchestrated in `hooks/useAIExecutor.ts` — BYOK, provider
switchable Gemini/DeepSeek. Response protocol: `[TYPE]`-prefixed lines parsed
against the six block types; bare lines classified by heuristics. Context and
output window are per-settings (`aiContextBlocks` / `aiOutputBlocks`). The
call log (`storyflow_get_ai_log`, localStorage `ai_perf_log`) is the first
stop when a generation tool times out.

## Reference assets (character-assets)

Three storage backends behind one `RefImage` shape: IndexedDB
(`services/refImageStore.ts`, db `storyflow-refs` — blobs never in
localStorage), user-picked folder (`services/assetDirStore.ts`, handle
persisted as localStorage `assetDir`), and cloud upload with dedup
(`services/assetCloud.ts`, local↔cloud mapping in `asset_cloud_map`).
Identity v2 (kind/charName/variant/sceneKey), version groups + isSelected,
11-module industrial character sheets (`utils/characterSheet.ts`, registry on
`screenplay.characterSheets`, schemaVersion 3), white-model bindings
(`utils/refBindings.ts` → `screenplay.referenceBindings`). Note: the
`video-frame` source enum exists but frame extraction is NOT implemented.

## Graybox previs (graybox-previz)

Block-attached 3D previs (`block.graybox`): scene layout + character blocking
on SCENE_HEADING, camera/movement on ACTION/DIALOGUE. AI generation, three.js
rendering/recording (`components/Graybox3DView.tsx`), 360 panorama viewer,
pre-submit geometry health check (the shape `storyflow_check_graybox_health`
returns; ≤30s model cap), chain segmentation (≤15s), Blender export,
`authored` duration pinning (`graybox.movement.targetSeconds`). Everything
persists inside `story.sfstory`.

## Video generation, dual mode (video-gen)

Project-level mode: **Express** (抽卡: per-beat first frame → I2V clip →
lock/re-roll, `components/ExpressWorkbench.tsx` + `services/expressService.ts`)
and **Pro** (导演流: white-model submission via MiniMax H3 BYOK or self-hosted
ComfyUI, `hooks/useH3VideoPlan.ts` + `services/minimaxService.ts` /
`comfyService.ts`). Switching rules (`utils/modeSwitch.ts`): Pro→Express is
forbidden once Pro feature data exists; Express→Pro needs confirmation and is
one-way. Every paid submission passes the plan gate (see `references/builds.md`).
Seedance/H3 prompt dialects: `utils/whiteModelPrompt.ts` (also behind
`storyflow_generate_video_prompt`). Pro audio workbench (GLM-TTS dialogue +
fal BGM + SFX + amix) lives in `components/ProAudioPanel.tsx`; its blobs are
session-memory only (`services/proAudioStore.ts`), never localStorage. Final
concat is ffmpeg.wasm (`services/videoExport.ts`). Task queue: localStorage
`h3_tasks`.

## IR production pipeline (ir-pipeline) — 半成品

The deterministic production line, all under `src/` (independent TS project,
`npm run typecheck:ir`): extraction (`src/extract/screenplayToIR.ts`,
Screenplay→StoryFlowIR with speech-rate injection and schemaVersion routing) →
schema (`src/ir/schema.ts`, additive version union) → three compilers — visual
(`src/ir/visual/compile.ts`, I2V/T2V call plans), audio
(`src/ir/audio/compile.ts`, TTS word-level anchoring + mix plan), captions
(`src/captions/compile.ts`, SRT/VTT + ASS karaoke `\k`) — → XML interchange
(`src/ir/format/`, StoryFlowXML round-trip) → bridge (`src/bridge/`) → real
executors with budget gate (`src/exec/`, `checkBudgetGate`, multi-provider
pricing).

Status: the **compile/export face is zero-cost** and reachable in-app via
`components/IRPipelineModal.tsx` (compile, serialize, price preview, download
IR JSON / SRT / VTT / ASS — downloads, not project files). The **executors are
NOT wired to the UI main path**: production submissions still go through the
legacy Pro flow. Until that changes the skill stays 半成品 and declares no
P4 capabilities. Design docs: `docs/storyflow-ir-schema.md` +
`docs/storyflow-ir-p0..p14.md`.

## Cloud sync & consent (gallery-sync)

Outbox state machine (`services/syncEngine.ts`: local→synced→dirty→pushing,
conflict forks the cloud copy — nothing is lost) over `sync_outbox` /
`sync_{id}`; auth token pair in `gallery_auth` with single-flight refresh
(`services/apiClient.ts`); 4A SSO is opt-in — cookies are never adopted
silently (`services/auth4a.ts`, `sso_access_token` / `sso_logged_out`).
Consent layer (`services/cloudConsent.ts`): cloud sync consent
(`cloud_sync_consent`: unset/granted/denied) and pull policy
(`cloud_pull_policy`: ask/auto/never) gate every download; no consent, no
pull. Visibility is three-state (private/group/public). Mock backend for
tests: `gallery_mock_cloud`. The server itself is the private repo
`youyouhe/storyflow-gallery`.

## Desktop shell (desktop-shell)

Tauri 2 wrapper (`src-tauri/`): window/packaging in `tauri.conf.json`
(dev runs the Vite server on 5173). Credential tier `keyring` resolves to the
OS keyring via the Tauri plugin (`src-tauri/src/keyring_plugin.rs`, registered
in `main.rs`; frontend in `services/desktop.ts`) — real-hardware verification
of get/set/delete across restarts is still outstanding. CSP note:
`connect-src` is currently the permissive `'self' https: http:` (widened for
fal/ComfyUI testing); tightening it is a tracked debt, so new external hosts
work today but must be recorded.

## Planned skills (实验 — ids only, no code yet)

Gating rule (方案 D6): a planned skill is only implemented after real failure
cases + a human evaluation baseline exist. Do not start from this page alone.

- **brief-align** — pre-work requirement checklist + style-sample comparison;
  would land as `style.sfstyle.brief` + a `BriefChecklistModal` entry.
- **shot-breakdown** — read-only per-shot progress board over expressShots +
  h3_tasks + results; a new `BreakdownBoard` component, never a second state
  machine, never inside PromptPanel.
- **continuity-bible** — character physical-feature anchoring
  (`RefImage.features`) + sequence wardrobe/age injection into both prompt
  stacks; extends `ReferenceBindingPanel`.
- **prompt-compiler** — collapse the legacy triple prompt builders
  (`whiteModelPrompt` / `videoSegmentSubmit` / `videoPlan`) into the IR
  compiler, golden-diff tests first (方案 R3, option b); negative-prompt
  overrides in `style.sfstyle.promptOverrides`.
- **frame-qa** — video→frame extraction into the asset library (finally
  realizing the `video-frame` source enum), then a post-generate QA hook via
  a future `vision.check` P4 capability (方案 D4: inherits binding/credential
  policy). Vision QA additionally waits on the D6 evaluation baseline.
- **edit-repair** — trim in/out points, digital crop, sub-segment candidate
  reuse on top of the compositor (`ComposeExportModal` controls,
  `RunCandidate {fromSec,toSec}` additive).
