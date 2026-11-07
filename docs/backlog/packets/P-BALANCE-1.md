# P-BALANCE-1: Rust duel/matrix balance harness

Status: **Draft packet, not yet reviewed or scheduled.** Proposed 2026-11-07 from the deviation-ledger review
([../../DEVIATIONS.md](../../DEVIATIONS.md), open question 2).

## ID and outcome

Port the legacy weapon-edge duel harness to Rust so that balance-affecting changes, and any `balance` entry in
`docs/DEVIATIONS.md`, can be re-validated against the designed counter loop. The harness is **information plus a
threshold verdict**; it never changes a weapon, faction or content number. This is a verification tool, not a gameplay
port, and it is allowed to run only the mechanics the Rust sim already implements.

Why it matters: the parity suite proves the Rust sim matches captured legacy traces. It does not prove the *game-level*
balance properties (each weapon beats exactly two others; no faction collapses an edge). A declared intentional
deviation or an unmatchable card/mob re-tune would otherwise be a change nobody can re-validate.

## Dependencies

- `rh-headless` Env, bot/policy seats and the recorder (exist).
- Combat, status and the five base factions as already integrated (P-COMBAT-1/3, P-FACTION-1 are reported integrated
  in the backlog). Weapons or mechanics not yet ported (cards, mobs, full abilities) are **out of the first cut**;
  report which cells are skipped and why rather than faking them.
- Legacy numbers come from the frozen source via the existing capture tooling (P-CAPTURE-1), not from memory.

## Relevant legacy paths (verified to exist)

- `packages/server/src/harness/duel.ts`: one headless duel on a hand-built arena; two in-process clients using the same
  policies as mobs; melee rewound at render time.
- `packages/server/src/harness/matrix.ts`: every `WEAPON_BEATS` edge x faction mirror x setups; styles (`stand`,
  `strafe`, `kite`, `weave`, `jink`, `post`, `orbwalk`, `lock`); `WATCH` edges.
- `packages/server/src/harness/report.ts`: verdicts. An edge **holds** when pooled win rate `>= 0.6` (`HOLD_OVERALL`),
  the worst faction `>= 0.5` (`HOLD_FACTION`) and every style reply `>= 0.5` (`HOLD_REPLY`).
- `packages/server/src/harness/{kiting,zoneDuel,factionCycle,runHarness}.ts`: later passes; **later cuts**, not this one.
- `packages/shared/src/weapons.ts`: `WEAPON_BEATS` (ten edges), `SIGNATURE_WEAPONS`.
- Rust-side starting points: `crates/rh-headless/src/{lib,main}.rs`, `crates/rh-policy`, `crates/rh-sim`.

## Scope of the first cut

1. A Rust binary (suggested `crates/rh-headless/src/bin/balance_matrix.rs`) that runs the main pass: every
   `WEAPON_BEATS` edge x faction mirror x the legacy setup grid (`Setup`: distance, per-fighter delay ticks, angle) in an
   open arena, `stand` style only.
2. The same verdict rule and thresholds as `verdictOf`, copied as named constants with a comment pointing at the legacy
   line, plus per-edge pooled win rate, worst faction, and HP-remaining of winners.
3. A JSON report, versioned, with the exact ordered inventory (edge, faction, setup) and per-duel result, so two runs
   can be diffed.
4. **Differential check against legacy:** run the legacy `runHarness` main pass at the pinned baseline, capture its
   per-cell win rates, and compare Rust cell by cell. The tolerance is a stated number per cell chosen *before* the first
   comparison; exact equality is expected where the underlying parity scenarios already match. Any larger difference is
   reported as a candidate deviation for the ledger, not hidden.
5. Style grids (`strafe`, `kite`, `weave`, `jink`), `lock`, kiting, zone duels, faction cycle and quest bench are
   **follow-up cuts**, each listed with their blocking mechanics.

## Behaviour to preserve

- Determinism (C-DET): same seed and inventory give byte-identical report. No wall clock, no entropy outside the seeded
  stream.
- C-INPUT: both duel clients act only through `validate` + `Sim::submit`. No direct state edits to win a cell.
- The harness changes no content and no tolerance. Never tune a number to make a verdict pass.
- Policies are the existing `rh-policy` seats; do not write a second brain.

## Exclusive write scope (proposed)

`crates/rh-headless/src/bin/balance_matrix.rs`, optional helper module directory beside it,
`crates/rh-headless/tests/balance_matrix.rs`, `tools/balance/**` (comparison script, README, small synthetic
evidence). No edits to `rh-sim`, parity fixtures, shared status records or `Cargo.lock` (coordinator-owned).

## Acceptance checks

- Command to run the matrix and the legacy comparison are documented and reproduce.
- Negative controls: a mutated weapon number (test-only) flips at least one edge verdict; a truncated inventory, a
  duplicate cell and an unknown edge each fail nonzero.
- A zero-duel or empty report fails; two empty reports do not compare equal.
- The report lists every skipped cell with the missing mechanic, so "all edges hold" cannot be read as full coverage.
- The legacy comparison output is attached, with the pre-chosen tolerance and every cell outside it listed.
- `cargo fmt --all --check`, `cargo clippy -p rh-headless --all-targets --all-features -- -D warnings`,
  `cargo test -p rh-headless`, `cargo run -p rh-parity --bin parity-report` unchanged and passing.

## Open questions for the owner

1. Are the legacy thresholds (0.6 / 0.5 / 0.5) still the design's intended bar, or should the ledger record new ones?
   The packet copies them as-is.
2. Should a `balance` ledger entry be blocked from merging unless this harness has run, or only reported? Recommended:
   blocked.
3. Which follow-up cut comes second: style grids, or the faction cycle? Not decided here.

## Not claimed

This packet does not establish full-game balance, card or mob balance, or any statement about weapons beyond what the
first cut runs. Its result is a threshold verdict on a defined inventory, nothing more.
