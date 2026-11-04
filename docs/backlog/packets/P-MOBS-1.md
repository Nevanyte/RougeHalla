# P-MOBS-1: regional mobs, camps and kill rewards

## ID and outcome
P-MOBS-1. Camps of regional mobs exist in `rh-sim` and behave as in legacy: rosters rolled at world build from a private stream,
mobs spawned at `raidStarted` from `map.camps`, mob AI as ordinary input-sending fighters, territory leash, camp-wide
aggro, evade/return, regen, camp state (idle/engaged/cleared) and the 180 s respawn, kill credit by damage, and the
kill rewards (GV, feed, the weapon drop/arm, `MOB_KILL_STACKS` stat stacks as data). Chests, camp-clear heal, wards and
elite chests are P-MOBS-2/P-CARDS-2; quests are P-QUEST-1.

## Dependencies
P-COMBAT-1 and P-COMBAT-2 (mobs fight with sword/axe/shield/bow/wand, including ranged windups and the NPC timing profile).
P-COMBAT-3 for `decide`/`lockSpacing` as a shared pure module. Map data: needs camps, `territoryGrid`, spots, `eliteSpot`, chest tile
and region factions. This packet **owns the camps/territory part of the `rh-map/2` export** (`capture.ts` `exportMap`); P-MAP-1
extends the same export with the remaining layers; the coordinator serialises capture.ts edits.

## Relevant legacy paths (verified)
- `packages/server/src/sim/mobAI.ts` (the header comment is the contract), `mobLife.ts` (spawn from `map.camps`, damage taken, death, drops, regen, `settleWeapons`, `awardMobWeapon`), `camps.ts` (rosters published in `state.camps`, `alive`, `state`, respawn), `mobs.ts` (dummies/training), `feed.ts` (reward curve, catch-up), `arena.ts` (`creditMobKill` l.267, `awardGv`), `mobStats.ts` (+ `shared/mobStats.ts`: `MOB_KILL_STACKS` 3, `MOB_STAT_REWARDS`).
- `packages/shared/src/mobs.ts` (`MOB_TYPES` 30 types, `MOB_ROLE_DEFS`, `mobFaction` l.37, `mobTypeFaction` l.211, `mobTypeWeapon` l.225, `territoryAt`/`territoryLeash`/`leashOk` l.230-255, `mobReachDamage`), `rosters.ts` (`rollZoneTypes`, `rollCampTypes`, `rollCampElites`, `campMobs`, `BAG_COPIES` 3), `constants.ts` (l.477-592).
- Tests: `packages/server/test/mobAI.test.ts`, `mobLife.test.ts`, `mobLeash.test.ts`, `mobRoles.test.ts`, `camps.test.ts`, `campTypes.test.ts`, `campWakeOff.test.ts`, `mobStrength.test.ts`, `mobExecute.test.ts`, `mobStats.test.ts`, `shared/test/mobs.test.ts`, `rosters.test.ts`, `mobLeash.test.ts`; benches `bench/mobDuel.ts`, `campDuel.ts`.

## New paths
`crates/rh-sim/src/systems/{mobs.rs,mob_ai.rs,camps.rs}` (catalog + faction scaling, the brain, camps; mobs act through `Cx::submit`, i.e. `validate` + the same queue as players), `rosters.rs`, `policies.rs` (shared with P-COMBAT-3 if not yet present), `Secrets.reward_seed`; capture: a `mobs: true` scenario mode and camp-bearing maps; `parity/maps/*.map.json` (`rh-map/2`).

