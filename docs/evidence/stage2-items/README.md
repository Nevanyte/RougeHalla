# Shared item observation and input boundary

Verified on `optimization_port`, based on `e6d46f30` plus this evidence's containing changes. This is the shared Rust
core, policy and headless stage of P-NET-ITEMS-1. Live item State, socket pickup/resume and Unity item UI remain open.

`PublicCommand` names a typed observer-local `PickupHandle`; trusted parity/replay commands retain private exact targets.
Each action-producing seat owns an `ItemObserver`. Only delivered observations advance offers; old handles remain bound
to their original target during 20 ticks of retired grace. Unknown, expired or hidden targets produce an ordinary
budgeted miss. Inventory is private to its owner; rows contain only permitted visible silhouettes, labels and one focus
hint. Same-tick departure clears the view. Observer identity is immutable.

Observation version is 4, policy contract 3, checkpoint `rh-checkpoint/5`, replay `rh-replay/3`. Sim-only restore starts
a new public observer epoch; previously accepted private commands replay independently of sampling cadence.

On Apple M5 Pro, macOS 26.6.1 arm64, Rust 1.97.0:

- Focused `cargo test -p rh-sim -p rh-policy -p rh-headless`: 157 passed.
- Integrated `cargo test --workspace --all-features` with PostgreSQL 16.15: 411 passed, 0 failed/filtered, 1 intentionally
  ignored heap measurement. Workspace/all-target/all-feature Clippy with warnings denied and formatting passed.
- Legacy parity: 20 compared scenarios and 300 paths MATCH; 15 additional scenarios remain capture-only.
- Independent review reproduced and verified fixes for collocated body hints, same-tick viewer removal, diverging seat
  identity, late async answers and swallowed worker panic. An additional reviewer harness compared 180 paired samples
  with no remaining differences; 11 targeted repository regressions were independently rerun.

Allocation regression: 512 visible body rows, all rows renewed on consecutive ticks, zero allocations over 61 measured
full replacements after warm-up. Retired target payload is bounded by 20 × 512 × 4 = 40,960 bytes; this excludes vector,
row and observer object overhead. A 513-row view fails atomically without consuming handles.

A local release probe used two headless seats (one external and one idle policy), 85 warm-up steps, then five batches of
200 `advance` plus reusable external observations. Each 1,000-step workload allocated zero times after warm-up:

| Visible body rows | Median nanoseconds per advance + observation |
| --- | --- |
| 0 | 98 |
| 32 | 762 |
| 128 | 3,769 |
| 512 | 16,630 |

These are current slice costs, not a before/after speedup, complete-match density, wire bandwidth or timing guarantees.
The steady-state allocation and privacy checks are reproducible in `rh-sim/src/item_view.rs`,
`rh-sim/tests/item_offer_alloc.rs`, `rh-headless/tests/item_offers.rs` and `rh-policy` unit tests. No cloud or production
service was changed.
