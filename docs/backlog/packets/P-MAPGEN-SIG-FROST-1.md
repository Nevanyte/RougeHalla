# P-MAPGEN-SIG-FROST-1: the Frost cave in the generator, around the far elite camp, its mouth on the frozen lake

- **Serves:** owner direction 2026-11-12 (generation order and core rules G1-G8, in
  `docs/backlog/packets/P-MAPGEN-SIGNATURE-CORE-1.md`); owner decision 4 (MIGRATION, 2026-11-10: "Frost get a frozen
  lake with an frozen cave in back"; answer: "Enterable, elite camp inside")
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase and the Frost styler; rh-server post-pass)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick,
  wire or content-hash change

## 1. ID and outcome
The generator's signature step places the Fire volcano, the Sentenced church and the Plague bog tree before spawns and
obstacles. Frost's landmark is still added after generation by `crates/rh-server/src/signature.rs` as a rock arch,
and it fits on only 9 of 16 maps (the far elite camp sits 8 to 12 tiles from the map edge, and half of an arch
centred on it falls off the map or into walls). When this lands, with the signature option on:
- **Landmark (G2):** the generator places a **cave** on the Frost zone's back edge around the far elite camp: a
  walled chamber, closed except for one mouth, containing the camp's clearing, ice floor inside. The chamber may be an
  off-centre rectangle or lean on the map's border wall (as the church does), so every map gets one.
- **Obstacles around it (G3, G4):** in signature mode the Frost styler (`style_rime`) places its largest frozen lake
  (the mere) in front of the cave's mouth, so the mouth opens onto the lake's shore, and arranges its spires and
  headlands by band from the cave (none in the core band; flanking the approach in the near band).
- **Anchor:** Frost's `ZoneAnchor` (centre, footprint, front, entrance = the mouth) is on the finished map.
- **rh-server:** the post-pass no longer places a cave; with all four zones covered by the generator,
  `crates/rh-server/src/signature.rs` and its tests are deleted, and `--signature-landmarks` only sets the option.

## 2. Dependencies
- P-MAPGEN-SIG-FIRE-1 merged. May run beside P-MAPGEN-SIG-FIRE-2 (disjoint files), strictly serial with
  P-MAPGEN-SIG-STYLE-1 (`landmarks/signature/mod.rs`).

## 3. Relevant legacy paths
- none for the cave. The Frost styler as ported: `crates/rh-sim/src/mapgen/style_rime/` (`shape.rs`: headlands,
  spires, causeway, mere; `lakes.rs`), `docs/ZONE_SHAPES_AS_BUILT.md` (Frost). The post-pass's shape:
  `crates/rh-server/src/signature.rs` (`frozen_cave`). The shape check already written for it:
  `git show packet/P-SIGNATURE-2:crates/rh-server/src/signature/tests.rs`
  (`caves_are_closed_chambers_with_one_mouth_that_reach_the_lake`, never run on a real cave: read it critically).
- How the church solved the same site problem: `crates/rh-sim/src/mapgen/landmarks/signature/church.rs`.

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.rs`

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/` (the cave), `pipeline/mod.rs` (only what the step needs),
  `crates/rh-sim/src/mapgen/style_rime/` (signature-mode arrangement), `mapdata/model.rs` (appended kind `Cave`),
  `certify/rules.rs` (`SIGNATURE_KINDS` row), `map_hash/` and `certify/diagnostics.rs` for the name,
  `crates/rh-sim/tests/content.rs` only for the registry reason's count
- `crates/rh-server/src/signature.rs`, `signature/tests.rs` (deleted), `map_pool.rs` and `lib.rs` (the call and the
  module line), `docs/adr/0028-signature-landmarks.md`
