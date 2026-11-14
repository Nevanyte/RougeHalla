# Hand-off: P-MAPGEN-GUARANTEES-1 (2026-11-14, implementer-opus)

```
PACKET:          P-MAPGEN-GUARANTEES-1 — serves the land-generation lane's architecture review of 2026-11-13, finding 4
                 (order (B), second packet after P-MAPGEN-LANDMARK-FRAME-1); before the Frost, Fire and Holy land rules
BRANCH:          agent/opus/P-MAPGEN-GUARANTEES-1 @ 2391eee0f (code) + this hand-off commit; stacked on
                 agent/opus/P-MAPGEN-LANDMARK-FRAME-1 @ 7e715bd57
GATE:            not run by the implementer (the lane's session runs the full gate)
CHANGED:         crates/rh-sim/src/mapgen/pipeline/mod.rs (end of attempt, Refusal, Pipeline field, with_guarantees
                 seam, inline guarantee_tests module), pipeline/README.md, pipeline/plague_pools.rs and
                 pipeline/plague_pools_tests.rs (emptied to a one-line module doc each, see RISKS),
                 landmarks/signature/mod.rs (intact loses the lake conjunct; doc), landmarks/signature/cave.rs (emptied
                 to a module doc), style_zones/guarantee.rs (doc only), style_rime/{guarantees.rs, README.md},
                 style_warren/{guarantees.rs, guarantees_tests.rs (new), mod.rs, README.md}
D-RULES:         D1: no legacy counterpart (DEV-020); option off untouched (the loop needs frames), option on byte- and
                 draw-identical: the same attempts are kept, only some discarded attempts' labels change. D2 n/a. No
                 tick, wire, save, state-hash or content-hash change (the lists are not in visit_content). D5/D6/D9 n/a.
DEVIATIONS:      none
SHARED RECORDS:  proposed edits: docs/DEVIATIONS.md DEV-034: "ENFORCED at the end of the attempt
                 (`pipeline/plague_pools.rs`, `Refusal::SignaturePools`: ...)" -> "(the Plague guarantees `pool-walks`
                 and `pool-wet`, `style_warren/guarantees.rs`, `Refusal::Guarantee { zone: Plague, .. }`: ...)".
                 style_gallows/README.md (signature-mode paragraph: "when the zone holds a signature `Church`") should
                 say the styler reads the zone's frame (`BaseContext::landmark`); outside this packet's write scope.
LEGACY DOUBTS:   none
NOT ESTABLISHED: the order cases (lake + pool, pool-walks + pool-wet) occur on no seed of 1-96; they are shown only
                 through the with_guarantees seam. No seed beyond 1-32 was checked for labels.
RISKS:           two files left holding only a module doc (owner approval needed to delete, per the no-delete rule):
                 crates/rh-sim/src/mapgen/pipeline/plague_pools.rs, crates/rh-sim/src/mapgen/pipeline/plague_pools_tests.rs
                 (their `pub mod plague_pools;` and `#[cfg(test)] mod plague_pools_tests;` lines stay, so the brief's
                 first rg check prints those two lines until they are deleted). crates/rh-sim/src/mapgen/landmarks/
                 signature/cave.rs also holds only a module doc (the brief allows keeping it; its `mod cave;` stays).
