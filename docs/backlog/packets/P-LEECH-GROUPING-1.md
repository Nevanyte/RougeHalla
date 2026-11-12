# P-LEECH-GROUPING-1: the leech readability score sums its parts in legacy order

- **Serves:** not in ORDER_OF_OPERATIONS: open reviewer finding from beta-follow-up integration 1 (MIGRATION, "Open,
  found by reviewers, not acted on": `kill_augments.rs:368-369` groups its sum differently from legacy).
- **Implementer tier:** implementer (a one-line arithmetic fix with a bit-exact oracle)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 bit-exact (an existing legacy formula; build marks are compared bit for bit) · D2 n/a ·
  D5/D6/D9 none

## 1. ID and outcome
Legacy `combatReadability` computes the leech score from `cardLeech(...) + killStat(...)`, and `cardLeech` returns
`max(0, min(0.25, rows)) + max(0, farm)`: the sum is `(cards + farm) + kill`, each part clamped on its own. Rust sums
`cards + max(0, farm + kill)`. The two differ in the last bit for some inputs (2 Rot Monk stacks with 0.02 kill leech and
one leech card: 1.5000000000000002 against legacy's 1.4999999999999998), which can only change an exact top-two tie of
the overhead build marks or a Trophy roll's ranking. When this lands the Rust score equals legacy's bit for bit.

## 2. Dependencies
None.

## 3. Relevant legacy paths
- `packages/shared/src/combatReadability.ts:102` (`bonusLeech = cardLeech(...) + killStat(...)`), `:126-136`
  (`cardLeech`), `:156-159` (`killStat`: finite and positive, else 0)

## 4. New paths
None.

## 5. Exclusive write scope
- `crates/rh-sim/src/kill_augments.rs` (the leech sum in `invested_scores`)
- `crates/rh-sim/src/kill_augments/build_marks_tests.rs` (oracle)

## 6. Contracts and references
- C-NUM: legacy operation order. Build marks are public (ADR 0026, B2); the Trophy roll uses the same scores.

## 7. Behaviour to preserve
- Every case of `parity/build-marks/legacy.json` and every other score.

## 8. Acceptance checks
- `build_marks_tests::the_leech_score_groups_its_sum_as_legacy`: the score equals `((cards + farm) + kill) / 0.05` bit for
  bit over 100 combinations, at least one of which the other grouping gets wrong.
- `scripts/gate.sh` passes (full).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/kill_augments/build_marks_tests.rs` (the new test)

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib build_marks`

## 10. Risk and suggested model tier
Low: display and Trophy ranking only, last-bit differences.

## 11. Known traps
- Kill-stat leech is read as stored (legacy `killStat` drops a non-finite or non-positive value); stored kill stats are
  only ever positive gains, so the clamp is kept for exactness, not for a reachable case.

## Notes from previous attempts
None.
