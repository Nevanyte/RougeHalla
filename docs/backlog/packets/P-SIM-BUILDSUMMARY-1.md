# P-SIM-BUILDSUMMARY-1: the server computes the legacy GAINED strip values

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: HUD presents the legacy
  information)
- **Implementer tier:** implementer-opus
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 byte-exact against a legacy capture (displayed numbers the player reads) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy's top-left GAINED strip shows nine values for the player's own build: +Offense, +SO, damage %, attack speed %,
life steal %, +health above baseline, +/-Defense, +/-Soul Defense and move speed %, plus a "Mob bonuses" row listing
farmed stats. The legacy client computed them from the synced build. Unity may not recompute combat numbers, and the
Rust sim has the ingredients but no assembled summary, so farmed stats never appear in the Unity strip. This packet adds
a pure, read-only function in `rh-sim` that returns those values for one player and proves it against legacy. It adds no
state and no observation or wire field: publication is a later wire-17 packet. The bottom-left champion panel numbers
are a sibling packet (P-SIM-BUILDSUMMARY-2).

## 2. Dependencies
- P-HOLY-DEMON-BLOOD-1 merged (the life steal value includes Holy's camp term in legacy,
  `packages/client/src/ui/buildModel.ts:74`)

## 3. Relevant legacy paths
- `packages/client/src/ui/buildModel.ts`: `buildGains` and the mob-bonus rows (survey: `:153-179`; oracle author: verify
  and cite each of the nine formulas)
- `packages/client/src/ui/buildHud.ts`: labels, order and number formatting (survey: `:54`)

## 4. New paths
- `crates/rh-sim/src/build_summary.rs`
- `tools/build-summary-fixtures/` (capture script driving the legacy functions, README)
- a capture under `parity/` and its test under `crates/rh-parity/tests/`

## 5. Exclusive write scope
- the new paths above
- `crates/rh-sim/src/lib.rs` (the `mod` line only)

## 6. Contracts and references
- R-AUTH: Rust decides every number the HUD shows about a build.
- C-OBS: the summary is owner-only when it is published; this packet publishes nothing.
- C-NUM: f64, legacy operation order, `crate::math` for transcendentals.
- `crates/rh-sim/AGENTS.md`: pure, no allocation in the tick path (this function runs outside the tick; state that and
  keep it allocation-free if the wire packet will call it per snapshot).
- Existing ingredients: `Runtime::mirrors()` (`crates/rh-sim/src/modifiers/mod.rs:117`), `hit_mult()` (`:139`),
  `content::attack_interval` (`crates/rh-sim/src/content.rs:309`), `Farm::count` and `reward_of`
  (`crates/rh-sim/src/modifiers/farm.rs`), `lifesteal_total` (`crates/rh-sim/src/status_runtime/stats.rs`).

## 7. Behaviour to preserve
- No schedule row, state field, RNG draw, observation field or wire byte changes: state hash, checkpoint 31, replay 25,
  observation 24 and the content hash are unchanged.
- Existing parity report: all MATCH.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-SIM-BUILDSUMMARY-1` passes (full).
- Parity test: for the captured build matrix (each faction; no build, cards only, farmed stats only, chest boosts only,
  mixed; a Holy player with camp clears) the nine values and the mob-bonus rows equal legacy within the parity policy.
- A build with nothing gained returns all zeros and no rows.

## Oracle files (read-only for implementers)
- the capture and its parity test (listed by the oracle author in this section on `packet/P-SIM-BUILDSUMMARY-1`)

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes`
- `cargo test -p rh-parity`
- `tools/build-summary-fixtures/capture.sh --check` (to be created by this packet)

## 10. Risk and suggested model tier
Opus. "Life steal gained" and "damage gained" have no Rust equivalent today (only the combat total exists), and legacy
computes them client-side, so the capture must drive the legacy functions directly. Riskiest value: damage % from
unconditional rows only.

## 11. Known traps
- Legacy rounds for display in `buildHud.ts`; compare unrounded values and leave formatting to the client packet.
- "+health above baseline" is `max_hp - faction.hp`, not current hp.
- hp-dependent values (Holy leech) change every tick: return the raw value; quantization is the wire packet's choice.
- Chest boosts, cards and farmed stats can each move the same mirror: use the fold's own totals, do not re-add rows.

## Notes from previous attempts
