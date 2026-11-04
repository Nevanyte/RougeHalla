# Mob progression

Regular mobs give three fixed stat stacks with every credited kill (`MOB_KILL_STACKS`, 3 since the tactical-farming pass; it was one), with no per-type ceiling. Elites give interactive augments. This document supersedes the balance pass's all-card economy; its historical card catalog and benchmark kits remain available for comparison.

## Fixed rewards

Each credited normal kill grants `MOB_KILL_STACKS` (3) whole stacks of its camp's buff (the type below whose stat the camp pays: the mob's own type, or another zone's on an out-of-theme camp, see "Camp buffs"), so a kill is worth three times the per-stack row below, independent of feed, catch-up, kill count, or previous stacks. Counts are uncapped and persist through camp respawns and coliseum rounds. Percentage bonuses add against base values, and types granting the same stat add together. Earned stacks continue to add after ordinary card and temporary-source ceilings; combat sources such as slows still apply to the resulting stats.

| Zone | Normal mob | Per stack (a kill grants 3) | At ten stacks (example) |
|---|---|---|---|
| Fire | Ember Imp | +1% damage | +10% damage |
| Fire | Cinder Hound | +0.5% move speed | +5% move speed |
| Fire | Magma Brute | +1% max health | +10% max health |
| Fire | Flame Caller | +1 ability power | +10 ability power |
| Sentenced | Bailiff | +1.25 armor | +12.5 armor |
| Sentenced | Chain Warden | +1.5 magic resist | +15 magic resist |
| Sentenced | Inquisitor | +1% damage | +10% damage |
| Sentenced | Pardoner | +1 attack damage | +10 attack damage |
| Plague | Plague Rat | +1% attack speed | +10% attack speed |
| Plague | Bloatfly | +0.5% move speed | +5% move speed |
| Plague | Rot Monk | +0.25 percentage points lifesteal | +2.5 percentage points lifesteal |
| Plague | Miasma Witch | +1 ability power | +10 ability power |
| Frost | Frost Wisp | +1.5 magic resist | +15 magic resist |
| Frost | Ice Golem | +1% max health | +10% max health |
| Frost | Rime Stalker | +1.25 armor | +12.5 armor |
| Frost | Frostbow Sentry | +1% attack speed | +10% attack speed |
| Demon Blood | Acolyte | +0.25 percentage points lifesteal | +2.5 percentage points lifesteal |
| Demon Blood | Seraph Shard | +1.5 magic resist | +15 magic resist |
| Demon Blood | Penitent | +1% max health | +10% max health |
| Demon Blood | Zealot | +1.25 armor | +12.5 armor |

Defense (armor) pays 1.25 a stack and Soul Defense (magic resist) 1.5 (`DEFENSE_PER_STACK`, `SOUL_DEFENSE_PER_STACK`; they were 1): a counter to the damage type it answers, never the kill to take against a mixed field, and the most they can pay before a random route's incidental D/SD kills out-farm a build (testing/FARM_ROUTE_PROOF.md).

The current map has ten camps per zone (160 x 160 tiles). Each camp's buff is rolled for theme and spread (next section), and respawning preserves the roster and the buffs. Fully cleared camps return after three minutes.

## Camp buffs: a theme per zone, a max distance, an even spread

Owner request (2026-11): "each zone [should] have a theme of the buffs it gives based on the character, however I want mob buffs to have a max distance, [...] as close as an even spread of camp buffs as possible." A camp's **buff** is the stat kind its normal kills pay, one of nine (damage, move speed, max health, Soul Offence, Defense, Soul Defense, Offense, attack speed, lifesteal: `MOB_STAT_KEYS`); a zone's **theme** is the four stats its own four normal types pay. The old bag rule gave every camp one of its zone's four types, so Offense stood only in the Sentenced zone (two or three camps a map), max health, Defense and Soul Defense in three zones each (seven or eight camps), and a camp on the far side of the map was up to 140-190 tiles from the nearest Offense camp.

`shared/rosters.ts` `rollCampRosters` (server: `sim/camps.ts`, from `world.rewardRandom` only, 2n - 1 draws for n camps) rolls it in three steps:

