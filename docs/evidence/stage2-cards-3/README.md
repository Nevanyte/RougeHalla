# P-CARDS-3 — Kill augments and the mob stat stacks

`DONE-VERIFIED` for the P-CARDS-3 row slice, stacked on the P-CARDS-2 head (`2895e05a`). Commits
`94b8522c`..`92be24c5`; [PR #49](https://github.com/Nevanyte/RougeHalla/pull/49).

**No `P-CARDS-3` packet file exists** in `docs/backlog/packets/`: the backlog row is the only textual record, so the
scope below is derived from that row, the actual source modules and what the base already carried. Recorded as a
coordinator-owned gap; the acceptance evidence is this file and the PROGRESS row.

## What the slice adds

1. **The kill-augment module** (`crates/rh-sim/src/kill_augments.rs`): the source `shared/killAugments.ts` pure layer —
   the nine readable investments and their `UNIT` normalisers (registered as the `kill-augments/1` content table),
   `KILL_AUG_SHARE`/`KILL_AUG_OPTIONS`/`KILL_AUG_SECONDS` (registered `content!` rows), the `kill:<key>:<gain>` id codec
   with JS `toFixed` byte semantics, the wording helper, and `rollKillAugments` as the focused port of the
   `combatReadability(...).investedStats` `lasting` scoring the roll reads (card rows, farm rows, kill stats, chest
   boosts, mirror caps; `campsCleared` is 0 until P-MOBS-2 ports the camp-clear counter — Holy's camp-lifesteal term is 0
   at 0 clears).
2. **Private Trophy containers**: the source `killAugments.onPlayerKilled` chain link is ported at its recorded
   `playerKilled` position (after `factions.onPlayerKilled`, before `quests.onPlayerKilled`, C-TICK unchanged): a
   credited player death in Active, never training, never a self kill, drops an owner-bound reward container at the
   killer's feet with the victim's top-three rolled options, the source 30 s lifetime and the birth hold. Camp/stat
   chest configuration stays in `reward_chests`; the trophy is the same container kind with `owner: Some(killer)` and
   kill-augment options.
3. **The owner-only pick**: `OptionId::Kill` carries a parsed augment; the chest `choose` consumer refuses a stranger
   with the source `Not yours`, and the owner's pick adds the share to the new serialized `PlayerState.killStats`
   (`KillStats`), refolds the mirrors and syncs max hp. `killStats` is folded as farm rows (source `farmRowsOf`:
   mob-stack rows plus kill rows), outside the card caps.
4. **State/format bookkeeping**: `Player.kill_stats` is serialized and hashed (the checkpoint format moves to
   `rh-checkpoint/21`), the content hash moves with the new registered rules, the ability hash tape is recalibrated at
   the base case set (the captured ability fixtures are unchanged; only the state layout they freeze moved), and
   `hash_coverage` gains the two exact restore-validation reasons for the new leaves plus the owner-bound chest leaf.
5. **The public-transport filter, in one site**: the sim is complete (options present and pickable by index through the
   ordinary `Choose` action — the headless/policy path), and `rh-server/src/wire_state.rs` filters kill-augment options
   out of the reward projection, with the comment pointing at the coordinator-owned follow-up (a `WireRewardId` variant
   and its protocol bump on the protocol-9 spine). `PROTOCOL_VERSION` is NOT bumped and this branch does not rebase onto
   the protocol-9 spine (lead decision, 2026-11-07).

## Source semantics the port follows

- `packages/shared/src/killAugments.ts`: `KILL_AUG_SHARE=0.5`, `KILL_AUG_OPTIONS=3`, `KILL_AUG_SECONDS=30`,
  `KILL_AUG_PREFIX="kill:"`, `UNIT`/`FLAT`/`NAMES`/`STORE`, `encodeKillAugment`/`parseKillAugment`,
  `rollKillAugments` (top three `investedStats` scores, `score*UNIT*SHARE` rounded through `toFixed(1|4)`, only positive
  gains), `killAugmentText`, `killStatEffects`.
- `packages/server/src/sim/killAugments.ts`: `onPlayerKilled` guards (died + Active + not training + not self + killer
  alive), trophy at the killer, `holdBirth`, 30 s, owner, options/takenBy; `trophyOwnerOk` refusal text;
  `grantKillAugment` (add to `killStats`, `recomputeMods`, `syncMaxHp`); `pickKillAugment`; the installed
  `playerKilled` chain link.
- `packages/server/src/sim/chests.ts` `handleChoose`: busy → gone → trophy owner → range/LOS → picked → skip → bounds →
  taken → boost maxed → owner branch (kill augment, silent parse failure) → card checks. The Rust `choose` already
  followed this order; the owner branch is now the kill-augment grant instead of the old reserved no-op.
- `packages/shared/src/combatReadability.ts` `investedStats`/`lasting` scoring: flat mirrors over their units, health
  over base hp, `permanentStat` (base-card rows + farm rows + kill stats, capped, then `chestBoostGain`) for the two
  lasting scores, leech rows/`LS_CAP` + farm leech. Only these scores are read by the roll; the display-only fields
  (`powerRatio`, `power`, `topStats`) stay unported by this slice.
- `docs/MOB_PROGRESSION.md`: the normal-mob kill stacks and their fold consumers are the P-MOBS-1 slice below.

## Mob stat stacks (`MOB_KILL_STACKS 3`)

The base already carries the source facts and the real producer: `modifiers/farm.rs` has the exact 20-row
`MOB_STAT_REWARDS` table with `kill_stacks: 3` (the source `MOB_KILL_STACKS`), `MOB_STAT_COUNT_MAX`, the fold rows used
by `modifiers::recompute`, and `grant_mob_stat`; `mob_life::pay` calls it with `kill_stacks` for a credited non-elite
kill only (elite kills pay GV but no stack, downed/resolved killers pay neither stat through the standing guard, and the
feed/multiplier systems never touch this reward), exactly as `sim/mobStats.ts` does.

Parity: the P-MOBS-1 captured mobile lifecycle corpus (`parity/mobs/runtime-lifecycle.json`, pinned-container run)
records the source's per-player `mobStats` maps after the real kills and the Rust consumer
(`mob_lifecycle_captured_source_hooks_rewards_and_180s_respawn`) already asserts the farm counts against them (e.g.
`flameCaller: 3` for the credited kill and no stack for the elite); the captured `normal-farm-grants` case of the card
corpus pins the fold consumers row-by-row and the boost/restore path (`source_normal_farm_rows_grants_and_restore`).
This packet adds the actual-kill fold-consumer assertion for the new killStat rows and keeps that base certification as
the mob-stack evidence rather than duplicating the corpus.

## Captured witness

The pinned card-runtime corpus already contains the case this packet needs:
`real-trophy-owner-private-refusal-and-pick` (`parity/card-runtime/source.json`, 53,033,468 bytes, SHA256
`032d49aad1e204f9f57754e7fdbbe0121ca1f4e99a265e10437ff3cb266f1e51` as checked in on this base; captured by the pinned
linux/amd64 Node 22.23.4 container run described in `parity/card-runtime/README.md`, profile `core`, map `room`, 4
declared players; this packet does not modify the corpus). It records: the real sword swing kill at tick 2 (`hit` 36.13796707603867, `gv` kill 10, `resolved`), the
trophy container (`c2`, at the killer 300/320, label `Trophy`, owner `p0`, `expiresAt` 30100, options
`["kill:ad:6.0"]`, camp 0, empty takenBy/pickers), the stranger's `Not yours` toast at tick 6, and the owner's pick at
tick 7 (`chestTaken`, `killStats {"ad": 6}`, encoded `adBonus` 60).

The Rust consumer (`crates/rh-sim/src/kill_augments/tests.rs:
`trophy_owner_refusal_and_pick_reproduce_the_source_witness`) replays the case through the real C-INPUT door on the
same declared room/placements: it drives the attack/release/choose actions at the captured ticks and compares the
trophy row (position, owner, camp, lifetime, encoded option ids, taken/pickers), the victim's death and the killer's GV,
the stranger's exact refusal, the picked `killStats`/folded mirror, and the persisted final state. It also covers what
the case cannot reach: the JS-rounding helper cases, every id key round trip, the wording both for a flat and a
percentage option, all nine killStats folded consumers (flat mirrors, attack/move speed, max hp), and the guard
boundaries (Mia and self kill never drop a Trophy; training has no admitted producer on this base, mirroring the source
guard through `Gates::training`).

## Commands

```
cargo test -p rh-sim --lib --all-features -- kill_augments
cargo test -p rh-sim --all-features
cargo test --workspace --all-features --locked   # with PostgreSQL from tools/pgtest/start.sh
```

## Measurements

- Content hash: `4662962b9cb969b1` (the new `KILL_AUG_*` rows + the `kill-augments/1` table; the source UNIT table and
  readable-key order are folded).
- Checkpoint format: `rh-checkpoint/21` (new serialized `player.kill_stats` and the `OptionId::Kill` variant).
- Ability hash tape: re-recorded at the base case set (58 cases, same tick counts; only the state layout moved).
- `cargo test -p rh-sim --lib --all-features`: 507 passed / 1 ignored before the tape record; after it the tape case
  reproduces.
- Workspace gate: **1,438 passed, 0 failed, 3 ignored, 151 test binaries, exit 0** (with PostgreSQL; the base
  P-CARDS-2 gate plus the six kill-augment tests and the wire-projection test).
- `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --all-features -- -D warnings`: clean.
- Schedule conformance (`cargo test -p rh-parity --test schedule`): 14 passed; `killAugments.onPlayerKilled` flips
  from Pending to Ported at the same index (no phase/hook reorder).
- Mutants (`bash tools/kill-augment-fixtures/run-mutants.sh`): **6/6 killed, unchanged control passes** — kill-share
  drift, `toFixed` tie truncation, trophy on Mia, trophy-is-public (owner refusal removed), 15 s trophy lifetime, and
  killStats-left-unfolded.

## Still missing / follow-ups

1. **The packet file** (`docs/backlog/packets/P-CARDS-3.md`) does not exist: coordinator-owned; the row is the record.
2. **Public transport of Trophies and of the `killStats`/`mobStats` HUD maps** is coordinator-owned. The projection
   omission is isolated at `rh-server/src/wire_state.rs` (`rewards`: the `OptionId::Kill` filter) and the follow-up is
   a `WireRewardId` variant plus the protocol bump on the protocol-9 spine, then `protocol/fixtures/v<version>.json` and
   the Rust/C#/JS decoders; the HUD maps need their own observation fields. No protocol version is changed here.
3. **Toast/HUD wording**: the kill-augment text helper is ported and pinned by a unit test; the sim emits no toast
   event for stat grants or trophy offers (the source's `toast` transport is not in this slice), so the `mobStatText`
   wording helper is not ported. Presentation transport is the same coordinator follow-up as (2).
4. **`campsCleared`**: the readability leech score reads it in the source; the counter belongs to P-MOBS-2's camp-clear
   heal, contributes 0 at 0 clears, and does not affect the captured cases. Documented rather than stubbed.
5. **Pending-packet envelope**: the static maximum-packet fold covers the all-cards + maximum-farm state; kill stats add
   on top of the same farm-sum class. The captured/gate states are far below that envelope and no check regressed, but a
   rigorous future bound should include a world-level kill-stat maximum.
6. The source `rewardOffered`/`rewardChosen` telemetry taps stay unported with the other observation hooks.

## Coordinator files

No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table or `Cargo.lock` edit; no merge; no protocol bump.
