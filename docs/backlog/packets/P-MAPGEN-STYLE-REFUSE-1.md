# P-MAPGEN-STYLE-REFUSE-1: a styler that cannot build round its landmark refuses the attempt; it does not fail generation

> **Status 2026-11-13: Ready packet, oracle committed** on `packet/P-MAPGEN-STYLE-REFUSE-1` (stub commit, then oracle
> commit; base `feature/unity-rework` @ `2e51457dd`). Red today on assertions in two tests (section 8); the rest are
> green guards. A trial of the change described in section 4 (not committed) turned every oracle test green. No
> scope change outside this brief is needed: the new refusal reaches the pipeline through `style_zones/mod.rs`
> unchanged (section 11). The oracle author corrected section 1's line number (`pipeline/mod.rs:422` was the
> `style_zones::Input` literal; the styler result is mapped at `:431` on the base, `:452` after the stub) and
> section 2's "both returns" claim (the no-dominant-sign return is unreachable today; kept in scope as a landmark
> precondition), and added sections 3, 4, 6, 9 and 11.

- **Serves:** ADR 0028 G5 ("a failing map is discarded, never repaired"); reviewer-opus note 1 on P-LAND-SENTENCED-1
  (2026-11-13); the owner's rule for the landmark requirements ("guarantees are hard: an attempt that cannot deliver
  one is discarded and the next is tried")
- **Implementer tier:** implementer-opus (rh-sim mapgen pipeline and styler runtime: shared files)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-LAND-SENTENCED-1; **before P-MAPGEN-SIG-SCALE-2**
- **D-rules touched:** D1: loose proof is not needed (no legacy mechanic; new terrain behind an option); option off
  byte- and draw-identical (G8) · no sim tick, wire, identity, content-hash or protocol change · D5/D6/D9 untouched

## 1. ID and outcome
Any styler error becomes a failed generation call: `crates/rh-sim/src/mapgen/pipeline/mod.rs:452` (`:431` on the base
`2e51457dd`) is `result.map_err(Error::Style)?`, so `build_attempt` returns `Err(pipeline::Error::Style(e))`, and
`first_attempt` (`pipeline/mod.rs` `fn first_attempt`) propagates the `Err` with `?` instead of trying the next
attempt. Since P-LAND-SENTENCED-1 the Sentenced styler returns `style_runtime::Error::Feature` when a signature
church's door does not read as three open tiles in one run (`style_gallows/lanes.rs:73-106`, `door_span` at `:63-68`).
That cannot happen on today's church (traced by reviewer-opus; a 400-seed sweep by the land-generation session; this
packet's guard sees 0 such attempts on seeds 1-32), but it is one blueprint change away, and in a live map pool a
generation error is the worst outcome: the pool stops making maps. When this lands a styler has a way to say "this
attempt cannot be built round its landmark" (`style_runtime::Error::Landmark`) that the pipeline turns into a refused
attempt (`pipeline::Refusal::StyleLandmark`, counted and reported like the others, the next attempt tried), distinct
from a real styler fault, which stays an error with the same value. The Sentenced lanes use it for the door; the other
signature-mode stylers may use it later for their own landmark preconditions (not in this packet).

