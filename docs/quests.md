# Quests

*K1 quest play on the current roguelike architecture. The shared catalog and placement live in `packages/shared/src/quests.ts`, the authoritative runtime in `packages/server/src/sim/quests.ts`, and the bot-facing contract in [quests-bot-hook.md](quests-bot-hook.md).*

## 1. What quests add

A generated-map raid offers ten optional, standing quests: five known during planning and five rumoured until scouted. A giver and its objective are deliberately far apart, so an offer is a route and exposure decision rather than another camp beside the spawn. There is no accept button and no personal instance: everyone races for the same offer, and the first eligible turn-in closes it for the lobby.

The K1 rules are deliberately small:

| Rule | Current behavior |
| --- | --- |
| Roster | `QUEST_COUNT = 10`, with at least two kill, two collect and two fetch offers; `QUEST_KNOWN_COUNT = 5`. |
| Timing | Each def has its own fixed `expiresAtSec`, from 150 to 300 seconds of active play. Planning does not advance it. |
| Rewards | A real `BuffId`, nominal stacks scaled by `mobRewardFor(world, player, runtime)` (the mob feed brake and catch-up), plus fixed GV from a separate per-run pot capped by `QUEST_GV_CAP = 24`. |
| Competition | Per-player progress, one global winner per offer, automatic turn-in at the giver. There is no per-player completion cap. |
| Hidden offers | Unknown offers stay server-side. The finder gets a private reveal four seconds before the offer enters synced state for everyone. |
| Items | Collect tokens advance progress on pickup. A fetch parcel has one public carrier at a time, and a player can carry only one parcel. |
| Training | No quests in training rooms. `QUESTS=0` (or `false`) disables them in arena rooms. |

The roster still has fixed size and fixed per-offer expiries. Carrying a parcel does not disable ordinary farm rewards, and carrier minimap markers are exact rather than fuzzy.

## 2. Planning and hidden information

The roster, quest-id order and every placement roll come from a separate private quest stream derived from the server's secret quest salt. Quest code never draws from `world.rewardRandom`, `world.random` or the public map seed, so turning quests on or off does not move later reward or world rolls. Setup returns before making any draw when quests are disabled, in training, or on a map with no camps.

Rolling begins when planning starts so the five known offers can inform spawn and route choices. The planning screen shows each known offer's name, kind, giver position, fixed duration (`expiresAtSec`, not a countdown while the world is frozen) and reward; the remaining offers appear only as a rumour count. During planning these are `QuestState` rows only: giver mobs and item containers are created at `raidStarted`, not while the world is frozen. The quest simulation does not tick in `planning`: nobody moves, fights, picks up an item, reveals an offer, turns one in or consumes its active-run timer. Raid startup anchors every active deadline to `raidStartedAt`.

Every hidden giver pick consumes private entropy, and quest ids are assigned in shuffled order rather than objective-region order. Consequently, generating the public map and observing the known givers or id gaps does not determine the hidden giver set. An unknown quest is not represented by a `QuestState` with `known: false`. Before reveal it has no synced quest entry, giver mob or item containers, so a modified client cannot read its def, position or progress from room state. `RaidState.unknownQuests`, the number still hidden from everyone, is its only public representation.

When standing players are within `QUEST_REVEAL_RADIUS` (12 tiles) of a hidden giver, the eligible player with the lowest secret `tieRank` is the finder; map iteration and join order do not decide the race. Then:

1. the server records that finder and sends only that client `questReveal` (`QuestRevealMessage`: `id`, `def`, `x`, `y`, `expiresAt`);
2. for `QUEST_REVEAL_HEAD_START_MS = 4000` the offer remains absent from public synced state;
3. the server then publishes the offer, its giver and its items to everyone, and a public toast names the finder.

No new reveal starts once `gatesLocked` is set. The head start is information, not a reservation: no objective progress or items exist before publication, and another player can still win afterward. Multiple pending `questReveal` previews are kept independently, so discovering more than one hidden offer does not discard an earlier preview; each is removed when its public entry arrives. Reconnecting does not entitle a client to hidden runtime data or another player's private messages.

## 3. Objectives and items

Every def in `QUEST_DEFS` supplies its display text, objective `count`, objective/travel estimates, reward and expiry. Progress is public per player in `QuestState.progress`; it is capped at the objective count. A standing offer needs both a finished objective and a turn-in within `QUEST_TURN_IN_RANGE`, with line of sight to the giver. Same-tick rivals use the sim's secret `tieRank`, not map iteration or join order.

