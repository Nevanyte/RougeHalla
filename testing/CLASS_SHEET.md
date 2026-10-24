# RPSLS Combat System: Design Sheet

Five powers, one rulebook, zero matchup rules. Every counter below comes from the same six laws applied to different numbers, and every signature mechanic is *felt*: remove it and matchups visibly flip. All values sit on a design grid (HP in 50s, rates in 0.05s, damage in 5s, armor/shield in 25s, damage shares in 10%s).

**Revision note (v3).** Fire and Frost now attack faster with lighter hits: Fire 0.3 to 0.6/s at 150 damage (was 305, base DPS 92 to 90), Frost 0.3 to 0.45/s at 90 damage (was 135, DPS unchanged), and Fire's backlash drops from 210 to 200. Sentenced, Plague and Holy, and every HP, share, armor and shield number, are unchanged, so the laws (section 1) and the multiplier matrix (section 5) do not move. Weapons are a % boost on these base rates (see docs/GAME_DESIGN.md section 10). The cost: Frost's faster swings feed Fire's backlash, so Frost over Fire is closer (winner keeps 49%, was 59%). It still does not flip.

**Revision note (Phase 10 retune).** Holy's lifesteal is stronger: `ls1` 1.25 to 1.75 and `ls_cap` 1.0 to 1.5, so it heals `0.25 + 1.75 x missing health` of the damage it deals, capped at 150%. In the real-time game a Sentenced sword hit staggers Holy and cancels its windup, which costs Holy about a fifth of its damage and the lifesteal on it, while the mark is untouched; Holy over Sentenced, the tightest edge, lost a policy-mode duel it wins in the engine. No other number changed, so the laws (section 1) and the multiplier matrix (section 5) do not move. Four edges move: Plague over Holy 67% to 66%, Frost over Holy 63% to 57%, Holy over Fire 69% to 72%, Holy over Sentenced 27% to 34%. The log, with every lever tried and the before and after tables, is `testing/TUNING_10.md`. Where this sheet still quotes a v3 figure it says so.

## 1. The rulebook (applies identically to every fight)

