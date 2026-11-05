# Map foundation oracle (P-MAP-1 M1)

`foundations.json` is captured by `tools/map-fixtures/foundations.ts`, which imports and calls the actual legacy
`detMath.ts`, `gridTopology.ts`, `gridOps.ts`, `coliseum.ts`, `interactions.ts` and `rng.ts` implementations.
The capture was generated with **Linux x64 Node 22.23.4**; the inline tests reject different provenance.
Floating-point oracle values use binary64 hexadecimal bits, preserving negative zero and exact operation order.
The tool's `--check` mode compares the entire capture byte for byte.

Coverage includes all 256 SIMPLE entries and 3x3 ring patterns; 32 reproducible random small grids;
empty, duplicate, dominated, invalid, negatively valued and signed-i32-boundary seeds; optional scopes; 5/7 distances from every tile;
5/7/11 fields and descent paths from every tile plus out-of-grid starts; all ordered tile-centre segment pairs
including two outside points, under sight and movement masks; 1,088 trigonometry/wrap samples and 138 rounding
samples; every cell of every fixed-layout layer, all eight pillar variants, ordered gates/lanes/inner spawns and
painted/ring indices; fixed-map connectivity including blocked seeds and append-only walling logs.

This is a foundation fixture, not a generated-map or full P-MAP-1 certification claim. M0 rich map export/load,
zones, styles, the full attempt pipeline, independent certifier and 200 seed pin parity remain future work.
No map pins were changed. No dependencies or workspace members were added.
