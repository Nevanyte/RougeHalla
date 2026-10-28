# Sentenced redesign balance evidence

Saved 2026-10-28 for the final sheet, integrated with latest main `ebd3514` (combat controls/readability). This record separates strict tuning targets from established acceptance tolerances. Primary Sentenced edges use matched fists at kit 0, lock style, both seats, sigma 0.45. The design targets are favourite share 60–76% and winner HP 10–35%; the published A6 lower-bound tolerance is 56% for favourite share.

## Frozen sheet

`packages/shared/src/factions.ts` and `testing/classes.py` match field for field. Frost's universal hit value is 170 (previously 175); this was the selected broad numeric change used to recover the faction cycle and robustness after Sentenced-only candidates failed identity or edge constraints.

| Faction | HP | Rate | Hit | Physical | Armor | Shield | mark_pct | mark_kill | amp | tier_hits | tax_keep | tax_cap | suppress |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Sentenced | 880 | 0.806449 | 41.041892 | 0.35 | 135 | 120 | 0.028 | 0.007 | 1.5 | 3 | 0.38 | 1.6 | 0.8 |

## Python oracle, identity, and reference parity

- `python3 testing/test_rpsls.py`: PASS. The 10-edge graph holds at dt 0.01/0.005/0.002/0.001; every faction has two wins; global scaling, relabeling, purity, and mechanic-isolation checks pass. Jitter passes 30/30 at ±3% and 29/30 at ±5% (threshold 28/30); ±10% is informational at 13/30. Sentenced identity shifts are 90.3 points for removing the mark, 42.5 for preventing tier growth, 25.0 for removing suppression (two flips), and 19.7 for removing the attack-speed tax (Sentenced>Plague flips). Snapshot values and flips are recorded in the test.
- `python3 testing/weapon_reference.py` generated the current 30 faction/weapon rows and Fire backlash values copied into `packages/shared/test/weapons.test.ts` and `packages/server/src/harness/parity.ts`.
- `npm run harness:factions -- --python`: PASS in trades mode. Exact winner and HP-fraction parity on 70/70 cells and 8,411 duels; maximum HP-fraction difference 0.00.
- `python3 testing/test_kite.py`: FAIL, 8 cells after the integrated player windup update; no thresholds or exceptions were changed. Failures are Fire>Plague bow/wand, Sentenced>Frost bow/wand, Plague>Frost bow/wand, and Holy>Fire bow/wand. The two Frost-shooter pairs have infinite free-fire time in this continuous orb-walk model because the slowed chaser cannot close during the shorter ranged windup. The historical Holy>Fire wand exception also fails at the new timing. Main’s combat upgrade already documented ten failures in this legacy model before the Sentenced merge; this integrated sheet has eight. The shorter controls are preserved.
- `packages/server/test/fixtures/realtime-paced.json` was regenerated with `python3 testing/realtime_paced.py --k 2 --nmax 5 --sub 1 --pairs` and validated as JSON (122,490 bytes).
- The full integrated workspace suites pass: client 2,139 tests / 107 files; server 5,506 / 125; shared 1,726 / 62. Workspace typechecking and the production build pass. Browser smoke testing verified camp mark/status cues and the Sentence HUD with no browser errors. These workspace passes do not override the separately documented legacy kiting failures.

## Real-sim primary edges

Command: `npx tsx packages/server/bench/sentencedEdges.ts --setups 18 --draws 4 --weapons fists` (kit 0; lock; sigma 0.45; both seats).

| Edge | Favourite share | Winner HP left | Result |
|---|---:|---:|---|
| Fire > Sentenced | 67% | 22% (min 22%) | Within target |
| Sentenced > Plague | 66% | 38% (min 38%) | Winner HP exceeds 35% ceiling by 3 points |
| Sentenced > Frost | 67% | 24% (min 21%) | Within target |
| Holy > Sentenced | 57% | 12% (min 10%) | Share is 3 points under ideal 60%; within published 56–76% tolerance |

All four intended winners remain, and the two misses are recorded rather than presented as strict passes. The owner authorized changes to all factions as long as the two-wins/two-losses cycle remained. Trials with Plague disease 44–46, Holy hit 98–100, Frost armor 22 and Sentenced kill-stack pulse 0.008–0.011 improved some real-sim margins, but failed the unchanged jitter gate. They were rejected. No faction names or pair-specific bonuses were added to combat math. Increasing Sentenced shield from 110 to 120 fixed the single ±3% Python jitter failure (30/30), while moving Plague winner HP from 34% to 38%; a trial lowering Sentenced physical share to 0.30 worsened Plague HP to 41%, so it was reverted.

## Pace

The integrated TTK run (`/tmp/rougehalla-sentenced-integrated-ttk.log`) measured minute-0 median/mean 24.9/23.0 s and minute-5 6.1/6.6 s. The curve is monotone and the minute-0/minute-5 ratio is 4.12x. A1 minute-0 median is WARN (target 17–23 s, tolerance 15–26); minute-0 mean and minute-5 median/mean pass. The shortest minute-0 pair is also WARN at 0.36x median. The slowest mirror at minute 5 is Frost at 2.62x, WARN against the 2.30x target (within the 3.00x tolerance). Baseline minute-0 median/mean was 19.8/20.6 s; the initial redesign WIP regressed to 32.2/26.4 s.

## Additional validation and remaining evidence

The integrated all-weapons lock check (`/tmp/rougehalla-sentenced-final-all-directions-integrated.log`) reports all ten favourite directions at 100% for fists, sword, axe, bow, wand, and shield (A8 pass on all six). A6 HP residuals remain: across fists, the maximum winner HP is 38% (Sentenced>Plague; outside the 35% tolerance ceiling), and the minimum is 12% (within tolerance but below the ideal 15% target). Other weapons have their own high residuals: the maximum is 41% on wand. Camp validation (`/tmp/rougehalla-sentenced-final-camps-integrated.log`) passed the normal-type gate (all 20 normal types cleared all three runs per faction on fists) and the elite gate (at least one faction cleared each elite on its zone weapon); this does not mean every faction cleared every elite. D9 tournament share remains unmeasured because the available tournament report mixes farming and free-for-all outcomes.

Commands run on the frozen sheet:

    python3 testing/test_rpsls.py
    python3 testing/weapon_reference.py
    python3 testing/realtime_paced.py --k 2 --nmax 5 --sub 1 --pairs > packages/server/test/fixtures/realtime-paced.json
    npm run harness:factions -- --python
    python3 testing/test_kite.py
    npx tsx packages/server/bench/sentencedEdges.ts --setups 18 --draws 4 --weapons fists

## Rejected real-sim candidates

| Candidate | Fire > Sentenced | Sentenced > Plague | Sentenced > Frost | Holy > Sentenced | Outcome |
|---|---:|---:|---:|---:|---|
| A: HP880, rate0.806449, hit41.041892, phys0.517476, armor130, shield150, mark_pct0.028434 | 64% / 16% HP | 68% / 40% HP | 68% / 24% HP | 53% / 6% HP | Plague HP too high; Holy share/HP too low |
| B: HP905.673, rate0.80655, hit37.148079, phys0.516167, armor132.473, shield150, mark_pct0.029015 | 64% / 16% HP | 69% / 41% HP | 69% / 27% HP | 53% / 6% HP | Same misses |

Both were rejected on the real-sim bench. The Python model is useful for direction and regression checks; the real sim remains the primary edge measurement.
