# P-FACTION-3: Plague corpses and owned zombie

Status: **INCOMPLETE (one honest gap)** — core, protocol v8, two pinned actual-source parity slices and six
mutants are green. The zombie-combat capture remains capture-only because a per-tick damage drift is still open;
the full perf gate and the PR remain.

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

C-INPUT (`consumeCorpse` validated through an observer-issued corpse prop handle), C-TICK (all rows at their legacy
positions), C-DET (corpse/zombie state hashed, checkpointed and restore-tested), C-OBS (corpses are a `PropKind::Corpse`
row for living Plague; the zombie is a kind-2 actor), C-RNG (no new stream; ids derive from the actor counter), C-NUM
(source f64 order and constants).

## 5. Checks run

- `cargo test -p rh-sim --lib` — 457 passed.
- `cargo test -p rh-parity` — all tests pass, including schedule and 103 existing slice scenarios.
- `cargo test -p rh-sim --test content` — 21 pass; content hash now `a882b26657530d74`.
- `cargo test -p rh-sim --test hash_coverage` — 6 pass; 0 unhashed.
- `cargo test -p rh-sim plague_corpses --lib` — 3 pass, including zombie checkpoint restore and follow.
- `cargo test -p rh-protocol` — all pass; protocol v8 vectors include `input_corpse` and a corpse prop.
- `node tools/protocol-js/check-vectors.mjs` — 25 server vectors, 89 malformed, 10 chains, 15,477 checks.
- `dotnet test client-unity/RoguehallaNet.Tests` — 271 passed.
- `node tools/browser-proof/proof.mjs` — 15 checks PASS on protocol 8.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` — clean.

## 6. Actual-source capture and mutants

Pinned Linux x64 Node `v22.23.4` (`node:22.23.4-bookworm-slim@sha256:5ec23b...`), no package source changes:

- `parity/fixtures/corpse_death_auto_raise.json` — slice: near auto-harvest, stack, heal, zombie raise.
- `parity/fixtures/corpse_marker_persists_and_explicit_consume.json` — slice: marker persistence, far refusal,
  auto-harvest after walking in.
- `parity/fixtures/corpse_zombie_assists_owner_target.json` — capture-only: zombie follows the owner's new target
  and lands hits; not promoted because the per-tick damage drift is still open.
- `parity/corpses/source-manifest.json` pins 14 source files and all 3 fixtures.
- `tools/corpse-fixtures/run-mutants.sh` — **6/6 killed**.
- `cargo test -p rh-parity --test parity` — **29 passed**, including both slice fixtures.
- `cargo test --workspace --all-features --locked` with the throwaway PostgreSQL cluster — all tests pass.
- `node tools/corpse-fixtures/check.mjs` — 17 manifest/fixture checks pass.
- `mob_checkpoint` now admits a raised zombie body in a PvE checkpoint instead of treating every mob as a regional birth.

## 7. Remaining

- Close the zombie-combat per-tick damage drift and promote that capture.
- Full perf gate and PR.
