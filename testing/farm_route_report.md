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

The field: the mean bonus kit of every player at 600 s (mean 65 kills, min 23, max 133): ad 9.13, ap 23.3, armor 33.6, shield 40.1, maxHp 0.291, attackSpeed 0.206, moveSpeed 0.0948, lifesteal 0.0448, damage 0.223

## 3b. What one kill is worth to each build (combat lens, a player holding the field's kit; 100 = the build's best stat)

| build | ad | ap | armor | shield | maxHp | attackSpeed | moveSpeed | lifesteal | damage | best mob types (stat) |
|---|---|---|---|---|---|---|---|---|---|---|
| fire:A (sword) | 13 | 46 | 77 | 55 | 73 | 25 | 0 | 33 | 100 | Ember Imp, Inquisitor, Bailiff, Rime Stalker, Zealot |
| fire:B (shield) | 12 | 24 | 91 | 73 | 74 | 28 | 0 | 35 | 100 | Ember Imp, Inquisitor, Bailiff, Rime Stalker, Zealot |
| sentenced:A (sword) | 15 | 64 | 62 | 50 | 71 | 100 | 0 | 29 | 99 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Magma Brute |
| sentenced:B (bow) | 66 | 16 | 63 | 51 | 71 | 100 | 0 | 29 | 99 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Magma Brute |
| plague:A (wand) | 10 | 100 | 34 | 22 | 54 | 30 | 0 | 20 | 72 | Flame Caller, Miasma Witch, Ember Imp, Inquisitor, Magma Brute |
| plague:B (wand) | 14 | 100 | 35 | 23 | 63 | 30 | 0 | 22 | 72 | Flame Caller, Miasma Witch, Ember Imp, Inquisitor, Magma Brute |
| frost:A (shield) | 0 | 24 | 80 | 74 | 74 | 100 | 0 | 44 | 99 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Bailiff |
| frost:B (bow) | 93 | 0 | 40 | 25 | 73 | 100 | 0 | 37 | 99 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Pardoner |
| holy:A (axe) | 80 | 0 | 49 | 25 | 63 | 100 | 0 | 16 | 99 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Pardoner |
| holy:B (wand) | 22 | 71 | 49 | 25 | 44 | 100 | 0 | 19 | 99 | Plague Rat, Frostbow Sentry, Ember Imp, Inquisitor, Flame Caller |

## 3. Break-even detour (analytic, one decision at a time)
The decision: the camp next to you is not for your build; is walking on to the nearest camp that is worth it? From a camp,
the build camp b beats the nearest camp n iff v_b/(w_b + c_b) > v_n/(w_n + c_n). With equal clears that is:
extra walk < (r - 1) x (w_n + c), r = v_b / v_n. Rewards that scale both v's alike cancel; time-to-kill c moves the line.
v counts the camp's mobs; a fresh player, every camp up. 'design' values kills by the build's weights, 'combat' by what
they add to duel power for the build holding the kit its routed player ends with, against the field.

| build | r (design) | nearest cycle w_n + c (s) | affordable extra walk (s) | actual extra walk to its nearest build camp (s) | pays (design) | pays (combat) |
|---|---|---|---|---|---|---|
| fire:A | 2.88 | 11.2 | 21.1 | 1.5 | 92% | 70% |
| fire:B | 3.09 | 11.4 | 23.8 | 0.8 | 98% | 72% |
| sentenced:A | 2.71 | 22.9 | 39.1 | 0.9 | 90% | 98% |
| sentenced:B | 3.04 | 26.8 | 54.9 | 1.6 | 99% | 89% |
| plague:A | 3.16 | 17.8 | 38.4 | 3.8 | 96% | 56% |
| plague:B | 3.26 | 16.9 | 38.3 | 2.5 | 94% | 69% |
| frost:A | 2.76 | 26.4 | 46.4 | 1.8 | 84% | 69% |
| frost:B | 2.99 | 31.6 | 62.8 | 1.6 | 94% | 99% |
| holy:A | 3.00 | 21.5 | 43.1 | 1.8 | 99% | 71% |
| holy:B | 3.34 | 26.6 | 62.2 | 2.3 | 100% | 99% |

## 3c. Defense and Soul Defense as counters (one kill of it, against one kill of max health / of the best other stat)

