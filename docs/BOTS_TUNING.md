# Bot tier tuning log

Working log of the tuning of the three skill tiers (docs/BOTS.md 2.2, 5, 9.3). Every figure is from the headless tournament
(`npm run tournament`), real timers (`--patience 300 --sudden 60 --max-minutes 15`), lineup E,E,N,N,H,H unless said, learning on
(the default), 400 games = 800 bot-games per tier. A per-bot win share has a 95% Wilson half-width of about 2.5 points at 800
bot-games, a tier's mean placement a 90% half-width of about 0.08.

**Where each part was measured.** Sections 0 to 5 were taken on the 64x64 wedge map before the roguelike merge (R3 planning, R4a
per-mob buffs, R5 camps and chests): `MOB_K` 0.45, the three-stat S-curve buffs, no camp-wide aggro, no planning or chest module.
Section 6 was taken after that merge (`MOB_K` 0.22, per-mob buffs, camp-wide aggro, the planning and chest modules) and still on
the 64x64 map, before R2's 96x96 zone maps, the hazards module and the reach fix. Section 7 is the only part measured on the zone
maps the game builds today, so none of the earlier tables describes the tree that ships now.

Diagnostics added for this work (no behaviour): `--tune JSON|@file` (patches the TIERS / PERSONAS tables and the temporary decision
switches before the games, `tournament/tune.ts`), and in each `GameSummary` the optional `firstKillMs`, `deathLog`, `firstHits`
and per bot `firstMobKillMs` (`tournament/game.ts`). The Wish lock needed no fix: `HEADLESS_CONFIG` leaves `wishLockSeconds`
unset, so `abilities.ts` uses the real default (`WISH_LOCK_SECONDS` 45 s), as the server does.

## 0. Starting point (the code as handed over, Wishes merged), seed 3

| | Easy | Normal | Hard |
|---|---|---|---|
| win share | 15.1% | 15.1% | 19.8% |
| mean place | 3.55 | 3.59 | 3.34 |

Flow: median game 85 s, first death 11 s, first player kill 11 s, teleport in 28% of games, 1 mob kill per bot-game, jukes
3.0/game for Hard, dodges and orb-walk cycles about 0.01.

## 1. What the tier parameters were worth: nothing

* Easy given every one of Hard's parameters (reaction, accuracy, APM, hesitation, softmax, lapse, knowledge, route, attention,
  dodge/juke/orb-walk, cadence): 14.8% against Hard's 17.9% and Normal's 17.4%. Same-parameter bots differ by noise alone.
* Duels (2 hunters, same faction, plague, 600 games): Easy 55%, Hard 35%, draws 9%. With Hard's `jukeP` and `dodgeP` set to 0:
  Easy 43%, Hard 37%, draws 20%. A juke is a `move`, which drops the lock and costs about 0.5 s of attacks; an arrow lands before
  a 44 u step can take the bot out of its path (900 u/s against 170 u/s), so the juke costs more than it saves. The bots' execution
  edge is invisible in the results because the server plays the fight for everyone (the target lock).

## 2. What decides a fight between two bots (6287 first hits, base + two variants)

Logistic fit of "the bot that landed the first hit of a pair wins the fight" (pseudo R2 0.28):

