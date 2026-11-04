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
| fire:A (sword) | 5s · 46% | 9s · 66% | 7s · 39% | 12s · 60% | 9s · 41% | 8 | 51% |
| fire:B (shield) | 4s · 46% | 9s · 66% | 7s · 39% | 12s · 60% | 9s · 41% | 8 | 50% |
| sentenced:A (sword) | 11s · 63% | 22s · 93% | 19s · 59% | 30s · 82% | 24s · 58% | 21 | 71% |
| sentenced:B (bow) | 13s · 70% | 25s · 101% | 18s · 55% | 36s · 88% | 25s · 57% | 23 | 74% |
| plague:A (wand) | 7s · 46% | 14s · 67% | 11s · 40% | 19s · 59% | 15s · 41% | 13 | 50% |
| plague:B (wand) | 7s · 43% | 14s · 64% | 11s · 38% | 19s · 56% | 14s · 39% | 13 | 48% |
| frost:A (shield) | 12s · 44% | 23s · 65% | 23s · 46% | 32s · 58% | 28s · 43% | 23 | 51% |
| frost:B (bow) | 15s · 54% | 31s · 77% | 22s · 43% | 42s · 67% | 30s · 44% | 28 | 57% |
| holy:A (axe) | 8s · 20% | 16s · 28% | 19s · 26% | 23s · 28% | 23s · 12% | 18 | 23% |
| holy:B (wand) | 11s · 25% | 21s · 33% | 19s · 25% | 29s · 33% | 24s · 12% | 21 | 25% |

The field: the mean bonus kit of every player at 600 s (mean 64 kills, min 26, max 185): ad 9.73, ap 22.5, armor 33.2, shield 40.5, maxHp 0.282, attackSpeed 0.207, moveSpeed 0.0958, lifesteal 0.0448, damage 0.21

## 3b. What one kill is worth to each build (combat lens, a player holding the field's kit; 100 = the build's best stat)

| build | ad | ap | armor | shield | maxHp | attackSpeed | moveSpeed | lifesteal | damage | best mob types (stat) |
|---|---|---|---|---|---|---|---|---|---|---|
| fire:A (sword) | 13 | 45 | 76 | 54 | 73 | 25 | 0 | 33 | 100 | Ember Imp, Inquisitor, Bailiff, Rime Stalker, Zealot |
| fire:B (shield) | 12 | 23 | 91 | 72 | 73 | 27 | 0 | 34 | 100 | Ember Imp, Inquisitor, Bailiff, Rime Stalker, Zealot |
| sentenced:A (sword) | 15 | 64 | 62 | 50 | 72 | 100 | 0 | 29 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Magma Brute |
| sentenced:B (bow) | 66 | 16 | 63 | 51 | 72 | 100 | 0 | 29 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Magma Brute |
| plague:A (wand) | 10 | 100 | 34 | 22 | 54 | 30 | 0 | 20 | 72 | Flame Caller, Miasma Witch, Ember Imp, Inquisitor, Magma Brute |
| plague:B (wand) | 14 | 100 | 35 | 23 | 63 | 30 | 0 | 22 | 73 | Flame Caller, Miasma Witch, Ember Imp, Inquisitor, Magma Brute |
| frost:A (shield) | 0 | 24 | 81 | 74 | 75 | 100 | 0 | 44 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Bailiff |
| frost:B (bow) | 93 | 0 | 40 | 25 | 74 | 100 | 0 | 38 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Pardoner |
| holy:A (axe) | 80 | 0 | 49 | 25 | 64 | 100 | 0 | 16 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Pardoner |
| holy:B (wand) | 22 | 71 | 50 | 25 | 45 | 100 | 0 | 19 | 100 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Flame Caller |

