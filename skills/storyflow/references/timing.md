# Word-level timing — anchors, marks, 校时

Read this when: changing when things happen, binding effects to words, or
fixing caption timing.

Time is anchored to WORDS; seconds are derived. The tokenizer splits blocks
into display/spoken tokens (Latin words, CJK per character, Dual Text
`<BCC | B C C>` = one token with different display/spoken surfaces). Every
edit re-projects windows — reflow is automatic: captions, generation windows
and white-model shot lengths re-arrange without anyone dragging a timeline.

Time sources per block, highest wins:

1. **manual 校时** — author-written token windows (`block.timing`,
   `source: 'manual'`). Re-alignment never clobbers these.
2. **aligned** — audio word timestamps (ASR via the bound endpoint, or
   imported ASR JSON). Low-confidence words get flagged (<0.6).
3. **estimate** — deterministic speech estimation (CJK ≈0.2s/char, Latin by
   syllables). Always available, offline-safe.
4. authored beat prefixes (`00:00-00:03` on ACTION) remain envelope
   authority at the beat level; words distribute inside.

The TimingStrip (每块的 teal 芯片 → timing 页) shows word chips with width ∝
duration, colored by source, with pin markers for marks. Click a word to
校时 it; click-to-jump selects it in the editor.

## Selections & Moments (marks)

Named semantic ranges/points that bind effects to words — never to seconds.
Select text in the editor → the mark bar creates a Selection (range) or
Moment (point). Marks store `(blockId, tokenGap)` refs and clamp when the
text changes. They live in `story.sfstory` → `marks`.

Consumers (`during={selection}` / `at={moment}` semantics) project marks to
seconds at use time — changing the words moves everything downstream.

## What to edit where

| Goal | Edit |
|---|---|
| move a caption hit precisely | 校时 that word (TimingStrip) |
| bind a sticker/title to a beat | create a Moment, reference it |
| fix ASR mistakes | 校时 (manual wins) or re-align from better audio |
| change spoken vs displayed text | Dual Text `<shown | spoken>` |
