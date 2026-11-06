# P-FACTION-3: Plague corpses and owned zombie

Status: **INCOMPLETE (core native)** — corpse harvest, the companion actor, combat/credit, regen and checkpointing
are integrated and tested. Protocol exposure, actual-source capture/parity, mutants and the full gate remain.

## 1. Outcome

Port `plagueCorpses.ts`/`plagueZombies.ts`: one corpse for a real active player death; a living Plague within 24 u and
line of sight consumes it; the corpse is removed first, then grants a stack, 3% base-health max HP (a Farm maxHp row),
an ordinary 3% heal, and raises/strengthens one owned zombie. The zombie follows/assists, uses its own 1 s / 0.2 s /
custom-damage packet, regenerates 5%/s in 500 ms steps at 25% for 4 s after being hit, and credits its owner.

## 2. Legacy paths

`packages/server/src/sim/plagueCorpses.ts`, `plagueZombies.ts`, `packages/shared/src/plagueCorpses.ts`,
`combatant.ts` (`hostile`, `creditedPlayerId`), `weapons.ts` (zombie packet), `melee.ts`, `ledger.ts`,
`mobs.ts`/`mobLife.ts`, `docs/PLAGUE_CORPSES.md`.

## 3. Implemented (core)

- `World.plague_corpses`; `PlagueCorpse { player, x, y }`, one per real death, cleared on run end.
- `Player.farm.corpse_stacks` + a flat max-hp Farm row (keeps `Player` at its base size).
- `Mob.owner`, `Mob.zombie: ZombieRt`, `Mob.display_name`; `ActorOrigin::Zombie`.
- `systems/plague_corpses.rs`: death hook, `consumeCorpse`, auto-harvest in action order, exact refusals.
- `systems/plague_zombies.rs`: raise/revive, stats, follow/assist, hostile rule, damage profile, owner credit,
  regen, owner displacement/teleport, fighterOut/runEnded.
- `mob_life::hurt` routes zombie victims; `mob_ai` skips companions; `base_sheet`/`point_damage` bypass Mob scaling;
  melee/projectile friendly-fire filters; credit maps zombie hits to the owner.
- `hash_coverage` documents the validated corpse/zombie leaves.

## 4. Contracts

C-INPUT (`consumeCorpse` validated), C-TICK (all rows at their legacy positions), C-DET (corpse/zombie state hashed,
checkpointed and restore-tested), C-OBS (zombie is a normal actor view; corpse/public transport still pending),
C-RNG (no new stream; ids derive from the actor counter), C-NUM (source f64 order and constants).

## 5. Checks run

- `cargo test -p rh-sim --lib` — 457 passed.
- `cargo test -p rh-parity` — all tests pass, including schedule and 103 existing slice scenarios.
- `cargo test -p rh-sim --test content` — 21 pass; content hash now `a882b26657530d74`.
- `cargo test -p rh-sim --test hash_coverage` — 6 pass; 0 unhashed.
- `cargo test -p rh-sim plague_corpses --lib` — 3 pass, including zombie checkpoint restore and follow.

## 6. Remaining

- Protocol v8: `consumeCorpse` command, corpse list/actor-owner exposure, C#/JS golden vectors.
- Actual-source capture/parity scenarios and six mutants.
- `mob_checkpoint` PvE zombie validation, full workspace/clippy/perf/browser gates.