**Design (oracle author's choice).** A new variant `style_runtime::Error::Landmark` of the error every styler already
returns, mapped by the pipeline to a new `Refusal::StyleLandmark`. Reasons: (a) it travels from the styler through the
registry (`style_zones/mod.rs:394-438`, every callback is `?`) to the pipeline with no edit to the registry or to the
two `lanes::frame` call sites, which already use `?`; a separate result type would need a new return type on five
stylers' `shape`/`surface`/`props` and on `Registry::apply`, i.e. `style_zones/` in scope; (b) the decision "refuse or
fail" stays in one place, the pipeline, next to the other refusals; (c) the error enum has no exhaustive `match`
anywhere in the workspace and is not serialized, hashed or part of content, so the new variant changes no map, hash or
identity. The constraint "only a landmark precondition, never 'no room'" is a rule on the stylers (doc comment on the
variant; reviewer checks), not something the type can enforce. Option off cannot reach it: `lanes::frame` returns
`Ok(None)` before any check when the zone holds no `Church`, and a `Church` feature exists only when the Landmarks
phase placed signature landmarks (`Options::signature` on a styled attempt).

## 2. Dependencies
- P-LAND-SENTENCED-1 merged (it is, on the base). The land-generation session owns `style_gallows/` and agreed
  (2026-11-13) that this packet edits it, limited to: the two `Err(Error::Feature)` returns in `lanes::frame`
  (`lanes.rs:87`, no dominant front sign, which is unreachable today because `signature::front` always returns a
  `DIR16` vector whose dominant component is non-zero; `lanes.rs:106`, `door_span` finds no three-tile door) becoming
  `Err(Error::Landmark)`, and the doc comments and README sentence that say the styler "stops with `Error::Feature`"
  / "the generation call fails". The two call sites (`shape.rs:150` `lanes::frame(&b)?`, `mod.rs:193` `validate_plan`
  `lanes::frame(c)?`) need **no code change**: `?` carries the new variant. Its conditions: `Ok(None)` without a
  `Church` stays as it is (option off); the unit test `lanes::tests::the_door_is_exactly_three_open_tiles_in_one_run`
  and its oracle (`crates/rh-sim/tests/mapgen_land_sentenced.rs`) stay green; it is told the commit.
- `validate_plan`'s own `return Err(Error::Feature)` (`style_gallows/mod.rs:254`, a malformed plan) is a real fault and
  stays `Error::Feature`; `style_gallows/tests.rs:640` pins it.
- Not on this base: `crates/rh-sim/tests/mapgen_land_decor_attempts.rs` (P-LAND-DECOR-ERRORS-1, in review) sweeps the
  option-on, decor-on attempts of seeds 1-32 for errors. This packet's sweep covers decor off and on under a different
  file and test name; the two overlap on decor on and do not conflict.

## 3. Relevant legacy paths
None. Signature landmarks are new terrain (ADR 0028); legacy has no church, no lanes and no signature option. The
legacy styler pass (`packages/shared/src/zoneStyle/`, entry `styleZones` at `styleZones.ts:42`; tests
`packages/shared/test/zoneStyle.gallows.test.ts`, `packages/shared/test/mapgen.test.ts`) is the option-off oracle, already
pinned by the captured-legacy styler tests and the option-off map hashes listed in section 7. Nothing here changes it.

## 4. New paths
- `style_runtime::Error::Landmark` (stub commit: declared, documented, never produced).
- `pipeline::Refusal::StyleLandmark` (stub commit: declared, documented, never returned).
- `Pipeline::with_style_fault(attempt, error)` and the `#[cfg(test)]` field `style_fault`, plus the `#[cfg(test)]`
  replacement of the styler result right after `self.styles.apply(..)` (`pipeline/mod.rs:441-445`): a test-only seam
  (stub commit). Production builds do not contain it. The implementer must not change what it does.
- `crates/rh-sim/src/mapgen/pipeline/style_refusal_tests.rs` (oracle) with its `#[cfg(test)] mod style_refusal_tests;`
  line in `pipeline/mod.rs` (stub).
- `crates/rh-sim/tests/mapgen_style_refusal.rs` (oracle).

The change the implementer makes (about 15 lines of code plus doc text): at `pipeline/mod.rs:452`, an
`Err(style_runtime::Error::Landmark)` from the styler pass returns `Ok(AttemptReport::refused(Refusal::StyleLandmark))`
(after the layers are moved back, as today; whether `observe(Phase::Styler, ..)` runs first is free: no test reads the
trace of a refused attempt's Styler phase); any other `Err(e)` stays `Err(Error::Style(e))`. `lanes.rs:87` and
`lanes.rs:106` return `Error::Landmark`. The two other `map_err(Error::Style)` (`Registry::new` at `:186`,
`style_runtime::State::new` at `:419`) never see `Landmark` and stay as they are. Doc text: the variant comments lose
"stub", ADR 0028 decision 6 names the new refusal, and the `style_gallows` sentences in section 5 are corrected.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/pipeline/mod.rs`: the styler-result mapping at `:452` and the doc comment of
  `Refusal::StyleLandmark` (`:86-88`). Not the test seam (`:131-133`, `:136-142`, `:187-188`, `:441-445`) nor the `mod` line.
- `crates/rh-sim/src/mapgen/pipeline/README.md`: one sentence naming the styler refusal (optional).
- `crates/rh-sim/src/mapgen/style_runtime/mod.rs`: the doc comment of `Error::Landmark` (`:68-71`). No other line of
  `style_runtime/` needs to change.
- `crates/rh-sim/src/mapgen/style_gallows/lanes.rs`: `:70-72` (doc comment of `frame`), `:87` and `:106` (the two
  returns). Nothing else in the file.
- `crates/rh-sim/src/mapgen/style_gallows/shape.rs:147-149` and `crates/rh-sim/src/mapgen/style_gallows/mod.rs:190-192`:
  comments only ("the styler stops (the generation call fails)" becomes "the attempt is refused"). No code line.
- `crates/rh-sim/src/mapgen/style_gallows/README.md:32-33`: the sentence "A church whose door does not read so stops
  the styler with `Error::Feature`".
- `docs/adr/0028-signature-landmarks.md` decision 6 (`:79-84`): one sentence naming `Refusal::StyleLandmark`.

## 6. Contracts and references
- ADR 0028 G5 (a failing map is discarded, never repaired), G6 (own streams only), G8 (option off byte-identical),
  decision 6 (refusal).
- C-PARITY: the captured-legacy styler tests stay green (option off is unchanged).
- AGENTS.md "Determinism": no draw is added, removed or reordered. A refused attempt is independent of later ones
  (each attempt seeds its main stream from `(seed, number)`, `attempt/mod.rs:157`); the oracle checks that the map
  after a refused attempt is byte for byte the map that attempt makes without the fault.
- reviewer-opus note 1 on P-LAND-SENTENCED-1 (2026-11-13); `docs/coordination/LANDMARK_LANE_HANDOVER.md` section 1.

## 7. Behaviour to preserve
- Option off: byte-identical maps, the styler's captured-legacy tests unchanged. Already pinned (not duplicated here):
  `crates/rh-sim/tests/mapgen_signature_core.rs` `g8_signature_off_is_todays_generator`,
  `crates/rh-sim/tests/mapgen_signature_scale.rs` `option_off_is_todays_generator`,
  `crates/rh-sim/tests/mapgen_land_sentenced.rs` `option_off_maps_are_todays`.
- Option on: today's church never triggers the refusal, so no seed's map moves (guard below).
- A styler that returns a real error still fails generation with the same error value: `Error::Style(e)` from the
  attempt, from `generate_styled(seed, Some(n), ..)` and from `generate_styled(seed, None, ..)`.
- `lanes::tests::the_door_is_exactly_three_open_tiles_in_one_run`, `style_gallows/tests.rs:640` (malformed plans are
  `Error::Feature`), `style_zones/tests.rs` `malformed_watchtower_refuses_before_earlier_fire_writes` and the Forge case
  (`Error::Feature` from the registry): unchanged.

## 8. Acceptance checks
Red today on an assertion (must turn green):
- `pipeline::style_refusal_tests::a_landmark_refusal_from_a_styler_refuses_the_attempt_and_the_next_is_tried`:
  option on, seed 1, decor off and on: the styler pass of the first attempt that makes a map answers `Landmark`
  (through the seam). That attempt reports `refusal: Some(StyleLandmark)` and no map; `generate_styled(1, Some(n))`
  returns `Error::AttemptRefused(Refusal::StyleLandmark)`; `generate_styled(1, None)` and `certified_styled(1)` return
  the map of the next attempt that makes one, byte for byte (JSON) as that attempt makes it without the fault. Today:
  `left: "Err(Style(Landmark))" right: "Ok(map: false, refusal: Some(StyleLandmark))"`.
- `mapgen_style_refusal::a_church_door_that_is_not_three_open_tiles_in_one_run_is_a_landmark_refusal`: a made-up
  160x160 Sentenced zone with a 13x13 church ring facing the coliseum; with a door of two tiles, four tiles, three with
  a gap, or none, decor off and on, `style_zones::Registry::apply` returns `Err(Error::Landmark)`. Today:
  `left: Err(Feature) right: Err(Landmark)`.

Green guards (must stay green):
- `mapgen_style_refusal::the_made_up_church_with_a_three_tile_door_is_built_round`: the same church with today's
  three-tile door: `Ok`, and lane rows (`FenceRow` with `FeatureJob::Lane`) are laid, so the refusal cases differ only
  in the door.
- `pipeline::style_refusal_tests::a_real_styler_fault_still_fails_the_call_with_the_same_error`: the eight other
  variants, option off and on: the attempt, the numbered call and the generation call return `Error::Style(e)` with
  the same `e`.
- `mapgen_style_refusal::with_the_option_on_every_attempt_of_seeds_1_to_32_is_a_map_or_a_refusal`: option on, decor
  off and on, every attempt up to each seed's map (at most 16): a map or a refusal, never an error; every seed makes a
  map (today: 27 refusals each, 0 errors).
- `mapgen_style_refusal::with_the_option_off_no_attempt_of_seeds_1_to_32_is_refused_round_a_landmark`: option off,
  decor off and on: no `StyleLandmark`, no error, every seed makes a map.
- `mapgen_style_refusal::todays_landmarks_are_never_refused_round_on_seeds_1_to_32`: option on, decor off and on: no
  `StyleLandmark` on any attempt. This pins today's church; a packet that changes a landmark blueprint
  (P-MAPGEN-SIG-SCALE-2) may need to change it with the owner's approval and must say so in its brief.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-STYLE-REFUSE-1` passes.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/mapgen/pipeline/style_refusal_tests.rs`
- `crates/rh-sim/tests/mapgen_style_refusal.rs`
- `docs/backlog/packets/P-MAPGEN-STYLE-REFUSE-1.md`

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"`, then with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`:
- `cargo test -p rh-sim --lib style_refusal_tests` (about 30-70 s in debug)
- `cargo test -p rh-sim --test mapgen_style_refusal` (about 80-95 s in debug)
- `cargo test -p rh-sim --lib style_gallows` and `cargo test -p rh-sim --test mapgen_land_sentenced`
- `cargo clippy -p rh-sim --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `scripts/gate.sh --quick`, then `scripts/gate.sh --oracle packet/P-MAPGEN-STYLE-REFUSE-1`

## 10. Risk and suggested model tier
Opus. `style_runtime` is shared by five stylers; the refusal must not be reachable with the option off, and must not
become a way for a styler to refuse for lack of room (that would hide real faults and move maps).

## 11. Known traps
- `style_zones/mod.rs` (the registry) is not in scope and needs no edit: every styler callback there is `?`, so the
  new variant passes through unchanged. If an implementation seems to need it, stop and report.
- Do not catch `Landmark` at `Registry::new` (`:186`) or `State::new` (`:419`); only the styler pass result (`:452`).
- The test seam replaces the styler result after the pass has run, for one attempt number, under `#[cfg(test)]` only;
  do not move it after the mapping, make it non-test, or let it touch any other attempt.
- `validate_plan`'s `Err(Error::Feature)` at `style_gallows/mod.rs:254` is a malformed plan, not a landmark
  precondition: it stays a fault.
- A test-file `const` in `rh-sim` is rejected by `crates/rh-sim/tests/content.rs` for `src/`: the oracle uses
  functions; any test the implementer adds must too.
- No draw may move: the refusal returns before anything else in the attempt draws, and later attempts re-seed.

## Notes from previous attempts
None.
