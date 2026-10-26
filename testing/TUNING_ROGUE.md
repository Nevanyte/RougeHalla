# Roguelike tuning log (R4a): attack speed on buffs, and the kiting guarantee

Report-only (ROGUELIKE_PLAN 6: every balance output lands here). Duel pace k = 2 throughout.

## 1. The question

The owner ruled "double them" on the R4a buff values, then asked not to halve attack speed, to try about 2/3 instead, or to
cap attack speed "relatively high, the League approach", reading "doubled" as 2x attack speed. It never was:

| Plague Rat (`plagueRat`, the only attack-speed row) | 3 stacks (quoted) | 3 kills (3.21 st, x1.11) | 4 kills (4.26 st, x1.62) | plateau (x2.105) |
|---|---|---|---|---|
| before "double them" (+4%) | x1.040 | x1.045 | x1.065 | x1.084 |
| now (+8%) | x1.080 | x1.089 | x1.129 | x1.168 |

+8% attack speed is +8% *weapon* dps (signature damage does not move; past the interval floor, 0.25 s for Plague's bow from
x1.109, the rest becomes damage per hit, so dps stays linear). A reviewer's model run put a Plague shooter at x1.08 below
margin 1 in the thinnest kite cell (Fire > Plague, bow: x1.062 -> x0.982). This log checks that in the model and the real sim.

## 2. The model (testing/test_kite.py, kite_buff_sweep.py)

New: `test_kite.py --shooter-as X [--shooter-dmg Y]`, `kite_windup_sweep.py --shooter-as X`, and `kite_buff_sweep.py` (about
75 s on 12 cores). Every shooter buffed, the chaser not; the default output of every tool is unchanged (diffed).

Worst margin (weakest melee tolerance / orb-walk free fire; < 1 fails), all 20 cells (`!` = fails):

| cell | AS x1 | x1.05 | x1.08 | x1.089 | x1.129 | x1.168 | x1.25 | dmg x1.1 | dmg x1.21 |
|---|---|---|---|---|---|---|---|---|---|
| Fire>Sentenced bow | 1.63 | 1.73 | 1.76 | 1.84 | 1.84 | 1.90 | 1.97 | 1.42 | 1.23 |
| Fire>Sentenced wand | 1.16 | 1.28 | 1.33 | 1.36 | 1.41 | 1.49 | 1.65 | 1.00 | 0.87! |
| Fire>Plague bow | 1.06 | 1.02 | 0.98! | 0.98! | 1.16 | 1.08 | 1.04 | 0.85! | 0.64! |
| Fire>Plague wand | 1.08 | 1.17 | 1.04 | 0.999! | 1.23 | 1.19 | 1.01 | 0.96! | 0.69! |
| Sentenced>Plague bow / wand | 1.80 / 1.83 | 1.67 / 1.69 | 1.56 / 1.43 | 1.50 / 1.38 | 1.64 / 1.59 | 1.56 / 1.51 | 1.37 / 1.37 | 1.33 / 1.31 | 0.85! / 0.83! |
| Holy>Sentenced bow / wand | 2.45 / 1.90 | 2.41 / 1.94 | 2.41 / 2.01 | 2.52 / 2.01 | 2.41 / 2.08 | 2.37 / 2.05 | 2.37 / 2.21 | 0.89! / 0.69! | 0.00! / 0.00! |
| the other 12 cells (Frost, Holy losers) | >= 3.46 | >= 3.23 | >= 3.16 | >= 3.08 | >= 2.95 | >= 2.79 | >= 2.34 | >= 3.02 | >= 2.12 |

Attack speed on the shooter, failing cells of 20: 0 up to x1.0775; **1-2 in a dip at x1.08-x1.105**; 0 again x1.11-x1.25
(worst x1.007 at x1.25); then 1 at x1.3, 2 at x1.4, 6 at x1.5 (Plague > Frost 0.37: the counter itself flips), 12 at x2.

