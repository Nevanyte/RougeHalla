# P-DRESS-ENGINE-1: `rh-mapdress`, a pure rule engine that decorates a generated map in order

- **Serves:** owner beta-follow-up decision 3 (MIGRATION, 2026-11-10: "random assets are spawned everywhere, I want
  there to be some order, like Minecraft": a signature landmark per zone with randomness built around it, clusters with
  clearings, keep-clear zones, wall and fence dressing); plan section D, packet 7
- **Implementer tier:** implementer-sonnet (one new crate; property tests as the oracle)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (no legacy counterpart: legacy decorated per tile at random; DEVIATIONS row proposed in
  the hand-off) · no sim, wire, content-hash or parity change (cosmetic data only, outside `content_hash`)

## 1. ID and outcome
Unity decorates a map by rolling one die per floor tile (`RegionProps.Scatter`), so props look scattered at random
and differ from nothing the server knows. This packet adds `crates/rh-mapdress`: a pure function from a generated map
(`rh_sim::mapdata::GameMapData`) and a rule file to a **dressing**: a list of props and a ground-variant plane, in the
shapes the protocol 17 map blob already reserves (`rh_protocol::map::MapProp`: kind u8, x u16, y u16, variant u8,
flags u8, at most 8192; `ground_variants`: one byte per tile). The engine runs these stages in order, each seeded
from the map's hash and the stage name (hash noise, no RNG state, byte-identical on every run and platform):

1. **Keep-clear mask**: camps (clearing + 2 tiles), spawns, crate spots, ground spots, the coliseum and its gate
   lanes, concealment bushes, and for tall props a corridor between each zone's camps and the coliseum gates.
2. **Legacy props**: every `GameMapData.props` entry (the generator's feature-tied decor) is kept as is.
3. **Signature rings**: distance bands from the zone's signature feature (the largest feature of the zone's signature
   kind) pick the ground variant and the prop family per band.
4. **Clusters with clearings**: groves, grave plots, rubble fields at low-noise sites: members spaced inside, open
   ground between clusters.
5. **Edge dressing**: props along walls, fences, shores (terrain borders) and zone borders.
6. **Filler**: sparse flat clutter on what is left.

Rules live in `crates/rh-mapdress/rules/zones.json` (`kinds`: name to code and a tall flag; `keepClear`; per zone:
`signature { feature, rings[] }`, `clusters[]`, `edges[]`, `filler[]`). This packet ships the engine and a starter rule
file with at least one rule of each stage per zone, using Unity's existing art names as kind names
(`RegionThemes.cs` rule names: `fire.spire`, `sent.tomb`, `plague.tree`, `frost.pine`, `holy.palm`, ...). Tuning per
zone, the bake into served maps and the Unity drawing are later packets.

## 2. Dependencies
none (new crate; reads `rh-sim` map data only)

## 3. Relevant legacy paths
- none for the rules. For what the generator already emits: `crates/rh-sim/src/mapdata/model.rs` (`GameMapData` :226,
  `MapProp` :218, `FeatureKind` :172, `MapFeature` :203, `CampDef` :129, `Zone` :27), the decor phase
  (`crates/rh-sim/src/mapgen/style_runtime/mod.rs:371`), zone geometry in `docs/ZONE_SHAPES_AS_BUILT.md`.
