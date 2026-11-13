# P-LAND-SENTENCED-1-fix: the lanes read the church's door strictly, and the plan's two orientations are written down

- **Serves:** reviewer-opus notes on P-LAND-SENTENCED-1 (2026-11-13, LAND WITH NOTES: two MINOR, both fragility
  only, neither wrong today)
- **Implementer:** the land-generation lane's main session, under CLAUDE.md "a fix of a few lines it may make itself,
  through the same gate". There is no separate failing-oracle commit: the unit test is added with the fix.
- **Reviewer:** reviewer-opus (rh-sim map generation)
- **Integration base:** `agent/opus/P-LAND-SENTENCED-1` @ `c7f75cada` (stacked on it; the two merge together)
- **D-rules touched:** none. No map moves with the option on or off; no sim, wire, save, state-hash or content-hash
  change.

## 1. ID and outcome
Two notes from the review of the lanes.

1. `lanes::frame` took every unowned floor tile on the church's door-side wall line as the door and centred the spine
   on the first and last of them, without checking that they are the door `church.rs` builds (three tiles in one
   run). When it found no such tile it returned `None`, and `shape` then laid today's rows on a signature map without
   saying so. Now the door is accepted only as exactly three open tiles in one run; a zone with a signature `Church`
   whose door does not read so stops the styler with `Error::Feature`. No `Church` (option off) is still `Ok(None)`.
2. `Plan` holds two orientations in signature mode, and `Square::s` counts from a grid origin the plan no longer
   carries when they differ. That, and the fact that `validate_plan` reads the door again from the props-time map, are
   now doc comments on `Plan`, `Square` and the call, and a sentence in the styler's README.

## 2. Dependencies
P-LAND-SENTENCED-1 (reviewed LAND WITH NOTES, not merged).

## 3. Relevant legacy paths (verified with `rg`)
- none (legacy has no church)

## 4. New paths
- none (this brief)

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_gallows/{lanes.rs, shape.rs, mod.rs, README.md}`
- this brief

## 6. Contracts and references
- `docs/backlog/packets/P-LAND-SENTENCED-1.md`; ADR 0028 G1 (a guarantee is kept or the map is not made).
- `crates/rh-sim/src/mapgen/landmarks/signature/church.rs` (the landmark lane's; read only): the ring leaves the door
  open as `(c - ax).abs() <= 1` on the front line, and every other edge tile that is not the map border becomes a
  church-owned wall.

## 7. Behaviour to preserve
- Every map, option on and off, byte for byte: `mapgen_land_sentenced`, the option-off guards, the seven
  `mapgen_signature_*.rs` files and the `rh-mapdress` goldens pass unchanged, with no re-pin.

## 8. Acceptance checks
- `style_gallows::lanes::tests::the_door_is_exactly_three_open_tiles_in_one_run`: three tiles in a run are the door;
  an extra open tile on the edge (beside the door or apart from it), a short door, a gapped door and no open tile are
  not.
- The oracle of P-LAND-SENTENCED-1 passes 10 of 10; the full gate with `--oracle packet/P-LAND-SENTENCED-1` passes.
- A seed sweep with the option on meets no generator error (figures in section 11).

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib style_gallows`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_sentenced`
- `scripts/gate.sh --oracle packet/P-LAND-SENTENCED-1`

## 10. Risk and suggested model tier
Low: a stricter read of a door that the church's ring already guarantees. Same tier as the packet it fixes.

## 11. Known traps
- **A styler error is not a refused attempt.** `Error::Feature` from `shape` reaches the caller as
  `pipeline::Error::Style`: the generation call fails; the next attempt is not tried. A styler has no way to refuse an
  attempt (the refusals are the pipeline's, the landmark lane's file). So the strict door is an assertion that the two
  lanes agree on what a church's door is, not a discard rule. The sweep below is the evidence that it does not fire on
  today's church.
- **P-MAPGEN-SIG-SCALE-2 will trip it if the `Church` feature's box grows to the whole 29x29 blueprint**: the
  door-side edge is then the graveyard's last row, 29 open tiles, and every signature map stops with
  `pipeline::Error::Style(Feature)`. That is the intent (before this fix the spine would have landed on the right
  column only because the blueprint is symmetric), and it means the lanes need the door from the landmark lane at that
  point. Proposed to the coordinator in the hand-off: stylers read the anchor's `entrance` instead of deriving it
  (`style_runtime/` is shared).
- **The sweep** (a temporary test, `zz_door_sweep.rs`, not committed; debug build, macOS arm64, on this branch): every
  attempt of every seed until a map is made, option on. Without decor, seeds 1 to 400: 709 attempts, 400 maps, each
  with a Sentenced church, no generator error. With decor, seeds 1 to 64: 101 attempts, 64 maps, each with a
  Sentenced church, no generator error. No seed needed more than 16 attempts.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_sentenced.rs`, `docs/backlog/packets/P-LAND-SENTENCED-1.md` (those of the packet
  this fixes).