### Kill

- **Region culls** require three ordinary mob kills in the named far zone.
- **Worth the Walk** requires an elite.
- **The Grand Tour** requires a mob kill in each of three different zones; server runtime keeps the visited-zone set and syncs its size as progress.
- **A Head for a Head** requires a player kill and uses the `playerKilled` hook with the victim and outcome. Only a victim outcome of `died` advances it; an MIA departure does not, even if ordinary kill/bounty rules credit a recent attacker. Its small reward is intentional because the kill, bounty and removal of a rival already pay.

Mob objectives are fed by the chainable `mobKilled` hook after mob spoils are queued. Its payload is `{ type, zone, camp, elite }`: the mob-type id, its zone, its camp index and whether it was an elite. Quest handlers chain rather than replace other hooks and never decide kill credit. A chained `campCleared` hook expires a kill offer early when no live camp remains that can supply its required objective, so an impossible offer does not stay open until its timer.

### Collect

Tokens are quest containers with more copies on the ground than the objective needs. Pickup uses the ordinary `F` interaction and increments that player's progress without occupying a weapon slot or the parcel slot. Once the player has the required count, further token pickup for that offer is refused and the excess token is not consumed. The client leaves such unusable quest items out of the F pick when a weapon is also available, rather than highlighting a pickup the server must refuse. Camp tokens avoid camp chest tiles and mob rest spots; the Quartermaster's Cache uses middle-camp sites and Offerings at the Edge uses outer starts and region poles rather than wedge-only rings.

### Fetch and carriers

A fetch offer places one parcel far from its giver. `F` picks it up if the player is not already carrying one. The ground container disappears, `QuestState.carrier` names the carrier, and everyone can see the carrier marker. The first carrier has no exclusive right to finish: on death the parcel drops where they fell and another player can steal it with the same ordinary pickup input. Completion, expiry, the coliseum teleport and run end remove a ground or carried parcel and clear its carrier link.

Displacement and concealment do not silently complete or destroy a delivery during ordinary active play:

- Swarm keeps the parcel. The honest client may hide the fighter, but the parcel and carrier marker remain drawn at the carrier's position.
- Blaze Step keeps the parcel through the blink.
- Going down still drops it. The coliseum teleport is different: it closes the offer without pay and removes the parcel rather than carrying it through the gates.

## 4. Runtime and presentation

`installQuests` joins the normal module architecture. The pure sim owns all decisions; Colyseus only validates/enqueues inputs and forwards events and private messages. Known state uses `RaidState.quests`, keyed by quest id. `QuestState` holds `def`, giver `x/y`, `status` (`open`, `done` or `expired`), `doneBy`, `expiresAt`, `carrier` and per-player `progress`; the shared def keyed by `def` supplies the name, kind, objective count and reward. Quest items use ordinary synced containers. Completion or expiry removes the giver and all items immediately. A public closed row remains for **20 seconds** with `status: "done"` or `"expired"`, then leaves both synced and runtime state. An offer that closes before publication is deleted immediately and never appears publicly.

Givers remain neutral `MobState` entries of kind `quest`, but are not combatants for gameplay purposes. Explicit guards keep them immune to target lock, mob AI, melee, projectiles and Wish targeting/effects. They do not wake camps, take damage or receive statuses. Clients should render them as quest NPCs, never as valid enemies, and only while their offer is open.

The quest system is a `world.systems` entry after mob AI and before the final stat-mod update. It runs only for an active raid, after the damage ledger and its deferred payouts. It handles reveal/publication, expiry, closed-row cleanup and automatic turn-in without changing the fixed combat order. A completion therefore cannot change who survives the tick's damage pass. Chained `teleported` and `runEnded` hooks close every open offer without pay: published rows become expired, hidden offers are deleted, and givers, tokens, parcels and carried links are removed. These hooks use the same closure path as ordinary expiry; no hidden reveal can begin behind locked gates.

### Rewards

Every def has an explicit `farZone`, and `QuestDef.reward.buff` names a real `BuffId` whose `buffDef(...).zone` is that far zone. Multi-zone and any-zone objectives therefore state their reward zone explicitly too. The old generic hp/attack-speed/move-speed stack rewards are gone. Completion pays `reward.stacks * mobRewardFor(world, player, runtime)` through `grantBuff`, so quest rewards receive exactly the mob feed brake and lobby-median catch-up and immediately refold the player's stat mirrors.

