# Sentenced redesign balance evidence

Saved 2026-10-28 for the frozen MR120 candidate. This record separates strict tuning targets from established acceptance tolerances. Primary Sentenced edges use matched fists at kit 0, lock style, both seats, sigma 0.45. The design targets are favourite share 60–76% and winner HP 10–35%; the published A6 lower-bound tolerance is 56% for favourite share.

## Frozen sheet

`packages/shared/src/factions.ts` and `testing/classes.py` match field for field. Frost's universal hit value is 170 (previously 175); this was the final permitted broad numeric lever used to recover the faction cycle and robustness after Sentenced-only candidates failed identity or edge constraints.

| Faction | HP | Rate | Hit | Physical | Armor | Shield | mark_pct | mark_kill | amp | tier_hits | tax_keep | tax_cap | suppress |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Sentenced | 880 | 0.806449 | 41.041892 | 0.35 | 135 | 120 | 0.028 | 0.007 | 1.5 | 3 | 0.38 | 1.6 | 0.8 |

## Python oracle, identity, and reference parity

- `python3 testing/test_rpsls.py`: PASS. The 10-edge graph holds at dt 0.01/0.005/0.002/0.001; every faction has two wins; global scaling, relabeling, purity, and mechanic-isolation checks pass. Jitter passes 30/30 at ±3% and 29/30 at ±5% (threshold 28/30); ±10% is informational at 13/30. Sentenced identity shifts are 90.3 points for removing the mark, 42.5 for preventing tier growth, 25.0 for removing suppression (two flips), and 19.7 for removing the attack-speed tax (Sentenced>Plague flips). Snapshot values and flips are recorded in the test.
- `python3 testing/weapon_reference.py` generated the current 30 faction/weapon rows and Fire backlash values copied into `packages/shared/test/weapons.test.ts` and `packages/server/src/harness/parity.ts`.
- `npm run harness:factions -- --python`: PASS in trades mode. Exact winner and HP-fraction parity on 70/70 cells and 8,411 duels; maximum HP-fraction difference 0.00.
- `python3 testing/test_kite.py`: PASS, including paced mark identity. Named Holy>Fire wand exception remains at r_kite 0.64 / 76% shooter wins, above its accepted floor of 0.62; other cells meet the 65% bound.
- `npx vitest run packages/shared/test/factions.test.ts packages/shared/test/weapons.test.ts packages/shared/test/mobs.test.ts`: PASS, 167/167 tests.

## Real-sim primary edges

Command: `npx tsx packages/server/bench/sentencedEdges.ts --setups 18 --draws 4 --weapons fists` (kit 0; lock; sigma 0.45; both seats).

| Edge | Favourite share | Winner HP left | Result |
|---|---:|---:|---|
| Fire > Sentenced | 67% | 22% (min 22%) | Within target |
| Sentenced > Plague | 66% | 38% (min 38%) | Winner HP exceeds 35% ceiling by 3 points |
| Sentenced > Frost | 67% | 24% (min 21%) | Within target |
| Holy > Sentenced | 57% | 12% (min 10%) | Share is 3 points under ideal 60%; within published 56–76% tolerance |

All four intended winners remain, and the two near misses are recorded rather than presented as strict passes. Increasing Sentenced shield from 110 to 120 fixed the single ±3% Python jitter failure (30/30), while moving Plague winner HP from 34% to 38%; a trial lowering Sentenced physical share to 0.30 worsened Plague HP to 41%, so it was reverted.

## Pace

The exact frozen candidate's final TTK curve is awaiting the root task's run. Earlier results are not substituted here: baseline minute-0 median/mean was 19.8/20.6 s; the initial redesign WIP regressed to 32.2/26.4 s. Candidate-specific pace should be added only from the final-sheet run.

## Additional validation and remaining evidence

The client/core reports recorded during the shared run include an all-weapon A8 direction check and camp validation. They were measured on nearby candidate snapshots; rerun or confirm them against the frozen MR120 sheet before treating them as final release evidence. D9 tournament share remains unmeasured because the available tournament report mixes farming and free-for-all outcomes.

Commands run on the frozen sheet:

    python3 testing/test_rpsls.py
    python3 testing/weapon_reference.py
    npm run harness:factions -- --python
    python3 testing/test_kite.py
    npx vitest run packages/shared/test/factions.test.ts packages/shared/test/weapons.test.ts packages/shared/test/mobs.test.ts
    npx tsx packages/server/bench/sentencedEdges.ts --setups 18 --draws 4 --weapons fists

## Rejected real-sim candidates

| Candidate | Fire > Sentenced | Sentenced > Plague | Sentenced > Frost | Holy > Sentenced | Outcome |
|---|---:|---:|---:|---:|---|
| A: HP880, rate0.806449, hit41.041892, phys0.517476, armor130, shield150, mark_pct0.028434 | 64% / 16% HP | 68% / 40% HP | 68% / 24% HP | 53% / 6% HP | Plague HP too high; Holy share/HP too low |
| B: HP905.673, rate0.80655, hit37.148079, phys0.516167, armor132.473, shield150, mark_pct0.029015 | 64% / 16% HP | 69% / 41% HP | 69% / 27% HP | 53% / 6% HP | Same misses |

Both were rejected on the real-sim bench. The Python model is useful for direction and regression checks; the real sim remains the primary edge measurement.
