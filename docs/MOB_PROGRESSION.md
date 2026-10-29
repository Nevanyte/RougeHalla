# Mob progression

Regular mobs give one fixed stat stack with every credited kill, with no per-type ceiling. Elites give interactive augments. This document supersedes the balance pass's all-card economy; its historical card catalog and benchmark kits remain available for comparison.

## Fixed rewards

Each credited normal kill grants one whole stack of its type, independent of feed, catch-up, kill count, or previous stacks. Counts are uncapped and persist through camp respawns and coliseum rounds. Percentage bonuses add against base values, and types granting the same stat add together. Earned stacks continue to add after ordinary card and temporary-source ceilings; combat sources such as slows still apply to the resulting stats.

| Zone | Normal mob | Per kill | At ten stacks (example) |
|---|---|---|---|
| Fire | Ember Imp | +1% damage | +10% damage |
| Fire | Cinder Hound | +0.5% move speed | +5% move speed |
| Fire | Magma Brute | +1% max health | +10% max health |
| Fire | Flame Caller | +1 ability power | +10 ability power |
| Sentenced | Bailiff | +1 armor | +10 armor |
| Sentenced | Chain Warden | +1 magic resist | +10 magic resist |
| Sentenced | Inquisitor | +1% damage | +10% damage |
| Sentenced | Pardoner | +1 attack damage | +10 attack damage |
| Plague | Plague Rat | +1% attack speed | +10% attack speed |
| Plague | Bloatfly | +0.5% move speed | +5% move speed |
| Plague | Rot Monk | +0.25 percentage points lifesteal | +2.5 percentage points lifesteal |
| Plague | Miasma Witch | +1 ability power | +10 ability power |
| Frost | Frost Wisp | +1 magic resist | +10 magic resist |
| Frost | Ice Golem | +1% max health | +10% max health |
| Frost | Rime Stalker | +1 armor | +10 armor |
| Frost | Frostbow Sentry | +1% attack speed | +10% attack speed |
| Demon Blood | Acolyte | +0.25 percentage points lifesteal | +2.5 percentage points lifesteal |
| Demon Blood | Seraph Shard | +1 magic resist | +10 magic resist |
| Demon Blood | Penitent | +1% max health | +10% max health |
| Demon Blood | Zealot | +1 armor | +10 armor |

The current map already has eight camps per zone. Bag rosters guarantee all four normal types, and respawning preserves the roster. Fully cleared camps return after three minutes. Personal stat progress survives respawns and coliseum rounds. Dummy, quest-NPC, and training mob kills pay no progression.

The HUD shows earned totals for owned types and exposes all twenty in an expandable catalog. Camp and planning tooltips describe the reward before a pull. The server credits the existing whole-fight damage winner and remains authoritative over all progression.

## Elite augments

Each credited elite death drops one shared augment chest at its camp, even while escorts survive. Ordinary camp clears give no chest. Clearing an elite's escorts never duplicates its death reward. A respawned elite is a new life and may drop another chest.

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

Quests grant 8–16 whole normal-mob stat stacks from their destination zone, added to any previous progress, plus their existing GV. Their per-offer quantity is `clamp(ceil((objSec + 0.4 × travelSec) / 12 × 2), 8, 16)`: it counts objective time fully, discounts travel for incidental farming, and adds a strong route premium. This bounds one award; accumulated earned stacks still have no ceiling. Feed never reduces quest rewards, and quests never grant augments. Bounties pay GV without transferring stats or augments. Historical card tiers/copies and their questBench comparison remain available for tuning reference, not as current quest payout or balance evidence.

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
