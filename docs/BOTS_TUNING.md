# Bot tier tuning log

Working log of the tuning of the three skill tiers (docs/BOTS.md 2.2, 5, 9.3). Every figure is from the headless tournament
(`npm run tournament`), real timers (`--patience 300 --sudden 60 --max-minutes 15`), lineup E,E,N,N,H,H unless said, learning on
(the default), 400 games = 800 bot-games per tier. A per-bot win share has a 95% Wilson half-width of about 2.5 points at 800
bot-games, a tier's mean placement a 90% half-width of about 0.08.

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
