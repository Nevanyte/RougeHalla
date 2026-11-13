# P-TRAINING-CAMPS-1: practice camps count as legacy counts them, and the console's clear resets camp progress

- **Serves:** owner decision 7 (2026-11-10: same information as legacy) and the balance lane (the training room is
  where a player checks a build); reviewer-opus note 3 on P-MECHANICS-SALVAGE-3 (2026-11-12); screenshot round 8
  (the practice panel read "Kills 0" after a console-spawned camp was killed)
- **Implementer tier:** implementer-opus (rh-sim training systems; serialized state, checkpoint identity)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework @ 447ba55c2 (P-MECHANICS-SALVAGE-3 merged)
- **D-rules touched:** D1 loose proof (legacy read; one unit test per rule, no capture) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Two things about the practice room's camps differ from legacy:
1. **A practice camp's clear pays nothing in Rust.** Legacy notes the contributors of a practice camp (no training gate
   in `hurtMob`) and, when its last mob dies, pays `payCampHeal` for it: the clear is counted for a contributor near the
   camp (so Holy camp lifesteal and Pack Leader grow) and one camp potion is stored. Rust skips the contributor note in
   training (`crates/rh-sim/src/systems/mob_life.rs:194`, `if !k.config.training`) and its training kill branch
   (`kill_training_mob`, `mob_life.rs:342`) never pays a clear.
2. **The console's clear does not reset camp progress.** Legacy `trainClear` zeroes the camp-clear count and forgets
   every contributor (`training.ts:344-345`); Rust `console.rs` `clear` does neither. Once rule 1 is in, a Holy player
   would otherwise keep earned camp lifesteal after a clear (the count is read through the Bruiser mirror, which the
   practice room installs: `Gates::TRAINING.bruiser`).

A practice **kill** already matches legacy: it pays nothing (no mob-kill count, GV, kill stacks, kill-stack toast or
weapon). When this lands, the practice room counts camp clears and resets them as legacy does, each rule proven by one test.

### What the practice panel shows ("Kills 0"): no sim or wire change
- The Unity HUD line `Kills N · GV N` (`client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs:320`) shows the
  player's **PvP** kills (`p.credit.kills`, `crates/rh-sim/src/observe.rs:1011`). A mob kill never adds to it, in the
  arena either: legacy `creditMobKill` raises `mobKills`, not `kills` (`packages/server/src/sim/arena.ts:267-273`).
  "Kills 0" after a practice camp is the correct number.
- Legacy's training HUD shows no Kills or GV line at all: it shows the banner "TRAINING — nothing here is recorded: no GV,
  no stats" in place of the run line (`packages/client/src/ui/hud.ts:21`, `:41-42`). Matching that is a Unity
  presentation change (its own client packet), not this one.
- No kill toast in training is legacy behaviour: the "+3 kill stacks" toast is `grantMobStat`'s
  (`packages/server/src/sim/mobStats.ts:18`), which `payMobKill` never reaches in training (`mobLife.ts:250-252`).
- The camp-clear count the panel needs is already delivered: the champion panel's `HolyCampClears` / `HolyCampLeech`
  rows (`crates/rh-sim/src/build_summary.rs:398-399`) are on the wire today. No wire packet is needed.

## 2. Dependencies
- P-MECHANICS-SALVAGE-3 merged (the mirror read `systems::bruiser::camp_clears`). It is in the base.

## 3. Relevant legacy paths
- `packages/server/src/sim/mobLife.ts:141-142`: `hurtMob` calls `campEngaged` and `noteCampContributors` for every
  regional mob, practice mobs included (no training gate).
- `packages/server/src/sim/campHeal.ts:13-27`: `noteCampContributors`: any camp ref >= 1, players behind a positive hit,
  keyed by `ref - 1` in `world.campContrib`.
- `packages/server/src/sim/camps.ts:70-75`, `:94-102`: `campMobDied` for a ref `state.camps` does not know, in training,
  calls `practiceMobDied`: when no mob of the ref is alive, `payLater(() => payCampHeal(world, ref - 1))`. No
  `campCleared` fx and no `campCleared` hook (no chest, no quest, no Bruiser hook link).
- `packages/server/src/sim/campHeal.ts:39-58`: `campCentre` for a practice camp is the mean of its mobs' brain homes
  (dead ones included); `nearCamp`: territory or within `CAMP_HEAL_RANGE` (12 tiles).
