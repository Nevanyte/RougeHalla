# Quest playtesting and tuning — 2026-10-28

This pass starts from current main (`79686d1`), which uses card rewards and requires acceptance at the giver. It does not carry the older buff-stack implementation or unrelated uncommitted changes into the release.

## Method

Three Luna subagents audited quest policy/reward measurements, swept client navigation, and independently reviewed the UI integration. The real-simulation benchmark runs the same ten map seeds, four solo seats per policy and four seats in each mixed lobby, with a 300-second cap, before and after reward tuning. That is 130 lobbies per run: 120 solo runs and ten mixed lobbies. Solo faction rotation gives eight farm-reference runs per faction across the ten seeds.

```sh
npm run questbench -w @raid/server -- --seeds 10 --players 4 --cap 300
npm run test -w @raid/client -- test/questPathing.test.ts
```

The benchmark now records actual server-confirmed acceptance separately from selection, objective progress and closure, and uses cached collision-aware travel costs instead of straight-line ranking. Grand Tour policies read synced visited regions; revisiting a quest cannot send them back to a completed region. Maximum fetch progress is retained across drops and expiry. The before run predates that last progress-only reporting fix, so its fetch progress column is a terminal snapshot; power, completion counts and opportunity-cost ratios are comparable.

## Before

The [saved baseline](quest-playtests/2026-10-28-before.md) completed 130/130 lobbies and 729,569 active ticks with no harness failures. All twenty quest definitions were observed. The priced quest/farm ratios ranged from 2.83 to 6.17: completion commonly cost 38–71 seconds, while the farm reference earned the same one or two live card-power points in 11.5–15 seconds. A ratio above one means the quest took longer for the same measured power.

The five-minute mean live-card-power values were 42.4 for farm-only, 13.5 for quest-greedy and 17.8 for mixed policies. Those columns include only runs still going, so their survivor counts matter; they are not paired player-strength estimates. Some offers had only one to three completions, even though the aggregate sample is larger.

## Changes under comparison

- Quest payouts retain their base-card identity and nominal tier, but grant a calibrated stack of copies. The catalog specifies quantity explicitly and the server, planning screen, log, dialog and policy valuation agree on it. The feed brake still reduces each copy's tier for a player far ahead.
- The quest GV pot increases from 24 to 40; individual GV payouts retain their effort-based values and the separate mob/bounty pots remain independent.
- Tracking guides the player to the giver before acceptance, then the relevant living target, unvisited tour region, quest item, parcel carrier or ready turn-in. It uses the current gate map and player collision radius; unreachable targets produce no made-up straight route.
- Bounded navigation caches retain valid destinations, validate the actual moving connector segments, remove passed waypoints, and invalidate on target/progress/gate changes. Unaccepted ground objects are hidden from both the world view and scene interaction hints.
- The quest log gains a launcher, close/Escape, stable focused row controls, progress meters and a persistent HUD whose distance follows the minimap path. Closed reward history uses nominal offer wording, rather than pretending the viewer's current feed describes another player's award.

## First comparison and correction

The [first comparison](quest-playtests/2026-10-28-round-one.md) completed another 130/130 lobbies and 727,145 active ticks, without harness failures. Twelve of twenty quest ratios landed in the report's 1.0–1.35 band. Five-minute survivor mean power moved from 13.5 to 37.3 for quest-greedy and from 17.8 to 38.1 for mixed, against a farm-only value of 42.0 (42.4 before). Only 9/53 quest-greedy and 13/53 mixed seats were still observed at five minutes; those means must not be read as every player's outcome.

Four offers had well-sampled ratios below one: Cinder Cull 0.78 (9 completions), Quartermaster's Cache 0.81 (19), Offerings at the Edge 0.89 (45), and Grand Tour 0.91 (15). The final correction reduces their card quantities to two, two, three and two respectively. This preserves an increase over the old one-card payout while removing those measured overshoots. Shards of the Watch and The Tithe each had one completion, so their outlying ratios do not justify another fine-grained adjustment. Blight Blooms remains constrained by the attack-speed cap; increasing identical Haste cards further would overstate its utility.

## Final matched validation

The [final report](quest-playtests/2026-10-28-final.md) completed 130/130 lobbies and 726,793 active ticks with no harness failures. Across the baseline, first comparison and final validation, this pass ran **390 simulated lobbies and 2,183,507 active ticks**. Sixteen of twenty quest ratios are in the benchmark's 1.0–1.35 target band and none are below one. The final catalog pays two to six copies per quest.