```

## What changed

- `style_rime::guarantees()` = [`"lake-at-mouth"`]: `cave::lake_at_mouth` moved verbatim except two inputs: the mouth
  is the frame's `anchor.entrance` (was the map's exported Frost anchor; equal by construction, `finish` exports each
  frame's anchor), and the reach is `signature::DEFAULT_DEFINITION.lake_reach + lake_slack` (was the pipeline's
  `SignatureContext` rules, built from that same definition). Its four unit tests moved with it, assertions unchanged;
  `ok(m)` now calls the registered check with a hand-built frame holding the map's anchor.
- `style_warren::guarantees()` = [`"pool-walks"`, `"pool-wet"`]: `pool-walks` is
  `walk_growth(m, Zone::Plague, styler bog) all <= POOLS.walk_detour`, `pool-wet` is `dry_pools(m).is_empty()`; the
  old `keeps` was exactly their conjunction. `is_styler_bog`, `dry_pools` and their helpers moved from
  `plague_pools.rs` with identical bodies. The seven hand-built-map tests moved to `style_warren/guarantees_tests.rs`,
  assertions unchanged: `walk_growth(&m)` -> `walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i))`,
  `keeps(&m, detour())` -> `holds(&m)` (both registered guarantees pass), `keeps(&m, 4)` ->
  `walks_within(&m, 4) && dry_pools(&m).is_empty()`.
- `SignatureContext::intact`: the last conjunct (`cave::lake_at_mouth`) removed; owned/door/apron/`aprons_apart`
  untouched and in the same order.
- Pipeline end of attempt: `if let Some(p) = &placed` around `finish` (frames kept); then, option on only:
  `intact || certifies` -> `SignatureDiscarded` (unchanged), then one loop over `p.frames` (placement order) and
  `(self.guarantees)(zone)` in list order; the first failing check -> `Refusal::Guarantee { zone, rule }`.
  `Refusal::SignaturePools`, `Pipeline.pool_detour`, `with_pool_detour` removed; new field
  `guarantees: fn(Zone) -> &'static [Guarantee]` (= `style_zones::guarantees`) and `#[cfg(test)] with_guarantees`.

Why the kept set cannot change: the pipeline always builds all four frames (`SignatureContext::apply` refuses unless
every reserved zone is placed), so an option-on attempt reaching the end runs the Plague and Frost lists; before, the
attempt was kept iff `intact_without_lake && lake && certifies && walks && wet`; now iff
`intact_without_lake && certifies && walks && wet && lake` (the lake check returns `true` without a `Cave` feature,
as before). The pins confirm it (below).

## Test results by target (debug, macOS arm64)

- `--test mapgen_guarantees`: 7 passed (the oracle; 7 red on the stub).
- `--lib -- guarantee`: 14 passed (4 lake unit tests in `style_rime::guarantees::tests`, 7 hand-built pool tests in
  `style_warren::guarantees_tests`, 3 pipeline seam tests in `pipeline::guarantee_tests`).
- `--test mapgen_land_plague` 26 passed (3 ignored); `--test mapgen_signature_blueprint` 10 passed (1 ignored; the
  option-on map pins and the Landmarks-phase pins unchanged, no re-pin); `--test mapgen_signature_fire` 11 passed;
  `--test mapgen_signature_frost_lake` 5 passed (1 ignored).
