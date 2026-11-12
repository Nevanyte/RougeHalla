# P-MAPGEN-SIG-FIRE-1: the Fire volcano in the generator, with lava streams ending in pools and the zone's obstacles arranged around it

- **Serves:** owner direction 2026-11-12 (generation order and core rules G1-G8, in
  `docs/backlog/packets/P-MAPGEN-SIGNATURE-CORE-1.md`); owner decision 4 (MIGRATION, 2026-11-10: "Fire get a volcano
  with generated streams of lava coming from it oozing out across the fire region"; answer: "Streams end in lava pools")
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase and the Fire styler; rh-server post-pass)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart for the volcano (DEV-020) · D2 n/a ·
  no sim tick, wire or content-hash change

## 1. ID and outcome
P-MAPGEN-SIGNATURE-CORE-1 gave the generator a signature step in its Landmarks phase and placed the Plague bog tree
and the Sentenced church there. Fire's volcano is still added after generation by `crates/rh-server/src/signature.rs`
(mostly one short stream, usually in front of the zone's centre, on 13 of 16 maps). When this lands, with the
signature option on:
- **Landmark (G2):** the generator places a volcano on the Fire zone's back edge (its centre farther from the map
  centre than the zone's centroid): a cone of wall with a crater, and **two or three lava streams** that run from it
  toward the front (the coliseum), each **ending in a lava pool**, edged with ember. A site that cannot fit two
  streams is not used. It is placed before spawns and stylers, in the masks the core step uses, from its own stream.
- **Obstacles around it (G3, G4):** in signature mode the Fire styler (`style_scorch`) no longer places its lava
  river (the streams replace it: total lava stays within the legacy river's budget of about 70 to 160 tiles) and
  arranges its craters by band from the volcano: none in the core, the larger ones in the near band, smaller and
  sparser in mid and far. Every route through the zone keeps a ford (G5).
- **Anchor:** Fire's `ZoneAnchor` (centre, footprint, front) is on the finished map.
- **rh-server:** the post-pass no longer places a volcano.
Two reviewer notes on the core packet are closed here (same files, same tier): the bog tree's site test also keeps
out of other landmarks' aprons (`near1 == 0` for tree tiles, `landmarks/signature/mod.rs` `Site::ground`), and the
end-of-attempt discard gets its own appended `Refusal` variant (or `Refusal::Signature`'s doc names both causes).

## 2. Dependencies
- P-MAPGEN-SIGNATURE-CORE-1 merged (the step, masks, anchors, band helper). Strictly serial with P-MAPGEN-SIG-FROST-1
  and P-MAPGEN-SIG-STYLE-1 (`landmarks/signature/mod.rs`, `pipeline/mod.rs`).

## 3. Relevant legacy paths
- none for the volcano. The Fire styler as ported: `crates/rh-sim/src/mapgen/style_scorch/` (`mod.rs:152-189`,
  `craters.rs`, `river.rs`), `docs/ZONE_SHAPES_AS_BUILT.md` (Fire). The post-pass's shape to port:
  `crates/rh-server/src/signature.rs` (`volcano`). The shape checks already written for it:
  `git show packet/P-SIGNATURE-2:crates/rh-server/src/signature/tests.rs`
  (`volcanoes_have_two_or_three_streams_ending_in_pools_on_the_back_edge`).

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/volcano.rs`

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/` (the volcano; the two carried notes), `pipeline/mod.rs` (only what
  the step and the styler's inputs need), `crates/rh-sim/src/mapgen/style_scorch/` (signature-mode arrangement),
  `mapdata/model.rs` (appended kinds `Volcano`, `LavaStream`, `LavaPool`), `certify/rules.rs` (`SIGNATURE_KINDS`
  rows), `map_hash/` and `certify/diagnostics.rs` for the names
- `crates/rh-server/src/signature.rs` and the post-pass volcano cases in `signature/tests.rs` (replaced by the oracle)
- `docs/adr/0028-signature-landmarks.md`
- Already stubbed, touch only if a row is wrong: `certify/features.rs` and `mapdata/validate.rs` (the new kinds take
  no params)
- not `style_zones/`, `style_runtime/`, `records/`, `spawns/`, `repair/`, `tests/content.rs`

## 6. Contracts and references
- G1-G8. G8 binds the styler too: with the option off `style_scorch` draws and places exactly what it does today
  (the pinned styler tests and fixtures pass untouched); the signature-mode branch may draw differently.
- Lava is impassable and ember burns: the certifier's connectivity and hazard rules judge the result; a map with any
  failure is discarded (G5).

## 7. Behaviour to preserve
- Option off: every pinned map, the Fire styler's fixtures, the map hash tests.
- Option on: the bog tree and the church from the core packet still place on every seed; the Fire camps keep their
  clearings and routes.

## 8. Acceptance checks
- Oracle, seeds 1-16, option on: every map has one volcano; it has 2 or 3 streams; each stream's last cell touches
  a pool; its centre is farther from the map centre than the Fire zone's centroid; no `LavaRiver` feature exists;
  total lava tiles are within 70 to 160; every Fire camp is reachable from a spawn without crossing lava.
- Oracle (bands): no crater in the core band; the mean crater size in the near band is at least the mean in mid and
  far; craters still exist (at least the legacy count minus two per map).
- Oracle (G8): option-off maps for seeds 1-8 are byte-identical; the pinned styler tests pass untouched.
- Oracle: every option-on map of seeds 1-16 certifies with zero failures; the anchor list now carries Fire.
- Oracle (rh-server): the post-pass places no volcano.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FIRE-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_fire.rs` (new target, sixteen maps option on and sixteen option off generated
  once per binary; the definitions it measures are at the top of the file):
  `g8_option_off_maps_are_todays` (passes on the stub and must keep passing),
  `volcano_has_two_or_three_streams_each_ending_in_a_pool`,
  `volcano_on_the_back_edge_with_streams_toward_the_front`, `no_lava_river_and_lava_within_the_rivers_budget`,
  `every_fire_camp_is_reachable_from_a_spawn_without_crossing_lava`, `craters_are_arranged_by_band_round_the_volcano`,
  `fire_maps_certify_clean_and_carry_the_volcano_anchor`, `the_bog_tree_and_the_church_still_place_on_every_seed`
  (passes on the stub), `note1_bog_tree_tiles_stay_out_of_other_landmarks_aprons`,
  `note1_the_bog_tree_site_keeps_out_of_marked_aprons`, `note2_refusals_tell_no_site_from_a_discarded_map`, and
  their helpers.
- `crates/rh-server/src/signature/tests.rs`: the whole file; the new case is `the_generator_owns_the_volcano`.
- `crates/rh-sim/tests/mapgen_signature_core.rs` (the core packet's oracle, edited here; see "Existing tests changed").
- This brief.

Against the stub (`cargo test -p rh-sim --test mapgen_signature_fire`, `cargo test -p rh-server --lib signature`):
- fail on an assertion: volcano/streams and back edge `seed 1: 0 Volcano features`; budget `seed 1: a lava river
  with the option on`; craters `seed 1: no Fire anchor (anchors [Sentenced, Plague, Holy])`; certify/anchor
  `seed 1: anchored zones left: [Sentenced, Plague, Holy]`; note 1 (site) `seed 1: 85 bog-tree tiles in an apron
  marked before the step`; note 1 (finished maps) `seed 8: bog-tree tile (127, 22) in the building's apron (120, 22,
  130, 32)` (a real case: today's tree on seed 8 stands inside a legacy building's `near1`); note 2 `seed 6 attempt
  3: discarded after records left: Signature right: SignatureDiscarded`; rh-server `seed 1: the pass still runs the
  volcano: Report { placed: ["volcano", "frozen cave"], .. }`.
- pass and must keep passing: `g8_option_off_maps_are_todays`, `the_bog_tree_and_the_church_still_place_on_every_seed`,
  `every_fire_camp_is_reachable_from_a_spawn_without_crossing_lava` (today's river leaves fords; the streams must
  too), every case of `mapgen_signature_core.rs` and the other rh-server signature cases.

## Seam (oracle author's decision, 2026-11-12)

**The styler learns signature mode and the anchor from the volcano feature itself; no new styler input.** How a styler
gets its inputs: `pipeline::build_attempt` builds one `style_zones::Input` (`pipeline/mod.rs:375-393`: geometry,
`protect`, spawns, `centre_walk`, caps; nothing per zone) and `style_zones::Registry::apply_inner`
(`style_zones/mod.rs:336-401`) hands each styler a `ShapeContext` over the shared `style_runtime::State`, whose
`features` are the Landmarks phase's features (`pipeline/mod.rs:364-372` moves `state.features` in).
`BaseContext::zone_features()` (`style_runtime/contexts.rs:34`) is the styler's view of them. So the volcano that the
signature step writes is already visible to `style_scorch::Callbacks::shape`, and it *is* Fire's anchor (the anchor's
centre is the feature's anchor point, its footprint the feature's box, its front `signature::front` of the centre:
the same fact `SignatureContext::finish` writes on the map). The stub adds
`style_scorch::signature_anchor(BaseContext) -> Option<ZoneAnchor>` (`style_scorch/mod.rs`), `Some` only when the zone
has a `Volcano` feature, i.e. only with the option on. Why not an `Option<&ZoneAnchor>` on `style_zones::Input` or on
`shape`: a new `Input` field breaks the two pinned literals in `style_zones/tests.rs:746,888`, a new `shape` argument
the pinned `style_scorch/tests.rs:593,620` calls, and `style_zones/` is outside this packet's write scope; option off
the function cannot return `Some`, so legacy mode has nothing new to read (G8). The implementer branches on it inside
`Callbacks::shape` (`style_scorch/mod.rs:152-194`): with `Some`, no `place_river` and the band arrangement in
`place_craters`; with `None`, today's code, draw for draw.

**Stub (commit `stub:`)**, compiling and changing no behaviour:
- `FeatureKind::{Volcano, LavaStream, LavaPool}` appended (`mapdata/model.rs`; serde `volcano`, `lavaStream`,
  `lavaPool`), names in `map_hash/mod.rs` and `certify/diagnostics.rs`, no params in `certify/features.rs` and
  `mapdata/validate.rs`.
- `certify::rules::SIGNATURE_KINDS` grows to 6 rows (below).
- `landmarks/signature/volcano.rs`: `pub(super) fn place(&Site, &mut Mulberry32) -> Option<Built>` returning `None`,
  not called (`#[allow(dead_code)]`). The implementer wires it into `SignatureContext::apply` for Fire's slot (its own
  per-zone stream, `Definition::stream`), extends `is_signature`/`intact` and `finish` for the new kinds, and keeps
  every tunable in `Definition` (a new `const` anywhere in `rh-sim/src` needs a `tests/content.rs` row, which is
  outside the write scope: do not add one).
- `pipeline::Refusal::SignatureDiscarded` appended, not yet returned (note 2).
- `style_scorch::signature_anchor` (above), not yet read.
- No new constant, so `tests/content.rs` needs no new entry: the six kind rows live in `SIGNATURE_KINDS` and the shape
  tunables in `DEFAULT_DEFINITION`, both already `NON_GAMEPLAY` by the coordinator's decision on the core packet (not
  folded into `content_hash` while the option is off by default). The `SIGNATURE_KINDS` reason there still says
  "three ... kinds"; the coordinator may reword it (prose only).
- Nothing in checkpointed state changes: the new kinds appear in `LayerData.features` only on option-on maps.

**Certifier rows** (`SIGNATURE_KINDS`, params 0 each):

| Kind | wall | low | terrain | jobs | Why |
|---|---|---|---|---|---|
| `Volcano` | yes | yes | 1 (lava) | Landmark | the cone is wall; a crater may hold lava (LOW tiles must then be lava). Floor inside it is allowed by every row. |
| `LavaStream` | no | yes | 1 (lava) | Crossing | lava only, as the legacy `LavaRiver` row it replaces in signature mode; a wall in a stream is a certifier failure. |
| `LavaPool` | no | yes | 1 (lava) | Crossing | as the stream: a lava body that routes go round. |

Ember: `feature-hazards` (`certify/features.rs:218-223`) fails any unowned floor with terrain in a strict zone, so a
stream's or pool's ember edge must be owned by that feature as floor (the legacy river owns its banks the same way,
`style_scorch/river.rs:568-587`). `feature-size` (`features.rs:253-257`) needs at least `piece_min` (6) wall or LOW
tiles per feature: no stream or pool shorter than 6 lava tiles. `feature-overlap` keeps lava and walls off every camp
halo and spawn pad.

## Measurements (oracle author, 2026-11-12; option off, `decor: false`, seeds 1-16, debug test build, macOS arm64)
- One certified map: about 330 ms; every seed at attempt 0.
- **Lava river**: exactly one `LavaRiver` (Fire) on every seed. Its lava (LOW, terrain lava) per seed 1-16: 148, 158,
  148, 107, 137, 109, 128, 113, 133, 150, 139, 138, 132, 128, 143, 156 (**107-158**, all of the zone's lava); the
  feature's tiles with its fords and ember banks: 302-419. The oracle pins 70-160 (the brief's band: the low end lets
  two short streams and pools through, the high end is the measured maximum).
- **Craters** (Fire, one per camp at most; every map has 10 Fire camps): count 9 or 10 (9 on seeds 6 and 10).
  Feature tiles (rim walls plus bowl floor), per seed: 1: 83 83 86 179 138 145 127 186 124 84; 2: 86 174 98 97 137 138
  133 125 133 93; 3: 128 130 133 136 125 81 128 129 96 82; 4: 177 127 121 131 127 135 126 175 139 131; 5: 128 133 96 87
  91 126 171 100 122 133; 6: 135 124 134 135 179 186 121 128 79; 7: 182 134 142 125 131 90 126 82 92 88; 8: 120 173 141
  91 141 126 139 135 184 133; 9: 120 85 136 195 130 118 86 187 95 90; 10: 101 96 125 140 128 139 124 131 141; 11: 132
  186 129 103 133 132 189 127 126 89; 12: 93 124 174 122 135 130 132 136 133 91; 13: 181 93 80 97 145 178 135 138 80 85;
  14: 143 93 126 181 98 136 185 134 98 131; 15: 95 137 130 182 128 89 185 104 126 138; 16: 91 102 98 128 140 126 123 90
  133 120 (range 79-195, rim walls 11-55). The oracle's "size" is the feature's tile count.
- **Fire centroid** (tile units; distance from the map centre (80, 80)): 1 (27.4, 52.2) 59.5; 2 (118.1, 124.0) 58.2;
  3 (82.7, 31.3) 48.8; 4 (30.6, 62.6) 52.4; 5 (125.0, 117.5) 58.6; 6 (33.5, 115.6) 58.6; 7 (28.9, 49.1) 59.7;
  8 (38.8, 121.7) 58.6; 9 (121.2, 38.4) 58.5; 10 (24.8, 80.8) 55.2; 11 (39.3, 125.0) 60.7; 12 (33.8, 61.2) 49.9;
  13 (130.4, 112.2) 59.8; 14 (124.1, 119.3) 59.1; 15 (111.9, 127.0) 56.8; 16 (135.9, 74.2) 56.2.
- **Room on the back side**: Fire cells beyond the centroid's distance that are floor (or today's crater and river
  tiles, which do not exist when the volcano is placed), outside legacy landmarks, at least 2 from the map edge, and
  farther than camp radius + 3 from every camp and 3 from every spawn-pool point: 1,847-2,282 cells per seed. The
  largest free Chebyshev square centred on one of them has half-side 7, 8, 6, 7, 7, 7, 9, 6, 8, 6, 7, 7, 8, 6, **5**,
  6 (seeds 1-16). The post-pass's cone (a radius-2.5 disk round a tile centre: 21 tiles, 5x5 box, half-side 2) with
  its 2-tile apron (half-side 4) fits on every seed, seed 15 with one tile to spare; the whole post-pass volcano
  (cone, streams reaching 4 + len <= 9 tiles out, radius-1 pools: about half-side 10) fits nowhere as a clear square,
  so the streams must be laid as lines through the free floor. No seed needs a cone smaller than the post-pass's.
