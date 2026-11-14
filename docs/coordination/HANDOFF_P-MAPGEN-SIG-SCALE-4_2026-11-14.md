# Hand-off: P-MAPGEN-SIG-SCALE-4, second build (implementer-opus, 2026-11-14)

```
PACKET:          P-MAPGEN-SIG-SCALE-4 — serves owner direction 2026-11-12 late (landmarks "a lot larger"), owner
                 decisions 2026-11-13 (requirements L1, L4; ADR 0028 G9) and 2026-11-14 ("Yes to all 3": T5 exemption,
                 22 across, streams 10-14 / 7-10); last of the four SCALE packets
BRANCH:          agent/opus/P-MAPGEN-SIG-SCALE-4 @ (this commit); this build: 77e31d6ff (the three rules), ab586f5e7
                 (stamp doc), 73c44a968 (ADR); 2dab1bd53 tried a stream rule and dc8de3d5d reverts it (see "Conflict 2");
                 on the first build a93a6368b, rebased by the coordinator on packet/P-MAPGEN-SIG-SCALE-4 @ d3f66063c,
                 stacked on agent/opus/P-MAPGEN-GUARANTEES-1 @ c64934582
GATE:            not run by the implementer (the lane's session re-pins and runs the full gate).
                 Implementer runs on this build: cargo fmt --all -- --check PASS; cargo clippy -p rh-sim --all-targets
                 --features trusted-status-probes -D warnings PASS; cargo test -p rh-sim --features
                 trusted-status-probes --no-fail-fast: 1498 passed, 27 failed (all listed below). rh-mapdress and
                 rh-server not run.
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs, spec.rs, volcano.rs, blueprint.rs} (first build
                 plus: fan, fan_holds_a_site_camp, landmark_kind, t5_exempt, lava_budget 200-270, docs);
                 crates/rh-sim/src/mapgen/terrain_gate/mod.rs, crates/rh-sim/src/mapgen/certify/terrain.rs (T5 only);
                 crates/rh-sim/src/mapgen/attempt/mod.rs (the fan as a camp Reserve); crates/rh-sim/src/mapgen/
                 landmarks/stage/mod.rs (the fan in recipe_protect); docs/adr/0028-signature-landmarks.md
                 (decisions 7, 8, 10); this file
D-RULES:         D1: option off byte-identical: the fan exists only with reserved sites (option on); t5_exempt needs a
                 signature landmark feature, which option-off maps never have; pinned_off and every *_option_off_*
                 guard green in the full run. No legacy counterpart (DEV-020). D2 n/a. No sim tick, wire or Unity
                 change (the Fire anchor's entrance grows from 0 to 6 tiles, under MAX_ANCHOR_ENTRANCE 16).
DEVIATIONS:      proposed DEV-<n> (below, "Proposed record text"): T5 exempts a signature landmark's own lava; the
                 22 x 22 cone replaces the approved 30 x 30 drawing; the reserved Fire fan
SHARED RECORDS:  none edited. Proposed: the coordinator re-pins (section 13) and takes the numbers below to the owner
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: that the 7 orientation-dependent volcano tests pass as written (they cannot: Conflict 1; they pass
                 with the helper's tie broken locally); rh-mapdress goldens and rh-server map tests (not run); the
                 Plague pool-size drift's cause beyond "the maps moved" (Plague code untouched); time per map under
                 the gate's own profile.
RISKS:           two oracle tests contradict the owner's rules (Conflicts 1 and 2); every older signature oracle's
                 attempt bound is exceeded (expected by the brief); Plague pool sizes and one Sentenced lane seed fall
                 under their floors on the moved maps.
```

## What this build adds to the first one

- **T5 exemption** (design item 10): `signature::landmark_kind` (Volcano, LavaStream, LavaPool, Church, Graveyard,
  BogTree, Cave) and `signature::t5_exempt(map, i, lava)`: LOW, terrain = the reader's lava code, owned by a
  `landmark_kind` feature. One predicate; the terrain gate passes the lava code from its own definition's kinds and the
  certifier from its own `KEYS` table, so the certifier stays independent of the terrain gate's catalog.
- **The fan** (design item 11): `signature::fan(&ReservedSite, &Definition)`, the brief's rectangle (front axis read at
  the site's centre tile, `front` then `axis`), clipped to the map; `None` for other zones. The Prefix appends it to
  the `Reserve` list as `{ zone: 0, camp: None }` (`place_camps_reserving` keeps every camp's halo off it unchanged:
  `zones/camps/` untouched). The legacy stage marks it in `recipe_protect`.
