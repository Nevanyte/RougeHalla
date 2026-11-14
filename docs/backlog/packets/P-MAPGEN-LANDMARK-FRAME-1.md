# P-MAPGEN-LANDMARK-FRAME-1: the zone stylers are handed their landmark (a `LandmarkFrame`), no map changed

- **Serves:** the land-generation lane's architecture review of 2026-11-13
  (`docs/coordination/LANDMARK_ARCHITECTURE_REVIEW_2026-11-13.md`, finding 1), asked by the owner ("make sure the
  architecture is well set up"); the review's order (B): after the blueprint packets (P-MAPGEN-SIG-BLUEPRINT-1 and -2),
  before the volcano (P-MAPGEN-SIG-SCALE-4) and the hall (P-MAPGEN-SIG-HOLY-1). The guarantees packet
  (P-MAPGEN-GUARANTEES-1, finding 4) follows this one and reads the frame.
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase, the style runtime, four stylers; every
  option-on map is pinned)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` with P-MAPGEN-SIG-BLUEPRINT-1 and -2 merged. Until -2 is merged this
  branch is stacked on it: `packet/P-MAPGEN-LANDMARK-FRAME-1` was rebased by the lane's session onto
  `agent/opus/P-MAPGEN-SIG-BLUEPRINT-2`; run the gate with `--base agent/opus/P-MAPGEN-SIG-BLUEPRINT-2` until then.
  **Line numbers in this brief were taken before that rebase** (Part 2 deleted about 480 lines under `signature/`):
  re-find each by name. Part 2 added `SignatureContext::apply_only` and the shared per-zone `place`: `apply_only`
  builds its zone's frame exactly as `apply` does (`mapgen_signature_table.rs` compares the two through
  `Placed::anchors()` and `Placed::landed()`; the lane's session switched its three field reads to the accessors).
- **D-rules touched:** D1: no legacy counterpart (DEV-020); option off and option on byte- and draw-identical (G8)
  · D2 n/a · no sim tick, wire, save, state-hash or content-hash change. The frame is generator working state: never
  serialized, exported, hashed or sent.
- **Status:** oracle written (2026-11-14, oracle-author, Opus). Measurements below run on the base commit.

## 1. ID and outcome
Four stylers rebuild their zone's signature landmark from map features, each in its own way, and switch to signature
mode on "a feature of kind K is in my zone":
- `style_rime/mod.rs:319` `signature_anchor`: the `Cave` feature's box; the mouth scanned as the floor tiles on the box
  edge with floor just outside (`:323-340`).
- `style_gallows/lanes.rs:73` `frame`: the `Church` feature's box; the door as exactly three open tiles on the door-side
  wall line (`door_span`, `:64-69`, scan `:96-106`); the yard as the union with the `Graveyard` boxes (`:107-117`);
  `Err(Error::Landmark)` when the door does not read.
- `style_warren/pools.rs:114` `tree`: the `BogTree` feature's box.
- `style_scorch/mod.rs:373` `signature_anchor`: the `Volcano` feature's box.
- `signature::finish` (`signature/mod.rs:726`) re-reads each footprint from its feature after records, with a Church
  exception.

That cannot work for Holy (`Hall` is a legacy styler kind, present with the option off: the likeliest option-off leak),
and a drawing edit silently becomes `Error::Landmark` on every attempt. After this packet:
- `landmarks/signature/frame.rs` (new, stubbed): `LandmarkFrame { anchor, landing, marks, features, cells }`, `Mark {
  ch, grid, tile }`, `LandmarkFrame::{zone, mark, heading}`, and the accessors `Placed::anchors()` and `Placed::landed()`.
- `SignatureContext::apply` builds one frame per zone it builds, in `reserved_zones` order, into `Placed::frames`.
  **`Placed.anchors` and `Placed.landed` are removed** (one record of what was placed): `Placed::anchors()` returns
  `frames[i].anchor` in order; `Placed::landed()` derives P-MAPGEN-SIG-BLUEPRINT-1's `Landed` (frames with a landing, in
  order; marks grouped by character ascending, each character's tiles row-major on the map). The stub commit already
  switched every reader of the two fields to the accessors.
- The pipeline passes `placed.as_ref().map(|p| p.frames.as_slice())` as `style_zones::Input::landmarks` (`None` with the
  option off); `style_zones` gives each zone's `style_runtime::Inputs::landmark` its own frame (`find` by zone), which
  `Runtime::base` copies to `BaseContext::landmark`. `None` is the one typed branch point for signature mode.
- The four readers read `b.landmark` and nothing from features:
  - rime: footprint `anchor.footprint`; mouth = `mark(b'D')` **sorted row-major** (today's scan order; `lakes::grow_lakes_at`
    seeds its BFS queue in this order, so the order is behaviour); centre, front from the anchor.
  - lanes: the door = `mark(b'D')`, which must be three tiles in one run on one wall line (`door_span` on the sorted
    coordinates; else `Err(Error::Landmark)`, decided from the frame before any tile is read); `horizontal`/`sign` from
    `anchor.front` (today's `DIR16[front(f.ax, f.ay)]` rule, with the anchor's centre = the feature's `ax, ay`); `line` the
    D tiles' common x (horizontal) or y; `spine` the middle; `yard` the union of `frame.features` boxes (measured: equals
    today's Church-plus-Graveyard union and the anchor's footprint).
  - pools and scorch: the anchor (footprint, centre, front) from the frame.
- `finish(map, frames)` exports `frame.anchor` as it is and stops re-reading features (the Church exception goes). The Holy
  hall rule (largest Holy `Hall` feature) stays until HOLY-1 gives the hall a frame.
- `intact`: see section 7 (general form only if it discards exactly today's attempts).

Nothing a player, a styler, the server or the client sees changes: every generated map, option on and option off, is
byte-identical, anchors included, and no draw is added, removed or reordered.

## 2. Dependencies
- In the base: P-MAPGEN-SIG-BLUEPRINT-1 (the table, the stamp, `Placed.landed`); P-MAPGEN-SIG-BLUEPRINT-2 (the
  rule-drawn paths deleted, the anchors' entrances row-major, `is_signature`/`by_tile`/`aprons_apart`/`intact` from the
  table) is merged before this one is implemented.
- Before P-MAPGEN-GUARANTEES-1 (its checks take `&LandmarkFrame`), P-MAPGEN-SIG-SCALE-4 (the volcano's frame gains a
  landing and outlet marks) and P-MAPGEN-SIG-HOLY-1 (the hall gets a frame; `finish`'s hall rule goes).
- Shared-file rule: `signature/mod.rs`, `style_zones/mod.rs`, `style_runtime/`, `pipeline/mod.rs`: merge alone.

## 3. Relevant legacy paths
None: signature landmarks have no legacy counterpart (DEV-020). The reference is today's Rust (base commit lines):
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs`: `Placed` `:336-341`, `apply` `:585-671` (the anchors pushed at
  `:664`, `landed` at `:647`), `write` `:673-719` (each piece's cells, box and owner), `finish` `:726-761`, `intact`
  `:769-856`, `stamp` `:948-1063` (marks landed row-major at `:1040-1048`).
- `signature/blueprint.rs`: `Landing::tile`, `Orientation::turn`, `Blueprint::marks` (ascending by character, each mark's
  grid tiles row-major in the grid).
- The four readers above; their callers `style_rime/shape.rs:132`, `style_gallows/shape.rs:150`,
  `style_gallows/mod.rs:193`, `style_warren/shape.rs:149`, `style_scorch/mod.rs:192`.
- `style_runtime/contexts.rs:5-59` (`BaseContext`, `Runtime::base`), `style_runtime/mod.rs:362` (`Inputs`),
  `style_zones/mod.rs:33-49` (`Input`), `:357-376` (the per-zone runtime), `pipeline/mod.rs:350-367` (`placed`),
  `:438-457` (the styler input), `:693-696` (`finish`), `:721` (`intact`).

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/frame.rs` (stub commit: the types, `zone`, placeholder `mark`/`heading`,
  `Placed::anchors()`/`landed()` reading the old fields).
- `crates/rh-sim/tests/mapgen_landmark_frame.rs` (oracle commit).

## 5. Exclusive write scope
- `landmarks/signature/frame.rs`: the bodies; private helpers. The public names, fields and signatures the oracle uses
  may not change (fields may be added).
- `landmarks/signature/mod.rs`: `Placed` (remove `anchors` and `landed`; keep `terrain`, `frames`), `apply`'s bookkeeping
  (build the frames; no change to what is placed, written or drawn), `stamp`'s return (it may return the frame's parts
  instead of `Landed`), `finish`, `intact` (section 7), doc comments.
- `style_zones/mod.rs` (`Input`, passing each zone's frame to `Inputs`); `style_runtime/{mod.rs (Inputs), contexts.rs}`.
- `pipeline/mod.rs`: passing the frames to the stylers and to `finish`.
- `style_rime/mod.rs` (`signature_anchor`) and `style_rime/shape.rs` (its caller); `style_gallows/lanes.rs` (`frame`,
  `door_span`, its unit tests) and its callers in `style_gallows/{mod.rs, shape.rs}`; `style_warren/pools.rs` (`tree`) and
  `style_warren/shape.rs`; `style_scorch/mod.rs` (`signature_anchor` and its caller).
- In-crate unit tests in those files that build a signature state by hand (they need a frame instead of, or as well as,
  the feature). Each one changed is listed in the hand-off with why.
- Not in scope: every file under `crates/rh-sim/tests/` (the stub commit made every change they need), `blueprint.rs`,
  `spec.rs`, `cave.rs`, `church.rs`, `bog_tree.rs`, `volcano.rs` (beyond `apply` collecting what they return), the
  drawings, `crates/rh-mapdress/**`, `mapdata/`, the wire.

## 6. Contracts and references
- ADR 0028 (`docs/adr/0028-signature-landmarks.md`) G1-G10; C-PARITY (option off byte-identical, G8); AGENTS.md
  determinism (ordered iteration only; draw order is behaviour; the signature stream only, G6).
- The wire (`crates/rh-protocol/src/map.rs`) and `crates/rh-server/tests/map_anchor_seeds.rs` unchanged and green.

## 7. Behaviour to preserve
- Every option-on map of seeds 1-32 (`mapgen_signature_blueprint.rs` `option_on_maps_are_unchanged`) and every Landmarks
  phase of seeds 1-16 attempts 0-1 (`the_landmarks_phase_is_unchanged`, which hashes `placed.anchors()`): green with no
  re-pin. Option off: the `option_off_is_todays_generator` guards in seven test files, untouched.
- The order of the cave mouth the Frost styler reads: row-major on the map (today's scan), NOT the frame's grid order
  (measured: the two differ on 82 of 159 phases). After Part 2 the anchor's entrance is row-major and equal to it.
- `Error::Landmark` stays the lanes' answer for a church whose `D` mark is not three tiles in one run on one wall line
  (`mapgen_style_refusal.rs`, now handed a frame whose `D` is the made-up door).
- **`intact`.** Today's per-kind rules stay unless the general form ("every cell in `frame.cells` still has its tile and
  terrain on the finished map, and its owner is a feature of the zone of one of `frame.features`' kinds") keeps and
  discards EXACTLY the same attempts as today's on seeds 1-96, every attempt up to each seed's map. The implementer
  measures it (both predicates on every attempt that reaches the check) and reports the counts; if they differ on any
  attempt, today's stays and the count goes in the hand-off (a stricter discard moves maps: the owner's call). The
  door, apron, `aprons_apart` and Frost lake parts of `intact` are untouched here.

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_landmark_frame` green (7 red on the stub, 1
  control green).
- `mapgen_signature_blueprint` (both guards and `placed_landed_rederives_every_written_cell`), every `mapgen_signature_*`,
  `mapgen_land_sentenced`, `mapgen_land_plague`, `mapgen_style_refusal`, `cargo test -p rh-mapdress` and
  `cargo test -p rh-server --test map_anchor_seeds`: green, unchanged.
- No styler scans for its landmark: this must print nothing:
  `rg -n 'kind == FeatureKind::(Cave|Church|BogTree|Volcano|Graveyard)' crates/rh-sim/src/mapgen/style_*`
  (today it lists `style_rime/mod.rs:320`, `style_gallows/lanes.rs:74, 110`, `style_warren/pools.rs:115`,
  `style_scorch/mod.rs:374`).
- `rg -n 'b\.landmark|\.landmark\b' crates/rh-sim/src/mapgen/style_{rime,gallows,warren,scorch}` shows the four readers.
- `finish` reads no `map.features` except the Holy hall rule.
- `Placed` has no `anchors` or `landed` field (`rg -n 'pub (anchors|landed):' crates/rh-sim/src/mapgen/landmarks`).
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-LANDMARK-FRAME-1` then the full gate.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_landmark_frame.rs` (new)
- `docs/backlog/packets/P-MAPGEN-LANDMARK-FRAME-1.md`
- The stub commit's files are the implementer's where section 5 says so; its test edits
  (`mapgen_signature_blueprint.rs`, `support/signature_pins.rs`, `mapgen_signature_church.rs`, `mapgen_style_refusal.rs`)
  are final: not to be edited further.

## The oracle (`crates/rh-sim/tests/mapgen_landmark_frame.rs`)
Red on the stub (no frames; the stylers ignore `landmarks`), each on an assertion:
| Test | Pins | Red on the stub |
|---|---|---|
| `one_frame_per_reserved_zone_in_placement_order` | seeds 1-32 attempts 0-1, every accepted Landmarks phase: frames Fire, Sentenced, Plague, Frost; `zone()`; `Placed::anchors()` = the frames' anchors in order; a landing for the three drawings (its box = the anchor's footprint), none for the volcano; `features` = the zone's signature features of this phase (kind, box) in write order, the anchor's kind first | "the frames' zones": `[]` |
| `each_frames_anchor_is_the_finished_maps_anchor` | seeds 1-32 option on: four frames; each frame's anchor equals the finished map's anchor for its zone | "the frames": 0 vs 4 |
| `the_frames_marks_and_boxes_are_what_todays_readers_find` | seeds 1-32, on the finished map: `mark(ch)` = the frame's marks of `ch` in order; the cave's `D` row-major = today's mouth scan (3 tiles); the church's `D` row-major = today's door scan (3 tiles); the union of the church frame's feature boxes = today's yard = the church's footprint; the tree's, volcano's and cave's footprints = their feature boxes | "no Frost frame among 0 frames" |
| `the_frames_cells_are_the_landmarks_tiles_on_the_finished_map` | seeds 1-32: `cells` strictly ascending, exactly the tiles the zone's signature features own after the Landmarks phase, with that phase's tile and terrain; on the finished map the same tile and terrain, owned by a feature of the zone of one of the frame's kinds | "no frames" |
| `marks_keep_grid_order_and_headings_turn_with_the_drawing` | seeds 1-32 attempts 0-1: `marks` = every mark tile of the drawing's legend by character then grid order, each on `landing.tile(grid)`; the cave's `D` in ascending drawing column; `heading((0, 1))` = `axis(anchor.front)`, `heading(d)` = `orientation.turn(d)`; the volcano no marks, no heading; at least three cave orientations seen | "the frames": 0 vs 4 |
| `a_frame_without_a_church_feature_is_built_round_in_signature_mode` | a made-up Sentenced church (as `mapgen_style_refusal.rs`'s; the ring owned by a `Landmark`-kind feature) with its frame and NO `Church` feature: the same answer, tiles and fence rows as with the `Church` feature and the frame (decor off and on) | "not the lanes (23 rows, 20 wanted): the styler did not read its frame" |
| `a_church_feature_without_a_frame_is_built_as_legacy` | the same with the `Church` feature and NO frame (the option-off leak): the same answer, tiles and fence rows as with neither feature nor frame | "not the legacy rows (20 rows, 23 wanted): a Church feature without a frame still switches the styler" |
Green control: `the_made_up_church_tells_lanes_from_legacy_rows` (with frame and feature, and with neither, the styler
succeeds and lays fence rows, and the two outputs differ: the made-up zone tells the modes apart). Legacy rows and
lanes are both `FenceRow`s with job `Lane`, so the tests compare whole outputs (tile layer and fence rows), not the job.

Item 6 of the plan is built for the Sentenced styler only (its signature mode is directly observable: `FeatureJob::Lane`
rows). The Frost, Plague and Fire stylers' signature modes are not observable in a small made-up state without
reproducing their lake, pool and crater inputs; for them the `rg` checks of section 8 stand in, and the four map-level
tests above pin that their frames carry exactly what they read today.

## Measurements (oracle author, 2026-11-14, base `6f8821400`, macOS arm64, debug build; a throw-away test, not committed)
Seeds 1-96 option on, every attempt up to each seed's map: 159 accepted Landmarks phases, 96 finished maps.
- **Landing box, feature box, exported footprint.** Cave and bog tree: landing box = feature box = exported footprint on
  159/159 phases and 96/96 maps (the cave's walls and the tree's marsh reach every edge of the 29 x 29 box). Church:
  landing box = exported footprint 159/159; the `Church` feature box is the building only (0/159 equal), as `finish`'s
  exception says. Volcano (no landing): the step's anchor footprint = the `Volcano` feature box 159/159.
- **`finish`'s re-read is a no-op.** The exported anchor equals the step's anchor, field for field (entrance order
  included), for all four zones on 96/96 maps. So `frame.anchor` = the step's anchor = the exported anchor, and `finish`
  may copy it.
- **Records.** On 96/96 finished maps, records kept every signature feature's box (Volcano, Church, BogTree, Cave) and
  every Graveyard, LavaStream and LavaPool box and tile count exactly as the Landmarks phase wrote them. Not measured:
  attempts refused after records (their maps are not reachable from a test); no re-read is kept for them.
- **The yard.** Exactly one `Graveyard` per church (159/159); the union of the `Church` and `Graveyard` boxes = the
  church's landing box on 159/159 phases and 96/96 maps (the fence rings the drawing). The frame's `features` carry it
  either way.
- **The cave's `D`.** Today's mouth scan on the `Cave` box = the landed `D` tiles row-major: 159/159 on the Landmarks
  phase's tiles, 96/96 on the finished map. In grid order they differ from row-major on 82 of 159 phases: the Frost
  styler must sort.
- **The church's `D`.** Today's door scan (unowned floor on the door-side wall line of the `Church` box) = the landed `D`
  tiles row-major: 159/159 on the phase (stage owners), 96/96 on the finished map; always three in one run.

## Departures from the plan (and why)
- `Placed.anchors` and `Placed.landed` become accessors (`anchors()`, `landed()`), not kept fields: two records of one
  placement would drift. The stub commit switched the three readers (`mapgen_signature_blueprint.rs:887, 893, 905`,
  `support/signature_pins.rs:66`, `mapgen_signature_church.rs:489`) to the accessors; what they assert is unchanged.
- `LandmarkFrame::zone()` added (the anchor's zone), for the styler's per-zone lookup.
- `marks` order spelled out: by character ascending, then grid order (`Blueprint::marks` order). The plan said "GRID
  order"; the character key makes it total.
- The frame does not carry a separate yard: the measurements show `features`' union is today's yard.
- The general `intact` is not tested by name: `the_frames_cells_are_the_landmarks_tiles_on_the_finished_map` pins its
  premise on the kept maps; whether it discards the same attempts is the implementer's measured report (section 7).

## Existing tests this packet changes (approval needed; flagged for the coordinator)
All in the stub commit; none changes what it asserts:
- `crates/rh-sim/tests/mapgen_signature_blueprint.rs` (Part 1's oracle) and `tests/support/signature_pins.rs`:
  `placed.landed` -> `placed.landed()`, `placed.anchors.iter()` -> `placed.anchors()`.
- `crates/rh-sim/tests/mapgen_signature_church.rs:489`: the same (`pinned_others`; Part 2 may already have replaced it:
  then the rebase drops this line).
- `crates/rh-sim/tests/mapgen_style_refusal.rs`: the made-up church is also handed its frame (`church_frame(door)`, `D`
  on the given door tiles) so that its two tests keep passing once the lanes read the frame instead of the feature.
- In-crate unit tests: `landmark: None` added to the 13 hand-built `style_runtime::Inputs` and `landmarks: None` to the 3
  hand-built `style_zones::Input` (`style_{gallows,rime,runtime,sanctum,scorch,warren,zones}/tests.rs`,
  `style_warren/walk_tests.rs`).

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"`; build with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_landmark_frame`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_blueprint --test mapgen_style_refusal
  --test mapgen_land_sentenced --test mapgen_land_plague`, then `cargo test -p rh-sim --features trusted-status-probes`
- `cargo test -p rh-mapdress`; `cargo test -p rh-server --test map_anchor_seeds`
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-LANDMARK-FRAME-1`, then without `--quick`.

## 10. Risk and suggested model tier
Opus: four stylers and the pipeline change how they learn of the landmark; a mouth in grid order instead of row-major,
a door read in another order, a footprint from the landing where today's was the feature box (the volcano), or a frame
passed to the wrong zone moves maps. The guards name the first seed that moves. About 300-400 changed lines.

## 11. Known traps
- The cave mouth order (section 7): `grow_lakes_at` seeds its BFS in the order given.
- The church's anchor footprint is the landing box, NOT the `Church` feature box: the lanes' door line is the `Church`
  box's front edge (drawing row 16), not the footprint's. Read the line from the `D` tiles, not from the footprint.
- The lanes' `horizontal`/`sign` come from `DIR16[front]` of the church's anchor point; the anchor's `front` is that
  same index (`front(t)`, `t` the camp tile = the `Church` feature's `ax, ay`), so use `anchor.front`.
- The volcano has no landing: its frame's `marks` are empty, `heading` is `None`; its footprint is the `Volcano` feature's
  box as `volcano::place` returns it. Its cells include the streams and pools (several pieces: dedupe by tile, the last
  writer's tile and terrain, as the stage's layers hold them).
- `style_scorch/craters.rs:213` reads the `LavaStream`/`LavaPool` features: those stay features (SCALE-4's).
- `style_zones` admission (`admit_inputs`) runs before any zone: a frame for a zone not in `order` is simply not used.
- `Placed::landed()` must keep a mark character of the legend that has no tile (none today) if P-MAPGEN-SIG-BLUEPRINT-1's
  oracle is to keep holding for future drawings; derive the characters from the frame's marks only if that cannot
  happen.
- `finish` still sorts the anchors by zone code and adds the Holy hall.

## Notes from previous attempts
None.
