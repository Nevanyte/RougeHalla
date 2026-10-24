# Weapon tuning 9.1

Owner's brief: retune the weapons until every designed weapon edge holds in the real sim, and make a melee faction winner survive the approach at duel pace (k = 2) by stronger ranged penalties, keeping `DUEL_PACE = 2` and every faction number. This file is the change log: one entry per change, with the numbers before and after, and the final results at the end. Phase 10 owns the factions (`factions.ts`, `classes.py`); nothing here touches them.

## Result in one table

| | Before (HEAD `b890462`) | After |
|---|---|---|
| Designed weapon edges that hold (real sim) | 8 of 10: Bow > Sword 9% (Fire 44%, the rest 0%), Wand > Bow 100% against a standing bow and 0% against a strafing or kiting one | **10 of 10** |
| k = 2 kite rows STOLEN (`realtime_report.py <k2.json> kite`) | 7 cells (Fire > Sentenced, Fire > Plague, Sentenced > Plague with both ranged weapons; Holy > Sentenced with the wand) | **0**; tightest cell Fire > Plague with the bow, 1.30 s tolerance against 1.06 s of free fire (ratio 1.22) |
| Real kiting against the standing-shooter bound (harness KITING) | up to **x2.25** (a kiting bow vs a shield: 5.40 s against 2.40 s) | up to **x1.12** |
| Tests | 2027 pass (`npm test`: 1586 server, 441 shared) | 2035 pass (1592 server, 443 shared), typecheck clean, `test_rpsls.py` ALL PASS, new `testing/test_kite.py` ALL PASS |

## How to reproduce

```
cd packages/server && npx tsx src/harness/runHarness.ts            # the full report, ~45 s (--core ~30 s, --quick a few seconds)
python3 testing/realtime_report.py <k2.json> kite                   # the k = 2 kite table
python3 testing/test_kite.py                                        # the same check as PASS / FAIL lines, ~5 s
python3 testing/test_rpsls.py                                       # the faction oracle, unchanged
python3 testing/weapon_reference.py                                 # regenerates the parity tables (weapons.test.ts, harness/parity.ts)
```

`k2.json` is the k = 2 what-if: `{"name":"k=2","factions":{"Fire":{"hit":300,"params":{"burn":20,"backlash":400}},"Sentenced":{"hit":10,"params":{"mark_ramp":140,"mark_cap":550}},"Plague":{"hit":40,"params":{"plague":80,"execute":4100}},"Frost":{"hit":180},"Holy":{"hit":130}}}`; `test_kite.py` embeds it.

