# P-MAPGEN-STYLE-REFUSE-1: a styler that cannot build round its landmark refuses the attempt; it does not fail generation

- **Serves:** ADR 0028 G5 ("a failing map is discarded, never repaired"); reviewer-opus note 1 on P-LAND-SENTENCED-1
  (2026-11-13); the owner's rule for the landmark requirements ("guarantees are hard: an attempt that cannot deliver
  one is discarded and the next is tried")
- **Implementer tier:** implementer-opus (rh-sim mapgen pipeline and styler runtime: shared files)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-LAND-SENTENCED-1; **before P-MAPGEN-SIG-SCALE-2**
- **D-rules touched:** D1: option off byte- and draw-identical (G8) · no sim tick, wire or identity change

## 1. ID and outcome
Any styler error becomes a failed generation call: `crates/rh-sim/src/mapgen/pipeline/mod.rs:422` turns it into
`pipeline::Error::Style`, and the next attempt is not tried. Since P-LAND-SENTENCED-1 the Sentenced styler returns
`Error::Feature` when a signature church's door does not read as three open tiles in one run
(`style_gallows/lanes.rs:73-106`). That cannot happen on today's church (traced by reviewer-opus; a 400-seed sweep
by the land-generation session), but it is one blueprint change away, and in a live map pool a generation error is the
worst outcome: the pool stops making maps. When this lands a styler has a way to say "this attempt cannot be built
round its landmark" that the pipeline turns into a refused attempt (a `Refusal`, counted and reported like the
others, the next attempt tried), distinct from a real styler fault, which stays an error. The Sentenced lanes use it
for the door; the other signature-mode stylers may use it for their own landmark preconditions.

## 2. Dependencies
- P-LAND-SENTENCED-1 merged. The land-generation session owns `style_gallows/` and agreed (2026-11-13) that this
  packet edits it, limited to: the two `Err(Error::Feature)` returns in `lanes::frame` (no dominant front sign;
  `door_span` finds no three-tile door) becoming the new refusal, and whatever the two call sites need for the new
  type (`shape.rs` `lanes::frame(&b)?`, `mod.rs` `validate_plan` `lanes::frame(c)?`). Its conditions: `Ok(None)`
  without a `Church` stays as it is (option off); the unit test
  `lanes::tests::the_door_is_exactly_three_open_tiles_in_one_run` and its oracle
  (`crates/rh-sim/tests/mapgen_land_sentenced.rs`) stay green; it is told the commit. The README sentence and the doc
  comments that say the styler "stops with `Error::Feature`" are corrected here too.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/pipeline/mod.rs` (the styler call and the `Refusal` list), `mapgen/style_runtime/` (the
  error type a styler returns), `mapgen/style_gallows/lanes.rs` (the door case only), ADR 0028 decision 6

## 7. Behaviour to preserve
- Option off: byte-identical maps, the styler's captured-legacy tests unchanged; a styler that returns a real error
  still fails generation with the same error value.

## 8. Acceptance checks
- A unit test with a made-up signature church whose door is two tiles: the attempt is refused with the new reason
  and the pipeline goes on to the next attempt (red today: the call returns `Error::Style`).
- Every attempt of seeds 1-32 with the option on, decor on and off, returns a map or a refusal, never an error.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-STYLE-REFUSE-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-STYLE-REFUSE-1`

## 10. Risk and suggested model tier
Opus. `style_runtime` is shared by five stylers; the refusal must not be reachable with the option off.

## Notes from previous attempts