- `packages/server/src/sim/campHeal.ts:84-97`: `payCampHeal`: each standing contributor near the camp gets
  `campsCleared + 1`; every standing contributor gets a large potion (`grantConsumable`, no training gate,
  `consumables.ts:28-37`; bag full: the "camp potion bag full" toast); the camp's contributors are deleted.
- `packages/server/src/sim/bruiserPassives.ts:59-71`, `:118-120`: the `campClears` mirror is synced from
  `rt.campsCleared` every tick in the active phase (afterWeapons and systems), which a training world is in.
- `packages/shared/src/championPassives.ts:6-9`, `packages/server/src/sim/factions.ts:896`: Holy camp lifesteal
  = `campClears` x 0.005.
- `packages/shared/src/cards.ts:341-345`, `packages/server/src/sim/mods.ts:336`: Pack Leader, +3% damage per camp from
  `rt.campsCleared` (cap 24%).
- `packages/server/src/sim/training.ts:333-345`: `trainClear` sets `c.rt.campsCleared = 0` (`:344`) and
  `world.campContrib?.clear()` (`:345`); potions are not touched.
- `packages/server/src/sim/mobLife.ts:233`, `:247-252`: a practice kill queues no weapon and `payMobKill` returns in
  training: no `creditMobKill` (mob kills, GV), no `grantMobStat` (kill stacks and their toast), no `mobKilled` hook.
- `packages/server/src/sim/mobLife.ts:84-85`, `:112`: a training world places no map camps and respawns none, so the
  console's camps are the only practice camps and they never respawn.
- `packages/client/src/ui/hud.ts:21`, `:41-42`: the training HUD banner (no Kills, no GV).

