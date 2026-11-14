# P-MAPGEN-SIG-SCALE-2: the Sentenced church, its graveyard and its churchyard are the approved 29 x 29 drawing

- **Serves:** owner direction 2026-11-12 late (MIGRATION: the landmarks "a lot larger"); owner decision 2026-11-13
  (requirements L1 and L2 in `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`; ADR 0028 rule G9; the five blueprints
  approved, `docs/landmarks/blueprints/church.txt` redrawn with the churchyard the same day). Second of four
  (P-MAPGEN-SIG-SCALE-1, the cave, is the worked example).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase, the certifier's signature row)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ 2e51457dd (SCALE-1 and RESERVE-1 merged). **Rebased once
  P-MAPGEN-STYLE-REFUSE-1 merges** (it lands before this implementation; see section 2).
- **D-rules touched:** D1: option off byte- and draw-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim
  tick, wire or content-hash change (the drawing is a `signature::Definition` field; `SIGNATURE_KINDS` and
  `DEFAULT_DEFINITION` are `NON_GAMEPLAY` rows of `tests/content.rs`) · D5/D6/D9 untouched.
- **Status:** oracle written (2026-11-13, oracle author, Opus). **Two owner decisions are open before the full gate can
  be green** ("What the owner must decide").

## What the owner must decide (oracle author, 2026-11-13; measured with a throwaway prototype on this branch's base)

1. **The Sentenced lane fence share falls below the owner's bound.** `mapgen_land_sentenced.rs`
   `lane_fence_share_stays_near_option_off` (median on/off ratio at least 0.6; 0.71 today) measures **0.529** with
   the blueprint church (seeds 1-32; per seed 0.38-0.72; 25 of 32 under 0.6). Why: the 29 x 29 box and its 2-tile
   apron (33 x 33) hold **23.4 %** of today's lane fence (1750 of 7480 tiles over seeds 1-32; per seed 18-30 %,
   median 23 %), and the churchyard's own fence is not lane fence (`FenceRow`) in that measure. 0.71 x (1 - 0.23) is
   about 0.55: the drop is the box, not a lanes fault. Every other test of that file stays green
   (`every_seed_keeps_its_lanes`, floor 0.3, included). The bound is the owner's: lower it, count the churchyard
   fence in the share, or accept the test red. This oracle does not change it.
