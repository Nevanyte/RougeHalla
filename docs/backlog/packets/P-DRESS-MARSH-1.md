# P-DRESS-MARSH-1: Plague marsh rings as decoration ground variants round bog terrain

- **Serves:** owner decision 2026-11-12 (MIGRATION "Marsh slow 0% water 0% mud 30% bog": water and mud are looks only,
  not sim terrain; supersedes the cancelled `P-TERRAIN-MARSH-1`); owner direction 2026-11-10 (Plague pools as rings:
  grass, then mud, then water, then bog); ADR 0028 (Plague's bog tree and marsh)
- **Implementer tier:** implementer-sonnet (single crate: `rh-mapdress`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework (P-DRESS-ANCHOR-1 merged)
- **D-rules touched:** D1 n/a (DEV-021: decoration has no legacy counterpart) · no sim, wire or content-hash change

## 1. ID and outcome
Round every bog tile of the Plague zone (`GameMapData.terrain == 5`, `TileClass::Bog`, `lib.rs:86`), `rh_mapdress::dress`
lays two ground looks in the `Dressing.ground_variants` plane: **water** (id 7) on plain floor within 1 tile of a bog
tile, then **mud** (id 8) on plain floor 2 to 3 tiles from one. Grass (the zone's other ground) stays beyond. Nothing
moves or slows: no terrain code, no wire or content-hash change; the sim sees plain floor. Bog keeps its 0.7 speed.

### Decisions pinned by the oracle
- **Schema**: an optional per-zone list `terrainRings` next to `clusters` (serde default, so every older file parses):
  `{ "name", "around": "bog", "reach": <tiles >= 1>, "groundVariant": <u8> }`, nearest ring first. Ring k covers the
  distances above ring k-1's `reach` and up to its own. Engine type `rules::TerrainRing`, field
  `ZoneRules.terrain_rings`. Refused, naming the rule: `reach` 0, reaches not strictly increasing, `around` other than
  `ember`, `bog`, `ice`, `light` (not floor, low or wall), a rule name already used in the file. Usable by any zone.
- **Shipped values**: Plague gets `plague-marsh-water` (around bog, reach 1, variant 7) then `plague-marsh-mud` (around
  bog, reach 3, variant 8). No other zone has a terrain ring.
- **Ids**: 7 water, 8 mud. Plague's other ground variants are 0 (none), 1-2 (fallback rings) and 3-6 (bog tree bands);
  7 and 8 collide with none of them. (Other zones use 0-6 only; ids are per zone art meanings, as 3-6 already are.)
- **Distance**: Chebyshev, in tiles, straight (a wall does not stop it), to the nearest bog tile **of the same zone**
  (bog in a neighbouring zone rings nothing). A diagonal corner of a bog tile is at distance 1, so a lone bog tile has
  a 3x3 ring of water and a 7x7 square of water plus mud; corners are filled (pinned on a mutated map).
- **Where laid**: only plain floor (`TileClass::Floor`: `tiles == 0` and terrain not ember, bog, ice or light) of the
  rule's zone. Never on bog itself, walls, low tiles, other terrain or another zone; keep-clear does not matter (ground
  only).
- **Precedence on the one ground plane** (coordinator decision): the marsh ring wins within its reach of bog, including
  beside the bog tree and round its own bog bands; outside the mud reach the band (landmark path) or fallback ring
  variant shows exactly as today. Same rule on option-off maps (the fallback rings' variants 1, 2). The rings are laid on
  every map, not gated on `anchors`: option-off maps hold bog too.
- **Props**: none move or are removed, except that a **tall** prop never stands on a tile of the zone's nearest terrain
  ring (water). Non-tall props may stand on water and mud. Only placed props are affected (legacy `GameMapData.props`
  are carried as they are). Consequence, not pinned: a cluster that loses a tree keeps trying until it has its members,
  so another prop may appear elsewhere in that zone. Counts are not pinned.

## 2. Dependencies
`P-DRESS-ANCHOR-1` merged (landmark block, band ground plane).

## 3. Relevant paths (no legacy counterpart; DEV-021)
- `crates/rh-mapdress/src/lib.rs`: `class_of` (:86, terrain 5 = `Bog`), `Grid::open` (:158), `band_plane` (:332),
  `rings` (:407, fallback ground), `landmark_rings` (:454, band ground), `dress` (:592).
- `crates/rh-mapdress/src/rules.rs`: `TerrainRing` (:109), `ZoneRules` (:158), `RawZone` (:282); the stub parses the new
  list without validating it. Module doc: the kind-code scheme (no new prop kind is needed).
- `crates/rh-sim/src/terrain.rs:56-72` (codes; bog slows non-Plague factions) and `mapgen/landmarks/signature/mod.rs:121`
  (`bog_d2`: the bog tree's two bands of bog floor). Not edited.
- Measured with the reference below, plain Plague floor in the rings (water, mud tiles): signature seeds 1-8: 408/861,
  437/817, 379/688, 531/1036, 464/909, 354/625, 344/686, 466/871; option off seeds 1-4: 328/803, 387/828, 378/802,
  425/907.

## 4. New paths
- none (`terrainRings` in `rules/zones.json`, an engine stage)

## 5. Exclusive write scope
- `crates/rh-mapdress/src/**`, `crates/rh-mapdress/rules/zones.json`; non-oracle tests under `crates/rh-mapdress/tests/**`

## 6. Contracts and references
- DEV-021; C-TICK untouched (`rh-sim` is not edited); the ground byte meanings are the art packets'.

## 7. Behaviour to preserve
- Every zone other than Plague is dressed byte for byte as today (per-zone hash goldens in `marsh.rs`).
- Plague's props are unchanged except for the tall-on-water rule; keep-clear and the tall corridor; byte-identical reruns.
- Maps with no bog tile are dressed as before; a rule file without `terrainRings` dresses as before.

## 8. Acceptance checks
- `cargo test -p rh-mapdress` green, `cargo fmt --all -- --check`, `cargo clippy -p rh-mapdress --all-targets
  --all-features -- -D warnings`.
- Suggested implementation (checked: a throwaway version of this made every test green): a plane computed before stage 3
  from the rule list, applied over the ring/band ground, plus a "water" flag `Grid::open` consults for tall props.

## Oracle files (read-only for implementers)
- `crates/rh-mapdress/tests/marsh.rs` (new)
- Existing tests amended in the `stub:` commit, owner to approve (they pinned Plague's whole ground plane, which this
  packet changes by design):
  - `crates/rh-mapdress/tests/anchor.rs`: `the_ground_plane_follows_the_band_of_each_floor_tile` skips Plague tiles
    showing 7 or 8 (marsh.rs pins them exactly); `with_the_option_off_the_dressing_is_todays_byte_for_byte` and
    `a_signature_map_stripped_of_its_anchors_is_dressed_as_today` check the shipped file with its `terrainRings` removed
    against the same goldens (the pre-packet file assertion is unchanged).
  - `crates/rh-mapdress/tests/properties.rs`: `the_ground_variant_plane_is_width_times_height_and_follows_the_ring_bands`
    skips Plague variants 7 and 8.

## 9. Validation commands
- `cargo test -p rh-mapdress`; `cargo fmt --all -- --check`; `cargo clippy -p rh-mapdress --all-targets --all-features
  -- -D warnings`

## 10. Risk and suggested model tier
Sonnet. The field is a small integer neighbourhood scan; the risk is the precedence and not touching other zones'
bytes, both pinned.

## 11. Known traps
- Do not add a terrain code or touch `rh-sim`; the sim treats these tiles as plain floor.
- Compute the water set before stage 3: the bog tree's tall props are placed there.
- Source tiles are the zone's own bog; target tiles are plain floor only (bog tiles of the bog bands keep their band
  variant).
- `marsh.rs` per-zone goldens and the amended `anchor.rs` goldens are this packet's own values from the tree before the
  change, not legacy captures.

## Notes from previous attempts