The dip is the model's 20 Hz grid, not a trend. The tolerance barely moves (Fire's axe 1.23 -> 1.19 s); the orb-walk time
jumps 1.16 -> 1.21 -> 1.31 s and back to 1.06 s at x1.11, because Plague's bow interval (0.257-0.252 s) beats against the
0.05 s ticks and the shooter gets 1 to 5 extra free ticks (8.5 u each) in a 1.2 s approach; at the floor (0.25 s, exactly
5 ticks) it gets none. In continuous time the orb-walk time of a share-bound windup does not depend on attack speed at all
(rooted 92% of every cycle). A damage row on the shooter hurts more than the same attack speed: it multiplies the
signature too, so Sentenced's mark breaks Holy > Sentenced at x1.1.

Plague Rat value v at 3 stacks (asMult = 1 + v x level; failing cells / worst margin):

| v | 3 stacks | 3 kills | 4 kills | plateau |
|---|---|---|---|---|
| 0.04 | 0 / 1.02 | 0 / 1.02 | 0 / 1.02 | 1 / 0.999 |
| 0.05 | 0 / 1.02 | 0 / 1.02 | 1 / 0.98 | 1 / 0.99 |
| 0.0533 (2/3) | 0 / 1.02 | 0 / 1.07 | 1 / 0.999 | 0 / 1.16 |
| 0.06 | 0 / 1.07 | 0 / 1.06 | 1 / 0.94 | 0 / 1.16 |
| 0.07 | 0 / 1.06 | 0 / 1.06 | 0 / 1.16 | 0 / 1.12 |
| 0.08 | 1 / 0.98 | 2 / 0.98 | 0 / 1.16 | 0 / 1.08 |

Stacks are continuous, so every v above 0.037 crosses the x1.08-1.105 dip at some stack count: no v in [0.0533, 0.08]
passes the model at every level, and lowering only moves which stack count hits the dip (+4% fails at its plateau too).

## 3. The real sim (`npm run harness -w @raid/server -- --kiting-only [--shooter-as X | --shooter-buff id:n]`)

New pass KITE EDGES: the 20 cells as duels, signatures on: the faction winner with each melee weapon charges the loser,
which starts at the edge of its range and plays the whole fight as `orbwalk` (the perfect kiter) or `lock` (a click), 10
setups per melee weapon (5 start offsets x 2 directions). A cell fails when its weakest melee weapon wins under half. 10
setups make a cell move in 10% steps: a single 40% next to 80% and 90% on either side is one duel.

| shooter | orbwalk fails | lock fails | orbwalk/post time | Fire>Plague bow, axe (win / hp left) |
|---|---|---|---|---|
| none | 1 (Sentenced>Frost wand, shield 10%) | 0 | x1.40 | 100% / 55% |
| AS x1.04 - x1.07 | 0 | 0 | x1.33 | 100% / 51-56% |
| AS x1.08 (Plague Rat 3 st) / x1.088 (3 kills) | 0 / 0 | 0 / 0 | x1.35 | 100% / 50% |
| AS x1.10 | 1 (Frost>Fire wand, axe 40%: noise) | 0 | x1.33 | 100% / 50% |
| AS x1.128 (4 kills) / x1.168 (plateau) | 0 / 0 | 0 / 0 | x1.27 | 100% / 56-57% |
| AS x1.25 / x1.3 / x1.4 | 0 / 0 / 0 | 0 / 0 / 0 | x1.20 / x1.20 / x1.13 | 100% / 54%, 53%, 50% |
| AS x1.5 | 0 (Plague>Frost bow, sword 70%, 2% hp) | 0 (80%, 2%) | x1.13 | 100% / 45% |
| AS x1.66 / x1.75 / x2 / x2.5 | 2 / 2 / 8 / 13 | 2 / 4 / 8 / 12 | | 20% at x2.5 |
| Ember Imp 3 st (+10% dmg) / plateau | 3 / 4 | 0 / 2 (Holy>Sentenced bow 0%) | x1.40 | 100% / 48%; 80% / 33% |
| Wyrmling, Executioner 3 st / plateau | 2 / 3 | 0 / 0 | | |
| Rat Ogre 3 st / plateau | 3 / 4 | 0 / 1 | | |
| Penitent, Acolyte 3 st / plateau | 2 / 4 | 0 / 2 | | |
| Ice Golem plateau (+17% hp) | 4 | 1 | | |

