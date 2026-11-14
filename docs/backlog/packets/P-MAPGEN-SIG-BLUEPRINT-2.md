# P-MAPGEN-SIG-BLUEPRINT-2: the table drives the landmark rules; the rule-drawn landmarks go; the entrance is row-major; the tests pin each landmark once

- **Serves:** the architecture review of 2026-11-13 (`docs/coordination/LANDMARK_ARCHITECTURE_REVIEW_2026-11-13.md`),
  finding 2 (rest), finding 5, finding 6's terrain codes. Part 2 of 2 (the plan's parts 2 and 3, merged: decided by the
  lane's session 2026-11-14).
- **Implementer tier:** implementer-opus · **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ `15c35e2f7` (Part 1 merged; `packet/P-MAPGEN-SIG-BLUEPRINT-2` was
  rebased onto it by the lane's session). Branch `agent/<model>/P-MAPGEN-SIG-BLUEPRINT-2` from
  `packet/P-MAPGEN-SIG-BLUEPRINT-2`; gate with `scripts/gate.sh --oracle packet/P-MAPGEN-SIG-BLUEPRINT-2` (no `--base`).
- **D-rules touched:** D1: no legacy counterpart (DEV-020); option off byte-identical (G8); option on byte-identical but
  for each anchor's entrance order · D2 n/a · no sim, wire, save, state-hash or content-hash change.
- **Status:** oracle committed (oracle author, 2026-11-14) on `packet/P-MAPGEN-SIG-BLUEPRINT-2`: one `stub:` commit, then
  `oracle:` commits (the new test file, the test hygiene, this brief). Ready for the implementer.

## 1. ID and outcome
Line numbers are on the stub commit of this packet (Part 1's tree plus the stub).
- **The table drives membership.** `spec::Spec` has two new fields, `members` and `by_tile` (`spec.rs`, empty on the
  stub). Fill them: Fire `{Volcano, LavaStream, LavaPool}` / by-tile `{LavaStream, LavaPool}`; Sentenced
  `{Church, Graveyard}`; Plague `{BogTree}`; Frost `{Cave}`; by-tile empty except Fire. Then `is_signature`
  (`signature/mod.rs:950`), `by_tile` (`:964`), `aprons_apart`'s landmark map (`:902-947`, the per-kind match at
  `:917-924`) and the owned-cell part of `intact` (`:805-837`) read the table, not hand-written kind lists. For the
  drawing landmarks `intact`'s allowed (tile, terrain) pairs per kind come from the legend's `Write`s (exactly today's
  arms: BogTree wall/0 or floor/bog; Church wall; Graveyard wall/0 or LOW/fence; Cave wall/0 or floor/ice); the
  volcano keeps a hand list (Volcano wall/0 or LOW/lava; streams and pools LOW/lava or floor/ember) until SCALE-4. The
  Holy hall stays as it is (`aprons_apart` finds it by `bbox == footprint`, `:911`: HOLY-1 and the frame packet).
  `intact` must accept exactly what the arms accept (a looser one discards fewer maps and moves attempts).
- **Finding 6, terrain codes.** `SignatureContext::terrain_codes()` (stub at `:425`, returns the `Definition` literals)
  and `TerrainCodes` (`:356`) exist. Make the context look the codes up by key (`"bog"`, `"lava"`, `"ember"`, `"ice"`)
  in `terrain_gate::DEFAULT_DEFINITION.kinds` when it is built, and use them wherever the context writes or checks
  those terrains (`intact`, the table's legends via `specs`, `volcano.rs`, `cave::lake_at_mouth`). **Constraint:** the
  `Definition` fields `bog`, `lava`, `ember`, `ice` stay: oracle files read them (`mapgen_signature_scale.rs`,
  `_bog_tree.rs`, `_reserve.rs`, `_blueprint.rs`, `mapgen_land_plague.rs`) and so do `pipeline/plague_pools.rs:63`
  and its tests. Acceptable shapes: keep the fields as documented mirrors and resolve the context's codes from the
  catalog (asserting at build time, debug, that they agree), or set the `DEFAULT_DEFINITION` fields from a `const fn`
  lookup by key. Either way no value changes.
- **The rule-drawn cave, church and tree are deleted**: `cave.rs:49-83` (`place`) and `:164-348` (`side` and the rest
  of the rule-drawn path), `church.rs:34-232` (`Rect`, `place`), `bog_tree.rs` whole (24-120) bar anything the stamp
  still needs; with the `Definition` fields only they read: `trunk_d2`, `dry_d2`, `bog_d2`, `bog_min`,
  `church_side`, `border_max`, `border_gap`, `graveyards`, `grave_gap`, `door_shift`, `cave_side`, `mouth`,
  `forecourt`, `cave_ice_min`, and the `Stone` type (`:147`). Checked with grep on this stub: nothing outside
  `signature/` reads them. **Keep** `outer_slack` (read by `reserve`), `doorway` (read by `stamp`),
  `church::smallest_piece` (read by `stamp`; it may move), `cave::lake_at_mouth` and its unit tests. `apply`
  (`:607-693`) then refuses the attempt (`Ok(None)`) when a reserving zone has no reserved site, instead of the
  `_ => match zone` fallback (`:673-678`). The volcano with a reserved site keeps `volcano::place` (SCALE-4).
- **`SignatureContext::apply_only(frame, stage, zone)`** (stub at `:699`, refuses): place only `zone`'s landmark,
  exactly as `apply` places it (same site, stream continuation, draws, legality, writes to the stage's layers and
  masks), returning a `Placed` with that zone's anchor, the step's terrain layer and (for a drawing) its `Landed`. A
  shared per-zone helper used by both `apply` and `apply_only` is the obvious shape.
- **The anchor's entrance is sorted row-major** (by y, then x), no repeats, in `stamp` after landing (`:1044-1048`
  today, grid order). Do **not** sort inside `Blueprint::entrance` (its grid order is pinned by
  `mapgen_signature_blueprint.rs` `the_marks_and_the_entrances_are_found`), and keep the graveyard's
  `FeatureAnchor::EntranceMiddle` point unchanged (it is index `len / 2` of the grid-order entrance; the church's main
  gate is 5 tiles, so the sorted middle is the same tile, but take it from the grid order or prove it). Readers of the
  order: none that depend on it (`style_rime` seeds a multi-source BFS from the mouth and sorts its candidates with a
  total order; `cave::lake_at_mouth` is a BFS; the coordinator confirmed no client reader). Option-on maps change only
  in that order: Part 1's two digest guards already sort entrances, so no re-pin.
- **Comment-only, outside `signature/` (approved by the coordinator 2026-11-14):**
  - `crates/rh-sim/src/mapdata/model.rs:255-262` (`ZoneAnchor`): `centre`: for a landmark pinned on a camp (the
    church, the cave) it is the camp tile the drawing's `E` lands on, NOT the middle of the footprint (the footprint is
    the whole yard or cave box; the coordinator's Web round measured the church's footprint middle at about x 944 px
    against `centre.x` 720 px); for a landmark centred in its site (the bog tree, the volcano) it is the site's centre
    tile; the Holy hall's is its feature's anchor point. `footprint` is not always "the bounding rectangle of the
    landmark feature's owned tiles" (the church's is the drawing's box, graveyard and churchyard included). `entrance`
    is not only "on the footprint's edge facing `front`" (the tree's causeways are on three edges, the church's is the
    main gate), and it is row-major.
  - `crates/rh-sim/src/mapgen/map_hash/tests.rs:400`: "the anchors restate the signature features (kind, bbox)" is not
    true of the church (its footprint is not its feature's bbox); say what is true (anchors are derived from the
    generator's placement and are not in the map hash).
  - The stale doc comments on `Definition::cave_grid`, `bog_grid`, `church_grid` (`signature/mod.rs:126-143`), which
    still name the deleted `cave::Blueprint`, `bog_tree::Drawing`, `church::Blueprint`: the drawing is parsed once per
    context by `blueprint::Blueprint::parse` with the table's legend (`spec::specs`).

## 2. Dependencies
P-MAPGEN-SIG-BLUEPRINT-1 (stacked on it; see the integration base). Before the frame packet (findings 1 and 4),
SCALE-4 and HOLY-1.

## 3. Relevant legacy paths
None (DEV-020). Code: `signature/mod.rs` `apply`, `intact`, `aprons_apart`, `is_signature`, `by_tile`, `Definition`,
`stamp`; `spec.rs`; `cave.rs`, `church.rs`, `bog_tree.rs` rule-drawn paths (line numbers in section 1).

## 4. New paths
None. `apply_only`, `terrain_codes`, `TerrainCodes`, `Spec::members`, `Spec::by_tile` exist on the stub.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/**` except the drawings (`*.txt`).
- Comment lines only: `crates/rh-sim/src/mapdata/model.rs` (the `ZoneAnchor` doc comments, `:250-262`) and
  `crates/rh-sim/src/mapgen/map_hash/tests.rs` (the comment at `:400`).
- Nothing else. Every test file is an oracle file (below); the hygiene they needed is done.

## 6. Contracts and references
ADR 0028 G1-G10; C-PARITY (G8); `tests/content.rs` (removing `Definition` fields changes no `NON_GAMEPLAY` row:
`DEFAULT_DEFINITION` stays one row; adding no `pub const`).

## 7. Behaviour to preserve
Part 1's two guards (`mapgen_signature_blueprint.rs` `option_on_maps_are_unchanged`, `the_landmarks_phase_is_unchanged`,
pins in `tests/support/signature_pins.rs`) stay green without a re-pin; option-off pins; the
exactly-one-of-eight-orientations oracles; certify-clean; attempt bounds; `rh-mapdress`; `map_anchor_seeds`. No RNG
draw added, removed or reordered.

## 8. Acceptance checks
`crates/rh-sim/tests/mapgen_signature_table.rs` green (four tests red on the stub, below); full gate green; the
measured line counts (a net reduction).

### The oracle and what the stub shows (measured 2026-11-14, macOS arm64, debug)
`mapgen_signature_table.rs` on the stub: 1 passed, 4 failed, each on an assertion:
- `the_table_names_each_landmarks_member_and_by_tile_kinds`: "Fire: member kinds {}, want {LavaPool, LavaStream,
  Volcano}" and the like for every entry (the stub's lists are empty).
- `every_anchors_entrance_is_row_major`: "67 of 96 non-empty entrances are not strictly row-major" (the brief's
  earlier count, re-measured).
- `each_landmark_placed_alone_equals_it_placed_with_the_others`: "120 failures" (30 accepted phases x 4 zones,
  `apply_only` refuses). Stream or pool tiles inside another zone's reserved site on those 30 phases: **0**, so the
  volcano is compared whole.
- `without_a_reserved_site_the_attempt_is_refused`: "seeds [1, 2, 3, 4, 5, 6, 7]: landmarks placed without a reserved
  site".
- Green guards: `guard_the_terrain_codes_are_the_catalogs`; and three added by the lane's session from the two
  reviews of Part 1: `guard_every_shipped_drawing_is_the_approved_file` (the cave had no byte-equality check against
  `docs/landmarks/blueprints/`), `guard_every_writing_glyph_is_owned_by_a_feature_of_its_entry` (the stamp refuses,
  quietly in a release build, on a written tile no feature of the entry owns),
  `guard_a_front_run_row_is_open_tiles_and_one_closing_glyph` (the table's gate rule counts only tiles that write
  nothing; the old church reader counted every tile that was not `+`).

Scratch prototype (reverted, not committed): `apply_only` as `apply`'s loop filtered to one zone, plus `apply`
refusing a zone without a reserved site. Then `each_landmark_placed_alone_…` and `without_a_reserved_site_…` pass;
and on the unmodified test files the only other targets that went red (`--lib` and every `mapgen_*` test) were
`mapgen_signature_fire.rs` `note1_the_bog_tree_site_keeps_out_of_marked_aprons` and `mapgen_signature_fire_bands.rs`
`streams_are_two_tiles_wide_at_the_landmarks_phase`, the two this packet moved onto the reserving prefix.

## 9. Validation commands
`cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_table`; then
`cargo test -p rh-sim --features trusted-status-probes --no-fail-fast`, `cargo test -p rh-mapdress`,
`cargo test -p rh-server --test map_anchor_seeds --test map_anchors`; `scripts/gate.sh --quick`; finish with
`scripts/gate.sh --oracle packet/P-MAPGEN-SIG-BLUEPRINT-2`.

## 10. Risk and suggested model tier
Opus. Deleting `Definition` fields touches the reserve path's readers; `intact` from the table must accept exactly what
the hand-written arms accept.

## 11. Known traps
- `aprons_apart` finds the Holy hall by `bbox == footprint`: leave it for HOLY-1 and the frame packet.
- `finish`'s Church exception (`:762-797`) stays (the frame packet removes it).
- `apply_only` must not share mutable state with an earlier zone: the property compares it with `apply` on a fresh
  stage of the same attempt.
- The volcano's streams leave its site but stay in the Fire zone; every reserved site lies wholly in its own zone, so
  no stream crosses another site (measured: section 8).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_table.rs` (new).
- `crates/rh-sim/tests/support/signature_pins.rs` (the option-off table joined Part 1's pins).
- `crates/rh-sim/tests/mapgen_signature_blueprint.rs` (the entrance compared as a set in
  `placed_landed_rederives_every_written_cell`).
- `crates/rh-sim/tests/mapgen_signature_scale.rs`, `_church.rs`, `_bog_tree.rs` (`pinned_others`, `others_digest` and
  their guard removed; option-off table from the support file).
- `crates/rh-sim/tests/mapgen_signature_fire.rs` (`note1_…` on the reserving prefix), `_fire_bands.rs`
  (`streams_are_two_tiles_wide_at_the_landmarks_phase` on the reserving prefix), `_frost.rs`, `_frost_lake.rs`,
  `_reserve.rs` (option-off table from the support file).
- Every other existing test file, unchanged.