| Quest | Before ratio | Final ratio | Final copies | Final completions |
| --- | ---: | ---: | ---: | ---: |
| A Head for a Head † | 3.34 | 1.15 | 3 | 4 |
| Ashcaps | 5.81 | 1.22 | 6 | 10 |
| Blight Blooms | 6.17 | 1.60 | 6 | 7 |
| Break the Chains | 3.00 | 1.02 | 3 | 13 |
| Cinder Cull | 2.95 | 1.28 | 2 | 9 |
| Loose Links | 5.95 | 1.21 | 6 | 9 |
| Offerings at the Edge | 3.67 | 1.06 | 3 | 45 |
| Plague Purge | 3.83 | 1.20 | 4 | 5 |
| Shards of the Watch | 4.45 | 1.90 | 4 | 1 |
| Thaw the Watch | 3.49 | 1.18 | 3 | 6 |
| The Ember Banner | 3.78 | 1.09 | 4 | 30 |
| The Frozen Standard | 4.39 | 1.27 | 4 | 29 |
| The Grand Tour | 3.13 | 1.50 | 2 | 14 |
| The Long Haul | 3.84 | 1.11 | 4 | 47 |
| The Physician's Satchel | 3.84 | 1.28 | 4 | 5 |
| The Quartermaster's Cache | 2.83 | 1.34 | 2 | 19 |
| The Reliquary | 4.62 | 1.06 | 5 | 24 |
| The Tithe | 5.33 | 1.86 | 5 | 1 |
| The Warden's Seal | 3.85 | 1.05 | 4 | 11 |
| Worth the Walk | 5.12 | 1.24 | 5 | 8 |

Grand Tour remains at 1.50 because two copies are conservative while three measured 0.91; a mixed-tier reward could narrow that discrete gap later. Blight Blooms is at 1.60 with seven completions and a Haste stack already at the attack-speed cap. Shards and Tithe each have only one completion, so their 1.90 and 1.86 ratios remain insufficient grounds for further fine tuning. These limits are retained explicitly instead of calling every offer balanced.

Five-minute survivor mean power finishes at **34.4 quest-greedy, 34.0 mixed and 42.0 farm-only**, versus 13.5, 17.8 and 42.4 before. Final mixed-lobby wins were 1/14 farm-only, 0/13 quest-greedy and 0/13 mixed; most runs had no winner by the cap, so this is not evidence of normal endgame win balance. Raw completion Δ is the entire granted stack (tier × copies), even where the saved report header still says the card's tier; the source report header has been corrected for future runs.

## Navigation evidence

The generated-map sweep covers 100 seeds across regional kill, elite, Grand Tour, collect and fetch guidance: 500 guidance queries and 726 route segments checked with `segmentClear(..., PLAYER_RADIUS, MASK_MOVE)`. Additional regressions cover closed gates, blocked and disconnected targets, a fifth reachable item behind four blocked candidates, dead/wrong-region/visited mobs, player-specific caches, simultaneous player/target movement around a corner, static-route reuse, expiry, and private-preview item visibility. Headhunter never directs a player to an ordinary mob.

## Interpretation limits

Live card power is tier × count, not a complete measure of a faction's build value. Repeated Haste and other capped stats can saturate while card power and its PvP factor continue to grow. The same seeds are used for tuning and comparison; this is not an independent holdout or a human playtest. Some individual quests remain sparsely sampled. Benchmark patience timers are deliberately beyond the cap, so these reports do not establish normal endgame win balance or the effect of the coliseum teleport. Farm deaths/stalls censor its reference curves; successful-quest completion times do not represent failed attempts. Read the raw reports' denominators and survivor counts alongside any ratio.

## Release verification

All workspace suites passed: 2,153 client tests, 5,506 server tests and 1,726 shared tests. The final copy adjustments also passed the focused shared catalog, authoritative quest payout/lifecycle and client reward/dialog/log tests. The pathing/minimap/log/model regression pass passed 92 tests after the marker-contrast polish. Workspace typechecks, production client build and `git diff --check` passed.

Manual browser checks used an isolated local server; the controlled UI-only run disabled regional mobs, while all benchmark reward/combat runs used the real simulation. The browser walked a 136-tile tracked route to a giver, opened the dialog with F, accepted with Enter, and switched the tracker to the now-visible parcel. It also exercised Track/Untrack, J/Escape, close controls and stable countdown updates. A crowded-minimap readability issue led to a white destination halo, a GO label and a stronger route line. Simulation tests and the benchmark cover successful turn-ins, exact stacked payouts, the feed brake, cap exhaustion, item drops, expiry and gate closures.
