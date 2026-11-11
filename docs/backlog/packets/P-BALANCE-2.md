# P-BALANCE-2: camp-clear bench under both hitbox modes

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 11 (D2 harness, PvE half); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 outcome-class parity with a declared band · D2 this is harness evidence for DEV-009/010/011 ·
  D5/D6/D9 none

## 1. ID and outcome
The owner reports that camps take little damage in the beta, Holy heals a lot and Frost is very strong. The constants
match legacy; the live server runs Archetype hitboxes with mob spacing (DEV-009/010/011), which parity never exercises.
This packet is a verification tool: a deterministic bench in which one fighter of each faction and weapon clears each
camp kind, run under `LegacyCircle` and under `Archetypes`, reporting for each cell the ticks to clear, damage dealt
and taken, hp remaining, healing received from lifesteal, and seconds of chill/freeze applied. It changes no rule and
no number. When it lands, "camps die slower by X% for weapon W" is a measured table, and the retune packet has its input.

## 2. Dependencies
none (it reuses the headless environment; it does not need P-BALANCE-1)

## 3. Relevant legacy paths
- `packages/shared/src/constants.ts`: camp and mob multipliers the cells exercise (oracle author: cite the lines for
  the mob hp/damage multipliers and the reach multipliers from commits `31256fcd` and `73f46cdc`)
- `packages/server/bench/`: legacy benches (`farmRouteData.ts` and neighbours); read to see whether a legacy camp-clear
  bench exists. If one does, name it in the brief as the cross-check; if not, say so.

## 4. New paths
- `crates/rh-headless/src/bin/camp_bench.rs` and an optional helper directory beside it
- `crates/rh-headless/tests/camp_bench.rs`
- `tools/balance-camps/README.md` (how to run, how to read the table)

## 5. Exclusive write scope
- the new paths above only. No edits to `rh-sim`, `rh-policy`, parity fixtures, `Cargo.toml` or shared records.

## 6. Contracts and references
- C-INPUT: the fighter and every mob act only through `validate` + `Sim::submit`; no direct state edits.
- C-DET, `crates/rh-headless/AGENTS.md`: same seed and inventory give a byte-identical report; no wall clock.
- ADR 0024 (hitbox archetypes), `docs/DEVIATIONS.md` DEV-009/010/011: the two modes compared.
- Existing A/B precedent: `crates/rh-headless/examples/hitbox_compare.rs` (40 bot matches per mode).
- `LegacyCircle` is the legacy stand-in: it is parity-proven on `parity/fixtures/mob_camp` and `crowded_8`. That proof
  covers those scenarios only; the report says so.

## 7. Behaviour to preserve
- No content, tolerance or rule changes. Never tune a number to make a cell pass.
- The fighter's policy is an existing scripted `rh-policy` seat; do not write a second brain.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-BALANCE-2` passes (full).
- Tests: the inventory is complete and ordered (faction x weapon x camp kind x mode, each exactly once); two runs with
  one seed are byte-identical; a cell that never finishes is reported as truncated, not dropped; an empty report fails;
  a test-only mutated weapon number changes at least one cell (negative control); per-cell Archetypes-versus-LegacyCircle
  deltas are present for every metric; the band (+/-10%, owner-approved plan 2026-11-10) is a named constant and each
  cell outside it is listed.
- The bench exits 0 when it ran and reported, whatever the deltas: it is evidence, not a gate on today's numbers.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/camp_bench.rs`

## 9. Validation commands
- `cargo test -p rh-headless --test camp_bench`
- `cargo run --release -p rh-headless --bin camp_bench -- --seed 1` (to be created by this packet)

## 10. Risk and suggested model tier
Sonnet: one crate, a tool, no sim change. The risk is a bench that measures the scripted policy rather than the
hitboxes; the same policy and seeds in both modes control for that.

## 11. Known traps
- The oracle must fail on an assertion, not on a missing binary: the oracle author commits a stub `camp_bench` that
  prints an empty report.
- Camp kinds must come from the mob catalog (`crates/rh-sim/src/mob_catalog/`), not a hand list.
- `MobSpacing::Off` is measurement-only and the server refuses it: use it only to separate the hitbox effect from the
  spacing effect, and label those columns.
- A fighter that dies has not cleared the camp: report the death, do not divide by zero.

## Notes from previous attempts
