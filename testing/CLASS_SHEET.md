# RPSLS Combat System: Design Sheet

Five powers, one rulebook, zero matchup rules. Every counter below comes from the same six laws applied to different numbers, and every signature mechanic is *felt*: remove it and matchups visibly flip. Rates and damage shares sit on the original design grid (rates in 0.05s, shares in 10%s); since the balance pass the HP, hit, armor, shield and signature numbers do not (see the next note).

**Revision note (balance pass).** The sheet below is the compressed one of docs/ and testing/TUNING_BALANCE.md (BALANCE_CONTRACT 5.2). The old sheet was a clean five-cycle in which the favourite won every duel with 27-77% of its health left (the loser's time-to-kill ratio r ran 1.35 to 6.1); a favourite that always wins is not a matchup, it is a wall. The numbers were moved, by search over the whole sheet and checked in the real sim, so that every edge leaves its winner **10-35% hp** (r 1.12-1.54) and wins **60-70% of even duels once play noise is in** (each fighter's damage times exp(0.45 Z): P(favourite) = Phi(ln r / 0.636)). The laws (section 1) and the matrix shape do not change; the signature **damage types** do (decision D6): burn and disease are magic, Fire's backlash physical, the mark true, whatever the faction's own shares are (`engine.PowerSpec.sig_types`). The identity test still holds (section 4: the recorded numbers are the new sheet's). The tables in sections 4, 5 and 6 are regenerated; the class cards in section 3 describe the identities, which are unchanged.

**Revision note (v3).** Fire and Frost now attack faster with lighter hits: Fire 0.3 to 0.6/s at 150 damage (was 305, base DPS 92 to 90), Frost 0.3 to 0.45/s at 90 damage (was 135, DPS unchanged), and Fire's backlash drops from 210 to 200. Sentenced, Plague and Holy, and every HP, share, armor and shield number, are unchanged, so the laws (section 1) and the multiplier matrix (section 5) do not move. Weapons are a % boost on these base rates (see docs/GAME_DESIGN.md section 10). The cost: Frost's faster swings feed Fire's backlash, so Frost over Fire is closer (winner keeps 49%, was 59%). It still does not flip.

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
| Fire | Glass-cannon duelist | 835 (Mid) | 0.6/s (Low) | 100 | 60 (High) | 0% / 100% / 0% | 0 | 45 |
| Sentenced | Patient executioner | 800 (Mid) | 0.9/s (Mid) | 10 | 9 (Very low) | 0% / 100% / 0% | 125 | 210 |
| Plague | Attrition swarm | 1375 (High) | 1.85/s (Very high) | 20 | 37 (Low) | 80% / 20% / 0% | 190 | 0 |
| Frost | Control bruiser | 1200 (Mid) | 0.45/s (Very low) | 175 | 79 (High) | 90% / 10% / 0% | 20 | 190 |
| Holy | Sustain juggernaut | 1400 (High) | 0.95/s (High) | 96 | 91 (Very high) | 100% / 0% / 0% | 0 | 250 |

Signature numbers (raw per second unless noted; paced x2, the mark ramp x4): Fire burn 18 (magic), backlash 145 (physical, per second of the foe's attack rate); Sentenced mark ramp 17.5/s up to a cap of 72 (true; full in 4.1 s, 2.1 s paced); Plague disease 43 (magic) plus an execute of 415 below half hp; Frost slow 0.52 (attack rate x0.48; move x0.7 inside 100 u); Holy lifesteal 10% + 80% of its missing health, capped at 75%.

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
- **Feel:** a slow squeeze that turns into a collapse. It beats Frost in 37.0s, a fight the execute decides (see the identity test), and Holy in 15.8s, where Holy's lack of armor lets 86% of its damage through.
- **Loses to** burst and magic. Fire kills it in 2.1s and finishes with 71% of its HP, so Fire never falls under 50% and the execute never opens; Sentenced's mark lands at 100% on a target with no shield.
- **Identity test:** without the execute Plague loses Plague > Frost (margins shift by 43 points). Without the flat disease it loses Plague > Frost. Both halves of the signature carry weight.

### Frost: Control bruiser  
*Living wall of ice*

- **Signature (Living Wall of Ice):** while fighting, the opponent's attack rate is multiplied by 0.4 (a 60% slow), whoever they are.
- **Identity:** the tankiest power (1750 HP) with slow, heavy swings (0.45/s at 90 damage), balanced defenses (100 armor, 100 shield), 90% physical damage.
- **Feel:** the fight slows down and Frost sets the pace. It beats Fire in 13.1s with 49% HP left and Holy in 52.3s with 63% left, the longest fight in the system.
- **Loses to** damage that ignores attack rate. Sentenced's mark and most of Plague's damage (disease and execute) are flat, so slowing them achieves little, and their armor and shield cut Frost's hits to about 52% and 40%.
- **Identity test:** without the slow Frost loses Frost > Holy; the biggest margin shifts by 103 points.

### Holy: Sustain juggernaut  
*Light that burns brighter near death*

- **Signature (Radiant):** heals a fraction of damage dealt equal to `0.25 + 1.25 x missing health`, capped at 100%. At full health it heals 25% of what it deals; by the time it is 60% down it heals everything it deals.
- **Identity:** 1450 HP behind a 250 shield with no armor, steady attacks (0.95/s at 65 damage), 100% physical damage.
- **Feel:** hard to finish. Magic barely scratches it (Fire and Sentenced land at 29%), and a long fight against a persistent damage source swings back in its favor as it gets low. It beats Fire in 8.1s and Sentenced in 22.7s, the second finishing with only 27% HP left: the closest edge, and the one lifesteal decides.
- **Loses to** damage that finds its weak side and to slows. Plague's damage lands at 86% against its zero armor, and Frost's slow cuts Holy's swings, and with them its healing, from 0.95 to 0.38 per second.
- **Identity test:** without lifesteal Holy loses Holy > Sentenced (margins shift by 30 points). With flat lifesteal and no missing-health scaling, margins shift by 19 points: the scaling is felt, but it is the smaller half.

## 4. Identity test (what happens if the signature is removed)

Rule: a *main* signature must flip at least one of the owner's four required edges and move a margin by 20 points or more; a *sub*-mechanic must flip an edge or move a margin by 15 points or more. Margin = winner's remaining HP fraction minus loser's, so it runs from -100 to +100 points; a swing above 100 means the result reversed. All nine rows pass, and the same check runs in `test_rpsls.py`.

| Power | Remove | Edges that flip | Largest margin shift |
|---|---|---|---|
| Fire | Remove burn and backlash | Fire > Sentenced, Fire > Plague | 97 points |
| Fire | Remove backlash only (sub) | Fire > Sentenced, Fire > Plague | 88 points |
| Sentenced | Remove the mark | Sentenced > Plague, Sentenced > Frost | 119 points |
| Sentenced | Mark appears at full strength (no ramp) (sub) | none | 17.7 points |
| Plague | Remove the execute | Plague > Frost, Plague > Holy | 31 points |
| Plague | Remove the flat disease (sub) | Plague > Frost, Plague > Holy | 78 points |
| Frost | Remove the slow | Frost > Holy | 68 points |
| Holy | Remove lifesteal | Holy > Fire | 26 points |
| Holy | Flat lifesteal (no missing-health scaling) (sub) | none | 20.2 points |

## 5. Emergent damage multipliers (how much of a packet survives)

Row attacks column. This is the *whole* interaction layer: no table is stored, it falls out of attacker shares and defender armor/shield.

| attacker \ defender | Fire | Sentenced | Plague | Frost | Holy |
|---|---|---|---|---|---|
| **Fire** | - | 0.32 | 1.00 | 0.34 | 0.29 |
| **Sentenced** | 0.69 | - | 1.00 | 0.34 | 0.29 |
| **Plague** | 0.94 | 0.42 | - | 0.74 | 0.86 |
| **Frost** | 0.97 | 0.43 | 0.41 | - | 0.93 |
| **Holy** | 1.00 | 0.44 | 0.34 | 0.83 | - |

(Weapon hits, by the attacker's own shares. A signature part uses its own type: burn and disease are magic, the backlash physical, the mark true: the column of the defender's shield, armor or neither.)

## 6. Matchup results (verified by simulation)

| Winner | Loser | Fight length | Winner HP left |
|---|---|---|---|
| Fire | Sentenced | 9.6s | 28% |
| Fire | Plague | 8.1s | 34% |
| Sentenced | Plague | 18.8s | 19% |
| Sentenced | Frost | 18.3s | 22% |
| Plague | Frost | 32.2s | 24% |
| Plague | Holy | 35.0s | 20% |
| Frost | Holy | 25.8s | 22% |
| Frost | Fire | 10.9s | 36% |
| Holy | Fire | 9.2s | 22% |
| Holy | Sentenced | 19.7s | 27% |

Closest edge: Sentenced over Plague, winner keeps 19%. Widest: Frost over Fire, 36%. Longest fight: Plague over Holy, 35s (k = 1, the sheet's own pace; the game fights at k = 2, half as long). Every winner finishes with 19-36% of its health: `python3 testing/matchup_band.py` prints the band.

## 7. Scaling and tuning

**Power level.** `scaled(spec, k)` multiplies HP and every point-damage number by `k`; ratios (rates, shares, armor, shield, slow, lifesteal) are untouched. The graph is invariant under `k`, tested from 0.25x to 20x.

**Tuning knobs.** (Measured on the pre-balance-pass sheet; the order of magnitude holds, the exact points do not.) Measured, not guessed: each knob was moved +-25% and the change in the winner's remaining HP was recorded (points of winner HP; one point = 1% of its max HP).
No single +-25% change to any knob in this table flips an edge, so the design has slack. The core stats have one exception: Holy's hit or attack rate at -25% flips Holy > Sentenced.

| Knob | Moves most | Points (per +-25%) |
|---|---|---|
| Frost slow | Frost > Holy, Plague > Frost | 22, 6 |
| Holy shield | Holy > Sentenced, Holy > Fire | 20, 8 |
| Sentenced mark_cap | Holy > Sentenced, Sentenced > Frost | 18, 10 |
| Plague plague | Plague > Frost, Sentenced > Plague | 12, 6 |
| Fire backlash | Fire > Sentenced, Frost > Fire | 9, 8 |
| Plague armor | Plague > Frost, Plague > Holy | 9, 8 |
| Sentenced mark_ramp | Sentenced > Plague, Fire > Sentenced | 7, 5 |
| Holy ls1 | Holy > Sentenced, Holy > Fire | 4, 2 |
| Plague execute | Plague > Frost, Plague > Holy | 2, 1 |
| Holy ls0 | Holy > Sentenced, Holy > Fire | 2, 2 |
| Fire burn | Frost > Fire, Fire > Sentenced | 1, 0 |
| Fire rate (same DPS) | none | 0 |
| Frost rate (same DPS) | Frost > Fire | 8 |

The last two rows move a power's attack rate by +-25% and its hit the opposite way, so damage per second stays fixed. Fire's own cadence moves nothing, because only `rate x hit` counts for Fire and no other power's mechanic reads Fire's rate; Frost's cadence moves one edge, Frost over Fire, by 8 points, because a faster Frost feeds Fire's backlash.

A knob with a small slider effect can still be decisive as a threshold. Holy's lifesteal numbers and Plague's execute move margins only a few points when nudged, yet removing lifesteal flips Holy over Sentenced and removing the execute flips Plague over Frost (section 4). Use the identity test, not the slider table, to judge whether a signature still matters.

**Known soft spot.** (Pre-balance-pass; burn is now 18 and typed magic.) Fire's burn (10 per second) is nearly cosmetic: its backlash does the work, and removing backlash alone flips both of Fire's wins. If you want burn to matter, raise it and retune; the identity test will tell you when it has an effect.

Largest structural lever: the damage shares and armor/shield values, because they set the whole multiplier matrix in section 5.

**Adding a sixth power.** Give it a spec on the same grid and one mechanic that reads only universal state. It will interact with all five through the same laws, but the graph will no longer be a clean five-cycle; expect to retune shares and defenses, and check with `test_rpsls.py`.

## 8. Verification

`python3 test_rpsls.py` runs: the exact 10-edge graph at dt = 0.01, 0.005, 0.002, 0.001; each power beats exactly two; invariance under power scaling (0.25x to 20x); invariance under renaming and reordering powers; robustness to random jitter on every numeric field (+-3% every time, +-5% in 28 of 30 draws; +-10% is reported only, because the compressed edges sit inside it by definition); an AST audit that the engine names no power and compares no names; and the nine identity tests from section 4.

**Limits.** These results cover 1v1 duels at equal level in the continuous simulator (`engine.py`); group fights, items, cooldowns and level mismatches are not modeled there. Weapons and attack cadence are checked separately by the 20 Hz weapon-duel harness (`python3 realtime_report.py`, needs numpy; see docs/GAME_DESIGN.md section 17), which sweeps every first-swing timing and HP and attack-speed buffs. Group fights are not modeled anywhere. Fight lengths are long in places (Frost over Holy, Plague over Frost), which suits an attrition-style game but may want a damage or HP pass if you want faster duels.
