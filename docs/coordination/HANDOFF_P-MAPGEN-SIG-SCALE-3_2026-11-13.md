# Hand-off: P-MAPGEN-SIG-SCALE-3 (2026-11-13, implementer-opus)

```
PACKET:          P-MAPGEN-SIG-SCALE-3 — serves owner direction 2026-11-12 late (landmarks "a lot larger") and owner decision 2026-11-13 (ADR 0028 G9; LAND_GENERATION_REQUIREMENTS L1, L3; blueprints approved)
BRANCH:          agent/opus/P-MAPGEN-SIG-SCALE-3 @ 9fc7b7cf7 (gated head; this hand-off is the one commit after it)
GATE:            PASS (full, `scripts/gate.sh --oracle packet/P-MAPGEN-SIG-SCALE-3`, attempt 1/2) [skipped: Postgres suites, no DATABASE_URL]; GarbageTests flake did not occur
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/bog_tree.rs, crates/rh-sim/src/mapgen/landmarks/signature/mod.rs (bog_grid value and doc, the `bog` context field, the Plague call), docs/adr/0028-signature-landmarks.md (G9, decisions 4 and 7, Measurements), crates/rh-mapdress/tests/anchor.rs and crates/rh-mapdress/tests/marsh.rs (re-pin commit, constants only: NO_ANCHOR_GOLDEN, SIG_GOLDEN; OFF_GOLDEN unchanged), this file
D-RULES:         D1: option off byte- and draw-identical (no site, so the rule-drawn path on a fresh stream, unchanged; `option_off_is_todays_generator` and the other g8/option_off guards green); no legacy counterpart (DEV-020). D2 n/a. No sim tick, wire, content-hash or state-hash change.
DEVIATIONS:      none (DEV-020 covers signature landmarks)
SHARED RECORDS:  proposed edits: docs/MIGRATION.md checkpoint: P-MAPGEN-SIG-SCALE-3 gate result and cost (46 / 2 on seeds 1-32, 109 / 6 on 1-64); docs/backlog/packets/P-MAPGEN-SIG-SCALE-3.md status line (oracle file, not edited here)
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: seeds beyond 64; that the mirror is a fair coin; time per map; what P-LAND-PLAGUE-1 (free bog pools) does with the 29 x 29 tree after its rebase; the cause of the three new SpawnRatio refusals (seeds 1-64; every later step sees a different map), not traced; the split of the 26 SignatureDiscarded refusals by end-of-attempt check.
RISKS:           none known; every option-on map moves (expected: rh-mapdress SIG_GOLDEN and NO_ANCHOR_GOLDEN re-pinned, the four non-Plague zones' dressing digests move because the maps move).
```

## What was built
- `bog_tree::Drawing`: a small reader for `Definition::bog_grid` (square, odd side, the five characters `T r % : .`, a
  trunk tile at the centre), parsed once per context into `SignatureContext::bog`; `Drawing::land` places grid tiles
  with the cave's orientation rule (unmirrored +gx to (u.y, -u.x), mirrored to the opposite), centred on the drawing's
  centre tile.
- `bog_tree::place(site, rng, centre)`: with a reserved site the caller passes the site's centre tile
  `(rect.x + rect.w / 2, rect.y + rect.h / 2)` and `blueprint` places the drawing: one mirror draw (`pick(rng, 2)`) on
  the Plague stream first, the front `axis(front(centre))`; walls and marsh must be `Site::wall && Site::ground`, dry
  and causeway tiles `Site::floor`; `smallest_piece(walls) >= R.piece_min` and the zone's floor unsplit; else `None`
  (`Refusal::Signature`). Cells: walls (wall, terrain 0) and marsh (floor, `bog`), sorted by index; anchor centre the
  centre tile, footprint the box, entrance the `:` tiles on the box's edge in grid order (six). Without a reservation
  the rule-drawn tree is unchanged.
- Shared with `cave.rs`: `axis`, `front`, `pick`, `at`, `Site`, `church::smallest_piece`. Not shared: the parser and
  `land` (cave's `Blueprint` is private to `cave.rs`, accepts only `#R=.ED` with one `E` and a `D` mouth, and
  `cave.rs` is outside this packet's write scope). A follow-up could move one generic grid reader and `land` into
  `signature/mod.rs` for both.

## Results
- `mapgen_signature_bog_tree`: all ten tests green (the four red ones and the six guards); `report_seeds_1_to_64` in
  `target/scale3_report.txt`.
- Green: every other `mapgen_signature_*` target (aprons 2, core 8, fire 11, fire_bands 5, frost 7, frost_lake 5,
  reserve 11, scale 11), `mapgen_land_sentenced` 10, `mapgen_land_decor_attempts` 1, `mapgen_style_refusal` 5,
  `content` 21, the lib's `mapgen::` tests 203 (`style_warren` and the new
  `the_default_drawing_parses_and_malformed_grids_do_not` included), `rh-server` `map_anchor_seeds` 1 and
  `map_anchors` 5, `rh-mapdress` (after the re-pin).
