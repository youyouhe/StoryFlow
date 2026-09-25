# Review loop — done means watched

Read this when: checking an export, collecting feedback, or deciding
whether a deliverable is finished.

## The loop

1. **Composite export** (导出菜单 → 合成导出): captions/titles/stickers bake
   into the clip at ZERO generation cost — base footage optional. Caption
   windows ARE the word token windows (the audio/字幕 alignment identity),
   so karaoke hits land ≤1 frame by construction.
2. **Watch the export.** Not the render log — the video.
3. **Pin comments** at timestamps in the 审阅 panel (or write `FEEDBACK.json`
   directly): `{id, atSec, text, status: 'open'|'resolved', blockId?}`.
4. **Fix** — usually script/timing edits; changed blocks regenerate through
   the frozen-plan gate with unchanged outputs reused.
5. **Re-export, watch again, mark resolved.** Open comments = not done.

## FEEDBACK.json

```json
{
  "format": "storyflow.feedback@1",
  "comments": [
    { "id": "c1", "atSec": 3.2, "text": "字幕再低一点", "status": "open", "createdAt": 1758000000000 }
  ]
}
```

Timestamps are program seconds. The panel's list sorts by time and each
comment seeks the preview. Agents read this file as the authoritative
review state — the same notes the human wrote.

## Composite quality checklist

- caption karaoke highlights exactly at word boundaries (projected from the
  same token windows as speech timing)
- title legible, never covering faces at `placement`
- stickers appear only in their windows (with fades)
- audio (base footage) and caption timing agree — sample 10 words if unsure
- no generation spend happened to add any of the above

## Acceptance of a production

`BRIEF.md`'s definition of done + no open `FEEDBACK.json` comments + the
export watched end-to-end. Save the exported file's address (`runId` +
output name) into `PROGRESS.md` for the archive.