2. **Five existing tests pin the old church and must be amended** (owner/coordinator approval; not edited here). Under
   the prototype exactly these fail, everything else in the nine `mapgen_signature_*`/`mapgen_land_sentenced` targets
   passes:
   - `crates/rh-sim/tests/mapgen_signature_core.rs` `shape_church_encloses_the_far_elite_camp_with_a_door_to_the_front`
     ("seed 1: footprint is not the church's box": it pins footprint == `Church` box, door on the footprint edge and
     "door shut seals the camp"). Proposed: drop it; the new oracle's tests (i)-(iv) cover the church.
   - same file, `shape_graveyard_headstones_are_mirrored_about_the_door_at_one_gap` ("seed 1: stone tile (5, 16) is
     not wall": the churchyard fence is LOW). Proposed: drop it; blueprint equality covers the graveyard.
   - same file, `g3_the_finished_map_carries_the_zone_anchors` ("seed 1: Sentenced footprint": it asserts
     `footprint == Church bbox`). Proposed: for the Sentenced anchor compare with the union of the `Church` and
     `Graveyard` boxes (agreed guard (iii)); the rest unchanged.
   - `crates/rh-sim/tests/mapgen_signature_scale.rs` `the_other_three_landmarks_are_unchanged` (its digest includes the
     church). Proposed: drop the church from that digest, or retire it in favour of this oracle's
     `the_other_three_landmarks_are_unchanged` (volcano, tree, cave), which the prototype keeps green.
   - `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` unit test `only_the_frost_sites_tiles_take_its_camps_label`
     (it asserts a Sentenced site is NOT relabelled). It is in this packet's write scope; the implementer amends it to
     "the Frost and the Sentenced sites take their camps' labels" (approval asked here because it is an existing test).

## 1. ID and outcome

In signature mode the Sentenced landmark IS the approved drawing `docs/landmarks/blueprints/church.txt`: 29 x 29 tiles,
front (toward the coliseum) at the bottom. Character by character:

| Grid | Map tile | Owner | Terrain |
|---|---|---|---|
| `#` church wall, `P` pillar | wall | the `Church` feature (job landmark) | 0 |
| `G` headstone | wall | the `Graveyard` feature (job cover) | 0 |
| `+` fence (plots and churchyard) | LOW | the `Graveyard` feature | `R.fence_kind` (2, the styler's fence) |
| `.`, `D` door, `E` camp, `*` lantern mark | floor, unwritten | none | 0 |

- **One `Graveyard` feature** holds the plots and the churchyard fence: seven existing test files assert exactly one
  `Graveyard` (`single(..)` in `core`, `scale`, `fire`, `frost`, `frost_lake`, `reserve`, and this oracle).
- **Placement** as the cave (SCALE-1's rule): rotation `u = axis(front(camp))`; the mirror one draw (`pick(rng, 2)`) of
  the Sentenced stream (the stream the Prefix began, after the site's draw), the church's only draw; `E` on the
  Sentenced site's camp tile. Box offsets from the site's corner: (2, 3) toward +x, (3, 3) toward -x, (3, 2) toward +y,
  (3, 3) toward -y (measured, 64 of 64 seeds), always inside the inner rect.
- **Features as the lanes read them (agreed with the land-generation session):** (i) the `Church` feature is the
  building only (`#`, `P`; box grid columns 3-25, rows 3-16) and its anchor point `(ax, ay)` is the camp tile (the lanes
  take the front from it, `lanes.rs:79`); (ii) on that box's door-side edge exactly three tiles are open (unowned
  floor): the `D` door; (iii) the union of the `Church` box and the `Graveyard` box is the anchor's footprint (the
  `Graveyard` box alone is the whole 29 x 29: the churchyard fence reaches every edge).
- **Anchor:** kind `Church`, centre the camp tile (strictly inside), footprint the 29 x 29 box, entrance the main
  gate's five tiles (grid row 28, columns 12-16), front the DIR16 index as today. `SignatureContext::finish` must not
  overwrite the footprint with the `Church` box (today it re-reads `footprint = f.bbox` of the first feature of the
  anchor's kind, `mod.rs:670-683`).
- **Refusal:** a solid tile (`#P G +`) not `Site::wall`, any other tile not `Site::floor`, the two tiles beyond each
  main-gate tile not `Site::open`, a wall piece under `R.piece_min`, or the walls and fence splitting the zone's floor:
  `None` (`Refusal::Signature`). The prototype never refused one (0 `Signature` refusals on seeds 1-64).
- **Certifier and intact:** `SIGNATURE_KINDS`' `Graveyard` row (`certify/rules.rs:196`) becomes `low: true, terrain:
  R.fence_kind`; `SignatureContext::intact` (`mod.rs:722`) accepts a `Graveyard` tile that is wall with terrain 0 or
  LOW with the fence terrain. With both, the certifier's fence rules (detour, run at most 9) pass on every seed.
- **Territory relabel:** `relabelled_zones()` (`mod.rs:220`) lists the Sentenced site with the Frost site.
- **Without a reserved site** (`begin_attempt` prefixes, which only tests feed: `mapgen_signature_fire.rs:754`,
  `mapgen_signature_fire_bands.rs:456`) the rule-drawn church stays; its removal is a follow-up with the cave's
  (hand-over section 1), so `church_side`, `graveyards`, `grave_gap`, `door_shift` stay in `Definition`.

## 2. Dependencies

- P-MAPGEN-SIG-RESERVE-1, P-MAPGEN-SIG-SCALE-1: merged (in the base).
- P-MAPGEN-STYLE-REFUSE-1 (unmerged; `packet/P-MAPGEN-STYLE-REFUSE-1`): lands first. It turns the lanes' unreadable
  door into a refused attempt and adds `tests/mapgen_style_refusal.rs`, whose guard pins that today's landmarks are
  never refused round on seeds 1-32. This branch is rebased on it once it merges; this packet touches
  `pipeline/mod.rs` not at all (the relabel call is already there, `pipeline/mod.rs:363`), so the rebase is clean.
  Re-run that guard after the rebase: with the blueprint the lanes' door read must still never fail (guards (i)-(ii)).

## 3. Relevant legacy paths

None: no legacy counterpart (DEV-020; legacy has no church). The code this packet changes:
`signature/church.rs:33-228` (`place`, today's rule-drawn church; with `camp` it becomes the blueprint),
`signature/mod.rs:134,194` (`church_grid`), `:220` (`relabelled_zones`), `:670-683` (`finish`), `:722` (`intact`),
`:1048` (the relabel unit test); `certify/rules.rs:196` (`Graveyard` row). Read, not changed:
`style_gallows/lanes.rs:73-125` (`frame`), `signature/cave.rs:89-228` (the cave's `Blueprint` and placement, the
pattern to copy or share).

## 4. New paths

- `crates/rh-sim/src/mapgen/landmarks/signature/church.txt` (stub commit): byte-equal copy of the docs drawing.
- `crates/rh-sim/tests/mapgen_signature_church.rs` (oracle commit).

## 5. Exclusive write scope

- `crates/rh-sim/src/mapgen/landmarks/signature/church.rs` (the blueprint placement)
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` (`church_grid = include_str!("church.txt")`, parsing, the
  relabel list, `finish`, `intact`, the unit test above)
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.rs` only to share the cave's `Blueprint` parser/`land`
  (optional; the cave's behaviour must not move)
- `crates/rh-sim/src/mapgen/certify/rules.rs`: the `Graveyard` row of `SIGNATURE_KINDS` only
- `crates/rh-sim/src/mapgen/landmarks/signature/church.txt` only if the docs drawing changes (byte-equal)
- `docs/adr/0028-signature-landmarks.md` (decision 5 rewritten for the blueprint; G9's "not yet built" note; decision
  12's relabel sentence)
- Not in scope: `style_gallows/` (the lanes need no change: under the prototype they read the door on every seed),
  `pipeline/mod.rs`, `crates/rh-mapdress/**` (the coordinator re-pins its digests at merge), every test file except
  the unit test named above.

## 6. Contracts and references

ADR 0028 G1-G10, decisions 5, 11, 12; C-PARITY (option off byte-identical, G8); `rh-sim` determinism (no hash-ordered
collections; the signature stream only); `tests/content.rs` (no new `const`; the grid is a `Definition` field).

## 7. Behaviour to preserve

- Option off: byte-identical and draw-identical (`option_off_is_todays_generator` here and the G8 guards elsewhere).
- Option on: the volcano, bog tree and cave the Landmarks phase places are exactly today's
  (`the_other_three_landmarks_are_unchanged`, digests pinned on the stub commit, equal under the prototype); every zone
  keeps its landmark; every map certifies clean; the apron rule; the attempt bounds (70, 7).
- The church draws exactly one value (the mirror) from the Sentenced stream.

## 8. Acceptance checks

- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_church` green (6 tests red on the
  oracle commit).
- Every other `mapgen_signature_*` target and `mapgen_land_sentenced` green, except the tests listed under "What the
  owner must decide" until the owner rules.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-2`.
- The ignored `report_seeds_1_to_64` quoted in the hand-off.

## Oracle files (read-only for implementers)

- `crates/rh-sim/tests/mapgen_signature_church.rs`
- `docs/backlog/packets/P-MAPGEN-SIG-SCALE-2.md`
- The stub commit's files are the implementer's: `signature/mod.rs` (the empty `church_grid` must become
  `include_str!("church.txt")`; `relabelled_zones` is public so the oracle can read it) and `signature/church.txt`
  (must stay byte-equal to the docs).

## The oracle (`crates/rh-sim/tests/mapgen_signature_church.rs`, seeds 1-32, first accepted attempt)

Red on the oracle commit (assertions):
- `the_generators_church_blueprint_is_the_approved_drawing`: the drawing's facts (below) hold; then
  "signature::DEFAULT_DEFINITION.church_grid (0 bytes) is not byte-equal to docs/landmarks/blueprints/church.txt".
- `the_church_is_the_blueprint_under_one_of_eight_orientations`: tile equality (section 1's table) under the
  orientations of exactly one front direction; the two features own nothing else.
- `the_church_box_is_the_building_and_the_boxes_fill_the_footprint`: guards (i)-(iii).
- `the_sentenced_anchor_is_the_blueprint_box_facing_the_coliseum_inside_the_site`: guard (iv), centre strictly inside,
  box inside the inner rect, front.
- `every_front_direction_occurs`: the directions used are the sites' front axes (at least two).
- `the_sentenced_site_is_relabelled_with_the_frost_site`: `relabelled_zones()` is the Sentenced and Frost sites.

Guards (green on the oracle commit and under the prototype): `the_elite_camp_stands_at_the_anchor_and_its_halo_is_free`,
`every_zone_keeps_its_landmark_and_every_map_certifies_clean`, `no_landmark_stands_in_another_landmarks_apron`,
`option_off_is_todays_generator`, `the_other_three_landmarks_are_unchanged`, `the_worst_attempt_stays_within_the_bound`
(<= 7), `the_attempts_used_stay_within_the_bound` (<= 70). Ignored: `report_seeds_1_to_64`.

Not proved: seeds beyond 32 (the report covers 1-64); the mirror draw (see Corrections, 1); that the relabel covers
exactly the site (only the list and its effect on the bounds); the time per map; the `rh-mapdress` digests; the
lanes' share (owner decision 1).

## Measurements (seeds 1-64, option on, debug test build, macOS arm64; the prototype was reverted before the commits)

The prototype (about 180 changed lines): `church::place` with `camp` placed the drawing as in section 1 (its own
parser; main-gate doorway checked with `Site::open`), `finish` took the union of the `Church` and `Graveyard` boxes,
`intact` and the `Graveyard` certifier row accepted LOW fence, `relabelled_zones` = Sentenced and Frost. The oracle
file passed in full under it (13 tests).

| run | attempts 1-32 | worst 1-32 | attempts 1-64 | worst 1-64 | seeds without a map |
|---|---|---|---|---|---|
| today (cave + lanes merged; hand-over) | 59 | 4 | 132 | 9 | 0 |
| **blueprint church + Sentenced relabel (prototype)** | **60** | **5** (seed 32) | **140** | **7** (seed 33) | 0 |

- Refusals (1-64): `SignatureDiscarded` 50, `Prefix` 12, `Repair(RadiusPost)` 9, `SpawnRatio` 5, `Signature` 0.
- Box 29 x 29 on every seed, offsets as section 1. Fronts seen: all four directions.
- Lanes: see owner decision 1 (0.529 against 0.6; 23.4 % of today's lane fence lies in the box plus apron).
- The relabel alone was not measured without the church (the cave's history says it is needed: 396 to 132 attempts).

## Corrections (brief, hand-over and code against the grid; the grid wins)

1. **The drawing is mirror-symmetric** (every row reads the same both ways), so a mirrored and an unmirrored church
   land the same tiles: "exactly one of the eight orientations" and "both mirror states seen" cannot be checked. The
   oracle requires exactly one front direction (both mirror states match) and checks no mirror. The one mirror draw is
   kept for uniformity with the cave (it costs nothing: nothing else draws after it on the Sentenced stream); a
   later asymmetric redraw needs no code change.
2. **Gate count:** row 0, column 0 and column 28 hold three 3-wide gates each; row 28 two 3-wide plus the 5-wide main
   gate: eleven 3-wide gates, twelve gates in all (verified). Fence runs at most 5; the corner pieces are 9 tiles
   (5 + 5 - 1), the plot-corner pieces 4 tiles (LOW, so `piece_min` does not apply: the certifier's `pieces` rule
   counts walls only).
3. **The graveyard's rows:** headstones are rows 21-23; the plot fences rows 19-25; "graveyard rows 17-27" is the
   band between the door line and the churchyard fence (verified: nothing of the graveyard lies outside it).
4. **Every listed fact verified against the grid:** building columns 3-25, rows 3-16; door row 16 columns 13-15, the
   only gap in that wall line; `E` (14, 7); main gate columns 12-16 of row 28; door line to main gate 12 rows, equal to
   `style_gallows::LANES.period` (the oracle asserts it).
5. **Amendment bullet "the elite camp's spot (9 tiles from the site's far edge)":** holds as RESERVE-1 places the camp
   (`site_depth` 9, `E` 7 rows into the drawing, 2-tile apron).
6. **Section 1-11 of the earlier brief (target 30 / floor 28, pillars measured statistically, graveyard may leave the
   site, `style_gallows/` in scope) is superseded** by the amendments and this rewrite; history in git
   (`2e51457dd`).
7. **`finish` and the anchor footprint:** the hand-over says "the anchor's footprint is the blueprint box"; the code
   re-reads the footprint from the `Church` feature (`mod.rs:670-683`), which under (i) is the building only. The
   implementation must change `finish` (included above).
8. **Lantern marks `*`** are plain unwritten floor: nothing delivers them to the client; it must derive them (two beside
   every gate) if the art wants them.

## 9. Validation commands

- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_church`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_sentenced --test mapgen_signature_core --test mapgen_signature_scale --test mapgen_signature_aprons --test mapgen_signature_reserve --test mapgen_signature_frost --test mapgen_signature_frost_lake --test mapgen_signature_fire --test mapgen_signature_fire_bands`
- `cargo test -p rh-sim --features trusted-status-probes --lib signature`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_church -- --ignored --nocapture report_seeds_1_to_64`
- `cargo test -p rh-sim --test content`
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-2`

## 10. Risk and suggested model tier

Opus. About 180-250 changed lines (the prototype was 180 without the ADR): one packet, not cut. Every option-on map
moves (expected). The certifier row change applies to every option-on map; option off carries no `Graveyard`.

## 11. Known traps

- Do not `include_str!` the docs file (the server image's build context has no `docs/`); the crate's copy stays
  byte-equal (the oracle checks).
- The main gate's doorway lies in the site's apron: check it with `Site::open`, not `Site::floor`.
- The `Church` feature's anchor point must be the camp tile: `lanes::frame` reads the front from `(ax, ay)`.
- The door tiles stay unwritten and unowned: `lanes::frame` counts only unowned floor as open.
- One `Graveyard` feature, not one per plot (seven test files assert one).
- Fence terrain is `R.fence_kind` (2, home Sentenced in `certify::rules::TERRAIN`); terrain 0 on LOW fails
  `feature-kind-tiles` once the row's terrain is set.
- `smallest_piece` on walls only (plot-corner fence pieces are 4 tiles).
- `tests/mapgen_land_sentenced.rs` measures `along` from the anchor's entrance (the main gate), the code from the
  door line: they agree only because the distance is 12, one gate period.
- `tests/content.rs` rejects a new `const` holding the grid.

## Notes from previous attempts

## Notes from the coordinator (cross-session, 2026-11-13 evening), recorded by the land-generation session
- **What the Unity art reads (P-UNITY-LANDMARK-*, built against `church.txt`).** It finds the building as the largest
  8-connected wall group in the anchor's footprint, and the door as one contiguous run of non-wall tiles on that
  group's box border, off the corners. The anchor's `entrance` is the five main-gate tiles. The headstone groups are
  2 wide by 3 tall (four groups of six) and the pillar blocks are separate wall groups inside the building's box. All
  of this follows from the tiles being the drawing; nothing may be written beside the drawing that would make another
  wall group larger than the building or open a second gap on the building's border.
- **The wire guard.** `crates/rh-server/tests/map_anchor_seeds.rs` (on `feature/unity-rework` from `cbe6d639b`) checks
  seeds 1-8 anchors against every wire rule: centre strictly inside the footprint, entrances on the map, kind code
  known. This packet must keep it green; this branch is rebased onto the integration head before implementation.
- **The refusal guard.** `todays_landmarks_are_never_refused_round_on_seeds_1_to_32`
  (`crates/rh-sim/tests/mapgen_style_refusal.rs`, P-MAPGEN-STYLE-REFUSE-1) must stay green as written if guards (i)
  and (ii) hold. Nothing in production notices `StyleLandmark` refusals becoming frequent (the trace stops at
  `Spawns`; `certified_styled` and the map pool drop the reason), so that test is the only watch. If this packet
  legitimately produces door refusals, the guard changes only to a bound plus a digest pin, with the owner's approval
  through the coordinator.
- **Open with the owner (land-generation session's chat):** the lane-fence share floor. With the box, the lanes alone
  measure 0.529 against 0.6; the drawing itself holds 106 fence tiles (74 on the churchyard's outer rows, 32 round the
  plots) that `mapgen_land_sentenced.rs` does not count.
