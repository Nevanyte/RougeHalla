# P-LAND-PLAGUE-1-fix-2: the Plague pools keep the spawns' walks on the finished map, and no pool is dry

- **Serves:** reviewer-opus notes 1-3 on P-LAND-PLAGUE-1-fix (2026-11-13, on `534efc205`), and the owner's hard
  guarantee that pools keep off spawn routes (`docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 1, "guarantees
  are hard", and section 3 "Plague").
- **Implementer tier:** implementer-opus (rh-sim mapgen, signature-mode pipeline end-of-attempt check)
- **Reviewer:** reviewer-opus
- **Integration base:** stacked on `agent/opus/P-LAND-PLAGUE-1-fix` @ `534efc205`, itself on `agent/opus/P-LAND-PLAGUE-1`
  @ `fe50d4009`, on `feature/unity-rework` @ `2e51457dd`. Gate: `scripts/gate.sh --quick --base
  agent/opus/P-LAND-PLAGUE-1-fix --oracle packet/P-LAND-PLAGUE-1-fix-2`.
- **D-rules touched:** D1: option off byte-identical (G8; the check runs only when a signature landmark was placed);
  option on is already an intentional difference from legacy (P-LAND-PLAGUE-1's proposed row), no new one · D2 n/a ·
  no sim tick, wire, save, state-hash or content-hash change.

## 1. ID and outcome
P-LAND-PLAGUE-1-fix made the Plague styler keep every Plague spawn's walk when it lays its pools
(`style_warren/walk.rs`), and give back whole bodies after the barrows (`walk::give_way`, called at
`style_warren/shape.rs:320`). That holds at the end of the Plague styler only. The review found three gaps:

1. `Walk::keeps` and `give_way` had no unit test, and `give_way` had only fired on attempts the pipeline discarded.
2. **After the styler.** Stylers run in the seed's faction order, so zones styled after Plague, the safety nets
   (`pipeline/mod.rs:489` `repair::safety_nets`) and the post repair (`:536` `repair::post_repair`) change tiles
   afterwards. A wall laid later (also in a neighbour's zone, which a walk or the dry way round a pool may cross)
   lengthens the dry walk and not the open one; a wall opened later can make a shortcut through a pool, or connect a
   spawn the styler saw as unreachable and skipped (`walk.rs` `Walk::new` keeps only spawns with `dry[s] != i32::MAX`).
   Nothing checks the finished map today; such a map would be served.
3. **Dry pools.** A body `give_way` gives back keeps its `BogPool` feature(s) owning plain floor: `surface`
   (`style_warren/mod.rs:223-230`) paints bog only on `plan.pools`. The certifier passes it (`certify/features.rs:236-241`
   `feature-kind-tiles` looks only at wall and LOW tiles; `feature-size` skips kinds with neither), so the map would be
   served with a dry `BogPool`.

**When this lands:** with `pipeline::Options::signature` on, every finished map is measured at the end of the attempt
(after the existing `intact`/`certifies` check, `pipeline/mod.rs:692-694`): for every Plague spawn of the map's
`spawn_pool` that a walk reaches, the 4-connected walk over floor to the coliseum (centre tile and gate tiles of
`m.coliseum`) with styler bog (floor with terrain bog owned by a `BogPool`) forbidden is at most `POOLS.walk_detour`
(2) steps longer than with it allowed, and every `BogPool` feature owns at least one floor tile with terrain bog.
Otherwise the attempt is refused with the new `Refusal::SignaturePools` and the next attempt is tried (ADR 0028 G5:
discarded, never repaired; never a generation error). Option off nothing runs.

## 2. Dependencies
- `agent/opus/P-LAND-PLAGUE-1-fix` @ `534efc205` (under this branch).
- P-MAPGEN-SIG-SCALE-3 (the bog tree; edits `landmarks/signature/{bog_tree.rs, mod.rs}`) will be under this branch
  after a rebase by the coordinator. This packet's stub and planned implementation change **no line** of
  `landmarks/signature/mod.rs`, so the rebase cannot conflict there. SCALE-3 moves every option-on map: the guard
  `no_attempt_of_seeds_1_to_96_is_refused_by_the_pool_check` may then find refusals (a measurement, see section 11).

## 3. Relevant legacy paths (verified with `rg`)
- none. Signature mode only: legacy has no bog tree, no pools and no end-of-attempt walk check. Legacy's barrow
  crescents (`packages/shared/src/zoneStyle/warren.ts:197` `bogAt`, `:306` `crescentOf`) are kept byte for byte option off.

## 4. New paths
- `crates/rh-sim/src/mapgen/pipeline/plague_pools.rs` (stub: `walk_growth`, `dry_pools`, `keeps`; the implementer fills
  the first two).
- `crates/rh-sim/src/mapgen/pipeline/plague_pools_tests.rs` (oracle; notes 2 and 3).
- `crates/rh-sim/src/mapgen/style_warren/walk_tests.rs` (oracle; note 1).
- this brief.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/pipeline/plague_pools.rs`: the bodies of `walk_growth` and `dry_pools` (and private
  helpers); keep the three signatures and `keeps` as stubbed unless a test needs otherwise.
- `crates/rh-sim/src/mapgen/pipeline/mod.rs`: only the stub's lines: `:15-17` (mod lines), `:87-92`
  (`Refusal::SignaturePools`), `:133-135` (`pool_detour`), `:182-192` (its value and the `#[cfg(test)]` seam
  `with_pool_detour`; the `#[allow(dead_code)]` may go), `:695-698` (the check). No other line.
- `crates/rh-sim/src/mapgen/style_warren/mod.rs`: only the stub's lines `:7-8` and `:22-23` (no change expected).
- `crates/rh-sim/src/mapgen/pipeline/README.md`: one sentence naming the check, if the README lists the end-of-attempt
  checks.
- `crates/rh-sim/src/mapgen/style_warren/walk.rs`: only if a note-1 guard goes red (none does today); report it.
- Not yours: `landmarks/signature/**` (0 lines: SCALE-3 edits it), `certify/**`, `style_runtime/`, `repair/`,
  `style_warren/{pools,shape}.rs`, the `rh-mapdress` goldens, every test file. If an option-on map of seeds 1-4 moves,
  stop and report: the prototype found none (section 8).

## 6. Contracts and references
- ADR 0028 G1 (no step moves what an earlier step placed: the check discards, it never edits the map), G5 (keep-clear
  outranks theme: spawns and their walks stay free; a failing map is discarded, never repaired), G8 (option off
  byte-identical).
- `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 1; `docs/backlog/packets/P-LAND-PLAGUE-1.md` and
  `P-LAND-PLAGUE-1-fix.md` (still apply).
- `crates/rh-sim/AGENTS.md` (determinism; draws are behaviour).

## 7. Behaviour to preserve
- **Option off: byte-identical, no new work, no new allocation.** The check is behind `placed_any`
  (`pipeline/mod.rs:696`), which is `Some` only when `options.signature && styled` placed the landmarks. Guards:
  `plague_pools_tests::option_off_maps_never_run_the_check` (seeds 1-2 with the seam's detour -1, which fails every
  measured map: equal to today's maps), `mapgen_signature_core.rs` `g8_signature_off_is_todays_generator`,
  `mapgen_land_plague.rs` `option_off_maps_are_todays`.
- **Determinism.** The check is pure (reads the finished map, draws nothing, writes nothing) and runs after every draw
  of the attempt; a refused attempt returns before `observe(Phase::Gates)` exactly as `SignatureDiscarded` does (trace
  ends at `Records`). No draw added, removed or reordered.
- **Today's maps.** No accepted map of seeds 1-96 moves: the prototype (section 8) refuses no attempt.
- **The statistical tests and their bounds** (budget, barrow share, size by band, all three sizes, worst attempt) are
  unchanged and not this packet's. The bog budget out of sample remains the owner's open question
  (P-LAND-PLAGUE-1-fix section 11).
- **The existing end-of-attempt check** keeps its reason: the new check runs after it, so an attempt it refuses is still
  `SignatureDiscarded`.

## 8. Acceptance checks
Measured on the `stub:` commit, debug build, macOS arm64.

| Test | Kind | Today (stub) |
|---|---|---|
| `style_warren::walk_tests::keeps_takes_a_pool_within_the_detour_and_refuses_a_merge_that_crosses_a_band` | note 1 | green guard |
| `style_warren::walk_tests::give_way_gives_back_the_body_a_later_wall_traps_and_keeps_a_body_off_the_walks` | note 1 | green guard |
| `style_warren::walk_tests::give_way_gives_back_the_last_laid_crossing_body_first_and_stops_when_the_walks_keep` | note 1 | green guard |
| `pipeline::plague_pools_tests::a_pool_across_every_short_way_grows_the_walk_past_the_detour` | note 2 | red: `the dry way takes an edge row: 22 + 4 steps` left `[]` right `[4]` |
| `pipeline::plague_pools_tests::a_pool_the_dry_way_passes_within_the_detour_is_kept` | note 2 | red: `round the pool: 2 steps longer` `[]` vs `[2]` |
| `pipeline::plague_pools_tests::a_pool_that_cuts_a_spawn_off_grows_its_walk_without_bound` | note 2 | red: `[]` vs `[2147483647]` |
| `pipeline::plague_pools_tests::only_bog_a_bog_pool_owns_counts_and_only_plague_spawns_a_walk_reaches` | note 2 | red: `tree and unowned bog do not count` `[]` vs `[0]` |
| `pipeline::plague_pools_tests::the_gate_tiles_start_the_walk_too` | note 2 | red: `from the gate: 6 steps, 8 round the pool` `[]` vs `[2]` |
| `pipeline::plague_pools_tests::a_wall_in_a_neighbour_zone_counts_the_walk_is_measured_on_the_whole_map` | note 2 | red: `round the pool through Fire` `[]` vs `[2]` |
| `pipeline::plague_pools_tests::a_bog_pool_that_owns_no_bog_is_dry_and_refused` | note 3 | red: `feature 2 owns no bog` `[]` vs `[2]` |
| `pipeline::plague_pools_tests::the_pipeline_discards_a_finished_map_the_check_refuses_and_never_errs` | note 2, pipeline | red: `seed 1 attempt 2: the end-of-attempt pool check refuses` left `None` right `Some(SignaturePools)` |
| `pipeline::plague_pools_tests::option_off_maps_never_run_the_check` | G8 | green guard |
| `mapgen_land_plague.rs` `the_end_of_attempt_check_measures_this_oracles_walk_on_seeds_1_to_96` | notes 2, 3 on real maps | red: `end-of-attempt pool check, seeds 1-96: 96 findings` (`the check measures [], the oracle [0, ...]`) |
| `mapgen_land_plague.rs` `no_attempt_of_seeds_1_to_96_is_refused_by_the_pool_check` | cost guard | green (vacuous on the stub; meaningful once the check runs) |
| the 25 earlier tests of `mapgen_land_plague.rs` | | unchanged, green |

**The seam.** `Pipeline::with_pool_detour` (`#[cfg(test)]`) sets the detour the end-of-attempt check uses. With -1 every
finished map that has a measured Plague spawn fails (growth >= 0), so the pipeline test reaches the refusal on a real
attempt without a hand-made map. `Pipeline::with_style_fault` (P-MAPGEN-STYLE-REFUSE-1) is not on this base and is
not used.

**Prototype (not committed; patch at the coordinator's request, see the hand-off).** A direct implementation of
`walk_growth` and `dry_pools` (two breadth-first searches over the whole map, a feature scan) on the accepted maps of
seeds 1-96 (option on, release):
- `walk_growth` equals the oracle's `bog_detours` on all 96 maps (553 spawn walks: 552 grow by 0, one by 2).
- No dry `BogPool` on any map; no `BogPool` owns any tile that is not bog floor either; no Plague bog outside the tree
  is owned by anything but a `BogPool`.
- `keeps(m, 2)` holds on all 96. The check is placed after the existing check, so it can only refuse a map that would
  otherwise be accepted: **no attempt of seeds 1-96 is refused by it today, and no accepted map moves.** Also, since no
  accepted map holds a dry pool, `give_way` gave back nothing on any accepted map of 1-96 (its features would remain).
- With the prototype every test above is green (lib: 12 of 12; `mapgen_land_plague`: 25 of 25).

**Cost.** Two BFS over 160 x 160 per signature attempt that reaches the end (no per-spawn search is needed: one field
from the coliseum with and one without styler bog serve every spawn), plus one pass over the feature grid. The
`mapgen_land_plague` binary (debug, stub): 111.9 s with the two new tests skipped, 116.6 s with them (one run each;
their work is 96 x two BFS on the cached maps; with the prototype the whole binary took 113.3 s). The lib tests add about 7 s (the pipeline test runs three option-on attempts and one with the seam; the
option-off guard four maps).

## 9. Validation commands
- `cargo test -p rh-sim --lib -- style_warren::walk_tests pipeline::plague_pools_tests`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_plague`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_core --test mapgen_signature_fire --test content`
- `cargo test -p rh-mapdress`
- `scripts/gate.sh --quick --base agent/opus/P-LAND-PLAGUE-1-fix --oracle packet/P-LAND-PLAGUE-1-fix-2`

## 10. Risk and suggested model tier
Opus, reviewer-opus (pipeline attempt outcome in signature mode). Size: about 70-110 changed lines in `plague_pools.rs`;
not cut. Risk: a measure that differs from the oracle's (spawn tile from world coordinates, multi-source start, which
bog counts) makes `the_end_of_attempt_check_measures_this_oracles_walk_on_seeds_1_to_96` red; a check that refuses
today's maps moves accepted maps (the cost guard catches it).

## 11. Known traps
- **Where the check lives, and why not the certifier.** In the pipeline, after `intact`/`certifies`, behind
  `placed_any`: option off it costs nothing (no call), it reads the finished map with its own coliseum, and it leaves
  `landmarks/signature/mod.rs` (SCALE-3's file) and `certify/` (shared by option-off maps and every tool, whose rule
  names and diagnostics are pinned elsewhere) untouched. A certifier row would also judge dry pools on maps that never
  had the option, and `intact` is a per-tile predicate, not a per-feature existence check. Note 3 is enforced in the
  same check, so a dry pool discards the attempt in signature mode; the certifier alone still passes a dry `BogPool`
  (not a served path: only the pipeline makes signature maps).
- **Which refusal.** A new `Refusal::SignaturePools`, appended after `SignatureDiscarded`, so reports and the cost guard
  tell it apart. The only test that matches refusals by name (`mapgen_signature_fire.rs:805`
  `note2_refusals_tell_no_site_from_a_discarded_map`) ignores other reasons after `Records`. No crate outside `rh-sim`
  matches `pipeline::Refusal` (verified with `git grep`).
- **Styler bog.** The check counts bog owned by a `BogPool` (as the review asks); the oracle's `bog_detours`
  (`mapgen_land_plague.rs:530`, `is_styler_bog` `:281`) counts every Plague bog tile not owned by the `BogTree`. On
  today's maps the two are the same set (prototype). If a later packet lays other non-tree bog in Plague, the two part
  and the measure test says so.
- **The walk.** As the oracle: spawn tile `floor(x / TILE), floor(y / TILE)`, 4-connected steps over `tiles == 0` on the
  whole map (any zone), multi-source start at the centre tile (`m.coliseum.centre`) and every gate tile, each only if
  it is floor; a spawn the open walk does not reach is left out; one styler bog cuts off: `i32::MAX`. Read `m.w`/`m.h`,
  not `coliseum::W`/`H` (the hand-built maps are small).
- **The guard may go red after a rebase.** `no_attempt_of_seeds_1_to_96_is_refused_by_the_pool_check` measures cost on
  today's maps. If SCALE-3 (or any later change) makes the check refuse an attempt, the discard is correct behaviour;
  the guard then reports which seeds, and the coordinator decides whether to amend it or fix the styler.
- **`give_way` gives back more than it must** (observation, not changed here): it drops the last-laid body touching any
  spawn's band, which need not be the body that breaks the failing spawn's walk; a harmless body laid later goes first.
  The guarantee holds; the bog lost is a tuning matter. The note-1 tests pin only the cases where the last-laid crossing
  body is the culprit or the only crossing body.
- Test files hold no `const` (`crates/rh-sim/tests/content.rs`).

## NOT ESTABLISHED
- Seeds beyond 96 and maps after SCALE-3: the prototype measured today's accepted maps only.
- That the styler's own guard plus this check are tight: the check is the guarantee; whether the styler could avoid
  more discards by re-checking after later zones is not measured (no discard happens today).
- The walk is 4-connected and ignores bog's slowdown; the game's movement is not grid-bound (as in P-LAND-PLAGUE-1-fix).
- Whether `give_way` sees every barrow wall at the end of `shape` (walls written immediately by `place_feature`) is
  taken from P-LAND-PLAGUE-1-fix's hand-off, not re-verified here.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/mapgen/style_warren/walk_tests.rs`
- `crates/rh-sim/src/mapgen/pipeline/plague_pools_tests.rs`
- `crates/rh-sim/tests/mapgen_land_plague.rs` (two tests added; the 25 earlier ones unchanged)
- `docs/backlog/packets/P-LAND-PLAGUE-1-fix-2.md` (this brief)

## Notes from previous attempts
