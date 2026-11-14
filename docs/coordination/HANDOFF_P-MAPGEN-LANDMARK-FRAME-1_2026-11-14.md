# Hand-off: P-MAPGEN-LANDMARK-FRAME-1 (2026-11-14, implementer-opus)

```
PACKET:          P-MAPGEN-LANDMARK-FRAME-1 — serves the land-generation lane's architecture review of 2026-11-13
                 (finding 1), order (B): after the blueprint packets, before P-MAPGEN-GUARANTEES-1, SCALE-4 and HOLY-1
BRANCH:          agent/opus/P-MAPGEN-LANDMARK-FRAME-1 @ 749e2ce57 (implementation; this hand-off is the next commit),
                 stacked on agent/opus/P-MAPGEN-SIG-BLUEPRINT-2 (run the gate with --base agent/opus/P-MAPGEN-SIG-BLUEPRINT-2
                 until -2 is merged)
GATE:            not run by the implementer (the lane's session runs the full gate)
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/{frame.rs, mod.rs}; crates/rh-sim/src/mapgen/pipeline/mod.rs;
                 crates/rh-sim/src/mapgen/style_zones/mod.rs; crates/rh-sim/src/mapgen/style_rime/{mod.rs, shape.rs (comment)};
                 crates/rh-sim/src/mapgen/style_gallows/{lanes.rs, mod.rs (comment), shape.rs (comment)};
                 crates/rh-sim/src/mapgen/style_warren/{pools.rs, shape.rs (comment)}; crates/rh-sim/src/mapgen/style_scorch/mod.rs;
                 this file. style_runtime/ needed no change (the stub already carried Inputs::landmark to BaseContext::landmark).
D-RULES:         D1: no legacy counterpart (DEV-020); option off and option on byte- and draw-identical (G8): the
                 Part 1 guards (option_on_maps_are_unchanged, the_landmarks_phase_is_unchanged) green with no re-pin;
                 D2 n/a; nothing touches D5/D6/D9 (no sim tick, wire, save, state or content hash; the frame is never
                 serialized, hashed, exported or sent)
DEVIATIONS:      none
SHARED RECORDS:  none (proposed doc edits outside the write scope: see "Outside the scope")
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: the full gate on this tip (C#/JS steps, rh-server beyond map_anchor_seeds); equality beyond the pinned
                 seeds (1-32 option-on maps, 1-16 phases) and the 1-96 intact measurement below; the general `intact`'s
                 strictness (the measurement could not tell the two predicates apart, see below)
RISKS:           `Placed::landed()` derives mark characters from the frame's tiles: a future legend mark with no tile in
                 its drawing would drop out (guarded by a debug assertion in `from_definition`); the Plague styler's tree
                 anchor now carries the frame's entrance (the causeways) where it carried none (only its footprint is read)
```

## What changed
- `signature/frame.rs`: `LandmarkFrame::mark` (the mark's tiles in the frame's grid order), `heading` (`landing`'s
  `Orientation::turn`, `None` without a landing), `Placed::anchors()` (`frames[i].anchor`), `Placed::landed()` (frames
  with a landing, in order; marks grouped by character, each character's tiles sorted row-major on the map).
- `signature/mod.rs`:
  - `Placed` is `{ terrain, frames }`; the `anchors` and `landed` fields are gone.
  - `place` (shared by `apply` and `apply_only`) returns the zone's `LandmarkFrame`: the anchor exactly as `stamp` or
    `volcano::place` built it; the landing and marks (grid order: `Blueprint::marks`, character then drawing row-major)
    from `stamp`; `(kind, box)` of each written piece in write order (`write` now returns the box it computed); every
    written cell ascending by tile, deduplicated with the last writer's tile and terrain (the volcano's overlapping
    pieces). Nothing placed, written or drawn changed: `write` runs in the same order on the same pieces.
  - `stamp` returns `(Built, Landing, Vec<Mark>)` instead of `Landed`.
  - `finish(map, &frames)` exports each frame's anchor as it is; the feature re-read and its Church exception are gone.
    The Holy hall rule (largest Holy `Hall`) and the zone-code sort stay.
  - `from_definition`: a debug assertion that every legend mark of every parsed drawing has at least one tile (the
    condition under which `landed()` may derive the characters from the frame's tiles; the brief's trap).
  - `intact`: unchanged (see below).
