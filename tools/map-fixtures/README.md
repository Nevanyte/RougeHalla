# Legacy map foundation capture

Run the real legacy foundation functions using pinned **Linux x64 Node 22.23.4**:

```
npm ci --ignore-scripts
node --import tsx tools/map-fixtures/foundations.ts
node --import tsx tools/map-fixtures/foundations.ts --check
```

The first command after installation writes only `crates/rh-sim/src/mapgen/fixtures/foundations.json`.
`--check` is read-only and fails on any byte difference, including runtime provenance.
Use `npx --yes --package node@22.23.4 node` in place of `node` when the container's installed Node differs.
This capture never invokes pin generation or changes `packages/`.

Rust verification after the module is exported: `cargo test -p rh-sim mapgen::tests`.
The module takes ordinary grid slices and injected seeds/seed values; core execution performs no I/O,
clock reads or entropy acquisition. `fixed_layout()` returns fresh owned buffers, avoiding shared mutable cache state.

Fixed geometry is declared once in `coliseum::DEFAULT_DEFINITION`. `fixed_layout_from(&definition)`
reads this definition; `visit_content(&definition, word_callback)` yields its 89 numeric words without
building a map. Dimensions, world scale and inner spawn count use the existing scalar content registry.
Tests mutate every scalar field, orbit turn count and pillar coordinate and require different content
words; representative geometry and pillar mutations must also change generated layout cells/spawns.

`full-map.ts` captures the separate M0 `rh-map/2` DTO fixtures for seeds 1 and 2 using the actual certified generator
with `decor:false`, and compares it against direct generation of the accepted attempt. The capture includes all
GameMap fields. `--check` verifies all four JSON files under `crates/rh-sim/src/mapdata/fixtures/` byte for byte.
Its oracle records direct legacy bush/region queries; hashes are captured metadata, not Rust-computed identities.
