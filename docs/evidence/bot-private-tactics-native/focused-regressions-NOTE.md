# Note on `focused-regressions.log` (honest coverage accounting)

`focused-regressions.log` is the raw pre-repair receipt of targeted `cargo test --lib <filter>` invocations used to count
specific unchanged-component areas. Some filters selected **zero tests** in this crate's naming scheme
(`bots::orbwalk::`, `bots::humanizer::`, `bots::paths::`, `bots::knowledge::`, `bots::mob_hunt::` printed `running 0
tests`). A zero-selection filter is *not* a passing regression test and must not be counted as coverage; those receipts are
retained only as command evidence.

The authoritative coverage receipt is the full library run:
- pre-repair, production-identical tree: `full-regression-final.log` — 236 passed / 0 failed (246.84 s);
- post-HOLD-repair current tree: `repair-full-regression.log` — the same production code plus the repaired test-only
  harness controls (the two new comparator controls are exercised there and in `repair-private-tactics.log`).

Areas that did select tests in `focused-regressions.log`: `bots::fight::` 8, `bots::reflex::` 5,
`bots::world_tactics::` 2, `bots::parity_tests::` 5, Memory source tests 13, Strategy source tests 11,
temporal-percept frames 14 — all green at that cut, and all included in the full runs above.