- Option on (core packet, today): refusals over seeds 1-16, attempts 0-3: 6 site refusals (`Signature` with the trace
  ending at `Prefix`: seeds 3/3, 4/3, 8/0, 9/0, 10/1, 16/0) and 7 end-of-attempt discards (`Signature` with the trace
  ending at `Records`: 6/3, 7/2, 7/3, 9/2, 10/2, 12/2, 14/2). Note 2's case sweeps seeds 6-10, attempts 0-3.
- The implementer reports attempts per seed and ms per map with the option on.

## Existing tests changed (owner approval needed; all in the `oracle:` commit, so read-only for the implementer)
- `crates/rh-sim/tests/mapgen_signature_core.rs` (the core packet's oracle): `g3_the_finished_map_carries_the_zone_anchors`
  compared the anchor list to exactly `[Sentenced, Plague, Holy]` ("Fire and Frost none until their packets"); it now
  leaves Fire out of that comparison (Fire's anchor is checked by the new target). `g1_g2_...`'s "later feature"
  excludes `Volcano`, `LavaStream`, `LavaPool` (Landmarks-phase features, not styler ones). Both pass before and after
  the implementation; nothing else in the file moved.
- `crates/rh-server/src/signature/tests.rs`: `signature_landmarks_land_on_real_maps_and_keep_them_certified` no
  longer counts Fire lava and ember before and after a post-pass volcano, and its "placed at least once" list is the
  frozen cave only. The volcano shape cases of `packet/P-SIGNATURE-2` were never on this branch; their checks are the
  new rh-sim target's.

## Doubts and misfits (oracle author)
- Note 1 is a live defect, not only a hole: on seed 8 today's tree has a tile at (127, 22) inside a legacy building's
  `near1` (`landmarks/signature/mod.rs:414-417`, `Site::ground` reads `protect`, not `masks.near1`;
  `spawns/mod.rs:63-72` builds `near1` from the buildings grown by `landmark_box_margin` 1). Fixing it moves seed 8's
  option-on tree (and may move its attempt count); no option-off byte moves.
- "Crater band": craters are camp pens (`style_scorch/craters.rs:101-243`, one per Fire camp, centred on it), so a
  crater cannot move toward the volcano, only grow, shrink or be dropped. The oracle reads a crater's band as the
  nearest band of any of its tiles, so a large pen round a mid-band camp that reaches into near counts as near. With
  `bands` core 2 / near 6 and crater feature areas of 79-195 tiles (radii of about 5-8), a camp within about 10 tiles
  of the volcano's box needs a smaller pen or none (at most two dropped per map).
- "Streams toward the front": the oracle asks each stream's end to be nearer the coliseum tile than the volcano centre
  is. Three streams fanned evenly (as the post-pass does) fail that; they fan within the front half.
- The legacy river is not removed by a flag on the styler's inputs but by the presence of the volcano feature (seam
  above). A map where the signature step placed no volcano (impossible with the option on: the attempt is refused)
  would keep its river.
- G1 vs the styler: the styler's `place_craters` and `place_river` share the attempt's styler stream
  (`c.streams.rng`); dropping the river in signature mode changes nothing earlier in that stream (the river draws
  after the craters, `style_scorch/mod.rs:188-189`), so with the option on the crater draws match today's until the
  band arrangement changes them.

## Size and where to cut (estimate: about 450-550 lines of implementation)
Volcano site, cone, 2-3 streams bending round keep-clear tiles, pools and ember (~300); wiring, `intact`, `finish`,
the anchor (~50); the styler's signature branch without the river (~20); the crater band arrangement (~100); the two
notes (~30). That stays under the 600-line cut, so the packet is not split. If the first attempt runs over, cut
**P-MAPGEN-SIG-FIRE-2 = the crater band arrangement**: it takes `craters_are_arranged_by_band_round_the_volcano`
unchanged (the case is already written; a split moves it, it does not change it), and everything else stays here.

## 9. Validation commands
- `cargo test -p rh-sim --test mapgen_signature_core`, the new Fire test target, `cargo test -p rh-sim --lib mapgen::`,
  `cargo test -p rh-server --lib signature`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The streams are the risk: they must reach the front without sealing a camp or a route, on every seed.

## 11. Known traps
- The lava river is built from the camp-node tree in `style_scorch` (`mod.rs:157-189`): removing it in signature mode
  changes which tiles the craters may take; keep the route guard.
- A stream that meets a camp clearing or a route bends around it or stops in a pool early; it never crosses a
  keep-clear tile (G5).
- Report attempts per seed and time per map with the option on, as the core packet did.
- The step's lava and ember reach the attempt through `Placed.terrain` (the styler pass's starting terrain). Later
  passes rewrite terrain: `style_contract::clear_pool_hazards` (spawn-pool hazards), `tail::clear_terrain`, the
  styler's own surface pass. `intact` must catch any lava or ember they strip, and the step should keep ember off the
  tiles they clear rather than rely on the discard.
- `note2`: `Refusal::Signature` stays the Landmarks-phase refusal; the end-of-attempt check (`pipeline/mod.rs`, the
  `placed_any && (!intact || !certifies)` branch) returns `Refusal::SignatureDiscarded`.
- `the_generator_owns_the_volcano` forbids the pass from even naming the volcano in `Report::skipped`: drop the
  builder (and the Fire constants it alone uses) rather than skip it.

## Notes from previous attempts
