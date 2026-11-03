# Farming-route proof (numbers only). Data: MOB_HP_MULT 2, MOB_DMG_MULT 0.5, MOB_KILL_STACKS 3; on top: hp x1, stacks x1, mob damage x1, rewards: -. 24 maps x 4 rosters, horizon 600 s, cannons on, others: bots, players on the map: 8

## 1. Map facts (walk field over the move mask, at base speed 170 u/s)
- normal camps a map: 40 (plus 10 elite camps, left out: they pay augments, not stats)
- spawn to nearest normal camp: 325 u = 1.9 s
- camp to nearest other normal camp: 661 u = 3.9 s (median 3.9 s)
- camp to nearest camp of one given type (20 types, 2-3 camps each a map): 2114 u = 12.4 s
- camp to a random normal camp: 2436 u = 14.3 s

## 2. Time to kill (model): a fresh player on its build weapon against a 4-mob camp of each type, seconds · hp cost
Real sim for scale (bench/campDuel.ts --pulls camp --weapon sig, fresh starters on the signature weapon, 4-mob camps, same
numbers): 5-45 s a camp and 15-85% of max hp; the model below is the same order on the same sheet.

| build (weapon) | fire | sentenced | plague | frost | holy | mean s | mean hp |
|---|---|---|---|---|---|---|---|
| fire:A (sword) | 5s · 31% | 9s · 43% | 7s · 33% | 12s · 40% | 9s · 30% | 8 | 35% |
| fire:B (shield) | 4s · 30% | 9s · 43% | 7s · 33% | 12s · 39% | 9s · 30% | 8 | 35% |
| sentenced:A (sword) | 11s · 41% | 22s · 61% | 19s · 48% | 30s · 53% | 24s · 42% | 21 | 49% |
| sentenced:B (bow) | 13s · 46% | 25s · 65% | 18s · 45% | 36s · 56% | 25s · 42% | 23 | 51% |
| plague:A (wand) | 7s · 30% | 14s · 43% | 11s · 32% | 19s · 38% | 15s · 30% | 13 | 35% |
| plague:B (wand) | 7s · 29% | 14s · 42% | 11s · 31% | 19s · 36% | 14s · 28% | 13 | 33% |
| frost:A (shield) | 12s · 29% | 23s · 42% | 23s · 37% | 32s · 37% | 28s · 32% | 23 | 35% |
| frost:B (bow) | 15s · 35% | 31s · 48% | 22s · 35% | 42s · 41% | 30s · 32% | 28 | 38% |
| holy:A (axe) | 8s · 10% | 16s · 14% | 19s · 20% | 23s · 15% | 23s · 6% | 18 | 13% |
| holy:B (wand) | 11s · 13% | 21s · 17% | 19s · 18% | 29s · 17% | 24s · 5% | 21 | 14% |

The field: the mean bonus kit of every player at 600 s (mean 64 kills, min 23, max 168): ad 9.7, ap 22.5, armor 33.3, shield 40.5, maxHp 0.281, attackSpeed 0.207, moveSpeed 0.0959, lifesteal 0.0448, damage 0.212

## 3b. What one kill is worth to each build (combat lens, a player holding the field's kit; 100 = the build's best stat)

| build | ad | ap | armor | shield | maxHp | attackSpeed | moveSpeed | lifesteal | damage | best mob types (stat) |
|---|---|---|---|---|---|---|---|---|---|---|
| fire:A (sword) | 13 | 45 | 76 | 55 | 73 | 25 | 0 | 33 | 100 | Ember Imp, Inquisitor, Bailiff, Rime Stalker, Zealot |
| fire:B (shield) | 12 | 23 | 91 | 72 | 73 | 28 | 0 | 34 | 100 | Ember Imp, Inquisitor, Bailiff, Rime Stalker, Zealot |
| sentenced:A (sword) | 15 | 64 | 62 | 50 | 72 | 100 | 0 | 29 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Magma Brute |
| sentenced:B (bow) | 66 | 16 | 63 | 51 | 72 | 100 | 0 | 29 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Magma Brute |
| plague:A (wand) | 10 | 100 | 34 | 22 | 54 | 30 | 0 | 20 | 72 | Flame Caller, Miasma Witch, Ember Imp, Inquisitor, Magma Brute |
| plague:B (wand) | 14 | 100 | 35 | 23 | 63 | 30 | 0 | 22 | 73 | Flame Caller, Miasma Witch, Ember Imp, Inquisitor, Magma Brute |
| frost:A (shield) | 0 | 24 | 81 | 74 | 75 | 100 | 0 | 44 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Bailiff |
| frost:B (bow) | 93 | 0 | 40 | 25 | 74 | 100 | 0 | 38 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Pardoner |
| holy:A (axe) | 80 | 0 | 49 | 25 | 64 | 100 | 0 | 16 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Pardoner |
| holy:B (wand) | 22 | 71 | 49 | 25 | 45 | 100 | 0 | 19 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Flame Caller |