- **The in-site camps (the brief's trap):** the church's and the cave's camps are fixed with the sites, so the Prefix
  checks them: when such a camp's certifier halo (`mark_halo`) reaches into the fan, the round fails as a camp failure
  does (partition and sites redrawn; no extra draw, no new refusal kind). Measured with a throwaway counter: it never
  fired on seeds 1-64; the oracle's fan test (every camp of every zone) is green.
- `lava_budget` (200, 270); the `stamp` doc's centre tiles (10|11, 10|11); ADR decisions 7, 8, 10.
- **What the first build assumed about a 30 x 30 box:** only docs (the `stamp` doc's grid tiles, ADR 7, 8, 10). The
  stamp continuation, `volcano::streams` (it reads the landed runs, not the box) and `free` needed no change.

## Test results (the full rh-sim run on this build, plus the targeted runs)

**Green** (1498 tests), among them: `mapgen_signature_volcano` 13 of 20 (the Fire entry, `dir16`, the drawing and
outlet table, the provisional lava window, both provisional attempt bounds, the three T5 tests, the fan test, the
streams' ground, fairness, every zone keeps its landmark and certifies clean); `mapgen_signature_fire` 9 of 10;
`mapgen_signature_fire_bands` 5 of 5 (crater bands, count floor, streams two wide); `mapgen_landmark_frame` 8 of 8;
`mapgen_signature_blueprint` 8 of 10; `mapgen_signature_table` 7 of 8 (incl. the shipped-drawing guard);
`mapgen_land_plague` 23 of 26 (incl. every amount floor: marsh plus pools, pools alone, barrows);
`mapgen_land_sentenced` 9 of 11 (incl. combined 0.75 and lanes alone 0.45); the volcano lib unit test; every
option-off pin and guard.

**Red: the oracle contradicts the owner's drawing (Conflict 1, structural; the build is not bent):**
`mapgen_signature_volcano` `the_volcano_is_the_blueprint_under_one_of_eight_orientations`,
`the_fire_anchor_is_the_box_the_crater_centre_and_the_six_outlets`, `the_mirror_and_every_front_direction_occur`,
`exactly_three_streams_one_per_outlet_each_ending_in_its_pool`,
`the_middle_stream_is_10_to_14_and_the_longest_the_sides_7_to_10`,
`the_streams_fan_toward_the_coliseum_each_on_its_own_side`,
`the_fire_frame_lands_the_drawing_and_writes_the_streams_in_outlet_order`. All seven fail in the helper `orientation()`
(line 470): "the volcano equals the drawing under 2 orientations ... 0 of 484 tiles differ". The owner's 22 x 22
drawing is left-right symmetric (every grid row reads the same reversed; `#`, `X`, `H` are all wall, `~` and `O` both
lava; outlets 3-4 / 10-11 / 17-18 mirror onto each other), so a faithful stamp equals the drawing under both mirror
states of its front, on every map. Evidence the build is otherwise right: a local copy of the oracle whose only change
breaks that tie with the Fire frame's landing (`exact.retain(|o| *o == (landing.front, landing.mirrored))`; not
committed) passes all 20 tests, these seven included. Proposed oracle fix: when the drawing is mirror-symmetric, accept
both exact orientations and compare the frame's landing to the set, or take the landing's orientation when it is one of
them.

**Red: an older oracle contradicts the owner's geometry (Conflict 2, structural):** `mapgen_signature_fire`
`volcano_on_the_back_edge_with_streams_toward_the_front` (left unchanged on purpose by the oracle author): seed 7,
"stream 0 ends at (111, 10), 76.6 from the coliseum; the volcano is 73.6". The test reads "toward the coliseum" in map
terms (each stream's farthest lava nearer the coliseum than the volcano's centre). The owner's geometry fixes the side
headings at 45 degrees off the drawing's front, and the front is the dominant axis of the true direction (up to 45
degrees off it), so a side stream can run at up to 90 degrees to the true direction. The owner's fan is enforced in
grid terms (dy > 0, sides on their sides; green). Measured (commit 2dab1bd53, reverted in dc8de3d5d): accepting a
stream only when it runs toward the coliseum in map terms (shortened within its range first, else the attempt refused)
makes this test green but raises Fire Signature refusals from 38 to 81 over seeds 1-64, attempts from 89 / 192 to 118 /
228 (seeds 1-32 / 1-64), and **loses seed 40** (no map in 16 attempts), which turns ten `mapgen_land_plague` `wide_*`
and seeds-1-96 tests red (G2/G5: a landmark is never a reason to lose a seed). Bending blocked streams toward the true
direction first changed nothing. I kept the owner's rules and G2/G5; the coordinator decides whether this test is
re-aimed at the grid-terms fan or the rule is wanted at that cost.

**Red by design, to re-pin** (every option-on map moved; not re-pinned here):
`mapgen_signature_blueprint` `option_on_maps_are_unchanged`, `the_landmarks_phase_is_unchanged` (through
`tests/support/signature_pins.rs`); `rh-mapdress` goldens `anchor.rs` `NO_ANCHOR_GOLDEN`, `marsh.rs` `SIG_GOLDEN`,
`sentenced_rings.rs` `NO_ORIGIN_GOLDEN` (expected red; not run here). Outside the brief's re-pin list (section 13 says
these go back to the coordinator): `mapgen_guarantees` `the_refusal_labels_of_seeds_1_to_32_are_todays_relabelled`
(seed 2: the pinned labels are SpawnRatio, Prefix, SignatureDiscarded, Guarantee(Frost lake-at-mouth); this build
lands seed 2 on attempt 0) and `a_lake_failure_is_refused_after_records_as_the_frost_guarantee` (lake-at-mouth
refusals over seeds 1-32: 6, pinned 11): both pin option-on refusal sequences.

