# P-MAPGEN-SIG-SCALE-3: the Plague bog tree is the approved blueprint (one fixed 29 x 29 tree, closed marsh, three causeways)

- **Serves:** owner direction 2026-11-12 late (MIGRATION: the landmarks "a lot larger"); owner decision 2026-11-13
  (requirements L1 and L3 in `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`; ADR 0028 rule G9; the five
  blueprints approved: `docs/landmarks/blueprints/`). Third of four (P-MAPGEN-SIG-SCALE-1 is the worked example).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework @ cbe6d639b (rebased by the coordinator from 2e51457dd; the cave,
  P-MAPGEN-SIG-SCALE-1, and the anchors on the wire, P-WIRE17-MAP-3 with `crates/rh-server/tests/map_anchor_seeds.rs`,
  are in it).
  P-MAPGEN-SIG-SCALE-2 (the church) has **not** landed: its stub adds a grid field to the same `Definition`; the two
  are rebased in order by the coordinator (a one-line conflict in `signature/mod.rs` at most).
- **D-rules touched:** D1: option off byte- and draw-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim
  tick, wire or content-hash change
- **Status:** oracle written (2026-11-13, oracle-author, Opus) on `packet/P-MAPGEN-SIG-SCALE-3`.

## What the owner must know (oracle author, 2026-11-13; measured on 2e51457dd and again on cbe6d639b with the same numbers, seeds 1-64, option on)

