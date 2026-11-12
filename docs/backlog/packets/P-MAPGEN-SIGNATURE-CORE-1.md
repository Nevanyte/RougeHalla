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
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` (stub committed; the implementer may add sibling files in
  `landmarks/signature/`, e.g. `bog_tree.rs`, `church.rs`)
- `crates/rh-sim/tests/mapgen_signature_core.rs` (oracle)

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/` (the step, the anchors, the band helper)
- `crates/rh-sim/src/mapgen/pipeline/mod.rs` (the seam is committed; only if the step needs more inputs)
- Already stubbed, touch only if a row is wrong: `crates/rh-sim/src/mapdata/model.rs`, `mapdata/validate.rs` (anchor
  validation may be added here), `mapgen/certify/rules.rs` (`SIGNATURE_KINDS` only), `mapgen/certify/features.rs` and
  `certify/diagnostics.rs` (signature kinds only), `mapgen/map_hash/mod.rs` (kind names)
- `crates/rh-server/src/map_pool.rs` (`StyledMaker::options` passes `signature`), `crates/rh-server/src/signature.rs`
  (drop the church and bog-tree builders, `Church`/`Report.churches`, `church_site`, `door_open`; keep Fire and Frost)
- `docs/adr/0028-signature-landmarks.md` (rewritten around G1-G8); a DEVIATIONS row proposal in the hand-off
- not the zone stylers (`style_*`), not `records/`, `spawns/`, `repair/`, not `tests/content.rs`

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
- `crates/rh-sim/tests/mapgen_signature_core.rs`: `g8_signature_off_is_todays_generator` (passes on the stub and must
  keep passing), `g1_g2_one_bog_tree_and_one_church_placed_before_the_stylers`,
  `shape_bog_tree_stands_in_the_outer_third_ringed_by_bog`,
  `shape_church_encloses_the_far_elite_camp_with_a_door_to_the_front`,
  `shape_graveyard_headstones_are_mirrored_about_the_door_at_one_gap`, `g3_the_finished_map_carries_the_zone_anchors`,
  `g4_band_helper_measures_from_the_footprint`, `g5_signature_maps_certify_clean_and_spawns_avoid_the_landmarks`, and
  their helpers. The definitions they measure (front, door side, outer third, far elite camp, apron, styler feature)
  are written at the top of the file.
- `crates/rh-server/src/signature/tests.rs`: the whole file; the new case is
  `the_generator_owns_the_church_and_the_bog_tree` (see "Existing tests changed" for what the stub commit removed).
- This brief.

Against the stub each new case fails on an assertion: g4 `inside (40,50) left: Far right: Core`; g1/g2, tree, church,
graveyard and g5 `seed 1: 0 <Kind> features`; g3 `seed 1: anchored zones left: [] right: [Sentenced, Plague, Holy]`;
rh-server `the maker does not pass the signature option`. g8 passes.

## Seam (oracle author's decision, 2026-11-12)

**A sibling step inside the Landmarks phase, not recipes.** `pipeline::build_attempt` calls
`landmarks::signature::SignatureContext::apply(&frame, &mut landmark)` right after `stage::StageContext::apply`, before
`observe(Phase::Landmarks)` and `spawns::prepare_and_pick`, only when `options.signature && styled`. Why not a
recipe or template in the existing stage:
- `LandmarkRuntime` writes only floor-to-wall under `admit_changes` (`landmarks/stage/mod.rs:180-215`: every changed
  cell must be owned by a `FeatureKind::Landmark` of its zone) and asserts an all-zero terrain layer
  (`landmarks/runtime/mod.rs`, `LandmarkRuntime::new`); the bog tree's bands are terrain.
- `FeatureKind::Landmark` carries the legacy buildings' certifier rules (fixed variant per zone, `landmark_margin`,
  `landmark_gap`; `certify/features.rs:113-130`), and every Landmark bbox becomes `map.buildings` (`stage/mod.rs:151`,
  `record_buildings` in `pipeline/mod.rs`), which repair and records treat as legacy buildings.
- `Recipes::apply` is the ported legacy dispatch pinned by `fixtures/landmark-recipes-*.json` and `landmark-stage.json`.

