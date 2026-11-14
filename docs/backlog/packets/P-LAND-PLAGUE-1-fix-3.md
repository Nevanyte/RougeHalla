# P-LAND-PLAGUE-1-fix-3: the Plague amounts on the larger bog tree (owner decision)

- **Serves:** owner decision 2026-11-13, night, in the land-generation session's chat. The question as put, with the
  measurements below and worded so that "yes" accepts: "Count the tree's marsh as bog, with a floor of 80% of today's
  for marsh plus pools together and 35% for pools alone. Lower the barrow floor to 55%, since the zone is a fifth
  smaller." The owner answered **"Yes to both"** (the other question was the Sentenced lane-fence floor,
  P-MAPGEN-SIG-SCALE-2).
- **Implementer:** none. The packet amends two bounds of the Plague oracle and adds one test; no generator code
  changes. Written by the lane's main session.
- **Reviewer:** the coordinator's merge review (the stack's code was reviewed by reviewer-opus: P-LAND-PLAGUE-1 LAND
  WITH NOTES, P-LAND-PLAGUE-1-fix LAND WITH NOTES, P-LAND-PLAGUE-1-fix-2 LAND).
- **Integration base:** `feature/unity-rework` @ `42ce9a72f` (the blueprint bog tree, P-MAPGEN-SIG-SCALE-3, merged);
  stacked on `agent/opus/P-LAND-PLAGUE-1-fix-2` @ `19592a87e`.
- **D-rules touched:** D1: the numbers are the owner's (numbers are targets; guarantees are hard). No map, sim, wire,
  save, state-hash or content-hash change.

## 1. ID and outcome
The pools were tuned and bounded on today's small tree. On the 29 x 29 blueprint tree every hard guarantee holds on
seeds 1-96, and two amount tests fail because the tree and its apron take about a fifth of the zone's free ground and
because the tree's own marsh (213 tiles, `BogTree`-owned) was not counted as bog:

| Seeds 1-96, median map | option off (today) | pools on the blueprint tree |
|---|---|---|
| Styler (pool) bog tiles | 341 | 113.5 |
| Tree's own marsh tiles | 0 | 213 |
| Pool bog share of free ground, on over off | | 0.44 (0.51 on seeds 1-32) |
| Barrows, total | 1198 | 725 (61%; 228 of 397 on seeds 1-32) |
| Free ground of the zone | 4446 | 3592.5 |

The owner accepted, and the oracle now holds:
- **Marsh plus pools:** the median over seeds 1-32 of (tree bog + styler bog tiles, option on) / (styler bog tiles,
  option off) is at least 0.8 (`bog_share_of_free_ground_stays_within_a_fifth_of_todays`, name kept; a ceiling of 1.5
  is this lane's guard against runaway bog, not an owner figure).
- **Pools alone:** the median of the pools' share ratio (the old measure) is at least 0.35
  (`pool_bog_alone_keeps_a_third_of_todays_share`, new).
- **Barrows:** at least 55% of option off over seeds 1-32 (`barrow_share_min`, was 70).

## 2. Dependencies
P-MAPGEN-SIG-SCALE-3 (merged). The Plague stack: P-LAND-PLAGUE-1, P-LAND-PLAGUE-1-fix, P-LAND-PLAGUE-1-fix-2.

## 3. Relevant legacy paths (verified with `rg`)
- none (signature mode has no legacy counterpart; legacy's barrows carry a crescent each, see P-LAND-PLAGUE-1)

## 4. New paths
- this brief

## 5. Exclusive write scope
- `crates/rh-sim/tests/mapgen_land_plague.rs` (the three items of section 1 and their doc comments)
- `crates/rh-mapdress/tests/anchor.rs` `NO_ANCHOR_GOLDEN` and `crates/rh-mapdress/tests/marsh.rs` `SIG_GOLDEN`
  (constants only, one separate commit `P-LAND-PLAGUE-1-fix-3 re-pin:`; the stack's earlier re-pin was dropped when it
  was replayed onto the tree)
- this brief; the stack's hand-off

## 6. Contracts and references
- `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 3 "Plague" and its addenda; the owner's rule that
  numbers are targets and go back to the owner with the measurement.

## 7. Behaviour to preserve
- Every map, option on and off. The 23 guarantee tests of the Plague oracle (seeds 1-32 and 33-96), unchanged.

## 8. Acceptance checks
- `mapgen_land_plague`: all tests pass on the blueprint tree; the full gate passes.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_plague`
- `scripts/gate.sh --oracle packet/P-LAND-PLAGUE-1-fix-3`

## 10. Risk and suggested model tier
None to the generator. The bounds are loose where the owner set them: the pools' own share may drift between 0.35 and
today's 0.51 without a red test.

## 11. Known traps
- "Large near the tree" is now carried by the tree's own marsh: with the box filling the near band, one free pool in 32
  maps lies near the tree. The size-by-band tests pass and are close to vacuous there; they are not changed.
- The ceiling of 1.5 on marsh plus pools was not put to the owner.
- Not established: seeds beyond 96; the amounts with the other landmarks at their final sizes (the church box changes
  which attempts are accepted, so every Plague map moves again).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_plague.rs`, this brief, and the three earlier Plague briefs.
