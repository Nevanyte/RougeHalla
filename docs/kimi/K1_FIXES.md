# K1 and K3 fixes before merge (round 2)

Your K1 (`592f2a2`) and K3 (`4e96e9d`) were tested and reviewed. The good news first:
- typecheck, all tests and the build pass;
- the hidden quests are out of synced state;
- the GV cap, the collect cap and the giver guards work and are mutation-covered;
- the UI draws once and reuses its objects;
- bandwidth with quests on is 6.3 KB/s typical, 10.0 heavy, against a gate of 20;
- `step()` with quests on is 0.18 ms average.

The verdict is **merge after fixes**. The full review, with evidence and repro scripts, is `docs/kimi/K1_REVIEW.md`. Fix everything in section 1 and as much of section 2 as you can, then hand in as before (section 5 of `KIMI_WORK_PLAN.md`).

**Base. Update: main is now `c6eb8ec`.** That is `0137dfa` plus a launcher message and doc fix, so merging either is fine. It contains the new 96×96 themed maps (R2, merge `e4c4f5f`) and the playtest hosting work (merge `0137dfa`). Merge `0137dfa` into `kimi/quests-k3` first, then do the fixes below on top of it.
- Section 3 lists the R2 conflicts.
- Playtest adds three more:
  - `RaidRoom.ts`: the `GV_TOAST` line. Keep playtest's constants and add `quest: "quest"`.
  - `CLAUDE.md` and `README.md`: keep both sides.
- Playtest's per-player order budget covers every client message type, so a new quest input needs no extra wiring. Its room caps and guards stay as they are.
- `play.roguehalla.com` now runs main, so your merged build is what players will get next.

**Where to work.** Please move out of the main RougeHalla folder into your own worktree now (section 1 of `KIMI_WORK_PLAN.md`). The maintainers' merges and the live site depend on that folder not changing branch.

---

## 1. Must fix (blocks the merge)

1. **Private quest stream** (review #1 and #5). Quest code must never call `world.rewardRandom` directly.
   - Derive a private quest stream instead, for example four extra salt words, or a tagged hash of the reward salt kept on the world.
   - Return before any draw when quests are off, in training, or on a map with no camps.
   - Tests: the next `rewardRandom()` is identical with quests on and off, for `planSeconds` 0 and above 0; and a map with no camps draws nothing.
2. **Hidden giver positions must not be computable** (review #2 and #4). Today anyone can recompute the hidden givers from the public seed plus the five known givers in about a second.
   - Place givers with full private entropy per pick. For example, shuffle the candidates with the quest stream and accept them greedily against the gap, or place the hidden spots in their own random pass.
   - Assign quest ids in shuffled order, not region-first.
   - Test: two streams that produce the same known positions give different hidden positions.
3. **Lifecycle** (review #3 and #7).
   - **Close at the coliseum teleport and at run end:** chain `teleported` and `runEnded` so every open quest closes without pay.
     - Published quests become `expired`; unpublished ones are deleted.
     - Givers, tokens and parcels are removed, and the carried map is cleared.
     - No reveal fires once `gatesLocked` is set.
   - **Remove the giver when its quest completes.**
   - **Close kill quests early** on `campCleared` when their zone has no live camp left.
   - **Drop finished or expired entries** from synced state after a short grace period (20 s is fine).
   - Flip the test that pins the old behaviour.
4. **Rewards use the mob catch-up** (review #6). Grant `qt.def.reward.stacks * mobRewardFor(world, p, rt)` in `quests.ts` around line 231. Flip `questRewards.test.ts` lines 89-97, and the sentence in the docs and CLAUDE.md.
5. **The reveal finder is the lowest `tieRank`** among standing players in range, not the first in join order (review #8). Add a test with a salt that gives the second player the lower rank.
6. **The tests must pass on the new maps** (review #12). Wherever a quest test passes a hand-built map to `createGameWorld`, drop the seed argument. On the R2 line, `createWorld` rejects a seed that does not match the map, and 36 of your 40 server quest tests fail there today.
7. **K3, before anyone reads its numbers** (review #9, #10 and #11):
   - **Ratio:** redefine it as the quest's own seconds divided by the farm-only seconds needed to reach the same power gain (KIMI_WORK_PLAN K2 item 14). Say in the header which direction is good.
   - **Farm-only baseline:** it currently dies within 14-44 s in most runs. Give it a survival and stall rule, and treat early deaths as censored instead of carrying their power flat.
   - **Power:** exclude buffs whose `needs` is set from `buffPower`, and say so in the header.
   - **Completion rate:** count attempts, not lobbies.
   - **Seats:** rotate factions in solo seats.
   - **Smoke test:** add a `--quick` test in `test/` so a rename can't silently break the harness.

## 2. Should fix (cheap, and players will notice)

- **The J log:** don't cover the HUD plate (the coliseum countdown and the buff strip), and let it open during planning and training.
- **Toasts:**
  - give the completer one toast, not two, so the +GV toast survives;
  - batch several quests expiring in one tick into one toast.
- **Closed quests:**
  - don't draw or list closed quests as live (no phantom givers);
  - stop the timers on rows that are done;
  - group the log rows by status.
- **F:** don't let F pick a quest item the server will refuse when a weapon pickup is next to it.
- **Placement:**
  - keep tokens and parcels off camp chest tiles and mob rest tiles;
  - keep givers out of camp clearings and off hazard floor (zone terrain's LOW and hazard tiles, from `docs/kimi/r2-map-contract-for-quests.md`).
- **Placement cost:** placement takes 55 ms median (79 ms max) of synchronous time per room on the 96×96 maps. Replace the per-candidate `findPath` with one BFS from the coliseum, or precompute it at planning start off the hot tick.
- **`mobKilled` hook:** carry `{ type, zone, camp, elite }`, not `{ region, elite }`, and add a test.
- **Docs:** fix the places where docs and CLAUDE.md contradict the code. The review lists them; for example, the bot-hook doc says expired offers leave synced state, and the planning rule says known givers exist during planning.
- **Bench options:** add a quests option to `stepBench` and `bandwidth`, and put both numbers in your report.

## 3. When the new maps (R2) land on main

The maintainers will tell you the new main commit. Then:
1. Merge main into your branch. Expected conflicts:
   - `RaidScene.ts`: take R2's `pickupMap` in the `updateChestPanel` call and add your quest block.
   - `ui/planning.ts`: keep both R2's `zoneLabels` and your `quests.markers`.
   - `sim/loot.ts`: imports; union `MASK_MOVE` and `QUEST_ITEM_PREFIX`.
   - `sim/world.ts`: the `ChainableHook` union needs `arenaHurt` together with `planningStarted`, `mobKilled` and `playerKilled`.
   - `sim/melee.ts`: a comment.
2. Re-run the gates, and `questBench` on the new maps. Quest timings need a re-tune: the map is 1.5× larger.
3. Hand in again. That build becomes the merge candidate that goes live on play.roguehalla.com.

K2 (the approved "Combine" list) starts after this round is merged.
