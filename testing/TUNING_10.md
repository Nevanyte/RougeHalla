# Phase 10 tuning log

One change, 2026-10-24, approved by the owner ("edges that don't hold get retuned; log each change with before/after numbers"): Holy's Radiant lifesteal is stronger.

| Parameter | Before | After |
|---|---|---|
| `ls0` (share of damage healed at full HP) | 0.25 | 0.25 (unchanged) |
| `ls1` (extra share per unit of missing HP) | 1.25 | 1.75 |
| `ls_cap` (largest share healed) | 1.00 | 1.50 |

Radiant now heals `0.25 + 1.75 x missing HP` of the damage Holy deals, capped at 150%. It reaches 100% at about 43% missing HP (was 60%) and the 150% cap at about 71% missing. Nothing else moved: no HP, rate, hit, share, armor, shield or other faction number, and no weapon number.

Applied in `testing/classes.py`, `packages/shared/src/factions.ts`, the identity expectations in `testing/test_rpsls.py`, `packages/shared/test/factions.test.ts` and the regenerated `packages/server/test/fixtures/realtime-paced.json`. The design sheet and counter review were synced from this log (`CLASS_SHEET.md`, `docs/GAME_DESIGN.md` 8 and 10, a dated note at the top of `COUNTER_REVIEW.md`).

## 1. Why

Phase 10's policy-mode harness (`npm run harness:factions -w @raid/server -- --mode policy`) plays the real sim with both fighters following the shared weapon policies like the bots, 18 starting setups per cell, duel pace k = 2. On the Phase 9.1 weapon numbers (sword dpsMult 0.75, axe 0.8, wand 0.8, bow range 240, wand range 220, ranged move penalties 0.1) one designed edge failed in a cell the design engine says is safe: **Holy > Sentenced with both on swords won 0%.** Sentenced ended every duel on about 3% HP, about 20 HP short.

Cause: each Sentenced sword hit staggers Holy and cancels its windup, so Holy lands about 30 of its 37 swings. About 19% of its damage is lost, and the lifesteal that rides on that damage with it. Sentenced's damage is almost all the mark, a damage over time that a stagger does not touch. Before 9.1 the same cell held with 8.1% worst HP left.

Holy > Sentenced is the design's tightest edge (27% HP left in the engine; "Holy's hit or attack rate falling 20% flips it" in `COUNTER_REVIEW.md`). The weapon layer took away exactly what the edge hangs on, so the faction layer was retuned to give it back. A lifesteal change keeps Holy's identity (lifesteal decides more, not less) and targets what the stagger removes.

## 2. Levers measured

Policy cell Holy(sword) > Sentenced(sword): win % / worst Holy HP %.

| Lever | Result | Verdict |
|---|---|---|
| none | 0% / 0.0 | fails |
| `ls0` 0.25 to 0.30 or 0.35 | 0% | no effect: the 100% cap binds in the deciding phase |
| `ls_cap` 1.0 to 1.25 or 1.5 alone | 0% | no effect |
| `ls1` 1.5 and `ls_cap` 1.5 | 100% / 3.5 | holds, thin |
| **`ls1` 1.75 and `ls_cap` 1.5 (chosen)** | **100% / 6.9** | holds |
| Holy HP 1450 to 1500 / 1550 | 0% / 100% at 2.2 | rejected: at 1550 Holy beats Sentenced even without lifesteal, which breaks the identity rule (Holy's main signature must decide an edge) |
| Sentenced `mark_cap` 275 to 250 | 100% / 6.4 | rejected: lifesteal then decides no edge (the identity test "remove lifesteal" flips nothing) |
| Rule: a stagger pauses the staggered fighter's damage over time for one attack interval | Holy > Sentenced 100% / 74.9, but the Fire > Plague and Sentenced > Plague sword mirrors flip to 0% (Plague's 0.25 s sword staggers almost continuously) | rejected |