## 3. Break-even detour (analytic, one decision at a time)
The decision: the camp next to you is not for your build; is walking on to the nearest camp that is worth it? From a camp,
the build camp b beats the nearest camp n iff v_b/(w_b + c_b) > v_n/(w_n + c_n). With equal clears that is:
extra walk < (r - 1) x (w_n + c), r = v_b / v_n. Rewards that scale both v's alike cancel; time-to-kill c moves the line.
v counts the camp's mobs; a fresh player, every camp up. 'design' values kills by the build's weights, 'combat' by what
they add to duel power for the build holding the kit its routed player ends with, against the field.

| build | r (design) | nearest cycle w_n + c (s) | affordable extra walk (s) | actual extra walk to its nearest build camp (s) | pays (design) | pays (combat) |
|---|---|---|---|---|---|---|
| fire:A | 3.13 | 12.7 | 26.9 | 2.4 | 97% | 36% |
| fire:B | 3.34 | 10.9 | 25.6 | 1.0 | 98% | 57% |
| sentenced:A | 2.58 | 25.5 | 40.2 | 1.4 | 98% | 42% |
| sentenced:B | 3.37 | 25.8 | 61.2 | 2.4 | 91% | 65% |
| plague:A | 4.03 | 17.8 | 53.8 | 3.8 | 99% | 49% |
| plague:B | 3.53 | 16.3 | 41.4 | 3.9 | 98% | 57% |
| frost:A | 3.78 | 25.3 | 70.4 | 1.9 | 98% | 68% |
| frost:B | 2.86 | 34.4 | 64.0 | 2.4 | 98% | 68% |
| holy:A | 3.09 | 20.3 | 42.4 | 2.4 | 97% | 41% |
| holy:B | 3.33 | 25.1 | 58.4 | 3.2 | 99% | 41% |

## 3c. Defense and Soul Defense as counters (one kill of it, against one kill of max health / of the best other stat)

| you (nearest-farmer kit) | Defense vs Offense builds | Soul Def. vs Soul Offence builds | Defense vs the field | Soul Def. vs the field |
|---|---|---|---|---|
| fire:A | 1.35 / 1.00 | 1.44 / 0.94 | 1.02 / 0.70 | 0.83 / 0.57 |
| fire:B | 1.60 / 1.14 | 1.75 / 1.10 | 1.27 / 0.84 | 1.10 / 0.73 |
| sentenced:A | 0.96 / 0.76 | 1.04 / 0.73 | 0.78 / 0.56 | 0.67 / 0.48 |
| sentenced:B | 1.01 / 0.80 | 1.05 / 0.75 | 0.82 / 0.59 | 0.69 / 0.50 |
| plague:A | 0.79 / 0.45 | 0.83 / 0.41 | 0.57 / 0.30 | 0.42 / 0.22 |
| plague:B | 0.71 / 0.48 | 0.75 / 0.41 | 0.52 / 0.31 | 0.37 / 0.22 |
| frost:A | 1.16 / 0.90 | 1.34 / 0.89 | 1.02 / 0.72 | 0.97 / 0.68 |
| frost:B | 0.67 / 0.54 | 0.65 / 0.46 | 0.49 / 0.36 | 0.34 / 0.25 |
| holy:A | 0.80 / 0.45 | 0.95 / 0.52 | 0.85 / 0.62 | 0.82 / 0.60 |
| holy:B | 1.14 / 0.46 | 1.35 / 0.53 | 2.86 / 0.36 | 1.66 / 0.21 |

## 4. Route simulation: value banked at 300 s and 600 s (mean over maps x rosters x random starts)
design = weighted stacks (1 per wanted stack, 0.25 per unwanted); combat = duel power vs the field in log units
(+0.10 is about +4.5 win points against it). 'walk/kill' is seconds walked per kill; 'skip' how often the plan passed the
nearest camp. h2h = targeted (combat lens) against nearest, same faction and weapon, win % under the noise model.

