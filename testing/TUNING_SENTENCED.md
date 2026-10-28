# Sentenced redesign balance evidence

Final follow-up to release `6f06d9d`, measured 2026-10-28 on latest main with its combat controls/readability upgrade preserved. The primary contract is matched-fists Sentenced duels at kit 0, lock style, 18 setups, both seats and four noise draws (sigma 0.45): favourite share 60–76%, winner health 10–35%. Every faction must retain two intended wins and two losses. Primary percentages below use the exact unrounded fractions.

## Final numbers

| Setting | Initial release | Balanced follow-up |
|---|---:|---:|
| Sentenced HP | 880 | 880 |
| Sentenced rate | 0.806449 | 0.95 |
| Sentenced hit | 41.041892 | 34.840203 |
| Sentenced physical / magic | 35% / 65% | 40% / 60% |
| Sentenced armor / shield | 135 / 120 | 135 / 120 |
| Base mark share | 0.028 | 0.027 |
| Mark share per Sentence stack | 0.007 | 0.00675 |
| Tier-four pulse amplifier | 1.50 | 1.17 |
| Excess-speed keep / cap | 0.38 / 1.6 | 0.38 / 1.6 |
| Output multiplier at tier three | 0.8 | 0.8 |
| Hits per tier | 3 | 3 |
| Holy lifesteal base / missing-health factor | 0.10 / 0.80 | 0.11 / 0.85 |
| Holy lifesteal cap | 0.75 | 0.75 |
| Fresh PvP factor | 0.75 | 0.77 |

Frost hit stays 170, the initial redesign's reduction from 175. Other faction stats are unchanged. The PvP ceiling stays 3.0 and its power scale stays 6; the fresh-factor adjustment adds 2.67% damage across all factions in starter PvP fights and does not affect player-to-mob or NPC damage.

The pulse power moves toward earlier hits and away from the late amplifier. This closes the primary margins while retaining all mark effects and their identity thresholds. The weaponless engine advances tiers at base faction cadence; actual weapons land hits faster, so it is a direction/robustness oracle, not a substitute for weapon-aware and real-sim measurements. No pair-specific bonuses or faction-name checks were added. Camp marking still uses one pulse batch per tick and a fixed `1 / sqrt(N)` per-member share captured at mark start.

## Primary real-sim results

| Edge | Favourite share | Winner HP left | Result |
|---|---:|---:|---|
| Fire > Sentenced | 75.00% | 31.10% | PASS |
| Sentenced > Plague | 63.19% | 32.28% | PASS |
| Sentenced > Frost | 64.58% | 17.41% (minimum 14.96%) | PASS |
| Holy > Sentenced | 61.81% | 17.22% | PASS |

All four exact shares are inside 60–76%, all four median health fractions inside 10–35%, and every underdog retains at least 24% share. The initial release's Sentenced>Plague 38% HP and Holy>Sentenced 57% share misses are resolved. Rounding a candidate's 35.46% health to 35% was not accepted as a pass.

Reproduction: `npx tsx packages/server/bench/sentencedEdges.ts --setups 18 --draws 4 --weapons fists`. Its normal report rounds percentages; the exact table above is calculated with the same `playDuel`, `fullSetups` and `edgeStats` helpers before formatting.

## Counter graph, references and identities

- `python3 testing/test_rpsls.py`: PASS at all four timesteps, global scales and relabelings; each faction has exactly two wins. Robustness is 30/30 at ±3% and 28/30 at ±5%, meeting the unchanged floors.
- All existing mechanic-isolation requirements remain: main effects need a flip and at least a 20-point shift; sub-effects need a flip or at least 15 points. Measured Sentenced shifts are 88.9 for removing the mark, 38.9 for preventing tier growth, 26.1 for removing suppression (two flips), and 20.3 for removing the tax (Plague flips). Numerical snapshot values were regenerated; thresholds were not relaxed.
- TypeScript and Python faction fields/parameters match. Weapon, matchup and identity tables were regenerated from the Python references. `realtime-paced.json` was regenerated at game pace.
- `npm run harness:factions -- --python`: PASS, exact winners and health fractions in 70/70 cells and 8,270 duels, maximum HP difference 0.00.
- All ten faction directions hold across all six weapons in the clean lock check (A8 passes on all 60 cells; minimum favourite win share is 92% for sword, 100% in the other columns). This does not imply equal health margins for different weapons. Some secondary weapon-specific A6 health bands still fail: sword has a near-zero-health edge, axe/wand reach about 39%, and shield about 36%. Those are retained as separate playtesting concerns, not counted as primary matched-fists passes.

## Pace and farming

`ttkCurve --minutes 0,1,2,3,4,5 --setups 18` runs 450 duels per minute with no caps. Median TTK is 25.7, 12.8, 10.5, 8.4, 6.1 and 6.1 seconds; minute-0 mean is 22.7 s, minute-5 mean 6.6 s. The curve is monotone and its end-to-end ratio is 4.20x. Minute-0 median remains WARN against the ideal 17–23 s but is inside the unchanged 15–26 s tolerance. The shortest minute-0 pair is WARN at 0.34x median, and the slowest minute-5 mirror (Frost) is WARN at 2.59x (inside the 3x tolerance). No TTK acceptance line is FAIL.

Before the baseline PvP adjustment the new faction sheet's median was 26.4 s, outside tolerance; it was corrected rather than waived. Historical comparison: main before redesign measured 19.8/20.6 s median/mean, and the saved WIP regressed to 32.2/26.4 s.

The final faction sheet passes `campDuel --types --seeds 3 --weapon fists --pulls camp --cap 90`: all 20 normal types clear every run for each faction, and each elite type has at least one faction that clears it on its zone weapon. This does not mean every starter clears every elite. The subsequent PvP-only factor change does not affect these fights.

## Regression validation and remaining evidence

Regression coverage: client 2,139/2,139 tests across 107 files and shared 1,726/1,726 across 62 files pass in the final workspace run. Server covered 5,506 tests across 125 files: 5,500 passed, and six stale Holy-lifesteal expectations were corrected; both affected files were rerun completely and passed 94/94. No production code changed during that repair. Workspace typechecking and the production build pass. A shared pathfinding performance check failed during an earlier parallel run, passed in isolation, and the final full shared run passes; no threshold was changed.

`python3 testing/test_kite.py` still has eight failures under latest main's shorter ranged windups: Fire>Plague bow/wand, Sentenced>Frost bow/wand, Plague>Frost bow/wand and Holy>Fire bow/wand. Main's combat upgrade already documented ten failures in this legacy model before the redesign. Its assertions and historical exception remain unchanged. The two Frost-shooter groups have infinite free-fire time in that continuous orb-walk model. These controls tradeoffs and the secondary weapon health margins still need human playtesting.

D9 tournament share is unmeasured because the available tournament report mixes farming and free-for-all outcomes rather than isolated faction duel shares. The unrelated deferred bot and quest tasks remain in `Unfinished code/README.md`.