**Red for a number** (tests not edited, the generator not bent; the measured value against the bound):

| test | bound | measured |
|---|---|---|
| `mapgen_signature_bog_tree` worst / attempts (1-32) | 4 / 59 | 9 (seed 22) / 89 |
| `mapgen_signature_church` worst / attempts | 5 / 57 | 9 / 89 |
| `mapgen_signature_reserve` worst / attempts | 7 / 70 | 9 / 89 |
| `mapgen_signature_scale` worst / attempts | 7 / 70 | 9 / 89 |
| `mapgen_signature_frost_lake` worst | 8 | 9 |
| `mapgen_land_plague` `the_worst_attempt_over_seeds_1_to_32_is_at_most_eight` | 8 | 9 (seed 22) |
| `mapgen_land_sentenced` `the_worst_attempt_over_seeds_1_to_32_is_at_most_eight` | 8 | 9 (seed 22) |
| `mapgen_signature_table` `each_landmark_placed_alone_equals_it_placed_with_the_others` | >= 28 accepted Landmarks phases (seeds 1-16, attempts 0-1) | 25 (crossings 0) |
| `mapgen_land_sentenced` `every_seed_keeps_its_lanes` | lane fence on/off >= 0.3 per seed | seed 6: 97/4060 on, 354/4253 off, 0.29 |
| `mapgen_land_plague` `all_three_sizes_occur_and_maps_with_three_pools_mix_sizes` | a Large pool on 1-32 | none (Small 51, Medium 15) |
| `mapgen_land_plague` `pools_are_large_near_the_tree_and_small_far` | near and far pools, near mean >= 2 x far | near 0; far 32, mean area 67.2 |

"Worst" is the 0-based attempt index the tests print (9 = the tenth attempt). The Plague pool sizes: no Plague code
changed; on the stub the same report shows pools of inscribed r2 up to 36 on seeds 1-32, on this build at most 24
(styler bog 4974 -> 4789 tiles, pieces 71 -> 66): the maps moved (camps leave the fan, the Fire cone is bigger). The
Plague and Sentenced amount floors themselves pass.

## Numbers (seeds 1-64, option on, 16 attempts each; `report_seeds_1_to_64` with the tie-broken helper)