`buffPower` values the resulting build, rather than treating different buffs as interchangeable stats. The feed-scaled stack grant still follows the buff S-curve, and a player already holding that buff gets the marginal increase, not a flat quoted bonus. There are no quest heals in K1.

Quest GV is fixed by the def and paid through `awardQuestGv`. It has a separate per-run pot capped at **24 GV** (`QUEST_GV_CAP`), independent of `GV_MOB_CAP`; completions after the pot is exhausted can still pay their buff. Results show the `quest` breakdown row separately from kills, mobs, bounty and the win bonus.

### Placement

Placement uses the R2 map contract, not wedge-only annulus geometry. Generated maps are 96 × 96 with five organic zones, 20 camps, `spawnPool`, `regions[].pole`, zone `terrain`, `TILE_LOW` collision and a fixed central coliseum. Quest placement reads those finished map layers but never runs inside map generation, changes a hashed layer, or adds draws to the public map stream.

Givers must fit `circleClear(..., PLAYER_RADIUS)` on the movement mask, be reachable from the coliseum, stay outside its footprint and inner spawns, and remain at least three tiles from camp clearings. They may not occupy a camp chest or mob rest tile, `TILE_LOW`, or floor-hazard terrain (ember, bog, ice or light). Tokens and parcels likewise stay off camp chest and mob rest tiles and must be reachable. Themed offers put the giver far from the objective zone and fetch parcels prefer a long reachable haul; dense-map fallbacks may relax doorstep/spacing preferences or take the farthest reachable parcel, but never the collision, camp, terrain or hidden-entropy rules. Reachability uses the shared movement-mask navigation rules.

**R2 measurements — ORCHESTRATOR TO FILL FROM NEW LOGS.** No merged-R2 placement or terrain measurements existed when this section was written, so no numeric result is claimed. Replace each placeholder only with output from the new placement log, recording its path, command, seed set and machine/load context:

| Measurement | Result |
| --- | --- |
| Offers placed / dropped, and seed set | **PENDING — new log required** |
| Givers inside clearings, on chest/rest tiles, on LOW, or on hazard terrain | **PENDING — new log required** |
| Tokens/parcels on chest/rest tiles or unreachable | **PENDING — new log required** |
| Placement synchronous cost p50 / p90 / max | **PENDING — new log required** |
| Source log, command and run context | **PENDING — orchestrator** |

### Browser UI

- **J** toggles the scrolling quest log during planning and active play, positioned below the HUD plate rather than over the coliseum countdown or buff/passive strips. In training it opens with `No quests in practice`. Rows are grouped by status (open, done, expired); closed rows stop their timers, do not look live, and disappear when the server removes them after the grace period. Unrevealed offers contribute only to the rumour count.
- The world view gives open givers a distinct NPC shape and `!`, gives tokens and parcels distinct shapes, and marks a parcel carrier. Closed offers leave no phantom giver or open-offer marker.
- The minimap shows open givers and exact carrier positions, but only one objective marker: the current objective nearest the local player (the ready turn-in point, a visible item or a kill region).
- Lifecycle toasts name the finder when a reveal becomes public, announce completion and public expiry, and report parcels dropped or stolen. The completer receives one completion toast rather than a private plus public duplicate, leaving the +GV toast visible; expiries in the same tick are batched into one toast. The one-item refusal says exactly `you can carry one quest item`. A nearby open giver shows a turn-in hint when the local objective is ready.
- The planning screen and these run views use the same public quest information; none reconstructs server-only offers. Planning shows rows and markers only, while actual giver bodies and items appear at raid start.

## 5. Balance worksheet

These are design calculations, **not measured completion times or a questBench result**. The original per-quest `objSec` and `travelSec` estimates are retained as explicit assumptions so they can be replaced by harness measurements later.

Assumptions:

1. One normal mob costs 12 seconds all-in (`FARM_SECONDS_PER_MOB`), including fighting, walking and recovery.
2. Only 40% of pure quest travel is charged as lost farm time (`TRAVEL_RATE_SHARE = 0.4`), because the route can incidentally farm and loot.
3. The buff target includes a 15% risk premium (`STACK_PREMIUM = 1.15`). GV has no risk premium.
4. The reference recipient starts with no buffs and the farm benchmark accumulates one buff type. Define `P(n) = 3 × buffScale(n)`, which is `buffPower` for `n` stacks of one buff on that empty build.
5. The main worksheet evaluates feed 0: `rewardCurve(0) = 0.975888`. Both the benchmark and quest grant use that curve; quest GV does not. The separate GV cap does not change the per-offer arithmetic below.
6. `buffPower` is a common rough yardstick, not a claim that every buff is equally useful to every faction or build. With buffs already held, use the actual marginal delta: `buffPower(after) − buffPower(before)`; the empty-build table does not predict that delta.

