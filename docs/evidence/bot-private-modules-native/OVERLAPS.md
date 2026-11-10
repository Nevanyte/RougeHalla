# Unchanged overlap filters (exact, no edited expectations)

The shared engines changed only through the Root-leased seams. Every old public behavior/fixture remains green with its
original expectations and original corpus files; no old test, golden, fixture or parity file was edited
(`git status` for `parity/`, `tools/`, `testing/` is empty). Filters below are exact real filters run on the final tree
(Rust 1.97.0, locked/offline, `-j1`); overlapping filters are listed separately and **not summed as extra cases**.

## Affected shared engines (leased seams)

| Filter | Result | What it pins |
|---|---|---|
| `bots::planning_parity_tests::` | 6 passed / 0 failed | unchanged `bot-planning.json` capture + helpers + mutants; new shared plan core reproduces old `PlanModule` value-for-value |
| `bots::wish_parity_tests::` | 6 passed / 0 failed | unchanged `bot-wish.json`; one shared cast policy reproduces old `decide_cast` for every captured row/tag list |
| `bots::wish_module_tests::` | 8 passed / 0 failed | unchanged public `WishModule` behavior (availability/retry/slip legacy adapter) |
| `bots::hazards::tests` | 4 passed / 0 failed | unchanged public `Hazards`/Observation wrapper: 28 steps / 20 adjusts / 75 classifications of unchanged `bot-hazards.json` |
| `bots::bot::` | 17 passed / 0 failed | bot-core hand/cadence compatibility (hand feature gate untouched) |
| `bots::temporal_percept::memory::source_tests::` | 13 passed / 0 failed | admitted private Memory source parity (real histories used by the module replay) |
| `bots::temporal_percept::strategy::source_tests::` | 11 passed / 0 failed | admitted private strategy source parity through the exposed `pub(super) mod types` (only visibility changed) |

## Remaining admitted bot/parity leaf filters

| Filter | Result |
|---|---|
| `bots::parity_tests::` | 31 passed / 0 failed |
| `bots::knowledge_parity_tests::` | 4 passed / 0 failed |
| `bots::paths_parity_tests::` | 1 passed / 0 failed |
| `bots::view_parity_tests::` | 4 passed / 0 failed |
| `bots::mob_hunt_parity_tests::` | 5 passed / 0 failed |
| `bots::knowledge_repair_tests::` | 3 passed / 0 failed |

## New packet-owner test groups (not overlap, listed for completeness)

| Filter | Result |
|---|---|
| `modules::catalog_tests::` (frozen source catalog vs admitted sim/ability/rule tables) | 4 passed / 0 failed |
| `modules::planning_core_tests::` (planning bridge witnesses) | 5 passed / 0 failed |
| `modules::source_input::` (strict typed corpus reader) | 5 passed / 0 failed |
| `modules::source_trace::` (encoders/comparators/transcript) | 25 passed / 0 failed |
| `modules::controls_tests::` (24 intake negatives + 28 semantic controls) | 28 passed / 0 failed |
| `send_assertions::` (Registry/CustomModule/4 built-in state types are `Send`) | 1 passed / 0 failed |
| `modules::source_tests::` (frozen replay) | 1 passed / 0 failed |
| owner-module witnesses (`choice::` 8, `chest_hunt::` 7, `chests::` 6, `wishes` 16, `wish::source_core` 12, `hazards` module/core 11) | included in the whole-suite count |

## Whole crate (rh-policy) final state

```
cargo test -p rh-policy --lib --locked --offline -j1
=> test result: ok. 354 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out (finished in 280.92s)
```

Tactics: the separately active Tactics lane is not imported/edited here; only the pre-existing admitted
strategy/tactics-compatible type surface (`strategy::types` visibility line) is reused. No `parity/policy/
bot-private-tactics/source.json` or tactic source was read/modified in this packet.
