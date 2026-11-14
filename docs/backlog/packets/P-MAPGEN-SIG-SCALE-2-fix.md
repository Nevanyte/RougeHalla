# P-MAPGEN-SIG-SCALE-2-fix: the Sentenced fence amounts with the larger church (owner decision)

- **Serves:** owner decision 2026-11-13, night, in the land-generation session's chat. The question as put, with the
  measurements below and worded so that "yes" accepts: "Judge the zone on lanes plus churchyard fence together, with a
  floor of 75% for the two combined and 45% for the lanes alone." The owner answered **"Yes to both"** (the other
  question was the Plague amounts, P-LAND-PLAGUE-1-fix-3).
- **Implementer:** none. Two bounds of the lanes oracle; no generator code changes. Written by the lane's main session.
- **Reviewer:** the coordinator's merge review (the church's code: reviewer-opus on P-MAPGEN-SIG-SCALE-2).
- **Integration base:** `feature/unity-rework` @ `42ce9a72f`; stacked on `agent/opus/P-MAPGEN-SIG-SCALE-2` @ `c0ff93019`.
- **D-rules touched:** D1: the numbers are the owner's. No map, sim, wire, save, state-hash or content-hash change.

## 1. ID and outcome
With the 29 x 29 church, graveyard and churchyard, the box and its 2-tile apron take ground the Sentenced lanes cannot
use, and the lanes' own fence share fell under the floor agreed for the small church:

| Seeds 1-32 | measured on the built church | floor |
|---|---|---|
| Lane fence share of free ground, option on over option off, median (per seed 0.31 to 0.72) | 0.532 | 0.45 (was 0.6) |
| (Lane fence + churchyard and plot fence tiles, on) / (lane fence tiles, off), median (per seed 0.60 to 1.05) | 0.820 | 0.75 (new) |
| Every seed, lane fence share ratio | at least 0.31 | 0.3 (unchanged) |

The drawing's own fence is 106 LOW tiles (74 on the churchyard's outer rows, 32 round the plots), owned by the
`Graveyard` feature; `crates/rh-sim/tests/mapgen_land_sentenced.rs` did not count it.
- `budget()` lower bound 0.6 -> 0.45 (`lane_fence_share_stays_near_option_off`).
- New `combined_floor()` 0.75 and test `lane_and_churchyard_fence_together_stay_near_option_off`.

## 2. Dependencies
P-MAPGEN-SIG-SCALE-2 (the church). P-LAND-SENTENCED-1 (the lanes, merged).

## 3. Relevant legacy paths (verified with `rg`)
- none (legacy has no church; option off keeps legacy's fence rows)

## 4. New paths
- this brief

## 5. Exclusive write scope
- `crates/rh-sim/tests/mapgen_land_sentenced.rs` (the two bounds, the new test, their doc comments); this brief; the
  church's hand-off

## 6. Contracts and references
- `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` and its addenda (Sentenced: fence amount about today's); the
  owner's rule that numbers are targets and go back to the owner with the measurement.

## 7. Behaviour to preserve
- Every map. The other nine tests of the lanes oracle, unchanged.

## 8. Acceptance checks
- `mapgen_land_sentenced`: 11 pass on the built church; the full gate passes.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_sentenced`
- `scripts/gate.sh --oracle packet/P-MAPGEN-SIG-SCALE-2-fix`

## 10. Risk and suggested model tier
None to the generator. The per-seed floor (0.3) is close: the lowest seed measures 0.31.

## 11. Known traps
- The combined test only means something on maps with the blueprint church: on the small rule-drawn church the
  `Graveyard` owns no LOW tile and the combined figure is the lanes alone. It lands with the church, not before it.
- Not established: seeds beyond 32; the amounts once the other landmarks reach their final sizes.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_sentenced.rs`, this brief.
