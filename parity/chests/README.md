# Chest runtime source witness (P-CARDS-2)

Actual-source corpus for the chest drop/choose chain, captured from the unmodified legacy source in the pinned
linux/amd64 Node 22.23.4 container (`node:22.23.4-bookworm-slim@sha256:aaa4b5...`) by `tools/chest-fixtures/capture.mts`.
The recorder adds only passive `world.hooks` observers (`rewardOffered`/`rewardChosen`) and declared setup
(initial placements, card grants, crate/chest picks, the skip's `place`); every expected value is written by the source.

- `runtime.json` — `rh-chest-runtime-source/1`, 5 cases, 75,602 bytes, SHA256
  `6ec217d3b71da6d8ad2a0eff22bbe8ebd8f8b73be11f9823a78965117c85eeb8`.
  Cases: `card-pick`, `card-pick-held` (both camp contributors hold the same interactive augment, so the source pool
  excludes it — the eligible-picker wiring is observable), `skip-gv` (full health, the heal is wasted and pays GV),
  `skip-heal` (out of combat and hurt, the skip heals and pays no GV), and `stat-boost` (the actual first opening of
  the source-picked stat crate drops its three distinct boosts and the real `choose` picks one).
- Declared maps: `tools/mob-runtime-fixtures/declared-map-input.json` (camp scenarios) and
  `parity/initial-loot/input-map.json` (the stat-crate scenario), both hash-pinned in the corpus provenance.
- Checkout: `bash tools/chest-fixtures/capture.sh --check` re-runs the capture in the pinned container and requires the
  checked-in bytes to be identical.

The native consumer is `crates/rh-sim/src/reward_chests/chest_runtime_tests.rs`; the committed mutant controls live in
`tools/chest-fixtures/mutants/` with `run-mutants.sh`. Evidence and scope: [docs/evidence/stage2-cards-2](../../docs/evidence/stage2-cards-2/README.md).