Attack speed on the shooter breaks no cell up to x1.5 (faster cadence also roots a cap-bound windup more: the orb-walk
ratio falls from x1.40 to x1.13). The first flip, at x1.66, is the faction counter Plague > Frost itself (the model's
attack-speed flip threshold is x1.65, `realtime_report.py buff`, below). Every other kind of buff tips the cells that are
thin at baseline (Holy > Sentenced wand, axe 50% / 5% hp; Frost > Fire wand, axe 50%; Sentenced > Frost wand, shield 10%).

## 4. Decision

- **Plague Rat stays at +8%.** No value in [+5.33%, +8%] passes the model at every stack count (section 2), lowering does not
  fix that, and the real sim holds every cell at +8% from 3 stacks to the plateau and beyond.
- **`AS_MULT_CAP = 1.25`** (shared/constants.ts): the attack-speed multiplier from every source together is capped after the
  sources multiply (`capAsMult`, applied in sim/mods.ts `mirrorsOf` before the mirror is encoded, so the sim, the local
  prediction and the bow-draw art all decode the capped value; slows apply below it). It is the largest value at which both
  hold: the model (trend; fails from x1.3) and the real sim (fails from x1.66). It is a no-op today (Plague Rat's plateau
  x1.168) and binds once sources stack: lastRites +25%, overheat +40/50%, bloodlust up to +24%, hourglass -8%.
- What the guarantee needs, in numbers: the model holds to x1.0775 contiguously and to x1.25 outside the tick dip; the real
  sim to x1.5. Attack speed alone first flips a faction counter at x1.65 (model, Plague > Frost bow; Frost > Holy x1.73).
  Raising the cap to 1.5 is the owner's call: the real sim still holds there (Plague > Frost at 2% hp), the model does not.

Attack-speed flip thresholds on the loser, k = 2 (`realtime_report.py <k2.json> buff`, min over 5 mirrors + signature):
Fire>Plague 3.60, Sentenced>Plague 2.32, Sentenced>Frost 2.11, Plague>Frost **1.65**, Plague>Holy 2.20, Frost>Holy 1.73,
Frost>Fire 3.86, Holy>Fire 6.25, Fire>Sentenced and Holy>Sentenced never. HP: Holy>Sentenced **1.28**, Plague>Frost 1.65.

## 5. Damage per stack across the 20 buffs

Total dps or effective hp (EHP) of the holder, at 3 stacks / at the plateau (x2.105). "Over a kill" = averaged over taking
a target from full to 0. Weapon share of damage, k = 2, signature weapon, average foe: Frost and Holy 100%, Plague about
48% (above its execute band), Fire about 29% (backlash and burn), Sentenced about 2% (the mark).