* hp lead at the first hit (attacker minus victim, share of max hp): coefficient 4.5 per unit. Lead > 0.4: 92% wins; lead < -0.4: 24%.
* victim traded a hit with a third fighter in the last 3 s: +0.7; attacker busy likewise: -0.5.
* faction strength (reference Fire = 0): Sentenced +1.4, Plague +1.5, Frost +0.1, Holy -0.2.
* the matchup score the hue shows (faction edge + weapon edge of the starting kits): -0.24 per point. The hue does not predict the
  fights the bots play. (Pure duels in the harness, both fighters locking each other, follow the wheel to the letter: 625 cells, +2
  wins 100%, +1 84%, -1 16%; the bots' own games differ for the mixed cells, e.g. a Plague bow beats a Frost shield 75% of the time.)

## 3. Restraint is the skill (single-tier switches, Hard and Normal only; others as handed over)

All with the cutoff and no-centre-walk changes (f1, f3) below unless stated.

| experiment | Easy | Normal | Hard | flow |
|---|---|---|---|---|
| handed-over code | 15.1 | 15.1 | 19.8 | game 85 s, teleport 28% |
| f1: no hunt of a player it expects to lose to (no 0.2 floor), f3: no walk to the map centre as a pastime | 16.0 | 14.1 | 19.9 | median 138 s, teleport 43% |
| Hard needs 0.7 more edge / 0.7 less | 15.0 / 15.6 | 15.0 / 15.3 | 20.0 / 19.1 | thresholds do not matter |
| Hard never opens a fight | 14.5 | 11.6 | 23.9 | teleport 66% |
| Hard opens only on a third party's prey or a victim under 35% hp | 13.5 | 12.9 | 23.6 | teleport 52% |
| Hard never opens + keeps away from players it does not want to fight (evade 450 u) | 12.6 | 11.9 | 25.5 (place 3.05) | teleport 66% |
| ... and Normal opens only on prey (evade 300 u) | 10.8 (3.99) | 14.9 (3.44) | 24.4 (3.06) | median game 231 s, teleport 76%, mob kills 1.8 |
| ... and Hard never farms | 2.8 | 5.3 | 42.0 | the turtle: wins by arriving in the coliseum at full hp |
| ... Hard farms only safe mobs (share 0.7, no elites, hp over 70%, 3 kills) | 5.4 (4.16) | 10.4 (3.58) | 34.3 (2.75) | median game 233 s, teleport 83%, mob kills 1.7 |
| the same on seed 4 | 5.9 | 11.1 | 33.0 | |
| the same, 3 v 3 (E, N, H) | 21.3 | 29.7 | 49.0 | |

Reading: in this sim hp is the only currency (no regeneration), a mob costs a starter about 20% hp for its first two kills (hp
share at the 1st/2nd/3rd/4th mob kill: 0.80, 0.61, 0.57, 0.53), and the patience timer sends everybody to the coliseum, so the player
who spends least hp wins. Skill is therefore restraint: which fights to open, which mobs to take, and keeping out of the way of the
rest. A bot that does all three well wins a third of the games in a lobby of two Easy, two Normal and itself.

## 4. Maneuvers that never trigger, and why

* **Orb-walk (0.00 to 0.05 cycles a bot-game, with the persona's kite factor forced to 1 as well).** A cycle needs the shot to have
  left and cooldown still to run: `readyAt - now >= step + 55 + 100 + 100` ms. With the paced numbers, the cooldown left after the
  projectile leaves is Sentenced bow 46 ms, Plague bow 22 ms, Holy wand 238 ms, Plague wand 66 ms (Fire bow 255, Fire wand 610,
  Frost bow 540, Frost wand 947 ms). The ranged windups are the game's anti-kiting lever (CLAUDE.md "Windups root"): the shooter is
  rooted for nearly the whole interval, so a signature kit has no time to walk in. Only Fire and Frost, holding a picked-up bow or wand,
  can kite, and they carry one rarely. Orb-walking sentenced-vs-fire, holy-vs-sentenced, holy-vs-plague duels (100 games each): 0.00
  cycles with the kite chance at 85%, and the win counts do not move (41/59 and 40/60, 44/56 both ways, 8/92 both ways). Not a
  tier lever in this game; the code stays (a Fire or Frost bow can use it) and the tables keep their values.
* **Dodges (0.00 to 0.01 a bot-game).** A ball is dodgeable only when it was loosed from near the wand's maximum range and the bot
  reacts at once; the wand users are Holy bots and wand mobs, and in a locked fight the bot is nearer than that. Hard's chain is 538
  ms (BOTS.md 2.6) against a ball that lives 579 ms at most.
* **Jukes (1.9 to 3.3 a Hard bot-game).** They fire, but they are a net loss. A juke is a `move`, which drops the lock and costs the
  re-lock and about half a second of attacks; an arrow leaves at 900 u/s and the 44 u sidestep needs 260 ms. Hard duel, 600 games,
  jukes on/off: 35% against 37% (the opponent is Easy; noise level). So a Hard bot is slightly weaker for jukeing, and its win share
  is what it is with them on. They are left in because they are the documented exploit (BOTS.md 2.8, "feints work"), not because
  they win fights.

## 5. Standing still (the stall bound)

Easy broke the 8 s stall bound in 2.7% of bot-games (max 21 s). The stall was `hold wait`: when every camp had been visited in the
last 45 s and the map-centre walk was gone (it was a bad habit, see 3), nothing was left to do, and Easy's softmax picked the wait
again and again. Two changes, for every tier:
* the patrol takes the camp seen longest ago even when all were seen lately (it only skips a camp the bot stands in), and its value
  is scaled by the same hp ramp the hunts use (`healthy`: 0.15 at the flee hp, 1 at the re-engage hp);
* a hurt bot with nothing to do lies low (`hold ambush`, worth up to 0.18, fading to nothing at the re-engage hp) instead of
  wandering into the others. The stall watch does not count a deliberate hold.
Result: Easy over 8 s in 6 of 800 bot-games (max 10.0 s, from a 1.2 s hesitation on top of a reaction at its 1.4 s cap on top of
a slow think), Normal 0, Hard 0.

## 6. State at the R3/R4a/R5 merge (the 64x64 map, before R2)

Sections 0 to 5 were measured before main's roguelike work (R3 planning, R4a per-mob buffs, R5 camps and shared chests) was merged
into this branch. This is the first full run after it, on the 64x64 map (R2's zone maps came after this run): `MOB_K` 0.22,
per-mob buffs, the planning module (its 12 s window is not played here, see below) and the chest module on, tier tables as
committed.

```
npm run tournament -- --games 400 --workers 8 --lineup E,E,N,N,H,H --patience 300 --sudden 60 --max-minutes 15 --seed 3 --quiet
```

```
games: 400 with a winner, 0 draws, 0 cut off at the cap
length: mean 173.5 s, median 174.6 s, min 19.3 s, max 608.4 s (simulated, raid start to end)
first death: median 14.3 s into the raid; teleport in 50% of games, sudden death in 25%
throughput: 400 games in 46.9 s wall = 8.52 games/s with 8 workers (1478.3 simulated s per wall s)

tier    bot-games  wins         win/bot [95%]  share of wins  draws        place [90%]  kills  deaths  dmg  mob dmg  mob kills   gv  alive s
------  ---------  ----  --------------------  -------------  -----  -----------------  -----  ------  ---  -------  ---------  ---  -------
easy          800   119  14.9% [12.6%, 17.5%]          29.8%      0  3.56 [3.48, 3.65]   0.52    0.85  597      687       2.37  5.7     90.4
normal        800   122  15.3% [12.9%, 17.9%]          30.5%      0  3.57 [3.48, 3.66]   0.50    0.85  500      686       2.48  5.8     92.8
hard          800   159  19.9% [17.3%, 22.8%]          39.8%      0  3.36 [3.27, 3.45]   0.52    0.80  425      713       2.42  5.8     97.7

HOW THEY DIED   to a bot  to a mob  to sudden death  never fought
easy                 446       209               26             1
normal               412       225               41             0
hard                 366       240               35             0
```

* **Separation.** Hard is ahead of Normal and Easy (19.9% against 15.3% and 14.9%; placement 3.36 against 3.57 and 3.56, the
  intervals clear). Normal and Easy are not apart: 0.01 of placement, intervals overlapping. Only Normal sits in its starting band
  (BOTS.md 9.3); Hard is under 0.25 and Easy over 0.10. The reaction means hold for Normal (1.06 of the table) and Hard (1.06) and
  not for Easy (499 ms against 450, 1.11: the attention-scaled `newThreat` and the reading `chestUp` run long).
* **Against section 3.** The restraint experiments there gave Hard 24 to 34% (42% for the turtle) with Easy and Normal falling. This run is closer to
  section 0's starting point (15.1 / 15.1 / 19.8). I did not re-run section 3's experiments after the merge, so I cannot say
  whether weaker mobs (`MOB_K` 0.22: farming is cheaper, so restraint pays less), the camp-wide aggro the hunt does not know of, or
  the chest module moved it.
* **Before the merge.** The last tuned run before it (the tuned tables, just before commit `0c07ee9`; same lineup, seed and real
  timers; `MOB_K` 0.45, the three-stat buffs) gave wins of Easy 10.9% / Normal 17.1% / Hard 22.0%, mean placement 3.90 / 3.45 /
  3.15, a median game of 219 s and 1.9 / 2.3 / 2.4 mob kills a bot-game (the table is not kept in this log). The merge flattened
  that ordering to the one above.
* **Planning is not in these games.** `HEADLESS_CONFIG` leaves `planSeconds` unset, so the headless room starts the raid at once
  and the planning module never acts here. Its effect on a run (a better start for Hard than for Easy) is not measured.
* **Stalls.** 20 bot-games stood still over 8 s (longest: Easy 17.8 s, Normal 15.6 s, Hard 11.8 s), against 6 of 800 and a 10 s
  maximum in section 5. Not investigated here. One candidate, not confirmed: the chest module keeps a bot at a chest while its pick is
  pending, a deliberate wait that the stall watch (`brain.ts` `watchStall`) does not list. The stalls of the zone maps were traced
  later and fixed (section 7); whether these 20 had the same cause was not checked.
* **Who wins.** By faction: Plague 34.2%, Frost 24.4%, Sentenced 10.6%, Fire 7.3%, Holy 6.9% of bot-games; by persona: hunter 21.0%,
  cautious 18.3%, opportunist 16.0%, farmer 11.3%. That spread is the factions' and the sim's, not the tiers'.

Tuning stopped here by owner decision. The numbers above are the baseline on the 64x64 map; section 7 has the one on the zone maps.

## 7. After the follow-up (the zone maps; the lock kept on a camp mate)

The first full runs on the 96x96 zone maps showed 32 bot-games in 2400 (seed 3) and 28 (seed 4) standing still over 8 s, 30 of
the 32 on Holy or Frost. A replay of 100 of those games put all 11 stalls against Frost shield mobs that a wand or an axe cannot
hurt, with the lock flipping between bunched camp mates: a camp fights as one (camp-wide aggro), so its mobs crowd the bot, a click
meant for one lands on its neighbour within `TARGET_SNAP_RADIUS`, and a `target` on another fighter cancels the windup the lock was
winding up (CLAUDE.md "Target lock").

**The change** (`tactics/fight.ts` `lockedMate`). For a mob goal, when the server's lock is on a live mob within `MATE_RADIUS`
(140 u) of the goal's mob or in its camp, the fight is that mate's: the bot sends no click, counts as attacking when the mate is in
reach, and the swap and the orb-walk read the mate. A mate is not kept when it is walking home, an elite while the goal's mob is
none, a shooter while the goal's mob is none, or something the bot's weapons cannot hurt (`bestEdge` of -2 or worse). A lock on a
player, or an empty lock, is clicked as before.

**Measured.** The same tree with and without the change; `npm run tournament -- --games 400 --workers 8 --lineup E,E,N,N,H,H
--patience 300 --sudden 60 --max-minutes 15 --seed S --quiet`, S = 3 and 4, learning on, 2400 bot-games each (800 a tier). The
"after" column of seed 3 was re-run on the committed tree and came out identical (tier table, stalls).

| | seed 3 before | seed 3 after | seed 4 before | seed 4 after |
|---|---|---|---|---|
| bot-games standing still over 8 s (over 4 s) | 32 (62) | 0 (0) | 28 (69) | 0 (2) |
| longest stall | 23.3 s | 3.8 s | 30.5 s | 8.0 s |
| lock clicks on the wrong fighter, per bot-game | 1.9 | 0.8 | 1.9 | 0.8 |
| lock clicks, per bot-game | 8 | 6 | 8 | 6 |
| mob kills per bot-game | 3.23 | 3.23 | 3.25 | 3.25 |
| bots dead to a mob / to a bot (of 2400) | 839 / 1058 | 834 / 1059 | 906 / 994 | 882 / 1020 |
| mob goals dropped per bot-game | 0.48 | 0.62 | 0.51 | 0.61 |
| mean / median game | 187.3 / 196.7 s | 195.8 / 208.2 s | 189.4 / 194.8 s | 195.4 / 204.6 s |
| win share Hard / Normal / Easy | 17.5 / 18.1 / 14.4% | 18.9 / 15.8 / 15.4% | 18.3 / 16.5 / 15.3% | 17.9 / 16.3 / 15.9% |
| mean placement Hard / Normal / Easy | 3.50 / 3.44 / 3.56 | 3.40 / 3.57 / 3.53 | 3.40 / 3.55 / 3.55 | 3.42 / 3.58 / 3.50 |

* **The stall is gone.** No bot stood still over 8 s on either seed, so the bound of BOTS.md 9.3 passes again, and a bot
  clicks the wrong fighter less than half as often (what is left is the tiers' misclick and slip model plus crowds).
* **Nothing else moved beyond noise.** Mob kills are identical, deaths to a mob and to a bot move by a few percent, the win shares
  move by 1 to 3 points either way (the 95% half-width is about 2.5), the mean game is 3 to 5% longer (the median 5 to 6%). Hard
  is first by win share after the change on both seeds; before it, seed 3 had Normal ahead of Hard. That is not claimed as an
  effect of the change. The tiers are as weakly separated as in section 6: Hard leads by about 0.1 to 0.2 of mean placement,
  Normal and Easy are not apart (Normal is behind Easy on placement on both seeds).
* **What it costs.** `MobHunter` drops the goal's mob after `stallAttackMs` (3 s) of attacking without hurting it ("attacks do
  not hurt it") and bans it for `stallBanMs` (30 s). A bot that now stays on the mate does no damage to the goal's mob, so the
  hunt gives up on it more often: 0.48 to 0.62 and 0.51 to 0.61 goals dropped per bot-game. A later fix: switch the hunter's
  target to the locked mate, so the ban does not fall on a mob the bot never meant to leave.
* **Still open** (CLAUDE.md "Known TODOs"): the hunt sizes a fight against one mob although the whole camp wakes (D24), and a
  flee walks a straight line away (`retreatPoint`) instead of a route; 72% of the deaths in a replay of 40 games were while
  fleeing.
