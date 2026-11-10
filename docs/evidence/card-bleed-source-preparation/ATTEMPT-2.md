# Card bleed source attempt 2

**Result: semantic reachability guard failed after scenario execution.** This is the second and final capture attempt
authorized for this preparation. Attempt 1 remains unchanged in [ATTEMPT-1.md](ATTEMPT-1.md). No retry, guard
weakening, source edit, or capture-harness edit followed this run.

## Invocation

- Exact command: `bash tools/card-bleed-fixtures/capture.sh`
- Working directory: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`
- Frozen one-line import correction: `startRaid` now imports from the verified `packages/server/src/sim/step.ts` export.
- SHA-256 of `tools/card-bleed-fixtures/capture.mts` before the run: `d61572cb7084d8f56392ebf23b71700af9e1a3256888bef94911c26db2a64d8c`
- Mode: defaulted to `capture`
- Host `TMPDIR`: `/var/folders/f1/zlvpzngj3kbb95dxk8svy1y00000gn/T/`
- `RH_CARD_BLEED_DIRECTORY` and host `RH_CARD_BLEED_OUTPUT`: unset
- Container output variable: `RH_CARD_BLEED_OUTPUT=/out/source.json`
- Runtime container: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, `--platform linux/amd64`
- Exit code: `1`
- Output directory allocated by the script: `/var/folders/f1/zlvpzngj3kbb95dxk8svy1y00000gn/T/rh-card-bleed.SOrbCY`
- Directory was present after the attempt and empty; no `source.json` was written.

## Raw command output

```text
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: mixed-dot case reached card DoT
    at <anonymous> (/repo/tools/card-bleed-fixtures/capture.mts:104:1) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v22.23.4
```

## Diagnosis and limits

The import defect is corrected. The runner linked, built each declared case, and reached the final semantic guards. Guards
before the failure passed in-process: actual ordered/repeated card pairs, the first 500 ms source flush and empty later
interval, a natural early `runEnded` flush, post-teleport feedback from a partial report, and a partial report followed
by the source `startRaid` reset. The mixed full-profile Fire/Hemorrhage case then failed its first guard: it produced no
captured landed contribution matching `dot=true` with no ability and no signature. The subsequent non-card-DoT guard and
no-card control guard were therefore not evaluated.

No traces were serialized because the harness writes `source.json` only after every reachability guard passes. In-memory
scenario rows and per-case contribution/FX counts were lost when Node exited; do not infer a frozen corpus or claim
independent review from the earlier guards. Root should inspect the mixed-source producer/setup assumptions and authorize
any next change or capture. The failure does not establish whether the card producer was absent, a different source
classification applied, or the fixture setup missed the intended attack. No Rust, native privacy, wire, or full-game
claim follows.
