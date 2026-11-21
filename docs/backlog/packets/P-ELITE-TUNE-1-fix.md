# P-ELITE-TUNE-1-fix: make the Rework-vs-Legacy elite equivalence test a real proof (test only)

- **Serves:** note from reviewer-opus on P-ELITE-TUNE-1; ORDER_OF_OPERATIONS phase 2, item 13 (P-MOBS-2). No behaviour changes.
- **Implementer tier:** test-only, reviewer (no implementer follows; the oracle is the deliverable).
- **Reviewer:** reviewer
- **Integration base:** `coord/int-64` (763ef71c3: integration plus P-ELITE-TUNE-1, content `204532d861849785`). Gate: `scripts/gate.sh --quick --base coord/int-64`.
- **D-rules touched:** D1 loose proof (one test) . D2 n/a . D5/D6/D9 none. No OWNER_DECISIONS row is about this test; the elite numbers themselves are the 2026-11-19 row "Elite numbers for P-ELITE-TUNE-1", which this keeps to (hp x1.5 vs x2.0 = 0.75, damage x1.0 vs x1.5).

## 1. ID and outcome
`rework_elites_differ_from_legacy_only_in_elite_numbers_until_the_first_elite_strike` (`crates/rh-sim/tests/augment_rules.rs`)
had a six-tick prefix on all three seeds (first elite strike at tick 6, same elite HP, so the sweep was one run) and
compared the whole world once (t = 0). It now compares the whole world on every tick of a prefix of 50-161 ticks per run.

## 2. Dependencies
P-ELITE-TUNE-1 (in `coord/int-64`). Stub commit: none needed (the test uses existing API).

## 3. Relevant legacy paths
Legacy has no Rework; the proof is Rework-vs-Legacy inside the Rust seam, so no legacy `file:line` applies (elite numbers:
`packages/shared/src/constants.ts` `ELITE_HP_MULT` 2, `ELITE_DMG_MULT` 1.5, see P-ELITE-TUNE-1 section 3). Camp wake on damage:
`crates/rh-sim/src/systems/mob_ai.rs:75-103` (`aggro`), `:105-127` (`wake_mates`): the whole camp wakes when one member is hurt.

## 4. New paths
None. Existing file amended: `crates/rh-sim/tests/augment_rules.rs`.

## 5. Exclusive write scope
`crates/rh-sim/tests/augment_rules.rs` only (the amended test and its helpers: `placements_at`, `approach_tick`, `json_diff`,
`without_elite_damage`, an extended `mask_elite_numbers`).

## 6. Contracts and references
C-PARITY (Legacy unchanged), `docs/agent/AUGMENT_REWORK.md` (rule seam), P-ELITE-TUNE-1 packet.

## 7. Behaviour to preserve
Nothing in `src/` changes. The test passes on 763ef71c3 (measured).

## 8. Acceptance checks
`cargo test -p rh-sim --test augment_rules` green on `coord/int-64`; `scripts/gate.sh --quick --base coord/int-64`.

## Existing tests that pin what this changes
- `augment_rules.rs::rework_elites_differ_from_legacy_only_in_elite_numbers_until_the_first_elite_strike`: the test amended here
  (oracle-amend commit). Asserted before: events equal each tick up to the first elite strike, elite max HP 0.75x and equal
  damage taken, state hashes differ, whole-world masked equality at `t % 10 == 0`. All of that is kept except the cadence (now every
  tick) and the end of the prefix (now the elite's or a player's death, or 400 ticks).
- `tests/elite_tune.rs` and `systems/mob_life/share_tests.rs`: pin the numbers and the helper share; untouched.

## What the new test does (and what is honest)
- Three starts (original placement and two far corners of the fire room) by seeds 11, 12, 13 = nine runs. Players walk toward the
  nearest mob until within 60 units (`approach_tick`), then play `drive_tick`'s script.
- On every tick of the prefix: events equal (the amount of a hit an elite deals zeroed: that is the damage number); state hashes
  differ; elite max HP is 0.75x and damage taken equal (kept); the whole checkpoint, minus the two config rules, equal after
  `mask_elite_numbers`.
- `mask_elite_numbers` now also nulls the raw damage of an elite's swing in progress (`core.weapon.action.packet.raw`, scaled by the
  elite damage multiplier when the swing begins). Found by running: the world differed at tick 15 on that field alone.
- From the first elite strike, and only from then, the two players' `vitals.hp` and `vitals.hp_frac_at_tick_start` are masked: they
  are what the elite's damage number lands on. Measured: with exactly that mask the worlds and events stay equal until a death.
- The prefix ends (before comparing that tick) when an elite is down or a player dies in either world: the HP number and the damage
  number decide when, and after it loot, counts, timers and the match differ for good.
- Floors: every run strikes; every run's prefix >= 40; victim HP differs after the strike in every run (the mask hides something
  real); at least four of the nine runs differ in (prefix, strike tick).

## Measured (763ef71c3)
Prefix per run (ticks compared, first elite strike tick), seeds 11/12/13:
- start 0 (200,200): 50, 76, 69 (strike 13)
- start 1 (270,270): 68, 105, 90 (strike 20)
- start 2 (100,270): 83, 154, 161 (strike 13)
Before: 6 ticks on every seed, one whole-world comparison per seed. After: 856 whole-world comparisons in total (all nine runs).

## Notes for the owner
- The strike lands 6 ticks after the first player hit whenever the camp wakes (all camp mates wake together), so lengthening the
  prefix by starting farther away cannot work: the approach is only about 14-20 ticks. The length comes from comparing through
  the fight with the victim-HP mask instead.
- Players walk about 10 units per tick, so the approach is short; a start farther than the fire room would need another map.

## Oracle files
- `crates/rh-sim/tests/augment_rules.rs` (oracle-amend: `docs/backlog/packets/P-ELITE-TUNE-1-fix.md` lists it for the owner)
- `docs/backlog/packets/P-ELITE-TUNE-1-fix.md`

## Risk and suggested model tier
Test only; no implementer. Reviewer (Sonnet) checks that the masks hide only elite numbers and their direct victims.

## Known traps
The test is wall-clock cheap (about 1 s). A change that lets an elite hit later than tick 13 shrinks nothing here; a change that
makes it hit earlier than 40 ticks before the first death fails the floor loudly.
