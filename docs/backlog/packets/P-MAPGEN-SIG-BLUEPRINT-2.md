# P-MAPGEN-SIG-BLUEPRINT-2: the table drives the landmark rules; the rule-drawn landmarks go; the entrance is row-major; the tests pin each landmark once

- **Serves:** the architecture review of 2026-11-13 (`docs/coordination/LANDMARK_ARCHITECTURE_REVIEW_2026-11-13.md`),
  finding 2 (rest), finding 5, finding 6's terrain codes. Part 2 of 2 (the plan's parts 2 and 3, merged: decided by the
  lane's session 2026-11-14). Brief only: its oracle is written when Part 1 has landed.
- **Implementer tier:** implementer-opus · **Reviewer:** reviewer-opus
- **Integration base:** the integration branch with P-MAPGEN-SIG-BLUEPRINT-1 merged.
- **D-rules touched:** D1: no legacy counterpart (DEV-020); option off byte-identical (G8); option on byte-identical but
  for each anchor's entrance order · D2 n/a · no sim, wire, save, state-hash or content-hash change.
- **Status:** brief (oracle author of Part 1, 2026-11-14). Nothing here was run except where it says so.

## 1. ID and outcome
- `is_signature`, `by_tile`, `aprons_apart` and the owned-cell part of `intact` are driven from `spec::specs`: each entry
  gains its member kinds and by-tile kinds; `intact` builds its allowed (tile, terrain) pairs per kind from the legend
  (for the drawing landmarks exactly today's hand-written arms, `signature/mod.rs:764-787` on Part 1's stub; the volcano
  keeps a hand list until SCALE-4). The fully general `intact` ("every cell the landmark wrote still has its tile and
  terrain") needs the written cells at the end of the attempt: the frame packet.
- Finding 6: the terrain codes (`bog`, `lava`, `ember`, `ice`) looked up by key (`terrain_gate/rules.rs:28-58`) when the
  context is built, not literals in `DEFAULT_DEFINITION`.
- The rule-drawn cave, church and tree are deleted with the `Definition` fields only they use: `trunk_d2`, `dry_d2`,
  `bog_d2`, `bog_min`, `church_side`, `border_max`, `border_gap`, `graveyards`, `grave_gap`, `door_shift`, `cave_side`,
  `mouth`, `forecourt`, `cave_ice_min` and the `Stone` type (re-check with `rg` that nothing outside `signature/` reads
  them). `apply` refuses an attempt when a zone has no reserved site.
- **The anchor's entrance is sorted row-major** (moved here from Part 1: two existing oracles digest the anchors' JSON
  with today's order, `pinned_others` in `mapgen_signature_church.rs` and `mapgen_signature_bog_tree.rs`, and this
  packet replaces both). Nothing else reads the order (Part 1's brief, section 3). Oracle: every anchor's entrance on
  the seed 1-32 option-on maps is row-major without repeats; measured on Part 1's stub, 67 of the 96 non-empty entrances
  are not, so the test bites. `tests/support/signature_pins.rs` already digests sorted entrances: no re-pin.
- Tests (finding 5): `mapgen_signature_fire.rs:727-799` (note 1, the tree keeps out of marked aprons) and
  `mapgen_signature_fire_bands.rs:442-492` (streams two tiles wide) move onto `begin_attempt_signature(.., true)`;
  `pinned_others` and `others_digest` in `mapgen_signature_scale.rs`, `_church.rs`, `_bog_tree.rs` are replaced by one
  property: each landmark placed alone equals the same landmark placed with all the others (the stub adds
  `SignatureContext::apply_only(frame, stage, zone)`); the eight-seed option-off pin table, copied in seven test files,
  moves into `tests/support/signature_pins.rs` beside Part 1's pins, pulled in with `#[path]`.
- Comment-only, if the coordinator agrees to the two shared files: `crates/rh-sim/src/mapdata/model.rs:256` (the
  entrance is not only "on the footprint's edge facing `front`": the tree's are on three edges, the church's is the main
  gate; and the footprint line above it, "bounding rectangle of the landmark feature's owned tiles", is not the church's)
  and `crates/rh-sim/src/mapgen/map_hash/tests.rs:400` ("the anchors restate the signature features (kind, bbox)": the
  church's footprint is not its feature's bbox). Otherwise they go to the frame packet.

## 2. Dependencies
P-MAPGEN-SIG-BLUEPRINT-1 merged. Before the frame packet (findings 1 and 4), SCALE-4 and HOLY-1.

## 3. Relevant legacy paths
None (DEV-020). Code: `signature/mod.rs` `intact`, `aprons_apart`, `is_signature`, `by_tile`, `Definition`; `cave.rs`,
`church.rs`, `bog_tree.rs` rule-drawn paths (`cave.rs:49-87, 333-511`, `church.rs:41-239`, `bog_tree.rs:63-169` on
Part 1's stub).

## 4. New paths
None expected; `apply_only` on the stub.

## 5. Exclusive write scope
`crates/rh-sim/src/mapgen/landmarks/signature/**` (not the drawings), the test files named in section 1,
`tests/support/signature_pins.rs` (the option-off table joins it), and the two comment lines if agreed.

## 6. Contracts and references
ADR 0028 G1-G10; C-PARITY (G8); `tests/content.rs` (removing `Definition` fields changes no `NON_GAMEPLAY` row:
`DEFAULT_DEFINITION` stays one row).

## 7. Behaviour to preserve
Part 1's two guards (`mapgen_signature_blueprint.rs`, pins in `tests/support/signature_pins.rs`) stay green without a
re-pin; option-off pins; the exactly-one-of-eight-orientations oracles; certify-clean; attempt bounds; `rh-mapdress`;
`map_anchor_seeds`.

## 8. Acceptance checks
The new oracle red on its stub; full gate green; the measured line counts (a net reduction).

## 9. Validation commands
As Part 1's brief, section 9.

## 10. Risk and suggested model tier
Opus. Deleting `Definition` fields touches the reserve path's readers; `intact` from the table must accept exactly what
the hand-written arms accept (a looser `intact` discards fewer maps and moves attempts).

## 11. Known traps
- The alone-equals-together property may fail where a volcano stream crosses another zone's site (the streams leave the
  Fire site): measure and document; exclude stream tiles if needed.
- `aprons_apart` finds the Holy hall by `bbox == footprint` (`mod.rs:859-863` on Part 1's stub): leave it for HOLY-1 and
  the frame packet.
- `finish`'s Church exception stays (the frame packet removes it).
