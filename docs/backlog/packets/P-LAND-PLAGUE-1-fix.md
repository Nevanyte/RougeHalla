# P-LAND-PLAGUE-1-fix: no Plague bog pool ever lengthens a spawn's walk to the coliseum, on any seed

- **Serves:** reviewer-opus notes on P-LAND-PLAGUE-1 (LAND WITH NOTES), and the owner's hard guarantee that pools keep
  off spawn routes (`docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 1, "guarantees are hard", and section
  3 "Plague"), found broken out of sample by the land-generation lane's coordinator (2026-11-13).
- **Implementer tier:** implementer-opus (rh-sim mapgen, signature-mode Plague styler; draw order)
- **Reviewer:** reviewer-opus
- **Integration base:** stacked on `agent/opus/P-LAND-PLAGUE-1` @ `fe50d4009` (reviewed, gate-green; base
  `feature/unity-rework` @ `2e51457dd`). The `stub:` commit `54869394c` holds the wording of review notes 1 and 2. The
  two merge together.
- **D-rules touched:** D1: option off byte-identical (G8); option on is already an intentional difference from legacy
  (P-LAND-PLAGUE-1's proposed row), no new one · D2 n/a · no sim tick, wire, save, state-hash or content-hash change

## 1. ID and outcome
P-LAND-PLAGUE-1 was tuned and tested on seeds 1-32. On seeds 33-96 one hard guarantee fails: on seed 75 a pool lies
across the shortest walk of one Plague spawn to the coliseum, and avoiding the bog lengthens that walk by 3 steps
(`walk_detour_max()` is 2). The pools keep off the route guard's corridor (`style_warren/pools.rs:270-274`), which is
string-pulled and narrow, so a 4-connected shortest walk can still cross a pool. Nothing stops that today.

**When this lands:** no served map has a pool that lengthens a Plague spawn's walk to the coliseum by more than
`walk_detour_max` steps, on any seed, and this holds **by construction**. Either the pool layer checks the walk
when it lays or merges a pool and does not lay it there, or the attempt is discarded. It is never a generation error:
a styler `Err` fails the whole `certified_styled` call, not one attempt (see section 11, first trap, for why the
discard route is not open to this write scope). The other hard guarantees hold on seeds 33-96 as on 1-32, and stay so.

Review notes on P-LAND-PLAGUE-1:
- **Notes 1 and 2: done** in the stub commit `54869394c` (wording only). The registry row and the `SIGNATURE_KINDS`
  doc now count eight signature-mode kinds (seven landmark kinds and the Plague styler's `BogPool`). `model.rs`,
  `rules.rs`, `pools.rs` and the README now say that a merged body of bog holds several `BogPool` features. Comments
  and text only.
- **Note 3: answered by measurement**, with no code change. The ring test (no ring tile owned, walled, given terrain
  or outside the zone, none in a camp halo) passes on seeds 33-96 as on 1-32: `wide_every_pool_has_a_two_tile_ring_of_plain_floor_in_the_zone_off_camp_halos`
  is green on `54869394c`, and stays green as a gate check.

## 2. Dependencies
- `agent/opus/P-LAND-PLAGUE-1` @ `fe50d4009` (under this branch).
- P-MAPGEN-SIG-SCALE-3 (the 29-tile bog tree) will move every option-on map. Every check is a property over a range of
  seeds. No test names seed 75 or pins a map, hash, attempt or tile, so a different seed may break the walk after
  SCALE-3. The fix must therefore be the construction rule, not a tuning that happens to clear seed 75.

## 3. Relevant legacy paths (verified with `rg`)
- none for the pools (signature mode only; legacy has no bog tree and no pools). Legacy's barrow crescents
  (`packages/shared/src/zoneStyle/warren.ts:197` `bogAt`, `:306` `crescentOf`) keep off the guard corridor only, the
  same rule the pools use today. Option off keeps them byte for byte.

## 4. New paths
- none (the oracle file and this brief already exist; see "Oracle files")

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_warren/**` (the signature-mode path: `pools.rs`, and `shape.rs` only for the call
  site; option-off code must not move).
- `crates/rh-mapdress/tests/anchor.rs` `NO_ANCHOR_GOLDEN` and `crates/rh-mapdress/tests/marsh.rs` `SIG_GOLDEN`, only if
  option-on maps of seeds 1-4 move: measured as their comments say (run the test, take the value the failed assertion
  prints), constants only, in one last separate commit whose message starts `P-LAND-PLAGUE-1-fix re-pin:`, with old
  and new values listed in the hand-off.
- Not yours: `mapgen/pipeline/`, `mapgen/style_runtime/`, `mapgen/certify/`, `mapgen/landmarks/`, `mapgen/spawns/`,
  `mapgen/coliseum.rs`, the coordinator's `tests/mapgen_signature_*.rs` (report the values that move; do not edit).
  If the styler cannot do the check with what it sees (section 11), stop and report exactly what is missing. Do not
  widen the scope.

## 6. Contracts and references
- ADR 0028 G1 (a guarantee is kept or the map is not made), G5 (a signature map is kept only whole and certified
  clean, `pipeline/mod.rs:674-677`), G8 (option off byte-identical).
- `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 1 (guarantees are hard, numbers are targets).
- `docs/backlog/packets/P-LAND-PLAGUE-1.md` (sections 7, 8 and 11 still apply in full).
- `crates/rh-sim/AGENTS.md` (determinism; draws are behaviour).

## 7. Behaviour to preserve
- **Option off: byte-identical**, draw for draw (guards: `mapgen_signature_core.rs`
  `g8_signature_off_is_todays_generator`, `mapgen_signature_fire.rs`/`_frost.rs` `g8_option_off_maps_are_todays`,
  `style_warren/tests.rs` `captured_callbacks_match_complete_plans_states_and_streams`, the oracle's
  `option_off_maps_are_todays`).
- **Every existing Plague test** on seeds 1-32, with the same names and bounds (the oracle keeps them unchanged; their
  bodies moved into helper functions shared with the wide tests).
- **The first review's findings on determinism.** Pools draw only from the styler's shape stream, nine draws per pool
  slot (`pools.rs:467-475` `recipe`), in laying order. The walk check must not add, remove or reorder draws on maps
  where no pool or merge is rejected by it, so those maps stay byte-identical. Where a rejection changes what is
  laid, the draws that follow move; say so in the hand-off, list which seeds of 1-32 and 33-96 moved, and re-pin the
  `rh-mapdress` goldens only if seeds 1-4 moved.
- The bog budget, the barrow share, size by band and all three sizes on seeds 1-32 keep passing (tests 4, 5, 8, 9).
  Do not retune to the wide block: the budget's out-of-sample figure is the owner's question (section 11).
- Worst accepted attempt on seeds 1-32 at most 8 (today 1); on 33-96 it is 5 today: report it.

## 8. Acceptance checks
Oracle `crates/rh-sim/tests/mapgen_land_plague.rs`, option on, the server's options (no decor). The map sets
`maps()` (seeds 1-32) and `wide_maps()` (seeds 33-96) are each generated once per test binary. Measured on
`54869394c`, debug build, macOS arm64.

| Test | Seeds | Today |
|---|---|---|
| the 14 tests of P-LAND-PLAGUE-1 (names and bounds unchanged) | 1-32 | PASS |
| `wide_pools_keep_off_spawn_walks_spawn_pads_and_camp_halos` | 33-96 | **FAIL** on its assertion: `pools on routes or clearings, seeds 33-96: 1 findings` / `seed 75: the walks of the Plague spawns to the coliseum grow by [0, 0, 0, 3, 0] steps when bog is avoided` |
| `wide_every_styler_pool_holds_a_full_five_across_disc` | 33-96 | PASS (keep) |
| `wide_pool_area_lies_between_two_small_discs_and_four_large_discs` | 33-96 | PASS (keep) |
| `wide_distinct_pools_are_at_least_eight_tiles_apart` | 33-96 | PASS (keep) |
| `wide_every_pool_has_a_two_tile_ring_of_plain_floor_in_the_zone_off_camp_halos` | 33-96 | PASS (keep; review note 3) |
| `wide_no_styler_bog_in_the_tree_footprint_or_its_apron` | 33-96 | PASS (keep) |
| `wide_barrows_keep_their_rock` | 33-96 | PASS (keep) |
| `wide_no_barrow_owns_bog` | 33-96 | PASS (keep) |
| `wide_maps_certify_clean_and_keep_the_tree` | 33-96 | PASS (keep; `land` also fails any seed without a map in 16 attempts) |
| `report_seeds_1_to_32`, `report_wide`, `sheet_seeds_1_to_8` (`#[ignore]`) | | reports |

The statistical rules (budget, barrow share, size by band, all three sizes, worst attempt) are checked on seeds 1-32
only. `report_wide` prints their figures for 33-96 and 1-96. Today (`54869394c`, release build):

| | seeds 33-96 | seeds 1-96 |
|---|---|---|
| M1 on/off bog-share ratio, min / median / max | 0.23 / **0.73** / 1.34 | 0.23 / 0.76 / 1.87 |
| M1 share of free ground on % (off %) | 1.93 / 6.11 / 11.29 (4.47 / 7.66 / 10.99) | 1.86 / 6.16 / 11.29 (4.47 / 7.63 / 10.99) |
| M8 Plague barrows on / off (share) | 587 / 801 (73.3%) | 883 / 1198 (73.7%) |
| M4 pools near / mid / far (mean area) | 19 (233.3) / 103 (66.7) / 68 (68.0); 190 in all | 29 (239.2) / 146 (67.4) / 103 (70.3); 278 |
| size classes on: small / medium / large | 128 / 43 / 19 | 187 / 62 / 29 |
| M3 pairs of pools closer than 8 | 0 | 0 |
| M6 attempt index on: min / median / max | 0 / 1 / 5 | 0 / 1 / 5 |
| refusals before the accepted attempt | 18 `Prefix`, 10 `Repair(RadiusPost)`, 33 `SignatureDiscarded` | 22, 11, 57 |
| M7 worst walk growth when bog is avoided, on (off) | max 3, on seed 75 only; sum 7 (off: max 8) | max 3 (off: max 8) |

On seeds 1-32 the budget's median is 0.85 (the coordinator's figure on `54869394c`; test 8 passes there).