**What the step writes** (all on `LandmarkStage`, so everything later sees it):
- `state.tiles`, `state.features` (appended after the stage's own: their draft index is below every styler feature's,
  and `records::finalize` sorts stably by (zone, infill), so they precede the zone's styler features on the map),
  `state.feature_owner`.
- `masks.near1 |= footprint grown by bands[0]` (the apron). Read by `spawns::PoolInput::landmark_near1` (the spawn pool
  avoids it) and by `SpawnContext::style_protect` (`spawns/mod.rs:120-133`: `landmark_near1 && feature_owner == 0`
  becomes `protect`, which `style_runtime::no_block` (`style_runtime/mod.rs:208`) makes the stylers' `no_block`); owned
  tiles are refused by `Runtime::open` / `can_block` through `feature_owner != 0` (`style_runtime/mod.rs:569-606`).
- `masks.boxes |= footprint`: repair's keep mask (no rezone or carving, `repair/mod.rs:698-702`), the ground spots
  (`spots/ground.rs:53`) and the region pole (`records/mod.rs:184`) keep off it.
- `Placed.terrain`: the attempt's starting terrain layer (the pipeline uses it instead of `vec![0; W*H]`): the bog.
- Not `LandmarkStage::buildings` (that is `map.buildings`).
- Draws: `Mulberry32::new(hash_seed(seed as u32, attempt as u32, zone slot (1-based), Definition::stream = 5))`;
  streams 0-2 are the stylers', 3 the recipes', 4 the bushes'. Never `frame.rng`.
- `Ok(None)` refuses the attempt (`Refusal::Signature`, appended); the pipeline tries the next one (G5).
- After `records::finalize`, `SignatureContext::finish(&mut map, placed.anchors)` writes `map.anchors`.

**Stub signatures** (`landmarks/signature/mod.rs`): `pub struct Definition { pub stream: u32, pub bands: [i32; 3] }`
(the implementer appends the shape tunables here, nowhere else), `pub const DEFAULT_DEFINITION` (`stream: 5, bands:
[2, 6, 14]`), `pub enum Band { Core, Near, Mid, Far }`, `pub fn band(anchor: &ZoneAnchor, x: i32, y: i32) -> Band`
(stub: `Far`), `pub struct Placed { anchors: Vec<ZoneAnchor>, terrain: Vec<u8> }`, `SignatureContext::{new,
from_definition, definition, apply(&self, &AttemptFrame, &mut LandmarkStage) -> Result<Option<Placed>,
AttemptInputError> (stub: places nothing), finish(&self, &mut GameMapData, Vec<ZoneAnchor>) (stub: nothing)}`.
`pipeline::Options { .., #[serde(default)] pub signature: bool }`, `pipeline::Refusal::Signature`. rh-server:
`StyledMaker::options(&self) -> pipeline::Options` (stub: does not pass `signature`; `make` uses it).

**Feature kinds** (appended to `FeatureKind`, serialized `bogTree`, `church`, `graveyard`; names in `map_hash` and the
certifier diagnostics; `p` empty): `BogTree` (trunk walls plus bog-band floor, job `landmark`), `Church` (wall ring,
job `landmark`), `Graveyard` (headstone walls, job `cover`). Their certifier rows are a separate
`certify::rules::SIGNATURE_KINDS`, looked up through `rules::kind(k)`, so the legacy `KINDS` (pinned length 13) and
`content_hash` do not move. `Volcano`, `LavaStream`, `LavaPool`, `Cave` are **not** reserved: each needs a certifier
row whose wall/low/terrain choice belongs to its packet; appending later is free (serde by name, earlier
discriminants unchanged).

**Anchor record** (`mapdata::ZoneAnchor` on `GameMapData.anchors` and `LayerData.anchors`, carried by `split`/`join`):
`{ zone, kind: FeatureKind, centre: TilePt, footprint: TileRect (the anchor feature's bbox), front: u8 (DIR16 toward
the coliseum centre), entrance: Vec<TilePt> (the church door; empty for the tree) }`, in zone-code order,
`#[serde(default, skip_serializing_if = "Vec::is_empty")]`. Holy's anchor is its largest `Hall` feature, written by
`finish`. **`rh-map/2` does not move**: `GameMapData`, `LayerData` and `ZoneAnchor` are `deny_unknown_fields`; every
existing document (no `anchors` key) reads unchanged and an option-off map writes no key (g8 checks it). A document
with anchors exists only inside an option-on server process (`StyledMaker::make` -> `MapExport::validate` -> `Arena`),
never as a fixture; an older Rust reader would refuse it, the right failure. The C# reader
(`AtmospherePreviewCapture.cs`) and the JS tools read legacy `rh-map/2` fixtures only, and the wire carries neither
features nor anchors (`public_ground.rs` reads only bushes). Anchors are **not** in the map hash (they restate the
signature features' kind and bbox, which are hashed).

**Band table (G4)**: Chebyshev distance d from the footprint rectangle (0 inside): core d <= 2 (also the apron kept
clear), near <= 6, mid <= 14, far beyond. Reasoning: a zone is about 4,900 tiles of the 160-tile map (about 50 tiles
deep from the coliseum road to the edge), a camp territory reaches at most 30 tiles and a crater 5-7.5
(`docs/ZONE_SHAPES_AS_BUILT.md`), and a landmark is 10-16 tiles across: core 2 matches the certifier's
`landmark_gap` 3, near 6 is about a crater radius, mid 14 keeps the landmark's half of the zone inside near and mid and
leaves the rest far, blending into the neighbours.

## Existing tests and records changed in the stub commit (owner approval needed)
- `crates/rh-sim/src/mapgen/pipeline/tests.rs:207` and `pipeline/styled_controls.rs:173`: the exhaustive
  `Options { .. }` literals gain `signature: false` (a new field breaks them; values unchanged).
- `crates/rh-sim/src/mapgen/map_hash/tests.rs:380` (`every_dto_field_requires_an_explicit_hashing_decision`):
  `anchors: _` with its reason; the test exists to force this decision.
- `crates/rh-sim/tests/content.rs` `NON_GAMEPLAY`: two entries (`certify/rules.rs SIGNATURE_KINDS`,
  `landmarks/signature/mod.rs DEFAULT_DEFINITION`), so the signature tunables are **not** folded into `content_hash`
  and `GOLDEN_CONTENT_HASH` stays. **Owner decision:** every other mapgen definition is folded
  (`TABLES_FOLDED_BY_HASH`); folding these too moves the content hash the client checks. This packet keeps the brief's
  "no content-hash change" by exempting them while the option is off by default.
- `crates/rh-server/src/signature/tests.rs`: removed `graveyard_stones_keep_walkable_gaps_and_the_yard_stays_reachable`,
  `every_church_has_an_open_door_joined_to_the_map` and their helpers `flood`, `first_spawn` (ported as the rh-sim
  church and graveyard cases); the first case's "placed at least once" list is now volcano and frozen cave.
- Outside the original scope, stubbed: `mapgen/records/mod.rs` (`anchors: Vec::new()` in its `GameMapData` literal),
  `mapdata/mod.rs` (a test helper's literal), `mapdata/validate.rs` (signature kinds take no params).

## Measurements (oracle author, 2026-11-12; debug test build, `CARGO_PROFILE_TEST_DEBUG=0`, macOS arm64)
- `certified_styled`, option off, seeds 1-16: **1 attempt on every seed**, with `decor: false` and with the defaults;
  every map certifies with zero failures (Strict::All). One certified map takes **260-475 ms** (median about 300).
- Plague radial extent on every seed: lo 10, hi 104-111, so the outer third starts near 77 tiles; 124-535 outer-third
  Plague cells have a radius-8 disk wholly inside the zone.
- Sentenced has two elite camps on every seed; the far one is 81-104 tiles from the centre, mostly 6-10 tiles from the
  map edge or a corner. A camp-centred square ring of radius 7 stays inside the zone or on border walls on 11 of 16
  seeds; it leaves the map or enters a neighbouring zone on seeds 7 (1 tile), 8 (10), 9 (44; camp at (6.5, 6.5)), 13
  (27) and 16 (22). The church should lean on the border wall or be an off-centre rectangle round the clearing
  (radius 2.5) rather than a camp-centred square; otherwise those attempts are refused.
- The implementer reports attempts per seed and ms per map with the option on.

## Where to cut if it is too large (estimate: about 450 lines of implementation)
Step plumbing, anchors and band helper (~100), the bog tree (~100), the church with its graveyard (~250). If the
first attempt runs over, split: **CORE-1** = seam + bog tree + anchors + band (cases g4, tree, g3 for Plague and Holy)
and **CORE-2** = church and graveyard (church, graveyard; g1/g2, g3, g5 and the rh-server case need both). The oracle
is written for the whole packet; a split moves cases, it does not change them.

## Doubts and misfits (oracle author)
- G1 vs the Holy hall: the "temple hall" is the `Hall` feature the Holy styler places in step 3
  (`crates/rh-sim/src/mapgen/style_sanctum/mod.rs:299`), not a Landmarks-phase landmark, so Holy's anchor exists only
  after the stylers and the Holy styler cannot read it. Moving it is a styler packet.
- Front is DIR16 toward the coliseum (defined in the oracle file); the church door takes its dominant axis, so a
  diagonal front (2, 6, 10, 14) puts the door on the x side.
- The church is closed (with the door shut the camp cannot reach the first spawn). `Bush` and `Infill` features may
  still fall in an apron: they are not styler features.
- `Options::signature` with `styled == false` does nothing (the plain tail strips terrain; plain maps are fixtures).
- The content-hash decision above.

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
