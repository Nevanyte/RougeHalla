# P-MAPGEN-SIGNATURE-CORE-1: the generator places each zone's landmark right after the zones, and everything later is built around it

- **Serves:** owner direction 2026-11-12 (chat): "generation order should be region zones -> landmark places in zones ->
  set order to randomness and thematic obstacles / decor -> around landmark. There should be core rules that tie the
  random generation together"; owner beta-follow-up decisions 3 and 4 (MIGRATION, 2026-11-10); the approved plan's
  P-MAPGEN-SIGNATURE-CORE-1 (a signature option in mapgen, default legacy)
- **Implementer tier:** implementer-opus (rh-sim mapgen; default-mode maps must stay byte-identical; cross-crate: the
  rh-server flag)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: every pinned map (default options) byte-identical; no legacy counterpart for the landmarks
  (DEV-020 drafted) · D2 n/a · no sim tick, wire or content-hash change

## The core rules (owner direction; every generation packet from here on obeys them)

| # | Rule |
|---|---|
| G1 | **Order.** A map is built in four steps and no step moves what an earlier step placed: (1) zones (partition, coliseum, camps); (2) one landmark per zone; (3) thematic obstacles (the zone styler's terrain and walls); (4) decoration (`rh-mapdress`). |
| G2 | **One landmark per zone, placed by a site rule**, before any obstacle: Fire volcano on the zone's back edge; Sentenced church around the far elite camp; Plague giant bog tree in the outer third; Frost cave on the back edge around the far elite camp; Holy the temple hall (exists). Because it goes first, a landmark is never squeezed into leftover floor: on a map where the zone exists the landmark exists. |
| G3 | **The landmark is the zone's anchor.** Steps 3 and 4 read one shared fact per zone: the anchor (its centre, footprint and facing: toward the coliseum is "front"). Nothing else may be used as the centre of a zone's arrangement. |
| G4 | **Bands.** Distance from the anchor's footprint defines bands (core, near, mid, far; widths in tiles, one table for all zones). Each zone gives each band a thematic obstacle family (step 3) and a decoration family and ground variant (step 4). Density and size fall with distance from the anchor; the far band blends into the neighbouring zone. |
| G5 | **Keep-clear outranks theme.** Camps and their clearings, spawns and spawn walks, routes and gate lanes, crate and ground spots stay free; lava and other impassable obstacles leave a ford on every route. The generator's own checks and the certifier are the judge: a map with any failure is discarded, never repaired by removing the landmark. |
| G6 | **Randomness is seeded and local.** Every choice (site, shape, obstacle, prop) is drawn from a stream derived from the map seed, the zone and the step, so one seed gives one map everywhere, and changing one zone's rule does not reshuffle another zone. |
| G7 | **Clusters and edges, not scatter.** Obstacles and props appear as groups with clearings between them and along edges (walls, shores, zone borders); isolated single pieces are filler and sparse, with a minimum spacing. |
| G8 | **Legacy stays reachable.** With the signature option off the generator's output is byte-identical to today's; parity fixtures and pinned maps never move. |

## 1. ID and outcome
Today the landmarks are added by `crates/rh-server/src/signature.rs` **after** the whole map is generated: it looks for
leftover floor, tries up to five sites and keeps a landmark only if the map still certifies. That is the wrong order
(G1, G2): the landmark is squeezed in last, places on 9 to 16 of 16 maps depending on the zone, and the stylers'
obstacles know nothing about it. The generator already has the right place: its pipeline runs
`Prefix (zones, coliseum, camps) -> Landmarks -> Spawns -> Styler -> ...` (`crates/rh-sim/src/mapgen/pipeline/mod.rs`
:279-350), with a landmark stage built on recipes, templates and a site search (`crates/rh-sim/src/mapgen/landmarks/`).

When this lands `pipeline::Options` has a `signature` option (default off, G8). With it on, the Landmarks phase also
places each zone's signature landmark (G2) as recorded features with their own kinds, before spawns and stylers, so
the spawn preparation, the route guard and every styler see the landmark as existing terrain and build around it; and
the phase publishes each zone's **anchor** (G3) to the stylers and on the finished map. This packet delivers the
option, the phase, the anchor record and the band table (G4) as a helper, and the two simplest landmarks end to end:
the **Plague bog tree** (outer third, dry floor, ringed by bog bands) and the **Sentenced church with its graveyard**
(around the far elite camp, door toward the front, mirrored headstone rows with walkable gaps). The Fire volcano and
the Frost cave, each with its styler's arrangement, are `P-MAPGEN-SIG-FIRE-1` and `P-MAPGEN-SIG-FROST-1`; the stylers'
band arrangement for Plague and Sentenced is `P-MAPGEN-SIG-STYLE-1`. `rh-server`'s `--signature-landmarks` sets the
option, and for Plague and Sentenced the post-pass in `signature.rs` no longer runs (it stays for Fire and Frost until
their packets land, then the file is deleted).

## 2. Dependencies
none (P-SIGNATURE-1-fix is merged; P-SIGNATURE-2 is superseded: its oracle cases are the source for this packet's
shape checks, see `packet/P-SIGNATURE-2` @ b58de6ab, `crates/rh-server/src/signature/tests.rs`)

## 3. Relevant legacy paths
- none (new terrain). The generator as ported: `crates/rh-sim/src/mapgen/` (`pipeline/mod.rs`, `landmarks/`,
  `style_runtime/`, the zone stylers), `docs/ZONE_SHAPES_AS_BUILT.md`, `docs/R2_GENERATOR_AS_BUILT.md`.
- The shapes to port: `crates/rh-server/src/signature.rs` (`church` with the graveyard, `bog_tree`, `insert`,
  `refresh_camps`) and the measurements in the P-SIGNATURE-2 brief on `packet/P-SIGNATURE-2`.

## 4. New paths
- chosen by the oracle author inside `crates/rh-sim/src/mapgen/landmarks/` (signature recipes or a `signature` module)

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/pipeline/` (the option; the phase's inputs and outputs), `crates/rh-sim/src/mapgen/landmarks/`
  (the signature landmarks), `crates/rh-sim/src/mapdata/model.rs` (appended `FeatureKind`s and the anchor record on
  the map, serialized so that a map without them is unchanged), `crates/rh-sim/src/mapgen/map_hash/` and
  `certify/diagnostics.rs` only for the new kinds' names
- `crates/rh-server/src/map_pool.rs` (pass the option), `crates/rh-server/src/signature.rs` (skip Plague and Sentenced
  when the generator placed them), `crates/rh-server/src/signature/tests.rs` cases that pinned the post-pass for those
  two zones (the oracle author replaces them)
- `docs/adr/0028-signature-landmarks.md` (rewritten around G1-G8)
- not the zone stylers (`style_*`): they are the next packets

## 6. Contracts and references
- G1-G8 above. G8 is checked by the existing pinned-map tests (`pipeline/tests.rs`, `styled_tests.rs`,
  `style_zones/tests.rs`, `map_hash/tests.rs`, `mapgen/fixtures`): none may change.
- Determinism (`AGENTS.md`): the landmark's draws come from their own stream (seed, attempt, zone, a new stream id);
  the main attempt RNG and the stylers' streams draw exactly what they draw today when the option is off, and with it
  on the stylers' streams are unchanged in count (their results differ only because tiles are taken).
- The map export format string and `feature_grid` ids: say whether `rh-map/2` can carry the new kinds and the anchor
  (unknown-field policy of `GameMapData` and of the C# and JS map readers) or the format must move; a format bump is
  a wire-adjacent change and must be called out before it is made.

## 7. Behaviour to preserve
- Everything with the option off. `--map-pool` without `--signature-landmarks` unchanged.
- The elite camp inside the church stays reachable; camp territory area and radius are computed after the landmark,
  as the pipeline computes them for any feature.

## 8. Acceptance checks
- Oracle (G8): the existing pinned-map tests pass untouched; one new test asserts `certified_styled` with the option
  off equals today's output for seeds 1-8 (hash equality against the option-less call).
- Oracle (G1, G2), seeds 1-16 with the option on: every map that generates has a bog tree and a church (16 of 16 for
  each); no styler feature's tiles overlap a landmark's; the landmark features precede every styler feature in
  `features`.
- Oracle (shapes): every bog tree stands in the outer third of the Plague zone's radial extent on non-bog floor; every
  church contains the far elite camp's clearing, has a door tile joined to the spawn-walkable region, and a graveyard
  of at least 4 headstones, mirrored about the door axis, no two orthogonally adjacent, the same gap from the wall on
  every door side.
- Oracle (G3): each zone's anchor is on the finished map (Plague: the tree; Sentenced: the church; Holy: the hall;
  Fire and Frost: absent until their packets) with centre, footprint and front direction.
- Oracle (G5): every option-on map of seeds 1-16 certifies with zero failures (`rh_sim::mapgen::certify`).
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIGNATURE-CORE-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIGNATURE-CORE-1`

## 9. Validation commands
- `cargo test -p rh-sim mapgen::landmarks`, `cargo test -p rh-sim mapgen::pipeline`, `cargo test -p rh-server --lib
  signature`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The risks are a stream or a default-mode byte that moves (G8), and generation that refuses more often once
landmarks take space first: report the attempt counts per seed with the option off and on.

## 11. Known traps
- The pipeline's `Options` is `deny_unknown_fields`: the new field needs a serde default so stored options still read.
- The stylers' free-tile test reads `protect` / `no_block`: the landmark's tiles and an apron must be in it before the
  spawn preparation runs, or spawns and routes will be laid through the church.
- A zone can lack an elite camp or space on some seeds: the generator's existing answer is to refuse the attempt and
  try the next one (G5), not to drop the landmark. Say how often that happens.

## Notes from previous attempts
- P-SIGNATURE-2 (post-pass polish) was stopped on 2026-11-12 when the owner restated the order; nothing of its
  implementer branch was kept.