For a def, the old time model first produces nominal parity stacks and GV:

```text
effective seconds = objSec + 0.4 × travelSec
parityStacks      = effective seconds × (1.1 / 12) × 1.15
parityGv          = effective seconds × (2 / 12)
paid stacks(feed) = reward.stacks × rewardCurve(feed)
paid power(feed)  = P(paid stacks(feed))
parity power(feed)= P(parityStacks × rewardCurve(feed))
```

At feed 0, the resulting worksheet is:

| Offer | Reward `BuffId` | Obj s | Travel s | Nominal stacks | Paid stacks | Paid power | Parity power | GV / parity GV |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cinder Cull | `emberImp` | 36 | 60 | 7 | 6.83 | 6.17 | 6.05 | 10 / 10.0 |
| Break the Chains | `executioner` | 36 | 60 | 7 | 6.83 | 6.17 | 6.05 | 10 / 10.0 |
| Plague Purge | `plagueRat` | 36 | 60 | 7 | 6.83 | 6.17 | 6.05 | 10 / 10.0 |
| Thaw the Watch | `iceGolem` | 36 | 75 | 7.5 | 7.32 | 6.23 | 6.17 | 11 / 11.0 |
| Worth the Walk | `wyrmling` | 20 | 60 | 5 | 4.88 | 5.44 | 5.13 | 7 / 7.3 |
| A Head for a Head | `executioner` | 30 | 60 | 3 | 2.93 | 2.88 | 5.84 | 5 / 9.0 |
| The Grand Tour | `cinderHound` | 36 | 100 | 8.5 | 8.30 | 6.28 | 6.26 | 13 / 12.7 |
| Blight Blooms | `plagueRat` | 15 | 75 | 5 | 4.88 | 5.44 | 5.23 | 8 / 7.5 |
| Shards of the Watch | `rimeStalker` | 15 | 75 | 5 | 4.88 | 5.44 | 5.23 | 8 / 7.5 |
| Ashcaps | `magmaBrute` | 15 | 75 | 5 | 4.88 | 5.44 | 5.23 | 8 / 7.5 |
| Loose Links | `bailiff` | 15 | 75 | 5 | 4.88 | 5.44 | 5.23 | 8 / 7.5 |
| The Tithe | `penitent` | 15 | 75 | 5 | 4.88 | 5.44 | 5.23 | 8 / 7.5 |
| The Quartermaster's Cache | `plagueRat` | 20 | 90 | 6.5 | 6.34 | 6.09 | 5.92 | 10 / 9.3 |
| Offerings at the Edge | `iceGolem` | 25 | 110 | 8 | 7.81 | 6.26 | 6.21 | 12 / 11.5 |
| The Ember Banner | `cinderHound` | 8 | 100 | 5.5 | 5.37 | 5.75 | 5.48 | 8 / 8.0 |
| The Frozen Standard | `iceGolem` | 8 | 100 | 5.5 | 5.37 | 5.75 | 5.48 | 8 / 8.0 |
| The Physician's Satchel | `plagueRat` | 8 | 100 | 5.5 | 5.37 | 5.75 | 5.48 | 8 / 8.0 |
| The Warden's Seal | `executioner` | 8 | 100 | 5.5 | 5.37 | 5.75 | 5.48 | 8 / 8.0 |
| The Reliquary | `acolyte` | 8 | 100 | 5.5 | 5.37 | 5.75 | 5.48 | 8 / 8.0 |
| The Long Haul | `plagueRat` | 8 | 150 | 8 | 7.81 | 6.26 | 6.19 | 12 / 11.3 |

Headhunter is the deliberate low outlier, at about 0.49 times buff parity, because its objective already has a player-kill payout. The other offers are roughly 1.00–1.06 times empty-build buff parity under these assumptions. Their nominal GV remains near time parity, subject to the 24 GV run cap.

The feed brake matters nonlinearly. For a nominal seven-stack reward on an empty build:

| Feed | `rewardCurve` | Paid stacks | `buffPower` after |
| ---: | ---: | ---: | ---: |
| 0 | 0.976 | 6.83 | 6.17 |
| 5 | 0.650 | 4.55 | 5.15 |
| 10 | 0.324 | 2.27 | 1.84 |

This worksheet does not establish that questing wins real runs. Travel danger, contested pickups, different buff values, camp rosters, existing builds and deaths need larger headless samples and broader browser playtests.

