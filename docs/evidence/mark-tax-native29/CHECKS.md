# Focused commands and evidence

All Cargo ran from the private worktree, using pinned `final-env.sh`, exclusive `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-target`, jobs1/debug0/incremental0, `--locked`, and an own absolute `RH_PGTEST_STATE`. No Postgres server, capture process, Editor, cloud or live service was started. No dependencies were installed.

Final source selectors:

```
cargo test -p rh-sim --lib mark_tax --features trusted-status-probes --locked
cargo test -p rh-sim --lib plague_corpses --features trusted-status-probes --locked
cargo test -p rh-sim --lib mark_tax_warm_alloc --features trusted-status-probes --locked -- --ignored --test-threads=1
cargo test -p rh-sim --lib corpse_auto_warm_alloc --features trusted-status-probes --locked -- --ignored --test-threads=1
cargo clippy -p rh-sim -p rh-parity --all-targets --all-features --locked -- -D warnings
cargo clippy -p rh-sim -p rh-parity --all-targets --locked -- -D warnings
cargo fmt -p rh-sim -p rh-parity --check
```

`logs/sealed-*` are final capacity-owner receipts: MarkTax14pass/1ignored; whole-step720 zero allocations; corpse component360 zero allocations; both lint modes and fmt. `logs/final-restored-corpse.log`: corpse4pass/1ignored. `logs/corpse-mutant-summary.log` and `mutants.json` / `corpse-mutants.json`:9 actual assertion kills total, source expected bytes unchanged. `logs/final-restored-*` prove restored production bytes after those mutations. Final preparation-only refinement removed redundant total-fighter next-bank reservation; final warm assertions prove sparse prepare is sufficient.

Earlier affected-scope gates (before two additional MarkTax tests, no outcome refresh): `sentenced-focused.log`72pass/4ignored; `slow-starter-focused.log`6pass/1ignored including7 actual source cases; `training-focused.log`14pass; `schedule-focused.log`14pass. Do not sum overlapping selections or present them as a full workspace result. All source124 frames compare at actual8 per-tick phase boundaries plus completed frames with complete ordered events and actual main-RNG state/draw bits.

First lint attempt found test-only filter_map_bool_then. It was rewritten as filter+map, no allow/suppression. All earlier compile/comparator/fixture-context/producer/allocation failures remain under `logs/`; green receipts do not replace them. Old28/22 tapes/content goldens remain known predecessors, owned by Root, not refreshed or weakened here.

Five-source callback audit: shred reads existing status rows and ignored the former StatView; attackSlow reads the same old `stats.slow_resist`; consumable/wind forwards the exact former StatView to unchanged wind helper; FireRoam and FrozenJustice ignore this third argument and read their existing clocks/status/guard facts. None now receives newly folded maxHP/stat facts. Only tax consumes the explicit AS-row context; `note_fights` remains first in live end mods after the paid ledger.

Raw Cargo receipts include terminal blank lines. The evidence-local `.gitattributes` disables only blank-at-EOF whitespace complaints for `logs/*.log`; it does not ignore files or relax any test. Raw bytes/hashes are retained unchanged.