## 4. New paths
- `crates/rh-sim/src/systems/training/camps_tests.rs` (oracle, committed)

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/training/console.rs` (the stub `practice_contributors`, the console's `clear`)
- `crates/rh-sim/src/systems/training.rs` (`validate_actors`: admission rule for the new practice state)
- `crates/rh-sim/src/systems/mob_life.rs`: only the training branches (`hurt`'s contributor note for a practice mob,
  `kill_training_mob`); the arena path is not touched
- `crates/rh-sim/src/systems/camp_heal.rs`: a practice-camp entry to the existing pay logic (the arena link `pay`
  keeps its behaviour)
- `crates/rh-sim/src/systems/ledger.rs`: only if a new `PayLater` variant is needed for the practice clear payout
- `crates/rh-sim/src/state.rs` (`PracticeRuntime` or another home for the practice contributors)
- `crates/rh-sim/src/checkpoint.rs` (`CHECKPOINT_FORMAT`, a `check_world` rule with its refusal test)
- `crates/rh-sim/tests/hash_coverage.rs` (the new serialized leaf)
- nothing under `rh-protocol`, `rh-server`, `client-unity`, `parity/`

## 6. Contracts and references
- C-TICK (no reordering; the practice payout is a `payLater` after the pass, as legacy), C-PARITY (all MATCH), C-RNG
  (no draw added: the practice clear and the potion draw nothing).
- ADR 0007 (determinism): contributors kept in first-hit order in a `Vec`, no hash collections.

## 7. Behaviour to preserve
- The arena (non-training) kill, camp-clear and reward paths: `guard_an_arena_camp_clear_pays_and_counts_as_today`.
- A practice kill still pays nothing: `guard_a_practice_kill_pays_no_kill_stacks_gv_or_feed`.
- `parity-report`: all MATCH (109 slice scenarios + 13 capture-only, 300 pathfinding queries at the time of writing).
- The training corpus `parity/training/source.json` (`systems/training/corpus_tests.rs`): no case hits a practice mob and
  its projection has no potion or camp-clear field, so it must stay green unchanged.
- **Identity that moves:** the practice contributors are new serialized, hashed state (they outlive a tick and cannot
  be derived: legacy keeps them until the clear or the console's clear, whatever the mobs' threat holds). Bump
  `CHECKPOINT_FORMAT` (`rh-checkpoint/31` today); the state hash of training worlds changes once a contributor is noted;
  arena worlds' hashes do not change (no practice state there). `REPLAY_FORMAT` and `OBSERVATION_VERSION` do not move.
  The coordinator records the new identity.

## 8. Acceptance checks
- Rule 2: `a_practice_camp_clear_counts_for_its_contributor_and_stores_a_camp_potion`: after one hit the contributor is
  `[(camp ref, player)]`; after the camp dies: `camps_cleared == 1`, large potions + 1, contributors empty, panel
  `HolyCampClears == 1` and `HolyCampLeech == 0.005`, no `CampCleared` event.
- Rule 3: `the_console_clear_forgets_the_camp_count_contributors_and_camp_lifesteal`: camp A cleared, camp B hit once,
  then the console's clear: `camps_cleared == 0`, no contributors, panel `(0, 0)`.
- Rule 1 guard and the arena guard stay green.
- `scripts/gate.sh --quick --oracle packet/P-TRAINING-CAMPS-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/systems/training/camps_tests.rs`
  - `a_practice_camp_clear_counts_for_its_contributor_and_stores_a_camp_potion`: RED today
  - `the_console_clear_forgets_the_camp_count_contributors_and_camp_lifesteal`: RED today
  - `guard_a_practice_kill_pays_no_kill_stacks_gv_or_feed`: green (guard)
  - `guard_an_arena_camp_clear_pays_and_counts_as_today`: green (guard)
- `docs/backlog/packets/P-TRAINING-CAMPS-1.md`

Stub (commit `stub:`, the implementer replaces it): `practice_contributors(w: &World) -> Vec<(u32, PlayerId)>` in
`crates/rh-sim/src/systems/training/console.rs` (returns empty today) and the `mod camps_tests;` line in
`crates/rh-sim/src/systems/training.rs`. Its contract: every (camp ref = `Mob::camp`, 101..=255; player) pair, each player
once per camp, in first-hit order. Keep the signature.

## 9. Validation commands
- `cargo test -p rh-sim --lib training::`
- `cargo test -p rh-sim --features trusted-status-probes --test content`
- `cargo test -p rh-sim --test hash_coverage`
- `cargo run -q --locked -p rh-parity --bin parity-report`
- `scripts/gate.sh --quick --oracle packet/P-TRAINING-CAMPS-1`

## 10. Risk and suggested model tier
Opus. New serialized state in `rh-sim` (checkpoint identity, `check_world`, hash coverage) and a payout inside the
ledger's pay-later order. The training gate must stay the only switch: a change that reaches the arena branch of `hurt`
or `kill` changes parity.

## 11. Known traps
- The tests use console-spawned camps only. The practice room has no fixed camps (legacy `mobLife.ts:84-85`; Rust
  `validate_actors` refuses map-camp state in training), and console camps never respawn (`mobLife.ts:112`).
- Camp numbering: a practice mob's `Mob::camp` is the ref itself (101..=255, legacy `MobState.camp`); legacy keys
  `campContrib` and calls `payCampHeal` with `ref - 1`. `camp_heal::camp_centre` already handles a practice camp as
  `camp + 1 == ref`. A regional mob's `Mob::camp` is the map index (0-based) in Rust.
- `camp_centre` for a practice camp averages the homes of all mobs with the ref, dead ones included (legacy iterates
  `world.mobs` whatever the status). The console places a camp 5-9 tiles away, inside the 12-tile range.
- `PracticeRuntime` is `Copy` today and `console.rs` copies it out (`let Some(run) = w.practice`); a `Vec` field ends that.
- Same tick: all of a camp's mobs dying in one pass pay one clear, after the pass (legacy `payLater`), and only when no
  mob of the ref is alive.
- Every standing contributor gets the potion even from outside the range; only those near the camp count the clear.
- The console's clear leaves potions alone (`training.ts:333-345` does not touch them).
- A test-file `const` in `rh-sim` is rejected by `crates/rh-sim/tests/content.rs`: the oracle uses functions.

## Legacy doubts (flagged, not changed)
- `packages/client/src/ui/trainingConsole.ts:143` (tooltip, 2026-10-28) says practice "normal kills grant fixed stats;
  an elite death drops an augment chest", and `:54` says "Each kill grants …". The server, older and authoritative,
  pays nothing for a practice kill (`mobLife.ts:250-252`, 2026-10-26/27) and fires no `mobKilled` hook, so no elite chest
  drops either. Rust follows the server (rule 1 guard). Making practice kills pay would be a behaviour change with a
  `DEVIATIONS.md` row, its own packet.

## Notes from previous attempts
