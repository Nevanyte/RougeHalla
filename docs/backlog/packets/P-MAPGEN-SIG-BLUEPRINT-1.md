# P-MAPGEN-SIG-BLUEPRINT-1: one blueprint type, one per-landmark table, one generic stamp (the cave, the church and the bog tree), no map changed

- **Serves:** the land-generation lane's architecture review of 2026-11-13
  (`docs/coordination/LANDMARK_ARCHITECTURE_REVIEW_2026-11-13.md`, finding 2 and the test half of finding 5), asked by
  the owner ("make sure the architecture is well set up"); the review's order (A) before the volcano (P-MAPGEN-SIG-SCALE-4)
  and the hall (P-MAPGEN-SIG-HOLY-1). Owner decisions 2026-11-13 (the five blueprints, ADR 0028 G9). Part 1 of 2; Part 2
  is `P-MAPGEN-SIG-BLUEPRINT-2.md`. The next packet after both is findings 1 and 4 (a `LandmarkFrame` handed to the
  stylers; end-of-attempt guarantees as a registered list): `Placed.landed` in this packet is its landing place.
- **Implementer tier:** implementer-opus (rh-sim mapgen, the Landmarks phase: draw order and every option-on map are
  behaviour)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ `42ce9a72f` plus the church (P-MAPGEN-SIG-SCALE-2 and its fix, reviewed
  and merged on the coordinator's staging branch; this branch is rebased when they reach origin). Oracle written on
  `packet/P-MAPGEN-SIG-BLUEPRINT-1` from `81e688cdc`. Run the gate with `--base agent/fable/P-MAPGEN-SIG-SCALE-2-fix`
  until the rebase, so the church's files stay out of this packet's oracle set.
- **D-rules touched:** D1: no legacy counterpart (DEV-020); option off and option on byte- and draw-identical (G8), the
  anchors' entrance order included · D2 n/a · no sim tick, wire, save, state-hash or content-hash change
- **Status:** oracle written (2026-11-14, oracle-author, Opus). Plan by the first oracle author (2026-11-14, nothing run);
  every coordinate and the digest-neutrality of the design verified here by a throw-away prototype (see "Verified").

## 1. ID and outcome
The three signature landmarks that are drawings today (the Frost cave, the Sentenced church with its graveyard and
churchyard, the Plague bog tree) are placed by ONE generic stamp reading ONE table, instead of three hand-written
readers and three copies of the same placement loop. Nothing a player, a styler, the server or the client sees changes:
every generated map, option on and option off, is byte-identical, anchors included. (The plan made the anchor's
`entrance` row-major here; the code says otherwise, so that moves to Part 2: see "Departures from the plan".)

What exists when this lands (`crates/rh-sim/src/mapgen/landmarks/signature/`):
- `blueprint.rs`: `Blueprint::parse(text, &Legend) -> Result<Blueprint, ParseError>` (`Empty`, `Ragged`, `Unknown`); a
  `Legend` of `Glyph`s, each saying what its character writes (`Write::Nothing`, `Wall`, `Low(terrain)`,
  `Floor(terrain)`), the feature that owns the written tile, its legality class (`Legality::Wall` = `Site::wall`,
  `WallGround` = `Site::wall && Site::ground`, `Floor` = `Site::floor`) and whether it is a named mark. Eight
  `Orientation`s (front direction times mirror) whose `turn` maps tiles AND directions with today's convention (the cave's
  `land`): grid (0, 1) goes to the front u, grid (1, 0) to r = (u.1, -u.0), negated when mirrored. Two `Placement` rules:
  `Pin(mark)` (the one tile of the mark on the site's camp tile: the cave, the church) and `Centre` (the turned box
  centred in the site's inner rect, an odd spare tile before the box: the tree today, the volcano and the hall later).
  `EntranceRule`: `Mark(ch)` (the cave's `D`), `FrontRun(mark)` (the open run of the front row through the mark's column:
  the church's main gate; the hall's nave later), `Edge(ch)` (the tree's `:` on the box edge), `None`. A `Landing`
  (orientation, origin, box) whose `tile(g)` is `origin + turn(g)`.
- `spec.rs`: `specs(&Definition) -> Vec<Spec>`, one entry per landmark in `reserved_zones` order: zone, anchor kind,
  the drawing's text (`None` for the Fire volcano until SCALE-4), legend, features in write order (kind, job, anchor
  point: the anchor's centre, or the entrance's middle tile as the graveyard's), placement, entrance rule, doorway check.
- The stamp (in `mod.rs` or `blueprint.rs`, the implementer's choice), exactly today's three `blueprint()` functions:
  1. the zone's one mirror draw, `pick(rng, 2) == 1` = mirrored, FIRST (before anything can refuse);
  2. a drawing that did not parse refuses the attempt after that draw (`Ok(None)`: `Refusal::Signature`);
  3. the front: `axis(front(t))`, `t` the pinned camp tile (`Pin`) or the site's centre tile (`Centre`;
     `(rect.x + rect.w / 2, rect.y + rect.h / 2)`, equal to the inner rect's centre tile);
  4. every grid tile passes its glyph's legality class, else refuse;
  5. if the table says `doorway`: the `Definition::doorway` tiles beyond each entrance tile along u are `Site::open`;
  6. the `Write::Wall` tiles form no 8-connected piece under `R.piece_min` (`church::smallest_piece`);
  7. the wall plus LOW tiles do not split the zone's floor (`Site::floor_pieces`);
  8. each feature's cells sorted by tile index, features written in the table's order (the church before its
     graveyard), each through `SignatureContext::write` as today;
  9. the anchor: zone, kind, centre `t`, footprint the landing's box, front `front(t)`, entrance the entrance rule's
     tiles in the drawing's grid order (`Blueprint::entrance`, row-major in the grid), landed: today's order exactly.
- `Placed.landed: Vec<Landed>` (`Landed { zone, landing, marks }`): one entry per landmark placed from a drawing, in
  placement order (Sentenced, Plague, Frost), its marks (every mark glyph of its legend, ascending by character) landed,
  row-major. Generator working state only, never exported.
- The three old readers and loops are gone: `cave::Blueprint`, `cave::grid`, `cave::land`, `cave::blueprint`,
  `church::Blueprint`, `church::blueprint`, `bog_tree::Drawing`, `bog_tree::blueprint`, and the parse unit tests that
  exercised them (see "Existing tests this packet changes"). The rule-drawn cave, church and tree (no reservation, test
  prefixes only) stay until Part 2.

## 2. Dependencies
- In the base: P-MAPGEN-SIG-RESERVE-1, -SCALE-1 (cave), -SCALE-3 (tree), -SCALE-2 and -SCALE-2-fix (church).
- Before Part 2 (`P-MAPGEN-SIG-BLUEPRINT-2`), which deletes the rule-drawn paths and drives `is_signature`, `by_tile`,
  `aprons_apart` and `intact` from this table.
- Before P-MAPGEN-SIG-SCALE-4 (volcano) and P-MAPGEN-SIG-HOLY-1 (hall): both become table entries.
- Shared-file rule: `signature/mod.rs` is touched by every landmark packet; merge one at a time.

## 3. Relevant legacy paths
None: no legacy counterpart (DEV-020). The code this packet replaces, line numbers on the stub commit:
- `signature/cave.rs:93-140` (`Blueprint`: the six-character reader, one `E`, `2 * mouth + 1` `D` in a run on the front
  row), `:144-154` (`grid`, shared with the church), `:159-170` (`land`: the transform this packet keeps exactly),
  `:179-246` (`blueprint`: mirror draw `:181`, front `:183-184`, legality `:193-197`, doorway/piece/split `:215-223`, cells
  sorted `:224`, anchor `:225-238`), `:603-626` (parse unit test).
- `signature/church.rs:245-290` (`Blueprint`: eight characters, the gate is every non-`+` tile of the front row through
  `E`'s column, `:271-282`), `:301-381` (`blueprint`: walls `#P` to `Church`, `G` wall and `+` LOW fence to `Graveyard`
  `:321-331`; `solid` (walls + LOW) for the split check, `walls` for the piece check `:344-346`; graveyard anchor point
  `to((camp.0, side - 1))` `:376`), `:383-408` (`smallest_piece`, kept), `:415-433` (parse unit test).
- `signature/bog_tree.rs:26-61` (`Drawing`: odd square, trunk at the centre; `land` with the centre (14, 14) on `t`),
  `:179-242` (`blueprint`: walls and marsh need `Site::wall && Site::ground` `:195-199`; entrance the `:` on the box edge in
  grid order `:210-212`), `:249-269` (parse unit test).
- `signature/mod.rs:579-659` (`apply`: per-zone stream, `inner`, the dispatch `:629-643` with `_ => cave::place`),
  `:660-706` (`write`, kept), `:336-353` (`Placed`, `Landed`: stub), `:386-404` (the three parsed fields in the context).
- Readers of the anchor's `entrance` (checked for order dependence): `cave::lake_at_mouth` (`cave.rs:310-315`, BFS seeds
  at distance 0: order-free), `intact`'s door check (`mod.rs:789-793`, `all`), `rh-server/src/public_ground.rs:217-220`
  (copied to the wire as is), Unity `Landmark.cs:130-134` (mean of the tiles), `LandmarkInterior.cs:73-74` (a set),
  `VolcanoLandmark.cs:333-335` (four-adjacent runs). The stylers do not read it: `style_rime::signature_anchor`
  (`style_rime/mod.rs:319-349`) and `style_gallows/lanes.rs:95` rebuild their own from the features.

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/blueprint.rs`, `spec.rs` (stub commit: types, signatures, placeholder
  bodies).
- `crates/rh-sim/tests/mapgen_signature_blueprint.rs`, `crates/rh-sim/tests/support/signature_pins.rs` (oracle commit).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/blueprint.rs`, `spec.rs`: the bodies. Private helpers and extra
  `ParseError` variants may be added; the public names and signatures the oracle uses may not change.
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs`: `apply` (route every zone with a drawing in the table and a
  reserved site through the stamp, fill `Placed.landed`), the stamp, the `SignatureContext` fields (the table and its
  parsed drawings replace `cave`, `bog`, `church`), doc comments of what changed. Not: `Definition` and its default,
  `reserve`, `inside_camp`, `relabel_sites`, `write`, `finish`, `intact`, `aprons_apart`, `is_signature`, `by_tile`,
  `band` (Part 2 and the frame packet).
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.rs`, `church.rs`, `bog_tree.rs`: delete the readers and the
  `blueprint` functions named in section 1 and their parse unit tests; adjust the `place` functions to the rule-drawn
  path only. `smallest_piece`, `lake_at_mouth` and its tests, and the rule-drawn paths stay.
- Not in scope: `volcano.rs`, the drawings (`*.txt`, docs and crate copies), `crates/rh-mapdress/**`, every other
  existing test, `mapdata/model.rs` and `map_hash/tests.rs` (the stale comments below go to Part 2).

## 6. Contracts and references
- ADR 0028 (`docs/adr/0028-signature-landmarks.md`) G1-G10 and decisions 4, 5, 11 (the blueprints, G9: one fixed drawing
  in one of eight orientations); C-PARITY (option off byte-identical, G8); AGENTS.md determinism (no hash-ordered
  collections; draw order is behaviour; the signature stream only, G6); `tests/content.rs` (no new `const`: the table is
  a function).
- The wire (`crates/rh-protocol/src/map.rs`, `MAX_ANCHOR_ENTRANCE` = 16) and `crates/rh-server/tests/map_anchor_seeds.rs`
  (seeds 1-8: centre strictly inside the footprint, entrance tiles on the map, at most 16, the served anchors equal the
  generator's) must stay green.

## 7. Behaviour to preserve
- Draws: per zone exactly today's: one mirror draw on the zone's signature stream, first; the mapping `pick(rng, 2) == 1`
  = mirrored (the cave's, the church's and the tree's today). The volcano's draws are untouched.
- Every option-on map of seeds 1-32 has today's accepted attempt, `map_hash` and JSON (`option_on_maps_are_unchanged`);
  every Landmarks phase of seeds 1-16, attempts 0-1, leaves today's anchors, tiles, terrain, owners, features,
  protection, masks and terrain layer, refusals included (`the_landmarks_phase_is_unchanged`). Pins in
  `tests/support/signature_pins.rs`, taken on the stub commit. Both digests sort each anchor's entrance first, so that
  Part 2's sort needs no re-pin; the order itself is pinned exactly by `placed_landed_rederives_every_written_cell` and
  by the existing `pinned_others` digests (`mapgen_signature_church.rs`, `mapgen_signature_bog_tree.rs`).
- Option off: untouched (the existing `option_off_is_todays_generator` guards, seeds 1-8, in seven test files).
- The anchors: the footprint is the drawing's box (today's; for the church not its feature's `bbox`), the centre the camp
  tile or site centre tile, `front(t)`, the entrance in today's order (the drawing's grid order, landed).
- The existing exactly-one-of-eight-orientations oracles (`mapgen_signature_scale.rs`, `_church.rs`, `_bog_tree.rs`) and
  the `rh-mapdress` goldens stay untouched and green: independent proofs that the stamp is today's.

## 8. Acceptance checks
- `cargo test -p rh-sim --test mapgen_signature_blueprint` green (8 tests red on the stub, 2 guards green).
- Every `mapgen_signature_*` target, `mapgen_land_sentenced`, the `rh-mapdress` tests and
  `cargo test -p rh-server --test map_anchor_seeds` green, unchanged.
- `scripts/gate.sh --quick --base agent/fable/P-MAPGEN-SIG-SCALE-2-fix --oracle packet/P-MAPGEN-SIG-BLUEPRINT-1` then the
  full gate pass.
- `git diff --stat` shows a net reduction in `cave.rs`, `church.rs`, `bog_tree.rs`.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_blueprint.rs` (new)
- `crates/rh-sim/tests/support/signature_pins.rs` (new; later landmark packets re-pin here, in one place)
- `docs/backlog/packets/P-MAPGEN-SIG-BLUEPRINT-1.md`, `docs/backlog/packets/P-MAPGEN-SIG-BLUEPRINT-2.md`
- The stub commit's files (`signature/blueprint.rs`, `spec.rs`, the `mod.rs` lines) are the implementer's.

## The oracle (`crates/rh-sim/tests/mapgen_signature_blueprint.rs`)
Red on the stub, each on an assertion:
| Test | Pins | Red on the stub |
|---|---|---|
| `every_drawing_parses_and_malformed_grids_do_not` | the five drawings (`docs/landmarks/blueprints/`) parse at 29, 29, 29, 30, 37, character for character; `""` and a legend-only text are `Empty`, a short row `Ragged { row: 1, len: 2, expected: 3 }`, an unknown character `Unknown { ch, at }` | "the cave drawing does not parse" |
| `the_marks_and_the_entrances_are_found` | cave `D` (13-15, 28), `E` (14, 7); church `D` (13-15, 16), `E` (14, 7), gate (12-16, 28); tree no mark, six edge causeways (12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28), 62 `:` tiles; volcano `O` (7, 8, 14, 15, 21, 22; row 29); hall `D` (17-19, 7), `E` (18, 15), (18, 27), nave (15-21, 36); a wall beside the gate is not gate; a fenced `E` column gives no gate | same |
| `every_orientation_lands_each_drawing_one_to_one_onto_its_box` | all five drawings, all eight orientations: one to one onto the box of the drawing's size; `turn` is the cave's convention; a grid step moves the landed tile by the turned step; `Pin` puts `E` on the camp tile | same |
| `the_volcanos_outlets_and_headings_mirror_onto_each_other` | per front: the left outlet mirrored lands on the right one unmirrored and the other way, the middle on itself, the box unchanged; heading grid (-1, 1) mirrored turns to grid (1, 1) unmirrored | same |
| `the_box_rule_matches_todays_tree_and_fills_the_volcano_and_hall_rects` | the tree centred in a 34 site's inner rect lands every tile where `bog_tree::Drawing::land` does today (two sites, eight orientations); the volcano's box is its 30 inner rect, the hall's its 37 | same |
| `a_landing_refuses_an_oversized_box_or_a_pin_that_is_not_one_tile` | the tree in 28 x 28, 30 x 28, 28 x 30 and the hall in 30 x 30: `None`; `Pin` on the hall's two `E`, on an absent mark, without a camp tile: `None`; the cave's `Pin(E)` with a camp: `Some` | same |
| `the_table_has_one_entry_per_landmark_and_its_legends_match_the_drawings` | zones Fire, Sentenced, Plague, Frost; Fire `Volcano` without a drawing; per drawing landmark: kind, the `Definition` grid, a legend whose characters are exactly the drawing's and whose glyphs are today's reading, features and their order, jobs and anchor points, placement, entrance rule, doorway | "one entry per landmark": `[]` |
| `placed_landed_rederives_every_written_cell` | seeds 1-16, attempts 0-1, every accepted Landmarks phase (30): `landed` is Sentenced, Plague, Frost; each landing is its table rule's in the zone's site under its own orientation, front `axis(anchor.front)`; anchor centre, footprint and entrance (grid order, landed: today's) from the landing; marks landed row-major, the cave's and church's `E` on the camp tile; the zone's features in table order with jobs and anchor points; every written tile's tile, terrain and owner; each feature owns nothing else | "the landed landmarks": `[]` |
Green guards (pinned on the stub): `option_on_maps_are_unchanged`, `the_landmarks_phase_is_unchanged`. Not a gate check:
`print_signature_pins` (`--ignored --nocapture`) prints the current values for a re-pin.

The legends for `volcano.txt` and `hall.txt` in the oracle are its own, to read the drawings; their real legends are
SCALE-4's and HOLY-1's.

## Verified (oracle author, 2026-11-14, macOS arm64, debug test build)
- Every coordinate above was read from the drawings and confirmed by running the oracle against a throw-away prototype
  of the stamp (about 300 lines added to the stub's files, the old readers left in place; reverted before the oracle
  commit, not on any branch): every test green, the two guards included, so the design is digest-neutral as written.
  The same prototype was run against the existing tests: see "Departures from the plan" for the one that moved.
- Row-major entrances (now Part 2's): 67 of the 96 non-empty anchor entrances over seeds 1-32 are not row-major today.
- In seeds 1-16, attempts 0-1, the signature step refuses none (seeds 2 and 11 fail their prefix on attempt 1): the
  phase digest's refusal code cannot be exercised there; the map guard covers refusals later in the attempt through
  the accepted attempt index.
- Run time: the new test binary about 30 s (seeds 1-32 option on are generated once).

## Departures from the plan (and why)
- **The entrance stays in today's order; the row-major sort moves to Part 2.** The plan called the sort "the ONE
  permitted change: nothing downstream reads its order". The generator, the server and the client do not, but two
  existing oracles do: `others_digest` in `mapgen_signature_bog_tree.rs:429-476` serializes the Fire and Frost anchors
  and `mapgen_signature_church.rs:489` the Fire, Plague and Frost anchors, entrance order included. With the prototype
  sorting, `mapgen_signature_bog_tree.rs` `the_other_three_landmarks_are_unchanged` failed (seed 1). Part 2 replaces
  `pinned_others` with the alone-equals-together property, so the sort lands there with no re-pin of an existing test,
  and Part 1 changes no existing oracle. The planned `every_anchor_entrance_is_row_major` test goes to Part 2's oracle;
  here `placed_landed_rederives_every_written_cell` pins today's order exactly instead.
- **The three parser unit tests go in Part 1, not Part 2** (below): deleting the readers makes them dead code.
- `Placed.landed`'s marks are row-major on the map, as planned (new data: nothing pins an order yet).
- `EntranceRule::FrontRun` takes the column of the mark's tiles, so the hall's two `E` (one column) give the nave.

## Existing tests this packet changes (approval needed; flagged for the coordinator)
Deleting the three readers makes their in-file unit tests dead code, so they go in Part 1 (the plan had them in Part 2):
`cave.rs` `the_default_blueprint_parses_and_malformed_grids_do_not`, `church.rs`
`the_default_blueprint_parses_and_malformed_grids_do_not`, `bog_tree.rs` `the_default_drawing_parses_and_malformed_grids_do_not`.
Every fact they pin is in this oracle (the marks, the gate, the transform, the malformed grids) except two that no
longer hold by design: the cave reader's "short mouth / mouth off the front row / mouth not one run" and the tree
reader's "even side / trunk not at the centre" refusals (the generic reader does not judge a drawing's content; a
malformed approved drawing is caught by the byte-equal pins to `docs/` and the orientation oracles).

## Facts from the other lane (recorded so nothing is lost)
- The Unity art expects the hall anchor's entrance to be the nave's seven tiles on the front row (drawing row 36,
  columns 15-21: `FrontRun(b'E')` gives exactly that, pinned above) and the volcano's to be its six outlet tiles with
  its centre a crater-lake lava tile (`volcano.rs` records an empty entrance today; SCALE-4 changes it, not this
  packet).
- `crates/rh-server/tests/map_anchor_seeds.rs` (seeds 1-8 anchors against the wire's rules) must stay green.
- Reviewer minor points folded in here: `church::Blueprint::parse` treated any non-`+` front-row character as gate; the
  generic `FrontRun` counts only open glyphs (`Nothing`, `Floor`), pinned by `the_marks_and_the_entrances_are_found`.
  Stale comments at `crates/rh-sim/src/mapdata/model.rs:256` (entrance "on the footprint's edge facing `front`"; the
  footprint "bounding rectangle of the landmark feature's owned tiles") and `crates/rh-sim/src/mapgen/map_hash/tests.rs:400`
  ("the anchors restate the signature features (kind, bbox)"): out of this scope (shared files, no behaviour), listed
  in Part 2's scope as comment-only edits.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"`; build with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
- `cargo test -p rh-sim --test mapgen_signature_blueprint`
- `cargo test -p rh-sim --features trusted-status-probes --test 'mapgen_signature_*' --test mapgen_land_sentenced`
- `cargo test -p rh-mapdress`; `cargo test -p rh-server --test map_anchor_seeds`
- `cargo test -p rh-sim --test mapgen_signature_blueprint print_signature_pins -- --ignored --nocapture` (values only)
- `scripts/gate.sh --quick --base agent/fable/P-MAPGEN-SIG-SCALE-2-fix --oracle packet/P-MAPGEN-SIG-BLUEPRINT-1`, then
  without `--quick`.

## 10. Risk and suggested model tier
Opus: the work is mostly deletion, but every option-on map is pinned; one wrong legality class, a feature written in
another order, the mirror mapping flipped, or a refusal moved before the mirror draw changes maps or attempts. The guards
name the first seed that moves. About 650 changed lines, a net reduction (accepted over the 450-line guideline in the
plan: one guard covers all three ports).

## 11. Known traps
- The mirror draw comes before every refusal, the missing drawing included: a refusal before the draw leaves the stream
  one draw short for nothing downstream today, but the plan and the guards assume today's order.
- The church's split check counts walls AND the LOW fence; its piece check counts walls only. The cave and tree have no
  LOW, so "walls + LOW" for the split is exact for all three.
- The tree's walls and marsh need `Site::ground` as well as `Site::wall`; the church's fence and the cave's ice do not
  (the cave's ice is `Site::floor`, not `Site::wall`).
- The box rule equals today's centre pin only while the site side is even (34: one spare tile, before the box). HOLY-1
  sizes sites from the drawing (review finding 3).
- `Placed` gains a field: any other constructor of `Placed` (none today outside `apply`) must fill it.
- `finish` keeps the church's footprint and re-reads the others from features; that is unchanged here (the frame
  packet removes it): the stamp's footprint and the re-read agree for the cave and tree because walls or marsh reach
  every edge of their boxes.
- `tests/content.rs` reads consts as tunables: no `const` in the new files; `specs` is a function.

## Notes from previous attempts