| you (nearest-farmer kit) | Defense vs Offense builds | Soul Def. vs Soul Offence builds | Defense vs the field | Soul Def. vs the field |
|---|---|---|---|---|
| fire:A | 1.30 / 0.86 | 1.15 / 0.88 | 1.07 / 0.67 | 0.71 / 0.44 |
| fire:B | 1.46 / 0.96 | 1.34 / 1.00 | 1.25 / 0.77 | 0.93 / 0.57 |
| sentenced:A | 1.23 / 0.67 | 0.96 / 0.76 | 0.97 / 0.56 | 0.71 / 0.41 |
| sentenced:B | 1.25 / 0.68 | 0.95 / 0.76 | 0.98 / 0.57 | 0.71 / 0.41 |
| plague:A | 0.83 / 0.43 | 0.76 / 0.46 | 0.64 / 0.32 | 0.39 / 0.19 |
| plague:B | 0.72 / 0.44 | 0.71 / 0.47 | 0.56 / 0.33 | 0.34 / 0.20 |
| frost:A | 1.24 / 0.81 | 1.20 / 0.92 | 1.10 / 0.70 | 1.01 / 0.63 |
| frost:B | 0.74 / 0.47 | 0.63 / 0.50 | 0.56 / 0.35 | 0.32 / 0.20 |
| holy:A | 0.80 / 0.69 | 0.72 / 0.56 | 0.62 / 0.44 | 0.38 / 0.27 |
| holy:B | 0.99 / 0.11 | 0.92 / 0.57 | 0.81 / 0.13 | 0.49 / 0.08 |

## 4. Route simulation: value banked at 300 s and 600 s (mean over maps x rosters x random starts)
design = weighted stacks (1 per wanted stack, 0.25 per unwanted); combat = duel power vs the field in log units
(+0.10 is about +4.5 win points against it). 'walk/kill' is seconds walked per kill; 'skip' how often the plan passed the
nearest camp. h2h = targeted (combat lens) against nearest, same faction and weapon, win % under the noise model.

| build | strategy | kills@300 | kills@600 | design@300 | design@600 | combat@300 | combat@600 | walk/kill | rest+wait s | skip | detour s/skip |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fire:A | nearest | 55 | 99 | 90 | 163 | +0.771 | +1.361 | 2.1 | 222 | 0% | 0.0 |
| fire:A | onbuild | 37 | 67 | 95 | 172 | +0.853 | +1.377 | 2.7 | 281 | 55% | 20.1 |
| fire:A | targeted:design | 52 | 87 | 118 | 198 | +1.067 | +1.679 | 2.4 | 255 | 49% | 14.1 |
| fire:A | targeted:combat | 49 | 83 | 111 | 188 | +1.101 | +1.729 | 2.5 | 254 | 54% | 14.5 |
| fire:B | nearest | 55 | 100 | 107 | 194 | +0.840 | +1.455 | 2.1 | 228 | 0% | 0.0 |
| fire:B | onbuild | 44 | 80 | 117 | 209 | +1.044 | +1.643 | 2.6 | 249 | 34% | 17.4 |
| fire:B | targeted:design | 53 | 91 | 135 | 231 | +1.164 | +1.847 | 2.4 | 242 | 46% | 11.2 |
| fire:B | targeted:combat | 49 | 84 | 130 | 220 | +1.216 | +1.932 | 2.5 | 266 | 54% | 15.7 |
| sentenced:A | nearest | 31 | 62 | 51 | 100 | +0.570 | +1.030 | 2.4 | 180 | 0% | 0.0 |
| sentenced:A | onbuild | 27 | 50 | 60 | 114 | +0.726 | +1.225 | 2.9 | 214 | 38% | 19.5 |
| sentenced:A | targeted:design | 31 | 57 | 69 | 126 | +0.837 | +1.330 | 2.8 | 232 | 59% | 17.7 |
| sentenced:A | targeted:combat | 30 | 55 | 67 | 122 | +0.908 | +1.435 | 2.9 | 260 | 66% | 23.0 |
| sentenced:B | nearest | 29 | 59 | 34 | 67 | +0.471 | +0.848 | 2.5 | 181 | 0% | 0.0 |
| sentenced:B | onbuild | 18 | 35 | 43 | 82 | +0.580 | +0.992 | 3.3 | 314 | 75% | 36.0 |
| sentenced:B | targeted:design | 24 | 43 | 50 | 90 | +0.682 | +1.118 | 3.0 | 321 | 74% | 36.3 |
| sentenced:B | targeted:combat | 27 | 50 | 50 | 91 | +0.779 | +1.278 | 3.0 | 267 | 69% | 24.5 |
| plague:A | nearest | 44 | 81 | 46 | 91 | +0.600 | +1.154 | 2.2 | 202 | 0% | 0.0 |
| plague:A | onbuild | 20 | 37 | 52 | 102 | +0.620 | +1.035 | 2.9 | 444 | 79% | 53.3 |
| plague:A | targeted:design | 41 | 70 | 69 | 125 | +0.848 | +1.380 | 2.2 | 337 | 56% | 31.3 |
| plague:A | targeted:combat | 37 | 67 | 65 | 118 | +1.044 | +1.686 | 2.7 | 299 | 63% | 26.6 |
| plague:B | nearest | 44 | 82 | 49 | 96 | +0.629 | +1.180 | 2.2 | 197 | 0% | 0.0 |
| plague:B | onbuild | 25 | 47 | 63 | 118 | +0.808 | +1.314 | 3.0 | 338 | 69% | 35.2 |
| plague:B | targeted:design | 41 | 71 | 76 | 137 | +0.945 | +1.478 | 2.3 | 312 | 58% | 27.7 |
| plague:B | targeted:combat | 38 | 69 | 74 | 132 | +1.083 | +1.729 | 2.7 | 290 | 62% | 24.4 |
| frost:A | nearest | 32 | 61 | 48 | 90 | +1.093 | +1.608 | 2.4 | 157 | 0% | 0.0 |
| frost:A | onbuild | 27 | 47 | 65 | 115 | +1.403 | +1.828 | 2.7 | 243 | 58% | 19.7 |
| frost:A | targeted:design | 31 | 54 | 70 | 122 | +1.504 | +1.998 | 2.6 | 253 | 67% | 19.0 |
| frost:A | targeted:combat | 29 | 55 | 66 | 118 | +1.512 | +2.101 | 2.8 | 239 | 66% | 18.4 |
| frost:B | nearest | 27 | 53 | 33 | 64 | +0.732 | +1.117 | 2.5 | 143 | 0% | 0.0 |
| frost:B | onbuild | 20 | 38 | 46 | 85 | +0.807 | +1.284 | 3.1 | 256 | 70% | 26.7 |
| frost:B | targeted:design | 24 | 42 | 54 | 94 | +1.026 | +1.508 | 2.9 | 323 | 76% | 37.5 |
| frost:B | targeted:combat | 23 | 40 | 46 | 84 | +1.116 | +1.561 | 3.1 | 279 | 80% | 30.2 |
| holy:A | nearest | 38 | 70 | 45 | 82 | +0.625 | +1.321 | 2.2 | 166 | 0% | 0.0 |
| holy:A | onbuild | 28 | 49 | 64 | 110 | +0.602 | +1.360 | 3.0 | 261 | 71% | 21.1 |
| holy:A | targeted:design | 34 | 57 | 69 | 116 | +0.974 | +1.758 | 2.5 | 278 | 66% | 21.2 |
| holy:A | targeted:combat | 35 | 58 | 51 | 88 | +1.444 | +2.411 | 2.7 | 297 | 71% | 26.4 |
| holy:B | nearest | 34 | 63 | 36 | 68 | +0.597 | +1.288 | 2.3 | 159 | 0% | 0.0 |
| holy:B | onbuild | 21 | 40 | 51 | 95 | +1.076 | +1.907 | 2.9 | 384 | 73% | 47.4 |
| holy:B | targeted:design | 31 | 52 | 55 | 98 | +1.092 | +1.879 | 2.4 | 343 | 65% | 39.5 |
| holy:B | targeted:combat | 30 | 53 | 53 | 96 | +1.279 | +2.226 | 2.8 | 300 | 70% | 31.1 |