**What "holds" means** (the harness's EDGE VERDICTS section, `HOLD_*` in `report.ts`): the designed winner wins at least 60% of all duels, at least 50% in every faction column of the main matrix (18 setups per cell: start distances 120 / 300 / 450 u, start offsets 0 / 0.35 s for either fighter, two directions), and in every style grid it has a reply that wins at least 50% against each way the loser plays (`stand`, `strafe`, `kite`; pooled over the factions and 3 start distances). Wins are kills inside the time cap.

## Diagnosis: why the edges failed

Measured on the HEAD numbers with the harness before any change.

- **Bow > Sword (9%).** The sword closes the 420 u gap in about 2.3 s, then wins the close trade: dpsMult 1.0 against 0.8, and every sword hit staggers the archer and restarts its draw (about 70 staggers a duel, each a lost 0.6 s draw). Only Fire's short duels (8 s) let the bow's opening decide it (44%).
- **Wand > Bow against a strafing or kiting bow (0%).** Two problems, the first in the measuring:
  1. *The harness's shooters aimed from the wrong place.* The server looses a projectile from where the shooter's client drew it (the attack's `t`); the policy aimed from where the shooter would be by then. A shooter that moves misses a standing target by its speed times the lag: every arrow of a strafing bow passed a standing wand 19 u off (reach 14 u), so those duels were neither side hitting. Fixed in `policies.ts` (see C1).
  2. *Then the real edge showed.* A strafing bow at 0.75 x speed dodged every ball (0 of 10 hit: the ball takes 0.7 s and the strafe flips every 0.8 s) while its 900 u/s arrows got through (3 of 13 deleted). Ball speed and the arrow-deletion radius could not fix that (see "Rejected levers"); making the bow unable to strafe did.
- **Axe > Wand (91%, Fire 56%).** The wand kites for about 2 s of free fire before the first axe hit (median 2.2 s).
- **Wand > Shield (99%, Fire 94%)** held; **Shield > Sword and Shield > Bow** end at 100% HP (intended, below).

## Change log

Each entry: the lever, where, old -> new, why, and the numbers before and after. The levers L1-L5 are numbers in the order they were applied: every "after" is cumulative (`abl0`..`abl5` runs of `runHarness --core`, and `realtime.py` with the same weapon table). Interactions between levers matter (L3 alone breaks Axe > Wand; L5 heals it), so the order is part of the record.

### C1. The shooters aim from where the client draws them (measurement, not a weapon number)
`packages/shared/src/policies.ts`, `decide()`. Old: a projectile weapon aimed from the shooter's *projected* position (`selfHit`). New: from `input.self`, the position the policy sees, which is what the sim reads back through the attack's `t` (a unit test pins it: `policies.test.ts`, "aims a projectile from the position it was given").
Effect on the HEAD weapons: Axe > Wand Fire 56% -> 67%, Wand > Bow against a strafing bow went from "nobody hits" to "the bow hits, the wand dies" (still 0%). Bots are unaffected: they aim from their buffered view already.

### C2. The harness reports what it measures (measurement)
`packages/server/src/harness/{report,matrix,kiting,runHarness,parity}.ts`.
- EDGE VERDICTS section: HOLDS / FAILS per edge with the thresholds above (`verdictOf`, exported, unit-tested).
- A style grid for **every** edge with a ranged weapon (it printed three before).
- KITING section (`kiting.ts`): seconds until a melee fighter is in reach of a shooter that starts at the edge of its range, for a shooter that never moves (`post`), stands, strafes or kites, with the standing bound (range - 60) / 170 beside it. Report-only like the rest.
- Time caps raised (`DEFAULT_CAPS`: fire 60 -> 90, sentenced 240 -> 600, plague 60 -> 150, frost 150 -> 240, holy 90 -> 120 s): a ranged fighter that lands a third of its shots needs about three times the mirror duel, and a win that needs 94 s must not count as a timeout. No duel of the main matrix changed result from this.
- `--core` (everything but the client-view and cluttered-arena passes), a `post` style, spacing as shares of the weapon's range (`POLICIES`, `spacingFor`) so a range retune carries the way a weapon is played with it. The parity tables follow the numbers (`weapon_reference.py`).

### L1. A sword stagger no longer restarts a bow draw
`packages/server/src/sim/weapons.ts`, `stagger()`. Old: `act.startedAt = now` (the draw starts again). New: a draw is left alone; the windup / cast cancellation, the fx and the 0.5 s immunity stay. Tests: `melee.test.ts` (a staggered draw carries on, the immunity starts), `ledger.test.ts`, `weapons.test.ts`.
Why: it cost the archer about 70 draws a duel. Before -> after: **Bow > Sword 10% -> 27%** (Fire 50% -> 78%, Holy 0% -> 56%; the three slower factions stay at 0: the sword still wins the close trade); nothing else moved.

### L2. Ranged movement penalties: draw 0.75 -> 0.1, cast 0.35 -> 0.1, recovery 0.5 -> 0.1
`packages/shared/src/constants.ts` (`BOW_DRAW_MOVE`, `WAND_CAST_MOVE`, `RANGED_RECOVERY_MOVE`). The owner's lever. Why 0.1: the KITING section's worst ratio of a moving shooter's time to a motionless one's, with the HEAD ranges:

| draw / cast / recovery | 0.75 / 0.35 / 0.5 (HEAD) | 0.5 / 0.35 / 0.3 | 0.4 / 0.3 / 0.25 | 0.3 / 0.25 / 0.2 | 0.2 / 0.2 / 0.15 | 0.1 / 0.1 / 0.1 | 0 / 0 / 0.1 |
|---|---|---|---|---|---|---|---|
| worst kite time / standing time | x2.25 | x1.61 | x1.46 | x1.31 | x1.20 | **x1.10** | x1.02 |

0.1 keeps the real-sim excess (x1.12 at the final numbers) below the margin of the model's thinnest cell (x1.22); 0.15 (x1.16) would have been the minimum that fits. A shooter that backs away while firing gets at most 12% more free fire than one that stands. Before -> after (cumulative with L1): **Wand > Bow against a strafing bow 0% -> 60%, against a kiting bow 0% -> 100%**; KITING x2.25 -> x1.10. It also removes what let the bow win Bow > Axe (it backed away from the axe's root): **Bow > Sword 27% -> 7%, Bow > Axe 100% -> 13%**, which L3 repairs. The model's STOLEN count does not move (it assumes a standing shooter); that is what L3-L5 are for.

### L3. Melee damage down to the bow's level: sword 1.0 -> 0.75, axe 0.9 -> 0.8
`packages/shared/src/weapons.ts`. Why: with the bow unable to kite, Bow > Sword and Bow > Axe are a free-fire opening against a close trade, and the bow wins the trade only if the melee weapon does no more damage than it does: sword 0.8 gave 87%, 0.75 gave 98%, 0.7 gave 100% (but broke Sword > Axe at 0.7); the axe is a cliff at the bow's own 0.8 (axe 0.85: Bow > Axe 20%, 0.9: 0%). Before -> after: **Bow > Sword 7% -> 98% (Fire 89%), Bow > Axe 13% -> 84% (Fire 67%)**. Cost: **Axe > Wand 93% -> 64% (Fire 33%)**, because the axe (0.8) no longer outdamages the wand (0.85); L4 and L5 repair it. The model: Fire > Sentenced with the bow 2.00 s -> 1.89 s of tolerance (the sword's weaker kill), still 7 stolen cells.