- `pipeline/mod.rs`: `style_zones::Input::landmarks = placed.as_ref().map(|p| p.frames.as_slice())`; `finish(&mut map,
  &p.frames)`.
- `style_zones/mod.rs`: each zone's `Inputs::landmark` is `input.landmarks` `find` by `zone() == faction`.
- Readers (`b.landmark` only; no feature scan):
  - `style_rime::signature_anchor`: the frame's anchor with entrance = `mark(b'D')` sorted row-major (today's scan order;
    `grow_lakes_at` seeds its BFS in it).
  - `style_gallows::lanes::frame`: `horizontal`/`sign` from `DIR16[anchor.front]`; the door = `mark(b'D')` sorted
    row-major, which must share one coordinate across the axis (the `line`: x when `horizontal`, else y) and be three in
    one run along it (`door_span`), else `Err(Error::Landmark)`, all before any tile is read; `spine` the middle; `yard`
    the union of `frame.features` boxes.
  - `style_warren::pools::tree`, `style_scorch::signature_anchor`: `b.landmark.map(|f| f.anchor.clone())`.

## Test results (debug, macOS arm64; `--features trusted-status-probes` for rh-sim)
All on the implementation tip 749e2ce57 (the hand-off commits change no code).
- `cargo fmt --all -- --check`: clean.
- `cargo clippy -p rh-sim --all-targets --features trusted-status-probes -- -D warnings`: clean.
- `--test mapgen_landmark_frame`: 8 passed (the 7 red on the stub and the control).
- `--test mapgen_signature_blueprint`: 10 passed, 1 ignored (as before). Both guards and
  `placed_landed_rederives_every_written_cell` are green with no re-pin.
- `--test mapgen_signature_table`: 8 passed. `--test mapgen_style_refusal`: 5 passed. `--test mapgen_land_sentenced`:
  11 passed, 2 ignored. `--test mapgen_land_plague`: 26 passed, 3 ignored.
- `cargo test -p rh-sim --features trusted-status-probes --no-fail-fast`: exit 0, 84 test binaries, 1496 passed,
  0 failed, 30 ignored. That covers every `mapgen_signature_*` target and every `option_off_is_todays_generator` guard.
- `cargo test -p rh-mapdress`: exit 0, every target ok (77 passed). Goldens unchanged.
- `cargo test -p rh-server --test map_anchor_seeds`: 1 passed.

## Acceptance checks (brief section 8)
```
$ rg -n 'kind == FeatureKind::(Cave|Church|BogTree|Volcano|Graveyard)' crates/rh-sim/src/mapgen/style_*
(nothing)
$ rg -n 'b\.landmark|\.landmark\b' crates/rh-sim/src/mapgen/style_{rime,gallows,warren,scorch}
crates/rh-sim/src/mapgen/style_scorch/mod.rs:375:    b.landmark.map(|f| f.anchor.clone())
crates/rh-sim/src/mapgen/style_warren/pools.rs:116:    b.landmark.map(|f| f.anchor.clone())
crates/rh-sim/src/mapgen/style_rime/mod.rs:320:    let f = b.landmark?;
crates/rh-sim/src/mapgen/style_gallows/lanes.rs:80:    let Some(f) = b.landmark else {
$ rg -n 'pub (anchors|landed):' crates/rh-sim/src/mapgen/landmarks
(nothing)
```
`finish` reads `map.features` only for the Holy hall rule.

