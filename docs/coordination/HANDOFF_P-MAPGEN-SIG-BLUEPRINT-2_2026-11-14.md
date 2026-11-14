# Hand-off: P-MAPGEN-SIG-BLUEPRINT-2 (2026-11-14, implementer-opus)

```
PACKET:          P-MAPGEN-SIG-BLUEPRINT-2 — serves the land-generation lane's architecture review of 2026-11-13
                 (finding 2 rest, finding 5, finding 6's terrain codes); Part 2 of 2, before the frame packet, SCALE-4
                 and HOLY-1
BRANCH:          agent/opus/P-MAPGEN-SIG-BLUEPRINT-2 @ 6b6b5e95a (implementation 86f236bca, 5d025d29c, 1492cbc89; rustfmt
                 fix by the lane's session 6b6b5e95a; hand-off commits after it)
GATE:            PASS (full, `scripts/gate.sh --oracle packet/P-MAPGEN-SIG-BLUEPRINT-2`, run by the lane's session on
                 6b6b5e95a) [skipped: Postgres suites (no DATABASE_URL); the CI/owner-hardware-only steps the gate
                 lists]. Attempt 1 failed at rustfmt on one expression in volcano.rs; attempt 2 passed after that fix.
                 Log .agent-runs/gate/20261114T054913-agent-opus-P-MAPGEN-SIG-BLUEPRINT-2-full.log
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs, spec.rs, volcano.rs, cave.rs, church.rs,
                 bog_tree.rs, blueprint.rs (doc lines only)}; comment lines only in crates/rh-sim/src/mapdata/model.rs
                 (`ZoneAnchor`) and crates/rh-sim/src/mapgen/map_hash/tests.rs (the anchors note); this file
D-RULES:         D1: no legacy counterpart (DEV-020); option off untouched (G8); option on byte- and draw-identical but
                 for each anchor's entrance order, shown by Part 1's digest guards (they digest sorted entrances) and every
                 existing pin and golden, none re-pinned; D2 n/a; nothing touches D5/D6/D9 (no sim tick, wire, save,
                 state or content hash)
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: equality on seeds beyond the pinned ones (rests on the reviewer's trace, below); the Postgres suites
RISKS:           `bog_tree.rs` is now a doc-only module (deleting the file needs owner approval); `Spec` gained a field
                 (`any_terrain`) the brief did not name, to keep `intact` exact (below)
```

## What changed
- `spec.rs`: `members` and `by_tile` filled (Fire {Volcano, LavaStream, LavaPool} / {LavaStream, LavaPool}; Sentenced
  {Church, Graveyard}; Plague {BogTree}; Frost {Cave}). New field `any_terrain` (Sentenced: {Church}, else empty), see
  "Brief corrections". Legends write the catalog's bog and ice codes.