1. **Attack:** each second a fighter deals `rate x hit` raw damage plus its signature bonus.
2. **Three damage shares:** every packet is split into *physical*, *magic* and *true*. Shares are a property of the attacker.
3. **Defense:** *armor* cuts the physical share, *shield* cuts the magic share, *true* ignores both. Reduction is `1 / (1 + stat/100)`, so 100 = half damage and 300 = quarter damage.
4. **Rate effects:** one aura exists (Frost's slow). It multiplies any opponent's attack rate. Only `rate x hit` is slowed; flat bonuses (burn, disease, mark) are not.
5. **Health effects:** mechanics may read health fractions (the target's for execute, one's own for lifesteal). Never an opponent's identity.
6. **Time effects:** a mechanic may read elapsed time (the mark ramp). Nothing else.

A signature mechanic is a function of *(own parameters, universal state)* and nothing else. The engine contains no power names and no pair logic, and the test suite audits that.

## 2. Stat sheet

| Power | Role | HP | Attack rate | Hit | Base DPS | Damage mix (phys / magic / true) | Armor | Shield |
|---|---|---|---|---|---|---|---|---|
| Fire | Glass-cannon duelist | 500 (Very low) | 0.6/s (Low) | 150 | 90 (Very high) | 0% / 100% / 0% | 0 | 125 |
| Sentenced | Patient executioner | 700 (Low) | 0.9/s (Mid) | 5 | 4 (Very low) | 0% / 100% / 0% | 100 | 50 |
| Plague | Attrition swarm | 1000 (Mid) | 1.85/s (Very high) | 20 | 37 (Low) | 80% / 20% / 0% | 200 | 0 |
| Frost | Control bruiser | 1750 (Very high) | 0.45/s (Very low) | 90 | 40 (Mid) | 90% / 10% / 0% | 100 | 100 |
| Holy | Sustain juggernaut | 1450 (High) | 0.95/s (High) | 65 | 62 (High) | 100% / 0% / 0% | 0 | 250 |

## 3. Class cards

Each card says what the class does, how it feels in a fight, and the **identity test**: what happens to its matchups if the signature is taken away.

### Fire: Glass-cannon duelist  
*Dragonslayer, living fire*

- **Signature (Dragonslayer):** 10 burn per second plus 200 bonus damage per second for every attack the *target* makes per second.
- **Identity:** one heavy swing (150 damage) every 1.7 seconds, the lowest HP (500), no armor, 100% magic damage.
- **Feel:** a duel against a fast attacker is over almost at once. Against Plague (1.85 attacks/s) the backlash adds about 370 damage per second, so Fire wins in 2.1s with 71% HP left; against Sentenced it wins in 3.7s, before the mark (7.9s to full strength) has built.
- **Loses to** targets that attack rarely or shrug off magic. Frost's 0.45 attacks/s feeds the backlash only about 90 per second while its slow cuts Fire's own swings from 0.6 to 0.24 per second. Holy's 250 shield cuts all of Fire's magic damage to 29%.
- **Identity test:** without burn and backlash Fire loses Fire > Sentenced, Fire > Plague; the biggest margin shifts by 131 points.

### Sentenced: Patient executioner  
*Marked for judgment*

- **Signature (Marked):** bonus damage that ramps 35 per second for every second spent in the fight, capped at 275 per second (7.9s to full). It depends on time, not attack count, so slows cannot suppress it.
- **Identity:** its attacks barely matter (5 damage); nearly all output is the mark. 100% magic damage, 700 HP, light defenses (100 armor, 50 shield).
- **Feel:** a fight that gets worse for the opponent every second. It beats Plague in 7.4s (the mark lands at 100% on a target with no shield while Plague's physical damage is cut to 53%) and Frost in 16.6s.
- **Loses to** burst and shield. Fire ends it in 3.7s, before the mark builds, and Holy's 250 shield cuts the mark to 29%.
- **Identity test:** without the mark Sentenced loses Sentenced > Plague, Sentenced > Frost. If the mark arrived at full strength with no ramp, margins would still shift by 70 points, so the build-up itself is felt.

### Plague: Attrition swarm  
*Rat King, disease*

- **Signature (Rat King):** 40 disease damage per second, plus an execute that adds up to 1025 per second as the target's health falls from 50% to 0 (zero above half health).
- **Identity:** many small attacks (1.85/s at 20 damage), 1000 HP, heavy armor (200), no shield, 80% physical and 20% magic damage.
- **Feel:** a slow squeeze that turns into a collapse. It beats Frost in 37.0s, a fight the execute decides (see the identity test), and Holy in 16.7s, where Holy's lack of armor lets 86% of its damage through.
- **Loses to** burst and magic. Fire kills it in 2.1s and finishes with 71% of its HP, so Fire never falls under 50% and the execute never opens; Sentenced's mark lands at 100% on a target with no shield.
- **Identity test:** without the execute Plague loses Plague > Frost (margins shift by 43 points). Without the flat disease it loses Plague > Frost and Plague > Holy (the second since the Phase 10 retune; Holy now heals more of what it takes). Both halves of the signature carry weight.

### Frost: Control bruiser  
*Living wall of ice*

- **Signature (Living Wall of Ice):** while fighting, the opponent's attack rate is multiplied by 0.4 (a 60% slow), whoever they are.
- **Identity:** the tankiest power (1750 HP) with slow, heavy swings (0.45/s at 90 damage), balanced defenses (100 armor, 100 shield), 90% physical damage.
- **Feel:** the fight slows down and Frost sets the pace. It beats Fire in 13.1s with 49% HP left and Holy in 61.5s with 57% left, the longest fight in the system.
- **Loses to** damage that ignores attack rate. Sentenced's mark and most of Plague's damage (disease and execute) are flat, so slowing them achieves little, and their armor and shield cut Frost's hits to about 52% and 40%.
- **Identity test:** without the slow Frost loses Frost > Holy; the biggest margin shifts by 108 points.

### Holy: Sustain juggernaut  
*Light that burns brighter near death*

- **Signature (Radiant):** heals a fraction of damage dealt equal to `0.25 + 1.75 x missing health`, capped at 150%. At full health it heals 25% of what it deals; by the time it is 43% down it heals everything it deals, and from 71% down it heals one and a half times what it deals.
- **Identity:** 1450 HP behind a 250 shield with no armor, steady attacks (0.95/s at 65 damage), 100% physical damage.
- **Feel:** hard to finish. Magic barely scratches it (Fire and Sentenced land at 29%), and a long fight against a persistent damage source swings back in its favor as it gets low. It beats Fire in 8.1s and Sentenced in 22.7s, the second finishing with 34% HP left: the closest edge, and the one lifesteal decides.
- **Loses to** damage that finds its weak side and to slows. Plague's damage lands at 86% against its zero armor, and Frost's slow cuts Holy's swings, and with them its healing, from 0.95 to 0.38 per second.
- **Identity test:** without lifesteal Holy loses Holy > Sentenced (margins shift by 37 points). With flat lifesteal and no missing-health scaling, margins shift by 26 points: the scaling is felt, but it is the smaller half.

## 4. Identity test (what happens if the signature is removed)

Rule: a *main* signature must flip at least one of the owner's four required edges and move a margin by 20 points or more; a *sub*-mechanic must flip an edge or move a margin by 15 points or more. Margin = winner's remaining HP fraction minus loser's, so it runs from -100 to +100 points; a swing above 100 means the result reversed. All nine rows pass, and the same check runs in `test_rpsls.py`.

| Power | Remove | Edges that flip | Largest margin shift |
|---|---|---|---|
| Fire | Remove burn and backlash | Fire > Sentenced, Fire > Plague | 131 points |
| Fire | Remove backlash only (sub) | Fire > Sentenced, Fire > Plague | 127 points |
| Sentenced | Remove the mark | Sentenced > Plague, Sentenced > Frost | 152 points |
| Sentenced | Mark appears at full strength (no ramp) (sub) | none | 70 points |
| Plague | Remove the execute | Plague > Frost | 43 points |
| Plague | Remove the flat disease (sub) | Plague > Frost, Plague > Holy | 114 points |
| Frost | Remove the slow | Frost > Holy | 108 points |
| Holy | Remove lifesteal | Holy > Sentenced | 37 points |
| Holy | Flat lifesteal (no missing-health scaling) (sub) | none | 26 points |

## 5. Emergent damage multipliers (how much of a packet survives)

Row attacks column. This is the *whole* interaction layer: no table is stored, it falls out of attacker shares and defender armor/shield.

| attacker \ defender | Fire | Sentenced | Plague | Frost | Holy |
|---|---|---|---|---|---|
| **Fire** | - | 0.67 | 1.00 | 0.50 | 0.29 |
| **Sentenced** | 0.44 | - | 1.00 | 0.50 | 0.29 |
| **Plague** | 0.89 | 0.53 | - | 0.50 | 0.86 |
| **Frost** | 0.94 | 0.52 | 0.40 | - | 0.93 |
| **Holy** | 1.00 | 0.50 | 0.33 | 0.50 | - |

## 6. Matchup results (verified by simulation)

| Winner | Loser | Fight length | Winner HP left |
|---|---|---|---|
| Fire | Sentenced | 3.7s | 77% |
| Fire | Plague | 2.1s | 71% |
| Sentenced | Plague | 7.4s | 56% |
| Sentenced | Frost | 16.6s | 51% |
| Plague | Frost | 37.0s | 40% |
| Plague | Holy | 16.7s | 66% |
| Frost | Holy | 61.5s | 57% |
| Frost | Fire | 13.1s | 49% |
| Holy | Fire | 8.1s | 72% |
| Holy | Sentenced | 22.7s | 34% |

Tightest edge: Holy over Sentenced, winner keeps 34%. Longest fight: Frost over Holy, 62s. Every winner finishes with at least a third of its health. (v3, before the Phase 10 retune: 27%, 52s, a quarter.)

## 7. Scaling and tuning

**Power level.** `scaled(spec, k)` multiplies HP and every point-damage number by `k`; ratios (rates, shares, armor, shield, slow, lifesteal) are untouched. The graph is invariant under `k`, tested from 0.25x to 20x.

**Tuning knobs.** Measured, not guessed: each knob was moved +-25% and the change in the winner's remaining HP was recorded (points of winner HP; one point = 1% of its max HP).
No single +-25% change to any knob in this table, or to any core stat (HP, rate, hit, armor, shield), flips an edge, so the design has slack. Two cases are close: Holy's hit or attack rate at -25% keeps Holy > Sentenced with 3% HP left (it flipped before the Phase 10 retune; the edge now flips at -26.5%), and Frost's hit or attack rate at -25% keeps Frost > Holy but the fight takes 107s, near the engine's 120s limit.

| Knob | Moves most | Points (per +-25%) |
|---|---|---|
| Frost slow | Frost > Holy, Plague > Frost | 38, 6 |
| Holy shield | Holy > Sentenced, Holy > Fire | 17, 8 |
| Sentenced mark_cap | Holy > Sentenced, Sentenced > Frost | 16, 10 |
| Plague plague | Plague > Frost, Plague > Holy | 12, 6 |
| Fire backlash | Fire > Sentenced, Frost > Fire | 9, 8 |
| Plague armor | Plague > Holy, Plague > Frost | 9, 9 |
| Sentenced mark_ramp | Sentenced > Plague, Fire > Sentenced | 7, 5 |
| Holy ls1 | Holy > Sentenced, Frost > Holy | 5, 3 |
| Holy ls_cap | Frost > Holy, Holy > Sentenced | 4, 2 |
| Plague execute | Plague > Frost, Plague > Holy | 2, 1 |
| Holy ls0 | Holy > Sentenced, Holy > Fire | 2, 2 |
| Fire burn | Frost > Fire, Fire > Sentenced | 1, 0 |
| Fire rate (same DPS) | none | 0 |
| Frost rate (same DPS) | Frost > Fire | 8 |

The last two rows move a power's attack rate by +-25% and its hit the opposite way, so damage per second stays fixed. Fire's own cadence moves nothing, because only `rate x hit` counts for Fire and no other power's mechanic reads Fire's rate; Frost's cadence moves one edge, Frost over Fire, by 8 points, because a faster Frost feeds Fire's backlash.

A knob with a small slider effect can still be decisive as a threshold. Holy's lifesteal numbers and Plague's execute move margins only a few points when nudged, yet removing lifesteal flips Holy over Sentenced and removing the execute flips Plague over Frost (section 4). Use the identity test, not the slider table, to judge whether a signature still matters.

**Known soft spot.** Fire's burn (10 per second) is nearly cosmetic: its backlash does the work, and removing backlash alone flips both of Fire's wins. If you want burn to matter, raise it and retune; the identity test will tell you when it has an effect.

Largest structural lever: the damage shares and armor/shield values, because they set the whole multiplier matrix in section 5.

**Adding a sixth power.** Give it a spec on the same grid and one mechanic that reads only universal state. It will interact with all five through the same laws, but the graph will no longer be a clean five-cycle; expect to retune shares and defenses, and check with `test_rpsls.py`.

## 8. Verification

`python3 test_rpsls.py` runs: the exact 10-edge graph at dt = 0.01, 0.005, 0.002, 0.001; each power beats exactly two; invariance under power scaling (0.25x to 20x); invariance under renaming and reordering powers; robustness to random jitter on every numeric field (+-5% and +-10%); an AST audit that the engine names no power and compares no names; and the nine identity tests from section 4.

**Limits.** These results cover 1v1 duels at equal level in the continuous simulator (`engine.py`); group fights, items, cooldowns and level mismatches are not modeled there. Weapons and attack cadence are checked separately by the 20 Hz weapon-duel harness (`python3 realtime_report.py`, needs numpy; see docs/GAME_DESIGN.md section 17), which sweeps every first-swing timing and HP and attack-speed buffs. Group fights are not modeled anywhere. Fight lengths are long in places (Frost over Holy, Plague over Frost), which suits an attrition-style game but may want a damage or HP pass if you want faster duels.