## 3. Results

### 3.1 Design engine (`engine.py`, k = 1, dt 0.002)

Winner, fight length, winner HP left. Only the four edges that involve Holy moved.

| Edge | Before | After |
|---|---|---|
| Plague > Holy | 15.8 s, 67% | 16.7 s, 66% |
| Frost > Holy | 52.3 s, 63% | 61.5 s, 57% |
| Holy > Fire | 8.1 s, 69% | 8.1 s, 72% |
| Holy > Sentenced | 22.7 s, 27% | 22.7 s, 34% |

The other six edges are unchanged: Fire > Sentenced 3.7 s 77%, Fire > Plague 2.1 s 71%, Sentenced > Plague 7.4 s 56%, Sentenced > Frost 16.6 s 51%, Plague > Frost 37.0 s 40%, Frost > Fire 13.1 s 49%. Holy > Sentenced stays the tightest edge (34%); the longest fight is still Frost > Holy, now 61.5 s (k = 2: about 31 s).

Holy deals and takes the same damage as before; it gets more of it back once it is hurt. Where Holy is the winner (Holy > Sentenced, Holy > Fire) it finishes with more HP. Where Holy is the loser (Plague > Holy, Frost > Holy) the fight lasts longer and the winner finishes lower. Frost > Holy pays most: 6 points and 9 s.

### 3.2 Design oracle (`python3 testing/test_rpsls.py`)

ALL PASS: the 10/10 graph at dt 0.01, 0.005, 0.002 and 0.001; each power beats exactly two; scale invariance (0.25x to 20x); relabeling; jitter of +-5% and +-10% (30/30 perfect draws each); purity audit. Identity table (flips and largest margin shift, in points), the four rows that changed:

| Power | Remove | Before | After |
|---|---|---|---|
| Plague | The flat disease (sub) | flips Plague > Frost, 114 | flips Plague > Frost **and Plague > Holy**, 114 |
| Frost | The slow (main) | flips Frost > Holy, 103 | flips Frost > Holy, 108 |
| Holy | Lifesteal (main) | flips Holy > Sentenced, 30 | flips Holy > Sentenced, 37 |
| Holy | Flat lifesteal, no missing-HP scaling (sub) | flips none, 19 | flips none, 26 |

Lifesteal still decides an edge and the missing-HP scaling still moves a margin by more than 15 points, so both rules hold. The other five rows are unchanged.

### 3.3 Sensitivity (engine, dt 0.002 unless noted)