- Unity's current scatter, for the kind names and what "tall" means: `client-unity/UnityProject/Assets/Scripts/View/
  Regions/RegionProps.cs:32-74`, `RegionThemes.cs` (`PropRule`, the per-zone lists).

## 4. New paths
- `crates/rh-mapdress/` (`Cargo.toml`, `clippy.toml` copied from `crates/rh-sim/clippy.toml`, `AGENTS.md` not needed,
  `src/lib.rs` and modules per stage, `rules/zones.json`, `tests/`)

## 5. Exclusive write scope
- `crates/rh-mapdress/**`
- `Cargo.lock`: the new package's entry only, in its own commit `lock: rh-mapdress`; the coordinator authorizes this
  one change (run the gate with `--coordinator` and say so in the hand-off)

## 6. Contracts and references
- Determinism rules of `AGENTS.md` apply as in `rh-sim`: no hash-ordered collections, no clock, no entropy, no
  platform libm; ordered iteration; integer or exactly reproducible arithmetic for placement.
- Dependencies: `rh-sim` (map data types), `serde`, `serde_json`; dev: `proptest` if the workspace already has it.
  Not `rh-protocol` (the bake packet converts); mirror the row shape in a local type.
- Cosmetic only: nothing here may be read by the sim, a bot or the certifier.

## 7. Behaviour to preserve
- Nothing existing changes: no other crate depends on this one yet.

## 8. Acceptance checks
Property tests over generated maps (seeds 1-8 through `Pipeline::certified_styled`, plus `mapdata` fixtures):
- no prop inside the keep-clear mask; no tall prop in a corridor; no prop on a wall, low or hazard tile unless its
  rule says that tile class;
- two runs on the same map and rules are byte-identical; a different map hash gives a different dressing;
- every `GameMapData.props` entry appears unchanged;
- clustering: for a cluster rule, members lie within the rule's radius of their site, sites keep the rule's minimum
  spacing, and at least the rule's clearing share of the zone's free floor has no cluster prop;
- rings: a prop placed by ring `i` lies in ring `i`'s distance band of the zone's signature feature; a zone without
  that feature falls back to the zone centroid and still dresses;
- the prop count never exceeds 8192 and the ground-variant plane has exactly width x height bytes;
- a malformed rule file (unknown kind name, a ring with inner >= outer, a negative density) is refused with a message
  naming the rule.
- `scripts/gate.sh --oracle packet/P-DRESS-ENGINE-1 --coordinator` passes.

## Oracle files (read-only for implementers)
- `crates/rh-mapdress/tests/properties.rs` (the section 8 property tests over seeds 1-8)
- `crates/rh-mapdress/tests/rules_file.rs` (starter-file shape, tall flags, malformed files refused)
- `crates/rh-mapdress/tests/common/mod.rs` (the eight maps generated once per binary; independent geometry helpers)
- this brief
- Stub commit (the implementer's to replace or edit): `crates/rh-mapdress/Cargo.toml`, `clippy.toml`, `src/lib.rs`,
  `src/rules.rs`, `rules/zones.json`. `src/rules.rs` (parse, validate, accessors) is already complete: the malformed-rule
  and starter-shape tests in `rules_file.rs` pass against the stub. Every `properties.rs` test fails on an assertion
  (the stub dresses nothing). The implementer writes the engine (`dress`, `keep_clear`, `tall_corridor`,
  `cluster_sites`) and may tune `zones.json` values (not the schema, the kind names or the "one rule owns its kinds"
  property); it may not change a test.
- Generating the eight maps takes about 3 s in a debug build (about 0.3-0.45 s each, not 60 ms); each binary runs in 3 s.

### Public API as stubbed
```rust
pub const MAX_PROPS: usize = 8192;  pub const FLAG_TALL: u8 = 1;  pub const FLAG_LEGACY: u8 = 2;
pub struct DressProp { pub kind: u8, pub x: u16, pub y: u16, pub variant: u8, pub flags: u8 }
pub struct Dressing { pub props: Vec<DressProp>, pub ground_variants: Vec<u8> }   // plane: exactly w*h bytes
pub struct ClusterSite { pub zone: Zone, pub rule: usize, pub x: u16, pub y: u16 }
pub fn dress(map: &GameMapData, map_hash: u64, rules: &Rules) -> Dressing;
pub fn keep_clear(map: &GameMapData, rules: &Rules) -> Vec<bool>;     // no prop at all (one flag per tile)
pub fn tall_corridor(map: &GameMapData, rules: &Rules) -> Vec<bool>;  // second mask: no TALL prop
pub fn cluster_sites(map: &GameMapData, map_hash: u64, rules: &Rules) -> Vec<ClusterSite>; // what dress uses
// rules module: Rules::{from_json, starter, kind_code, kind_name, is_tall, zone, allowed_classes}; pub fields on
// Rules, KindDef, KeepClearRules, ZoneRules, RingRule, ClusterRule, EdgeRule, FillerRule; TileClass, Against.
```

### Position unit
World units as `u16` (1 tile = 32 u, the unit of `MapCamp.x/y/r`), clamped to `u16::MAX`. A prop belongs to the tile
`floor(x/32), floor(y/32)`; every rule is judged on that tile. Legacy props (`GameMapData.props`, already world units at
tile centres) become `kind = min(kind, 255)`, `x`/`y` = round-half-away-from-zero clamped, `variant = v`,
`flags = FLAG_LEGACY`, listed first in the output in their original order. Rule-placed props carry `FLAG_TALL` iff their
kind is tall and no other flag. When the total passes `MAX_PROPS` the list is cut to that length (later stages lose).

### Rule file schema (`rules/zones.json`; distances in tiles, densities per 100 candidate tiles)
- `version`; `kinds { name: { code: u8 >= 1 unique, tall?: bool } }`; `keepClear { campMargin, coliseumMargin, corridorWidth }`.
- `zones { fire|sentenced|plague|frost|holy: { signature { feature: FeatureKind camelCase, rings[] }, clusters[], edges[], filler[] } }`.
- ring: `{ name, inner, outer, groundVariant, props[{ kind, density }], on? }` band `[inner, outer)` of the tile-centre distance to the anchor.
- cluster: `{ name, kinds[], radius, minSpacing, clearing (0..1), sites (max per zone), members (max per site), on? }`.
- edge: `{ name, kinds[], against[wall|low|border], distance (Chebyshev, >= 1), density, on? }`; filler: `{ name, kinds[], density, on? }`.
- `on` is a list of tile classes `floor|ember|bog|ice|light|low|wall` (default `["floor"]`): wall = collision 1, low = 2, else the floor terrain (4 ember, 5 bog, 6 ice, 7 light, else floor). "Hazard" tiles are ember and bog.
- Every rule has a unique `name`; every refusal message names the rule (or kind, zone) it is about. In the starter file one rule owns each kind (the property tests attribute props to rules by kind) and filler kinds are not tall.
- Anchor of a zone's rings: the bbox centre `((2x+w)*16, (2y+h)*16)` world units of the largest feature (by `tiles`, first on a tie) of the zone with the signature kind; with none, the integer-division mean of the zone's tile centres.
- Keep-clear (`keep_clear`): tiles whose centre is within `camp.r + campMargin*32` of a camp centre; the tile of each spawn, crate spot and ground spot; the coliseum rectangle and each gate tile, grown by `coliseumMargin` tiles; every tile whose `feature_grid` value is `1 + i` with `features[i].kind == Bush`. Corridor (`tall_corridor`): the segment from each camp centre to the nearest gate centre (`GateDef.x/y`), `corridorWidth` tiles wide.
- Cluster property: every member is within `radius` (world distance) of a site of its rule in the same zone; sites of one rule and zone are at least `minSpacing` apart; the share of the zone's free floor (collision 0, not keep-clear) whose tile centre is farther than `radius` from every site of the rule is at least `clearing`.

### Things in the brief that do not fit the map data (resolved in the oracle)
- Legacy `MapProp.kind` is `u16` (a prop-table index) but the wire row has `u8`: clamped to 255, flagged `FLAG_LEGACY`, so its code never collides with rule kinds.
- "Gate lanes" have no data beyond the gate tiles; the mask covers gate tiles plus margin, and the tall corridors cover the approach.
- The 8192 cap applies to legacy props too (an injected map with more is cut, legacy first).
- Starter kinds added beyond Unity's art names: `fire.ash` (filler: flat; `fire.stump` is tall). Starter signature features: crater (fire), gallows (sentenced), barrow (plague), mere (frost), hall (holy); features are present on all of seeds 1-8.
- Densities are `f64` in the file; placement must stay reproducible (hash noise and integer or exactly reproducible arithmetic).
- Rings are asserted non-empty on at least 6 of 8 seeds (as are the other stages), not on every seed.

## 9. Validation commands
- `cargo test -p rh-mapdress`, `cargo clippy -p rh-mapdress --all-targets -- -D warnings`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet. Medium: a new crate with no callers; the oracle is the property list above.

## 11. Known traps
- Generating a certified map takes about 60 ms; generate the eight once per test binary, not per case.
- Signature landmarks added by `rh-server` (`signature.rs`) are recorded as features on the map: the engine finds them
  through `features` like any other; it must not depend on `rh-server`.
- Positions are world units as `u16` in the wire row: clamp and say what the unit is (the bake packet relies on it).

## Notes from previous attempts