## Exclusive write scope
`crates/rh-sim/src/{systems/mobs.rs,systems/mob_ai.rs,systems/camps.rs,rosters.rs,policies.rs,systems/mod.rs,schedule.rs,state.rs,fighter.rs,store.rs,scratch.rs,statics.rs,checkpoint.rs,content.rs,constants.rs,map.rs,observe.rs,lib.rs}`, `crates/rh-sim/tests/`,
`crates/rh-parity/**`, `parity/legacy-capture/capture.ts`, `parity/fixtures/`, `parity/maps/`. Protocol additions for mobs/camps in the
shared files (README) when replicating to clients. Mobs are fighters that are not seats: give them a `FighterCore` and move the systems that take `&Player` onto the core where they must act on both (today only `observe.rs` takes `FighterRef`; the tick systems take `Player`). Core layout rules (post-sweep, [ADR 0009](../../adr/0009-core-layout.md); the README "Shared-file rule" has the long form): the mechanic is `systems/<mechanic>.rs` with `fn(&mut Cx)` entry points, plus its rows flipped from `Pending` to `Ported` in `schedule.rs` at their legacy position (the row names, never a reorder); entity data goes in `fighter.rs` / `state.rs` / `store.rs` (hashed and checkpointed: extend `check_world` in `checkpoint.rs` if the new data has an invariant the tick relies on) and per-tick lists in `TickScratch` (`scratch.rs`, never serialized); `tests/no_alloc.rs` must stay at zero allocations per step, new content goes through the `content.rs` registry (`content_hash`), and every new serialized field must be covered by `tests/hash_coverage.rs`. `sim.rs` is a facade and is not in any write scope.

## Contracts and references
C-INPUT (**mobs are players who send inputs**: AI pushes `move/stop/aim/attack/release` into the mob's own `InputQueue`, applied next tick by the same handlers; no state is written directly), C-TICK (AI is a *system* after damage, so a mob reacts one tick late; spawns happen after the projectile sweep), C-RNG (rosters from a private reward stream; roster outputs are public by design), C-OBS (mobs are actors: seen within vision like players; camp `alive`/`state`/clocks are public), C-PARITY. ADR 0005 (mob AI is *not* a policy seat: it uses the sim's own input path).