| build | strategy | kills@300 | kills@600 | design@300 | design@600 | combat@300 | combat@600 | walk/kill | rest+wait s | skip | detour s/skip |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fire:A | nearest | 58 | 106 | 71 | 133 | +0.921 | +1.604 | 2.1 | 204 | 0% | 0.0 |
| fire:A | onbuild | 35 | 63 | 92 | 164 | +0.636 | +1.031 | 2.6 | 362 | 64% | 32.1 |
| fire:A | targeted:design | 55 | 94 | 111 | 198 | +0.873 | +1.362 | 2.1 | 305 | 50% | 23.1 |
| fire:A | targeted:combat | 56 | 99 | 87 | 151 | +1.261 | +2.009 | 2.4 | 231 | 48% | 11.5 |
| fire:B | nearest | 58 | 106 | 91 | 168 | +0.979 | +1.692 | 2.1 | 208 | 0% | 0.0 |
| fire:B | onbuild | 45 | 78 | 104 | 183 | +0.989 | +1.502 | 2.5 | 243 | 41% | 14.1 |
| fire:B | targeted:design | 52 | 88 | 118 | 204 | +0.999 | +1.500 | 2.4 | 246 | 53% | 13.6 |
| fire:B | targeted:combat | 56 | 96 | 97 | 160 | +1.383 | +2.169 | 2.4 | 242 | 48% | 11.9 |
| sentenced:A | nearest | 33 | 68 | 48 | 101 | +0.699 | +1.270 | 2.4 | 159 | 0% | 0.0 |
| sentenced:A | onbuild | 25 | 48 | 57 | 110 | +0.577 | +0.941 | 3.0 | 228 | 51% | 19.8 |
| sentenced:A | targeted:design | 29 | 52 | 61 | 112 | +0.648 | +1.013 | 2.8 | 225 | 59% | 19.0 |
| sentenced:A | targeted:combat | 36 | 70 | 48 | 100 | +1.061 | +1.729 | 2.8 | 215 | 58% | 15.4 |
| sentenced:B | nearest | 31 | 63 | 37 | 74 | +0.569 | +1.052 | 2.5 | 158 | 0% | 0.0 |
| sentenced:B | onbuild | 19 | 34 | 49 | 90 | +0.544 | +0.892 | 3.3 | 292 | 77% | 33.7 |
| sentenced:B | targeted:design | 26 | 47 | 57 | 103 | +0.729 | +1.155 | 2.8 | 294 | 69% | 32.3 |
| sentenced:B | targeted:combat | 32 | 63 | 55 | 103 | +0.933 | +1.561 | 2.9 | 214 | 59% | 16.5 |
| plague:A | nearest | 46 | 88 | 54 | 102 | +0.731 | +1.343 | 2.2 | 183 | 0% | 0.0 |
| plague:A | onbuild | 24 | 43 | 72 | 130 | +0.648 | +1.049 | 2.8 | 407 | 72% | 47.0 |
| plague:A | targeted:design | 43 | 73 | 85 | 150 | +0.955 | +1.481 | 2.3 | 330 | 58% | 30.4 |
| plague:A | targeted:combat | 47 | 84 | 73 | 130 | +1.283 | +2.032 | 2.5 | 263 | 55% | 19.7 |
| plague:B | nearest | 47 | 88 | 55 | 102 | +0.753 | +1.344 | 2.2 | 185 | 0% | 0.0 |
| plague:B | onbuild | 22 | 38 | 65 | 113 | +0.569 | +0.875 | 3.1 | 338 | 80% | 38.6 |
| plague:B | targeted:design | 37 | 62 | 74 | 127 | +0.793 | +1.191 | 2.5 | 264 | 60% | 22.9 |
| plague:B | targeted:combat | 48 | 86 | 62 | 110 | +1.301 | +2.057 | 2.5 | 257 | 56% | 17.7 |
| frost:A | nearest | 34 | 69 | 57 | 113 | +1.220 | +1.895 | 2.4 | 137 | 0% | 0.0 |
| frost:A | onbuild | 26 | 48 | 73 | 135 | +1.282 | +1.820 | 2.7 | 200 | 50% | 17.1 |
| frost:A | targeted:design | 30 | 52 | 85 | 147 | +1.425 | +1.887 | 2.5 | 225 | 64% | 18.2 |
| frost:A | targeted:combat | 36 | 68 | 74 | 137 | +1.687 | +2.395 | 2.7 | 195 | 56% | 12.1 |
| frost:B | nearest | 29 | 58 | 39 | 76 | +0.798 | +1.288 | 2.4 | 127 | 0% | 0.0 |
| frost:B | onbuild | 27 | 51 | 60 | 110 | +0.744 | +1.204 | 2.3 | 299 | 62% | 29.9 |
| frost:B | targeted:design | 30 | 53 | 66 | 115 | +0.935 | +1.342 | 2.3 | 284 | 66% | 27.4 |
| frost:B | targeted:combat | 28 | 52 | 50 | 88 | +1.260 | +1.831 | 2.8 | 233 | 69% | 22.2 |
| holy:A | nearest | 40 | 78 | 49 | 96 | +0.928 | +1.941 | 2.3 | 144 | 0% | 0.0 |
| holy:A | onbuild | 25 | 42 | 61 | 104 | +0.435 | +0.703 | 2.8 | 252 | 68% | 25.0 |
| holy:A | targeted:design | 32 | 53 | 67 | 112 | +0.583 | +1.054 | 2.5 | 261 | 64% | 23.5 |
| holy:A | targeted:combat | 44 | 76 | 48 | 84 | +1.880 | +3.337 | 2.5 | 252 | 59% | 17.3 |
| holy:B | nearest | 36 | 71 | 40 | 81 | +0.847 | +1.871 | 2.3 | 131 | 0% | 0.0 |
| holy:B | onbuild | 24 | 42 | 59 | 105 | +0.303 | +0.747 | 2.8 | 309 | 72% | 34.1 |
| holy:B | targeted:design | 31 | 54 | 67 | 116 | +0.674 | +1.319 | 2.5 | 295 | 65% | 30.3 |
| holy:B | targeted:combat | 38 | 67 | 40 | 76 | +1.658 | +3.056 | 2.6 | 257 | 61% | 22.6 |