### L4. Wand damage 0.85 -> 0.8
`weapons.ts`. Why: Axe > Wand needs the axe's damage at or above the wand's; the kiting model wants the wand lower (it was one of the cells); the wand was kept as high as the rest allow because Holy > Sentenced's signature opening scales with the wand-to-bow ratio (below). Before -> after: **Axe > Wand 64% -> 87% (Fire still 33%)**; the model's STOLEN 7 -> 6 (Holy > Sentenced with the wand cleared; Fire > Sentenced with the wand 1.58 -> 1.74 s); Wand > Bow against a strafing bow 60% -> 53%.

### L5. Ranges: bow 480 -> 240, wand 420 -> 220
`weapons.ts` (the policies and the harness follow). Why: it is the free-fire time a melee winner has to absorb, (range - 60) / 170: 2.47 s -> 1.06 s for the bow, 2.12 s -> 0.94 s for the wand, against tolerances of 1.30 s (Fire > Plague, bow, the weakest melee weapon being the shield) and 1.19-1.34 s (the wand). The owner's levers could not do this alone: the penalties do not enter a standing-shooter model, and damage alone would have needed a bow near 0.5 (see "Rejected levers"). Before -> after: **model STOLEN 6 -> 0**; Axe > Wand 87% -> 91% (Fire 33% -> 56%); Wand > Bow against a strafing bow 53% -> 87%; Bow > Axe Fire 67% -> 56%; **all ten edges hold**; KITING x1.10 -> x1.12 (the standing bound is smaller, so the same walk is a larger share). `MAX_SIGHT_CORRIDOR` stays 480 (see the open questions).

### Cumulative record