## Behaviour to preserve
- Mob strength: `mobFaction` = region faction scaled by `MOB_K` 0.22 (elite `ELITE_K` 0.65), hp x `MOB_HP_MULT` 2, every damage number x `MOB_DMG_MULT` 0.5, elites additionally hp x `ELITE_HP_MULT` 2.0 and damage x `ELITE_DMG_MULT` 1.5, the zone trim `MOB_ZONE_DAMAGE` (plague 0.85, holy 0.92), execute scaled by k once more (k squared); a normal typed mob's damage x `MOB_MELEE_DMG_MULT` 1.6 (sword/axe/shield) or `MOB_RANGED_DMG_MULT` 1.2 (bow/wand); role multipliers from `MOB_ROLE_DEFS` (grunt 1/1/1, swarm 0.7/0.9/1.1, brute 1.4/0.8/0.9, skirmisher 0.85/1.1/1.15, caster 0.75/1.2/1: hp/dmg/move). Read the functions, do not recompute.
- Mobs fight with the **NPC timing profile** (`weaponTimings(..., "npc")`: fists 0.1 s, sword 0.1, axe 0.25 s with 25% share, bow 0.6 s / share 0.92, wand 0.4 s / 0.8) and a role speed as a move modifier; they never hurt each other and their shots fly past each other.
- Modes: `idle` (neutral, sends nothing) -> damage from a player wakes it onto the player with the most threat (`aggro`) -> `fight` (`decide` with the weapon's spacing; re-path every `MOB_REPATH_MS` 500 plus a per-mob phase) -> `return` (evading: `hurtMob` returns 0, out of hit tests, regen `MOB_RETURN_REGEN_SECONDS` 2, whole on arrival within `MOB_HOME_RADIUS` 10). Gives up on leaving the leash, after `MOB_GIVE_UP_SECONDS` **20** without *dealing* damage, or with no standing player. Leash = the camp territory cells within `min(camp.radius, MOB_LEASH_CAP)` where `MOB_LEASH_CAP` = 24 tiles in code (docs/legacy/CLAUDE_LEGACY.md says 12; code wins); a mob with no camp/territory uses `MOB_LEASH_RADIUS` 24 tiles around home. Regen `MOB_REGEN_SECONDS` 4.
- Camp-wide aggro (`CAMP_WIDE_AGGRO` true): any damage to a member wakes every other idle living mate onto the same target with 0 threat (kill credit unchanged); a lethal hit wakes them too; inside a ledger pass wakes are only requested (`world.combat.campWakes`) and resolved after it by the tick's secret rank (`resolveCampWakes`, `payLater`); hidden/untargetable targets are never handed on.
- Rosters (`rosters.ts`): per zone a bag of `BAG_COPIES` 3 rounds of the four normal types, each round shuffled (Fisher-Yates from the private reward stream, zones in first-seen order), camps take entries in `map.camps` order; the k-th elite camp of a zone holds the zone's k-th elite type; every non-elite mob of a camp has the camp's type; mobs appear at `raidStarted`. 50 camps and 10 elites per map, ~184-217 mobs.
- Camp cycle: state 0 idle / 1 engaged / 2 cleared; the complete roster respawns `CAMP_RESPAWN_MS` 180000 after the last death with fresh ids/brains; partial clears do not respawn; the coliseum teleport (`resetMob`) puts every mob back on its spot at full hp; ended runs and training do not respawn.
- Rewards (payLater, after the pass): GV `GV_MOB` 6, `GV_ELITE` 30 times the reward curve, within `GV_MOB_CAP` 90 a run; feed +`FEED_MOB_KILL_WEIGHT` 0.25; the kill goes to the player with the most damage over the whole fight; a mob that dies to a player with an **empty hand arms** the killer (toast), else drops a loose weapon (not if the killer holds that type; fists drop nothing); weapons of mobs one player kills in one pass settle together by mob id; credited normal kills add `MOB_KILL_STACKS` 3 stat stacks to the killer's `mobStats` (per-type effects in `MOB_STAT_REWARDS`; the stat application is P-CARDS-3 but record the stacks here).
- Doc/code notes: docs/legacy/CLAUDE_LEGACY.md says give-up 6 s and leash cap 12 tiles; code has 20 s and 24 tiles. docs/legacy/CLAUDE_LEGACY.md "8 camps a zone" is stale (10).

## Acceptance checks
1. `rh-map/2` camps layer exported and loaded; `mapHash` unaffected until P-MAP-1.
2. Capture scenarios with `mobs: true` on a small hand-built camp map and on seed 1: `mob_pull_camp_wide_aggro`, `mob_leash_return`, `mob_ranged_caster`, `mob_kill_arms_empty_hand`, `elite_duel`, `camp_clear_respawn` (>= 3700 ticks to cover 180 s; fixtures are large: store in compact form or limit players), `mob_kill_credit_threat`.
3. `cargo test -p rh-parity`: mob positions, hp, brain mode (add `mode` per mob to the fixture), hits, deaths, drops and GV exact/2e-6; mob ids compared by spawn order.
4. Roster statistics: over 200 seeds the Rust `roll_zone_types` equals the legacy output when fed the same stream (capture the legacy roster per seed; the private stream is injected).
5. Perf: 8 players + ~200 mobs, `step` average well under the legacy gate (avg < 5 ms, p99 < 15 ms; legacy `bench/stepBench.ts`).
6. Replay/checkpoint determinism with mobs awake; observation leak test (mob far outside vision absent).

## Validation commands
`npx tsx parity/legacy-capture/capture.ts --only <scenario>` and `--only map`, `cargo test -p rh-sim`, `cargo test -p rh-parity`, `cargo test --workspace`,
`cargo run -p rh-parity --bin parity-report`, `cargo clippy --workspace --all-targets`; a Rust step bench "to be created by this packet" (`crates/rh-headless` bin or `cargo bench`).

## Risk and suggested model tier
High risk: strongest model, high effort. Biggest single behavioural surface after the generator; many order-dependent details
(threat tie-breaks, rank-based wake resolution, per-mob repath phase). Split: M1 catalog + roster + spawn, M2 AI + leash + aggro, M3 rewards + respawn.

## Known traps
- AI is a system *after* damage and before the next tick drains queues: one tick of reaction lag is part of parity.
- Per-mob `phase` for repath: find how it is derived (id-based) and port exactly.
- Mob ids: allocation order matters for tie-breaks; respawned mobs get fresh ids.
- `payLater` semantics: spoils run after the ledger pass; the Rust ledger already has this structure for GV/bounty, extend it, do not create a second path.
- The roster draw order (Fisher-Yates, zones first-seen) is part of the private stream; never use `order_salt`.
- Legacy events between ticks travel with the next step.
