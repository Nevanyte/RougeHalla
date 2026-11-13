# P-MECHANICS-SALVAGE-3-fix: the overhead build marks read the camp-clear mirror

- **Serves:** P-MECHANICS-SALVAGE-3 review note 1 (reviewer-opus, 2026-11-12), the one reader that packet could not
  reach inside its scope
- **Implementer tier:** implementer-opus (rh-sim observation path)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework at or after `1fa56f47`; serial with any packet touching `observe.rs`
- **D-rules touched:** D1 loose proof · no wire change expected (the marks' values change only in worlds without the
  Bruiser installer; say if an observation golden moves)

## 1. ID and outcome
Since P-MECHANICS-SALVAGE-3 the HUD summary, champion panel and kill Trophy read camp clears through
`bruiser::camp_clears` (legacy's `me.campClears` mirror, written only by `bruiserPassives.ts:68,108`). One reader was
left: `kill_augments::build_marks` (the overhead marks in observations) still counts the canonical clears in worlds
without the installer. Routing it needs the match statics at `crates/rh-sim/src/observe.rs:1026` and `:1092` through
`BuildMarkCache::of`; routing only the cache refresh trips the cache's `debug_assert` against a direct computation.
When this lands the build marks read the mirror, as the other three readers do.

## 2. Dependencies
- P-MECHANICS-SALVAGE-3 merged (it is).

## 5. Exclusive write scope
- `crates/rh-sim/src/kill_augments.rs` (`build_marks`, `BuildMarkCache`), `crates/rh-sim/src/observe.rs` (the two
  call sites only)

## 7. Behaviour to preserve
- Worlds with the installer (the live profiles, practice): marks unchanged. Parity all MATCH. No allocation added to
  the observation path (`no_alloc` suites).

## 8. Acceptance checks
- One test beside `systems/mechanics_salvage3_readers_tests.rs`: without the installer a Holy player with canonical
  clears shows no camp-leech mark; with it the mark is as today.
- `scripts/gate.sh --quick --oracle packet/P-MECHANICS-SALVAGE-3-fix` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MECHANICS-SALVAGE-3-fix`

## 10. Risk and suggested model tier
Opus: `observe.rs` is the shared observation path.

## Notes from previous attempts