## 3. Break-even detour (analytic, one decision at a time)
The decision: the camp next to you is not for your build; is walking on to the nearest camp that is worth it? From a camp,
the build camp b beats the nearest camp n iff v_b/(w_b + c_b) > v_n/(w_n + c_n). With equal clears that is:
extra walk < (r - 1) x (w_n + c), r = v_b / v_n. Rewards that scale both v's alike cancel; time-to-kill c moves the line.
v counts the camp's mobs; a fresh player, every camp up. 'design' values kills by the build's weights, 'combat' by what
they add to duel power for the build holding the kit its routed player ends with, against the field.

| build | r (design) | nearest cycle w_n + c (s) | affordable extra walk (s) | actual extra walk to its nearest build camp (s) | pays (design) | pays (combat) |
|---|---|---|---|---|---|---|
| fire:A | 3.13 | 12.6 | 26.9 | 2.4 | 97% | 36% |
| fire:B | 3.34 | 10.9 | 25.6 | 1.0 | 98% | 57% |
| sentenced:A | 2.58 | 25.4 | 40.2 | 1.4 | 98% | 41% |
| sentenced:B | 3.37 | 25.8 | 61.0 | 2.4 | 91% | 64% |
| plague:A | 4.03 | 17.8 | 53.7 | 3.8 | 99% | 48% |
| plague:B | 3.53 | 16.3 | 41.3 | 3.9 | 98% | 56% |
| frost:A | 3.78 | 25.3 | 70.3 | 1.9 | 98% | 68% |
| frost:B | 2.86 | 34.3 | 63.9 | 2.4 | 98% | 68% |
| holy:A | 3.09 | 20.3 | 42.4 | 2.4 | 97% | 41% |
| holy:B | 3.33 | 25.1 | 58.3 | 3.2 | 99% | 41% |

## 3c. Defense and Soul Defense as counters (one kill of it, against one kill of max health / of the best other stat)

| you (nearest-farmer kit) | Defense vs Offense builds | Soul Def. vs Soul Offence builds | Defense vs the field | Soul Def. vs the field |
|---|---|---|---|---|
| fire:A | 1.42 / 1.02 | 1.21 / 0.97 | 1.08 / 0.72 | 0.85 / 0.56 |
| fire:B | 1.63 / 1.15 | 1.41 / 1.13 | 1.30 / 0.86 | 1.10 / 0.72 |
| sentenced:A | 0.99 / 0.75 | 0.93 / 0.76 | 0.81 / 0.56 | 0.70 / 0.48 |
| sentenced:B | 0.98 / 0.76 | 0.93 / 0.77 | 0.81 / 0.56 | 0.70 / 0.49 |
| plague:A | 0.83 / 0.46 | 0.70 / 0.42 | 0.60 / 0.31 | 0.42 / 0.21 |
| plague:B | 0.72 / 0.48 | 0.65 / 0.43 | 0.54 / 0.31 | 0.37 / 0.22 |
| frost:A | 1.18 / 0.92 | 1.11 / 0.92 | 1.04 / 0.74 | 0.98 / 0.69 |
| frost:B | 0.69 / 0.54 | 0.55 / 0.46 | 0.51 / 0.36 | 0.33 / 0.24 |
| holy:A | 0.80 / 0.46 | 0.71 / 0.55 | 0.84 / 0.36 | 0.62 / 0.26 |
| holy:B | 1.16 / 0.47 | 0.93 / 0.56 | 1.44 / 0.36 | 1.04 / 0.26 |

## 4. Route simulation: value banked at 300 s and 600 s (mean over maps x rosters x random starts)
design = weighted stacks (1 per wanted stack, 0.25 per unwanted); combat = duel power vs the field in log units
(+0.10 is about +4.5 win points against it). 'walk/kill' is seconds walked per kill; 'skip' how often the plan passed the
nearest camp. h2h = targeted (combat lens) against nearest, same faction and weapon, win % under the noise model.

