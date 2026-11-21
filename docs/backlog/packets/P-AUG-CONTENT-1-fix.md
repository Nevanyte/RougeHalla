# P-AUG-CONTENT-1-fix: generic guard that every changed override number is a REWORK_* registry row

- **Serves:** Augment rework (docs/agent/AUGMENT_REWORK.md step 4), follow-up to P-AUG-CONTENT-1 (int-61 review by reviewer-opus)
- **Implementer tier:** none (test-only guard packet; the guard is the whole deliverable)
- **Reviewer:** reviewer (test-only)
- **Integration base:** feature/unity-rework @ 10001a404
- **D-rules touched:** D1 n/a (no behaviour) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
`rework_overrides.rs` (header) and AUGMENT_REWORK.md step 4 say every number an override row changes against the catalog
is a `REWORK_*` row of `constants.rs`, never a bare literal; that is how the content hash covers the table
(`REWORK_OVERRIDES` is in `NON_GAMEPLAY`, `tests/content.rs`, so it is not folded). Only the 18 hand-listed cards of
`rework_content_tests.rs` enforced it. This packet adds one generic test over the whole table, so a later row (TUNE-1,
native batches) with a bare literal fails. No override, constant or other test changes.

## 2. Dependencies
Integration 61 (P-AUG-CONTENT-1) in the base. Parallel packets: P-AUG-POOL-1 (tests/content.rs, cards/tuning.rs,
constants.rs), P-AUG-TUNE-1 (rework_overrides.rs, rework_content_tests.rs): this packet touches none of those.

## 3. Relevant legacy paths
None: Rework-only content, no legacy behaviour. Catalog rows are `cards/catalog_data.rs` via `CardId::definition()`
(`cards/catalog.rs:265`). OWNER_DECISIONS: no row on this subject.

## 4. New paths
- `crates/rh-sim/src/cards/rework_guard_tests.rs` (an integration test cannot reach: `REWORK_OVERRIDES` is `pub(crate)`)

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/mod.rs`: one `#[cfg(test)] mod rework_guard_tests;` line.

## 6. Contracts and references
AUGMENT_REWORK.md step 4; `cards/rework_overrides.rs:9-11`; `cards/tuning.rs` `map_numbers` (~299, private; the guard
mirrors it with an exhaustive match, so a new row variant must be classified there) and `check_override` (~225, which
already forces equal row shape, so "added numbers" can only arise if that check is loosened; the guard covers it anyway).

## 7. Behaviour to preserve
Everything: test-only. Floats are compared bit-exactly (rows are built from the constants).

## 8. Acceptance checks
- `every_changed_override_number_is_a_rework_registry_row`: for each override row (and selections) every number that
  differs from the catalog, and every number in a row the catalog lacks or of different shape, equals (bits) an f64
  registry entry named `REWORK_*`. Passes on the current tree; also requires at least half as many looked-up numbers as
  rows, so it cannot pass looking at nothing.
- `the_guard_reports_a_bare_literal_and_accepts_a_registry_value` (non-vacuity): Machine Gun with its changed number
  replaced by bare 0.3137 is reported; the real row passes; an added row holding 0.3137 is reported and one holding a
  registry value passes. Note: 0.3 itself is a registry value (a REWORK row holds it), so the test uses 0.3137 and
  asserts no `REWORK_*` row holds it. A bare literal that equals some registered value by coincidence cannot be detected.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/rework_guard_tests.rs`

## 9. Validation commands
- `cargo test -p rh-sim --lib rework_guard -- --nocapture`
- `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Test-only, reviewer. Risk: merge-order with TUNE-1 (new rows are held to the rule on landing, intended).

## 11. Known traps
- A row changed to a value that equals some other registered `REWORK_*` value passes unnoticed.
- `src/` gets one `mod` line; the file is cfg(test) so it is not compiled into the library.