### K3: questBench usage and report

`questBench` runs the real sim headlessly and is report-only: harness failures are printed and never fail CI.

```bash
npm run questbench -w @raid/server
npm run questbench -w @raid/server -- --quick
npm run questbench -w @raid/server -- --seeds 6 --players 8
```

The defaults are three generated-map seeds and four seats per policy; `--seeds N` uses seeds 1..N and `--players N` accepts 2..8. `--quick` uses one seed, three seats and a 120-second cap instead of the normal 300 seconds. Solo seats rotate factions as well as mixed-lobby seats. The printed header defines every metric.

- **Live power** is `buffPower` with every buff whose definition has `needs` excluded. Those catalog rows do not currently apply in combat and must not inflate quest rewards, farm references, timelines or policy valuations.
- **Completion rate** is completions divided by attempts (quests the policy actually took), not by every offered lobby. Completion-only times and nearby deaths/fights remain separate observations; site events can overlap.
- **Ratio** is `quest's own seconds / farm-only seconds needed to reach the same live-power gain`. The quest's own cost is the time spent on that completion, not total raid elapsed time. **Above 1 means the quest costs more than farming; the target band is 1.0–1.35.** This is an opportunity-cost estimate, not a paired counterfactual.
- **Censoring:** the farm-only policy has survival and stall handling. A farm timeline that dies, stalls or otherwise ends before reaching the required gain is right-censored for that time-to-gain observation. Its final power is not carried flat and treated as a valid future farm pace; the report identifies censored samples.

Per quest the report includes attempts/completions, completion-only median/p90 time, observed completion-tick live-power before/after and delta, farm time to equal gain and ratio, and nearby deaths/fights. Per policy it reports live power at minutes 1, 2, 3 and 5, plus mixed-lobby win rates. Reports remain early, small-sample evidence for questions and regressions, **not K2 approval**, final balance evidence, or permission by themselves to change quest counts, waves, caps or carrier rules. Reports produced before these definitions and before R2 must not be quoted as measurements of the merged build.

## 6. Browser verification

The historical K1 two-tab Chromium check, before the R2 fixes, covered:

- Both planning screens showing five known quests and `+5 rumoured`.
- The **J** quest log, quest world drawing and minimap markers.
- Three hidden quests revealed through the scouting/head-start flow.
- **Offerings at the Edge** completed using real movement and **F** pickup inputs, including its buff and GV reward and both clients' completed row.

Screenshots are `docs/kimi/k1-*.png` (`k1-planning-alpha.png`, `k1-planning-bravo.png`, `k1-log-world-alpha.png`, `k1-log-complete-alpha.png`, `k1-log-complete-bravo.png`, `k1-world-complete-alpha.png`). Live Swarm/carrier was not separately exercised in that browser check. This historical check is not evidence for the R2 private-stream, placement, lifecycle, J-layout or training behavior.

**R2 browser check: PENDING — orchestrator to fill only after it runs, with the scenarios exercised and links to resulting logs/screenshots.**

## 7. Changing quests safely

Keep defs data-driven and preserve the private/public boundary. New hidden rolls belong on the private quest stream, never `world.rewardRandom` or `world.random`; no quest code may import Colyseus in the sim. Add hooks with `chainHook`, leave the fixed tick order intact, defer rewards through the existing ledger-safe payout paths, and append any future fx code at the next free wire code (K1-era additions start at 20, after R5's 18 and 19).

Useful focused checks after a change are the shared and server quest suites, the client quest UI suites, then the repository gates:

```bash
npm test -w @raid/shared -- quests
npm test -w @raid/server -- quest
npm test -w @raid/client -- quest
npm run typecheck
npm test
npm run build
```

**Merged-R2 performance evidence, copied from the new logs:** [`R2-stepBench-quests.log`](kimi/R2-stepBench-quests.log) reports 1200 ticks with 89 mobs, `step()` wall average **0.258 ms**, p99 **0.590 ms**, and CPU average **0.486 ms**, p99 **2.076 ms** (the log notes host load and JIT/GC effects). [`R2-bandwidth-quests.log`](kimi/R2-bandwidth-quests.log) reports typical **6.27 KB/s**, heavy **10.44 KB/s**, idle **0.14 KB/s**, and joiner first sync **14.3 KB**. These are the quests-enabled R2 logs, not the earlier K1 or pre-quest R2 figures. Their exact invocations and seed sets are not recorded in the logs; do not infer them here.
