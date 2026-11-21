# P-SYNC-ORIGIN-1-fix: tick_ms joins the silent-switch injectivity guard

Serves: reviewer-opus note 3 on P-SYNC-ORIGIN-1. Tier: Sonnet, test-only (no implementer). Reviewer: reviewer-opus.
D-rules: none touched (no behaviour change).

## What and why
`SimConfig` folds its live-only "silent" switches into the statics/state hash with distinct tags. P-TICK-1a added a
seventh, `tick_ms` (JSON null = 50 ms, 25 = 25 ms; hasher tag "tick_ms=25", `statics.rs`), which the injectivity test
(six switches, 64 combinations) and the `hash.rs` doc sentence did not cover. No collision exists; this restores the
guarantee.

## The test
`crates/rh-sim/tests/augment_rules.rs`: `every_combination_of_the_silent_config_switches_is_its_own_statics_identity`
now sweeps 7 switches, 128 combinations, all distinct state hashes; the all-default restore equals the base hash.
The base world is now at tick 0 (the earlier single `step()` is dropped), so `server_time` is 0, on both the 50 and
25 ms grids, and restore accepts either step. Doc line updated in `crates/rh-sim/src/hash.rs` (seven switches, 128).

## Scratch-collision proof
Temporarily set `TICK_MS_25_TAG` in `statics.rs` to "frost_wish=wall": the test fails with "`non-default: ["frost_wish"]`
and `non-default: ["tick_ms"]` share the statics digest". Reverted; `statics.rs` is unchanged.

## Oracle files
- crates/rh-sim/tests/augment_rules.rs (existing test extended; passes on the base, it is a guard)

Write scope: that file, `crates/rh-sim/src/hash.rs` (one doc sentence), this packet.
