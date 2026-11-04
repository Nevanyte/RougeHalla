# P-COMBAT-1: items and the other melee weapons

## ID and outcome
P-COMBAT-1. A player can pick up, swap and drop the five loop weapons (sword, bow, wand, shield, axe) and fight with the four
melee ones (sword, shield, axe, plus fists already done) with legacy-identical results: pickup/swap/drop rules, sword
stagger, shield block + riposte, axe shred, the `weaponSpecials` flag, and a weapon rack for tests. Ranged weapons (bow,
wand) are only *carried* here; their shots are P-COMBAT-2.

## Dependencies
Soft: P-CAPTURE-1 (scenario helpers). None hard. Merge before P-COMBAT-2 touches the same `WeaponRt`/`Player` fields.

## Relevant legacy paths (verified)
- `packages/server/src/sim/loot.ts`: `handlePickup` (l.136), `dropBody` (l.183), `addContainer`, `dropWeapon`, `holdBirth`/`bornThisTick`.
- `packages/server/src/sim/weapons.ts`: `handleSwap` (l.155), `weaponChanged`, `cancelAction`, `stagger`, `setLock`/`dropLock`.
- `packages/server/src/sim/melee.ts`: `resolveMelee`, `land` (shield front test, block share, riposte), `meetBalls` (P-COMBAT-2).
- `packages/shared/src/weapons.ts` (`WEAPONS`, `scalingDamage`, specials), `interactions.ts` (`shieldOutcome`, `staggers`, `swapReadyAt`, `swapAllowed`), `constants.ts` (l.296-390).
- Tests to read: `packages/server/test/weapons.test.ts`, `swapRule.test.ts`, `melee.test.ts`, `loot.test.ts`, `fists.test.ts`.

## New paths
- `crates/rh-sim/src/items.rs` (containers, pickup, swap, drop; keeps `sim.rs` hooks minimal).
- `crates/rh-sim/src/weapons.rs` only if `sim.rs` weapon code is moved; otherwise extend in place (do not refactor the ported fists path).
- `parity/legacy-capture/capture.ts` scenarios (see Acceptance); `parity/fixtures/*.json` outputs.
- `crates/rh-parity/tests/parity.rs`: no new test needed if scenarios are `parity: "slice"` (the harness loops over every fixture).

## Exclusive write scope
`crates/rh-sim/src/{items.rs,sim.rs,content.rs,constants.rs,lib.rs}`, `crates/rh-sim/tests/`, `crates/rh-parity/**`,
`parity/legacy-capture/capture.ts` (scenario additions only), `parity/fixtures/`. Protocol/observation fields for weapons are
**not** in scope unless the coordinator allocates the protocol shared files to this packet (see backlog README "Shared-file rule").

## Contracts and references
C-TICK (weapons phase position), C-INPUT (new `swap`/`pickup` commands go through `validate` + the order budget and count in the
6 actions per tick), C-PARITY, C-DET (state hash must include new state), C-OBS (carried weapons of others are public:
`ActorView.weapon` already exists; ground items need a deliberate observation decision). ADR 0007. `docs/GAME_DESIGN.md` section 9.

