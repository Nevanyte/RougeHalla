# Quest data source witness (P-QUEST-1)

Actual-source corpus for the K1 quest **data layer** (catalog rows, reward rules, roster selection, map placement and
wording), captured from the unmodified legacy source in the pinned linux/amd64 Node 22.23.4 container
(`node:22.23.4-bookworm-slim@sha256:aaa4b5...`) by `tools/quest-fixtures/capture.mts`.

- `data.json` — `rh-quest-data-source/1`, 79,403 bytes, SHA256
  `c01c045f9ddac21cbe95244c21d9b8d9332db7b2d793ac85df8767b2a6297e03`.
  Cases: `catalog` (all 20 rows plus tier points, parity GV, tier, base, fed/unfed reward card, copies, stat payout and
  reward text), `rosters` (three declared quest salts), `placements` (real generated maps for seeds 1 and 2 × the three
  salts: candidate count/fold, home component, and every placement with its tokens/parcel), and `phrases` (the five
  refusals and the accept wording for every offer).
- Maps are pinned by seed + attempt + `mapHashU32` (the source generation path, `decor: false`); the native test
  regenerates the same map through the ported generator and requires the same hash before comparing placement.
- Checkout: `bash tools/quest-fixtures/capture.sh --check` re-runs the capture in the pinned container and requires the
  checked-in bytes to be identical.
- The native consumer is `crates/rh-sim/src/quests/tests.rs`; the committed mutant controls live in
  `tools/quest-fixtures/mutants/` with `run-mutants.sh`.
- Evidence and scope: [docs/evidence/stage2-quest-1](../../docs/evidence/stage2-quest-1/README.md).
