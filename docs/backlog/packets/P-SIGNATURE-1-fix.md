# P-SIGNATURE-1-fix: landmark defects (graveyard walls, church doors, the certifier check) and the missing records

- **Serves:** owner beta-follow-up decisions 5 and 6 (MIGRATION, 2026-11-10); reviewer-opus notes on P-SIGNATURE-1
  (2026-11-11, LAND WITH NOTES: three REAL)
- **Implementer tier:** implementer-sonnet (one crate, `rh-server`; map authoring behind `--signature-landmarks`)
- **Reviewer:** reviewer-opus (map authoring feeding every pooled match)
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (no legacy counterpart; DEVIATIONS row drafted here) · D2 n/a · no sim, wire or content-hash change

## 1. ID and outcome
Three defects in `crates/rh-server/src/signature.rs`, all behind the off-by-default flag. (1) The graveyard's
headstones are placed close enough to form two solid walls, and the church's door tiles are not checked to be walkable
and reachable, so a church can be sealed or its yard impassable. (2) A landmark is kept "if the strict certifier finds
no new failure", which compares failure counts: on a base map that already has a failure, a landmark that fixes one and
adds another passes. (3) The landmarks are an intentional difference from legacy with no `DEVIATIONS.md` row and no
ADR (the plan names ADR 0028). When this lands headstones keep walkable gaps, every church door is open floor joined to
the map's walkable area, a landmark is attempted only on a base map with zero certifier failures and kept only when
the result also has zero, and the row and the ADR exist as drafts for the owner.

## 2. Dependencies
none (P-SIGNATURE-1 is merged)

## 3. Relevant legacy paths
- none (new terrain; `crates/rh-sim/src/mapgen/` and its certifier are the reference and are not edited)

## 4. New paths
- `docs/adr/0028-signature-landmarks.md` (status Proposed)

## 5. Exclusive write scope
- `crates/rh-server/src/signature.rs`, `crates/rh-server/src/signature/tests.rs`
- `docs/adr/0028-signature-landmarks.md`, the ADR index line in `docs/adr/README.md`
- `docs/DEVIATIONS.md`: proposed in the hand-off only (coordinator adds the row, owner signs)

## 6. Contracts and references
- `docs/backlog/packets/P-SIGNATURE-1.md`; plan section D of the beta follow-up (MIGRATION checkpoint, decision 4).
- The certifier (`rh_sim::mapgen::certify`) is the judge; this packet changes how its verdict is used, not the certifier.

## 7. Behaviour to preserve
- Without `--signature-landmarks` nothing changes (pool maps byte-identical to before).
- Landmarks that pass today on a clean base map still place (rates on seeds 1-8 may only fall where a defect is fixed;
  report the new rates).

## 8. Acceptance checks
- Oracle: on seeds 1-8, in every placed graveyard no two headstones are orthogonally adjacent and every yard floor
  tile is reachable from the church door without crossing a headstone.
- Oracle: every placed church has at least one door tile that is walkable and connected to the map's main walkable
  region (flood fill from a spawn).
- Oracle: with a base map made to carry one certifier failure, no landmark is attempted and the map is returned
  unchanged; a kept landmark's map certifies with zero failures.
- ADR 0028 states what the landmarks are, that they are real terrain, the flag, and the placement rates.
- `scripts/gate.sh --oracle packet/P-SIGNATURE-1-fix` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-SIGNATURE-1-fix`

## 9. Validation commands
- `cargo test -p rh-server signature`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet. Geometry on a tile grid with a certifier as judge.

## 11. Known traps
- Bringing the landmarks up to the owner's wording (2-3 lava streams ending in pools, the cave at the back with the
  elite camp, the bog tree near the outer edge, marsh rings) is `P-SIGNATURE-2`, not this packet.
- Seeds where the base map has a certifier failure will now place nothing: say how many of seeds 1-8 that is.

## Notes from previous attempts