- Whole `cargo test -p rh-sim --features trusted-status-probes --no-fail-fast` (run once, at `5366c0172`): every
  target green (lib 1110 passed, 17 ignored; every `mapgen_*` target green, no pin moved) except `tests/content.rs`
  `every_const_in_the_source_tree_is_registered_or_explained`: the guarantee lists were local `const LIST` items and
  the scanner reads every upper-case `const`/`static`, local or not. Fixed in the next commit (the lists are promoted
  slice literals, also in the test lookups); `--test content` 21 passed, `--test mapgen_guarantees` 7 passed and
  `--lib -- guarantee` 14 passed re-run on the final tree. The rest of the suite was not re-run after that commit
  (the change is the lists' spelling only).
- `cargo test -p rh-mapdress`: every target green (3 + 10 + 10 + 11 + 19 + 7 + 16 + 1).
- `cargo test -p rh-server --test map_anchor_seeds`: 1 passed.
- `cargo fmt --all -- --check`: clean. `cargo clippy -p rh-sim --all-targets --features trusted-status-probes -- -D
  warnings`: clean.

The pipeline seam tests (brief section 7):
1. `the_pipeline_discards_a_finished_map_a_guarantee_refuses_and_never_errs`: seed 1 at its kept attempt, Plague
   `"pool-walks"` at detour -1 -> `Some(Guarantee { Plague, "pool-walks" })`, no map, last trace phase `Records`,
   `styled_attempt` = `Ok(None)`.
2. `option_off_maps_never_run_the_guarantees`: option off, `certified_styled` of seeds 1-2 unchanged under the strict
   pool list and under a list that fails in every zone.
3. `frames_run_in_placement_order_and_each_list_in_its_order`: Plague and Frost both failing -> Plague; every zone
   failing -> Fire; Frost [passes, fails, fails] -> the second.

## The brief's rg checks

```
$ rg -n 'SignaturePools|pool_detour|with_pool_detour|plague_pools' crates/rh-sim/src
crates/rh-sim/src/mapgen/pipeline/mod.rs:15:pub mod plague_pools;
crates/rh-sim/src/mapgen/pipeline/mod.rs:17:mod plague_pools_tests;
```
(the two module lines kept because the files may not be deleted without the owner; empty once they are)
```
$ rg -n 'lake_at_mouth|lake-at-mouth' crates/rh-sim/src/mapgen/landmarks
(nothing)
$ rg -n '"lake-at-mouth"' crates/rh-sim/src/mapgen/style_rime
  guarantees.rs:19 (the registration), :4, :24, :208 (docs and the unit tests' lookup), README.md:85
$ rg -n '"pool-walks"|"pool-wet"' crates/rh-sim/src/mapgen/style_warren
  guarantees.rs:26, :30 (the registration), docs in guarantees.rs, mod.rs, README.md, guarantees_tests.rs:1, :53
$ rg -n 'Refusal::Guarantee' crates/rh-sim/src/mapgen/pipeline/mod.rs
  741 (the one place it is produced); 1006, 1057, 1065, 1073 (assertions in guarantee_tests)
```

## Files left as doc-only modules

- `crates/rh-sim/src/mapgen/pipeline/plague_pools.rs`: "moved to `style_warren/guarantees.rs` ... and
  `style_zones::walk_growth`; this file awaits the owner's deletion". Delete it with its `pub mod` line.
- `crates/rh-sim/src/mapgen/pipeline/plague_pools_tests.rs`: same, pointing at `style_warren/guarantees_tests.rs` and
  `pipeline::guarantee_tests`. Delete it with its `#[cfg(test)] mod` line.
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.rs`: says the lake rule went to `style_rime/guarantees.rs`. The
  brief allows keeping it; deleting it (and `mod cave;`) is also fine.

## Departures from the brief, and where it was wrong

- Brief section 10 and the launcher say "functions, not `pub const` items"; in fact `tests/content.rs` rejects any
  upper-case `const` or `static`, private or local too. Hence promoted literals.

- The brief says delete `plague_pools.rs` and `plague_pools_tests.rs`; the launcher's rule (no deletion without the
  owner) overrides it, hence the doc-only files and the two rg lines above.
- The pipeline seam tests live in an inline `#[cfg(test)] mod guarantee_tests` in `pipeline/mod.rs` rather than a new
  file, because the brief's write scope lists `pipeline/mod.rs` but no new file under `pipeline/`.

## How to add a guarantee (Frost, Fire and Holy land-rule packets)

1. Write the check beside the styler, in `style_<zone>/guarantees.rs` (create it for Fire/Holy, `mod guarantees;` and
   `pub use guarantees::guarantees;` in the styler's `mod.rs`): a private `fn(&GameMapData, &LandmarkFrame) -> bool`,
   a pure read of the finished map (no draw); read the landmark from the frame, never rebuild it from features.
2. Register it in the styler's `guarantees()` list: a function returning a promoted literal `&[Guarantee { rule, check
   }, ...]`, with NO `const`/`static` item (`tests/content.rs` reads every upper-case one, even inside a function, as
   a tunable); a kebab-case `rule` name; list order is run order. For Fire/Holy, point the zone's arm of
   `style_zones::guarantees` at the new function instead of `&[]`. Walk rules can reuse `style_zones::walk_growth`.
3. Test it on doctored kept maps by calling `(g.check)(&map, frame)` from an integration test (see
   `tests/mapgen_guarantees.rs`), with hand-built maps in an in-crate test module; the pipeline's place is already
   covered (`pipeline::guarantee_tests`). A new rule changes which attempts are kept, so expect to re-pin maps
   (`tests/support/signature_pins.rs`), add the label to `pinned_labels` and the rule to
   `the_registry_lists_the_frost_and_plague_rules_and_nothing_else` in `tests/mapgen_guarantees.rs` (oracle work).
