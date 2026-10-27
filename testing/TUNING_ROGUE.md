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
- **`AS_MULT_CAP = 1.25`** (shared/constants.ts; the owner raised it to **1.5** after this log, section 6): the attack-speed multiplier from every source together is capped after the
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

## 6. Owner rulings after this log (2026-10-26)

- **`AS_MULT_CAP` is 1.5** (shared/constants.ts; was 1.25). The owner accepted that the model no longer holds at the cap:
  `test_kite.py` holds to x1.25 outside the tick dip and fails from x1.3 (1 cell at x1.3, 2 at x1.4, 6 at x1.5), while the
  real sim's KITE EDGES hold every cell up to x1.5 (section 3; the thinnest, Plague > Frost with the bow, keeps the sword's
  70% of duels with 2% hp left). The cap is still applied after every source multiplies and before the mirror is encoded
  (sim/mods.ts `mirrorsOf`), so the sim, the local prediction and the bow art read the capped value; slows (the Wishes'
  `slowAttack`) multiply in below it. Buffs alone never reach it (Plague Rat's plateau x1.168); it binds once R5/R6 sources
  stack. The model is now the conservative artifact for attack speed: the real-sim harness is the gate above x1.25.
- **No cap on the damage rows** (section 5's first proposal is declined): fed players may beat their counters
  (GAME_DESIGN 18). Nothing changes in code.
- **Buffed shooters beat Holy > Sentenced** (section 5's second proposal): accepted, no retune. A Sentenced bow with Ember Imp
  at its plateau, or Acolyte, Penitent or Ice Golem, can flip the cell in the real sim, and HP x1.28 flips it in the model.
- **Plague Rat's `worksWith` is `["frost", "holy", "plague"]`** (section 5's fourth proposal; the owner left it to the
  session). Attack speed moves weapon damage only, so +8% weapon dps is +8% of all damage for Frost and Holy, +4% for Plague,
  +2% for Fire and +0.1% for Sentenced. `worksWith` only feeds the buff tooltip's "Works with" line; the planning screen's
  "buffs that counter the factions present" reads `counters`, which stays `["any"]`, so the change is wording, not balance.
- Plague Rat stays +8% (section 4; the owner refused halving it).

## 7. Quickdraw and Swift Boots vs the kiting lever (pre-merge review of the R5 line; owner rulings "Melee windups only" and "No boost while shooting")

The ranged windups are the anti-kiting lever (CLAUDE.md, Weapons and factions). The pre-merge review ran the two neutral passives that
touch it through the kiting gates and found both ate the margin: Quickdraw (windups shorter) on a shooter took the model's Fire > Plague
cell from bow x1.062 to x0.977 and wand x1.078 to x0.991 and failed 3 of 20 real-sim orbwalk cells (baseline 1); Swift Boots (more move speed)
on a shooter failed 2 of 20 at rank 1 and 3 at rank 2. The first ruling, "Floor the windup" (bow never below 0.55 s, the wand's whole 0.4 s),
held the gates but left Quickdraw close to cosmetic, because the melee windups it still shortened are two and five 50 ms ticks long and the
old -8% / -12% moved nothing on that grid. The owner then ruled, finally:

1. **Quickdraw: "Melee windups only."** It shortens the sword's, the shield bash's and the axe's windups, and no longer touches a bow or wand
   windup at all: nothing shortens a ranged windup. Sized so a melee player feels it.
2. **Swift Boots: "No boost while shooting."** Its move-speed bonus is off from the start of a bow or wand attack until a pause after the shot
   leaves, and on otherwise (walking, chasing, melee). Sized so the KITE EDGES cells hold at both ranks.

### 7.1 Quickdraw: melee windups only

`scaleWindup` (shared/mods.ts): a `windupMult` below 1 shortens a melee attack's windup (and the axe's root with it, never under the windup);
a ranged attack's timings come back as the same object; a mult of 1 or more lengthens every weapon (no source does today). The floors are gone
(`BOW_WINDUP_FLOOR`, `WAND_WINDUP_FLOOR`, `WeaponTimings.windupFloor`), and so is the per-weapon table they needed: the rule is the `ranged`
flag the timings already carried. The server's `timingsOf`, the client's bow gauge and the axe-root prediction all read this one function; with no
windup mod the output is the object `weaponTimings` returns, as before. (The mirror is one product: a future windup slow stacked on
Quickdraw would lengthen a ranged windup by the slow times Quickdraw's share, so a ranged slow wants a mirror of its own.)

An attack lands on the first 50 ms tick at or after start + windup, never in the tick that started it, so a cut only counts when it removes
whole ticks. Ticks from the attack's start to its landing / to the fighter walking again (the axe's root), for a start on the tick grid (a
start between ticks, which a held trigger's cooldown remainder makes, gains the same whole ticks for the sword and the bash and a fraction more
for the axe; the sim test lands 8+ drifting sword swings in 2 then 1 ticks, every one):

| windup, ticks (windup 0.1 s) | plain | rank 1 (-50%) | rank 2 (-75%) |
|---|---|---|---|
| sword, shield bash (all factions) | 2 | **1** | 1 (a tick is the floor) |
| axe, Fire and Frost (0.25 s, root 0.5 s): landing / walking again | 5 / 10 | **3 / 5** | **2 / 3** |
| axe, Sentenced (0.198 s, root 0.397 s) and Holy (0.188 s, 0.376 s) | 4 / 8 | 2 / 4 | 1 / 2 |
| axe, Plague (0.097 s, root 0.193 s) | 2 / 4 | 1 / 2 | 1 / 1 |

**Rank 1 = -50%, rank 2 = -75%** (`skills.ts`, text "-50% melee windup time"). Why: the sword and the bash step from two ticks to one only at a
cut of 50% or more (a -8% or -12% cut, and anything under 50%, is two ticks on the grid), and the axe loses a tick per 20%. 50% is the smallest
cut a sword player feels, and 75% is the cut that gives every faction's axe a second step at rank 2 (a -60% cut takes the Fire and Frost axe to two
ticks, but leaves Sentenced's and Holy's at two where -75% reaches one). The sword and bash cannot go below one tick, so rank 2 adds nothing for
them; it is the axe's rank. The axe's committed windup is also its root, so the rank 2 Fire axe is rooted 0.125 s of every 1.19 s instead of
0.5 s: it hits a moving target sooner and walks sooner. `worksWith` is `["sword", "axe", "shield"]`; the tooltip note says melee only, whole ticks,
"the sword and the bash lose one, the axe up to three".

### 7.2 How it was measured (harness options added)

`npm run harness -w @raid/server -- ...`: `--shooter-skill swiftBoots:2`, `--chaser-skill quickdraw:1`, `--winner-skill` / `--loser-skill` (the
designed winner / loser of every weapon-matrix duel) grant passives through the chest's own `grantSkill` (duel.ts `skills`), so the shipped rule
is what is measured; `--shooter-speed 1.06|1.10` is now Swift Boots rank 1|2 through that path. Bare multipliers stay for scans
(`--shooter-windup`, `--chaser-windup`, `--winner-windup`, `--loser-windup`, `--shooter-move`: no Swift Boots pause, the pre-ruling bonus).
`--kite-edge frost>fire,...` restricts KITE EDGES, `--edge-setups 32|128` widens its 10 setups per melee weapon (a cell on the 50% line moves
10 points per duel, and by 15 to 25 points under a perturbation that changes nothing real). Python: `test_kite.py --shooter-windup X` stays as the
check that nothing shortens the lever (its default output is byte-identical to before, diffed); the model has no melee windup on the chaser
(`kite_tolerance` is independent of the windups, the chaser's duel starts when it arrives), so a chaser with Quickdraw cannot move a cell
there, and it has no move-speed option (`realtime.V` is one constant): the real sim is the measure of both.

### 7.3 Quickdraw results

The model (`test_kite.py`, k = 2, 20 cells): `--shooter-windup` 0.92, 0.88, 0.5, 0.4 changes nothing: every cell line is identical to the default's
(tightest Fire > Plague, bow x1.062, wand x1.078, 0 failing), and `--shooter-as 1.5 --shooter-windup 0.88` is identical to `--shooter-as 1.5` (the
accepted 6 failing at the cap, section 6). Quickdraw on a ranged windup is no change by construction; this checks that nothing re-opened it.

The real sim, KITE EDGES (`orbwalk` = the perfect kiter, `lock` = a click; 10 setups per melee weapon; a cell fails under 50%):

| who holds it | orbwalk fails | lock fails | at attack speed x1.5 (orbwalk / lock) |
|---|---|---|---|
| nobody | 1 of 20 (Sentenced > Frost wand, shield 10%) | 0 | 0 / 0 (thinnest Plague > Frost bow, sword 70%, 2% hp left) |
| the shooter, rank 1 or 2 | the same: 1 (the output is line for line the nobody run) | 0 | the same, line for line |
| the melee chaser, rank 1 | **0** (the baseline cell goes 10% -> 60%, 8% hp left: a one-tick bash lands before the Frost wand's shield can be kited past) | 0 | 0 / 0, thinnest unchanged |
| the melee chaser, rank 2 | **0** (the same 60%) | 0 | 0 / 0, thinnest unchanged |
| shooter Swift Boots 2 and chaser Quickdraw 2 | 0 | 0 | |

A chaser with Quickdraw breaks no cell and mends the baseline one; the shooter's side is untouched. The KITING table (seconds until in reach,
orbwalk worst x1.40, sword vs wand) does not move with Quickdraw on either side.

The weapon matrix (`--core`, 18 setups x 5 factions, style grids 3 x 5; baseline 9 of 10 edges hold, lock pass 10 of 10; Wand > Shield fails at
23% in the policy matrix, a known result): Quickdraw on the melee fighter, rank 1 and rank 2 alike, through `--winner-skill`, `--loser-skill` and both:

| edge | baseline | winner holds it (r1 / r2) | loser holds it (r1 / r2) | both (r1 / r2) |
|---|---|---|---|---|
| Axe > Wand (matrix / Fire column) | 92% / 67% | 100% / 100% | n/a (a wand) | 100% / 100% |
| Wand > Shield (matrix) | 23% (fails) | n/a | 22% / 22% | 22% / 22% |
| every other edge's matrix and verdict | | unchanged | unchanged | unchanged |
| target lock pass (10 of 10 hold at all six runs) | Sword > Axe 100%, Axe > Wand 100% | Axe > Wand 93% (Fire 67%) / 100% | Sword > Axe 100% / 93% (Fire 67%) | Sword > Axe and Axe > Wand 93% / both 100% |
| style grids (63 cells of 15 duels, a duel is 7 points) | | 2-3 cells move; the largest, Axe > Wand axe-stand vs wand-kite, 60% -> 100% | 8-10 cells move, none by more than 20 points (Bow > Axe, bow strafe vs axe stand 73% -> 93%) | 11-12 cells move, largest 40 (the same Axe > Wand cell) |

No edge flips and no verdict changes except where the passive's holder gains (the Axe > Wand Fire column, the edge the controls rework logged as thin
at 67%, reads 100%). The earlier scans with a bare multiplier at x0.5, x0.4 and x0.25 on both fighters read the same way (no flip), so the loop does not sit near
the -75% either. Bow > Axe (the 0.76-0.77 window) does not move when the axe holds Quickdraw: 96% in the matrix at both ranks.

### 7.4 Swift Boots: no boost while shooting

**The rule.** `skills.ts`: one `while` row of `moveSpeed` +6% / +10% with the new condition `notShooting` and `ms` = `SWIFT_BOOTS_PAUSE_MS`
(shared/constants.ts). The sim holds `WeaponRuntime.lastShotAt` (the server time a bow arrow or wand ball last left the fighter, set where the
attack lands) and `sim/mods.ts` answers the condition from it: false while a bow or wand attack is in progress (its windup, from the tick it
starts) and for the pause after the shot, true otherwise. A windup that is cancelled (a swap, a stagger, the player's own order) never shoots, so
it leaves no pause and the bonus is back the tick after. The row is folded like the other `while` rows (once per tick, after damage), so the
`speedMult` mirror patches when the pause opens (the same tick the attack starts, which already roots the fighter) and when it closes (the
first tick after the pause ends); the client's prediction reads only that mirror, so it is as exact as for any speed mirror (a client test pins
the mirror's on / off values through the prediction, a sim test that what the movement does per tick is the mirror's multiplier). It patches twice per
bout of shooting, not per shot: holding a bow for 6 s (five shots, rank 2) writes the mirror 1.10 -> 1.00 once, and 1.00 -> 1.10 once the bout ends.
Melee swings never touch it.

**Sizing the pause.** The orbwalker walks between its shots, so the boots only matter if they are on in that gap. Unchilled, the longest gap
(interval minus windup) is the Frost wand's 0.95 s, then Fire's wand 0.61 s and Frost's bow 0.54 s. A Frost chaser's chill stretches a chilled
shooter's cooldown 2.5x, though, so Fire's wand idles 2.1 s between shots against Frost and Holy's 1.2 s: a pause shorter than that lets the boots
back in the chilled gap. The Frost > Fire wand cell (axe) is the one that shows it, and it sits on the 50% line (baseline 68% over 128 setups per
melee weapon, 50% at the default 10), so each configuration is read at 128 setups (`--kite-edge frost>fire,sentenced>frost,plague>frost
--edge-setups 128`). The axe's win rate in Frost > Fire's wand orbwalk cell, by pause and rank (a bare x1.06 reads 41%, a bare x1.10 reads 0%):

| pause | none | 0.75 s | 1.0 s | 1.25 s | 1.5 s | 1.75 s | 2.0 s | 2.25 s | **2.5 s** |
|---|---|---|---|---|---|---|---|---|---|
| rank 1 | 68% | 57% | 52% | 23% | 55% | 66% | 58% | 68% | **68%** |
| rank 2 | 68% | 25% | 44% | 57% | 51% | 64% | 56% | 68% | **68%** |

The cell does not move monotonically with the pause (the same 128 setups move by up to 45 points between neighbouring pauses), which is why a pause is
judged where the boots stop reaching the fight at all: at 2.25 s and 2.5 s every line of the three cells is identical to the no-boots run, both ranks (Sentenced > Frost
wand, shield: 38% in all, the baseline failure; Plague > Frost wand, shield 100%). At 1.0 s the default 10-setup KITE EDGES fails 2 cells at rank 1
(the baseline and Frost > Fire wand, axe 20%) and 1 at rank 2. **`SWIFT_BOOTS_PAUSE_MS` = 2500**: the longest chilled gap (2.1 s) plus a margin for
a slower cooldown (the Hoarfrost Armor attack slow arrives with R4b).

**Results at the shipped pause** (KITE EDGES, 10 setups per melee weapon; `--shooter-skill swiftBoots:N`, the real passive path):

| shooter | orbwalk fails | lock fails | at attack speed x1.5 (orbwalk / lock) |
|---|---|---|---|
| none | 1 of 20 (Sentenced > Frost wand, shield 10%) | 0 | 0 / 0 (Plague > Frost bow, sword 70%, 2% hp left) |
| Swift Boots rank 1 (x1.06 outside the pause) | **1** (the same cell) | **0** | **0 / 0**, thinnest unchanged |
| Swift Boots rank 2 (x1.10 outside the pause) | **1** (the same cell) | **0** | **0 / 0**, thinnest unchanged |
| before the ruling: a bare x1.06 / x1.10 | 2 / 3 (adds Frost > Fire wand axe 40% / 0%, Plague > Frost wand shield 40%) | 0 | |

The failing set is the baseline's at both ranks. The boots do change the approach (a shooter walking into range 6 to 10% faster: the KITING table's
standing and lock times move by up to 0.05 s, hp left by 1 to 3 points); they never reach the orbwalk fights.

### 7.5 What is left, and what the owner decides

- **Sentenced > Frost wand, shield** is the baseline's one failing orbwalk cell (10% at the default setups, 38% over 128): it is not Swift Boots'
  or Quickdraw's, and a chaser with Quickdraw lifts it (60%). Open, as before.
- **The pause is long for "a short window".** 2.5 s is what the chill requires; the alternatives are a pause that follows the weapon's cooldown
  (off until the weapon is ready again plus a short grace, which scales with chill and attack speed by itself, but patches more and no longer reads as one
  constant) or accepting a shorter pause and a thinner Frost > Fire wand cell (a 1.0 s pause: 52% at rank 1, 44% at rank 2).
- **Quickdraw's rank 2 adds nothing for the sword and the bash** (one tick is the floor); it is the axe's rank. -50% / -75% are the numbers that
  remove ticks; a different split (-50% / -60%) leaves Sentenced's and Holy's axes at two ticks at rank 2.
- **The windup mirror is a single product.** If a source ever lengthens windups, a ranged slow needs its own mirror (7.1).
- The model has no chaser windup and no move-speed option; the real-sim KITE EDGES are the measure for both passives.
