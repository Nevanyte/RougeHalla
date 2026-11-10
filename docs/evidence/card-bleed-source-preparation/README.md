# Card bleed source candidate

## Corrected candidate

The corrected, still-unadmitted source candidate is [source.json](../../../parity/card-bleed-feedback/source.json): 7 cases,
390 ordinary fixed 50 ms steps, 410,111 bytes, SHA-256
`6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`. Its trace schema is
`rh-card-bleed-source/2`, distinguishing raw landed snapshots from processed rows. It is captured from unchanged TypeScript producer
source at worktree HEAD `35af2230dcc0791dff50c080f0d27cacf447bad5`; all 133 source input hashes are unchanged. Exact
commands, hashes, per-case counts, logs, and prior identity are recorded in [FINAL-MANIFEST.json](FINAL-MANIFEST.json).

Each step stores both `landedSnapshot` (raw post-step combat scratch) and `processedLanded` (scratch only when the actual
active pass ran). `activePassEligible` is recorded from **pre-dispatch** phase and the source `arena.voided` early-return
guard. This preserves the real active tick that ends the run. In `run-ended-before-periodic-window`, tick 7 at 350 ms
begins active, runs the producer pass, ends the run, and contributes five bleed hits totaling the emitted
`1.1180044891585073`. Tick 8 at 400 ms begins ended: its raw snapshot still contains one retained hit, but its
`processedLanded` is empty and it adds no fresh contribution. The prior sealed candidate's six-row derived count is
incorrect and must not be treated as six processed damage contributions. Its exact bytes and controls are retained at
`held-candidate-10519519/` under this evidence directory.

The mixed producer case is named `card-dot-excludes-fire-burn-and-backlash` and reaches actual Fire `burn` and
`backlash` signatures alongside card DoT. It reaches no ability-tagged landed hit; no ability-exclusion coverage is
claimed. The other cases preserve grouping/insertion order, first-use 500 ms cadence and empty intervals, natural
run-end flush, teleport retention, raid reset, and a no-card control.

## Source controls and reproduction

The updated [controls.json](../../../parity/card-bleed-feedback/controls.json) passed three semantic KILLs: one-row-per-
contribution instead of grouped FX, strict `>500 ms` instead of the source `>=500 ms`, and skipping run-ended flush.
The comment-only mutation is NONKILL. Restored-source recapture reproduced the complete corrected corpus; the original
source and canonical candidate were read-only during mutant runs. A fresh byte check also passed after the controls.
Raw outputs are retained in `logs/`; earlier failed harness attempts and the independent hold finding remain preserved.

From `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`:

```sh
bash tools/card-bleed-fixtures/capture.sh
bash tools/card-bleed-fixtures/run-mutants.sh --write
bash tools/card-bleed-fixtures/capture.sh --check
```

The capture first wrote into the unique temporary output directory recorded in the manifest, then those exact bytes were
copied into the candidate path. All three scripts pin Docker image
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, Linux amd64,
and run `npm ci --ignore-scripts --no-audit --no-fund` inside the container.

## Limits

This candidate records legacy raw aggregate feedback. The source has no historical viewer audiences. It is not native
ADR0013 contribution-tick privacy, viewer entitlement, public-wire parity, or Rust parity proof. Keep the native privacy
extension separate. `startRaid` is called through the actual lifecycle producer at a declared reset boundary; it is not
an ordinary gameplay action. The 500 ms threshold is observed at 50 ms step boundaries; the strict-threshold mutant
therefore flushes at 550 ms. No source, Rust, client, or shared status file was edited, and no commit was created by this
worker. Root coordinates freezing and independent review.
