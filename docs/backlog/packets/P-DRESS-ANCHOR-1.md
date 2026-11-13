# P-DRESS-ANCHOR-1: decoration rings are anchored on each zone's landmark, in the generator's bands

- **Serves:** owner direction 2026-11-12 (generation order: zones, landmark, obstacles, then decoration around the
  landmark; core rules G3, G4, G7; ADR 0028); plan lane D rule 3 (influence rings)
- **Implementer tier:** implementer-sonnet (single crate: `rh-mapdress`; no `rh-sim` edit is needed, see section 5)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (decoration is not in legacy as rules: DEV-021 covers it) · no sim, wire or content-hash
  change (the rules file is outside `content_hash`)

## 1. ID and outcome
`rh_mapdress::dress` (`crates/rh-mapdress/src/lib.rs:512`) lays each zone's rings around the feature named in
`rules/zones.json` `zones.<zone>.signature.feature`. Today those are legacy features (`crater`, `gallows`, ...) with
ring radii of the starter rules (0-6, 6-14) measured from the feature's centre. When this lands, on a map made with
`pipeline::Options::signature` the rings follow the generator's landmark: Fire `volcano`, Sentenced `church`, Plague
`bogTree`, Frost `cave`, Holy `hall`; distance is measured from the landmark's footprint rectangle, not its centre; and
the ring edges are the generator's bands (core up to 2 tiles, near up to 6, mid up to 14, far beyond), read through the
generator's own `signature::band`, not copied numbers. Each band names a ground variant and a prop family, so a zone
reads from its landmark outward (volcano: ember, scorched basalt, ash; church: flagstone yard, graves, dead grass, dead
trees; tree: roots, reeds, fungus; cave: ice shelf, frost rock, snow; hall: paving, banners, lawn). A zone with no
anchor, and every map made without the option, is dressed exactly as today by the existing `feature` and `rings`.

Marsh rings (Plague "water" beside a bog pool, "mud" outside it): **cut from this packet**, written as
`P-DRESS-MARSH-1.md` (reason in section 10).

