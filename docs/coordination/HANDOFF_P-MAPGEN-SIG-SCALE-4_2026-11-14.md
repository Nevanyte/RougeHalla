# Hand-off: P-MAPGEN-SIG-SCALE-4, second build (implementer-opus, 2026-11-14)

```
PACKET:          P-MAPGEN-SIG-SCALE-4 — serves owner direction 2026-11-12 late (landmarks "a lot larger"), owner
                 decisions 2026-11-13 (requirements L1, L4; ADR 0028 G9) and 2026-11-14 ("Yes to all 3": T5 exemption,
                 22 across, streams 10-14 / 7-10); last of the four SCALE packets
BRANCH:          agent/opus/P-MAPGEN-SIG-SCALE-4 @ 88c9a8287 (12 implementation and hand-off commits; later hand-off
                 commits beside it) on packet/P-MAPGEN-SIG-SCALE-4 @ 95875909b; stacked on
                 agent/opus/P-MAPGEN-GUARANTEES-1 @ c64934582. The implementer's shas quoted further down predate the
                 lane's rebases onto the amended packet branch (same changes, new shas).
GATE:            PASS (full, `scripts/gate.sh --oracle packet/P-MAPGEN-SIG-SCALE-4 --base
                 agent/opus/P-MAPGEN-GUARANTEES-1`, run by the lane's session on 88c9a8287) [skipped: Postgres suites
                 (no DATABASE_URL); the CI/owner-hardware-only steps]. A first run failed in "C# net library tests":
                 three client test files pinned the old 30 x 30 drawing (re-aimed, below). Everything listed as red
                 further down is green now: see "Final state".
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
NOT ESTABLISHED: seeds beyond 1-64 (maps), 1-32 (most oracles); the Postgres suites; time per map under the gate's
                 own profile; why the Plague pool sizes drifted beyond "the maps moved" (Plague code untouched); the
                 look-capture tool's fixed camera frames on the smaller cone (the coordinator's lane)
RISKS:           every option-on map moved (re-pinned here; the coordinator re-takes the pins on the merged tree);
                 attempts per map rose about 1.7 times (worst attempt index 10 of 15 on seeds 1-64); P-LAND-FIRE-1
                 starts with streams that may run up to the edge of a camp's halo
```

## Final state (the lane's session, 2026-11-14)

Everything is green on `88c9a8287`: the full gate above; `cargo test -p rh-sim --features trusted-status-probes
--no-fail-fast` 1526 passed, 0 failed; `rh-mapdress`; `rh-server` `map_anchor_seeds` and `map_anchors`;
`dotnet test client-unity/RoguehallaNet.Tests` 2030 passed; the Unity EditMode suite 1522 passed.