| run | attempts 1-32 | worst index 1-32 | attempts 1-64 | worst index 1-64 | seeds without a map |
|---|---|---|---|---|---|
| today (the rule-drawn tree, the blueprint cave) | 59 | 4 (seed 14) | 132 | 9 (seed 33) | 0 |
| **the fixed tree (this packet's prototype)** | **46** | **2** (seed 12) | **109** | **6** (seed 52) | 0 |

- The fixed tree costs no extra attempts: fewer than today on both ranges. It never refused an attempt: in the 99
  attempts that reached the Landmarks phase every one of the 841 tiles was legal (walls and marsh free Plague floor off
  every halo and apron, dry tiles free Plague floor), no wall piece under `piece_min`, the zone's floor never split.
- **No territory relabel is needed.** `Repair(RadiusPost)` 6 over seeds 1-64 (today 8). The Plague site has no inside
  camp, so there is no label to give, and the measurement shows the tree's walls (155 tiles) do not drive repair's
  radius refusals up. `relabelled_zones()` stays `[Frost]` (SCALE-2 adds Sentenced).
- Refusals by reason, seeds 1-64: fixed tree `Prefix` 10, `Repair(RadiusPost)` 6, `SignatureDiscarded` 26,
  `SpawnRatio` 3; today `Prefix` 12, `Repair(RadiusPost)` 8, `SignatureDiscarded` 48, `SpawnRatio` 0. Not split here:
  which end-of-attempt check (lake, apron, intact) each `SignatureDiscarded` was; the three `SpawnRatio` refusals are new
  (every later step sees a different map) and were not traced.
- The oracle's bounds are today's numbers, not the cave's (70 and 7): at most 59 attempts and worst index 4 on seeds
  1-32 (the fixed tree must not cost more than today's tree). Measured 46 and 2 with one mapping of the mirror draw;
  the same with the other mapping (every seed of 1-64 lands on the same attempt; only the mirror flags swap).

## 1. ID and outcome
In signature mode the Plague bog tree IS the approved drawing `docs/landmarks/blueprints/bog.txt`: 29 x 29 tiles, front
(toward the coliseum) at the bottom; `T` trunk (93 tiles, an 11 x 11 disc round the drawing's centre (14, 14)) and `r`
root (62 tiles) are wall tiles owned by the tree (terrain 0); `%` is the tree's marsh (213 tiles: floor with the bog
terrain, owned by the tree); `.` dry floor (411) and `:` the three dry causeways (62 tiles, each 2 wide) stay
unwritten plain floor. The marsh is closed all round but for the causeways: dry ground from the trunk reaches the box's
edge only over a causeway (checked offline on the drawing). The drawing is not symmetric under any of the square's seven
non-trivial symmetries, so the eight orientations are eight different layouts. One size; nothing else varies but the
site (RESERVE-1), the rotation and the mirror:
- **Position:** the drawing's centre (14, 14), the trunk's centre, on the Plague site's centre tile
  `(rect.x + rect.w / 2, rect.y + rect.h / 2)` (offset (17, 17) at side 34; the tile `inside_camp` measures the front
  from). The box is then the centre +- 14 both ways in every orientation and mirror: offset (3, 3) from the site's
  corner, inside the inner rect (offsets 2-31) with one free inner-rect tile on the low side of each axis. (The site has
  no camp; this oracle proposed the centre rule, orientation-free with no choice to draw; accepted with the anchor.)
- **Rotation:** the front row faces the dominant axis of DIR16 from the centre tile toward the coliseum
  (`axis(front(centre))`, the cave's rule).
- **Mirror:** one draw of the Plague zone's signature stream (`ReservedSite::stream`, after the reservation's draw):
  the tree's only draw. Any fixed mapping of the draw to the flag; the oracle checks only that both occur.
- **Anchor:** zone Plague, kind `BogTree`; `centre` the site's centre tile (= the feature's anchor point `(ax, ay)`, a
  trunk tile, strictly inside the footprint); `footprint` the 29 x 29 box; `front` the DIR16 index from the centre;
  `entrance` **the causeway openings: the six `:` tiles on the drawing's outer rows and columns** (grid (12, 0),
  (13, 0) on the back row, (0, 11), (0, 12) on the left column, (13, 28), (14, 28) on the front row), placed. Six
  tiles, where the cave has three and the church five; the wire's cap is `MAX_ANCHOR_ENTRANCE` = 16
  (`rh-protocol/src/map.rs:119`). Under the prototype `cargo test -p rh-server --test map_anchor_seeds` passes (centre
  strictly inside the footprint, entrance on the map, under the cap, the served anchors equal the generator's).

**Anchor accepted (coordinator, 2026-11-13 evening).** The oracle author proposed the anchor above; the coordinator
accepted it, so it is no longer a proposal:
- Anchor: footprint the 29 x 29 box; centre grid (14, 14); entrance the six causeway tiles on the box's edge, (12, 0),
  (13, 0), (0, 11), (0, 12), (13, 28), (14, 28) in the drawing's coordinates, turned and mirrored with the box.
- The Unity art (P-UNITY-LANDMARK-4) stamps exactly that anchor, draws no gate at the entrances, and reads everything
  else from the delivered tiles: the trunk is the largest 8-connected wall group in the footprint, the stumps are the
  other wall groups, and the canopy cover is dry floor near the trunk.
- So the generator must keep: the trunk with its roots ONE wall group; the three stumps separate wall groups NOT
  touching it (8-connected, so not even diagonally); bog as floor with terrain bog; causeways plain floor.
- Verified on the grid (oracle author): under 8-connectivity the drawing's walls are exactly four groups, 137 (the
  trunk with its three roots) and three stumps of 6, none touching the trunk group even diagonally; 4-connectivity gives
  the same four groups. `the_generators_bog_blueprint_is_the_approved_drawing` pins this (8-connected `piece_sizes` =
  6, 6, 6, 137). Every stump and its eight neighbours lie inside the box, so `the_bog_tree_is_the_blueprint_under_one_of
  _eight_orientations` (tiles equal the drawing, the tree owns nothing else) implies the same groups inside the
  footprint on every generated map; no further test is needed. The generator and the certifier count the same way as
  the art: `smallest_piece` (`church.rs:231-255`) and the certifier's `pieces` rule (`certify::components(.., true)`)
  are both 8-connected, so there is no 4/8 difference to note.
- **Refusal:** any `T`/`r` or `%` tile not `Site::wall && Site::ground` (free Plague floor inside the inner rect, off
  every camp halo, off the legacy landmark protection and every apron marked before), any `.`/`:` tile not
  `Site::floor`, a wall piece under `R.piece_min` (the stumps are exactly 6 = `piece_min`), or the zone's floor split:
  the attempt is refused (`Refusal::Signature`). Never served smaller.
No size search, no `bog_min`, no quadrant rule, no outer-third test (the site carries it).

