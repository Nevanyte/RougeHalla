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
- listed by the oracle author on `packet/P-MAPGEN-SIG-FROST-1`

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