| build | strategy | kills@300 | kills@600 | design@300 | design@600 | combat@300 | combat@600 | walk/kill | rest+wait s | skip | detour s/skip |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fire:A | nearest | 59 | 106 | 70 | 132 | +0.959 | +1.643 | 2.0 | 206 | 0% | 0.0 |
| fire:A | onbuild | 37 | 66 | 95 | 172 | +0.664 | +1.071 | 2.6 | 363 | 58% | 35.9 |
| fire:A | targeted:design | 56 | 98 | 115 | 207 | +0.901 | +1.446 | 2.0 | 306 | 46% | 24.1 |
| fire:A | targeted:combat | 56 | 97 | 86 | 149 | +1.269 | +1.987 | 2.3 | 244 | 45% | 13.1 |
| fire:B | nearest | 60 | 107 | 96 | 169 | +1.023 | +1.734 | 2.0 | 210 | 0% | 0.0 |
| fire:B | onbuild | 46 | 79 | 107 | 184 | +1.019 | +1.504 | 2.5 | 242 | 38% | 18.0 |
| fire:B | targeted:design | 52 | 86 | 121 | 204 | +0.974 | +1.427 | 2.3 | 257 | 50% | 16.3 |
| fire:B | targeted:combat | 56 | 96 | 98 | 161 | +1.381 | +2.172 | 2.3 | 254 | 47% | 12.8 |
| sentenced:A | nearest | 35 | 70 | 53 | 105 | +0.765 | +1.344 | 2.4 | 152 | 0% | 0.0 |
| sentenced:A | onbuild | 28 | 52 | 64 | 117 | +0.632 | +0.983 | 2.7 | 218 | 51% | 18.1 |
| sentenced:A | targeted:design | 31 | 55 | 69 | 121 | +0.715 | +1.072 | 2.4 | 228 | 58% | 18.6 |
| sentenced:A | targeted:combat | 39 | 72 | 53 | 101 | +1.138 | +1.772 | 2.7 | 221 | 58% | 14.9 |
| sentenced:B | nearest | 34 | 66 | 40 | 78 | +0.646 | +1.149 | 2.3 | 146 | 0% | 0.0 |
| sentenced:B | onbuild | 20 | 36 | 53 | 95 | +0.574 | +0.914 | 3.2 | 261 | 75% | 28.0 |
| sentenced:B | targeted:design | 29 | 49 | 64 | 109 | +0.804 | +1.203 | 2.7 | 276 | 69% | 28.5 |
| sentenced:B | targeted:combat | 35 | 64 | 58 | 105 | +1.000 | +1.599 | 2.8 | 218 | 58% | 16.4 |
| plague:A | nearest | 47 | 89 | 53 | 102 | +0.757 | +1.368 | 2.2 | 183 | 0% | 0.0 |
| plague:A | onbuild | 24 | 44 | 73 | 133 | +0.671 | +1.066 | 2.8 | 407 | 72% | 46.1 |
| plague:A | targeted:design | 42 | 73 | 85 | 151 | +0.971 | +1.514 | 2.2 | 333 | 59% | 29.6 |
| plague:A | targeted:combat | 47 | 84 | 74 | 130 | +1.279 | +2.033 | 2.5 | 268 | 54% | 20.9 |
| plague:B | nearest | 48 | 89 | 57 | 104 | +0.787 | +1.397 | 2.2 | 186 | 0% | 0.0 |
| plague:B | onbuild | 22 | 37 | 66 | 112 | +0.575 | +0.875 | 3.1 | 339 | 79% | 39.4 |
| plague:B | targeted:design | 36 | 60 | 76 | 129 | +0.782 | +1.166 | 2.5 | 274 | 62% | 23.3 |
| plague:B | targeted:combat | 47 | 85 | 60 | 108 | +1.295 | +2.051 | 2.5 | 264 | 54% | 18.8 |
| frost:A | nearest | 33 | 67 | 55 | 109 | +1.181 | +1.873 | 2.4 | 148 | 0% | 0.0 |
| frost:A | onbuild | 26 | 47 | 72 | 132 | +1.266 | +1.782 | 2.7 | 206 | 50% | 17.9 |
| frost:A | targeted:design | 29 | 50 | 82 | 140 | +1.401 | +1.840 | 2.5 | 245 | 66% | 21.6 |
| frost:A | targeted:combat | 34 | 64 | 70 | 126 | +1.641 | +2.323 | 2.7 | 215 | 58% | 15.8 |
| frost:B | nearest | 29 | 57 | 39 | 74 | +0.805 | +1.294 | 2.4 | 121 | 0% | 0.0 |
| frost:B | onbuild | 28 | 51 | 62 | 111 | +0.783 | +1.219 | 2.2 | 300 | 63% | 30.8 |
| frost:B | targeted:design | 30 | 52 | 67 | 114 | +0.912 | +1.315 | 2.3 | 290 | 65% | 28.3 |
| frost:B | targeted:combat | 27 | 50 | 49 | 83 | +1.244 | +1.783 | 2.8 | 251 | 72% | 24.6 |
| holy:A | nearest | 39 | 75 | 49 | 93 | +0.910 | +1.876 | 2.3 | 159 | 0% | 0.0 |
| holy:A | onbuild | 24 | 42 | 61 | 103 | +0.418 | +0.699 | 2.9 | 260 | 72% | 24.5 |
| holy:A | targeted:design | 31 | 52 | 66 | 110 | +0.584 | +1.013 | 2.5 | 270 | 65% | 22.5 |
| holy:A | targeted:combat | 41 | 72 | 46 | 79 | +1.807 | +3.322 | 2.6 | 257 | 60% | 18.8 |
| holy:B | nearest | 36 | 69 | 42 | 81 | +0.869 | +1.856 | 2.3 | 144 | 0% | 0.0 |
| holy:B | onbuild | 24 | 42 | 59 | 104 | +0.303 | +0.726 | 2.7 | 312 | 73% | 33.1 |
| holy:B | targeted:design | 31 | 54 | 68 | 118 | +0.702 | +1.398 | 2.5 | 297 | 61% | 30.5 |
| holy:B | targeted:combat | 37 | 66 | 39 | 77 | +1.655 | +3.113 | 2.7 | 258 | 63% | 21.2 |