## 2. Dependencies
- P-MAPGEN-SIG-RESERVE-1 and P-MAPGEN-SIG-SCALE-1 (merged in the base).
- P-MAPGEN-SIG-SCALE-2: independent in behaviour (the church is placed before the tree on its own stream), rebased in
  order with this packet on `signature/mod.rs` (both add one `Definition` field and its default).
- Downstream (not in this packet): `agent/opus/P-LAND-PLAGUE-1` and its fix (free bog pools by band from the tree, new
  kind `BogPool`) are rebased onto this packet by the coordinator; see "What the Plague styler reads".

## 3. Relevant legacy paths
- None: no legacy counterpart (DEV-020). The code this packet changes (line numbers on the stub commit):
  `signature/bog_tree.rs:11-107` (`place`: the rule-drawn trunk, dry ring, two bog bands by squared distance,
  `bog_min`, quadrants, outer-third line, uniform draw over legal centres); `signature/mod.rs:43-53` (`trunk_d2`, `bog`,
  `dry_d2`, `bog_d2`, `bog_min`, `outer_slack`), `:123-133` and `:192-193` (the cave's and the stub's grid fields and
  defaults), `:280-287` (`axis`), `:550-615` (`apply`: the Plague stream, `reserved`, the tree's call at `:603`),
  `:617-663` (`write`: the feature's `bbox` is the bounds of its written cells), `:668-700` (`finish`: the footprint is
  re-read from the feature's `bbox`), `:707-736` (`intact`: the `BogTree` row at `:716-719` accepts wall/terrain 0 and
  floor/bog); `cave.rs:105-152` (`Blueprint::parse`, `land`) and `:161-228` (`blueprint`, the worked example);
  `church.rs:231-255` (`smallest_piece`, 8-connected); `certify/rules.rs:179-186` (the `BogTree` row: wall, no LOW, job
  landmark), `certify/features.rs:216-247` (`feature-hazards`: unowned floor with terrain fails, `:222`; the marsh is
  owned), `:353-360` (`pieces`: every wall piece of a strict zone at least `piece_min` = 6).

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/bog.txt` (stub commit): the generator's byte-equal copy of the drawing.
- `crates/rh-sim/tests/mapgen_signature_bog_tree.rs` (oracle commit).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/bog_tree.rs` (the blueprint placement; the rule-drawn tree stays for the
  no-reservation path, see "The old tree")
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs`: only `DEFAULT_DEFINITION.bog_grid`'s value
  (`include_str!("bog.txt")`), the doc comment of `bog_grid`, the `Zone::Plague` call in `apply` (pass the reserved
  rect), optionally one `SignatureContext` field holding the parsed grid (as `cave`), and the `apply`/`intact` doc
  comments where they describe the tree. Nothing else in this file (SCALE-2 edits it too).
- `crates/rh-sim/src/mapgen/landmarks/signature/bog.txt` (only if the docs drawing changes: it must stay byte-equal)
- `docs/adr/0028-signature-landmarks.md` (decision 4 rewritten for the blueprint; G9's "not yet built" note names the
  tree as built; the Measurements section)
- Not in scope: `style_warren/` (no change needed: see below), `crates/rh-mapdress/**` (the coordinator re-pins its
  digests at merge), every existing test (the three amended below are oracle files).

## 6. Contracts and references
- ADR 0028 G1-G10, decisions 3, 4, 11, 12; C-PARITY (option off byte-identical, G8); `rh-sim` determinism rules (no
  hash-ordered collections, no clock; the signature stream only); `tests/content.rs` (no new `const`: the grid is a
  `Definition` field; `DEFAULT_DEFINITION` is already a `NON_GAMEPLAY` row).

## 7. Behaviour to preserve
- Option off: byte-identical maps, not one draw changed (no site, no blueprint): `option_off_is_todays_generator` here
  and the `g8`/`option_off` guards of the other signature oracles.
- Option on: the volcano, church and cave are exactly today's (`the_other_three_landmarks_are_unchanged`, seeds 1-8,
  attempts 0-1, digests pinned on the stub commit, i.e. today's generator, and equal under the prototype); every zone
  keeps its landmark; every map certifies clean under `Strict::All`; the apron rule; the attempt bounds.
- The tree draws exactly one value (the mirror) from the Plague stream, after the reservation's draw (today it draws one
  or more `pick`s over legal centres).
- The tree keeps out of the aprons marked before it (`Site::ground` for walls and marsh). Seeds 34 and 49 (tree against
  cave at FROST-2): both land under the prototype (34 on attempt 1, 49 on attempt 0); the end-of-attempt apron rule held
  on every accepted map of seeds 1-32 (`the_apron_rule_holds`).
- The content hash does not move.
- The rule-drawn tree without a reservation (`begin_attempt` prefixes, which only tests feed the step) is unchanged:
  `mapgen_signature_fire.rs` `note1_the_bog_tree_site_keeps_out_of_marked_aprons` runs on it and stays green.

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_bog_tree` green (4 tests red today).
- Every other `mapgen_signature_*` target green, the three amended tests included (green under the prototype), and
  `cargo test -p rh-server --test map_anchor_seeds` green.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-3` passes (the coordinator runs the full gate and re-pins
  the `rh-mapdress` digests).
- The ignored `report_seeds_1_to_64` prints the table's columns; the implementer quotes it in the hand-off.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_bog_tree.rs` (new)
- `crates/rh-sim/tests/mapgen_signature_core.rs` (amended: `g3_the_finished_map_carries_the_zone_anchors`,
  `shape_bog_tree_stands_in_the_outer_third_ringed_by_bog`)
- `crates/rh-sim/tests/mapgen_signature_scale.rs` (amended: `the_other_three_landmarks_are_unchanged`)
- `docs/backlog/packets/P-MAPGEN-SIG-SCALE-3.md`
- The stub commit's files (`signature/mod.rs`: the empty `Definition::bog_grid`; `signature/bog.txt`) are the
  implementer's: the field must hold `include_str!("bog.txt")`, and the copy must stay byte-equal to the docs.

## The oracle (`crates/rh-sim/tests/mapgen_signature_bog_tree.rs`, seeds 1-32, first accepted attempt)

Red today (fail on assertions):
- `the_generators_bog_blueprint_is_the_approved_drawing`: the docs drawing is 29 x 29 of `T r % : .`, the trunk's box
  (9, 9)-(19, 19) round a `T` centre (14, 14), wall pieces 6, 6, 6, 137 (8-connected) with `R.piece_min` <= 6, the six
  openings, no symmetry of the square maps it onto itself; `DEFAULT_DEFINITION.bog_grid` is byte-equal to it. Today:
  "signature::DEFAULT_DEFINITION.bog_grid (0 bytes) is not byte-equal to docs/landmarks/blueprints/bog.txt (1424
  bytes)".
- `the_bog_tree_is_the_blueprint_under_one_of_eight_orientations`: on every seed the tree's tiles equal the drawing
  tile for tile under exactly one orientation, centred on the Plague site's centre tile, and the tree owns nothing else.
  Today: "seed 1 (attempt 1): the bog tree equals the drawing under 0 orientations; closest ((1, 0), false): 456 of 841
  tiles differ (first: ... grid (14, 0) '%' at (126, 133): tile 0, terrain 0, owned by the tree false), 51 tree tiles
  outside the drawing".
- `the_plague_anchor_is_the_blueprint_box_facing_the_coliseum_inside_the_site`: the anchor's centre is the site's centre
  tile and the feature's anchor point, strictly inside the footprint; the footprint is the drawing's 29 x 29 box inside
  the site's inner rect; the entrance is the six openings, floor on the footprint's edge; the front is the generator's
  DIR16 rule from the centre and the orientation's front direction its dominant axis. Today: "seed 1: the Plague
  anchor's footprint TileRect { x: 125, y: 118, w: 11, h: 15 }".
- `the_mirror_and_every_front_direction_occur`: both mirror states occur over seeds 1-32, and the front directions used
  are exactly the site centres' front axes. Today: no orientation (as above).

Guards (green today and under the prototype):
- `every_zone_keeps_its_landmark_and_every_map_certifies_clean` (`Strict::All`);
- `the_apron_rule_holds`;
- `option_off_is_todays_generator` (seeds 1-8 byte-identical, no anchors);
- `the_other_three_landmarks_are_unchanged` (the volcano, church and cave on seeds 1-8, attempts 0-1; the prototype gives
  the same 16 digests);
- `the_worst_attempt_stays_within_the_bound` (<= 4; measured 2, today 4);
- `the_attempts_used_stay_within_the_bound` (<= 59; measured 46, today 59).
- Ignored: `report_seeds_1_to_64` (attempts, refusals by reason, orientation, box offset).

Not proved by the oracle: seeds beyond 32 (the report covers 1-64); that the mirror is a fair coin; the time per map;
the `rh-mapdress` digests; what the Plague styler on `P-LAND-PLAGUE-1` does with the larger tree.

## Existing oracles amended (third commit, `oracle: P-MAPGEN-SIG-SCALE-3 amend the three tests that pin the rule-drawn tree`; approved by the landmark lane, 2026-11-13)

Run under the prototype, every `mapgen_signature_*` target, `mapgen_land_sentenced`, the `rh-sim` lib's `mapgen::`
tests, `rh-mapdress` and `rh-server`'s `map_pool` tests: exactly these three tests failed (plus two `rh-mapdress`
digests, below). Each is amended; all three are green on the stub (today's tree) and under the prototype (re-applied on
cbe6d639b), so they are guards for the implementer, not red oracles.
1. `crates/rh-sim/tests/mapgen_signature_core.rs` `g3_the_finished_map_carries_the_zone_anchors`: was "the Plague
   anchor's entrance is empty" ("seed 1: a tree has no door" under the prototype). Now: every Plague entrance tile is
   floor on the footprint's edge (the exact six tiles are pinned by this packet's new file). Trivially true today
   (no entrance).
2. `crates/rh-sim/tests/mapgen_signature_core.rs` `shape_bog_tree_stands_in_the_outer_third_ringed_by_bog`: was "the
   trunk (every wall the tree owns) is one piece, without terrain, and no bog touches it" ("seed 1: the trunk is not one
   piece (4)" under the prototype: the three free stumps). Now: the centre is a wall of the tree in its reserved site
   (else the outer third); the 8-connected wall piece holding the centre has at least 9 tiles; every wall of the tree
   carries no terrain; the rest of the tree is bog floor, at least 12 tiles, in all four quadrants. Dropped: "the walls
   are one piece" and "no bog touches the trunk" (the drawing's stumps and roots break them; blueprint equality pins
   the layout). What remains overlaps the new file's equality test, but runs on the `certified_styled` maps of seeds
   1-16 and holds for the old rule-drawn tree too.
3. `crates/rh-sim/tests/mapgen_signature_scale.rs` `the_other_three_landmarks_are_unchanged` (SCALE-1's guard): it
   pinned the tree as it is today ("seed 1 attempt 0: the volcano, church or bog tree moved" under the prototype). Now
   its digest skips `BogTree` features and the Plague anchor as it already skipped the cave, re-pinned on the stub with
   (1,0) 0x8c46_fd6c_2a91_e159, (1,1) 0xd65b_7b72_989c_547d, (2,0) 0xd9de_f016_c1d3_97ec, (2,1) 0,
   (3,0) 0xc3fb_6a95_77e8_3c68, (3,1) 0xfbda_c5dd_f01d_bf8b, (4,0) 0xbcd6_c7f8_c4c5_fef6, (4,1) 0xe011_7dec_285d_eadf,
   (5,0) 0xdc51_3636_ef93_1a07, (5,1) 0xd3d9_c4b7_9052_c500, (6,0) 0xba9f_f7b0_ccc0_13e3, (6,1) 0x6c22_5bef_0da5_c4b0,
   (7,0) 0x9c08_27c4_14f6_2dc1, (7,1) 0xf45d_e6e2_0805_ee45, (8,0) 0x142b_c64a_6d01_3a5a, (8,1) 0x668e_daaf_2fcd_cc1b;
   green on the stub and under the prototype.
- Left for the coordinator at merge (digests of option-on maps; every option-on map moves):
  `crates/rh-mapdress/tests/anchor.rs` `NO_ANCHOR_GOLDEN` (`a_signature_map_stripped_of_its_anchors_is_dressed_as_today`)
  and `crates/rh-mapdress/tests/marsh.rs` `SIG_GOLDEN` (`every_zone_other_than_plague_is_dressed_as_before`), both red
  under the prototype on their pinned digests.

## The old tree
Kept in this packet for a `begin_attempt` prefix (no reservation), as the cave kept its rule-drawn chamber: the
option-on Prefix always reserves, so only tests reach it (`mapgen_signature_fire.rs`
`note1_the_bog_tree_site_keeps_out_of_marked_aprons`, which builds on `begin_attempt`). Its removal belongs with the
cave's follow-up (hand-over section 1, "Delete the old rule-drawn cave chamber"): move that test onto
`begin_attempt_signature(.., true)` (where the fixed tree refuses when its box is marked as an apron), then delete the
rule-drawn code and the `Definition` fields only it reads (`trunk_d2`, `dry_d2`, `bog_d2`, `bog_min`; `outer_slack`
stays, the reservation reads it).

## What the Plague styler and `signature::band` read from the tree (on 2e51457dd), and must keep reading true
- `signature::band(anchor, x, y)` (`mod.rs:302-319`) reads only `anchor.footprint`: the Chebyshev distance from the box
  against `bands` [2, 6, 14]. The footprint grows from about 15 x 15 to 29 x 29, so Core/Near/Mid move outward by about
  7 tiles each side; `rh-mapdress` (`src/lib.rs:337-350`, `Grid::bands`) and `P-LAND-PLAGUE-1`'s pools by band read
  this. The footprint must stay the drawing's box: `finish` replaces the anchor's footprint with the `BogTree`
  feature's `bbox`, the bounds of the written cells; the written cells (walls and marsh) reach all four edges of the
  drawing (checked: bounds (0, 0)-(28, 28)), so it holds in every orientation; keep it so.
- `finish` matches the anchor to the feature by `kind` and `zone` (`mod.rs:672-676`): one `BogTree` feature per map.
- The anchor's `centre` (= the feature's `(ax, ay)`, `core.rs` g3 checks the equality) is a trunk wall tile, as today.
- The marsh tiles are owned by the `BogTree` feature (`feature_grid`), terrain `bog` (5): the tree's bog is never
  styler bog. `style_warren` on the base reads the tree only through the style runtime: `StyleRuntime::open`
  (`style_runtime/mod.rs:562-574`: owned tiles, `no_block` = the box and its apron, and `hard` are closed), so no
  crescent, barrow or styler bog tile is placed in the box or its apron; its `plan.bog` holds only its own crescent
  tiles (`style_warren/mod.rs:214-220`); its reeds read `base.terrain` of the 4 neighbours of a styler bog tile
  (`:245-260`), which can be the tree's bog only beside the apron. Under the prototype the lib's `style_warren` tests
  and every map certify clean: nothing in `style_warren/` assumes the old tree's size.
- `intact` (`mod.rs:716-719`) accepts the `BogTree` tiles as wall (terrain 0) or floor with `bog`: the drawing's tiles
  are exactly those. The certifier's `BogTree` row (wall, no LOW, terrain 0, job landmark) and `feature-hazards` (the
  marsh is owned) accept them; `pieces` needs every wall piece of the zone at least 6: the stumps are 6.
- For `P-LAND-PLAGUE-1` (rebased later by the coordinator): its pools must count only `BogPool`/styler tiles, never
  `BogTree`-owned bog (213 tiles inside the box now, about 90 before); its band measurements start 7 tiles further out.

## Where the earlier brief, the hand-over and the code disagree (corrected above)
- Section 1 ("target 30, floor 28", "trunk about 9-11 across", "bog rings") is superseded by the drawing: 29 x 29, trunk
  11 across, an irregular marsh of 213 tiles, three 2-wide causeways (the hand-over's description matches the drawing).
- Section 3's lines: `bog_tree.rs:10-105` is `:11-107`; `mod.rs:41-51` is `:43-53`.
- Section 5 named `style_warren/` "where it assumes the tree's size": on the base it assumes nothing (above); removed.
- Section 8's size, quadrant and halo checks are replaced by blueprint equality; its "Re-pinned in the oracle commit"
  list is replaced by "Existing oracles amended" (a third oracle commit, approved by the landmark lane).
- Section 2 says the Plague site lies beyond the outer-third line on 24 of 64 seeds; the hand-over (section 3) and ADR
  0028 decision 4 say 20 of 64. Not re-measured here.
- The hand-over's "No inside camp, so no relabel: measure `Repair(RadiusPost)` with the fixed tree first": measured,
  6 against today's 8; no relabel.
- The hand-over defines no entrance for the tree (section 4 says "the opening tiles named above", section 3 names none
  for the tree); this brief proposed the six causeway openings, and the coordinator accepted them (2026-11-13 evening,
  section 1).

## Measurements (seeds 1-64, option on; debug test build on macOS arm64; the prototype was reverted before the commits)
The prototype (a throwaway patch kept outside the repository, in the oracle author's scratch directory as
`scale3_prototype.patch`, with the test variant that printed refusal stats as `prototype_test_variant.rs`; the
coordinator has the paths): `bog_tree::place` takes the reserved rect and, when present, places the drawing as in
section 1 (marsh and walls `Site::wall && Site::ground`, dry tiles `Site::floor`, `smallest_piece`, `floor_pieces`),
entrance the six openings; `Definition::bog_grid = include_str!("bog.txt")`. This oracle file was run against it: every
test green. Box offset (3, 3) on 64 of 64 seeds; fronts over seeds 1-64: (-1, 0) on 23, (1, 0) on 12, (0, 1) on 14,
(0, -1) on 15; mirrored on 29 of 64 (35 with the other mapping); 0 `Signature` refusals. Under the prototype every
`mapgen_signature_*` target, `mapgen_land_sentenced`, the `rh-sim` lib's `mapgen::` tests (200, `style_warren`
included), `rh-mapdress` and `rh-server`'s `map_pool` tests pass except the three tests (now amended) and two
digests listed in "Existing oracles amended".

Re-run on cbe6d639b (after the coordinator's rebase): the prototype (the patch's `bog_tree.rs` part, plus the three
`mod.rs` lines by hand, since the stub already holds the field) gives the same numbers, 46 / 2 on seeds 1-32 and
109 / 6 on 1-64, the same refusals; the stub (today's tree) still 59 / 4 and 132 / 9 (SCALE-1's report). The bounds
(59, 4) stand. Under the prototype the ten new tests, the three amended ones and `cargo test -p rh-server --test
map_anchor_seeds` pass.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_bog_tree`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_core --test mapgen_signature_scale --test mapgen_signature_fire --test mapgen_signature_fire_bands --test mapgen_signature_aprons --test mapgen_signature_frost --test mapgen_signature_frost_lake --test mapgen_signature_reserve --test mapgen_land_sentenced`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_bog_tree -- --ignored --nocapture report_seeds_1_to_64`
- `cargo test -p rh-sim --test content`
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-3`

## 10. Risk and suggested model tier
Opus. Small code (about 150-200 changed lines: the placement, a parser, the ADR), but it is the Landmarks phase on the
signature stream: one draw exactly, option off untouched, the footprint must stay the box (`finish` reads the
feature's `bbox`), and every option-on map moves (expected; the oracles hold properties, not hashes, except
`the_other_three_landmarks_are_unchanged`). No cut: well under 450 lines.

## 11. Known traps
- Do not `include_str!` the docs file: `hosting/Dockerfile` copies only `crates/` and `.dockerignore` excludes `docs`.
  The crate carries `signature/bog.txt`; the oracle keeps it byte-equal.
- The cave's `Blueprint::parse` accepts only `#R=.ED` with one `E` and a `D` mouth: the tree's grid has neither. Parse
  it with its own small reader (or generalise the cave's without changing what the cave accepts).
- Centre the drawing on the site's centre tile, not on a camp (there is none): `ReservedSite::camp` is `None` for Plague.
- The mirror is the tree's only draw on the Plague stream; the volcano, church and cave must draw exactly what they
  draw today.
- Walls and marsh must be `Site::ground` (aprons marked before: the legacy buildings, the volcano's) as today's tree;
  dry tiles `Site::floor`. The causeways and dry floor are not written: they stay unowned plain floor.
- `smallest_piece` is 8-connected: the stumps are exactly `piece_min` (6). A grid change that shrinks one refuses every
  attempt.
- `bounds` of the tree's cells is the full box only because walls or marsh reach every edge row and column of the
  drawing; keep the footprint the box.
- Anchors live on the generator's map and `GameMapData.anchors`, never on `LayerData`.
- `tests/content.rs` rejects a new `const` holding the grid: it is a `Definition` field.

## Notes from previous attempts