**Cost:** the wide block adds 64 option-on maps. The test binary takes 98.7 s in a debug build on this machine,
against 50.4 s without the `wide_*` tests. The ignored `report_wide` takes 14 s in release.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_plague`
- `cargo test --release -p rh-sim --features trusted-status-probes --test mapgen_land_plague -- --ignored --nocapture report_wide`
- `cargo test -p rh-sim --lib style_warren` and `cargo test -p rh-sim --features trusted-status-probes --test content`
- the coordinator's `mapgen_signature_*` tests (command in `LANDMARK_GENERATION_SPEC.md` section 7); `cargo test -p rh-mapdress`
- `scripts/gate.sh --quick --oracle packet/P-LAND-PLAGUE-1-fix`

## 10. Risk and suggested model tier
Opus, reviewer-opus. A walk check inside the pool search changes which pools are laid on some maps. The draw stream
then moves for every later pool slot of that zone and for the zones styled after it (`style_runtime` state is shared).
Size: a walk field per zone (one BFS over the zone at the start of `lay`, or one per candidate body) plus a rejection
in `build`/`grow`; about 60-150 lines. Cost: a BFS per candidate is expensive (`best_of` 16 candidates per size per
slot). A single field of "shortest-walk tiles" per spawn, computed once and treated like the corridor, is cheap but
is not the same as the test's measure (the next trap).

## 11. Known traps
- **The styler cannot refuse an attempt.** A styler returns `Result<Plan, Error>`. An `Err` reaches the caller as
  `pipeline::Error::Style` and the whole generation call fails, so no next attempt is tried (as in
  `P-LAND-SENTENCED-1-fix.md` section 11). The pipeline discards a signature map only when it is not intact or does
  not certify clean (`pipeline/mod.rs:674-677`), and the certifier has no rule on bog lengthening a walk
  (`certify/` is not in this scope). Within this scope, "or the attempt is discarded" is therefore not available:
  the fix is by construction in `pools.rs`, so a pool that would lengthen a walk is not laid there. A discard rule
  would need a new certifier rule or a styler refusal in `pipeline/`/`style_runtime/`: another packet, the landmark
  lane's files.
- **What the styler sees, and what the test measures.** The test (`mapgen_land_plague.rs:466` `walk_field`, `:530`
  `bog_detours`) measures, on the finished map, 4-connected steps from each Plague spawn of `m.spawn_pool` to a
  multi-source start: the coliseum centre `(CX, CY)` and every coliseum gate tile. The walk with styler bog forbidden
  may be at most `walk_detour_max()` (2) steps longer than with it allowed. In the styler:
  - spawns: `BaseContext::spawns` (`style_runtime/contexts.rs:19`): the spawn pool's members inside the zone's mask
    (filtered at `style_zones/mod.rs:347-356`), as tile indices. These are the same spawns.
  - the coliseum: `crate::mapgen::coliseum::{CX, CY}` (`coliseum.rs:5-6`, public constants) give the centre. **The
    gate tiles are not in `BaseContext`.** They are in the fixed layout (`coliseum.rs:268-299`, `FixedLayout::gates`),
    which the pipeline holds and the styler does not receive. A BFS from the centre alone gives a different field than
    the test's (distance to the nearest gate). Because a walk from outside reaches the centre through a gate, this
    should differ by a constant on each gate's side, which does not change a detour much; that is not proved. The
    implementer can rebuild the gates from `coliseum::fixed_layout()` (pure, public) at the cost of ignoring a
    non-default layout, or use the centre alone and show it suffices. Either way, state it in the hand-off.
  - `BaseContext::centre_walk` (`contexts.rs:20`; set at `pipeline/mod.rs:417`) is `walk_field16` from the centre
    over the **pre-style** tiles (`spawns/mod.rs:224`; 16 directions, costs 5/7/11, `grid_topology.rs:58`). It is a
    different metric on older tiles, not the test's walk. Do not take it as the measure without showing equivalence.
  - the current tiles: `BaseContext::tiles` during `shape`, all zones styled before Plague included; zones styled
    after Plague are not yet there.
- **The walk can change after the pools are laid.** In `shape` the pools are laid first and the barrows are sited
  afterwards on what is left (`style_warren/shape.rs:213-225`). Later zones and later phases then add walls. A wall
  laid after a pool can block the dry way round it, so the shortest walk then crosses the bog. A check made only
  when a pool is laid is therefore necessary, not proved sufficient. On seed 75 this is not the cause. A probe (temporary,
  not committed) measured a growth of 3. With every `Barrow`-owned wall removed the growth is 4, and with every
  unowned Plague wall removed it stays at 3. The pool itself lies across the walk: 50 styler bog tiles lie in
  the oracle's approximate route band (steepest descent of each spawn's walk, grown by one tile). If the
  implementer finds that later walls break the guarantee on some seed, re-check the walk after the barrows (end of
  `shape`, still in scope) and remove or shrink the offending pool there. That is still a styler-local rule, with no
  draw added.
- **Draw order.** Rejecting a candidate inside the search (`build`/`grow`, before `place`) leaves the nine draws per
  slot unchanged. Only the chosen pool changes, and maps where nothing is rejected do not move. Removing a pool after
  it is laid would also leave the draws alone but changes the bog total, so the merge loop may then take more slots.
  State which you did.
- **Do not over-fit.** A rule that clears seed 75 by tuning (`POOLS` numbers) is not the fix: SCALE-3 moves every map.
  The wide test must pass because of the rule.
- **Open owner question, not a rule: the bog budget out of sample.** On seeds 33-96 the median on/off bog-share ratio
  is 0.73 (min 0.23, max 1.34), against 0.85 on the tuning seeds 1-32 and the owner's window [0.8, 1.2]
  (`bog_share_of_free_ground_stays_within_a_fifth_of_todays`, unchanged, seeds 1-32 only). The tuning fitted the 32
  test seeds. Whether the budget should hold out of sample, and whether `share_permille` (80) should be raised or the
  window read on more seeds, is the owner's decision. This packet does not change the budget test, its bound or
  `POOLS`' budget, and adds no failing test for it.
- `crates/rh-sim/tests/content.rs` rejects a `const` in a test file; the oracle holds none.
- Test 1-32's `option_off_maps_are_todays` indexes `off_maps()` by seed 1-8; it is not a wide test, and must not
  become one in that form.

## NOT ESTABLISHED
- Seeds beyond 96, and any map after P-MAPGEN-SIG-SCALE-3: the wide test is a sample, not a proof. Only a
  construction rule makes the guarantee hold on unseen seeds.
- Whether a check made when the pool is laid suffices once the barrows and later zones are in place: true on seed 75
  (see the probe above), not shown in general.
- The test's walk is 4-connected and ignores bog's slowdown; the game's movement is not grid-bound. The allowance of 2
  steps is the first oracle author's.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_plague.rs` (extended by this packet; it was P-LAND-PLAGUE-1's oracle)
- `docs/backlog/packets/P-LAND-PLAGUE-1-fix.md` (this brief)
- `docs/backlog/packets/P-LAND-PLAGUE-1.md` (the packet this fixes; unchanged)

## Notes from previous attempts
