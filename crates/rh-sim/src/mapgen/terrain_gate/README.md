# Ordered terrain acceptance gate

This leaf ports the pure generator-owned `validateTerrain` in `packages/shared/src/terrain.ts`.
It is not the independent `mapCertify.ts` certifier, a full map generator, or a terrain gameplay-effect implementation.

`validate(&GameMapData, &Options)` returns the ordered source problem strings. A wrong tiles/terrain/regionGrid length
returns all T1 problems before any other check. Unknown byte codes/kinds are safe T2 problems. Empty regions stop the
source check after T5/T11; T9 and styled T10 deliberately do not run in that branch. Open/closed topology is recomputed
from the supplied collision layer every time, without `TileMap` caches or prior admission assumptions.

The map model gives dimensions and layer/prop codes concrete integer domains. Zero/overflowing dimensions, nonfinite or
unrepresentable protected/camp coordinates and negative/nonfinite/unbounded camp radii return `InputError`, instead of
indexing incorrectly or running an unbounded signed loop. A camp's ceil radius in tiles is bounded by max(w,h)+1; this
is an explicit malformed-metadata admission bound, not a relaxed terrain test. Source-valid generator records stay well
inside that bound. Prop coordinates retain the source T9 bounds/finite check, including nonfinite values.

This gate bound is stricter than structural map import, which admits arbitrary finite nonnegative camp radii.
For an in-bounds centre, a radius beyond this gate bound necessarily reaches the wall border and fails the source's
T8 plain-floor rule. This implementation returns typed `Coordinates` before doing that unbounded clearing expansion;
it does not claim identical diagnostic strings for that metadata domain or that import already excludes it.

`TerrainGateDefinition` owns terrain keys/class/home rows, the 34 default prop key/class rows, the ICE id and the three
hazard halo sizes. Its visitor allocates nothing; runtime uses the same rows. Physical tile classes, movement mask, tile
size and snap radius reuse existing registered definitions. Default prop home zones are irrelevant to T9 and not copied
as unused policy. Custom `Options.prop_kinds` preserve source table override behavior, including an explicitly empty table.

The source oracle imports the actual validator and actual generator. It changes no production TypeScript. The fixture
holds six real generated plain/styled/decor maps, two existing full exports, labelled hand-built cases, 256 terrain/class/
region probes, 102 prop/class probes and a fractional camp-boundary companion: exactly 403 ordinary cases. The source
input is checked unchanged after validation. All T1–T11 strings (including T11 before T6) and accepted empty outputs are
compared exactly. Corpus fields are typed with unknown-field rejection; fixed case/source/rule inventories reject
incomplete or changed corpora. Thirty-nine transitive source files carry SHA-256 provenance.

Nine additional `numericProbes` preserve original coordinate binary64 bits and actual T9 error strings. The gate calls
`crate::mapgen::map_hash::number_string`, the shared exact ECMAScript formatter. Tests decode all nine coordinate pairs
from their bits, construct a map containing each prop, compare the complete ordered source error messages and verify
the original coordinate bits remain unchanged. These cover exponent/subnormal/signed-zero/Infinity/NaN diagnostics.

Canonical recapture uses Linux x64 Node 22.23.4 in Docker image
`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`, read-only `/repo`, tmpfs node_modules,
`npm ci --ignore-scripts --no-audit --no-fund`, then
`npx --yes --package node@22.23.4 node --import tsx tools/map-fixtures/terrain-gate.ts [--check]`.
`TERRAIN_GATE_OUTPUT` optionally points the initial capture at the isolated writable output directory.

The coordinator owns the parent module declaration, content visitor registration and shared formatter/dependency.
No map hashes or pins have been changed by this leaf.
