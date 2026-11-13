# P-MAPGEN-SIG-SCALE-1: the Frost cave is the approved blueprint (one fixed 29 x 29 cave), first of four

- **Serves:** owner direction 2026-11-12 late (MIGRATION: the landmarks "a lot larger"); owner decision 2026-11-13
  (requirements L1 and L5 in `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`; ADR 0028 rule G9; the five
  blueprints approved: `docs/landmarks/blueprints/`).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase, and one territory rule before repair)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework @ 1032e5bdf, merged into this branch (76cf8372f); P-MAPGEN-SIG-RESERVE-1 is
  in it.
- **D-rules touched:** D1: option off byte- and draw-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim
  tick, wire or content-hash change

## What the owner must know (oracle author, 2026-11-13; measured on the merged tree, seeds 1-64, option on)

| run | attempts 1-32 | worst index 1-32 | attempts 1-64 | worst index 1-64 | seeds without a map |
|---|---|---|---|---|---|
| today (RESERVE-1's cave) | 41 | 1 | 101 | 5 | 0 |
| the fixed cave alone | 209 | (seed 20 has no map) | 396 | (no map) | **7** |
| **the fixed cave + the site's territory relabel (this packet)** | **59** | **4** | **132** | **9** | 0 |

- The fixed cave alone fails: its walls cut the territories of the Frost camps next to the site (the reservation keeps
  their halos out of the site, not their territories), and repair gives the cut pieces to camps more than 30 tiles
  away: 247 `Repair(RadiusPost)` refusals (today 8). The cure, which the coordinator approved (2026-11-13): every tile
  of a site with an inside camp belongs to that camp's territory when repair runs ("The rule", 2). With it the cost on
  seeds 1-32 is inside RESERVE-1's bounds (70 attempts, worst index 7), which is the bar this oracle holds.
- Seeds 1-64 cost 31 more attempts than today (132 against 101) and the worst index rises from 5 to 9 (seed 33); 26 of
  the refused attempts are lake discards (today 1) that the land-generation session's Frost packet is meant to remove
  (hand-over below).
- Nothing is served smaller: a site that cannot hold the drawing refuses the attempt (`Refusal::Signature`). In the
  measurement the cave never refused one (every wall tile legal, the zone floor never split, the smallest wall piece 9).
- The drawing's ice is legal everywhere: all 226 `=` tiles have floor on all eight sides and lie off the camp's halo,
  and the reserved site keeps every other halo and the open map corners out, so this holds in every orientation; on the
  generated maps no cave ice tile broke the code's ice rule.
- Two existing Frost tests fail with the fixed cave for reasons in the Frost styler (`style_rime/`, not this packet's);
  they are amended to what must hold without a styler change ("Existing oracles changed").

## 1. ID and outcome
In signature mode the Frost cave IS the approved drawing `docs/landmarks/blueprints/cave.txt`: 29 x 29 tiles, front
(toward the coliseum) at the bottom; `#` wall and `R` rock are wall tiles owned by the cave; `=` is the cave's ice
(floor with the ice terrain, owned by the cave); `.` plain floor, `E` the elite camp's tile and `D` the 3-tile mouth stay
unwritten floor. One size; nothing else varies but the site (RESERVE-1), the rotation and the mirror:
- **Rotation:** the mouth faces the dominant axis of the DIR16 front from the camp tile toward the coliseum (the
  generator's `axis(front(camp))`, as today).
- **Mirror:** one draw of the Frost zone's signature stream (the stream the Prefix began, after the site's draw), the
  cave's only draw.
- **Position:** the drawing's `E` on the Frost site's camp tile (RESERVE-1 puts it on the site's centre line, 9 tiles
  from the far edge, one tile off the centre across: 34 is even). The box then lies inside the site's inner rect in all
  four directions. Offsets of the box from the site's top-left corner: (2, 3) with the mouth toward +x, (3, 3) toward
  -x, (3, 2) toward +y, (3, 3) toward -y; the mirror never moves the box (`E` is on the drawing's centre column).
- **Anchor:** the Frost anchor's centre is the camp tile, its footprint the 29 x 29 box, its entrance the three mouth
  tiles, its front the DIR16 index as today.
- **Refusal:** if any wall or rock tile is not `Site::wall`, any other tile not `Site::floor`, the mouth's doorway not
  open, a wall piece under `R.piece_min`, or the zone's floor split, the attempt is refused (`Refusal::Signature`).
No size search, no `floor_side`, no `target_side`, no forecourt preference (there is one placement).

## 2. Dependencies
- P-MAPGEN-SIG-RESERVE-1 (merged). SCALE-2 (church) reuses the placement rule and the territory relabel; SCALE-3 and
  -4 the placement rule. P-LAND-FROST-* (land-generation session) builds the lake at the mouth.

## 3. Relevant legacy paths
- None: no legacy counterpart (DEV-020). The code this packet changes: `signature/cave.rs:41-79` (`place`) and
  `:166-344` (`side`, today's rule-drawn chamber, replaced in signature mode); `signature/mod.rs:96-105` (the cave's
  `Definition` fields), `:122-128` (the stub's `cave_grid`), `:218-226` (`axis`), `:457-477` (`inside_camp`),
  `:485-550` (`apply`: the Frost stream, the site's `inner` rect); `pipeline/mod.rs:349-359` (repair's `State`; the
  territory grid is copied from the prefix at `:355`); `zones/camps/mod.rs:489` (`place_camps_reserving`); `repair/mod.rs:355-485` (a territory piece cut off
  from its camp is reassigned to a touching camp), `:851-858` (`Refusal::RadiusPost`, any camp's territory beyond 30).

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.txt` (stub commit): the generator's byte-equal copy of the drawing.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` and `cave.rs` (the placement rule and the cave)
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.txt` (only if the docs drawing changes: it must stay byte-equal)
- `crates/rh-sim/src/mapgen/pipeline/mod.rs` **or** `crates/rh-sim/src/mapgen/zones/camps/mod.rs`: the territory
  relabel only (coordinator decision 2026-11-13; "The rule", 2)
- `docs/adr/0028-signature-landmarks.md` (decision 11; decision 12's territory sentence; the Measurements section)
- Not in scope: `style_rime/` (the land-generation session's), `crates/rh-mapdress/**` (the coordinator re-pins its
  digests at merge), any other test.

## 6. Contracts and references
- ADR 0028 G1-G10, decisions 1, 3, 6, 7, 11, 12; C-PARITY (option off byte-identical, G8); `rh-sim` determinism rules
  (no hash-ordered collections, no clock; the signature stream only); `tests/content.rs` (no new `const`).

## 7. Behaviour to preserve
- Option off: byte-identical maps and not one draw added, removed or reordered (no site, so no relabel and no
  blueprint): `option_off_is_todays_generator` here and the `g8`/`option_off` guards in five other files.
- Option on: the volcano, church and bog tree the Landmarks phase places are exactly today's (they are placed before
  the cave on their own streams: `the_other_three_landmarks_are_unchanged`); every zone keeps its landmark; every map
  certifies with zero failures; the lake and apron rules hold; the attempt bounds above.
- The cave draws exactly one value (the mirror) from the Frost stream, after the reservation's draw.
- The content hash does not move: the drawing lives in `signature::Definition`, whose `DEFAULT_DEFINITION` is already
  a `NON_GAMEPLAY` row of `tests/content.rs` (no new row, so no coordinator carry).

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_scale` green (4 tests red today), and
  every other `mapgen_signature_*` target green (the two amended Frost tests included).
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-1` passes (the coordinator runs the full gate and re-pins
  the `rh-mapdress` digests named below).
- The ignored `report_seeds_1_to_64` prints the table above's columns; the implementer quotes it in the hand-off.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_scale.rs` (rewritten)
- `crates/rh-sim/tests/mapgen_signature_frost.rs` (two tests amended, see "Existing oracles changed")
- `docs/backlog/packets/P-MAPGEN-SIG-SCALE-1.md`, `-2.md`, `-3.md`, `-4.md`
- The stub commit's files (`signature/mod.rs`: the empty `Definition::cave_grid`; `signature/cave.txt`) are the
  implementer's: the field must hold `include_str!("cave.txt")`, and the copy must stay byte-equal to the docs.

## The rule (what to build)

1. **The blueprint placement rule** (`signature/mod.rs`, reused by SCALE-2 to -4). Parse `Definition::cave_grid` once
   per context (the lines not starting `;`, not empty; check 29 x 29, one `E`, three `D`). Orientation: front
   direction u = `axis(front(camp))`; unmirrored, the drawing's +x goes to r = (u.1, -u.0); mirrored, to -r; grid
   tile (gx, gy) lands on camp + (gy - ey) * u + (gx - ex) * (+-r). The mirror is `pick(rng, 2)` on the Frost stream
   (one draw; any fixed mapping of the draw to the flag is fine, the oracle checks only that both occur). Checks, in
   any order (none draws): `#`/`R` on `Site::wall`; `=`, `.`, `E`, `D` on `Site::floor`; the `doorway` tiles beyond
   each mouth tile `Site::open` (they lie in the site's apron, outside `inner`); `smallest_piece` of the walls at
   least `R.piece_min`; `floor_pieces` with the walls not above today's. Any failure: `None` (`Refusal::Signature`).
   Cells: walls (tile wall, terrain 0) and ice (floor, `ice` terrain), owned by the cave; nothing else written.
   Without a reserved site (no `camp`) there is no cave rule to fall back to in signature mode: the option-on Prefix
   always reserves (a round without sites fails), so `camp` is always `Some`; keep today's `side` path or remove it,
   as long as option off is unchanged (the cave is never built with the option off).
2. **The territory relabel.** Outcome: when repair runs on an option-on attempt, no tile of a reserved site that has an
   inside camp (Frost here; the Sentenced site when SCALE-2 builds its church) belongs to another camp's territory:
   every tile of the site carries the inside camp's label (its index in the prefix's camps + 1). Two places can do it:
   (a) the pipeline, where repair's `State` copies `prefix.layout.territory_grid` (`pipeline/mod.rs:355`): **this is
   what was measured** (only the Frost site, after the signature step placed its landmarks); (b) the reserving camp
   code (`place_camps_reserving`), labelling the site after the Lloyd steps. (b) is allowed if the implementer
   re-measures it no worse on seeds 1-32 (attempts, worst index) and reports seeds 1-64. Either way option off is
   untouched (no sites, nothing relabelled) and the relabel draws nothing.
3. **ADR 0028 decision 11** is rewritten for the blueprint (and decision 12 gains the territory sentence); G9's "not
   yet built" note names the cave as built.

## Measurements (seeds 1-64, option on; release-built throwaway probe on macOS arm64; the prototype and probes were
reverted before the oracle commit, as the earlier oracle authors did)

The prototype: `cave::place` replaced by the rule above when the site has a camp (the doorway checked with
`Site::open`), the relabel done in the pipeline (option (a)). The oracle file below was run against it (debug): every
test green (see "The oracle").

- **Refusals by reason** (seeds 1-64, fixed cave + relabel): 26 `SignatureDiscarded` for the lake (today 1), 21
  `SignatureDiscarded` for the landmark-intact / styler-apron check (today 17), 12 `Prefix` (today 11), 8
  `Repair(RadiusPost)` (today 8), 1 `SignatureDiscarded` by the certifier (today 0), 0 `Signature`. The fixed cave
  alone: 247 `RadiusPost`, 48 `Prefix`, 19 lake, 23 intact / styler-apron, 2 `Signature` (the volcano's, not the cave).
- **The one certifier discard** (seed 19, attempt 1): `feature-kind-tiles`: the Frost styler's mere (feature 64) owns
  a WALL tile at (39, 26), 4 tiles outside the cave's box and its apron. A styler fault (`style_rime/`), not the cave's
  tiles; the discard does its job. Passed to the land-generation session.
- **Accepted attempts** (fixed cave + relabel, seeds 1-64): attempt 0 on 33 seeds, 1 on 14, 2 on 7, 3 on 6, 4 on 2, 5
  on 1, 9 on 1 (seed 33). Debug test build: this oracle's maps (seeds 1-32) about the same time as today's.
- **Box:** 29 x 29 on 64 of 64 seeds, offsets as in section 1, always inside the inner rect.
- **Ice:** 226 of the drawing's 627 floor tiles (36 %); 0 illegal on generated maps.
- **Wall pieces:** 175 (the outer wall and its bulges) and four rock blocks of 9-10 (8-connected).

### Hand-over to the land-generation session (`P-LAND-FROST-*`, `style_rime/`)
- Between the mouth and the site's edge lie exactly **3 floor tiles** (one row of the inner rect and the 2-tile apron)
  on 64 of 64 seeds: the lake's shore can start right at the site's edge to keep "3 dry tiles between mouth and shore".
- Walked floor steps from the mouth to the zone's largest unowned ice body, accepted maps of seeds 1-64: 3 steps on 39
  seeds, 4 on 4, 5 on 6, 6 on 5, 7 on 3, 8 on 6, 9 on 1 (today: 3 on 45, 4 on 5, 5 on 5, 6 on 2, 7 on 5, 8 on 1, 10 on
  1). The end-of-attempt lake rule discards **26 attempts** over seeds 1-64 (largest body 11-54 steps away) until the
  lake is built at the mouth.
- With the fixed cave: seed 13's largest lake lies in the cave's mid band (the band test is dropped here); seed 11
  keeps no spire or headland; seed 19 attempt 1's mere owns a wall tile (certifier `feature-kind-tiles`).

### History (short)
The earlier versions of this brief (2026-11-12) measured an adaptive cave (largest square 20-28, then 28-30 that fits)
and a territory rule that redrew candidates; the owner's decision of 2026-11-13 (one blueprint, no size search)
superseded both, and RESERVE-1 reserved the sites. The tables are in this file's git history (`5517332d2`).

## Existing oracles changed (in the oracle commit; the implementer may not touch them)

`crates/rh-sim/tests/mapgen_signature_scale.rs`: rewritten. Removed the size and ice statistics of the adaptive cave
(`floor_side`, `target_side`, `mean_side_min`, `below_hall`, `ice_share_min`, `mouth_rows_dry`, and the tests
`the_cave_is_a_lot_larger_but_smaller_than_the_hall`, `the_cave_has_an_ice_floor_dry_at_the_camp_and_the_mouth`; the
drawing's ice, 226 of 627 floor tiles, is pinned by blueprint equality), and the shape guards that blueprint equality
now covers (`the_cave_is_enclosed_with_one_mouth_and_the_elite_camp_inside`,
`every_floor_tile_inside_the_cave_is_reached_from_the_mouth`, `a_three_wide_way_leads_from_the_mouth_to_the_camp`:
the drawing has one 3-tile mouth, all 627 floor tiles connected and a 3-wide way from the mouth to `E`, checked when it
was approved and re-checked here offline). The attempt bounds are RESERVE-1's (70, 7), no longer provisional.

`crates/rh-sim/tests/mapgen_signature_frost.rs` (P-MAPGEN-SIG-FROST-1's oracle), coordinator decision 2026-11-13:
- `the_mouth_opens_onto_the_largest_lake`: was "the largest ice body is within `MOUTH_TO_LAKE` (10) floor steps of the
  mouth AND its nearest tile to the mouth is in the cave's core or near band"; now only the first (the end-of-attempt
  lake rule, `lake_reach + lake_slack`). Why: with the fixed cave seed 13's nearest lake tile is in the mid band; the
  bands are measured from the footprint, now 29 wide, and where the lake lies is `P-LAND-FROST-*`'s to build.
- `spires_and_headlands_keep_out_of_the_core_band`: was "no spire or headland tile in the core band AND every map keeps
  at least one spire or headland in Frost"; now only the first. Why: with the fixed cave seed 11 keeps none ("seed 11:
  no spire or headland in Frost"); the core-band rule still holds on every seed. Not investigated: why the styler
  places none on seed 11 (the land-generation session's).
- The header's "nearest cell ... at most `Near`" definition is marked dropped; the unused `d2` helper removed.

Every other `mapgen_signature_*` test passed unchanged under the prototype (`core`, `fire`, `fire_bands`, `aprons`,
`frost_lake`, `reserve`, and the other five `frost` tests).

**Left for the coordinator (re-pin at merge, not edited here):** `crates/rh-mapdress/tests/anchor.rs`
`NO_ANCHOR_GOLDEN` and `crates/rh-mapdress/tests/marsh.rs` `SIG_GOLDEN` (digests of option-on maps; every option-on
map moves). Not run under the prototype.

## The oracle (`crates/rh-sim/tests/mapgen_signature_scale.rs`, seeds 1-32, first accepted attempt)

Red today (fail on assertions):
- `the_generators_blueprint_is_the_approved_drawing`: the docs drawing is 29 x 29 with `E` at (14, 7) and the mouth
  at (13-15, 28); `DEFAULT_DEFINITION.cave_grid` is byte-equal to it. Today: "cave_grid (0 bytes) is not byte-equal".
- `the_cave_is_the_blueprint_under_one_of_eight_orientations`: on every seed the cave's tiles equal the drawing tile
  for tile under exactly one orientation, placed at the site's camp, and the cave owns nothing else. Today: "seed 1
  (attempt 0): the cave equals the drawing under 0 orientations; closest ...: 463 of 841 tiles differ".
- `the_frost_anchor_is_the_blueprint_box_facing_the_coliseum_inside_the_site`: the anchor's centre is the camp, its
  footprint the drawing's 29 x 29 box inside the site's inner rect, its entrance the drawing's mouth, its front the
  generator's DIR16 rule and the orientation's front direction that front's dominant axis. Today: "seed 1: the Frost
  anchor's footprint TileRect { x: 6, y: 39, w: 15, h: 12 }".
- `the_mirror_and_every_front_direction_occur`: both mirror states occur over seeds 1-32, and the front directions
  used are exactly the sites' front axes. Today: no orientation (as above).

Guards (green today and under the prototype):
- `the_elite_camp_stands_at_the_anchor_and_its_halo_is_free` (an elite Frost camp on the site's camp tile, the
  anchor's centre; every halo tile floor, unowned, no terrain);
- `every_zone_keeps_its_landmark_and_every_map_certifies_clean`;
- `the_lake_and_apron_rules_hold`;
- `option_off_is_todays_generator` (seeds 1-8 byte-identical);
- `the_other_three_landmarks_are_unchanged` (the Landmarks phase's volcano, church and bog tree on seeds 1-8, attempts
  0-1, digests pinned on the stub commit);
- `the_worst_attempt_stays_within_the_bound` (<= 7; measured 4, today 1);
- `the_attempts_used_stay_within_the_bound` (<= 70; measured 59, today 41).
- Ignored: `report_seeds_1_to_64` (attempts, refusals by reason, orientation, box offset, mouth-to-site-edge floor,
  mouth-to-lake steps).

Not proved by the oracle: seeds beyond 32 (the report covers 1-64); that the mirror is a fair coin (only that both
occur); that the relabel covers exactly the site (only its effect: the attempt bounds); the time per map; the
`rh-mapdress` digests; the Sentenced relabel (SCALE-2).

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_scale`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_frost --test mapgen_signature_frost_lake --test mapgen_signature_reserve --test mapgen_signature_aprons --test mapgen_signature_core --test mapgen_signature_fire --test mapgen_signature_fire_bands`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_scale -- --ignored --nocapture report_seeds_1_to_64`
- `cargo test -p rh-sim --test content`
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-1`

## 10. Risk and suggested model tier
Opus. The relabel touches the territory grid every later step reads (spawns, repair, records) under the option only;
option off must stay draw-identical. Every option-on map moves (expected; the oracles hold properties, not hashes,
except `the_other_three_landmarks_are_unchanged`, which pins the Landmarks phase's other landmarks).

## 11. Known traps
- Do not `include_str!` the docs file: `hosting/Dockerfile` copies only `crates/` and `.dockerignore` excludes `docs`,
  so the server image would not build. The crate carries `signature/cave.txt`; the oracle keeps it byte-equal.
- The doorway lies in the site's apron: `Site::floor` is confined to the inner rect, so check it with `Site::open`.
- The cave's only draw is the mirror; it must come after the reservation's draw on the same Frost stream
  (`ReservedSite::stream`), and the volcano, church and tree must draw exactly what they draw today.
- Territory labels are camp index + 1 over all camps (repair's `owner = ci + 1`), not per zone.
- `bounds` of the cave's cells is the full box only because the outer wall reaches every edge row and column; keep the
  footprint the box (the oracle compares it with the drawing's box).
- Anchors live on the generator's map and `GameMapData.anchors`, never on `LayerData`.
- `tests/content.rs` rejects a new `const` holding the grid: it is a `Definition` field.

## Notes from previous attempts
