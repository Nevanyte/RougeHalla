# Hand-off: P-MAPGEN-STYLE-REFUSE-1 (2026-11-13)

```
PACKET:          P-MAPGEN-STYLE-REFUSE-1 — serves ADR 0028 G5 (a failing map is discarded, never repaired) and
                 reviewer-opus note 1 on P-LAND-SENTENCED-1; signature-landmark lane, before P-MAPGEN-SIG-SCALE-2
BRANCH:          agent/opus/P-MAPGEN-STYLE-REFUSE-1 @ ed3193f39 (code; this hand-off is the commit after it). The code
                 commit is the implementer's 482f5bb7a and e7a34de1a squashed by the lane's session, because the
                 first did not compile alone; its tree is identical to e7a34de1a, the commit the gate ran on.
GATE:            PASS (full, --oracle packet/P-MAPGEN-STYLE-REFUSE-1, attempt 1/2) [skipped: Postgres suites (no
                 DATABASE_URL); CI/owner-hardware steps the gate does not run locally]
CHANGED:         crates/rh-sim/src/mapgen/pipeline/mod.rs (styler result mapping; Refusal::StyleLandmark doc)
                 crates/rh-sim/src/mapgen/pipeline/README.md (one bullet)
                 crates/rh-sim/src/mapgen/style_runtime/mod.rs (Error::Landmark doc)
                 crates/rh-sim/src/mapgen/style_gallows/lanes.rs (frame doc; the two returns -> Error::Landmark)
                 crates/rh-sim/src/mapgen/style_gallows/shape.rs, style_gallows/mod.rs (comments only)
                 crates/rh-sim/src/mapgen/style_gallows/README.md (the door sentence)
                 docs/adr/0028-signature-landmarks.md (decision 6: one sentence)
D-RULES:         D1: no legacy mechanic (new terrain behind Options::signature); option off unchanged (G8): the
                 refusal is unreachable without a Church feature (lanes::frame returns Ok(None) first). D2 n/a.
                 D5/D6/D9 untouched. No draw added, removed or reordered: the refusal returns right after the
                 styler pass, before observe(Phase::Styler) and the style contract, and later attempts re-seed.
DEVIATIONS:      none (no legacy counterpart)
SHARED RECORDS:  proposed edits: docs/backlog/README.md row P-MAPGEN-STYLE-REFUSE-1, status column ->
                 "Implemented on agent/opus/P-MAPGEN-STYLE-REFUSE-1 (full gate PASS, Postgres skipped); awaiting
                 reviewer-opus; before P-MAPGEN-SIG-SCALE-2". No DEVIATIONS.md row needed.
LEGACY DOUBTS:   none
NOT ESTABLISHED: That any real map reaches the refusal: today's church never does (seeds 1-32, option on, decor
                 off and on: 0 StyleLandmark), so the pipeline path is proven through the #[cfg(test)] seam and the
                 lanes path through a made-up zone, not end to end on a generated map. Seeds beyond 1-32 not swept
                 here. Postgres suites not run.
RISKS:           Error::Landmark is only as narrow as the stylers keep it: a future styler returning it for lack of
                 room would turn real faults into silent refusals (doc comment says never; reviewer checks).
                 The refused attempt's trace stops before Phase::Styler (brief: free, no test reads it).
```

## Implementation

`pipeline/mod.rs`, after the layers are moved back from the styler state (unchanged), the old
`result.map_err(Error::Style)?` became:

```rust
match result {
    Ok(_) => {}
    Err(style_runtime::Error::Landmark) => {
        return Ok(AttemptReport::refused(Refusal::StyleLandmark));
    }
    Err(e) => return Err(Error::Style(e)),
}
```

The `Registry::new` and `State::new` `map_err(Error::Style)` sites, the test seam and `validate_plan`'s own
`Err(Error::Feature)` (malformed plan) are untouched. `style_zones/` needed no edit.

## Tests

- Red before, green now: `pipeline::style_refusal_tests::a_landmark_refusal_from_a_styler_refuses_the_attempt_and_the_next_is_tried`,
  `mapgen_style_refusal::a_church_door_that_is_not_three_open_tiles_in_one_run_is_a_landmark_refusal`.
