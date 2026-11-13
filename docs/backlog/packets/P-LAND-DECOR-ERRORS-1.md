# P-LAND-DECOR-ERRORS-1: with landmarks and decor on, no attempt of seeds 1-32 stops with a generation error

- **Serves:** reviewer-opus note 2 from the landmark lane's coordinator's review pass on P-LAND-SENTENCED-1
  (2026-11-13, LAND WITH NOTES): "a gate test in your lane (a new file, not the oracle) that runs every attempt of
  seeds 1-32 with decor on and fails on any generation error: today only the landing attempt of seeds 1-8 is checked
  with decor". Lane: `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 3 (land generation).
- **Implementer:** none. The packet is one guard test, written by the land-generation lane's main session; it passes
  on the tree it is written on and is expected to stay green.
- **Reviewer:** the coordinator's merge review.
- **Integration base:** `feature/unity-rework` @ `2e51457dd` (the lanes and P-MAPGEN-SIG-SCALE-1 merged). Written on
  `agent/fable/P-LAND-SENTENCED-1-fix` @ `ca598cf01`, then rebased and gated on the merged tree.
- **D-rules touched:** none. A test only: no map, sim, wire, save, state-hash or content-hash change.

## 1. ID and outcome
A new test file, `crates/rh-sim/tests/mapgen_land_decor_attempts.rs`, with one test:
`no_attempt_of_seeds_1_to_32_stops_with_a_generation_error_with_decor_on`. With `pipeline::Options::signature` on and
decor on (the generator's default; the server's pool runs with decor off), it runs every attempt of seeds 1 to 32 up to the one that makes
the map and fails if any attempt returns `Err`, or if a seed makes no map within 16 attempts. A refused attempt is
legal.

Why it is needed: each styler's `props` step runs only with decor, and in signature mode the Sentenced `validate_plan`
reads the church's door again there (P-LAND-SENTENCED-1-fix: a church whose door does not read as three open tiles in
one run is `Error::Feature`). The lane's other tests run with decor only on the landing attempt of seeds 1 to 8, so
attempts that are refused afterwards, and seeds 9 to 32, never exercised that path. A styler `Err` fails the whole
generation call. No production caller runs the generator with decor on and the landmark option today
(`StyledMaker::options` in `crates/rh-server/src/map_pool.rs` sets `decor: false`), so this is a guard on the
generator's default path, for the tools and tests that use it and for any later caller, not on a live room's map.
(Corrected 2026-11-13 after the coordinator's review: an earlier wording said the server's pool uses decor.)

## 2. Dependencies
P-LAND-SENTENCED-1 with P-LAND-SENTENCED-1-fix (the strict door). P-MAPGEN-STYLE-REFUSE-1 (the landmark lane's,
planned) turns a styler error into a refused attempt; this test still holds then and still catches every other `Err`.

## 3. Relevant legacy paths (verified with `rg`)
- none (a property of the Rust generator under an option legacy does not have)

## 4. New paths
- `crates/rh-sim/tests/mapgen_land_decor_attempts.rs`
- this brief

## 5. Exclusive write scope
- the two new paths

## 6. Contracts and references
- ADR 0028 G1 (a guarantee is kept or the map is not made); `docs/backlog/packets/P-LAND-SENTENCED-1-fix.md` section
  11, first trap (a styler error is not a refused attempt).

## 7. Behaviour to preserve
- Everything: no source file changes.

## 8. Acceptance checks
- The new test passes; the full gate passes on the integration branch after the rebase.
- The test pins no map, hash, attempt number or refusal count, so landmark packets that move option-on maps do not
  turn it red unless an attempt errors or a seed stops landing within 16 attempts.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_decor_attempts -- --nocapture`
- `scripts/gate.sh`

## 10. Risk and suggested model tier
Low. Cost: one more generator sweep in the rh-sim suite (section 11 gives the measured time).

## 11. Known traps
- The attempt limit of 16 is the sweep's own bound, not a rule on the generator; the lanes oracle bounds the worst
  accepted attempt at 8, and with the fixed cave merged the worst is 4 (coordinator's figure, 2026-11-13).
- **Measured** on `ca598cf01` (debug build, macOS arm64, machine shared with other builds): 41 attempts over seeds
  1 to 32, 9 refused, no error, every seed made; the test took 46.6 s. A temporary sweep of the same shape on the same
  commit (not committed) ran seeds 1 to 64 with decor (101 attempts) and seeds 1 to 400 without (709 attempts) with no
  error. On the merged tree (`2e51457dd`, the fixed cave): 59 attempts, 27 refused, no error, every seed made; 29.8 s
  in the full gate. The figures move with every landmark packet; the test prints its own line under `--nocapture`.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_decor_attempts.rs`, this brief
