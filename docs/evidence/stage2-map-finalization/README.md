# Map finalization evidence

This checkpoint integrates pure record finalization, exact legacy map identity and the generator-owned terrain gate.
See [ADR 0016](../../adr/0016-map-finalization.md). Full generation, independent certification and pins remain open.

## Source and independent checks

- Records: nine genuine post-gate cases and two labelled synthetic cases cover all thirteen feature kinds and all
  thirty-five feature drafts. Four repository tests compare full outputs, bitwise numeric values and in-place territory.
  Independent review adds eight genuine and two synthetic cases, eight meaningful mutations and malformed-input
  atomicity checks. A null/null deletion of four genuine cases originally passed; exact nine-case admission now rejects it.
- Map identity: eight genuine maps, 122,370 distinct binary64 Number patterns (including 100,000 raw fuzz words),
  949 admitted radius maps, 275 UTF-16 probes, 2,048 byte steps and 107 field/list changes. Nine repository tests enforce
  complete numeric input inventories, not only counts. Independent review adds 194,634 distinct Number patterns,
  eight maps (seven new inputs), 961 unique admitted radius maps, 106 field changes and eight semantic mutants. The
  original repeated-radius-zero attack and replacement of maximum finite input now fail.
- Terrain: 403 ordinary cases, including eight actual maps/exports, and nine exact bit-decoded numeric diagnostic
  probes. Eight repository tests preserve all eleven rules and ordered strings. Independent review adds 427 ordinary
  cases (37 accepted, 390 refused), seven numeric probes, seven semantic faults, four schema/inventory attacks and one
  unhashed-leaf control. Equivalent mask mutations are excluded from the kill count.

Every producer oracle was captured and reproduced byte for byte using Linux x64 Node22.23.4, image
`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`, read-only source and dedicated outputs.
Records retain 75 source hashes; hash and terrain retain 39 transitive source hashes each. Taps require complete original
output/hash equality. No production TypeScript was edited. The three `--check` commands are included in Rust CI.

Independent review records are saved alongside this file. Their original scratch-only/pending-parent language describes
the reviewed leaf boundary; coordinator integration is recorded in MIGRATION and the integrated result artifact.
Records tests subsequently gained cross-leaf assertions: all nine genuine outputs reproduce their captured source hash,
pass actual terrain validation and pass `rh-map/2` structural admission. No production leaf change was needed.
The terrain README explicitly documents the narrower bounded metadata domain. Content tests pass 127 field/order/length/
Option-presence mutations. The exact formatter is shared by hash and terrain diagnostics.

## Reproduction

```sh
cargo test -p rh-sim --lib mapgen::records --locked
cargo test -p rh-sim --lib mapgen::terrain_gate --locked
cargo test -p rh-sim --lib mapgen::map_hash --locked
cargo test -p rh-sim --test content --test map_finalization_content --locked
node --import tsx tools/map-fixtures/records.ts --check
node --import tsx tools/map-fixtures/terrain-gate.ts --check
node --import tsx tools/map-fixtures/map-hash.ts --check
```

Source commands require the canonical runtime above. Full native verification and exact content identity are recorded
in MIGRATION. No protocol, Unity, hosting, persistence-adapter, cloud or DNS change is part of this checkpoint. Claude
and Kimi ownership reservations remain active. Dependency archive/license verification is in the hash review record;
project MSRV execution remains unmeasured locally. No finished-game or performance claim follows from these checks.
