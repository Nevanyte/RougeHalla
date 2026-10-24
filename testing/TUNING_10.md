# Phase 10 tuning log

The final record of Phase 10's balance work, 2026-10-24, under the owner's rule "edges that don't hold get retuned; log each change with before/after numbers". **No faction number changed.** A stronger Holy lifesteal was tried and reverted; what stayed is two rules in the real sim.

| Change | Where | Status |
|---|---|---|
| Holy lifesteal `0.25 + 1.25 x missing HP`, cap 100% to `0.25 + 1.75 x missing HP`, cap 150% | `testing/classes.py`, `packages/shared/src/factions.ts` | tried, then reverted after the final review (section 2) |
| A landed stagger pauses the staggered fighter's burn, disease and mark for its weapon's windup | `packages/server/src/sim/factions.ts` (`staggerPause`) | kept (section 3) |
| The chill no longer stretches the ranged recovery | `packages/server/src/sim/factions.ts` | kept (section 4) |
| Sentenced's signature weapon | `SIGNATURE_WEAPONS` in `packages/shared/src/weapons.ts` | unchanged, the bow (section 7) |

## 1. The problem

Phase 10's policy-mode harness (`npm run harness:factions -w @raid/server -- --mode policy`) plays the real sim with both fighters following the shared weapon policies like the bots, 18 starting setups per cell, duel pace k = 2. On the Phase 9.1 weapon numbers (sword dpsMult 0.75, axe 0.8 at the time, wand 0.8, bow range 240, wand range 220, ranged move penalties 0.1) one designed edge failed in a cell the design engine says is safe: **Holy > Sentenced with both on swords won 0%.** Sentenced ended every duel on about 3% HP, about 20 HP short.

Cause: a sword hit staggers its target and cancels a swing that is still winding up. Holy lost 19 to 21% of its swings that way (8 cancels on each side over an 18.6 s duel), and the lifesteal that rides on that damage went with them. Sentenced lost about the same share of its sword swings, but its damage is almost all the mark, a damage over time that a stagger does not touch. Before 9.1 the same cell held with 8.1% worst HP left.

Holy > Sentenced is the design's tightest edge (27% HP left in the engine; "Holy's hit or attack rate falling 20% flips it" in `COUNTER_REVIEW.md`). The weapon layer took away exactly what the edge hangs on. Two layers could give it back: the faction numbers (section 2) or the stagger (section 3).

## 2. The lifesteal retune: tried, adopted, reverted

### 2.1 What was tried

| Parameter | v3 | Retune |
|---|---|---|
| `ls0` (share healed at full HP) | 0.25 | 0.25 |
| `ls1` (extra share per unit of missing HP) | 1.25 | 1.75 |
| `ls_cap` (largest share healed) | 1.00 | 1.50 |

Radiant then healed `0.25 + 1.75 x missing HP` of the damage Holy deals, capped at 150%: 100% at about 43% missing HP (60% in v3) and the cap at about 71% missing. It fixed the cell: the sword mirror went from 0% to 100% with 6.9% worst HP. The engine moved on four Holy edges (Plague > Holy 67% to 66%, Frost > Holy 63% to 57% and 52 s to 62 s, Holy > Fire 69% to 72%, Holy > Sentenced 27% to 34%). It was adopted (commit 9f4e0b4) and documented (6ebd88f, 2a0b51f). Its result tables are in Appendix A.

### 2.2 Levers measured

Policy cell Holy(sword) > Sentenced(sword): win % / worst Holy HP %.

