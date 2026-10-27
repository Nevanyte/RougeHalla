# Work plan for Kimi: quests on current RougeHalla

You built the first quest system for RougeHalla (`feature/quests`, commit 3186691, "Quests: catalog, roster, placement, and raid runtime"). The owner and the maintainers reviewed it and want you to keep going: bring it onto the current code, make it playable in the browser, and give us a balance harness. Several Claude sessions are working on other parts of the game at the same time, so this file also says what not to touch.

Read this whole file before starting. What you have:
- The public repo, https://github.com/Nevanyte/RougeHalla, at commit `3f2da66` (main). Everything except your own commit is there.
- This file.
- `QUESTS_REVIEW.md` (sent alongside): the review of your branch, with evidence. Section 2 turns its confirmed findings into required fixes. Its line numbers are for your branch at 3186691 and for main at 8e78689, so re-read the code instead of trusting a line number.
- `QUESTS_PLAN.md` (sent alongside): the maintainers' larger quest design. K2 takes parts of it, by section number. Its file and line references are to the R5 line (now merged into main), and the scripts it names in a local scratchpad are not shared; ignore both. One known error: its section 2.5 says "Known (6 / 5 / 4 / 3 by lobby size)". The right numbers are 3 / 4 / 5 / 6 for 2-3, 4-5, 6-7 and 8 starters, as in K2 item 6 below.
- `RougeHalla-kimi-quests-3186691.patch` (sent alongside): your commit as a patch (section 0).

---

## 0. What changed since your branch

Your branch was built on `0bcb471` (roguelike R0 only). **main is now `3f2da66`.** It got there in three merges: `053bde0` (Wishes), then `8e78689` (R3/R4a, which contains `053bde0`), then `3f2da66` (R5). The two lists below are `8e78689` (Wishes included) and `3f2da66`.

`8e78689` added:

- **Wishes** (merge `053bde0`): one active spell per faction on the D key, a status runtime (`packages/server/src/sim/status.ts`), an ability pipeline (`sim/abilities.ts`), synced areas (`sim/fields.ts`), displacement (`sim/displace.ts`), and client blink prediction. A Wish's damage is flat: the ledger never applies the attacker's outgoing multiplier (buff, passive and `vs` rows, `outgoingMult` in `sim/mods.ts`) to an entry that has `ability` set. The status runtime's `damageFactor` (Trial's zone) still applies to it.
- **R3, the planning phase** (`sim/planning.ts`, client `ui/planning.ts`, `ui/planningMath.ts`, `ui/route.ts`): before a run, every player sees a private spawn deal and the camps, picks a spawn and a route, and presses Ready. The world is frozen while planning. Leaving during planning counts as a loss.
- **R4a, per-mob-type buffs**: the old generic hp / attack-speed / move-speed stacks are gone. Each mob type grants its own buff, made of `Effect` rows (`packages/shared/src/buffs.ts`: `BuffId`, `BUFFS`, `buffDef`, `buffRowsOf`, `buffPower`, `rewardCurve`, `catchUpMultiplier`). The server grants them with `grantBuff(world, p, rt, id, amount)` in `packages/server/src/sim/buffs.ts`, and the stat mirrors (`sim/mods.ts`) are the single source of truth for stats. Buff values were doubled by owner ruling, and the attack-speed multiplier is capped at 1.5 (`AS_MULT_CAP`).
- Camp rosters by mob type (`sim/camps.ts`, `shared/rosters.ts`), the `hurt` hook taking `hpBefore`, and a sticky void during planning.

`3f2da66` (R5, merged on top) added:

- **Camp states** (`sim/camps.ts`, `CampState` in synced state): a camp is idle, engaged or cleared. Camps never respawn, and a cleared camp stays cleared through the coliseum teleport.
- **Contested shared chests** (`sim/chests.ts`): a cleared camp drops one reward chest (`ContainerKind` gains "reward") with 3 options, open for 15 s. A pick is the new `choose` input; `pickup` stays for ground weapons and bodies.
- **Camp-wide aggro**: the first hit on a camp member wakes the whole camp. Mobs are weaker: `MOB_K` is 0.22.
- 9 live passives, the `train` input and the training console.
- Wire and types: `CLIENT_MESSAGE_TYPES` now ends `plan, cast, choose, train`; fx `campCleared` 18 and `chestTaken` 19; `GvReason` gains "skip" (a chest skip's GV counts in the mob GV cap); the `ChainableHook` union gains "campCleared".
- Client: the chest panel, chest blips on the minimap and the planning map, the passives row.

`CLAUDE.md` at the repo root is the authoritative description of all of this, including the **Architecture rules (do not break)** section. Read it first.

**Your commit is not on GitHub.** `feature/quests` was never pushed. It is attached as `RougeHalla-kimi-quests-3186691.patch` (`git format-patch 0bcb471..3186691`; it contains your `docs/quests.md`). If your own checkout still has the commit, use that. Otherwise, in your worktree (section 1) on `kimi/quests-k1`, which starts at `3f2da66`: `git am --3way RougeHalla-kimi-quests-3186691.patch`, then resolve the conflicts by hand (K1.1 lists them). Files that merge without a conflict (`step.ts`, `loot.ts`, `combatant.ts`, `constants.ts`, and the test files that build `gv` literals) still need re-reading, because main changed under them.

---

## 1. Rules for this work

**Where to work.** Work in your own git worktree, not in the main RougeHalla folder. The maintainers' tools and other agents also use that folder, and switching its branch breaks them.
- From `/Users/nevinmckinnon/Documents/Projects/RougeHalla`: `git worktree add ../RougeHalla-kimi kimi/quests-k1`, then `cd ../RougeHalla-kimi && npm ci`. Do all work and run all gates there.
- If you already started in the main folder, commit what you have on `kimi/quests-k1` first, then move to the worktree.
- Never switch the branch of the main folder. If git refuses the `worktree add` because `kimi/quests-k1` is still checked out in the main folder, the maintainers have not freed it yet: do not free it yourself. Create the worktree on a new branch from the same commit, `git worktree add -b kimi/quests-k1-wt ../RougeHalla-kimi kimi/quests-k1`, continue there, and name both branches in your report.
- Working from a fresh clone of GitHub instead needs no worktree: clone, then `git checkout -b kimi/quests-k1 3f2da66`.

**Base and branches**
- The base is `3f2da66` (current main). Name branches `kimi/quests-k1`, `kimi/quests-k3`, and so on. `kimi/quests-k1` already exists in the maintainers' checkout and points at `3f2da66`; it is not on GitHub, so from a clone create it with `git checkout -b kimi/quests-k1 3f2da66`.
- R5 is already in the base, so there is no rebase for it. When the orchestrator tells you a newer main exists (R2 and the bot rewrite are next; see section 6), merge or rebase onto it before you hand in.

**Gates.** Every hand-in must pass all three from the repo root:
- `npm run typecheck`
- `npm test`
- `npm run build`

Before you change anything, run `npm test` on the pristine base and list its failures in your report, so we can tell yours from the ones that were already there. Your last branch passed its tests but **failed typecheck** (`packages/server/test/quests.test.ts` lines 304-305). Vitest does not type-check, so run typecheck yourself.

**Known timing-sensitive tests.** A few wall-clock tests time out when the machine is busy. If one fails, re-run that file alone and say so in your report:
- `packages/shared/test/pathfind.test.ts` (performance asserts)
- `packages/shared/test/blink.test.ts` (heavy seed sweeps)
- `packages/shared/test/planning.test.ts` and `packages/server/test/planning.test.ts` (loops of `spawnWalks` over many seeds)
- `packages/server/test/perf.test.ts` (the step budget)
- `packages/server/test/api.test.ts`

`packages/shared/test/cosmetics.test.ts` used to be on this list but has no timing assertion: treat a failure there as real. Only `packages/server` has a vitest config (test timeout 60 s); `shared` and `client` use vitest's 5 s default.

**Running it.** Node 22.12 or newer (an older Node fails reconnect tests on the untouched tree). `npm install` (or `npm ci`), then `npm run dev`: the server on :2567 and the Vite client on :5173 (strict port; `/api` is proxied to the server).
- Open `http://localhost:5173/?profile=alice` and, in a second tab, `http://localhost:5173/?profile=bravo`. A name is 2-16 characters of `A-Za-z0-9_-`. The first load of an unused name claims it, and each tab keeps its name in sessionStorage. Press Start Run in both.
- A run needs 2 players. The lobby closes `FILL_SECONDS` (5) after the second joins, planning lasts `PLAN_SECONDS` (12) or until both press Ready, and the first teleport comes 300 s after the run starts.
- For quest checks use long timers, so the teleport does not close your quests: `MIN_PLAYERS=2 FILL_SECONDS=2 PLAN_SECONDS=30 PATIENCE_SECONDS=3600 STASH_FILE=/tmp/kimi-stash.json npm run dev`. `MIN_PLAYERS=1 FILL_SECONDS=1` gives a solo run. `npm run bots -- 2` adds bots (they ignore quests).
- In a dev build `window.__raid = { scene, room }`; `[...__raid.room.state.quests.keys()]` shows what a client holds.
- No browser available? Say so in the report and cover the flow with a Room-level test over real sockets (see `packages/server/test/planningRoom.test.ts`).
- One test file: `cd packages/server && npx vitest run test/quests.test.ts`.

**Architecture rules you must keep** (see CLAUDE.md for the details):
- **Authoritative server.** Clients send inputs only. Message handlers validate and enqueue; they never change state.
- **The sim is pure.** `server/src/sim/*` never imports `@colyseus/core`. It changes state at the fixed 20 Hz step and returns events.
- **The tick order is fixed** (`sim/step.ts`). Quests live in a module `packages/server/src/sim/quests.ts` that exports `install(world)`.
  - Register it in the `MODULES` array of `sim/gameplay.ts` as `installQuests`, after `installMobLife` and before `installMods`. `installMods` stays last: its `updateMods` system must be the last `world.systems` entry.
  - `install` pushes your system onto `world.systems`, which `updateActive` in `step.ts` runs after `applyLedger` and before `settle()`. (`afterWeapons` and `beforeDamage` are the other system lists.) Say in your report where it runs. Do not reorder the tick.
  - Hooks go on through `chainHook`, never by assigning `world.hooks.x`.
  - `world.quests` is null for worlds built without `gameplay.ts` (many tests call `createWorld` plus single installs): null-check it.
- **Rewards are paid after the damage pass.** Queue them with `payLater(world, fn)` (exported from `packages/server/src/sim/world.ts`; it runs `fn` at once outside a pass, and after every victim has taken damage inside `applyLedger` in `sim/ledger.ts`). Outcomes come from `settle()` in `sim/arena.ts` only. A reward must never decide who survives a tick.
- **No `Math.random`** in shared code. Use `rng.ts`.
  - **Hidden draws** (which quests, where the unknown ones are) come from a private quest stream forked from `world.rewardRandom` (K1.3). Never use `world.random` for them: drawing from it shifts loot rolls and breaks seeded tests. Never move `rewardRandom`'s own position either: camp rosters, planning deals and chest rolls must not change when quests are switched on or off.
- **The map is never synced.** Only the seed is. Anything placed from the map must be deterministic from the seed plus the private stream.
- **Wire format.**
  - On main the `KIND` table in `packages/shared/src/fxCodec.ts` ends at `campCleared: 18, chestTaken: 19`, so the next free fx code is **20**. Tables only grow at the end.
  - A new fx needs its `FxEvent` variant in `shared/src/messages.ts`, a tuple layout line in the header comment of `fxCodec.ts`, a `KIND` entry, `packOne`/`unpackOne` cases, and an example in `packages/shared/test/fxCodec.test.ts` (it does not compile until the kind is listed).
  - K1 should need no fx: what happens to one player goes by the existing `toast` event, and what happens to everyone is read by the client by diffing `state.quests`.
- **Hidden information.** Every client receives the whole synced state. Anything secret must stay server-side or go by a private message to one client, like the planning deal does.
- **Code style.** No enums, no decorators. The schema uses the decorator-free `schema({...})` builders with `.default(...)` on primitives.
- **Comments are sparse** and explain why, not what.
- **Commits.** Plain messages, with no "Co-Authored-By" or other AI attribution lines.

**Do not edit these.** Other sessions own them right now, and touching them causes merge conflicts. If you need a hook in one of them, add the smallest possible line and list it in your report.
- **Map generator:** `packages/shared/src/mapgen.ts`, and any `zones.ts`, `cover.ts`, `terrain.ts`.
  - The new 96×96 zone generator (R2) is replacing it.
- **Bots:** `packages/server/src/bots/*`.
  - A separate session is rewriting the bot brain.
- **Hosting and netcode:** `packages/server/src/index.ts` and `packages/client/src/net/*`.
  - The playtest session owns them.
- **Rendering performance:** `packages/client/src/render/MapView.ts`, plus the client render loop where you can avoid it.
  - The playtest session is tuning frame rate.
- **R5 code** (camp states, chests, passives: `sim/camps.ts`, `sim/chests.ts`, `shared/rewards.ts`, `shared/skills.ts`, the chest panel).
  - Read it if you need to, and hook in rather than rewrite.

**Files you share with other work.** R5 already edited `ui/minimap.ts`, `ui/mapPainter.ts`, `ui/planning.ts`, `ui/helpOverlay.ts` and `scenes/RaidScene.ts` on the client, and `sim/world.ts` (the `ChainableHook` union), `sim/gameplay.ts`, `sim/mobLife.ts`, `shared/schema.ts`, `shared/messages.ts`, `shared/constants.ts` and `rooms/RaidRoom.ts` on the server. R2, the bot rewrite and the playtest session will change several of them next. Keep every edit to these a small appended block (one new import, one new call, one new row, a new union member at the end on a line of its own) and put the real work in new files, so the next rebase is mechanical. `packages/client/src/main.ts` (the flow: hub, run, results) is shared the same way.

---

## 2. Package K1: your quest system on current main, playable in the browser (start now)

K1 is the foundation of the approved design (section 3 lists what K2 adds on top), so none of it is wasted.

Read `QUESTS_REVIEW.md` before you start. The confirmed blockers and majors in it that K1 owns are folded into the items below. **K1 is not done until each is closed and has a test that fails when the fix is removed.** In your report, list the review findings you closed by their numbers. K1 owns #1-#9, #13, #19-#23 and #28-#32, plus the GV part of #12, the finder's head start of #14 and #25, and, for #27, only that a kill or collect quest whose camp is cleared closes early (K1.5). #11, #15, #16, #17 and the radius of #14 and #25 are K2 items; #10, #26 and the rest of #27 are settled by K3 and K2 item 14; #18 and #32 are the interface of K1.7 plus K3; #24 waits for R2. Give every finding one of: closed, K2, K3, not done (with the reason).

### K1.1 Port to 3f2da66
- Re-apply your commit (section 0). A trial merge of 3186691 into `3f2da66` conflicts in nine files: `server/src/config.ts`, `server/src/rooms/RaidRoom.ts`, `server/src/sim/arena.ts`, `server/src/sim/gameplay.ts`, `server/src/sim/mobLife.ts`, `server/src/sim/world.ts`, `shared/src/index.ts`, `shared/src/messages.ts` and `shared/src/schema.ts`.
  - Keep both sides in all of them except `mobLife.ts`. There, drop the `onKill(world, p, rt)` line (the function is gone with the kill combos) and put only the `mobKilled` call in main's `payMobKill`, after `grantBuff(...)`.
  - In `messages.ts`, `ContainerKind` now ends with "reward": add "quest" after it. `GvReason` now ends with "skip": add "quest" after it, each on a line of its own.
- **Hooks.** In `sim/world.ts`:
  - Add `"mobKilled"`, `"playerKilled"` and `"planningStarted"` (K1.3) to the `ChainableHook` union (a private union; R5 added "campCleared" to it, so expect a one-line conflict if you touch the same line).
  - Add `mobKilled?(world, killer: PlayerRuntime, mob: { type: MobTypeId; zone: FactionId; camp: number; elite: boolean })` to `WorldHooks`. `zone` is `mobTypeById(type)?.zone`, and `camp` is the camp's index in `map.camps` (`MobState.camp` holds that index plus 1). Fire it from `payMobKill` in `sim/mobLife.ts`, after `grantBuff` (already inside `payLater`; a training world returns before it).
  - Widen the existing `playerKilled?(world, killer)` (fired from `creditKill` in `sim/arena.ts` after the bounty hook, only for a credited player kill) to `(world, killer: PlayerRuntime, victim: PlayerRuntime, outcome: "died" | "mia")`, with `outcome` passed into `creditKill` as a new last parameter by its two callers (`applyHits` passes "died", `downPlayer` passes "mia"). Do not read `victim.down?.outcome`: outside a ledger pass `payLater` runs `creditKill` at once, before `downPlayer` sets `rt.down`, so for a death by `applyDamage` (tests, the headhunter test) `down` is still null and the outcome would be undefined. "mia" is a leaver credited to the last rival, which a player-kill quest must not count. Update its one caller (`creditKill`, whose own two callers pass the outcome) and the test that sets it directly (`packages/server/test/buffs.test.ts`, "runs a previous bountyClaimed and playerKilled first ...").
  - `dropBody` is not in the union: wrap it by hand as your branch did, or add it.
- **After the merge expect these failures, and fix them:**
  - the two typecheck errors in `packages/server/test/quests.test.ts` (lines 304-305, the `{ hp: "stacksHp", ... }[stat] as const` lookup, which goes away with K1.2);
  - the removed-API compile errors (K1.2);
  - the two `toEqual` results in `packages/server/test/planning.test.ts` (around lines 482 and 538), whose `gv` object needs `quest: 0` once `GvBreakdown` has the field, and the three `toEqual({ kills: 0, mobs: 0, bounty: 0 })` on `rtOf(world).gv` in `packages/server/test/trainingConsole.test.ts` (lines 458, 694 and 713), which fail at run time once `PlayerRuntime.gv` has `quest`.

  Run the whole server suite, not only the quest tests.
- **Keep:** the catalog texts, `selectQuests`, `spreadSpots` and the dense-map fallbacks; the `QuestRuntime` / `QuestsRuntime` shape; the `tieRank` tie-break; `QUEST_MAX_CARRIED`; `SimConfig.quests` (off in the bare sim; tests opt in; see K1.8 for the default); the one-line `loot.ts` delegation; the 16 server tests as adapted.
- **Replace:** `grantStacks` and `reward.stat` (K1.2); `parityStacks` and its shared tests (re-derive them); the uncapped `awardQuestGv` (K1.2); `QuestState.known` and x/y for unknown quests (K1.4); the single `raidStarted` spawn of the whole roster (split into roll and spawn, K1.3); the direct `world.hooks.mobKilled` assignment (above); giver mobs (K1.5); `clearRoster` in tests; `quests.test.ts` lines 304-305.
- **Correct** the false statements in `docs/quests.md` (K1.8).

### K1.2 Rewards through the buff system
- Your quests grant the old three-stat stacks (`stacksHp` / `stacksAs` / `stacksMs`, `grantStacks`, `BuffStat`, `buffMultiplier`, `rollBuffStat`). None of these exist on main. `QuestDef.reward.stat` must become a `BuffId` (a mob type id), and the grant is `grantBuff(world, p, rt, id, amount)` from `packages/server/src/sim/buffs.ts` (it ignores a player who is not alive or whose result is already out).
- **Which buff.** Defaults (change them and say so in the report):
  - a quest with `def.region` pays that zone; a region-less one (elite-hunt, headhunter, grand-tour, cache, tithe-rim, long-haul) pays the zone whose `regions[].pole` is farthest from its giver (ties by `FACTION_IDS` order);
  - the buff is the first live type of `normalTypesOf(zone)` (live = `buffDef(id).needs` is undefined), except elite-hunt, which pays `eliteTypeOf(zone).id` when that is live and the zone's first live normal type when it is not. A buff with `needs: "status"` is never applied on main (`sim/mods.ts` `buildOf` skips its rows and `buffRowsOf` leaves them out), so the plain `[0]` rule would pay Frost quests a Frost Wisp, and elite-hunt in Frost a Glacial Warden, that do nothing. Sentenced's only live normal type is Bailiff, which helps only a Sentenced player (`worksWith: ["sentenced"]`, it raises mark rate): pay it anyway in K1, and in the report say how many completions paid it to a non-Sentenced player (K2 item 14 revisits it). Add a shared test that no def, on seeds 1..30 plus 7829 and 10760, pays a buff whose `needs` is set.
  - That way a quest is a way to get a buff your spawn didn't give you, which is the point of quests.
  - Make the buff a pure function in shared code of (def, giver position, map), so the planning screen and the log can show it. Or sync it as `QuestState.reward` (a `BuffId` string).
- **How much.** Scale quest stack rewards by `mobRewardFor(world, p, rt)` (`sim/feed.ts`): the reward curve at the player's feed times the catch-up against the lobby median, which is what mob kills use. Using `rewardCurve` alone would silently drop the catch-up. Completion runs in `world.systems` after the ledger pass, so it reads the live median. Value rewards in the same units as a mob kill: `mobBuffStacks(elite) * m` stacks (1.1 for a normal mob and 3.1 for an elite, before `m`). Do not pay more than about 6 stacks of one buff: the buff curve is nearly flat above it.
- Heals, if any, go through `heal()` in `sim/factions.ts`, which applies the 3 s out-of-combat lockout.
- **Quest GV: its own pot, capped.** Your version is uncapped, which lets throwaway callsigns farm it. Add `QUEST_GV_CAP = 24` to `constants.ts` and cap it the way `GV_MOB_CAP` is capped in `awardGv` (`sim/arena.ts`): inside `awardQuestGv`, `amount = Math.min(def.gv, Math.max(0, QUEST_GV_CAP - rt.gv.quest))`, then `credit()`, so `PlayerState.gv` and the `gv` event stay right. Quest GV never counts toward the win-bonus gate.
  - Everything the bucket touches (grep for `gv: {` and `bounty:`): the `addPlayer` literal in `step.ts`, `PlayerRuntime.gv` in `world.ts`, `credit()` and `unbankedGv()` in `arena.ts` (a shutdown must still pay it), `resolve()` (the `GvBreakdown` and the total), `GvReason` and `GvBreakdown` in `messages.ts`, `GV_TOAST` in `RaidRoom.ts` (an exhaustive `Record`), `gvRows` in the client's `ui/results.ts`, and the `gv` literals in about a dozen test files (client `results.test.ts`; server `arena`, `buffs`, `ledger`, `lifecycle`, `mobs`, `movement`, `planning`, `room`, `training`, `trainingConsole`; `planningRoom` and `shutdown` match with `toMatchObject` and need no change).
  - `RaidRoom.settle` banks `result.gv.total` only. Add no achievement, stat or profile field for quests (any would need a `ProfileStore` migration, and mob kills do not feed achievements either).
  - Show the pot in the results breakdown row you already added.
- **Re-derive your balance worksheet** (`docs/quests.md` section 6) against the new rewards. Use `buffPower` to value a reward, import the constants (`MOB_BUFF_STACKS`, `GV_MOB`) instead of hard-coding 1.1 stacks and 2 GV per mob, and state your assumptions. Treat it as a first pass: K2 item 14 rebalances after questBench measures real times.
- Replace `reward.stat`, `parityStacks` and `STACK_PREMIUM`; re-pin the shared catalog test (it asserts every buff stat is fed by 3 or more quests) to zones, not to `BuffId`: assert that every zone is paid by at least 2 defs (`def.region` names it for 2 or 3 defs each) and that every buff the rule can return is live (`needs` unset).

### K1.3 The planning phase
- **Tick facts.** `step()` calls `updateActive` (and so `world.systems`) only when the phase is "active", and `updatePlanning` alone in planning. A system needs no planning guard.
  - But `state.serverTime` keeps advancing in planning. Store each quest's duration (`expiresAtSec`) and set `expiresAt = raidStartedAt + sec * 1000` in your `raidStarted` hook, as Wishes set `wishReadyAt`. The planning screen shows a duration ("lasts 150 s from the start"), not a countdown.
  - Hooks that fire in planning (`fighterOut` with cause "removed" for a player who leaves) must tolerate fighters and quests that do not exist yet.
- **When to roll.** Write one idempotent `ensureQuests(world)`, like `ensureRosters` in `sim/camps.ts`.
  - Call it from a new chainable `planningStarted` hook (add it to `WorldHooks` and the `ChainableHook` union, and fire it at the end of `startPlanning` in `sim/planning.ts`, after `dealSpawns`), and from your `raidStarted` hook, where it does nothing if it already rolled. Worlds with `planSeconds` 0 (training, the harness, benches, most tests) never see a planning start.
  - The roll needs the number of starters, known at planning start (`world.arena.startedWith`). In K1 the roster is 5 known and 5 unknown whatever the size, but write the counts as one small function of the starters, so K2 only changes a table.
  - Gate it on `world.config.quests && !world.config.training`. A world with quests off, a training world or a map with no camps rolls nothing, creates nothing and draws nothing (`camps.test.ts` has the pattern).
- **The quest stream.** Draw only from a private quest stream forked from `world.rewardRandom`, so that switching quests on or off never shifts another reward roll (camp rosters, planning deals, chest options).
  - `rewardRandom` is a closure over a salt the world does not keep. Default: keep the salt words on the world, derive the quest stream from them with a tagged hash into its own `rewardStream`, and draw nothing from `rewardRandom` itself.
  - `QUESTS_PLAN.md` section 6.3 argues for four extra crypto words from `RaidRoom` instead (the public camp rosters reveal some bits of the reward stream's start state). You may do that if `rewardRandom` stays untouched; say which you chose.
  - No existing test that fixes a `rewardSalt` may change (server: `camps.test.ts`, `chests.test.ts`, `campWakeOff.test.ts`, `wishesCamps.test.ts`, `planning.test.ts`, `mods.test.ts`; shared: `rosters.test.ts`). Add a test: the next `rewardRandom()` value is the same with quests on and off.
- **Placement happens off the hot tick.** Place at planning start, when the world is frozen (worlds without planning place at `raidStarted`, so keep the cost low there too). Placement still blocks the event loop: the reviewers measured 5-24 ms and 14-81 ms per map on R2-style 96×96 maps, against a 50 ms tick, mostly `findPath` inside candidate loops (`freeTileNear`, `parcelSpot`, the token scatter). Replace per-candidate pathfinding with one BFS flood per giver, or with candidate and walk tables computed once (R2 already computes spawn walks in its map worker; when R2 lands, move the tables there), or spread the work across several ticks. Report the measured milliseconds per map.
- **Only the known quests exist during planning.** Their `QuestState` entries are in synced state. Containers (and givers, if you keep them as mobs, K1.5) are created at `raidStarted`, as the camps' mobs are.
- **Show the known quests on the planning screen** (`ui/planning.ts`): name, kind, giver position on the planning map, duration and reward (the buff). Add a small section styled like the existing camp chips, and keep the edits to that file small. Add the quests to the `PlanningFrame` that `RaidScene` builds each frame. Players use this to choose their spawn and route.

### K1.4 Hidden information
- An unknown quest is a server-only `QuestRuntime` (position, tokens, parcel, reveal state) until its public reveal. In your branch it leaked five ways: a synced position, the giver as a roster entry, tokens and parcels labelled with the quest name, synced progress, and container-id gaps that count the hidden pieces.
  - At the public reveal, in one tick, create its `QuestState`, its containers (and its giver, if you keep one), and draw their ids then.
  - Drop `QuestState.known`. Add `RaidState.questsHidden` (uint8, the count not yet public) for the "+5 rumoured" line on the planning screen. Add `QuestState.foundBy` (the finder's callsign, "" for a quest that was public from the start), set in the tick the quest goes public: it is how every client's `questNews` says who found it.
- **Reveal and head start.** Each tick, the standing player within `QUEST_REVEAL_RADIUS` of the site with the lowest `tieRank(world, id)` is the finder. Keep your branch's radius (12 tiles) in K1; K2 item 8 shrinks it, and at 12 tiles about 2 of the 5 unknown quests reveal on tick 0. Ties use `tieRank` as in your branch; CLAUDE.md Known TODOs says what that exposes, so write it in `docs/quests.md`.
  - Send the finder the private message first. Set `revealAt = serverTime + 4000` on the runtime (tick time, so it fires even if the finder dies or leaves), and make the quest public at `revealAt`. During the head start only the finder can progress it.
- **How a private message is sent today: copy the planning deal.**
  - Sim: `emit(world, { type: "plan", to, plan })` (the `SimEvent` union in `sim/world.ts`; `planning.ts` `sendChanged` sends only when the serialised message changed).
  - Room: `RaidRoom.handleEvents` has `case "plan": this.sendTo(ev.to, "plan", ev.plan)`, and `onReconnect` resends it because it is in no synced state.
  - Wire type: `ServerMessages` in `shared/messages.ts`.
  - Yours: add `{ type: "questFound", to, quest, x, y, publicAt }` to `SimEvent`, one case in `handleEvents` and one `ServerMessages` entry. No resend on reconnect (it lasts 4 s). The existing `toast` event is already private to one player but cannot carry a position.
  - Client: register `room.onMessage` in `RaidScene.create` and unbind it on shutdown, as `unbindResult` does for "result". The `PlanInbox` pattern (`net/planInbox.ts`, wired in `main.ts`) is needed only for messages that can arrive before the scene starts, which a mid-run reveal cannot, and `net/` is off-limits, so use none. Put any inbox class in a new file outside `net/` (for example `ui/questInbox.ts`), and list the `main.ts` and `RaidRoom.ts` lines you touch in the report as shared-file edits (section 1: one appended block each).
  - Test over real sockets, like `test/planningRoom.test.ts` (`startServer`, SDK clients): only the finder receives it.
- **Test on the wire, not on `world.state`.** Build the Encoder/Decoder pair of `test/sync.test.ts` (`connect()`, `encodeAll`) and assert that the decoded state holds no `QuestState`, mob, container or roster entry for the hidden quest, and does after 4 s. Mutation-check by publishing at roll time: the test must fail.

### K1.5 Quest givers, tokens and parcels
**Givers.** Default: plain entries. `QuestState` already has x and y, so `QuestView` draws the giver from it and no `MobState` is created: no `MobKind` "quest", no `hostile()` change, no roster entry, no Wish or hit-test case, no client mob loop to patch. This is the fix for review findings 2 and 29: your giver mob was a solid body that arrows, wand balls, melee arcs, signatures and ability trails all met.
- If you keep givers as mobs instead (your call; say which in the report), arrows, balls, swings, signature contacts and ability trails must ignore them. `hostile()` in `combatant.ts` is only consulted by `targeting.ts` `lockable()`, `weapons.ts` and `abilities.ts`; `melee.ts`, `projectiles.ts`, `factions.ts` and `abilities.ts` iterate `standingCombatants()` and never ask it. Exclude givers in `standing()` or in each loop, test each weapon and each Wish against one, and patch the client: the mob loop in `RaidScene` (it draws a fighter with an hp bar), the click candidates (without a filter a click on a giver makes the prediction expect a lock, and the walk is re-planned only after `ORDER_EXPIRE_MS`) and the signature "others" list. `minimap.setMobs`, `screenFeedback` and `buffsHud` already skip them.
- Whichever you choose, add tests: the target lock refuses a giver, mob AI ignores it, melee, projectiles and Wishes cannot hit it, an arrow aimed past it keeps flying, a giver never becomes a signature target, it never wakes a camp, and the Wish status runtime cannot apply a status to it.

**Placement** must not depend on the old wedge map: R2's 96×96 zone maps are coming. Your `placeQuests`, `npcCandidates` and `parcelSpot` read wedge-only data. Place from the R0 map contract fields instead.
- Use `GameMap.camps` (`CampDef`: `zone`, the centre `x`/`y`, clearing radius `r`, leash `radius`, `spots`, `eliteSpot`, `chest`), `spawnPool` (`{ x, y, zone }`), `regions[].pole`, `coliseum.centre`, and the tile helpers in `shared/src/map.ts` (`tileIndex`, `worldToTile`, `tileToWorldCenter`, `regionAt`, `isWallTile`; `circleClear` is in `geometry.ts`).
- Replace `regions[].anchor` with `.pole`, `regionGrid`/`regionCode` with `map.camps.filter(c => c.zone === zone)` (a zone's places come from its camps' centre, `r`, `spots` and `chest`), `map.spawns` with `map.spawnPool`, and the ring radii written as fractions of `map.w` (tuned for 64×64) with tile distances from `coliseum.centre`. Do not read `map.spawns`, `regions[].anchor` or the `coliseum.rect` annulus. `ColiseumDef.rect` is in tile units, its `centre` in world units. `territoryGrid` is all 0 on wedge maps, so it cannot stand in for `regionGrid`. `shared/planning.ts` has `spawnWalks` and `walkSeconds` for walking distances.
- Read the camp count from `map.camps`; do not hard-code it (R2 will give 3 or 4 per zone). Keep tokens and sites off a camp's `chest` tile.
- Keep your dense-map fallbacks. Hand-built test maps (`mapFromTiles`) have empty `camps`, `spawnPool` and `regions` and a zero-size coliseum, so `placeQuests` offers no quests there, and the tests that call `offerQuest` by hand keep working.
- Test placement on generated maps (seeds 1..30 plus 7829 and 10760).

**Containers and pickup today** (tokens and parcels are `ContainerState` entries of kind "quest").
- `ContainerState { id, kind, x, y, label, items[{ uid, def }] }` lives in `state.containers` (R5 added kind "reward" and three arrays `options`, `takenBy`, `pickers` to it). Create one only with `addContainer()` (`sim/loot.ts`), which records its birth tick so nothing can be taken in the tick it appears.
- The input is `pickup { containerId }` (key F). `handlePickup` refuses unless the player is standing and not `actionBlocked`, within `INTERACT_RANGE` (56 u), with a line of sight on `collisionMap(world)`, and the first item is a weapon id. A ground weapon is deleted when taken; chests and bodies stay as empty props. R5 chests are taken with `choose`, and `pickup` on one says "Nothing to take". Keep your single delegating line for `quest:` items that small.
- Client: the F key goes through `render/interact.ts` `nearestContainer()`, which today returns only containers whose first item is a weapon (`containerWeapon`; it also returns null for a "reward" chest). So F ignores a token or parcel, `ContainerHighlight` draws nothing for it and the weapon-bar hint stays silent. Widen it to a `containerPickup(c)` that returns a weapon or a quest item (test it), give `ContainerView` a label per kind, and draw a token or parcel in `ContainerView` or `QuestView`, not both.

**Collect tokens carry cap.** Your collect branch consumes a token even when the picker's progress is already at the count (`removeBox` always runs), so one player can empty a camp's tokens in seconds and deny everyone else (review finding 3). Fix: a pickup that would put the player past what the objective still needs is refused and leaves the token on the ground, with a toast. Test it with a 5-token, count-3 quest and two players. K2 item 12 states the same rule for the catalog.

**Carriers.**
- A player carrying a parcel is visible to everyone, as you designed. The parcel is drawn on the carrier, and the minimap shows the carrier's position (K2 item 10 makes the minimap blip fuzzy; keep the marker's position in one function so K2 can change it).
- A carrier hidden by Swarm (the Plague Wish) or blinking (Blaze Step) keeps the parcel. Swarm hides the body (on the client, as for any hidden fighter), not the parcel marker. A stunned or displaced carrier is fine: pickup already goes through `actionBlocked`. Test a Swarm carrier and a blinking carrier.
- The parcel drops where the carrier goes down (your `dropBody` hook covers the leave and MIA paths, which go through `downPlayer`).

**Quests close at the coliseum teleport.** Your runtime ignores the teleport, so after the gates lock every giver is out of reach (turn-in needs a line of sight on `collisionMap`) while open quests keep ticking in the log. Default: at the teleport every open quest closes without pay (giver, tokens and parcel removed, carried parcels vanish, status "expired", the entry removed after the same 20 s as a finished quest, below); nothing opens afterwards, and nothing is left at `runEnded`. Hang it on `chainHook` "teleported" and "runEnded" (`mobLife.resetAllMobs` and `chests.clearChests` are the models). Document it in `docs/quests.md` and test it.

**Finished quests are cleaned up.** Your finished quest never expires: its giver and entry stay all run. When a quest is paid, its giver, tokens and parcel go away at once, and its synced entry stays only for a short while (default 20 s) so the log can say "done by X", then is removed. A quest that can no longer be finished (for example its camp was cleared, the `campCleared` hook; camps never respawn now) closes early the same way: status "expired", then its entry is removed after the same 20 s.

### K1.6 Client UI (the missing half)
Players cannot see quests in the browser today. Build it. Put pure logic in new pure modules with unit tests; DOM and Phaser drawing go in new files where possible.
- **Quest log panel**, toggled with **J**:
  - each visible quest: name, kind, objective and progress (yours / needed), time left, reward, and status (open, done by X, expired);
  - unknown quests shown only as a count until revealed.
  - Add a `KeyJ` case in `RaidScene.handleKey` (physical key codes). `handleKey` returns early while `frozenWorld` (planning), so put the J case before that return: the log should open in planning too.
  - Follow the overlay rules in CLAUDE.md: the `#ui` layer uses `--ui-w` / `--ui-h` and `data-ui-short` / `data-ui-narrow`, never `vw` / `vh`; use `getBoundingClientRect()` for anything the pointer meets. Look at `ui/minimap.ts`, `ui/buffsHud.ts` and `ui/toast.ts` for the house style.
- **World drawing**, colored shapes only, like the rest of the game, in a new `render/QuestView.ts`:
  - quest givers as a distinct NPC shape with a "!" when they have an open quest;
  - tokens and parcels as small distinct shapes (see "Containers and pickup today" in K1.5);
  - a marker over any parcel carrier.
- **Minimap:** known givers, your active objective, and carriers. "Active objective" means the quest you carry a parcel for or have progress on: its giver when you are ready to turn in, else the nearest token or parcel. The minimap repaints only when a hashed input changed, so add the quest blips to that hash. Keep the minimap edits small, since R5 added chest blips to the same file.
- **Toasts:** quest revealed (with who found it), completed by X, expired, parcel dropped or stolen, "you can carry one quest item".
  - World-wide news comes from a pure `questNews(prev, next)` that diffs `state.quests` between patches. A quest that closes without pay (its timer, the teleport, its camp cleared) keeps its synced entry with status "expired" for the same 20 s as a done one (K1.5) and is then removed, so the diff itself says "expired" and `questNews` needs no memory of earlier patches. Private news goes through the existing `toast` event. `Toasts.show` keeps three visible and merges repeats, so batch.
- **Turn-in hint** when standing at a giver with a finished objective.
- **Inputs.** K1 adds no client input: pickups use `pickup { containerId }` and turn-in is automatic (`QUEST_TURN_IN_RANGE` 64 u plus a line of sight), so the "turn-in hint" is a prompt to walk to the giver, and `CLIENT_MESSAGE_TYPES`, `inputs.ts` and `MAX_ACTIONS_PER_TICK` stay untouched. If you think one is needed, say so in the report. If you ever add one (K2 item 7 will), the checklist is:
  1. `messages.ts`: add to `ClientMessages` and append to `CLIENT_MESSAGE_TYPES` (`RaidRoom` registers one `onMessage` per entry; R5 appended `choose` and `train`).
  2. `inputs.ts`: an `ActionCommand` variant, a strict parser that refuses the whole message on any bad field (as `parsePlan` does; ids through `parseId`, 64 characters at most), and a case in `enqueueClientMessage` (false means rejected and does not count as presence).
  3. Register the handler in `world.actions[kind]` in `install()`. `step.ts` runs it only for a standing player in an active run, in arrival order, and planning drops everything but `plan`. The Room's `onMessage` only enqueues.
  4. At most `MAX_ACTIONS_PER_TICK` (6) actions per player per tick are kept, and the Room disconnects a client past 100 messages a second.
  5. A refused input must answer like one for a quest that does not exist, so it cannot be used to probe hidden quests.
  6. Test in `test/inputs.test.ts` and a sim test.
- **Training.** Keep the `world.config.training` guard in `install()` (your branch has it). A training room is the same `RaidRoom`: `buildWorld` forces `{ dummies: true, training: true, planSeconds: 0 }`, so it has no planning, camps, patience timer or teleport. `state.quests` stays empty, a training world draws nothing from the quest stream and never creates a quest container or giver. Client: `RaidScene` knows `this.training`; the J panel opens with "No quests in practice", `QuestView` and the minimap draw nothing, and `planningModeFor` already returns hidden. Test: a quest-enabled config still gives a training world no quest (pattern in `test/training.test.ts`), and a client test for the empty panel.
- Add the J key to the help overlay (`ui/helpOverlay.ts`).
- Client tests run in plain node, not jsdom: use `test/uiDom.ts`, `test/planningDom.ts` and the fake scene in `test/fakes.ts`.
- A two-tab browser check (see "Running it" in section 1): describe what you saw, with screenshots if you can.

### K1.7 Bot hook (interface only)
- The bot session will build quest decisions into its own brain. Do not edit `server/src/bots/*`.
- Write a short `docs/quests-bot-hook.md` that says what a bot can read from synced state and messages to quest:
  - which fields hold quest positions, progress, timers, carriers and rewards;
  - which inputs it sends;
  - what it must not know (unknown quests before reveal).
- Keep the quest inputs the same ones a human uses.

### K1.8 Docs, config and tests
- **Config.** Your branch turned quests on unless `QUESTS=0`. Invert that while the client is missing: `loadConfig` has quests OFF by default (on only for `QUESTS=1`), and tests opt in through `SimConfig.quests`. Flip the default to on as the last commit of K1, after the two-tab check passes, and say so in your report. If K1 is handed in without the client, leave it off. Add `QUESTS` to the server env list in CLAUDE.md and to the environment table in README.md.
- **Docs.** Update `docs/quests.md` and the CLAUDE.md sections a quest system touches: Layout, the relevant Architecture rules, the tick order, and Known TODOs (its "Not built" line still says "quest NPCs"). Also the README controls table (the J key) and its "Not built" line. Be honest about what is not done. Correct the claims in `docs/quests.md` that the code contradicts: that unknown quests sync with no position, "no farming first" (timers do not bind until K2 item 7), that carrying one item is the throttle for collect quests, "no cap" on quest GV, that a run is planned at spawn and you can see five of the ten offers, and the slack and parity figures, which came from walking-time estimates 2-4 times too high.
- Keep your 16 server tests and the shared catalog tests, re-pinned to the new rewards. Add tests for:
  - planning freeze (nothing quest-related changes in planning);
  - hidden quests absent from the wire (K1.4);
  - the reveal head start, and only the finder progressing during it;
  - giver immunity;
  - the GV cap;
  - the collect cap;
  - closure at the teleport and cleanup of a finished quest;
  - the Swarm and blink carrier rules;
  - `mobKilled` carrying type, zone and camp, and being chained rather than assigned;
  - the training room having no quests.
- Mutation-check the important ones: the test must fail if the rule is removed.
- **Gates with quests on.** The perf and bandwidth gates build their own `SimConfig` without quests. Give `stepBench` and `bandwidth` a `quests` option (default off), run both once with it on and report the numbers. Main is at about 7.7 KB/s typical and 11.7 KB/s heavy (seed 1) against a gate of 20, and your quests add rows and up to 20-40 containers.

**K1 is done when:**
- the three gates pass;
- every confirmed blocker and major in `QUESTS_REVIEW.md` that K1 owns is closed, with a test;
- a two-tab check shows quests on the planning screen, in the log, in the world and on the minimap, with a completed quest paying a real buff;
- docs are updated;
- you hand in (section 5).

---

## 3. Package K2: the approved "Combine" design (starts after K1 lands)

The owner chose to combine the two designs: your code is the base, plus the essential fixes from the maintainers' `QUESTS_PLAN.md`. Its elaborate mechanics stay out of v1. **K2 starts after K1 lands.** Items 1-4 are already in K1, and parts of 9 and 12 are in K1.5. Keep the catalog data-driven, so most of K2 is data and rule changes.

1. The roster is rolled and placed when planning starts (K1.3), from a quest stream forked from `world.rewardRandom`, so switching quests on or off never shifts other reward rolls.
2. Unknown quests stay hidden until revealed. The finder gets a private message and a 4 s head start (K1.4).
3. Rewards are real R4a buffs through `grantBuff`, scaled by the mob reward multiplier (the reward curve with the catch-up, K1.2).
4. Quest GV is in its own pot, capped at `QUEST_GV_CAP` = 24 per run (K1.2).
5. Per-player cap: at most 3 quest completions per run.
6. The number of quests scales with the lobby size, as known + unknown: 3 + 3 at 2-3 players, 4 + 4 at 4-5, 5 + 5 at 6-7, 6 + 6 at 8.
7. Timers that bind:
   - Quests open in waves, not all at t=0 (for example a third at 0:30, a third at 1:15 and a third at 2:00 from the run start, compressed if the live patience window is shorter).
   - A player must take a quest at its giver before kill or collect progress counts, so passive farming no longer fills kill quests. Taking is a small input (see the checklist in K1.6) or walking into the giver's ring.
   - Each taken quest has a personal timer, measured from the take and sized from measured walking times (questBench), so a player cannot farm on the way.
   - Keep first-to-finish: several players may take the same quest, and the first to finish wins.
8. The reveal radius is smaller than the spawn doorstep: reveal at 6 tiles, and place givers at least 8 tiles from every `spawnPool` spot, so no unknown quest reveals on tick 0.
9. Every open quest closes at the coliseum teleport (carried items vanish), and nothing reopens after it in v1. K1.5 already closes quests there; K2 adds that the schedule and the waves never reopen one.
10. Carriers: the parcel is drawn on its carrier for anyone who can see them, and every client gets a fuzzy 300 u minimap ping of the carrier every few seconds, not an exact position. Swarm hides the body but the ping still shows.
11. Steals: the parcel drops on the carrier's death. Anyone can pick it up and deliver it for 50% of the reward, and at most one steal per parcel.
12. Collect tokens: a player can carry at most the tokens their objective still needs, and a pickup past the objective is refused and leaves the token. (K1.5 fixes the bug; K2 checks the rule for every collect def in the catalog.)
13. Headhunter (kill a player) is kept only with guards:
    - off below 4 players;
    - the target must be a real leader (feed at least the median + 1);
    - the payout needs the victim to have been alive 15 s after the take;
    - at most once per killer-victim pair per run.
14. Rebalance after questBench: for every quest, the time it takes (questBench's median completion time, with measured walks on the 96×96 maps) divided by the time farm-only needs to gain the same `buffPower` at the R5 pace is between 1.0 and 1.35: a quest costs the same time as mobs for the same power, or a little more for the risk, never less. Replace seven near-clone defs (QUESTS_REVIEW.md, design reviewer, spec check 6, counts seven without naming them; the clone families are the four `cull-*`, the five region-token collects and the five `banner-*` fetches, and the orchestrator names the seven when K2 starts) with distinct quests (ideas in `QUESTS_PLAN.md` section 3, for example Sealed Letter, Signal Fires, Cartographer's Survey, Coin Rain and Four Gates), keeping 20 in the catalog.

**Not in v1** (from `QUESTS_PLAN.md`): claims with private receivers, bound champions and packs, the Tax Convoy, a second season after the teleport, the focus rule, the Idol hot potato. They can come later if questBench shows they are needed.

---

## 4. Package K3: questBench, a balance harness (can run in parallel with K1)

The owner wants quest balance measured, not guessed: time to complete roughly equals the time to earn the same benefit from mobs, or slightly more for the risk. Its numbers decide K2 item 14. Build a headless harness, modelled on the existing ones:
- the weapon harness in `packages/server/src/harness/` (entry `runHarness.ts`, run as `npm run harness -w @raid/server`);
- the duel benches `packages/server/bench/mobDuel.ts` and `bench/campDuel.ts` (run as `npx tsx packages/server/bench/mobDuel.ts`).

What it should do:
- Run N headless runs (sim only, no network) on many seeds.
- Use simple scripted policies that live inside the harness, not in `bots/`. Each policy chooses targets and sends the normal inputs:
  - **farm-only:** clear the nearest camps;
  - **quest-greedy:** go for the nearest open quest, otherwise farm;
  - **mixed:** quest when the quest's value per second beats the nearest camp's.
- Report per quest:
  - completion rate;
  - median and p90 time to complete;
  - fight power gained (`buffPower` before and after);
  - the time farm-only needs to gain the same power;
  - the ratio quest time / that farm-only time (K2 item 14 holds it between 1.0 and 1.35);
  - deaths and fights started near quest sites.
- Report per policy: power at minute 1, 2, 3 and 5, and win rate in mixed lobbies.
- Make it report only: it must never fail CI.

How to build it:
- **Worlds.** Build them with `createGameWorld({ seed, random: mulberry32(seed + 1), rewardSalt: <a number, so runs repeat>, config: { minPlayers: n, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6, suddenDeathSeconds: 1e6, mobs: true, quests: true, planSeconds: 0 } })`. The default map is `generateMap(seed)` (about 20 ms, 80 ms the first time). The harness's `buildArena` makes hand-built arenas with no camps or `spawnPool`, so do not use it. Templates: `bench/stepBench.ts` (8 players, 60 mobs) and `bench/campDuel.ts` (fights through the target lock, as the browser does).
- **Driving players.** Like clients: `addPlayer`, then `enqueueClientMessage(rt.inputs, "move" | "target" | "pickup", ...)` and `step(world, TICK_MS)`. A policy may read only what a client sees (`world.state` plus the private reveal message), never `world.quests`.
- **Farm baseline.** Use R5's mobs: camps never respawn, camp-wide aggro wakes a whole camp, `MOB_K` is 0.22. `bench/campDuel.ts` measures camp clears.
- **Fight power** is `buffPower(player.buffs)` over the buffs main applies: leave out every id whose `buffDef(id).needs` is set (Chain Warden, Inquisitor, Bloatfly, Rot Monk, Frost Wisp and Glacial Warden are never applied, and `buffPower` counts them like any other buff), and say in the report header that you did. Do the same when K1.2's worksheet values a reward.
- **Where.** `packages/server/bench/questBench.ts`, with `"questbench": "tsx bench/questBench.ts"` in `packages/server/package.json`, run as `npm run questbench -w @raid/server -- --quick --seeds N --players N` (flags need the `--`; a root alias is optional). Add a `--quick` smoke test in `test/`, like `test/harness.test.ts`.
- **Maps.** Until R2 lands it runs on the wedge maps. Its numbers are final only on the 96×96 maps, so re-run it when R2 is on main.
- Keep the step budget in mind: the perf gate is avg < 5 ms and p99 < 15 ms with 8 players and 60 mobs.
- Document how to read the report at the top of the file.

K3 can start on your current branch and move onto K1 when K1 lands. Get a first report out early.

---

## 5. How to hand work in

For each package:
- **Branch and commits:** commit on its own branch, cut from the stated base commit (`3f2da66`, or the newer main the orchestrator names). One or a few commits with clear messages, and no AI attribution lines.
- **Files to provide:**
  - a patch: `git format-patch <base>..HEAD --stdout > RougeHalla-<package>.patch`;
  - a bundle: `git bundle create RougeHalla-<package>.bundle <base>..<branch>`;
  - the full output of `npm run typecheck`, `npm test` and `npm run build`, and the failures of `npm test` on the pristine base.
- **A short report:**
  - what you did;
  - what you decided and why (the giver model, the quest stream, the default buff rule);
  - which review findings you closed, by number;
  - what you did not do;
  - any line you had to change in a do-not-edit file (section 1), and your edits to shared files, including the `main.ts` and `RaidRoom.ts` lines of the private reveal;
  - flaky tests you re-ran;
  - what to check in the browser.

The owner passes these to the orchestrator, which tests and reviews them before anything reaches main.

---

## 6. What else is happening (so you can plan around it)

- **R5** has landed (main is `3f2da66`; section 0 lists what it changed), so you build on it and need no rebase for it. K1 keeps every edit to the files R5 touched append-only (section 1).
- **R2**: 96×96 zone maps with 3 or 4 camps per zone (the R1 note recommends 4, about 20 camps and 80 mobs; `docs/ROGUELIKE_PLAN.md` D4 says 3 unless there is room), together with themed zone terrain, lands next. Read the count from `map.camps`. Your placement must work on those maps: use the map contract fields, not wedge geometry.
- **Human-like bots** land after R2. They will consume your bot hook.
- **Playtest hosting, netcode and frame rate** may land before R2. It owns `server/src/index.ts`, `client/src/net/*` and the render loop.

Questions you can't answer from the repo: write them in your report with the default you chose, and keep going.
