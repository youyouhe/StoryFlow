# Runs, frozen plans, results — explicit reuse

Read this when: generating anything paid, reusing earlier output, or
comparing variants (A/B).

## Frozen plan (the pre-pay gate)

Every paid request freezes into one read-only plan first (零外部请求):
each external call with its exact parameters and price (or an explicit
"费用未知 — 不猜价"), and each demand already satisfied by a Candidate
("由候选满足 · 不发请求"). Nothing submits until the human confirms.
Currencies never mix into one total.

Demand names (the logical outputs a run demands):
`video.<blockId>`, `video.<blockId>.<n>` (chain part), `image.<blockId>`.

## Candidates & satisfactions (`runs/*.sfrun`)

```json
{
  "format": "storyflow.run@1",
  "data": {
    "name": "variant-banana",
    "selection": { "kind": "all" },
    "candidates": [
      { "id": "kept-video-b1", "fromRun": "run_20260924T…_abc123", "output": "video.b1" },
      { "id": "approved-file", "file": "./approved-open.mp4" }
    ],
    "satisfactions": [
      { "output": "video.b1", "candidate": "kept-video-b1" }
    ]
  }
}
```

`satisfy` names the ONE candidate standing in for a demand. Missing or
malformed candidates warn and the request still happens (fail loud — never
silent skip). Reuse points at `(runId, output)` or a file; forwards copy
no bytes.

## Results repository

`.storyflow/results/<runId>/` — `result.json` (outputs + task receipts +
the frozen plan snapshot) and `files/` (the bytes). The address is exactly
`(runId, output)`. Completed outputs survive expiring signed URLs; a failed
run's completed sub-outputs stay inheritable through forwards.

Record in `PROGRESS.md` as you go: `runId` + output names + what each
carries. That is how a future session reuses instead of regenerating.

## A/B

Two run files with different satisfactions are the A/B mechanism — they
diff in git. Freeze each before spending; the plan preview proves only the
changed parts request (cost ≈ N × increment).