- Cost (option on, debug test build): attempts 46 on seeds 1-32 (bound 59; 59 before), worst index 2 (seed 12; bound
  4); 109 on seeds 1-64 (132 before), worst index 6 (seeds 46 and 52). Refusals on seeds 1-64: `Prefix` 10,
  `Repair(RadiusPost)` 6, `SignatureDiscarded` 26, `SpawnRatio` 3, `Signature` 0. Box offset (3, 3) on 64 of 64.
  Identical to the oracle author's prototype.
- Goldens re-pinned (re-pin commit): `NO_ANCHOR_GOLDEN` was a7de68571baf273d, b7f2f1508b3f4423, b2346e23a544f81e,
  18b25ec38b7bec60; now 0796bc2a20f74619, 5d1c4f2db7e9cc30, fac86967db0a4749, b58ed01bc8199d17. `SIG_GOLDEN`
  (seed by row; Fire, Sentenced, Frost, Holy) was d83bd60ded0cd253 2038e2690969ddeb 4312ee907e8e90b3 d97b0bdbe438abaf /
  c675ffd19134a3cf 2bc7b470302305e5 0a19fc6e97a7f445 bbd9b104fa5c0a00 / b970cf244123d11f b3a2a9a94e8aa1a5
  efb85c02a86b58cc 0af294ed480f4eb2 / bc27ab7607f40cd7 92cb1adb6f7cbd33 e6b0b093cdbb78a0 2605e9824db87c20; now
  40fe7f46d14ae639 06836f1b33ea09a4 d1e43fa54369b2fa ca2c469dac4c833f / 4be4022169892c2a 0984dd44d9da2686
  57904a658131762f 8efc14bcb4e2c163 / 0d25c89570865eeb bdec3327d5362a1d 83bbc9a78e4337b4 8ab128b83b58c4ae /
  3a9ecf02aac579f7 dda4654465a22303 58834e22fcc87815 16f5d83bd7ea0a2b. `OFF_GOLDEN` (both files) unchanged. No other
  `rh-mapdress` test moved.

## Brief notes
- The brief's write scope says `crates/rh-mapdress/**` is the coordinator's at merge; the coordinator's dispatch asked
  this branch to re-pin it in a last separate code commit, which it does (constants only, values read from a
  temporary print that was reverted before the commit).
- Otherwise the brief matched the code: the prototype's numbers reproduce exactly, and no other test moved.

## git diff --stat packet/P-MAPGEN-SIG-SCALE-3 (at 9fc7b7cf7, before this file)

```
 crates/rh-mapdress/tests/anchor.rs                 |   8 +-
 crates/rh-mapdress/tests/marsh.rs                  |  32 ++--
 .../src/mapgen/landmarks/signature/bog_tree.rs     | 177 ++++++++++++++++++++-
 .../rh-sim/src/mapgen/landmarks/signature/mod.rs   |  19 ++-
 docs/adr/0028-signature-landmarks.md               |  42 +++--
 5 files changed, 239 insertions(+), 39 deletions(-)
```

## Review and fix (land-generation session, 2026-11-13)

**reviewer-opus on `d873f4d0f`: LAND WITH NOTES**, nothing blocking and nothing REAL; two MINOR documentation notes.
- Note 1 (ADR 0028 decision 4 omitted the legacy landmark protection from the refusal list): applied in `7baeb8a17` on
  `agent/fable/P-MAPGEN-SIG-SCALE-3-fix`, stacked on this branch, documentation only. **Merge the fix branch.**
- Note 2 is the coordinator's file: `crates/rh-protocol/src/map.rs:118`, the `MAX_ANCHOR_ENTRANCE` comment says
  "today 3 ... the church's main gate is 5"; the tree now sends 6 (the cap of 16 and the C# mirror are unchanged; a
  comment only, no protocol change). Proposed, not edited here.

What the review established (by reading unless marked): option off cannot move (the drawing is parsed once and
nothing is drawn or written); the tree's one draw is on its own zone's copy of its stream and cannot reach the other
landmarks; the writer matches the legend, refuses before writing anything, and the anchor is as agreed in every
orientation; `Drawing::land` behaves exactly like `cave::Blueprint::land`; no downstream reader assumes the small
tree; the three amended tests drop only what the drawing breaks. Run by the reviewer: `mapgen_signature_bog_tree`
10 of 10, the lib's `mapgen::landmarks` tests 45 of 45, `bog.txt` byte-equal to the docs copy.

Two things for other lanes, from the review:
- `rh-mapdress`'s `plague-marsh-*` decoration rings now also form round the tree's own marsh (cosmetic; already true
  of the old tree's bog bands). Worth telling the Unity art lane.
- Recommended, not part of this packet: after P-MAPGEN-SIG-SCALE-2 lands and before SCALE-4 and HOLY-1, one refactor
  packet that moves a shared grid reader and `land` into `signature/mod.rs` for the cave, the tree and the church.

Not checked by the review: the cause of the three new `SpawnRatio` refusals; seeds beyond 32 (the implementer's
report covers 1-64); whether later non-styler steps can put something on the tree's unwritten dry tiles.