1. **The draw.** The camps in a shuffled order, each drawing its buff with weight theme x need x balance. Theme is 1 for the zone's four and `CAMP_BUFF_OFF_THEME_WEIGHT` (0.15) for the other five. Need is 1 + (d / `CAMP_BUFF_NEED_REF_TILES`)^2, d the distance in tiles to the nearest camp already given that buff (capped at `CAMP_BUFF_NEED_CAP_TILES`): a buff that no nearby camp has is much more likely. Balance is (even share / (count + 1))^`CAMP_BUFF_BALANCE_POWER`.
2. **The repair** (deterministic, at most `CAMP_BUFF_REPAIR_STEPS` moves): the best change of one camp's buff, or swap of two camps' buffs, judged first by the coverage excess (how far past its bound the nearest camp of each buff lies, summed over camps and buffs), then by the count band (every buff on floor(n / 9) to ceil(n / 9) camps: 5 or 6 of 50), then by how many camps are on their zone's theme. A camp's bound is `CAMP_BUFF_MAX_DISTANCE_TILES` (65 tiles, straight line between camp centres), or its ninth-nearest-camp distance (itself included) where that is farther: a camp needs nine camps that close to see nine buffs, so for a corner camp (61-73 tiles on the worst camp of a map) no roll can do better.
3. **The types.** A camp whose buff is on its zone's theme has the zone type that pays it, exactly as before (`CampState.buff` ""). Any other keeps a type of its own zone (its mobs, faction, role, weapon and art never change zone), the zone's least used so far, and `CampState.buff` names the type that pays its stat in the zone nearest it that has the stat on theme: an Offense camp in the Fire zone is a Fire camp whose kills pay the Sentenced Pardoner's Offense. The kill toast says so ("Ember Imp: +3 kill stacks of Pardoner"), the stacks count under that type, and the planning screen's badge (dashed rim), its tooltip ("+3 Offense per kill (the Pardoner's, from the Sentenced zone)"), the in-world camp badge and the bots' routes all read the buff (`campRewardId`).

Measured (camp geometry of seeds 1-40, four rolls a map; the same metrics on the old bag rule; distances are straight lines between camp centres in tiles; "worst gap" is, per roll, the largest distance from any camp to the nearest camp of any buff):

| | old bag | camp buffs |
|---|---|---|
| camps per buff (fewest buff / most buff, over the rolls) | 2-3 / 7-9 | 5 / 6 |
| mean camps per buff (damage, move speed, max health, SO, Defense, SD, Offense, attack speed, lifesteal) | 5.0, 5.0, 7.6, 4.9, 7.5, 7.5, 2.5, 4.9, 5.0 | 5.6, 5.5, 5.8, 5.5, 5.7, 5.7, 5.3, 5.5, 5.5 |
| worst gap, p50 / p90 / max | 139 / 163 / 188 | 64.9 / 67.3 / 71.6 |
| camp to the nearest camp of a buff, over every (camp, buff): mean / p90 | 43.5 / 87.5 | 30.5 / 51.2 |
| (camp, buff) pairs farther than 65 tiles | 22.5% | 0.10% (corner camps) |
| rolls meeting every camp's bound | 0 of 160 | 160 of 160 |
| camps on their zone's theme: mean / worst roll | 100% / 100% | 71.3% / 64% |
| a camp given the same buff in two rolls of one map | 25.6% | 17.1% |

On seeds 101-200 (400 rolls) the new roll reads the same: 5-6 camps a buff, worst gap p50 65.0 / p90 68.0 / max 72.3 tiles, theme 71.3% (worst roll 62%), and 399 of 400 rolls met the bound (the miss is 0.2 tiles over, a local optimum of the repair). The bound is the dial between spread and theme (seeds 1-40): at 60 tiles 95% of rolls met it with 65% of camps on theme, at 62 tiles 99% with 68%, at 65 tiles 100% with 71%, at 70 tiles 100% with 76%. The draw's own factors move none of these by more than a point (the repair decides them); they set how varied the rolls are. The camps' mob types keep the old mix: 8.8 to 10.4 normal mobs of each type a map (the bag: 9.3 to 9.9), and by role brute 36.9, caster 39.6, grunt 28.5, skirmisher 48.7, swarm 37.6 (the bag: 38.8, 38.4, 28.9, 47.2, 38.1). A roll costs about 3-5 ms at world build (p99 under 25 ms on a loaded machine). `testing/farm_route_proof.py` now draws from rolls `bench/farmRouteData.ts` exports (`rosters`, eight a map). Its full run (24 maps x 4 rosters, 8-player lobbies) holds for all ten builds on them: decisions worth it 67-91%, games won on build value 92-99%, on fights 97-100%, mirror 72-100%. The same run on the old bag rosters, same tree, failed one build (plague:A: a build camp paid more in only 56% of its decisions, under the 67% bar). Personal stat progress survives respawns and coliseum rounds. Dummy, quest-NPC, and training mob kills pay no progression.