## 2. Dependencies
- P-MAPGEN-SIG-FROST-1 merged (the cave's `FeatureKind`; it is in the base: `Cave` is `mapdata/model.rs:203`).
  P-MAPGEN-SIG-SENTENCED-1 is not required.

## 3. Relevant legacy paths
None: no legacy counterpart (DEV-021). What the packet reads, established from the code on `feature/unity-rework`:

- **How `dress` finds the anchor today.** `ZoneRules.signature_feature` (`src/rules.rs:116`, from JSON
  `zones.<zone>.signature.feature`, parsed as `FeatureKind` camelCase, `rules.rs:230-233`) is looked up in
  `GameMapData.features` by `kind` and `zone`; the largest by `tiles` wins, first on a tie (`src/lib.rs:99-111`); the
  anchor is that feature's **bbox centre** in world units. No such feature: the integer mean of the zone's tile centres
  (`lib.rs:113-126`). Ring distance is the **tile-centre to anchor-centre** distance against `inner`/`outer` tiles,
  `[inner, outer)` (`lib.rs:380-384`), not footprint distance. Ground variants use the same test, on floor tiles
  (`tiles == 0`) of the zone only (`lib.rs:385-393`); ring props use `Grid::open` (`lib.rs:149-155`: zone, not
  keep-clear, not occupied, not tall in a corridor, tile class in the ring's `on`) at `lib.rs:394-410`.
- **What a signature map exposes.** `GameMapData.anchors: Vec<ZoneAnchor>` (`rh-sim/src/mapdata/model.rs:283`, empty
  without the option; skipped in JSON when empty). `ZoneAnchor { zone, kind, centre, footprint: TileRect, front,
  entrance }` (`model.rs:246-258`); `footprint` is the landmark feature's `bbox` (`signature/mod.rs:366-379`; the Holy
  hall's anchor is added there too, `:380-395`). So **anchors are on the finished map** and the crate does not need to
  find the landmark by `FeatureKind`. Owned tiles per feature are **not** a separate field: `feature_grid: Vec<u8>`
  (`model.rs:280`, 1-based index into `features`) records the owner of each tile, and `feature_owner` exists only on the
  generator's working `LandmarkStage` (`signature/mod.rs:293`). The bands are defined on the rectangle
  (`signature::band` below), so this packet uses the **footprint rectangle** and does not use `feature_grid`. Footprints
  measured on seeds 1-8: volcano 5x5, church about 11x12, bog tree about 15x14, cave about 12x12, **hall 38-39 square**.
- **Bands.** `pub enum Band { Core, Near, Mid, Far }` (`signature/mod.rs:173`) and `pub fn band(anchor: &ZoneAnchor, x:
  i32, y: i32) -> Band` (`:182`): Chebyshev distance from the footprint rectangle (0 inside it) against
  `DEFAULT_DEFINITION.bands = [2, 6, 14]` (`:119`), inclusive: core <= 2, near <= 6, mid <= 14, far beyond. Both are
  already `pub`, and the path `rh_sim::mapgen::landmarks::signature` is public (`mapgen/mod.rs:10`,
  `landmarks/mod.rs:6`): **no `rh-sim` edit and no copied band table are needed**. `rh-mapdress` already depends on
  `rh-sim` (`Cargo.toml`), so there is no new dependency or cycle. The stub already re-exports `Band` as
  `rh_mapdress::rules::Band`.
- **Generating signature maps in tests.** `pipeline::Pipeline::new(&fixed).certified_styled(seed,
  pipeline::Options { signature: true, ..Default::default() })` (`pipeline/mod.rs:22-31`). Measured in a debug build:
  about 0.5 s per map (0.98 s the slowest, seed 8), 4-5 s per test binary for seeds 1-8. Seeds 1-8 all certify and all
  carry five anchors (kinds Volcano, Church, BogTree, Cave, Hall).
- **Floor tiles per band** (seeds 1-8, measured; the smallest case): core 40-52 (Fire; core of the Holy hall is its whole
  38x38 court, about 1500 floor tiles), near 52-330, mid 116-1391. So a near and a mid ring of density >= about 4 places
  props on every seed.

## 4. New paths
- none (the implementer edits existing files; the oracle adds `tests/anchor.rs`, `tests/landmark_rules.rs`,
  `tests/fixtures/zones_v1_legacy.json`)

## 5. Exclusive write scope
- `crates/rh-mapdress/src/**`, `crates/rh-mapdress/rules/zones.json`, and `crates/rh-mapdress/tests/**` only for
  non-oracle test support (the oracle files below are read-only).
- `crates/rh-sim/**`: **not touched** (the band lookup is already public). Nothing is left for the open generator packet.

## 6. Contracts and references
- ADR 0028 (core rules G1-G8: keep-clear outranks theme G5; clusters and edges, not scatter), DEV-021, C-RNG n/a
  (hash noise only, as the engine).

## 7. Behaviour to preserve
- Keep-clear outranks theme: no prop in `keep_clear`, no tall prop in `tall_corridor`; byte-identical reruns for the same
  map, hash and rules; the prop cap; every existing test in `tests/properties.rs`, `tests/rules_file.rs`, `src/**` stays
  green and unedited.
- Option off (no anchors) is today's output byte for byte: pinned by golden hashes in `tests/anchor.rs` (this packet's
  own values, measured on the tree before the change; not captured from legacy).

## 8. Acceptance checks
- `cargo test -p rh-mapdress` green; `cargo fmt --all -- --check`; `cargo clippy -p rh-mapdress --all-targets
  --all-features -- -D warnings`.
- `scripts/gate.sh --quick --oracle packet/P-DRESS-ANCHOR-1` passes (the coordinator runs the full gate).

### Rule-file schema as pinned
The existing keys are the **fallback path and do not change**: `signature.feature` and `signature.rings` (these are what
a zone without an anchor uses; `rules_file.rs` and `properties.rs` keep checking them). The new part is additive and
optional (serde default), so the pre-packet file still parses:

```json
"signature": {
  "feature": "crater",                      // fallback kind (unchanged); "rings": [...] unchanged
  "landmark": {                             // new
    "feature": "volcano",                   // volcano | church | bogTree | cave | hall; must equal the anchor's kind
    "rings": [                              // at most one ring per band; core, near and mid required, far optional
      { "name": "fire-core-ember", "band": "core", "groundVariant": 3,
        "props": [{ "kind": "fire.ember", "density": 14.0 }], "on": ["floor"] }
    ]
  }
}
```
(Deviation from the coordinator's sketch: the landmark kind is **not** put in `signature.feature` with a new
`fallbackFeature`, because the existing property tests read `signature.feature`/`signature_feature` as the legacy kind
and may not change. The stub types are `ZoneRules.landmark: Option<LandmarkRules>`, `LandmarkRules { feature, rings:
Vec<BandRing> }`, `BandRing { name, band: Band, ground_variant, props, on }`; the stub parses and resolves kinds and
densities already.)

### Semantics pinned by the oracle (the implementer builds the engine and the data)
1. **Switch.** A zone uses the landmark path iff `rules` has `landmark` for it **and** `map.anchors` has an entry for the
   zone. Not by searching `features` by kind: the Holy `hall` exists in option-off maps, which must stay byte-identical.
   Per zone: removing one anchor changes only that zone.
2. **Band.** A tile's band is `signature::band(anchor, tx, ty)` from the zone's anchor (footprint rectangle).
3. **Ground.** For each floor tile (`tiles == 0`) of the zone, the ground variant is the `groundVariant` of the zone's
   ring for the tile's band, or 0 if the zone has no ring for that band (far, typically). Wall, low and other-zone tiles
   stay 0.
4. **Props.** A ring's props stand only on tiles of its own zone and its own band, subject to `Grid::open` as today.
5. **Every stage keeps tall props out of the core band** (cluster, edge and filler stages too, not only the rings): in
   landmark mode, treat core tiles of the zone like the tall corridor in `Grid::open`. This is the part of the oracle
   most likely to be missed: without it Holy's palm grove puts palms inside the hall's court (verified on seed 1).
6. **Kinds.** Every landmark ring owns its kinds: disjoint from every other rule in the file (legacy rings, clusters,
   edges, fillers, other landmark rings), because the oracle attributes a prop to its ring by kind. Core-ring kinds are
   not tall. New kinds need new codes (free in the shipped file: Fire 6-10, Sentenced 17-20, Plague 27-30, Frost 37-40,
   Holy 47-50) and names whose last segment keeps `tall_kinds_match_the_art_that_unity_fades` true; names only, no
   sprite paths. `allowed_classes` must include landmark rings (`on`).
7. **Validation** (refuse, naming the rule): unknown band, two rings for one band, a ring with no props (the stub does
   not refuse the last two; serde's message for an unknown band does not name the rule).

Reference check (done by the oracle author, thrown away): a prototype of these semantics with three non-tall kinds per
zone at densities 14/8/4 for core/near/mid and `Grid::open` blocking tall props in the core band passes every oracle test
below on seeds 1-8. The densities are the implementer's to tune.

## Oracle files (read-only for implementers)
- `crates/rh-mapdress/tests/anchor.rs` (signature maps, seeds 1-8; golden hashes of the option-off dressing)
- `crates/rh-mapdress/tests/landmark_rules.rs` (schema, shape of the shipped file, refusals, `allowed_classes`)
- `crates/rh-mapdress/tests/fixtures/zones_v1_legacy.json` (the pre-packet `rules/zones.json`, verbatim, for the old-schema
  and golden-hash guards)
- this brief
- Stub commit (the implementer's to replace or edit): `crates/rh-mapdress/src/rules.rs` (landmark types and parse; the
  `STUB` comment lists what is left there). The implementer also edits `src/lib.rs` (engine), `rules/zones.json` (kinds
  and `landmark` blocks) and may update the module docs.

Red today, for the stated reason (all on assertions or the test's own messages; nothing fails to compile):
- `anchor.rs`: `the_generator_gives_every_zone_an_anchor_of_the_kind_the_rules_name`,
  `every_ring_prop_stands_in_the_band_its_ring_declares_inside_its_own_zone`,
  `the_ground_plane_follows_the_band_of_each_floor_tile`,
  `each_zone_has_ring_props_in_its_near_and_mid_bands_on_every_seed`,
  `no_tall_prop_of_any_stage_stands_in_the_core_band` (all: "`rules/zones.json` has no signature.landmark block"), and
  `a_zone_without_an_anchor_is_dressed_by_the_fallback_rings_alone` ("the landmark path leaves Holy's ground as the
  fallback has it": the dressing ignores anchors).
- `landmark_rules.rs`: `the_shipped_file_names_the_five_landmark_kinds_and_a_fallback_for_each`,
  `landmark_rings_run_core_near_mid_with_distinct_ground_and_their_own_kinds` (no landmark block),
  `an_unknown_band_is_refused_naming_the_rule` (message lacks the rule), `two_rings_for_one_band_are_refused_naming_both_rules`
  and `a_landmark_ring_without_props_is_refused_naming_the_rule` ("a malformed rule file was accepted"),
  `a_kind_placed_by_a_landmark_ring_is_allowed_on_that_rings_tile_classes` (`allowed_classes` ignores landmark rings).
- Guards, green now and to stay green: `anchor.rs` `with_the_option_off_the_dressing_is_todays_byte_for_byte`,
  `a_signature_map_stripped_of_its_anchors_is_dressed_as_today`, `keep_clear_and_the_tall_corridor_still_hold_on_signature_maps`,
  `signature_map_reruns_are_byte_identical`; `landmark_rules.rs` `a_file_without_a_landmark_block_still_parses_and_keeps_its_fallback`,
  `the_fallback_keys_of_the_shipped_file_are_the_pre_packet_ones`, `a_landmark_block_parses_bands_in_file_order`,
  `an_unknown_kind_or_negative_density_in_a_landmark_ring_is_refused_naming_the_rule`; and all of `properties.rs`,
  `rules_file.rs`, `src/**` tests.
- The existing `rules_file.rs` is not extended (existing tests stay as they are); `landmark_rules.rs` carries the
  "five landmark kinds and a fallback for each" check instead.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH" CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0`
- `cargo test -p rh-mapdress --no-fail-fast` (about 20 s in a debug build); `cargo fmt --all -- --check`;
  `cargo clippy -p rh-mapdress --all-targets --all-features -- -D warnings`

## 10. Risk and suggested model tier
Sonnet. Footprint distance on a non-rectangular landmark (the volcano's cone, the cave's chamber): the bands are the
generator's rectangle bands, so this packet uses the footprint rectangle (not the tiles `feature_grid` records), as
`signature::band` does. **The Holy hall is 38-39 tiles square**, so its core band is the whole court: the hall's
"paving, banners, lawn" must be flat (non-tall) in the core, and near/mid are a 4-to-14 tile belt outside the court.

Marsh rings are cut: they need a second anchor concept (a multi-source distance field from terrain code 5), compete with
the landmark rings for the single ground-variant plane (a precedence the owner has not stated for Plague's bands versus
the pool rings), and need their own oracle (distance from every bog tile, per-tile variant, no props). Brief:
`P-DRESS-MARSH-1.md`, depends on this packet's schema.

## 11. Known traps
- The kinds in the rules file are names only until the art packets map them to sprites: do not add sprite paths here.
- Legacy feature-tied props (anvil, gate lanterns, crater lips) come from the generator's decor stream and are not this
  crate's to place.
- `Grid::open` is used by every stage; the core-band rule must reach clusters, edges and filler, not only the rings.
- New codes in `kinds` have no Unity art until the art mapping lands; how the client treats an unmapped code was not
  checked here (not established): say so in the hand-off.
- Option-off output must not change, including with the new kinds added to the file: kind codes already in use keep
  their codes.

## Notes from previous attempts