- `mod.rs`:
  - `catalog_codes()` looks `bog`, `lava`, `ember`, `ice` up by key in `terrain_gate::DEFAULT_DEFINITION.kinds`; the
    context stores them (`codes`, returned by `terrain_codes()`); `from_definition` asserts in debug that the
    `Definition` mirrors agree. The four `Definition` fields stay as documented mirrors (oracle files and
    `plague_pools.rs` read them).
  - `owned`: per member kind, what `intact` accepts on its owned tiles, built once from the legends' `Write`s (with
    `written()`, shared with `stamp`) plus `volcano::owned` (the volcano's hand list until SCALE-4). A debug check makes
    sure every member kind has a rule.
  - `is_signature`, `by_tile`, `entry_of` are context methods that read the table. `aprons_apart` keys landmarks by
    table entry index (the hall one past the last); the hall rule (`bbox == footprint`) and `finish`'s Church
    exception are unchanged.
  - `apply` and `apply_only` share `place(frame, stage, halo, terrain, zone)`. A zone without a reserved site, slot or
    table entry refuses (`Ok(None)`). `apply_only` refuses a zone that reserves no site (Holy).
  - `stamp` sorts the anchor's entrance row-major and dedups it, after the doorway check and the `EntranceMiddle`
    feature anchor, which still read the grid order.
  - `Definition` lost `trunk_d2`, `dry_d2`, `bog_d2`, `bog_min`, `church_side`, `border_max`, `border_gap`,
    `graveyards`, `grave_gap`, `door_shift`, `cave_side`, `mouth`, `forecourt`, `cave_ice_min`; `Stone` is gone. Every
    remaining field has a reader (checked with `rg`). Stale docs fixed: `*_grid`, `axis`, `Site::inner`, the module doc.
- `cave.rs`: `Rect`, `place`, `side` deleted. `lake_at_mouth` reads the catalog's ice code. Its unit tests are
  byte-identical; the names only they use are imported under `#[cfg(test)]`.
- `church.rs`: `Rect` and `place` deleted; `smallest_piece` kept as it was.
- `bog_tree.rs`: `place` deleted; the module doc describing the drawing is kept.
- `volcano.rs`: lava and ember from `ctx.codes`; `place` takes the inner rect itself (no longer `Option`, since every
  caller has one); the `owned` hand list.
- `blueprint.rs`: the `Legality` docs say "inside the inner rect where the `Site` has one".

## Test results (macOS arm64, debug, loaded machine)
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_table`: 8 passed, 0 failed (the four
  red-on-stub tests now pass).
- `cargo test -p rh-sim --features trusted-status-probes --no-fail-fast` (on 86f236bca): exit 0, every target green,
  including `mapgen_signature_blueprint` (Part 1's two digest guards), all `mapgen_signature_*`, `mapgen_land_*`, and the
  `cave::tests` lake unit tests.
- `cargo test -p rh-mapdress` then `cargo test -p rh-server --test map_anchor_seeds --test map_anchors`: six result
  lines, all ok (3, 10, 10, 11, 19 and 7 passed, 0 failed).
- Nothing re-pinned: no pin, digest, golden or test file is in the diff.

## Brief corrections
- **Church in `intact`.** The legend writes the church's walls with terrain 0, but today's arm (`Church => t ==
  TILE_WALL`) accepts a church wall with any terrain, and the terrain gate lets LOW-class terrains (lava, fence,
  crevasse) stand on a wall. A purely legend-derived rule would be stricter, so the table carries
  `Spec::any_terrain = [Church]` to stay exact. Dropping it is a behaviour change and needs its own packet.
- **`ZoneAnchor::centre` for the volcano.** The brief says "the site's centre tile". It is the cone centre that
  `volcano::place` drew inside the site; the model.rs comment says so.

## What the next packets should know
- **Frame packet.** Hand the stylers a `LandmarkFrame` built from `Placed` (anchors, terrain, `landed`). `place` is
  the per-zone seam: a frame per zone can be built there from the `Built` and the `Landed`. `Landed.marks` is
  row-major on the map and loses grid identity; read `blueprint.tiles_of(ch)` through `landing.tile(g)` where mark
  identity matters. The frame packet also removes `finish`'s Church exception and the hall's `bbox == footprint`
  lookup in `aprons_apart`.
- **SCALE-4 (the volcano as a table entry).** Give the Fire entry a drawing and delete `volcano::owned`: `intact`
  then derives the cone's pairs from the legend. The streams and pools are by-tile members not written by the drawing,
  so they need their pairs from somewhere else (a by-tile `Write` list on the entry, or a continuation hook). The
  debug check in `from_definition` fires if a member kind is left without a rule. `place`'s `None if zone ==
  Zone::Fire` arm goes away, and so does `Site::inner = None` for Fire, once the cone is a drawing confined by its
  landing.
- **HOLY-1 (the hall as a table entry).** `aprons_apart` already numbers landmarks by table index, so a Holy entry
  with `members: [Hall]` replaces the `bbox == footprint` lookup. Holy must join `reserved_zones` (site, stream) or
  `place` refuses it.
- **Terrain codes.** New landmark terrain goes through `catalog_codes()` (add the key there and to `TerrainCodes`),
  not through new `Definition` literals.

## `git diff --stat packet/P-MAPGEN-SIG-BLUEPRINT-2` (before this file)
```
 crates/rh-sim/src/mapdata/model.rs                 |  11 +-
 .../src/mapgen/landmarks/signature/blueprint.rs    |   5 +-
 .../src/mapgen/landmarks/signature/bog_tree.rs     | 126 +-----
 .../rh-sim/src/mapgen/landmarks/signature/cave.rs  | 280 +-----------
 .../src/mapgen/landmarks/signature/church.rs       | 238 +---------
 .../rh-sim/src/mapgen/landmarks/signature/mod.rs   | 499 +++++++++++----------
 .../rh-sim/src/mapgen/landmarks/signature/spec.rs  |  39 +-
 .../src/mapgen/landmarks/signature/volcano.rs      |  36 +-
 crates/rh-sim/src/mapgen/map_hash/tests.rs         |   3 +-
 9 files changed, 378 insertions(+), 859 deletions(-)
```
Net -481 lines.

## Review (reviewer-opus, 2026-11-14): LAND, no notes
Read-only, old code against new, kind by kind.
- `intact` and `aprons_apart` from the table accept and reject exactly what the hand-written versions did: bog tree,
  graveyard and cave from their legends; the church through `any_terrain` (it was the only rule that ignored terrain);
  volcano, streams and pools from `volcano::owned` (the old hand list); every other kind passes with no zone test, as
  before. Membership is the same seven kinds; `aprons_apart`'s numbering is the old one.
- `apply` and `apply_only` share `place`, which is the old per-zone body: same order, stream, `Site`, draws and writes;
  `apply_only` shares no state with other zones. The new refusal (no reserved site) cannot be reached in a real game:
  the option that makes the pipeline call `apply` is the one that makes the Prefix reserve all four sites or fail the
  round.
- The entrance sort comes after the doorway check and after the graveyard's anchor point is taken. No reader depends
  on the order: the Frost lake growth and `lake_at_mouth` search from all mouth tiles at once; the server and the C#
  codec carry the order through; `rh-mapdress` does not read it.
- Terrain codes: every write and check uses the looked-up codes; the debug-only agreement check is enough because both
  the definition and the catalog are compile-time constants and every debug test that builds a context runs it.
- Nothing needed was deleted; nothing dead is left. `bog_tree.rs` holds only its module doc: `mod bog_tree;` goes in
  the same change that deletes the file, once the owner approves (file deletion is the owner's call).

Carried forward (not fix packets):
- **HOLY-1:** do not give a Holy entry `members: [Hall]`. Membership, `owned` and `any_terrain` work by feature kind
  over the whole map, and the Holy styler can produce several `Hall` features: that entry would make every hall a
  signature feature. Pick the hall by which feature it is (the frame's written cells and feature), or give the
  signature hall its own kind.
- Minor, left: `lake_at_mouth` and `spec::specs` each call `catalog_codes()` instead of using the context's stored
  codes; nothing asserts that a kind belongs to one entry only (`entry_of` takes the first match); `entrance.dedup()`
  never removes anything.