## 5. Verdict per build: is walking to the build's camps worth it, against farming the nearest camp?

- decisions: in the games, the nearest farmable camp was off-build; a build camp paid more of the build's value a second
- games (build value): routing by the build's weights banked more of them than farming the nearest camp
- games (fights): routing by what the kills add in a duel ended with more duel power against the field
- mirror: that kit against the nearest farmer's, same faction and weapon, win % under the noise model; the last column is
  the same for the kit routed by the bots' build weights (the build as the bots define it)

| build | decisions worth it | games (build value) | design gain | games (fights) | combat gain | mirror | mirror, bots' weights | walk per kill x | holds |
|---|---|---|---|---|---|---|---|---|---|
| fire:A | 69% | 93% | +21% | 92% | +0.37 | 75% | 72% | 1.17 | YES |
| fire:B | 75% | 86% | +19% | 94% | +0.48 | 80% | 76% | 1.17 | YES |
| sentenced:A | 87% | 91% | +25% | 94% | +0.41 | 69% | 67% | 1.16 | YES |
| sentenced:B | 75% | 94% | +34% | 98% | +0.43 | 71% | 61% | 1.21 | YES |
| plague:A | 56% | 94% | +38% | 95% | +0.53 | 77% | 63% | 1.01 | NO |
| plague:B | 70% | 93% | +43% | 96% | +0.55 | 79% | 69% | 1.03 | YES |
| frost:A | 87% | 94% | +36% | 94% | +0.49 | 77% | 71% | 1.10 | YES |
| frost:B | 87% | 95% | +47% | 98% | +0.44 | 74% | 70% | 1.18 | YES |
| holy:A | 86% | 94% | +41% | 99% | +1.09 | 100% | 100% | 1.13 | YES |
| holy:B | 70% | 89% | +43% | 97% | +0.94 | 100% | 100% | 1.03 | YES |

SOME BUILDS FAIL