| after | edges holding | failing | KITING worst | model STOLEN (tolerance / free fire, worst cell) |
|---|---|---|---|---|
| HEAD numbers, corrected harness (`abl0`) | 8 | Bow > Sword 10%, Wand > Bow (strafe 0%, kite 0%) | x2.25 | 7 (0.52, Fire > Plague bow) |
| + L1 stagger | 8 | Bow > Sword 27%, Wand > Bow | x2.25 | 7 |
| + L2 penalties | 8 | Bow > Sword 7%, Bow > Axe 13% | x1.10 | 7 |
| + L3 sword 0.75, axe 0.8 | 9 | Axe > Wand 64% (Fire 33%) | x1.10 | 7 |
| + L4 wand 0.8 | 9 | Axe > Wand 87% (Fire 33%) | x1.10 | 6 |
| + L5 ranges 240 / 220 (**final**) | **10** | none | x1.12 | **0** (1.22, Fire > Plague bow) |

## Rejected levers (measured, not adopted)

| Lever | What it did | Why not |
|---|---|---|
| Ball speed 380 -> 500 / 700 / 900 u/s (with the 0.3 / 0.2 penalties) | Wand > Bow against a strafing bow 0% -> 7% / 27% / 33% | Not enough, and a different weapon |
| `BALL_ARROW_RADIUS` 28 -> 40 / 60 | No change at 40; at 60 every arrow is deleted but the balls still miss: a stalemate (40 s, nobody dead) | The edge needs the wand to win, not to tie |
| Leading a strafer by its velocity averaged over 0.4-1.6 s (harness policy only) | strafe column 0% -> 7% (0.4 s) to 40-47% (0.8-1.6 s) | Needless once the bow cannot strafe; it would have made the winner's policy cleverer than the loser's |
| Flat ranged damage cut | model, old melee numbers: the bow needs 0.55 at 480 u (margin 1.0), 0.5 for x1.1 | Loses every close trade |
| Distance falloff on ranged damage (full to 100-160 u, then 0.5 / 0.2 / 0 of the damage at the far end) | model: 4-5 of the 7 cells stay stolen; with the falloff reaching 0 at 480 u Fire > Plague with the bow is still short (1.99 s against 2.47 s) and Fire > Sentenced stays stolen | The mark and the disease run on clocks, not on distance; the last 100 u are full damage |
| Signature bonuses only within 130-200 u for ranged weapons | model: 1-2 stolen cells left | It would turn the ranged-against-ranged signature openings (Sentenced > Plague bow/bow, Plague > Holy, Holy > Sentenced) into plain weapon fights at their natural 200-440 u |
| Melee approach speed x1.25 / x1.35 | model: 3 cells stolen at x1.25; at x1.35 the bow still needs a range near 340 u | A global rule for a few cells |
| Ranges alone (old damage numbers) | bow / wand 400 / 340: 3 stolen; 320 / 280: 2 stolen (Fire > Plague by 0.1 s); at about 280 / 250 and below it passes | Kept as part of L5, but L3 and L4 buy the margin |
| Wand 0.75 instead of 0.8 | Axe > Wand Fire 100%, Wand > Shield Fire 67% | Holy > Sentenced opening 16.4% against 23.6% (and flips at x1.21 HP against x1.30) |
| A sword 0.8 instead of 0.75 | Bow > Sword 87% (Fire 78%) | 0.75 costs nothing in the model (the shield, at 0.75, is the weakest melee weapon) |

## Side effects on the faction model (`realtime_report.py`, k = 1, unchanged factions)