## 5. Verdict per build: is walking to the build's camps worth it, against farming the nearest camp?

- decisions: in the games, the nearest farmable camp was off-build; a build camp paid more of the build's value a second
- games (build value): routing by the build's weights banked more of them than farming the nearest camp
- games (fights): routing by what the kills add in a duel ended with more duel power against the field
- mirror: that kit against the nearest farmer's, same faction and weapon, win % under the noise model; the last column is
  the same for the kit routed by the bots' build weights (the build as the bots define it)

| build | decisions worth it | games (build value) | design gain | games (fights) | combat gain | mirror | mirror, bots' weights | walk per kill x | holds |
|---|---|---|---|---|---|---|---|---|---|
| fire:A | 73% | 96% | +49% | 96% | +0.41 | 75% | 37% | 1.00 | YES |
| fire:B | 88% | 93% | +22% | 94% | +0.48 | 78% | 42% | 1.15 | YES |
| sentenced:A | 86% | 72% | +11% | 96% | +0.46 | 73% | 39% | 1.15 | YES |
| sentenced:B | 81% | 93% | +39% | 97% | +0.51 | 75% | 51% | 1.14 | YES |
| plague:A | 70% | 90% | +47% | 99% | +0.69 | 84% | 59% | 1.03 | YES |
| plague:B | 69% | 89% | +24% | 100% | +0.71 | 86% | 44% | 1.13 | YES |
| frost:A | 95% | 93% | +31% | 98% | +0.50 | 78% | 50% | 1.08 | YES |
| frost:B | 92% | 96% | +52% | 96% | +0.54 | 79% | 50% | 0.95 | YES |
| holy:A | 79% | 79% | +17% | 99% | +1.40 | 100% | 0% | 1.08 | YES |
| holy:B | 83% | 97% | +43% | 93% | +1.18 | 100% | 1% | 1.08 | YES |

ALL BUILDS HOLD