## The general `intact` (brief section 7): measured, not adopted
Measured with a temporary instrumented build (reverted, not committed): `certified_styled` on seeds 1-96 with the
option on, every attempt that reached the `intact` check, both predicates evaluated (today's `intact`, and today's with
its owned-tile part replaced by "every `frame.cells` tile keeps its tile and terrain and is owned by a feature of the
frame's zone of one of `frame.features`' kinds").
- 140 attempts reached the check; 96 kept (one per seed), 44 discarded. Today's and the general form agreed on all
  140 (96 kept, 44 discarded by both).
- But both owned-tile parts were true on all 140: every discard came from the door, apron, `aprons_apart` or Frost
  lake parts. The measurement shows the general form discards nothing more on these seeds; it does not show the two
  predicates are equivalent (no attempt broke a landmark tile).
- Not adopted, for two reasons. First, the evidence is vacuous, as above. Second, replacing the owned-tile part would
  leave `SignatureContext::owned`, `written`'s use in `from_definition` and `volcano::owned` dead; `volcano.rs` is
  outside this packet's scope (beyond collecting what `place` returns). The general form also drops today's
  `region_grid` zone check and drops the `any_terrain` allowance for the church's walls (it checks exact terrain).
  Both are stricter or different in ways no seed here exercised. The guarantees packet, which takes `&LandmarkFrame`,
  is the natural place: it can adopt the general form as a per-zone check and delete the per-kind table with
  `volcano::owned` in its own scope.

## In-crate unit tests changed
None. No in-crate unit test builds a signature state by hand with a `Church`/`Cave`/`BogTree`/`Volcano` feature for a
styler; `lanes.rs`'s `door_span` tests run unchanged (the helper is the same).

## Outside the scope (proposed edits, not made)
- `crates/rh-sim/src/mapgen/style_gallows/README.md:24-35` and `crates/rh-sim/src/mapgen/style_rime/README.md:79` still
  say the stylers read the `Church` and `Cave` features: they now read the zone's frame (`BaseContext::landmark`).

## What the brief got wrong or left open
- "Fields may be added" to `LandmarkFrame`: not in practice. The oracle (`mapgen_landmark_frame.rs`) and
  `mapgen_style_refusal.rs` build `LandmarkFrame` with struct literals, so any new field breaks them. That is why
  `landed()` derives the mark characters from the tiles, with a debug assertion in place of a field.
- Section 5 lists `style_runtime/{mod.rs, contexts.rs}`; nothing there needed changing (the stub's `Inputs::landmark`
  already reaches `BaseContext::landmark`).
- Line numbers were stale, as the brief warned; all names were found.

## What the next packets should know
- P-MAPGEN-GUARANTEES-1 (end-of-attempt guarantees per zone as functions of `&GameMapData` and `&LandmarkFrame`): the
  pipeline still holds `placed` at the `intact` check (`placed_any` is computed from it before `finish`; `finish` now
  borrows `&p.frames`, so switching to `if let Some(p) = &placed` there keeps the frames for the checks). `frame.cells`
  is exactly the tiles the zone's landmark features own after the Landmarks phase, with their tile and terrain, and on
  every kept map of seeds 1-32 those tiles are unchanged (oracle test 4). The owned-tile measurement above is the
  starting point for retiring the per-kind `owned` table and `volcano::owned`.
- The volcano (SCALE-4): its frame has no landing, no marks and `heading` = `None`; `features` = Volcano, then streams
  and pools in write order; `cells` deduplicated with the last writer. When it becomes a table entry, `stamp` builds
  its landing and marks like the others, and `style_scorch::signature_anchor` needs no change. `craters.rs` still reads
  the `LavaStream`/`LavaPool` features.
- The hall (HOLY-1): `finish` keeps the "largest Holy `Hall`" rule only until the hall has a frame; then that rule and
  `aprons_apart`'s `bbox == footprint` lookup can read the frame instead.
- Readers that need a mark's tiles in map order must sort them (`mark` returns grid order); the Frost mouth order is
  behaviour.