Slider table of `CLASS_SHEET.md` section 7 (each knob +-25%, points of the winner's HP): changed rows only. Rows are "most moved edge, second"; the same method reproduces the old table's figures.

| Knob | Before | After |
|---|---|---|
| Frost slow | Frost > Holy 22, Plague > Frost 6 | Frost > Holy 38, Plague > Frost 6 |
| Holy shield | Holy > Sentenced 20, Holy > Fire 8 | Holy > Sentenced 17, Holy > Fire 8 |
| Sentenced `mark_cap` | Holy > Sentenced 18, Sentenced > Frost 10 | Holy > Sentenced 16, Sentenced > Frost 10 |
| Plague `plague` | Plague > Frost 12, Sentenced > Plague 6 | Plague > Frost 12, Plague > Holy 6 |
| Plague armor | Plague > Frost 9, Plague > Holy 8 | Plague > Holy 9, Plague > Frost 9 |
| Holy `ls1` | Holy > Sentenced 4, Holy > Fire 2 | Holy > Sentenced 5, Frost > Holy 3 |
| Holy `ls_cap` (new row) | Holy > Sentenced 4, Frost > Holy 2 | Frost > Holy 4, Holy > Sentenced 2 |

Unchanged: Fire backlash 9 and 8, Sentenced `mark_ramp` 7 and 5, Plague execute 2 and 1, Holy `ls0` 2 and 2, Fire burn 1 and 0, Fire rate 0, Frost rate 8 (Frost > Fire).

- **No single +-25% change to any knob or core stat flips an edge** (HP, rate, hit, armor, shield and every signature parameter of every power, checked at dt 0.005). Before the retune Holy's hit or rate at -25% flipped Holy > Sentenced; it now holds, with 2.8% left.
- Frost > Holy gets the largest slider in the sheet: Frost's slow at -25% (0.45) still wins but takes 83.5 s with 19% left. Frost's hit or rate at -25% wins in 106.8 s with 24.7% left, close to the engine's 120 s cap.

Distance to a flip, Holy > Sentenced:

| Change that flips it | Before | After |
|---|---|---|
| Holy hit or attack rate falls by | 20.0% (hit 65 to 52) | 26.5% (hit 65 to 48; rate 0.95 to 0.70) |
| Sentenced's total damage (hits and bonus) rises by | x1.29 | x1.42 |
| Sentenced's HP rises by | x1.35 | x1.64 |
| Holy shield falls by | 31.7% (250 to 171) | 41.1% (250 to 147) |
| Sentenced `mark_cap` rises to | 385 | 434 |

Distance to a flip, Frost > Holy (the engine's 120 s cap counts a fight that is not over as no win; the second figure lets the fight run to the end):

| Change that flips it | Before | After |
|---|---|---|
| Frost hit or attack rate falls by | 40.7% (fight passes 120 s); Holy wins at 45.4% | 28.6% (hit 90 to 64); Holy wins at 32.9% (hit 60) |
| Holy HP rises by | x2.29 (passes 120 s); Holy wins at x2.71 | x1.95 (passes 120 s); Holy wins at x2.30 |
| Frost's slow falls from 0.60 to | 0.27 | 0.40 |
| Holy's total damage rises by (120 s cap) | x1.83 | x1.49 |

### 3.4 Policy mode (real sim, k = 2, 18 setups per cell)

Measured on a preview merge with the Phase 9.1 weapon numbers (this branch still has the pre-9.1 table). Designed winner's worst HP %, both fighters on the same weapon, before to after:

| Edge | sword | axe | bow | wand | Signature opening |
|---|---|---|---|---|---|
| Holy > Sentenced | 0 (0% win) to **6.9** | 28.6 to 36.2 | 23.6 to 32.2 | 22.6 to 31.8 | 24.7 to 33.4 (wand/bow) |
| Plague > Holy | 80.3 to 80.3 | 67.8 to 65.3 | 66.2 to 64.4 | 64.3 to 62.2 | 43.3 to 37.0 (bow/wand) |
| Frost > Holy | 63.7 to 54.7 | 61.8 to 57.6 | 61.9 to 55.8 | 60.4 to 55.0 | 56.8 to 49.6 (shield/wand) |
| Holy > Fire | 68.0 to 70.7 | 69.8 to 72.2 | 69.8 to 72.8 | 68.7 to 71.8 | 62.7 to 65.5 (wand/axe) |

Every other cell is unchanged. The Holy > Sentenced sword mirror now wins 100% with 6.9% worst HP: it holds, thinly.

### 3.5 Trades mode (faction rules alone, against `realtime.py`, k = 2)

Run on this branch, which still has the **pre-9.1 weapon table**, so these numbers are not comparable cell by cell with section 3.4.

```
npm run harness:factions -w @raid/server -- --python
Mirror: 50/50 cells at 100%; lowest worst hp 31.7% (Holy > Sentenced, bow)
Signature openings: 10/10 cells at 100%; lowest worst hp 27.9% (Frost > Fire, shield/axe)
Pairs with the same winner: 7370/7370; largest hp fraction difference: 3.00e-5
Verdict: agrees with realtime.py on 60/60 cells (same winner on every pair and hp within 1e-4)
```

Before the change the lowest mirror cell was the same one, Holy > Sentenced on bows, at 22.8%. Holy rows, mirror matrix, worst winner HP % (every cell 100% win before and after), before to after:

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Plague > Holy | 65.7 to 63.7 | 66.6 to 63.8 | 66.2 to 64.4 | 66.5 to 64.3 | 65.5 to 63.4 |
| Frost > Holy | 62.0 to 55.1 | 59.4 to 54.6 | 61.9 to 55.8 | 61.7 to 56.0 | 61.7 to 54.7 |
| Holy > Fire | 66.2 to 68.9 | 68.1 to 70.3 | 66.3 to 69.0 | 65.3 to 68.1 | 66.0 to 68.7 |
| Holy > Sentenced | 25.0 to 33.2 | 26.0 to 34.5 | 22.8 to 31.7 | 25.9 to 34.1 | 24.4 to 33.0 |

Holy rows, signature openings (all 100% wins), worst HP % / mean HP % / median fight, before to after (the "before" values come from `realtime.py`, which the harness matches to 0.1 s):

| Pair | Weapons | Worst % | Mean % | Median t |
|---|---|---|---|---|
| Plague > Holy | bow/wand | 64.3 to 62.1 | 64.8 to 62.5 | 10.2 s to 10.8 s |
| Frost > Holy | shield/wand | 54.1 to 44.5 | 56.1 to 47.0 | 36.7 s to 44.2 s |
| Holy > Fire | wand/axe | 62.8 to 65.7 | 66.0 to 68.7 | 4.8 s to 4.8 s |
| Holy > Sentenced | wand/bow | 31.2 to 38.5 | 32.5 to 39.3 | 13.2 s to 13.2 s |

### 3.6 20 Hz weapon model (`realtime.py`, k = 1 unless noted)

- **Mixed weapons.** Before: Holy > Sentenced failed in two of the 25 weapon pairs (Holy bow against Sentenced sword won 27% of phase pairs, Holy shield against Sentenced sword 0%). Now both win 100% (worst HP 11.0% and 3.4%; at k = 2: 9% and 0% to 100% with 10.2% and 4.4%). All 25 pairs of all four Holy edges hold at 60% or better.
- **Signature opening Holy(wand) > Sentenced(bow):** worst HP 30.4% to 37.3%. With Sentenced on the sword (the opening the design avoided): 8.1% to 18.8%, and the smallest HP buff on Sentenced that flips it goes from x1.08 to x1.25.
- **Kiting.** Holy(shield) > Sentenced, the binding cell: tolerance against a ranged Sentenced 5.65 s (bow) and 3.30 s (wand) to 10.9 s and 8.0 s; the largest ranged dpsMult that keeps the edge 0.87 (bow) and 0.88 (wand) to 0.96 and 0.97. Fire > Plague still binds the ranged damage numbers (0.846 bow, 0.878 wand).
- **Buff caps** (smallest multiplier on the losing side that flips an edge, minimum over the five mirrors and the signature opening; `realtime_report.py buff`):

| Stat | Edge | Before | After |
|---|---|---|---|
| HP | Holy > Sentenced | x1.31 | x1.59 |
| HP | Frost > Holy | x2.28 | x1.86 |
| HP | Plague > Holy | x2.84 | x2.69 |
| HP | Holy > Fire | x5.09 | never within x8 |
| Attack speed | Frost > Holy | x1.63 | **x1.32** |
| Attack speed | Plague > Holy | x2.09 | x1.88 |
| Attack speed | Holy > Fire | x6.25 | x6.94 |

The overall softest HP edge is now Holy > Sentenced and Frost > Fire together (x1.59, was Holy > Sentenced at x1.31). The overall softest attack-speed edge is now Frost > Holy (x1.32, was x1.63). All other edges are unchanged.

## 4. Side effect to watch: Frost > Holy is softer against buffs

Probable cause: Holy's swings are both its damage and its healing, so a stronger lifesteal makes an attack-speed buff worth more to it, while Frost's slow still takes 60% of the swings. Stacked buffs on the loser, cells that fall under 60% wins (k = 1, same method as `COUNTER_REVIEW.md` section 5):

| HP x / attack speed x | Before | After |
|---|---|---|
| 1.2 / 1.2 | holds every edge | holds every edge |
| 1.2 / 1.3 | holds every edge | **Frost > Holy signature opening (Holy wand, Frost shield) 0%** |
| 1.3 / 1.2 | Holy > Sentenced bow 45%, shield 52% | **Frost > Holy signature opening 0%** |
| 1.3 / 1.3 | Plague > Frost on all five mirrors (0-13%); Holy > Sentenced bow 27%, shield 29% | Plague > Frost on all five mirrors (0-13%); **Frost > Holy signature opening 0%** |

So the review's recommended caps (+20% max HP, +30% attack speed, `COUNTER_REVIEW.md` section 5) still hold one at a time (x1.59 and x1.32) but no longer hold stacked on a Holy facing Frost. In the S-curve of `docs/GAME_DESIGN.md` 12.2, x1.32 attack speed is four stacks (+34%). This is reported to the owner, not retuned. Related: Frost > Holy fights get longer. Frost(shield) > Holy(sword) in the 20 Hz model has a median length of 106 s at k = 1 and 52 s at k = 2 (was 79 s and 40 s), and Frost keeps 24% in the worst case there (was 43%).

## 5. Still failing at the weapon layer (reported, not retuned)

Policy mode, Phase 9.1 weapon numbers. These are not faction-rule problems and a lifesteal change does not reach them:

- **The four shield mirrors** Frost > Holy, Frost > Fire, Holy > Fire and Holy > Sentenced win 0%. Two shields facing each other block every bash, so only damage over time lands: the damage-over-time factions win, and Frost against Holy is a draw.
- **The Plague(bow) > Frost(shield) opening** wins 0%. The shield reflects every arrow back into Plague. Phase 9.1 records Shield > Bow as intended to have no counterplay inside the matchup; the answer is the second weapon slot.

## 6. Not re-run

Of the 20 Hz tables in `COUNTER_REVIEW.md`: the kiting tables other than the Holy(melee) > Sentenced(ranged) tolerance in 3.6 (including rule B's free-fire ceilings, where the wand ceiling of 0.86 was set by Holy(shield) > Sentenced and should have risen), the "gap" (feel) report, the heal-item and disengage runs, the v2-plan subsection and the move-speed caps. The weapon tuning of Phase 9.1 itself is unchanged.

## 7. Reproduce

```
python3 testing/test_rpsls.py                                      # design oracle, identity table (ALL PASS)
python3 testing/realtime_report.py engine                           # engine table of 3.1 (dt 0.002)
python3 testing/realtime_report.py buff                             # buff caps of 3.6 (a few minutes, needs numpy)
npm run harness:factions -w @raid/server -- --python               # trades mode against realtime.py (~5 s, needs python3 with numpy)
npm run harness:factions -w @raid/server -- --mode policy          # policy mode (needs the Phase 9.1 weapon numbers)
```

To get a "before" number, set `ls1` 1.25 and `ls_cap` 1.0 for Holy in `testing/classes.py` (or pass `realtime_report.py` a what-if file with those two Holy params) and run the same command. The sensitivity, flip-distance, stacked-buff and kiting figures of 3.3, 3.6 and 4 are ad hoc scripts over `engine.duel` and `realtime.duel` using the definitions in `CLASS_SHEET.md` section 7 and `COUNTER_REVIEW.md` sections 3 and 5; the same scripts reproduce the old figures in those documents (the engine rows, the x1.31 and x1.63 buff caps, the 5.65 s and 3.30 s kiting tolerances, the 27% and 0% mixed-weapon cells), which is how the "before" columns were checked.