- Added by the oracle author: `crates/rh-server/src/runtime.rs` (doc comment only: `:26-27` links
  `[crate::signature]`, which dangles once the module is gone). Already stubbed, touch only if a row is wrong:
  `mapdata/validate.rs` and `certify/features.rs` (the kind takes no params). `signature/tests.rs` is not an oracle
  file on this branch (untouched here): it is deleted with the module, and its one surviving check (the maker's
  options) is in the new `map_pool/tests.rs` case.
- not `style_zones/`, `style_runtime/`, `records/`, `spawns/`, `repair/`, `tests/content.rs` (beyond the stub's prose)

## 6. Contracts and references
- G1-G8. G8 binds the styler: with the option off `style_rime` draws and places exactly what it does today.
- The elite camp inside the cave stays reachable through the mouth; its territory area and radius are computed after
  the landmark, as for the church. Ice makes fighters slide (Frost is exempt on its home ground under the live
  terrain rule): the certifier's hazard-walk rule judges the approach.

## 7. Behaviour to preserve
- Option off: every pinned map and the Frost styler's fixtures.
- Option on: the volcano, church and bog tree still place on every seed; every map certifies with zero failures.

## 8. Acceptance checks
- Oracle, seeds 1-16 (and report 17-32), option on: every map has one cave; it is closed except for one mouth (define
  "closed" on the tile grid: no floor path from inside to outside except through the mouth tiles); it contains the
  far elite camp's clearing; the camp is reachable from a spawn; the mouth has a floor path to a cell of the zone's
  largest ice body of at most a stated length; the cave's centre is farther from the map centre than the Frost
  zone's centroid or the cave leans on the border.
- Oracle (bands): no spire or headland tile in the cave's core band; the largest ice body's nearest cell to the mouth
  is within the near band.
- Oracle (G8): option-off maps for seeds 1-8 byte-identical; the pinned styler tests pass untouched.
- Oracle: every option-on map certifies with zero failures; the anchor list carries all five zones.
- Oracle (rh-server): `--signature-landmarks` sets the option and nothing else; the `signature` module is gone.
- Report attempts per seed (worst index over seeds 1-32) and time per map.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FROST-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_frost.rs` (new target; sixteen option-on maps generated once per binary; the
  definitions it measures are at the top of the file and below): `g8_option_off_maps_are_todays` (passes on the stub
  and must keep passing), `the_cave_is_closed_but_for_one_mouth_round_the_far_elite_camp`,
  `the_cave_is_on_the_back_edge_and_its_camp_reachable`, `the_mouth_opens_onto_the_largest_lake`,
  `spires_and_headlands_keep_out_of_the_core_band`, `frost_maps_certify_clean_and_carry_all_five_anchors`,
  `the_volcano_church_and_bog_tree_still_place_on_every_seed` (passes on the stub), `report_attempts_seeds_1_to_32`
  (`#[ignore]`: the 17-32 report, run with `--ignored --nocapture`), and their helpers.
- `crates/rh-server/src/map_pool/tests.rs`: the new case `signature_landmarks_only_set_the_generator_option` (the rest
  of the file is unchanged and stays as it is).
- `crates/rh-sim/tests/mapgen_signature_core.rs` and `crates/rh-sim/tests/mapgen_signature_fire.rs` (earlier oracles,
  edited here; see "Existing tests changed").
- This brief.

Against the stub (`cargo test -p rh-sim --test mapgen_signature_frost`, `cargo test -p rh-server --lib
signature_landmarks_only`):
- fail on an assertion: closed/mouth, back edge, lake `seed 1: 0 Cave features`; bands `seed 1: no Frost anchor
  (anchors [Fire, Sentenced, Plague, Holy])`; certify/anchors `seed 1: anchored zones` (left `[Fire, Sentenced, Plague,
  Holy]`); rh-server `seed 1: the served map has 0 Cave`.
- pass and must keep passing: `g8_option_off_maps_are_todays`, `the_volcano_church_and_bog_tree_still_place_on_every_seed`,
  every case of `mapgen_signature_core.rs` and `mapgen_signature_fire.rs`, the whole rh-sim suite
  (`cargo test -p rh-sim --features trusted-status-probes`) and every other rh-server test.

## Definitions (oracle author, 2026-11-12; written at the top of `mapgen_signature_frost.rs`)

All on the tile grid; floor is tile value 0, walkable 4-connected; a tile's point is its centre.
- **Cave, footprint, mouth.** The cave is the one `Cave` feature (zone Frost); its footprint is the feature's bbox and
  equals the Frost anchor's `footprint`; the mouth is the anchor's `entrance`.
- **Far elite camp** (as the church's): the Frost camp with `elite_spot >= 0` farthest from the map centre; its
  clearing is every tile whose point is within `r` of the camp point.
- **Interior.** The floor tiles a 4-connected flood over floor reaches from the far elite camp's tile with the mouth
  tiles blocked. So the interior is identified from the camp (the feature need not own it) and the mouth from the
  anchor.
- **Closed except for one mouth.** The mouth is one straight 4-connected run of 2-5 floor tiles on the footprint's
  edge (its first or last row or column); the interior lies wholly inside the footprint, i.e. there is no floor path
  from the interior to any tile outside the cave except through the mouth; every mouth tile touches the interior and
  some mouth tile touches floor outside the footprint. The mouth is nearer the coliseum tile than the camp tile is
  (the cave opens toward the front, as the church's door).
- **Contains the clearing.** Every clearing tile is in the interior. **Ice inside:** at least 8 interior tiles with
  terrain ice owned by the cave.
- **Back edge.** The anchor's centre is farther from the map centre than the centroid of the Frost region's cells, or
  the footprint leans on the border (a footprint tile in the outermost two rows or columns: the 1-tile border wall and
  the tile inside it).
- **The largest ice body.** The largest 4-connected set of floor tiles with terrain ice in the Frost region that the
  cave does not own (first in row order on a size tie). The cave's own ice is excluded, or a big chamber would be its
  own lake.
- **Mouth to lake.** The fewest 4-connected floor steps from a mouth tile (step 0) to a tile of the largest ice body:
  at most **10** (the near band's 6 plus a short way round the shore).
- **Bands.** The body's tile nearest to the mouth (squared distance to any mouth tile, first in row order) has
  `signature::band` at most `Near` against the Frost anchor; no tile owned by a Frost `Spire` or `Headland` has band
  `Core`; at least one Frost spire or headland remains (today 1-2 spires and 0-6 headlands per map, seeds 1-16).
- **Anchors.** `[Fire, Sentenced, Plague, Frost, Holy]`; Frost's: kind `Cave`, footprint = bbox, centre = the
  feature's anchor point inside the footprint, front = DIR16 toward the coliseum, entrance non-empty; no styler feature
  owns a tile of the cave's apron (bbox grown by the core band).
- **rh-server.** `StyledMaker::options()` is `{decor: false}` without the flag and `{decor: false, signature: true}`
  with it; a served option-on map (seeds 1-2) holds one volcano, church, bog tree and cave and equals (`Arena ==`) the
  generator's own map exported through `MapExport::validate`; `src/signature.rs` and `src/signature/` do not exist and
  `lib.rs` has no `pub mod signature;`.

The closure definitions were checked on a real chamber before committing: run against the Sentenced church (its door
as the mouth) they pass on all 16 seeds, and with only one door tile treated as the mouth they report the leak
(`seed 1: the cave is open: interior tile (1, 1) outside the footprint`).

## The post-pass shape check, read critically
`git show packet/P-SIGNATURE-2:crates/rh-server/src/signature/tests.rs`
(`caves_are_closed_chambers_with_one_mouth_that_reach_the_lake`, :456-604) was never run on a real cave. What was
wrong and what the oracle does instead:
- "the largest ice body" was `components(&ice, false).into_iter().next()` (:473): the first group in row order, not the
  largest. Here: the largest by size.
- "a walk from the mouth to the lake" (:567-573) is a flood over all floor: true on any map whose zone floor is one
  piece, so it proved nothing. Here: at most 10 floor steps, and the nearest tile in the near band.
- "closed" allowed the shut chamber two tiles beyond the rock's box and up to 400 tiles (:518-545). Here: the interior
  stays inside the footprint.
- "one mouth" was one 4-connected group of any size (:492-497): a whole missing side passed. Here: one straight run of
  2-5 tiles on the footprint's edge, opening onto outside floor.
- the camp was any Frost elite camp at the cave's tile (:499-510). Here: the far elite camp, from the map alone.
- the mouth's direction was checked only without a lake. Here: always toward the front.

## Certifier row (`SIGNATURE_KINDS`, stub)

| Kind | params | wall | low | terrain | jobs | Why |
|---|---|---|---|---|---|---|
| `Cave` | 0 | yes | no | 0 | Landmark | The chamber is wall; it holds no water or chasm, so no LOW. `terrain` binds only LOW tiles (`certify/features.rs:236-241`), and owned floor may carry any terrain, so the ice floor is the cave's own: `feature-hazards` (`features.rs:222,247`) fails unowned hazard floor in a strict zone. Not a `Mere`: a mere's params count its lake's ice (`features.rs:332`) and the Frost styler numbers its lakes in its plan. |

Other rules the cave meets on its own: `feature-overlap` (no wall on a camp halo or spawn pad, `features.rs:242-244`),
`feature-size` (at least `piece_min` 6 wall tiles), `pieces` (no Frost wall 8-piece under 6), `ice-neighbours`
(every ice tile has floor on all eight sides, so ice keeps one tile off the wall and the mouth's edge),
`terrain-protected` (no ice on a camp clearing or halo, `labels.rs:44`), and the hazard walk (`spawn-walk-hazards`,
at most 8 hazard tiles on a spawn walk).

## Seam and stub (oracle author's decision, 2026-11-12)
As the Fire packet: the styler learns signature mode and the anchor from the `Cave` feature in its zone, no new styler
input. The stub adds `style_rime::signature_anchor(BaseContext) -> Option<ZoneAnchor>` (`style_rime/mod.rs`), `Some`
only when the zone has a `Cave` feature (option on). Its `entrance` is empty in the stub; the implementer fills the
mouth (the same tiles as the finished map's anchor, e.g. the floor tiles on the cave's box edge that the ring leaves
open) and branches on it inside `shape::run`: `None` runs today's code draw for draw (G8).
- `FeatureKind::Cave` appended (`mapdata/model.rs`, serde `cave`), names in `map_hash/mod.rs` and
  `certify/diagnostics.rs`, no params in `certify/features.rs` and `mapdata/validate.rs`, the row above.
- `landmarks/signature/cave.rs`: `pub(super) fn place(&Site, &[CampSite], &mut Mulberry32) -> Option<Built>` returning
  `None`, not called. The implementer wires it into `SignatureContext::apply` (Frost's slot, its own stream), extends
  `is_signature`, `intact` (walls and the cave's ice) and `finish`, and keeps every tunable in `Definition` (a new
  `const` in `rh-sim/src` needs a `tests/content.rs` row, outside the write scope).
- `tests/content.rs`: the `SIGNATURE_KINDS` reason now says seven kinds (prose only).
- Nothing in checkpointed state changes: the kind appears in `LayerData.features` only on option-on maps.

## Measurements (oracle author, 2026-11-12; option on with today's code, three landmarks, no cave; `decor: false`;
seeds 1-32; debug test build without debug info, macOS arm64)
- **Attempts and time.** Worst attempt index **2** (seed 8). Refusals before the map: seed 5 `Repair(RadiusPost)`
  at 0; 8 `Signature` at 0, `Repair(RadiusPost)` at 1; 9 and 16 `Signature` at 0; 11 `SignatureDiscarded` at 0; 13 and
  32 `Repair(RadiusPost)` at 0; every other seed attempt 0. Time to a certified map: 444-976 ms (about 500 ms at
  attempt 0).
- **The far elite camp** (every seed has two Frost elite camps). Tile; distance to the nearest map edge; Chebyshev
  distance to the nearest tile of another zone: 1 (150,139) 9, 7; 2 (7,22) 7, 6; 3 (149,149) 10, 46; 4 (12,136) 12, 30;
  5 (7,15) 7, 5; 6 (8,8) 8, 43; 7 (11,148) 11, 40; 8 (148,148) 11, 29; 9 (9,150) 9, 25; 10 (22,9) 9, 9; 11 (9,144) 9,
  32; 12 (148,145) 11, 32; 13 (45,10) 10, 10; 14 (147,9) 9, 39; 15 (16,149) 10, 32; 16 (150,148) 9, 33; 17 (7,152) 7, 6;
  18 (151,7) 7, 7; 19 (11,141) 11, 23; 20 (10,10) 10, 56; 21 (12,9) 9, 25; 22 (9,149) 9, 55; 23 (44,147) 12, 14;
  24 (133,20) 20, 7; 25 (151,10) 8, 21; 26 (149,10) 10, 44; 27 (10,23) 10, 7; 28 (148,10) 10, 9; 29 (148,10) 10, 33;
  30 (129,7) 7, 5; 31 (136,136) 23, 9; 32 (11,148) 11, 31. The camp is 76-103 tiles from the map centre against a Frost
  centroid of 44-61: at least 25 tiles beyond it on every seed, so a cave round it is on the back edge without leaning.
- **Room for a chamber** (at the Landmarks phase of the certifying attempt, after the volcano, church and tree; free =
  Frost floor owned by no feature, off the coliseum, road and lanes; walls also off every camp halo; the church's rule:
  each wall line 4-7 tiles from the camp tile with 3 tiles to the border, or the side leans on the border within 9;
  no other camp inside; the mouth and the floor-split test not modelled). Every seed 1-32 admits at least 16 such
  rectangles. A camp-centred square fits on every seed (radius 4 at least); only radius 4 on seeds **5** and **30**
  (camp 7 from the edge and 5 from another zone: 24 and 16 rectangles, half of them leaning), radius 4-5 on seeds 2 and
  17 (camp 7 from the edge, 6 from another zone: 80 and 32 rectangles). The most ice-legal interior tiles (off every
  halo, eight floor neighbours inside) of any legal rectangle: 32 on seeds 5 and 30, 54-55 on 2, 17 and 27, 65-124
  elsewhere; a chamber with every wall at 4 or 5 tiles holds almost no ice (the halo reaches 3 tiles, and ice keeps
  one tile off the wall), so at least one side must stand at 6-7 or lean on the border. No seed is structurally
  blocked; seeds 5 and 30 are the tight ones.
- **The lake today.** The Frost styler grows two meres on every seed 1-32 (2-13 ice bodies). The largest ice body:
  149-539 tiles. Its nearest tile to the far elite camp is 4-7 tiles away (Chebyshev) on 24 of 32 seeds, and far away
  on seeds 3 (27), 5 (79), 10 (54), 13 (24), 17 (87), 18 (103), 25 (104), 28 (69). Today's lakes often hug that camp,
  but in signature mode the cave takes that ground first (the clearance field keeps a lake about 3 tiles off owned
  tiles, `landmarks/recipes/direct_family/rime.rs:126-128`), so the lake must be seeded at the mouth rather than found there.
- No seed lacks a lake, so the "no lake: the mouth faces the centroid" trap does not arise on seeds 1-32; the oracle
  requires the lake on every seed 1-16.

## Existing tests changed (owner approval needed; all in the `oracle:` commit, so read-only for the implementer)
- `crates/rh-sim/tests/mapgen_signature_core.rs`: `g3_the_finished_map_carries_the_zone_anchors` leaves Frost out of
  its exact anchor list as it already leaves out Fire (Frost's anchor is checked by the new target);
  `g1_g2_...`'s "later feature" excludes `Cave` (a Landmarks-phase feature) as it excludes the volcano's kinds.
- `crates/rh-sim/tests/mapgen_signature_fire.rs`: `fire_maps_certify_clean_and_carry_the_volcano_anchor` compares the
  anchors other than Frost's; `SIGNATURE` gains `Cave`, so `is_styler` does not count the cave as a styler feature
  and `note1_bog_tree_tiles_stay_out_of_other_landmarks_aprons` also keeps the bog tree out of the cave's apron.
- All pass before and after the implementation; nothing else in either file moved.
- `crates/rh-server/src/map_pool/tests.rs`: one case appended; `crates/rh-server/src/signature/tests.rs` is deleted by
  the implementer with the module (its last live check, the maker's options, moved to the new case).

## Doubts and misfits (oracle author)
- The apron rule already forbids the bands' worst case: a `Mere`, `Causeway`, `Spire` or `Headland` owning a tile in
  the cave's apron (core band) discards the map (`SignatureContext::intact`, `landmarks/signature/mod.rs:374-449`),
  so the lake's nearest tile will in practice be in the near band (3-6 tiles off the footprint) and the spire/headland
  core-band case restates that rule for those two kinds.
- Spires grow inside a lake and headlands on its shore (`style_rime/shape.rs` `run`): a lake seeded at the mouth
  brings its spire and headlands toward the cave, so the arrangement and the lake are one change.
- Ice inside the chamber versus the hazard walk: the camp is reached through the mouth over the cave's ice; the
  certifier's `spawn-walk-hazards` (at most 8 hazard tiles per spawn walk) judges it. A mouth with ice across it would
  add to every walk that passes; keeping the mouth's approach dry is the implementer's choice.
- `--signature-landmarks` "and nothing else": the oracle reads it as the served map being byte-equal (as an `Arena`)
  to the generator's map; the remaining "the module is gone" is checked from the source tree (the file, the directory
  and the `lib.rs` line), which is unusual for a unit test but is the only machine check of a deletion.
- The ADR's measurements and decision 9 (server) need rewriting for the cave and the deleted pass.

## Size and where to cut (estimate: about 450-550 lines of implementation)
Cave site and chamber (church-like rectangles round the camp, mouth toward the front, ice inside, floor-split and
wall-piece checks; ~250), wiring, `intact`, `finish`, the anchor and `style_rime::signature_anchor`'s mouth (~60), the
Frost styler's signature branch (seed the first lake at the mouth, keep shelves out of the core band; ~120-180), the
rh-server deletion (about 750 lines removed, ~15 changed). That stays under the 600-line cut, so the packet is not
split. If the first attempt runs over, cut **P-MAPGEN-SIG-FROST-2 = the lake at the mouth and the band arrangement**:
it takes `the_mouth_opens_onto_the_largest_lake` and `spires_and_headlands_keep_out_of_the_core_band` unchanged (a
split moves cases, it does not change them); everything else stays here.

## 9. Validation commands
- `cargo test -p rh-sim --test mapgen_signature_frost` (and `-- --ignored --nocapture report_attempts` for seeds
  17-32), `cargo test -p rh-sim --test mapgen_signature_core`, `--test mapgen_signature_fire`,
  `cargo test -p rh-sim --lib mapgen::`, `cargo test -p rh-server --lib map_pool`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The site is the risk (camps near the edge), then the lake: the styler must put water where the mouth is, not
the mouth where the water happens to be.

## 11. Known traps
- A zone whose stylers produce no lake on some seed: say what the mouth faces (the zone's centroid) and count those
  seeds; do not refuse the map for a missing lake.
- With four landmarks, attempts per seed rise: if any seed in 1-32 needs more than 8 of its 16 attempts, report it
  before tuning anything.
- Deleting `signature.rs` removes the last user of some `map_pool` helpers and of `Report`: let the compiler and
  clippy find them.

## Notes from previous attempts
