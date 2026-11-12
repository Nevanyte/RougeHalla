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
- listed by the oracle author on `packet/P-DRESS-ENGINE-1` (the test files; the stub commit creates the crate with the
  public signatures: `dress(map: &GameMapData, map_hash: u64, rules: &Rules) -> Dressing`, `Rules::from_json`)

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
