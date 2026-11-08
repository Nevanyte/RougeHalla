# Brain path-service / away-point source witness (P-BOTS-3)

Actual-source capture of brain/services.ts (the room path budget, cache, stale answer and prune) and brain/tactics/kite.ts
awayPoint, from the unmodified legacy code in the pinned node:22.23.4-bookworm-slim linux/amd64 container.

- Corpus: parity/policy/bot-tactics.json
- Native comparison: crates/rh-policy/src/bots/paths_parity_tests.rs
- bash tools/brain-tactics-fixtures/capture.sh          # capture
- bash tools/brain-tactics-fixtures/capture.sh --check  # byte-for-byte check

The corpus holds the declared 24x24 map, the budget size, the complete source-closure hashes, and 87 replayed steps: frames
(budget start + setFrame), cached and stale-looking walks, paths, sight/clear queries, an over-budget straight-line fallback,
invalid/unreachable inputs, and awayPoint cases including map walls (the shortened headings). Service counters and budget
left are recorded after every step.
Mutants: tools/brain-tactics-fixtures/run-mutants.sh, 3/3 killed with the unchanged control passing (cache window, straight
factor, the shortened step length). Recapture only in the pinned container.
