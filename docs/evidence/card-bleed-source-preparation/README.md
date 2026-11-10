# Card bleed source capture

This is a reviewable **legacy source candidate**, not an admitted Rust parity fixture. It was captured from the
unchanged TypeScript source at worktree HEAD `35af2230dcc0791dff50c080f0d27cacf447bad5`; source and harness input
hashes are recorded in [FINAL-MANIFEST.json](FINAL-MANIFEST.json). The prior import/producer/guard failures remain
preserved in [ATTEMPT-1](ATTEMPT-1.md), [ATTEMPT-2](ATTEMPT-2.md), [ATTEMPT-4](ATTEMPT-4.md), and
`attempt-diagnostics/`.

## Captured candidate

The candidate is [source.json](../../../parity/card-bleed-feedback/source.json) (7 cases, 390 ordinary fixed
50 ms steps, 289,141 bytes, SHA-256
`6bd92fff24f2825d708962e24d971adcc0161e271777a8c4bc35681254865af5`). It contains ordinary source-produced
contributions and FX for ordered distinct/repeated `(victim, source)` pairs, first-use/500 ms grouping and empty
intervals, natural run end before the periodic window, teleport retention, `startRaid` reset, card versus Fire
signature/ability DoT classification, and a no-card control. The cases declare loadout/setup but queue attack/release
inputs and advance the real `World.step` producer; they do not install pending report state or call `flushBleeds`.

The case summaries and exact receipt/log hashes are in [FINAL-MANIFEST.json](FINAL-MANIFEST.json). A final fresh
read-only check passed with the same byte count and SHA. The retained controls at
[controls.json](../../../parity/card-bleed-feedback/controls.json) report three semantic KILLs: per-contribution
instead of grouped FX, `>500` instead of `>=500`, and skipping run-ended flush. The comment-only mutation is NONKILL;
restored-source full corpus recapture and canonical input immutability both passed. Mutants ran only in a disposable
container copy. Raw logs, including the four failed attempts, are retained under `logs/` and `attempt-diagnostics/`.

## Reproduction commands

From `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`:

```sh
bash tools/card-bleed-fixtures/capture.sh
bash tools/card-bleed-fixtures/run-mutants.sh --write
bash tools/card-bleed-fixtures/capture.sh --check
```

The source capture command wrote first to a unique temporary output directory recorded in `FINAL-MANIFEST.json`, then
the identical bytes were copied into the new candidate path `parity/card-bleed-feedback/source.json`. The final
`--check` reads that candidate through a read-only mount. The harness pins Docker image
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, Linux amd64,
and uses `npm ci --ignore-scripts --no-audit --no-fund` inside the container. It does not edit package source,
dependencies, or lockfiles.

## Scope and limits

The capture preserves the legacy raw `FxChannel` aggregate, which has no historical viewer audiences. It does not prove
native ADR0013 contribution-tick privacy, viewer entitlement, public-wire parity, or behavior in the Rust server. Keep
the native privacy extension separate. `startRaid` is invoked through the real exported lifecycle producer at the
declared raid-reset boundary; that reset control is not itself an ordinary gameplay action. Exact 500 ms timing is
observed on a 50 ms simulation clock, so the strict-threshold mutation is detected at the next tick (550 ms).

Root should independently review this source candidate and choose whether/how to admit it. No canonical parity fixture
was overwritten, no Rust or client edits were made, and no commit was created by this worker.
