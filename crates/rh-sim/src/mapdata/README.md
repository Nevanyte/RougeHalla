# Canonical gameplay map data (P-MAP-1 M0 leaf)

`MapExport` represents `rh-map/2`: a `format` tag, `legacyMapHashU32`, and `map` containing every actual `GameMap` field.
`MapExport::validate()` consumes the document and yields `ValidatedMap`; `into_parts()` moves out `(w, h, tiles, layers)`
without retaining a second collision copy. Stored layers can reconstruct the canonical document through
`to_export(&tiles)` after checking the supplied collision data. `MapLayers` exposes only immutable references and queries. Its serialized
form is `{legacyMapHashU32, data: {...all noncollision GameMap fields...}}`.

Root integration must compare `layers.dimensions()` against the collision map dimensions and call
`layers.validate_for_tiles(tiles)` before attaching metadata, including during checkpoint deserialization.
Deserializing `MapLayers` validates metadata lengths, domains and references on its own. The validation boundary is
an import check, not the independent full generator certifier required by the remaining P-MAP-1 milestones.

Seed metadata uses signed i64 restricted to JavaScript safe integers (±9007199254740991), preserving the real producer’s
negative and wider-than-u32 seeds. Attempt metadata uses u64 restricted to nonnegative JavaScript safe integers.
`legacyMapHashU32` alone remains uint32. Captured producer examples include seeds -1 and 4294967297 and explicit attempt
4294967296.

All records reject unknown fields. New fields, enum members or payload layouts require an explicit schema change;
there are no ignored JSON bags or silently discarded gameplay fields. `MapFeature.p` is the actual ordered integer
payload, preserved as `Vec<i32>` with kind-specific shape/domain/reference checks. The payload forms come directly
from `zoneStyle/{landmarks,scorch,gallows,warren,rime,sanctum}.ts`, `bushes.ts` and `mapgen.ts`:

- landmark: rotation, mirror, ordered door tile indices;
- crater: camp index, quarter-tile radius, breach count, direction indices;
- lavaRiver: doubled width, ford count, ordered ford tile indices;
- fenceRow: axis, row index, phase;
- barrow: quarter-tile radius, tunnel flag, road direction, wet side;
- mere: lake index, ice tile count;
- headland: direction;
- hall: axis, pitch, radius, actual piers, bay count;
- bush: authoritative camp index, clump index;
- gallows, spire, causeway and infill: empty.

`props` alone is explicitly cosmetic in the legacy contract, never read by its simulation. Its kind, world position
and variant remain typed and preserved. The two captured maps use `decor:false`, so their props arrays are empty.
Terrain, buildings, feature parameters and every other captured layer remain part of static metadata.

`region_at_world` / `is_coliseum_at_world` use `regionGrid`, **not** the coliseum rectangle. `bush_at_world` returns
`1 + feature index` exactly when `featureGrid` names a `bush`; it does not infer bushes from collision or terrain.
Both match the actual legacy queries at every tile centre and captured grid-edge samples. Out-of-grid or nonfinite
points return none/zero. The coliseum tile rectangle is separately available through `coliseum().rect`.

`legacyMapHashU32` remains oracle metadata at this structural import boundary. The separate pure
`mapgen::map_hash::map_hash` now reproduces the source compatibility identity; import does not call it or treat it as a
certificate. That source identity omits props, coliseum and region mob-camp lists, while static simulation hashing
includes all gameplay layers. Existing `rh-map/1`, map pins and prior parity capture values are untouched. The admitted layers
now load through the actual headless runner and survive simulation/checkpoint/replay integration. Full map generation,
zones/styles, independent certification, public map transport and seed-pin parity remain later milestones.

Canonical self-consistency also requires the outside border to be unowned plain wall; each ordered contiguous gate
opening to lie on its declared coliseum-rectangle side; crater anchors to equal their referenced camp centres; and
bush-owned cells to be plain floor in their referenced camp's territory. These import checks do not rerun the full
connectivity, fairness, shape or independent certification pipeline.

Validation diagnostics are lazy: successful tile/record checks construct no diagnostic strings. A native arm64
counting-allocator measurement on the same actual seed-3 map, with JSON parsing excluded, changed `MapExport::validate`
from **184105 to 41 allocation calls** and the subsequent `ValidatedMap::into_arena` from **51258 to 8**. The latter
includes normal collision-map derived-table construction and the attachment-time collision revalidation. These are
constructor/restore measurements, not steady-tick or whole-server performance claims. No checks were removed or cached.