| buff | row (3 stacks) | offense, 3 st / plateau | defense, 3 st / plateau | live |
|---|---|---|---|---|
| emberImp | +10% damage | +10% / +21%, every faction (signatures too) | | yes |
| plagueRat | +8% attack speed | weapon dps +8 / +17%: Frost, Holy +8 / +17; Plague +4 / +8; Fire +2 / +5; Sentenced +0.1 | | yes |
| wyrmling | +20% vs > 70% hp | +5.3% / +9.8% over a kill (all in the opening) | | yes |
| executioner | +30% vs < 30% hp | +7.4% / +13% over a kill (all at the end) | | yes |
| ratOgre | +16% vs < 50% hp | +7.4% / +14% over a kill | | yes |
| penitent | +2% per 10% hp missing | 0 at full hp; about +9% / +19% over a fight lost from full | | yes |
| bailiff | mark ramp +16% (Sentenced) | +13% / +24% in a 4 s fight, +3% / +6% in a 10 s one | | yes |
| inquisitor | +12% after 3 s on a target | +12% / +25% in long duels | | R4b |
| glacialWarden | +20% vs slowed or chilled | Frost (its target is always chilled): +20% / +42% | | R4b |
| bloatfly | 8 dmg/s dot | Frost +13 / +28%, Holy +8 / +17%, Plague +7%, Fire, Sentenced +2% | | R4b |
| acolyte | +4% lifesteal | | about +4% / +8% in an even trade | yes |
| iceGolem | +8% max hp | | +8% / +17% | yes |
| bloodSaint | heal 20% once below 30% | | +20% / +42%, once per run | yes |
| magmaBrute | +6% hp, +20 magic resist | | +6% hp, then vs magic +6% (Holy) .. +20% (Plague) / x2.1 | yes |
| seraphShard | +16 magic resist | | vs magic +5% (Holy) .. +16% (Plague) / x2.1 | yes |
| rimeStalker | +20 armor | | vs physical +20% (Fire, Holy) .. +7% (Plague) / x2.1 | yes |
| frostWisp | foe attacks -6%/hit, cap 15% | | +18% vs weapon damage at the cap (the cap does not scale) | R4b |
| cinderHound | +10% move speed on a lock | closes on a kiter 10% / 21% faster (helps the chaser) | | yes |
| chainWarden, rotMonk | slow move / anti-heal on hit | utility | | R4b |

Attack speed is not out of line: per stack (the 3-stack value / 3) Plague Rat is +2.7% weapon dps against Ember Imp's
+3.3% on all damage, and it is the only offense row that leaves the kite cells whole. What looks out of line:

- **The damage key has no cap.** Rows add (1 + damage + vs + scale): at the plateau Ember Imp + Rat Ogre + Executioner +
  Penitent on a target under 30% is +21 + 34 + 63 + up to 38 = up to +156%, against +25% for all attack speed.
- **Flat armor and magic resist favour factions with none:** Rime Stalker is +20% EHP for Fire and Holy, +7% for Plague;
  Seraph Shard and Magma Brute's resist +16-20% for Plague, about +5% for Holy.
- **Bloatfly's flat dot** (R4b) is +13% for Frost and +2% for Fire or Sentenced; Glacial Warden (R4b) is +20% always-on for Frost.
- **Plague Rat is weapon-only:** worth +0.1% to Sentenced and +2% to Fire, so `worksWith: ["any"]` oversells it there.

Proposals (change, measured effect; none applied):

- Cap the damage key's sum from rows (one constant, like `AS_MULT_CAP`): Ember Imp alone at its plateau fails 4 orbwalk and
  2 lock cells of KITE EDGES (Holy > Sentenced bow 0%), the model 7 of 20; measure the cap value with `--shooter-buff`.
- Holy > Sentenced is the soft cell for every shooter buff (HP x1.28 flips it in the model; Acolyte at 3 stacks, Ember Imp,
  Penitent or Ice Golem at the plateau in the real sim): accept it (fed players beat counters, GAME_DESIGN 18) or thicken it.
- Bloatfly's dot as a share of the holder's damage instead of flat points: +8% for everyone instead of 2-13% (R4b).
- Plague Rat's `worksWith`: list the weapon-damage factions (frost, holy, plague) instead of "any".
- The bow's windup share would need 0.93 (from 0.92) to hold every model cell at a shooter x1.08 (`kite_windup_sweep.py
  --shooter-as 1.08`); not proposed, since the real sim needs nothing.

Not measured: a buffed chaser (both sides fed), move speed (Cinder Hound helps the chaser), several buffs on one shooter
beyond Plague Rat + Ember Imp at their plateaus (orbwalk 2, lock 2 fails: the Holy > Sentenced cells).