## Behaviour to preserve
- Weapon numbers already in `content.rs`: sword reach 112 / half-arc pi/4 / boost 1.15 / floor 0.25 / dpsMult 0.75; shield reach 96 / pi/3 / 0.6 / 0.3 / 0.75; axe 112 / pi/2 / 0.4 / 0.35 / 0.77; fists 72 / pi/3 / 1.5 / 0.2 / 0.6. Player melee windup is 0 for every melee weapon, the axe included (`weaponTimings(..., "player")` in `shared/src/weapons.ts` returns early for a non-ranged weapon; `AXE_WINDUP` 0.25 s / `AXE_ROOT` 0 are the NPC/mob profile, P-MOBS-1), which is what Rust `player_timings` does. Keep it; an axe capture proves it.
- Swap: `swapAllowed(hand, target, secondLocked)`; the slot changes, the current action is cancelled, `readyAt = max(readyAt, now) + SWAP_SECONDS (0.25 s) * 1000`; a swap to an empty slot is allowed (it is fists); a swap between two empty slots does nothing; blocked while stunned or casting (stun/cast are P-STATUS-1: gate with a TODO test). `dropLock` unless the new weapon is a wand (locks arrive in P-COMBAT-3).
- Pickup: only the exact container id sent; within `INTERACT_RANGE` 56 u of the **server** position, with a clear line on the **move** mask (`hasLineOfSight(..., MASK_MOVE)`, "Can't reach that" across a fence); a container born this tick is "Nothing there" (`bornThisTick`/`holdBirth`: a chest born in a ledger pass is first pickable two ticks on). Weapon goes into the hand's slot if empty (arms at once via `weaponChanged`), else the other slot if free (hand stays), else replaces the hand's weapon, which drops as a ground container at the player. Fists are never an item; picking up `fists` is refused.
- Ground containers vanish when emptied; bodies and chests stay as empty props. `dropBody` leaves a body with the carried weapons (and potions, P-CONS-1) where the player went down and clears both slots.
- Sword stagger: an unblocked sword hit staggers (cancels a pending windup or cast, then `STAGGER_IMMUNITY_SECONDS` 1.1 s immunity; a bow draw is not interrupted). The Rust slice already has `Event::Stagger` and `stagger_immune_until`: confirm it against a captured sword fight rather than assuming it is complete.
- Shield: a raised shield (always up while in hand) blocks a **frontal** sword or bash hit (`angleBetween(atan2(...), facing) <= SHIELD_HALF_ARC + 1e-9`, 60 degrees): `SHIELD_BLOCK_SHARE` 0.07 of the hit is stopped, 0.93 lands and never staggers; the riposte returns `RIPOSTE_SHARE` 0.5 of the **blocked part** (`raw * 0.07 * 0.5`) to the attacker as a `passive` hit with weapon `shield`. Fists pierce shields (`shieldOutcome`).
- Axe shred: each axe hit takes `AXE_SHRED_ARMOR` 3 off the target for `AXE_SHRED_MS` 3000, summing to `AXE_SHRED_CAP` 6 (a negative armor bonus; total armor stops at 0; a weapon never scales with a debuff). Wand splash is P-COMBAT-2.
- `SimConfig.weaponSpecials: false` leaves every weapon with its damage alone (legacy flag used by the faction parity harness): add the same flag.
- Doc/code note: docs/legacy/CLAUDE_LEGACY.md says sword/bash windup 0.1 s; the code has `SWORD_WINDUP`/`BASH_WINDUP` 0.1 for the NPC profile and 0 for players. Code wins.

## Acceptance checks
1. New capture scenarios (all `parity: "slice"`; add `weapon0`/`weapon1` to the Rust `Placement` so the harness sets them like `capture.ts` does with `s.weapon0`): `sword_vs_fists`, `shield_block_riposte`, `axe_shred_stack`, `sword_stagger_cancel`, `swap_cooldown`, `pickup_replace_drop`. Each runs >= 200 ticks with hits, events and a result.
2. `cargo test -p rh-parity` passes on all old and new fixtures; `a_changed_rule_is_caught` still fails when a rule number is mutated (extend it to mutate `SHIELD_BLOCK_SHARE`).
3. Tolerance: discrete (hit/swing/block/stagger/death ticks, who hit whom, results) exact; continuous within 2e-6 (parity README).
4. Unit tests: pickup refusal order (stunned stub, unknown id, born-this-tick, too far, across a LOW tile), slot rules table (hand empty / other free / both full / Committed-style locked second slot stub), swap legality, no weapon item for fists.
5. Replay/checkpoint determinism: extend `rh-headless/tests/env.rs`-style test so a match with swaps replays to the same hashes.
6. `content_hash()` includes any new constant (grep what it eats and extend it) and the browser proof still passes.

## Validation commands
- `npx tsx parity/legacy-capture/capture.ts --only <scenario>` (add the scenario names to `SCENARIOS` first)
- `cargo test -p rh-sim`, `cargo test -p rh-parity`, `cargo test --workspace`
- `cargo run -p rh-parity --bin parity-report`
- `cargo clippy --workspace --all-targets`, `cargo fmt --check`
- `node tools/browser-proof/proof.mjs` (after `cargo build -p rh-server`) if wire or observation changed.

## Risk and suggested model tier
Medium-high: the rules are well-documented but the ledger/melee interplay (blocked hit, riposte as a second ledger entry,
stagger only on the unblocked part) must keep simultaneous-resolution semantics. Strongest builder model, high effort for the
shield/riposte ledger part; medium for pickup/swap.

## Known traps
- Never reorder the tick; weapon phase stays after inputs and before movement. A pickup is applied in the secret action order like any input.
- The riposte and the blocked hit are two entries of the same pass; kill credit and bounty must still read the pass as a whole.
- `serde_json` needs `float_roundtrip` (already set); do not store derived f64s that are not hashed consistently.
- Item uids: legacy uses `randomUUID`; the core has no entropy: derive ids from a counter and keep them out of the state hash only if ids are not gameplay-visible (decide and document).
- Legacy events emitted between ticks (a leave) travel with the next step.
- Adding a weapon-carrying field to observations/protocol is a shared-file change (version bump, C# mirror, golden vectors).