- Guards green: `pipeline::style_refusal_tests::a_real_styler_fault_still_fails_the_call_with_the_same_error`, the
  other four in `tests/mapgen_style_refusal.rs`, `style_gallows` lib tests (10, including
  `lanes::tests::the_door_is_exactly_three_open_tiles_in_one_run`), `tests/mapgen_land_sentenced.rs` (10 pass, 2
  ignored as before), all eight `tests/mapgen_signature_*.rs` files.
- `cargo clippy -p rh-sim --all-targets --all-features -D warnings`, `cargo fmt --check`, `scripts/gate.sh --quick`,
  then the full gate with `--oracle`: PASS. C# suite passed on the first run (no GarbageTests flake). The Unity
  step's rewrite of `NunitoRegular.asset` was restored with `git checkout`.

## git diff --stat packet/P-MAPGEN-STYLE-REFUSE-1 (code commits)

```
 crates/rh-sim/src/mapgen/pipeline/README.md      |  2 ++
 crates/rh-sim/src/mapgen/pipeline/mod.rs         | 14 +++++++++++---
 crates/rh-sim/src/mapgen/style_gallows/README.md |  3 ++-
 crates/rh-sim/src/mapgen/style_gallows/lanes.rs  |  8 ++++----
 crates/rh-sim/src/mapgen/style_gallows/mod.rs    |  4 ++--
 crates/rh-sim/src/mapgen/style_gallows/shape.rs  |  2 +-
 crates/rh-sim/src/mapgen/style_runtime/mod.rs    |  5 ++---
 docs/adr/0028-signature-landmarks.md             |  5 ++++-
 8 files changed, 28 insertions(+), 15 deletions(-)
```

Plus this hand-off file. Oracle files (`pipeline/style_refusal_tests.rs`, `tests/mapgen_style_refusal.rs`, the brief)
are unchanged against `packet/P-MAPGEN-STYLE-REFUSE-1`.

## Review and fix (land-generation session, 2026-11-13)

**reviewer-opus on `66b4528f6`: LAND WITH NOTES**, no blocking finding, two MINOR documentation notes, both applied
in `bfa5f1392` on `agent/fable/P-MAPGEN-STYLE-REFUSE-1-fix` (stacked on this branch; documentation only: the styler
runtime README now names `Error::Landmark` and its rule; two over-long lines rewrapped). **Merge the fix branch.**
The full gate ran on the code tree before the notes; after them only the quick gate with
`--oracle packet/P-MAPGEN-STYLE-REFUSE-1` was run (result in the message that hands this over).

What the review established, by reading unless marked:
- The refusal returns after the layers are moved back and before the Styler phase is observed, like the other early
  refusals; no attempt state outlives `build_attempt`; no exhaustive `match` on `pipeline::Refusal` exists in the
  workspace; the server's pool sees a refusal only as "try the next attempt". No draw moves.
- Only the styler-pass result is matched; `Error::Landmark` has exactly two producers (`lanes.rs`, the two returns
  in `frame`). Edge case, accepted: an attempt with both a door problem and a real fault reports the refusal; the
  fault still shows on attempts whose door reads.
- Option off cannot reach it. Run by the reviewer: `--lib style_refusal` 2 of 2, `--test mapgen_style_refusal` 5 of 5
  ("27 refusals (0 StyleLandmark), 0 errors" for decor off and on).
- The `#[cfg(test)]` seam cannot leak into a non-test build and masks no real path. The caveat stands: the proof is
  in two halves (a made-up church returns `Landmark`; the seam shows the pipeline refuses on it), not end to end.
- `todays_landmarks_are_never_refused_round_on_seeds_1_to_32` can be kept honestly by P-MAPGEN-SIG-SCALE-2 if its
  guards (i) and (ii) hold; its let-out for owner approval should not be needed.
- **This packet's sweep fully covers `crates/rh-sim/tests/mapgen_land_decor_attempts.rs`** (P-LAND-DECOR-ERRORS-1):
  deleting that file after this merges loses no coverage. The deletion is the coordinator's to put to the owner.

Proposed shared-record edits, beyond the backlog row above: `docs/coordination/LANDMARK_LANE_HANDOVER.md:16` still
says "no oracle" and points at `pipeline/mod.rs:422`.
