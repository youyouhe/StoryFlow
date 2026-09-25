# Variant mass-production — 1 workflow, 100 variants

Read this when: producing N versions of a finished workflow (换角色 / 换
产品 / 换语言) without regenerating everything.

## Mechanism

Variants are text substitutions over the base screenplay with **stable block
ids** (`utils/variants.ts` — `applyVariant`). Stable ids are what make
explicit reuse work: unchanged blocks keep byte-identical content, so their
outputs are satisfied from a shared run and only changed blocks regenerate.

1. Produce the base once. Record its outputs in `PROGRESS.md`
   (`runId` + `video.<blockId>` names) — these are the shared outputs.
2. For each variant, write `runs/<name>.sfrun` with `build-record` +
   `satisfy` edges for every UNCHANGED output (`buildVariantRun` does this).
3. Substitute the text (host name, product, language) — keep block ids.
4. Freeze each variant's plan before sending. The preview proves the claim:
   unchanged rows show "由候选满足 · 不发请求", changed rows are the only
   requests, cost ≈ N × increment.

## Worked shape

```ts
const variant = applyVariant(base, {
  name: 'swap-host-banana',
  substitutions: [{ from: 'Ada', to: 'Banana Cat' }, { from: 'ProductX', to: 'CheatGPT' }],
});
const run = buildVariantRun({
  name: 'swap-host-banana',
  shared: unchangedOutputs.map(o => ({ name: `video.${o}`, fromRun: 'run_shared' })),
});
```

A/B halves of a campaign are just two of these run files (they diff in git).

## Budgeting

The frozen plan is the budget proof: sum of the changed rows × N, with
unknown prices reported as unknown (never guessed). Put the figure in
`BRIEF.md` before the human confirms anything.