## 5. Verdict per build: is walking to the build's camps worth it, against farming the nearest camp?

- decisions: in the games, the nearest farmable camp was off-build; a build camp paid more of the build's value a second
- games (build value): routing by the build's weights banked more of them than farming the nearest camp
- games (fights): routing by what the kills add in a duel ended with more duel power against the field
- mirror: that kit against the nearest farmer's, same faction and weapon, win % under the noise model; the last column is
  the same for the kit routed by the bots' build weights (the build as the bots define it)

| build | decisions worth it | games (build value) | design gain | games (fights) | combat gain | mirror | mirror, bots' weights | walk per kill x | holds |
|---|---|---|---|---|---|---|---|---|---|
| fire:A | 73% | 97% | +57% | 93% | +0.34 | 73% | 39% | 0.98 | YES |
| fire:B | 86% | 86% | +20% | 94% | +0.44 | 76% | 35% | 1.15 | YES |
| sentenced:A | 84% | 86% | +16% | 94% | +0.43 | 73% | 39% | 1.03 | YES |
| sentenced:B | 80% | 96% | +39% | 95% | +0.45 | 73% | 49% | 1.17 | YES |
| plague:A | 68% | 89% | +48% | 94% | +0.66 | 84% | 58% | 1.04 | YES |
| plague:B | 69% | 88% | +25% | 95% | +0.65 | 84% | 40% | 1.16 | YES |
| frost:A | 96% | 95% | +29% | 94% | +0.45 | 76% | 48% | 1.04 | YES |
| frost:B | 92% | 97% | +54% | 97% | +0.49 | 76% | 48% | 0.94 | YES |
| holy:A | 79% | 82% | +19% | 96% | +1.45 | 100% | 0% | 1.09 | YES |
| holy:B | 83% | 96% | +46% | 96% | +1.26 | 100% | 5% | 1.06 | YES |

ALL BUILDS HOLD

## 6. Sweep: mob time-to-kill (mob hp x s) with the reward per kill scaled alike (stacks x s, so a minute of farming pays
the same), and time-to-kill alone (stacks x 1). Where does targeting stop paying?

| mob hp x | stacks x | builds holding | worst design gain | worst combat gain | worst mirror h2h | mean design gain | mean combat gain |
|---|---|---|---|---|---|---|---|
| 0.25 | 0.25 | 5/10 | +20% | +0.106 | 56% | +33% | +0.198 |
| 0.5 | 0.5 | 9/10 | +14% | +0.196 | 62% | +35% | +0.361 |
| 0.75 | 0.75 | 7/10 | +16% | +0.330 | 68% | +36% | +0.516 |
| 1.0 | 1.0 | 10/10 | +16% | +0.344 | 73% | +35% | +0.662 |
| 1.5 | 1.5 | 8/10 | +17% | +0.773 | 87% | +42% | +1.155 |
| 2.0 | 2.0 | 8/10 | +25% | +1.300 | 96% | +65% | +2.043 |
| 0.5 | 1.0 | 4/10 | +11% | +0.240 | 69% | +34% | +0.594 |
| 1.5 | 1.0 | 10/10 | +21% | +0.460 | 77% | +45% | +0.833 |
| 2.0 | 1.0 | 10/10 | +35% | +0.524 | 75% | +73% | +1.052 |