| Lever | Result | Verdict |
|---|---|---|
| none | 0% / 0.0 | fails |
| `ls0` 0.25 to 0.30 or 0.35 | 0% | no effect: the 100% cap binds in the deciding phase |
| `ls_cap` 1.0 to 1.25 or 1.5 alone | 0% | no effect |
| `ls1` 1.5 and `ls_cap` 1.5 | 100% / 3.5 | holds, thin |
| `ls1` 1.75 and `ls_cap` 1.5 | 100% / 6.9 | holds; adopted, then reverted (2.3) |
| Holy HP 1450 to 1500 / 1550 | 0% / 100% at 2.2 | rejected: at 1550 Holy beats Sentenced even without lifesteal, which breaks the identity rule (Holy's main signature must decide an edge) |
| Sentenced `mark_cap` 275 to 250 | 100% / 6.4 | rejected: lifesteal then decides no edge (the identity test "remove lifesteal" flips nothing) |

Every lifesteal setting that fixed the cell had a cap above 100%.

### 2.3 Why it was reverted

The final review found that a cap above 100% lets a losing Holy at low HP heal more than it takes, so **Holy against Holy can stall for ever.**

Design engine (`engine.duel`, dt 0.002, `t_max` 600 s), Holy against a Holy whose hit is m times as large. Winner and time, or HP of the weaker and stronger Holy when nothing ends at 600 s:

| m | v3 lifesteal (1.25, 100%) | Retune (1.75, 150%) |
|---|---|---|
| 1.00 | stalls: 580 / 580 HP | stalls: 829 / 829 |
| 1.05 | stronger Holy wins in 240 s | stalls: 787 / 868 |
| 1.10 | wins in 134 s | stalls: 746 / 904 |
| 1.25 | wins in 64 s | stalls: 621 / 994 |
| 1.50 | wins in 36 s | stalls: 414 / 1105 |
| 1.60 | wins in 31 s | wins in 102 s |

At the v3 numbers only exactly equal damage stalls; at the retuned numbers every ratio from 1.0 to 1.5 does.

Real sim (Holy on both sides, signatures on, 18 setups, 300 s cap): with the retune, 6 of the 10 weapon edges ran into the cap in all 18 setups (Sword > Axe ends with 75% and 37% HP, Bow > Sword 61% and 56%, Axe > Wand 69% and 48%; Bow > Axe, Wand > Shield and Axe > Shield also stall). At the v3 numbers all 10 resolved. This run was made for the final review and was not repeated for this log.

### 2.4 Restored

Lifesteal is back to `0.25 + 1.25 x missing HP`, capped at 100%, in `testing/classes.py`, `packages/shared/src/factions.ts`, the identity expectations of `testing/test_rpsls.py`, `packages/shared/test/factions.test.ts` and the regenerated `packages/server/test/fixtures/realtime-paced.json`. `CLASS_SHEET.md`, `docs/GAME_DESIGN.md` and `COUNTER_REVIEW.md` are back to the v3 values. Section 5 has the measurements of the final state.

## 3. The stagger rule

**The rule** (`staggerPause` in `packages/server/src/sim/factions.ts`). Every stagger that lands (the target's 0.5 s stagger immunity starts that tick, whether or not it cancelled anything) pauses the staggered fighter's burn, disease and mark for its weapon's windup: sword and shield 0.1 s, axe up to 0.25 s, wand cast up to 0.2 s, bow 0 (a bow draw is not cancelled). Fire's backlash never pauses: it is a reply to the enemy's swings. The mark's clock keeps running; only the damage is withheld. It exists only in the real sim: trades mode and `realtime.py` have no staggers, so the 60/60 parity is untouched.

**Why it is principled.** A stagger cancels a swing or cast only while it is winding up. The chance that a stagger lands in a windup is windup / interval, and it then costs the whole hit (damage per second x interval), so on average a stagger costs a hit-based fighter one windup of its weapon's damage. A damage-over-time faction's output has no windup, so a stagger cost it nothing, and a sword's staggers traded only against hit-based factions (Holy). The pause takes the same expected amount from a damage-over-time fighter: one windup of its output.

**Measured**, policy mode, 9.1 weapons, v3 lifesteal:

- Holy > Sentenced with both on swords: before the rule 0% (worst 0.0); after, **100% / 3.8% worst HP**. Holy's lost swings: 19 to 21% before.
- The other Holy > Sentenced cells did not move (bow 23.6, wand 22.6, signature opening 24.7: no sword in them). The axe column cannot be compared: it was measured with the axe at 0.8, before 9.1's last cut to 0.77.
- Only sword mirrors move among the other cells: only an unblocked sword hit staggers, so no other same-weapon cell has a stagger. Sword mirror, worst winner HP %, before to after the rule:

| Edge | Before | After |
|---|---|---|
| Fire > Sentenced | 72.1 | 73.3 |
| Fire > Plague | 70.7 | 71.8 |
| Sentenced > Plague | 60.7 | 59.0 |
| Sentenced > Frost | 49.0 | 49.0 |
| Plague > Frost | 47.3 | 44.7 |
| Plague > Holy | 80.3 | 78.8 |
| Frost > Holy | 63.7 | 63.7 |
| Frost > Fire | 45.6 | 45.8 |
| Holy > Fire | 68.0 | 68.1 |
| Holy > Sentenced | 0.0 (wins 0%) | 3.8 (wins 100%) |

No cell flips, and the set of failing cells is the same five as before (section 6). The "before" column for the Holy rows is the policy run without the retune; for the others it is the run with the retune, which only moves Holy.

**Rejected variants.**

| Variant | Result |
|---|---|
| Pause damage over time only on a `stagger` fx | 9.1 emits that fx only when a windup was cancelled: 8 pauses in the duel, Holy > Sentenced still 0% |
| Pause damage over time for one whole attack interval per stagger | overcorrects: Holy > Sentenced 100% / 74.9, but the Fire > Plague and Sentenced > Plague sword mirrors flip to 0% (Plague's 0.25 s sword staggers almost continuously) |
| A lifesteal change (section 2) | fixes the cell, stalls Holy against Holy |
| Holy HP, Sentenced `mark_cap` | break the identity rule (section 2.2) |

## 4. The chill and the ranged recovery

The chill (Frost's attack-rate cut) stretched four timers: the cooldown (`readyAt`), the bow draw, the press buffer and the ranged recovery (`weapon.recoverUntil`, the time after a shot spent at reduced move speed). With 9.1's recovery move speed of 0.1x the last one near-rooted chilled shooters about 2.4 times as long, at any range, past the owner's rule that the chill slows movement to 0.7x only within 100 u of Frost. Time below full speed after one shot, unchilled to chilled:

| Shooter | Unchilled | Chilled |
|---|---|---|
| Fire wand | 1.05 s | 2.55 s |
| Sentenced wand | 0.70 s | 1.70 s |
| Holy wand | 0.65 s | 1.60 s |
| Fire bow | 0.45 s | 1.05 s |
| Plague bow | 0.15 s | 0.40 s |

Now the recovery keeps its unchilled end (`afterWeapons` and `updateChill` no longer touch `recoverUntil`). The chill still stretches the cooldown, the bow draw and the press buffer, so Frost still cuts the attack rate to 40%. Outside the sword column, no policy-mode mirror cell or signature opening differs from the run before the two rules, except Holy's axe cells and the wand/axe opening, which moved with 9.1's axe cut (0.8 to 0.77).

## 5. Final measurements

Duel pace (k = 2) unless it says k = 1. All on this branch, 9.1 weapon numbers, v3 lifesteal.

### 5.1 Design oracle, engine and kiting

- `python3 testing/test_rpsls.py`: ALL PASS. The 10/10 graph at dt 0.01, 0.005, 0.002 and 0.001; each power beats exactly two; scale invariance (0.25x to 20x); relabeling; jitter of +-5% and +-10% (30/30 perfect draws each); purity audit; the identity table of `CLASS_SHEET.md` section 4 (Holy lifesteal flips Holy > Sentenced, 30 points; flat lifesteal flips none, 19; Frost's slow 103; flat disease flips Plague > Frost only, 114).
- `python3 testing/realtime_report.py engine` (dt 0.002): the ten rows of `CLASS_SHEET.md` section 6. Plague > Holy 15.8 s 67%, Frost > Holy 52.3 s 63%, Holy > Fire 8.1 s 69%, Holy > Sentenced 22.7 s 27% (tightest).
- `python3 testing/test_kite.py` (k = 2): ALL PASS. The weakest melee faction winner's tolerance stays above the free fire a ranged loser gets on the approach (1.06 s bow, 0.94 s wand) in all 20 cells. Holy > Sentenced: 2.83 s against the bow and the wand. Fire > Plague with the bow is still the tightest, 1.23 s against 1.06 s.

### 5.2 Trades mode (faction rules alone, against `realtime.py`)

```
npm run harness:factions -w @raid/server -- --python
Mirror: 50/50 cells at 100%; lowest worst hp 22.5% (Holy > Sentenced, wand)
Signature openings: 10/10 cells at 100%; lowest worst hp 22.5% (Holy > Sentenced, wand/bow)
Pairs with the same winner: 7370/7370; largest hp fraction difference: 1.00e-6
Verdict: agrees with realtime.py on 60/60 cells (same winner on every pair and hp within 1e-4)
```

Mirror matrix, worst winner HP % (every cell wins 100%):

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced | 67.5 | 49.8 | 65.2 | 62.7 | 62.4 |
| Fire > Plague | 65.6 | 67.4 | 63.2 | 64.0 | 65.2 |
| Sentenced > Plague | 61.0 | 59.7 | 60.8 | 60.3 | 61.5 |
| Sentenced > Frost | 49.0 | 48.9 | 50.9 | 48.5 | 50.2 |
| Plague > Frost | 39.7 | 36.6 | 38.0 | 37.2 | 39.3 |
| Plague > Holy | 66.7 | 66.6 | 66.2 | 66.4 | 65.5 |
| Frost > Holy | 62.4 | 61.2 | 61.9 | 60.4 | 61.7 |
| Frost > Fire | 45.2 | 39.2 | 40.7 | 40.3 | 42.3 |
| Holy > Fire | 66.4 | 67.6 | 66.3 | 66.9 | 66.0 |
| Holy > Sentenced | 23.8 | 23.4 | 22.8 | 22.5 | 24.4 |

Signature openings (each faction on its starting weapon, all 100% wins):

| Pair | Weapons | Worst % | Mean % | Median t |
|---|---|---|---|---|
| Fire > Sentenced | axe/bow | 57.0 | 65.3 | 2.5 s |
| Fire > Plague | axe/bow | 63.2 | 66.1 | 1.5 s |
| Sentenced > Plague | bow/bow | 60.8 | 60.8 | 4.2 s |
| Sentenced > Frost | bow/shield | 50.2 | 55.4 | 9.9 s |
| Plague > Frost | bow/shield | 42.6 | 43.7 | 23.3 s |
| Plague > Holy | bow/wand | 66.4 | 67.3 | 10.0 s |
| Frost > Holy | shield/wand | 58.6 | 60.0 | 35.5 s |
| Frost > Fire | shield/axe | 38.4 | 43.2 | 9.1 s |
| Holy > Fire | wand/axe | 68.4 | 71.2 | 4.8 s |
| Holy > Sentenced | wand/bow | 22.5 | 24.1 | 14.4 s |

### 5.3 Policy mode (real sim, 18 setups per cell)

```
npm run harness:factions -w @raid/server -- --mode policy
Mirror: 46/50 cells at 100%; lowest worst hp 0.0% (Frost > Holy, shield)
Signature openings: 9/10 cells at 100%; lowest worst hp 0.0% (Plague > Frost, bow/shield)
```

Mirror matrix, worst winner HP % (a cell below 100% wins is marked with its win rate):

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced | 73.3 | 69.9 | 71.3 | 69.0 | 42.0 |
| Fire > Plague | 71.8 | 70.7 | 64.3 | 66.3 | 81.3 |
| Sentenced > Plague | 59.0 | 59.7 | 60.8 | 58.8 | 79.7 |
| Sentenced > Frost | 49.0 | 48.9 | 50.9 | 48.5 | 100.0 |
| Plague > Frost | 44.7 | 40.6 | 38.0 | 37.2 | 100.0 |
| Plague > Holy | 78.8 | 66.6 | 66.2 | 64.3 | 100.0 |
| Frost > Holy | 63.7 | 63.2 | 61.9 | 60.4 | **0 (wins 0%)** |
| Frost > Fire | 45.8 | 44.6 | 41.1 | 40.7 | **0 (wins 0%)** |
| Holy > Fire | 68.1 | 70.7 | 69.8 | 68.7 | **0 (wins 0%)** |
| Holy > Sentenced | **3.8** | 27.0 | 23.6 | 22.6 | **0 (wins 0%)** |

Signature openings (win % / worst HP % / mean HP % / median fight):

| Pair | Weapons | Win | Worst % | Mean % | Median t |
|---|---|---|---|---|---|
| Fire > Sentenced | axe/bow | 100% | 42.8 | 60.0 | 3.8 s |
| Fire > Plague | axe/bow | 100% | 52.8 | 57.1 | 2.7 s |
| Sentenced > Plague | bow/bow | 100% | 60.8 | 60.8 | 5.0 s |
| Sentenced > Frost | bow/shield | 100% | 47.4 | 52.6 | 10.8 s |
| Plague > Frost | bow/shield | **0%** | 0.0 | 0.0 | 29.4 s |
| Plague > Holy | bow/wand | 100% | 43.3 | 46.8 | 17.4 s |
| Frost > Holy | shield/wand | 100% | 56.8 | 57.7 | 36.7 s |
| Frost > Fire | shield/axe | 100% | 43.7 | 43.7 | 9.6 s |
| Holy > Fire | wand/axe | 100% | 64.3 | 71.9 | 6.2 s |
| Holy > Sentenced | wand/bow | 100% | 24.7 | 26.3 | 15.3 s |

The lowest holding cell is the Holy > Sentenced sword mirror, 3.8% in the worst case. All wins are 100% except the four shield mirrors and the Plague(bow) > Frost(shield) opening (section 6). The run is deterministic: two runs print the same numbers.

### 5.4 20 Hz model (`realtime.py`)

**Mixed weapons.** All 250 cells (10 edges x 25 weapon pairs) win every phase pair, at k = 1 and at k = 2. The thinnest are Holy's sword against Sentenced's wand or bow (worst HP 16.9% at k = 1, 17.4% at k = 2), Holy's shield against the same (17.4%, 18.0%) and Holy's axe (18.9%, 19.6%). Outside Holy > Sentenced the thinnest is Plague's sword or shield against Frost's wand (33.7% at k = 2; 35.0% at k = 1 against the bow).

**Longest stretch with no swing from either fighter** (`realtime_report.py gap`): 1.60 s (Frost > Holy, axe/axe).

**Holy(wand) > Sentenced, worst HP % by what Sentenced holds** (win 100% in all):

| Sentenced on | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| k = 1 | 29.4 | 27.1 | 23.6 | 23.6 | 29.4 |
| k = 2 | 28.5 | 26.1 | 22.5 | 22.5 | 28.5 |

Before 9.1 (pre-9.1 weapons, k = 1) the bow gave 30.4% and the sword 8.1%.

**Buff caps** (smallest multiplier on the losing side that flips an edge, below 50% wins; minimum over the five mirrors and the signature opening; `python3 testing/realtime_report.py buff`, k = 1). "Never" is no flip within x8. They are the numbers `TUNING_9_1.md` reported (Holy > Sentenced x1.30 HP, Plague > Frost x1.66 attack speed), as they should be with the v3 lifesteal:

| Edge | HP | Attack speed |
|---|---|---|
| Fire > Sentenced | x1.82 (signature) | never |
| Fire > Plague | x2.04 (signature) | x3.60 (sword) |
| Sentenced > Plague | x2.00 (bow) | x2.29 (bow) |
| Sentenced > Frost | x2.38 (bow) | x2.11 (bow) |
| Plague > Frost | x1.66 (bow) | **x1.66** (bow) |
| Plague > Holy | x3.05 (axe) | x2.22 (sword) |
| Frost > Holy | x2.49 (signature) | x1.73 (signature) |
| Frost > Fire | x1.90 (wand) | x4.24 (wand) |
| Holy > Fire | x6.03 (shield) | x6.50 (sword) |
| Holy > Sentenced | **x1.30** (sword) | never |

The softest HP edge is Holy > Sentenced (x1.30 on the sword and axe mirrors, x1.31 on the others and on the signature opening), about three stacks in the S-curve of `docs/GAME_DESIGN.md` 12.2 (+32%). The softest attack-speed edge is Plague > Frost (x1.66 to x1.67 on the mirrors, x1.79 on its signature opening); Frost > Holy is next (x1.84 on the five mirrors, x1.73 on the opening). Both sit above the S-curve's plateau for attack speed (about +47%).

**Stacked buffs on the loser** (cells under 60% wins, k = 1, the method of `COUNTER_REVIEW.md` section 5: five mirrors and the signature opening):

| HP x / attack speed x | Cells under 60% |
|---|---|
| 1.2 / 1.2 | none |
| 1.2 / 1.3 | none |
| 1.3 / 1.2 | Holy > Sentenced on swords 0%, bows 45%, shields 52% |
| 1.3 / 1.3 | Plague > Frost on all five mirrors 0%; Holy > Sentenced on swords 0%, bows 27%, shields 29% |

The review's caps (+20% max HP, +30% attack speed) hold one at a time and together; only HP +30% breaks edges. `TUNING_9_1.md` reported the Holy > Sentenced axe mirror failing here (12%); that was with the axe at 0.8, and at 0.77 it holds (76% at 1.3 / 1.2, 65% at 1.3 / 1.3). The Frost > Holy opening holds in all four cells (the lifesteal retune had broken it, Appendix A.5).

## 6. Still failing at the weapon layer (reported, not retuned)

Policy mode. These are not faction-rule problems and neither the lifesteal nor the stagger rule reaches them:

- **The four shield mirrors** Frost > Holy, Frost > Fire, Holy > Fire and Holy > Sentenced win 0%. Two shields facing each other block every bash, so only damage over time lands (Fire's burn, Sentenced's mark, Plague's disease). A designed winner without one (Frost, Holy) does not win; where the designed winner has one (Sentenced > Frost, Plague > Frost, Plague > Holy) it wins and finishes with 100% HP.
- **The Plague(bow) > Frost(shield) opening** wins 0%. The shield reflects every arrow back into Plague. Phase 9.1 records Shield > Bow as intended to have no counterplay inside the matchup; the answer is the second weapon slot.
- **Thin but holding:** the Holy > Sentenced sword mirror (3.8% worst HP), the Holy > Sentenced opening (24.7%) and the Fire > Sentenced opening (42.8%, axe/bow).

## 7. Sentenced's signature weapon

Phase 9.1 flagged that, in `realtime.py`, the Holy > Sentenced opening was healthier with Sentenced on the sword (29.4%) than on the bow (23.6%), and left `SIGNATURE_WEAPONS.sentenced` to this phase. Sentenced's weapon takes part in four openings (Fire > Sentenced, Sentenced > Plague, Sentenced > Frost, Holy > Sentenced), so each weapon was tried in all four: trades mode (k = 2, against `realtime.py`) and policy mode (real sim, with the stagger rule). "Contested" means the weapon edge opposes the faction edge, "both" that the weapon edge also favours the faction winner, "neutral" a mirror. Designed winner's win % / worst HP %:

| Sentenced on | Opening | Kind | Trades | Policy |
|---|---|---|---|---|
| Sword | Fire(axe) > Sentenced | contested | 100 / 67.5 | 100 / 66.0 |
| | Sentenced > Plague(bow) | contested | 100 / 58.8 | 100 / 52.1 |
| | Sentenced > Frost(shield) | contested | 100 / 50.2 | 100 / 48.7 |
| | Holy(wand) > Sentenced | contested | 100 / 28.5 | **0 / 0.0** |
| Axe | Fire(axe) > Sentenced | neutral | 100 / 49.8 | 100 / 69.9 |
| | Sentenced > Plague(bow) | contested | 100 / 59.0 | 100 / 52.1 |
| | Sentenced > Frost(shield) | both | 100 / 50.2 | 100 / 50.2 |
| | Holy(wand) > Sentenced | contested | 100 / 26.1 | **78 / 0.0** |
| **Bow (current)** | Fire(axe) > Sentenced | contested | 100 / 57.0 | 100 / 42.8 |
| | Sentenced > Plague(bow) | neutral | 100 / 60.8 | 100 / 60.8 |
| | Sentenced > Frost(shield) | contested | 100 / 50.2 | 100 / 47.4 |
| | Holy(wand) > Sentenced | both | 100 / 22.5 | 100 / 24.7 |

The wand and the shield (not tabled above) give three "both" openings and one neutral (6 of 10 contested in the game). Trades, worst HP: wand 62.7, 60.8, 50.2 and 22.5%; shield 62.4, 58.8, 50.2 and 28.5%. Policy: wand 50.8, 70.8, 50.2 and 22.6%; shield 77.3, 76.6, 100.0 and 31.4%. The sword would make 10 of 10 openings contested on paper; the axe and the bow leave 8 of 10.

**Decision (a best guess, logged for the owner to overrule): keep Sentenced on the bow.** The decision stands, and the case is clearer with the final numbers.

- **The sword is contested everywhere and still wrong.** In the real sim Sword > Wand decides Holy > Sentenced outright: the sword closes the 220 u gap and staggers the wand's casts, and Holy wins 0 of 18 setups, with or without the stagger rule. The weapon edge overrides the faction edge, so the opening would be settled on the pick screen. `realtime.py` has no stagger and says 28.5%.
- **The axe fails the opening 22% of the time** in the real sim (Holy wins 14 of 18 setups). It also un-contests two other Sentenced openings (Fire vs Sentenced becomes an axe mirror; Sentenced vs Frost becomes Axe > Shield, which favours Sentenced on both loops), so the game stays at 8 of 10 contested with nothing gained.
- **The bow holds all four openings** in both modes (worst 22.5% in trades mode and 24.7% in policy mode, both Holy > Sentenced) and keeps 8 of 10 contested. The wand and the shield also hold but give up the contest.
- **The owner's original reason still holds.** Keep Holy vs Sentenced healthy, favouring Holy on both loops on purpose (Wand > Bow). 9.1's model-only reading (sword 29.4% against bow 23.6%) is right in the stat model and does not survive the real sim.

To retry another weapon, set `SIGNATURE_WEAPONS.sentenced` (`packages/shared/src/weapons.ts`) and run both harness commands of section 10.

## 8. For the owner

Decisions and notes. Nothing here was retuned.

1. **Same-faction weapon edges flip with signatures on.** Weapon duels between two fighters of the same faction, with signatures on instead of off (win % of the weapon edge's designed winner, from the final review; not re-run here):
   - Fire mirror: Sword > Axe 100 to 0, Sword > Wand 100 to 11, Axe > Wand 56 to 0, Bow > Axe 56 to 89.
   - Sentenced mirror: Sword > Axe, Sword > Wand and Axe > Wand 100 to 0; Shield > Bow 100 to 11.
   - Frost mirror: Axe > Wand 100 to 33.
   
   Sentenced's damage is almost all the mark times the weapon's dpsMult, so its hit-based weapon edges collapse to the multiplier; and a Fire sword's staggers cancel axe windups, so the axe swings less and takes less backlash. The weapon loop was tuned with signatures off (the weapon harness default); whether same-faction fights should respect it with signatures on is the owner's call.
2. **Backlash per minimum-draw bow tap.** Fire's backlash is charged per swing, and a bow tapped at minimum draw swings more often than its interval: about 2.1 times the designed backlash per second against a tapping bow, which also deals only 0.84 times the designed damage (from the final review; not re-run here).
3. **Lifesteal counts the whole hit.** Holy heals from the full damage of a hit even on a killing blow (overkill) and from hits on training dummies, which refill. This is kept for parity with `realtime.py`, which counts it the same way. It matters for Phase 11 mobs: Holy would heal from damage beyond a mob's remaining HP, and from a mob that refills.
4. **The shield mirror stalemate.** Two shields block every bash, so the four shield mirrors and Plague(bow) > Frost(shield) end on damage over time alone or on reflected arrows (section 6). The second weapon slot is the answer the design gives; no number was changed.
5. **Holy > Sentenced is thin where Sentenced holds a sword.** The sword mirror keeps 3.8% in the worst case, so any buff on Sentenced flips it (x1.30 HP, section 5.4). A stronger lifesteal is not the lever (section 2.3).
6. **Sentenced's weapon** stays on the bow (section 7).

## 9. Not re-run

The 20 Hz tables of `COUNTER_REVIEW.md` other than those in section 5 were not re-run: the kiting tables other than the pass/fail check of `test_kite.py` (including rule B's free-fire ceilings, where the wand ceiling of 0.86 was set by Holy(shield) > Sentenced and should have risen), the heal-item and disengage runs, the v2-plan subsection and the move-speed caps. With the v3 lifesteal restored its Holy figures are current for the faction numbers; its weapon table is the pre-9.1 one except where 9.1 annotated it. The real-sim stall run (2.3) and the figures of section 8 items 1 and 2 are from the final review. The weapon tuning of Phase 9.1 itself is unchanged.

## 10. Reproduce

```
python3 testing/test_rpsls.py                                      # design oracle, identity table (ALL PASS)
python3 testing/realtime_report.py engine                           # engine table
python3 testing/realtime_report.py buff                             # buff caps of 5.4 (about 15 s, needs numpy)
python3 testing/realtime_report.py gap                              # longest stretch with no swing
python3 testing/test_kite.py                                        # kiting check (k = 2, a few seconds)
npm run harness:factions -w @raid/server -- --python               # trades mode against realtime.py (~5 s, needs python3 with numpy)
npm run harness:factions -w @raid/server -- --mode policy          # policy mode (about 20 s)
```

The stacked buffs, mixed-weapon, Holy(wand) > Sentenced and flip-distance figures are ad hoc scripts over `realtime.duel` and `engine.duel` using the definitions in `CLASS_SHEET.md` section 7 and `COUNTER_REVIEW.md` sections 3 and 5. The Holy-against-Holy table of 2.3 is `engine.duel(holy, holy_with_hit_x_m, t_max=600)` with Holy's `ls1` and `ls_cap` as listed. The weapon study of section 7 is `runCell` and `cellStats` from `packages/server/src/harness/factionCycle.ts` over the four openings and five Sentenced weapons, in trades mode (nmax 12) and policy mode. To see the retune again, set `ls1` 1.75 and `ls_cap` 1.5 for Holy in `testing/classes.py` and `packages/shared/src/factions.ts`.

## Appendix A. The reverted lifesteal retune: its result tables

Superseded: these are the numbers with `ls1` 1.75 and `ls_cap` 1.5, kept as a record. The "v3" column is the final state. Sections A.1 to A.3 and A.5 are k = 1 engine and 20 Hz figures; A.4 is the real sim on the 9.1 weapons.

### A.1 Design engine (`engine.py`, dt 0.002)

Winner, fight length, winner HP left. Only the four edges that involve Holy moved.

| Edge | v3 (final) | Retune |
|---|---|---|
| Plague > Holy | 15.8 s, 67% | 16.7 s, 66% |
| Frost > Holy | 52.3 s, 63% | 61.5 s, 57% |
| Holy > Fire | 8.1 s, 69% | 8.1 s, 72% |
| Holy > Sentenced | 22.7 s, 27% | 22.7 s, 34% |

The other six edges were unchanged. Frost > Holy paid most: 6 points and 9 s.

### A.2 Identity table (`test_rpsls.py`), the four rows that moved

| Power | Remove | v3 (final) | Retune |
|---|---|---|---|
| Plague | The flat disease (sub) | flips Plague > Frost, 114 | flips Plague > Frost and Plague > Holy, 114 |
| Frost | The slow (main) | flips Frost > Holy, 103 | flips Frost > Holy, 108 |
| Holy | Lifesteal (main) | flips Holy > Sentenced, 30 | flips Holy > Sentenced, 37 |
| Holy | Flat lifesteal, no missing-HP scaling (sub) | flips none, 19 | flips none, 26 |

### A.3 Sensitivity and flip distances (engine, dt 0.002 unless noted)

Slider table of `CLASS_SHEET.md` section 7 (each knob +-25%, points of the winner's HP): changed rows only.

| Knob | v3 (final) | Retune |
|---|---|---|
| Frost slow | Frost > Holy 22, Plague > Frost 6 | Frost > Holy 38, Plague > Frost 6 |
| Holy shield | Holy > Sentenced 20, Holy > Fire 8 | Holy > Sentenced 17, Holy > Fire 8 |
| Sentenced `mark_cap` | Holy > Sentenced 18, Sentenced > Frost 10 | Holy > Sentenced 16, Sentenced > Frost 10 |
| Plague `plague` | Plague > Frost 12, Sentenced > Plague 6 | Plague > Frost 12, Plague > Holy 6 |
| Plague armor | Plague > Frost 9, Plague > Holy 8 | Plague > Holy 9, Plague > Frost 9 |
| Holy `ls1` | Holy > Sentenced 4, Holy > Fire 2 | Holy > Sentenced 5, Frost > Holy 3 |
| Holy `ls_cap` | Holy > Sentenced 4, Frost > Holy 2 | Frost > Holy 4, Holy > Sentenced 2 |

With the retune, no single +-25% change to any knob or core stat flipped an edge (v3: Holy's hit or attack rate at -25% flips Holy > Sentenced). Frost > Holy was the long fight: Frost's slow at -25% still won but took 83.5 s with 19% left, and Frost's hit or attack rate at -25% won in 106.8 s, close to the engine's 120 s cap.

Distance to a flip, Holy > Sentenced:

| Change that flips it | v3 (final) | Retune |
|---|---|---|
| Holy hit or attack rate falls by | 20.0% (hit 65 to 52) | 26.5% (hit 65 to 48) |
| Sentenced's total damage rises by | x1.29 | x1.42 |
| Sentenced's HP rises by | x1.35 | x1.64 |
| Holy shield falls by | 31.7% (250 to 171) | 41.1% (250 to 147) |
| Sentenced `mark_cap` rises to | 385 | 434 |

Distance to a flip, Frost > Holy (the engine's 120 s cap counts a fight that is not over as no win; the second figure lets the fight run to the end):

| Change that flips it | v3 (final) | Retune |
|---|---|---|
| Frost hit or attack rate falls by | 40.7% (passes 120 s); Holy wins at 45.4% | 28.6% (hit 90 to 64); Holy wins at 32.9% |
| Holy HP rises by | x2.29 (passes 120 s); Holy wins at x2.71 | x1.95 (passes 120 s); Holy wins at x2.30 |
| Frost's slow falls from 0.60 to | 0.27 | 0.40 |
| Holy's total damage rises by (120 s cap) | x1.83 | x1.49 |

### A.4 Policy mode (real sim, k = 2, 18 setups per cell)

Measured on a preview merge with the 9.1 weapon numbers and no stagger rule. Designed winner's worst HP %, same weapon on both sides, v3 to retune:

| Edge | sword | axe | bow | wand | Signature opening |
|---|---|---|---|---|---|
| Holy > Sentenced | 0 (0% win) to **6.9** | 28.6 to 36.2 | 23.6 to 32.2 | 22.6 to 31.8 | 24.7 to 33.4 (wand/bow) |
| Plague > Holy | 80.3 to 80.3 | 67.8 to 65.3 | 66.2 to 64.4 | 64.3 to 62.2 | 43.3 to 37.0 (bow/wand) |
| Frost > Holy | 63.7 to 54.7 | 61.8 to 57.6 | 61.9 to 55.8 | 60.4 to 55.0 | 56.8 to 49.6 (shield/wand) |
| Holy > Fire | 68.0 to 70.7 | 69.8 to 72.2 | 69.8 to 72.8 | 68.7 to 71.8 | 62.7 to 65.5 (wand/axe) |

The axe column was measured with the axe at 0.8. Every other cell was unchanged. In trades mode (pre-9.1 table) the retune raised the lowest mirror cell, Holy > Sentenced, from 22.8% (bow) to 31.7%; the final lowest, with 9.1, is 22.5% (wand).

### A.5 20 Hz model, k = 1

- **Mixed weapons.** On the pre-9.1 table the retune turned two failing pairs into wins: Holy's bow against a Sentenced sword (27% of phase pairs before) and Holy's shield against it (0%) both won 100% (worst HP 11.0% and 3.4%). 9.1's weapon cuts fixed them without the retune; in the final state all 25 pairs of all ten edges win.
- **Buff caps**, v3 to retune (pre-9.1 weapons): Holy > Sentenced HP x1.31 to x1.59; Frost > Holy HP x2.28 to x1.86 and attack speed x1.63 to **x1.32**; Plague > Holy HP x2.84 to x2.69, attack speed x2.09 to x1.88; Holy > Fire HP x5.09 to never, attack speed x6.25 to x6.94. After merging 9.1 the retune's softest edges were x1.58 HP (Holy > Sentenced) and x1.41 attack speed (Frost > Holy, signature opening).
- **Side effect: Frost > Holy got softer against buffs.** Holy's swings are both its damage and its healing, so a stronger lifesteal made an attack-speed buff worth more to it, while Frost's slow still takes 60% of the swings. Stacked buffs, cells under 60% wins, before 9.1's final cuts: at 1.2 / 1.3 and at 1.3 / 1.2 the Frost > Holy signature opening (Holy wand, Frost shield) won 0%; v3 held every edge at 1.2 / 1.3. Frost(shield) > Holy(sword) took a median of 106 s at k = 1 and 52 s at k = 2 (79 s and 40 s in v3). After merging 9.1 the wand's cut from 0.85 to 0.8 repaired the stacked cells but not the x1.41 attack-speed cap.