| | stub (5 x 5 cone) | prototype (measured) | this build |
|---|---|---|---|
| seeds with a map | 64 / 64 | 64 / 64 | **64 / 64** |
| attempts 1-32 / 1-64 | - / 111 | ~105 / 210 | **89 / 192** (provisional bound 137 on 1-32) |
| worst attempt (the report's 0-based index) 1-32 / 1-64 | - / 4 | - / 10 | **9 (seed 22) / 10 (seed 64)** (provisional 12) |
| mean attempts per seed | | | 3.00 |
| Prefix refusals, share of attempts | | 12.4% | 24 of 192, 12.5% |
| lava per map (Fire) | 80-114 | 221-244 | **223-244** (cone 136, streams 52-70, pools 31-38) |
| largest / smallest zone floor | 1.025-1.065 | 1.11-1.15 | 1.100-1.150 |
| Fire floor / others' mean | 0.977-1.013 | 0.88-0.92 | 0.883-0.930 |
| time per map (opt-level 2, sequential, incl. refused attempts) | 0.131 s on, 0.034 s off | | 0.185 s on, 0.035 s off |

(The floor columns count FLOOR tiles per zone; the certifier's own `zone-floor-share` passes on every map of 1-32.)

- **Refusals by reason** (128): Signature 38, SpawnRatio 26, Prefix 24, Guarantee(Frost lake-at-mouth) 16,
  SpawnPool 9, Repair(RadiusPost) 8, SignatureDiscarded 5, Repair(FloorShare) 2. **Fire Signature by cause**
  (throwaway counter, not committed): middle stream not laid 13, left 7, right 6, floor split 12; touching, spread,
  column order, lava budget 0; the stamp itself never refused (no Signature refusal at any other zone).
- **Stream lengths** (the oracle's measure): left 7-10 (mean 8.55), middle 10-14 (12.12), right 7-10 (8.30).
- **Proposed final lava window:** measured 223-244; about 10% each side gives **(200, 270)**, the provisional window:
  keep it.
- **Proposed attempt bounds** for this oracle: worst 9 and 89 used on 1-32; the provisional 12 / 137 hold with room.
  Older oracles, to hold this build: worst >= 9 and attempts >= 89 on seeds 1-32 (with the brief's ~30% headroom:
  12 / 116).
- **Fire craters** per map, seeds 1-64: option on 7-10 (mean 9.44), option off 8-10 (mean 9.88). The
  `mapgen_signature_fire_bands` tests (bands, count floor) are green.
- **The owner's picture, seeds 1-8** (option on, accepted attempt): 1 -> 1, 2 -> 0, 3 -> 1, 4 -> 0, 5 -> 0, 6 -> 0,
  7 -> 2, 8 -> 1.

## What the brief got wrong

1. The oracle's `orientation()` (exactly one exact orientation) cannot hold for the owner's 22 x 22 drawing, which is
   mirror-symmetric (Conflict 1).
2. `volcano_on_the_back_edge_with_streams_toward_the_front` was "left unchanged on purpose"; with fixed 45-degree side
   headings off a dominant-axis front it can only be met by refusing attempts, which loses seed 40 (Conflict 2).
3. Section 13's re-pin list misses the two `mapgen_guarantees` refusal-sequence pins.
4. Section 7 lists the older attempt bounds and the amount floors as the expected number failures; the
   `mapgen_signature_table` phase count (25 < 28), the Sentenced per-seed lane ratio (seed 6) and the two Plague
   pool-size tests also go red on the moved maps.

## Proposed record text

**ADR 0028, decision 10 (paragraph; the build's text is already in the ADR on this branch):** The Fire volcano is the
owner's 22 x 22 drawing (owner decision 2026-11-14, "22 across"; it replaces the approved 30 x 30 drawing, which no map
could hold: its 816 floor tiles broke the zone fairness rule on every seed), centred in the Fire site's unchanged 30 x
30 inner rect, with exactly three lava streams from its outlet runs: the middle 10-14 path tiles and strictly the
longest, the sides 7-10. A fan in front of the site's inner rect (14 deep, the inner rect's width plus 14 on each side,
along the front axis read at the site's centre tile) is reserved in the Prefix: no camp's halo and no legacy landmark
building enters it; the streams and pools run in it. Terrain rule T5 does not count a signature landmark's own lava (a
LOW lava tile a Volcano, LavaStream, LavaPool, Church, Graveyard, BogTree or Cave feature owns: today the crater lake),
in the terrain gate and the certifier through one predicate; every other far LOW tile still fails, option on or off.
The zone fairness rule is unchanged (1.15 in repair and the certifier).

**DEVIATIONS.md row (the coordinator numbers it, the owner signs):**

| DEV-<n> | Signature landmarks, Fire (P-MAPGEN-SIG-SCALE-4; owner decisions 2026-11-14) | (1) Terrain rule T5 ("a LOW tile lies within 4 tiles of floor") does not count a signature landmark's own lava: a LOW lava tile owned by a Volcano, LavaStream, LavaPool, Church, Graveyard, BogTree or Cave feature (the volcano's walled-in crater lake), in the terrain gate and the certifier; every other far LOW tile still fails. (2) The volcano is a 22 x 22 drawing centred in the 30 x 30 inner rect, replacing the approved 30 x 30 drawing; streams 7-10 / 10-14 / 7-10 replace 10-14 / 14-18 / 10-14. (3) A fan in front of the Fire site (14 deep, inner rect width + 14 a side) is reserved from camp halos and legacy landmark buildings. Option on only; option-off maps byte-identical. No legacy counterpart (extends DEV-020). | owner: 2026-11-14 "Yes to all 3" |

## Left for the coordinator

- Decide Conflicts 1 and 2 (oracle amendments), then the re-pin commit (section 13) and the new bounds.
- A detached worktree of the stub, made for the "before" measurements, is registered at
  `/private/tmp/claude-501/-Users-nevinmckinnon--claude-spares-spare-jXC9Bt/dc84f353-8639-4f9e-ba13-481dad5d2ccf/scratchpad/stub`
  (remove it with `git worktree remove`); the tie-broken oracle copy and the floor-share script are beside it
  (`zz_scratch_volcano_tie.rs`, `zz_scratch_share.rs`).