The HUD shows earned totals for owned types and exposes all twenty in an expandable catalog. Camp and planning tooltips describe the reward before a pull. The server credits the existing whole-fight damage winner and remains authoritative over all progression.

## Elite augments

Each credited elite death drops one shared augment chest at its camp, even while escorts survive. Ordinary camp clears give no chest. Clearing an elite's escorts never duplicates its death reward. A respawned elite is a new life and may drop another chest. World stat chests are rare: only `STAT_CHEST_CRATES_PER_MAP` (3) crates per map hold one, chosen privately from the world salt at build time; no camp clear drops one.

A chest offers up to three distinct, live, interactive augments and expires after fifteen seconds. One player may take each option; each player may pick once or skip. Already owned unique augments are refused. Tier odds are the existing elite weights with nearest-available-tier fallback. The first option follows the zone's theme when an eligible themed augment exists, and remaining options draw from the shared interactive pool.

| Zone | Elite types | First-slot theme |
|---|---|---|
| Fire | Wyrmling, Ash Drake | Slow Burn, Hemorrhage, Overkill |
| Sentenced | Executioner, Gaoler | Plant Your Feet, Wishful Thinking, Overkill |
| Plague | Rat Ogre, Pox Behemoth | Hemorrhage, Siphon, Third Time's the Charm |
| Frost | Glacial Warden, Avalanche Troll | Pocket Sand, Best Offense, Tank Engine |
| Demon Blood | Blood Saint, Archon | Second Wind, Siphon, Eye for an Eye, Spiked Shell |

The reward whitelist contains observable interactions such as bleeding, splash after a kill, retaliatory damage, blocking interactions, cooldown refunds, or reactive healing. Pure stat cards, stat tradeoffs, and simple conditional stat bonuses are excluded. The historical eighty-card catalog remains usable by internal combat harnesses, but external reward and practice-console paths enforce the interactive whitelist.

## Quests, practice, and bots

Quests grant 10–20 whole normal-mob stat stacks from their destination zone, added to any previous progress, plus their existing GV. Their per-offer quantity is `clamp(ceil((objSec + 0.4 × travelSec) / 12 × 2.5), 10, 20)`: it counts objective time fully, discounts travel for incidental farming, and adds a strong route premium. This bounds one award; accumulated earned stacks still have no ceiling. Feed never reduces quest rewards, and quests never grant augments. Bounties pay GV without transferring stats or augments. Historical card tiers/copies and their questBench comparison remain available for tuning reference, not as current quest payout or balance evidence.

Training can set a normal type's progress to any non-negative safe integer, practice interactive augments, and clear both. Practice kills do not alter a configured build. Bots read their own stack totals and consider farmed stats when deciding whether to challenge elites. They learn a mob's type from on-screen observations, not hidden state.

## Validation

Regression coverage includes all twenty rewards, uncapped progression, actual kill grants, feed independence, max-health synchronization, elite drop timing and duplication, chest filtering, quest rewards, training validation, bot perception and target choice, and HUD progress. Existing card ceilings remain in place while earned mob stats continue to grow. Numbers are starting values for playtesting, not a claim of human balance validation.

The full client suite passed (113 files, 2,199 tests), and the full shared suite passed (65 files, 1,734 tests). The full server run passed 5,541 tests; its four functional failures were fixed and verified with focused reruns, including all 50 bot chest tests and the isolated network coliseum test. Final typechecking, production build, and diff checks passed.

Three existing bot performance gates fail in isolation on both this change and unchanged `main` (`52aa9d6`), using the same Node/runtime and test command. The thresholds were kept intact:

| Gate | Budget | This change | Unchanged main |
|---|---|---|---|
| Eight mixed-tier bots, whole tick average | <5 ms | 6.563 ms | 6.845 ms |
| Eight hard bots, whole tick average | <5 ms | 6.442 ms | 6.797 ms |
| Locked coliseum, bots' average share | <1.5 ms | 1.568 ms | 1.625 ms |

These are local diagnostic measurements, not a claim of a performance improvement. The remaining four performance tests passed on both revisions.
