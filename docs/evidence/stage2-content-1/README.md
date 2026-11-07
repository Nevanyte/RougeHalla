# P-CONTENT-1: the five Wishes as definition rows and one verb interpreter

## 0. Revisions

- Base: `856618eb` (`origin/optimization_port`), the five-Wish casting checkpoint.
- Toolchain: `cargo 1.97.0`; no container needed (no new sources).

## 1. Outcome

Section 6A of the completion prompt: content is data. The five Wishes stop being hand-written `match` arms and per-ability
constants read by bespoke code. Each becomes a typed definition row (numbers, targeting, cancel rules, slot, ordered effect
steps); one exhaustive verb interpreter executes every step; Wish/Q/E share the generic slot path. A sixth, test-only
ability made purely of existing verbs proves that new content needs only a table row.

**Hard constraint:** byte-identical. Every ability parity scenario, per-tick state hash, event, checkpoint, replay and
content-visible behaviour is unchanged; `content_hash` and `CHECKPOINT_VERSION` stay put.

## 2. Legacy paths

`packages/shared/src/abilities.ts` (`AbilityDef`/`AbilityRank`/`AbilityEffect` and `effectSide`), the Wish rank rows and
constants, and `packages/server/src/sim/abilities.ts` (the one cast pipeline and its verb switch).

## 3. Write scope

`crates/rh-sim/src/abilities/mod.rs` (rows, verbs, slot lookup), `systems/abilities/effects.rs` (the interpreter),
`systems/abilities/mod.rs` (generic slot path), `content.rs` (registration if needed), ability tests, `docs/evidence/
stage2-content-1/README.md`, the ledger.

## 4. Contracts

- C-TICK: the self pass then target pass stay in the same place and order.
- C-DET/C-PARITY: hashes and captured frames unchanged; the packet proves it with a per-tick hash tape and the existing
  source tests.
- C-OBS: no new visible field; ability ids already travel in cast/field events.
- Data rule: no system branches on `AbilityId` for behaviour; ids are table keys.

## 5. Behaviour to preserve

The five Wishes' exact verbs and numbers: Freeze (target stun 1250 ms), Swarm (self hidden 8 s + cloud 72 u), Trial
(zone with convicted radius, zoned payload, field removal on refusal), Blaze (blink + trail), Last Stand (death floor +
haste, taken reset on a fresh instance).

## 6. Acceptance checks

(TBD)

## 7. Commands

(TBD)

## 8. Traps

- The self/target split is by effect side, not by ability; the interpreter must keep the two passes and their order.
- Trial's field is removed when the zoned status is refused; the zone verb must express that, not a special case.
- `content_hash` must not move: the registered constants stay the single source of the numbers.