- Cycle and openings: every mirror, every signature opening and **all 25 weapon pairings hold** (before: Holy > Sentenced lost with the bow (27%) or the shield (0%) against a sword). Signature openings, worst HP of the winner, before -> after: Fire > Sentenced 72.5 -> 65.0, Fire > Plague 72.4 -> 69.5, Plague > Holy 64.3 -> 66.4, Frost > Holy 55.0 -> 58.6, Frost > Fire 34.3 -> 41.6, Holy > Fire 65.5 -> 68.4, **Holy > Sentenced 30.4 -> 23.6** (the one that got thinner: the wand's multiplier is now level with the bow's; the wand's arrow deletion in the real sim helps Holy on top), the rest unchanged.
- Buff caps: Holy > Sentenced flips at x1.30 HP on the losing side (x1.31 before), the softest attack-speed edge is Plague > Frost with the bow at x1.66 (x1.63 before). HP x1.2 with attack speed x1.3 still holds every edge; HP x1.3 with attack speed x1.2 now also fails Holy > Sentenced with swords (0%) and axes (12%), as well as the bows (45%) and shields (52%) it failed before. The recommended caps (+20% HP, +30% attack speed) are unchanged.
- [kite] at k = 1 is far from the limit now (Fire > Plague bow 2.64 s against 1.06 s).

## How each style plays, and the two edges with no counterplay

- **stand** (the shared policy): a ranged fighter walks to its sweet spot (about 0.83 x the bow's range, 0.67 x the wand's), shoots whenever it is ready, and backs off when the foe is closer than about half its range. **strafe** sidesteps every 0.8 s. **kite** keeps a longer distance (1.04 x / 0.79 x the range) and backs off sooner. Since the ranged move multipliers are 0.1, the three look alike for the bow (it cannot walk while drawing); the wand's strafe is its best reply to a strafing bow (87%).
- The melee fighters have one style. A designed winner is never helped by a loser that plays badly on purpose: the losing policies are the same ones the winners face in every row, and the corrected aim only removed a handicap on the shooters.
- **Shield > Sword and Shield > Bow end at 100% HP with no counterplay inside the matchup. That is intended:** the shield turns the hit back (the riposte, the reflected arrow) and the sword and the bow have no way through it. The counterplay is the second weapon slot (the axe or the wand), which section 9.3 already makes the decision of the game; the harness duels give each fighter one weapon.
- **Bots** aim with no lead (the "stale" row of WHAT THE CLIENT SEES), so their bows win Bow > Axe 27% and Bow > Sword 87%: informational, not a criterion.

## Final results

Harness, final numbers, `runHarness` (full report), main matrix: the designed winner's win % / median seconds.

```
edge                      fire     sentenced        plague         frost          holy           all
sword > axe          100%/8.9s   100%/156.2s    100%/39.6s    100%/58.0s    100%/16.4s    100%/39.6s
sword > wand        100%/10.0s   100%/161.3s    100%/41.1s    100%/58.4s    100%/17.2s    100%/41.1s
bow > sword           89%/8.8s   100%/146.2s    100%/36.7s    100%/54.6s    100%/15.4s     98%/36.7s
bow > axe             56%/8.8s    89%/146.2s     89%/36.7s    100%/54.6s     78%/15.4s     82%/36.7s
wand > bow            100%/8.6s   100%/146.7s    100%/37.2s    100%/55.4s    100%/15.9s    100%/37.2s
wand > shield         100%/7.8s   100%/146.2s    100%/36.6s    100%/54.5s    100%/15.3s    100%/36.6s
shield > sword        100%/6.5s   100%/104.7s    100%/26.8s    100%/38.8s    100%/11.1s    100%/26.8s
shield > bow          100%/4.8s    100%/76.1s    100%/19.6s    100%/28.4s     100%/8.4s    100%/19.6s
axe > wand            56%/8.8s   100%/146.8s    100%/37.5s    100%/55.6s    100%/15.9s     91%/37.5s
axe > shield          100%/8.4s   100%/146.5s    100%/37.1s    100%/55.3s    100%/15.6s    100%/37.1s
```

Style grids of the edges that changed or that involve a ranged weapon (the designed winner's win %, pooled over 3 start distances x 5 factions; per faction in brackets: fire / sentenced / plague / frost / holy):

```
bow > sword     rows: how the bow plays; columns: how the sword plays
                          sword stand
  bow stand               100% (100/100/100/100/100)
  bow strafe              100% (100/100/100/100/100)
  bow kite                100% (100/100/100/100/100)
bow > axe
  bow stand/strafe/kite    87% (67/100/100/100/67)        (all three alike: the bow cannot move while it draws)
wand > bow      rows: how the wand plays; columns: how the bow plays
                      bow stand                  bow strafe                   bow kite
  wand stand      100% (100/100/100/100/100)    80% (100/100/100/0/100)    100% (100/100/100/100/100)
  wand strafe     100% (100/100/100/100/100)    87% (100/100/100/33/100)   100% (100/100/100/100/100)
  wand kite       100% (100/100/100/100/100)    80% (100/100/100/0/100)    100% (100/100/100/100/100)
wand > shield   100% for every way the wand plays
shield > bow    100% for every way the bow plays
axe > wand      rows: the axe; columns: how the wand plays
                      wand stand                 wand strafe                  wand kite
  axe stand        87% (33/100/100/100/100)      87% (33/100/100/100/100)    87% (33/100/100/100/100)
sword > wand    100% for every way the wand plays
```

EDGE VERDICTS: all ten HOLD (`10 of 10 edges hold`). Weakest cells: Bow > Axe Fire 56% and Axe > Wand Fire 56% (the short Fire duels are decided by who lands first), Wand > Bow against a strafing bow in the Frost column (0%: Frost's slow wand, 1.35 s a cast against 1.14 s an arrow, covers fewer arrows than the bow throws).

Harness KITING (the real sim; a shooter that starts at the edge of its range; seconds until the melee fighter is in reach, and the shooter's hits before then as a share of HP; standing bound bow 1.06 s, wand 0.94 s):

```
                         post         stand        strafe          kite
  sword vs bow       0.85s    2%   0.90s    2%   0.90s    2%   0.95s    2%
  axe vs bow         0.90s    2%   0.90s    2%   0.90s    2%   1.00s    2%
  shield vs bow      1.00s    0%   1.00s    0%   1.00s    0%   1.10s    0%
  sword vs wand      0.75s    2%   0.60s    2%   0.60s    2%   0.65s    2%
  axe vs wand        0.80s    2%   0.65s    2%   0.65s    2%   0.70s    2%
  shield vs wand     0.85s    2%   0.75s    2%   0.75s    2%   0.80s    2%
  worst time against a shooter that moves, over the time against one that never does: x1.12 (sword vs bow, kite)
```
(Before: bow rows `2.30 / 3.70 / 3.70 / 5.05 s` for the sword, worst x2.25.)

Cluttered arena (ten 2x2 pillars, 6 setups x 5 factions): every edge scores the same as in the open arena (Bow > Axe 87%, Axe > Wand 90%, the rest 100%). Client views (3 start distances x 5 factions): `client` and `present` aim agree on every edge (Bow > Axe and Axe > Wand 87%, the rest 100%); the `stale` (no lead) column is the bots' aim and only Bow > Sword 87% and Bow > Axe 27% move.

The k = 2 kite table (`python3 testing/realtime_report.py k2.json kite`; seconds the melee winner can arrive late and still win >= 50%, by melee weapon: sword / axe / shield, against the free-fire time of a standing shooter; no cell prints STOLEN):

```
  Fire>Sentenced     bow: sw  1.89 ax  1.89 sh  2.00 (Tff 1.06)  wand: sw  2.09 ax  2.04 sh  1.74 (Tff 0.94)
  Fire>Plague        bow: sw  1.34 ax  1.54 sh  1.30 (Tff 1.06)  wand: sw  1.23 ax  1.30 sh  1.34 (Tff 0.94)
  Sentenced>Plague   bow: sw  2.09 ax  2.24 sh  2.09 (Tff 1.06)  wand: sw  2.09 ax  2.24 sh  2.09 (Tff 0.94)
  Sentenced>Frost    bow: sw 10.68 ax 11.21 sh 10.68 (Tff 2.65)  wand: sw 10.48 ax 11.01 sh 10.48 (Tff 2.35)
  Plague>Frost       bow: sw 13.38 ax 14.94 sh 13.38 (Tff 2.65)  wand: sw 13.58 ax 15.14 sh 13.58 (Tff 2.35)
  Plague>Holy        bow: sw 19.69 ax 20.48 sh 19.69 (Tff 1.06)  wand: sw 19.49 ax 20.28 sh 19.49 (Tff 0.94)
  Frost>Holy         bow: sw 21.05 ax 22.28 sh 21.14 (Tff 1.06)  wand: sw 21.14 ax 22.35 sh 21.18 (Tff 0.94)
  Frost>Fire         bow: sw  9.69 ax  8.99 sh  8.75 (Tff 1.06)  wand: sw  9.03 ax  9.10 sh  8.94 (Tff 0.94)
  Holy>Fire          bow: sw 26.39 ax 27.95 sh 26.43 (Tff 1.06)  wand: sw 27.14 ax 27.88 sh 27.05 (Tff 0.94)
  Holy>Sentenced     bow: sw  2.83 ax  4.00 sh  2.83 (Tff 1.06)  wand: sw  2.83 ax  4.00 sh  2.83 (Tff 0.94)
```

Before (HEAD numbers, same what-if), the cells that printed STOLEN:

```
  Fire>Sentenced     bow: sw  2.59 ax  2.33 sh  2.00 (Tff 2.47 STOLEN)  wand: sw  2.29 ax  2.40 sh  1.58 (Tff 2.12 STOLEN)
  Fire>Plague        bow: sw  1.65 ax  1.54 sh  1.30 (Tff 2.47 STOLEN)  wand: sw  1.54 ax  1.49 sh  1.19 (Tff 2.12 STOLEN)
  Sentenced>Plague   bow: sw  2.70 ax  2.50 sh  2.09 (Tff 2.47 STOLEN)  wand: sw  2.31 ax  2.09 sh  1.69 (Tff 2.12 STOLEN)
  Holy>Sentenced     bow: sw  7.10 ax  5.78 sh  2.83 (Tff 2.47)          wand: sw  6.00 ax  4.68 sh  1.69 (Tff 2.12 STOLEN)
```

## Open questions for the owner

1. **Short ranges.** Bow 240 u and wand 220 u are about half the old ones. Every length below roughly 280 u passes the k = 2 check with the old damage numbers; 240 / 220 buys a 1.22 margin on the tightest cell. `MAX_SIGHT_CORRIDOR` (mapgen's cover, certified for 480 u) is now twice the bow's range: it could be relaxed, which would give the map more open floor, but that is a mapgen change and was not touched.
2. **Near-root shooting (0.1).** It is the strongest reading of "stronger ranged penalties". 0.15 would still pass (x1.16 real kiting against the 1.22 margin) and feels less like a root. At 0.1 the bow's three styles play the same; at 0.2 and above they differ a little.
3. **Sword 1.0 -> 0.75 and axe 0.9 -> 0.8 are the price of Bow > Sword and Bow > Axe** at the bow's 0.8: the bow wins both on its opening, so it cannot also out-trade them. Fire (the axe's faction) and the mobs that carry swords (the Sentenced region's) lose output; the faction cycle itself is unchanged or better.
4. **Holy > Sentenced** (wand / bow signature opening) is 23.6% worst HP, 30.4% before. It stays inside the owner's own limit but is the one faction-model number this moved the wrong way; Phase 10 should look at it when the factions get their picker.
5. **Thin cells:** Bow > Axe and Axe > Wand in the Fire column (56%): Fire's 500 HP and 8 s duels turn on who lands first; and Wand > Bow against a strafing bow in the Frost column (0%).
6. **Phase 10 hook:** the kite model's tolerance for Fire > Plague with the bow did not move when the shield's damage went from 0.75 to 0.8, which suggests it is set by Plague's execute bringing Fire under half HP rather than by the melee weapon; if so Fire's HP (a faction number) is what bounds it from the other side.
