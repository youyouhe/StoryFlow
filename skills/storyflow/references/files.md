# Project files — the production's source of truth

Read this when: locating or writing any StoryFlow project file.

A project is one directory (设置 → 项目目录). Plain text, git-friendly:

```
my-production/
  story.sfstory        content   — the screenplay (blocks + grayboxes + bindings + marks)
  style.sfstyle        style     — StyleHead visual DNA, color settings, prompt overrides
  runs/<name>.sfrun    intent    — one deliberate run: selection + candidates + satisfactions
  storyflow.runtime.json         — services: endpoints + credential SLOTS + capability bindings
  .storyflow/results/<runId>/    — result.json + files/ (durable outputs, task receipts)
  BRIEF.md             memory    — goal, audience, budget agreement, definition of done
  TREATMENT.md         memory    — the creative answer
  PROGRESS.md          memory    — where we are; the resume point (run ids, output names)
  FEEDBACK.json        memory    — review comments {id, atSec, text, status}
```

Every structured file is a JSON envelope `{ format, data }` with a stamped
format id (`storyflow.story@1`, `storyflow.run@1`, `storyflow.runtime@1`,
`storyflow.result@1`, `storyflow.feedback@1`). A different major format is
refused by name, never misread. Fields are added additively within `@1`.

- `story.sfstory` — `Screenplay`: `blocks[]` (id/type/content + graybox +
  `timing` overlays), `metadata`, `sequences`, `segmentGrayboxes`,
  `referenceBindings`, `marks` (Selections/Moments), `productionMode`
  (UX preference only — the pipeline branches on data, never on mode).
- `runs/<name>.sfrun` — `selection` (all | blockIds), `candidates[]`
  (build-records: `{id, fromRun, output}` or `{id, file}`), `satisfactions[]`
  (`{output, candidate}`). See `builds.md`.
- `storyflow.runtime.json` — `endpoints` (name → provider + config +
  `credential: {slot}`) and `bindings` (capability → endpoint). NEVER secrets.

`productionMode` remains a UI preference (简易/专业 badge). Implementation
branches on data presence (e.g. graybox nodes) — keep it that way.

Block ids (`b1`, `auto-scene-…`) are REUSE KEYS: variant runs and
candidates address outputs by block id. Never renumber them.