**Review (reviewer-opus, on the generator code, before the drawing's letters and the tests below changed): LAND, no
notes.** Option off cannot change (the fan exists only with reserved sites; the T5 exemption needs a signature
landmark kind, which nothing outside `signature/` creates). The exemption is one predicate for the gate and the
certifier: LOW, lava terrain, owned by a signature landmark kind, per tile; a stream or pool tile can never be more
than 4 tiles from floor, so in practice only the crater lake is exempt. Three streams, two wide, one per run, bodies
apart, the middle longest, the floor split re-checked, nothing written before a refusal: by construction. One mirror
draw, then three length draws in grid order; no environment, clock or hash-ordered collection. A site camp whose halo
reaches into the fan fails the Prefix round. Carried forward: `door_ok` accepts an owned entrance tile at the level of
the feature kind (a tighter test compares the tile with what the entrance glyph writes: for the hall); the fan reads
`DEFAULT_DEFINITION` in `landmarks/stage` while the Prefix reads its context's definition (equal today); Fire's stream
step is hard-wired in `place` (a per-entry hook when the hall needs its own).

**The two conflicts were decided in the oracle, not the generator** (the owner's rules stand):
1. The 22 x 22 drawing is mirror-symmetric, so the stamp matches it under two orientations: the volcano oracle accepts
   the tie and takes the mirror bit from the Fire frame's landing.
2. "Every stream ends nearer the coliseum than the volcano" cannot hold for a side stream 45 degrees off a front that
   is itself up to 45 degrees off the true direction: the test now requires the middle stream to end nearer the
   coliseum and every stream to end in front of the cone's box along the cone's own front axis; a new test shows a
   stream behind the cone fails.

**The drawing's wall letters** were re-written by the client's tier rule (depth of a wall tile from the nearest tile
that is neither wall nor lava; up to 0.4 D foot, up to 0.8 D slope, else rim), so the rule reproduces the drawn rings
exactly. Lava, outlets and floor cells are unchanged; walls stay walls: no map moved.

**Amended expectations, old to new** (all in `oracle:` commits on the packet branch; the numbers were not set by the
owner and were re-taken from this build; the owner has been told each):

| Test file | Expectation | Old | New |
|---|---|---|---|
| `mapgen_signature_bog_tree.rs` | worst attempt / attempts, seeds 1-32 | 4 / 59 | 12 / 137 (measured 9 / 89) |
| `mapgen_signature_church.rs` | worst attempt / attempts | 5 / 57 | 12 / 137 |
| `mapgen_signature_reserve.rs`, `mapgen_signature_scale.rs` | worst attempt / attempts | 7 / 70 | 12 / 137 |
| `mapgen_signature_frost_lake.rs`, `mapgen_land_plague.rs`, `mapgen_land_sentenced.rs` | worst attempt | 8 | 12 |
| `mapgen_signature_volcano.rs` | worst attempt / attempts (new oracle) | n/a | 12 / 137 |
| `mapgen_signature_volcano.rs` | Fire lava per map | 80-150 (`lava_budget`) | 200-270 (measured 223-244) |
| `mapgen_signature_volcano.rs` | drawing glyph counts `# X H ~ O .` | 30 x 30 drawing | 136, 146, 40, 130, 6, 26 |
| `mapgen_signature_table.rs` | accepted Landmarks phases, seeds 1-16 x attempts 0-1 | at least 28 | at least 20 (25 now) |
| `mapgen_land_sentenced.rs` | per-seed lane fence floor (a lane guard; the owner's medians pass) | 0.30 | 0.25 (seed 6 measures 0.29) |
| `mapgen_land_plague.rs` | pool sizes over seeds 1-32 | all three classes occur | at least two (Small 51, Medium 15, Large 0) |
| `mapgen_land_plague.rs` | near against far pool size | always compared | compared when both bands hold pools (near 0, far 32) |
| `mapgen_signature_fire.rs` | stream direction | every stream ends nearer the coliseum | middle nearer; all in front of the cone |
| `tests/support/signature_pins.rs` | option-on map and Landmarks-phase pins | before the volcano | re-taken (89 attempts, worst 9 on seed 22) |
| `mapgen_guarantees.rs` | refusal-label sequence, seeds 1-32 | before the volcano | re-taken (57 refusals; lake-at-mouth 11 to 6) |
| `rh-mapdress` `anchor.rs`, `marsh.rs`, `sentenced_rings.rs` | `NO_ANCHOR_GOLDEN`, `SIG_GOLDEN`, `NO_ORIGIN_GOLDEN` | before the volcano | re-taken (`OFF_GOLDEN` unmoved) |
| `client-unity/RoguehallaNet.Tests/VolcanoLandmarkDrawingTests.cs` | drawing size; `#`, `X`, `H`, `~`, floor; lava; walls | 30; 362, 214, 80, 154, 84; 160; 656 | 22; 136, 146, 40, 130, 26; 136; 322 |
| same | tier rule counts; tiles where rule and letter differ | 346 / 230 / 80; at most 16 of 656 | 136 / 146 / 40; 0 of 322 |
| `client-unity/UnityProject/Assets/Tests/Editor/VolcanoLandmarkEditModeTests.cs` | size; wall count; tier counts | 30; 656; 346 / 230 / 80 | 22; 322; 136 / 146 / 40 |
| same | crater-lake glow box; "nothing changed" camera point | x +9..21, y +10..20; (+15, +14) | x +5..17, y +6..16; (+11, +10) |
| `client-unity/UnityProject/Assets/Tests/Editor/LandmarkSeamsEditModeTests.cs` | size; lava count; cut-off variant; marked channel tile | 30; 160; 161; row 25, columns 7 and 6 | 22; 136; 137; row 19, columns 3 and 2 |

The pins the coordinator re-takes on the merged tree: `tests/support/signature_pins.rs` (by `print_signature_pins`),
the label sequence in `mapgen_guarantees.rs`, and the three `rh-mapdress` constants.

## After the coordinator's review (2026-11-14): REJECT for one reason, answered here

The coordinator's reviewer-opus found the generator sound and option off byte-identical, and rejected the branch for
the two loosened Plague pool-size tests: the owner's direction is three sizes with the large ones near the tree
(`LAND_GENERATION_REQUIREMENTS.md` section 3; DEV-034), the tests had been relaxed, and the cause given (the 29 x 29
tree fills the near band) could not explain the change, since the tree was the same size before. The owner's answer,
relayed by the coordinator from its chat ("Please go with your recommendations"): the volcano lands; no Plague rule
change now; the gap is written into DEV-034.

**The measured cause** (`mapgen_land_plague.rs`'s own definitions, option on; BEFORE = `agent/opus/P-MAPGEN-GUARANTEES-1`
@ `c64934582`, AFTER = this branch before the notes below; raw output in the lane's scratchpad, `before2.txt` and
`after2.txt`):

| Measure | BEFORE 1-32 | AFTER 1-32 | BEFORE 1-96 | AFTER 1-96 |
|---|---|---|---|---|
| Pools Small / Medium / Large | 53 / 16 / 2 | 51 / 15 / 0 | 162 / 36 / 2 | 148 / 36 / 0 |
| Pools near / mid / far | 2 / 38 / 31 | 0 / 34 / 32 | 2 / 124 / 74 | 0 / 104 / 80 |
| Maps where a whole Large body fits in the near band (barrows giving way) | 2 | 0 | 2 (seeds 10, 20) | 0 |
| The same with barrow sites kept | 0 | 0 | 0 | 0 |
| Plague zone tiles (every map) | 4936 | 4936 | 4936 | 4936 |
| Plague floor, median | 4518 | 4502 | 4517 | 4517 |
| Usable near-band ground, median tiles | 276 | 284 | 283 | 290 |
| Plague camps (every map); buildings, mean | 10; 1.8 | 10; 1.9 | 10; 1.8 | 10; 1.8 |
| Styler bog, total | 4974 | 4789 | 13266 | 12623 |
| FloorShare refusals, total | 0 | 1 | 0 | 4 |
| Smallest zone | Sentenced 25, Plague 5, Fire 2 | Fire 32 | Sentenced 77, Plague 16, Fire 3 | Fire 96 |
| Largest over smallest zone floor, median (max) | 1.043 (1.062) | 1.128 (1.150) | 1.043 (1.075) | 1.129 (1.150) |

Chance on a nearly empty band. Since P-MAPGEN-SIG-SCALE-3 made the tree 29 x 29, a Large pool near the tree appeared
on 2 maps of 96, and only by taking barrow sites: the near band tries only Large (`POOLS.bands`), and a Large body is
at least two discs with a two-tile ring of plain floor. The volcano took no ground from Plague (zone, floor, camps and
buildings unchanged; usable near ground slightly up); `repair`'s floor-share step only refuses an attempt and moves no
tile. The base test "all three sizes occur" passed on seeds 10 and 20 alone. The lane had noted "close to vacuous" in
P-LAND-PLAGUE-1-fix-3's brief and did not put it to the owner: that was the lane's mistake.

**What the branch does about it** (`oracle:` commit on the packet branch): the two amended tests stay, their comments
state the measured cause, and a new test, `known_gap_no_large_pool_and_no_pool_near_the_tree_on_seeds_1_to_32`, pins
the gap as a fact (0 Large, 0 near-band pools on seeds 1-32) with a message naming DEV-034: it fails when the direction
starts being delivered, and tests 4 and 5 are then restored to their full form.

**The owner's floors on the moved maps** (seeds 1-32, the tests' own measures):

| Floor | BEFORE (margin) | AFTER (margin) |
|---|---|---|
| Plague marsh plus pools against option off, median (floor 0.8) | 1.071 (+0.271) | 1.037 (+0.237) |
| Plague pools alone, share ratio median (floor 0.35) | 0.594 (+0.244) | 0.480 (+0.130) |
| Plague barrows, on over off totals (floor 55%) | 61.2% (+6.2 points) | 64.7% (+9.7 points) |
| Sentenced lanes plus churchyard fence against option off, median (floor 0.75) | 0.820 (+0.070) | 0.836 (+0.086) |
| Sentenced lanes alone, median (floor 0.45) | 0.532 (+0.082) | 0.551 (+0.101) |

Plague pools alone is the margin to watch (0.244 to 0.130); its cause is not established beyond the maps moving.

**The review's two code notes, fixed** (three commits on the agent branch; no map moved, nothing re-pinned; rh-sim
1530 passed, 0 failed):
1. `intact`'s door check is exact (`doors_intact`): each entrance tile holds what its landmark's entrance glyph writes
   (the volcano's outlets: LOW with the lava terrain, owned by Fire's Volcano feature; the church gate, the tree's
   causeways and the cave mouth: floor that no feature of their own landmark owns). Four in-crate tests: the outlets as
   built pass; an outlet turned to a volcano wall, a church doorway turned to an owned church wall and a cave mouth
   tile owned by the cave fail. Not changed: an entrance tile owned by another allowed feature (a bush, a legacy
   landmark, infill) still passes, as before the volcano; requiring "fully unowned" could refuse maps accepted today
   and would be its own change.
2. One definition for the fan: the Prefix computes the fans once from its context's definition and records them
   (`AttemptState::fans`, empty with the option off); the camp reserves and the legacy landmark stage both read that
   record; the stage's `DEFAULT_DEFINITION` read is gone.

## What this build adds to the first one (as the implementer reported it; the red lists below are history)

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

- The record text above (ADR 0028 is already edited on this branch; the `DEVIATIONS.md` row is the coordinator's to
  number and the owner's to sign).
- Re-take the pins on the merged tree (list in "Final state").
- The look-capture tool (`Assets/Editor/Look/LookCapture.cs`) frames the volcano with fixed camera numbers: the
  smaller cone sits smaller in its two edge frames.
