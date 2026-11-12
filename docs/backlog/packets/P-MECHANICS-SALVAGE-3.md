# P-MECHANICS-SALVAGE-3: camp-clear and Wish bookkeeping from `fix/mechanics-sim` (bruiser mirror rows, armWishes effect refresh, resetAll DoT crit memory)

- **Serves:** as [P-MECHANICS-SALVAGE-1](P-MECHANICS-SALVAGE-1.md) (owner beta-follow-up decision 1; branch triage
  2026-11-12, row `fix/mechanics-sim`)
- **Implementer tier:** implementer-opus (schedule rows, raid-start reset of hashed state)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none
- **Status:** brief ready; the oracle (section 8) remains to be written.

## 1. ID and outcome
Inventory rows #1, #3 and #4 of P-MECHANICS-SALVAGE-1 section A. No live balance effect is expected; this closes the
last `Partial` rows the branch closed:
- **Bruiser camp-clear mirror** (`bruiserPassives.update` x2, `resetRun` x2, the `campCleared` link; `Partial("P-MOBS-2")`).
  The integration branch already reads `Player.camps_cleared` for Holy's camp lifesteal and the kill-augment leech
  (P-HOLY-DEMON-BLOOD-1). Legacy reads the public mirror `PlayerState.campClears`, which equals the canonical count
  wherever the Bruiser installer runs (live: `Gates::MOB_FROST_FOUNDATION`, `bruiser: true`) and stays 0 where it does
  not. Port as the branch did, derived (`systems::bruiser::camp_clears(k, p)`: the count when `Gates::of(k).bruiser`,
  else 0), and make the two existing readers (`signatures.rs::after_damage`, `kill_augments::Readable`) go through it;
  or, if the coordinator prefers, record that the readers already equal the mirror in every installed world and flip
  the rows with a comment. Either way: no new state.
- **armWishes**: after the reset, `refreshEffects` for every player (the native refreshes the bits only when a status
  was removed, so a pending cast's bit can survive raid start). Row `abilities.armWishes` `Partial("P-ABIL-1")` -> Ported.
- **cardHooks.resetAll**: `rt.cards = undefined` also clears the DoT crit memory (`critAccDot`, `dotRollTick`,
  `dotCrit`); the native keeps `core.card_dot_crit`. Row `cardHooks.resetAll` `Partial("P-CARDS-1")` -> Ported.

## 2. Dependencies
none. Merge one at a time with P-MECHANICS-SALVAGE-2 (both edit `schedule.rs`).

## 3. Relevant legacy paths
- `packages/server/src/sim/bruiserPassives.ts:59-69` (`update`, mirror sync `:67-68`), `:101-113` (`resetRun`,
  `:107-108`), `:115-126` (install: `campCleared`, `raidStarted`, `runEnded`).
- `packages/server/src/sim/factions.ts:896` and `packages/shared/src/championPassives.ts:6-9` (the reader).
- `packages/server/src/sim/abilities.ts:84-99` (`armWishes`; `refreshEffects` at `:97`).
- `packages/server/src/sim/cardHooks.ts:75-79` (`resetAll`), `packages/server/src/sim/cardState.ts:24`, `:63-64`.
- Reference port: `git show 364c9dd0 -- crates/rh-sim/src/systems/bruiser.rs crates/rh-sim/src/systems/status/mod.rs
  crates/rh-sim/src/cards/runtime.rs crates/rh-sim/src/schedule.rs crates/rh-parity/tests/schedule.rs` and
  `git show c4913a0d -- crates/rh-sim/src/sim.rs`. **Do not** bring the branch's Holy lifesteal hunks
  (`constants.rs`, `signatures.rs`, `kill_augments*`), its `parity/holy-camp-lifesteal` capture or its content-hash
  regeneration: the integration branch has the constant already.

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/bruiser.rs`, `crates/rh-sim/src/systems/status/mod.rs`, `crates/rh-sim/src/cards/runtime.rs`
- `crates/rh-sim/src/schedule.rs` (the seven rows named above), `crates/rh-parity/tests/schedule.rs`
- if the mirror is made the readers' input: `crates/rh-sim/src/systems/signatures.rs` (`after_damage` Holy term),
  `crates/rh-sim/src/kill_augments.rs` (`Readable::of`), `crates/rh-sim/src/sim.rs` (accessor), and their callers in
  `crates/rh-server` (cross-crate: then `reviewer-opus` treats it as such)

No `content!` constant, no content hash move, no new serialized state.

## 6. Contracts and references
C-TICK (rows flip in place, no reordering; `crates/rh-parity/tests/schedule.rs` against
`parity/schedule/legacy_schedule.json`); `tests/hash_coverage.rs` (no new leaf).

## 7. Behaviour to preserve
- Live Holy lifesteal and kill-augment leech numbers (the mirror equals the count in every live world).
- Parity report all MATCH; `parity/abilities` base cases (`wishReadyAt`/`wishFullAt`/`effects` on the birth frame).

## 8. Acceptance checks (the oracle to write)
- **Mirror without the installer**: a Holy player with `camps_cleared = 3` in a world whose `Gates::of(k).bruiser` is
  false gains no camp lifesteal (legacy mirror 0, `bruiserPassives.ts:115`); with the installer, 3 x 0.005 = 0.015 extra
  lifesteal share (the existing `holy_demon_blood_tests` cover the installed case).
- **armWishes refresh**: a player with a pending cast at raid start has no cast effect bit after `raidStarted`
  (`abilities.ts:91`, `:97`).
- **resetAll**: a player with a DoT crit memory (`core.card_dot_crit` set) has none after `raidStarted`
  (`cardHooks.ts:76`).
- `what_the_slice_has_ported_stays_ported` updated for the flipped rows; `scripts/gate.sh --oracle
  packet/P-MECHANICS-SALVAGE-3`.

## 10. Risk and suggested model tier
Opus: schedule-table ownership checks and raid-start resets of hashed state; small code.

## 11. Known traps
- The practice console's clear (`systems/training/console.rs::clear`) does not zero `campsCleared`/`campContrib` as
  legacy `trainClear` does (found by the branch, unreachable today): out of scope, note only.
- `partial_link` may become unused once the last partial link flips (the branch added `#[allow(dead_code)]`).

## Notes from previous attempts
