# P-CAMP-BUFF-THEMES-1: each zone's camps pay a themed stat, spread evenly, as a sim switch the live profiles turn on

- **Serves:** owner beta-follow-up decision 2 (MIGRATION, 2026-11-10: "Port all three Nov 4 changes": zone-themed camp
  buffs, legacy commit `a7b5c4ce` on `origin/claude/adoring-edison-mxt8ab`)
- **Implementer tier:** implementer-opus (rh-sim state, reward RNG draw order, save/restore/hash)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): port by reading `a7b5c4ce`, one sanity test on the
  spread; existing parity fixtures stay byte-identical (the default stays the in-repo legacy roll) · D2 n/a

## 1. ID and outcome
In the unreleased legacy patch a camp's normal kills pay a **buff**: one of the nine mob stat kinds, drawn so each zone
mostly pays its own four (its theme), every buff is within a maximum distance of every camp, and the nine are spread
as evenly as possible. In this repo's legacy and in Rust a camp pays its own mob type's stat. Bringing `a7b5c4ce` into
`packages/` would move the file hash 218 captures pin (the reason P-REGEN-COMBAT-1 used a switch), so this packet does
the same: a `SimConfig` switch, default `Legacy` (serializes as nothing; no hash, fixture, checkpoint or replay moves),
`Themed` opted into by the live `source-arena` profile. Under `Themed` the camp roll follows `rollCampRosters`, each
camp carries its buff, a credited normal kill grants the camp's buff stat, and the camp row's reward on the wire (added
by P-WIRE17-HUD-1, already per camp) is the buff, so the Unity badge needs no change.

## 2. Dependencies
- P-WIRE17-HUD-1 merged (per-camp reward on the wire). P-REGEN-COMBAT-1-fix merged first (same `statics.rs` encoding
  rule: this switch must get its own digest value, not a shared string).

## 3. Relevant legacy paths
Read with `git show a7b5c4ce:<path>` (the commit is not in this branch's `packages/`; do not merge it):
- `packages/shared/src/rosters.ts` (`rollCampRosters`: the draw, its three factors, the repair steps)
- `packages/shared/src/constants.ts` (`CAMP_BUFF_MAX_DISTANCE_TILES` 65, `CAMP_BUFF_OFF_THEME_WEIGHT` 0.15,
  `CAMP_BUFF_NEED_REF_TILES` 30, `CAMP_BUFF_NEED_CAP_TILES` 90, `CAMP_BUFF_BALANCE_POWER` 2, `CAMP_BUFF_REPAIR_STEPS` 160)
- `packages/shared/src/mobStats.ts` (`mobStatKey`, `MOB_STAT_KEYS`, `campRewardId`), `packages/shared/src/schema.ts`
  (`CampState.buff`)
- `packages/server/src/sim/camps.ts` (roll at camp publish, only from `world.rewardRandom`, 2n - 1 draws for n camps),
  `mobLife.ts` (the kill grants the buff's stat), `mobStats.ts` (toast text names the source mob)
- `packages/shared/test/rosters.test.ts`, `packages/server/test/camps.test.ts` (the legacy acceptance numbers)

## 4. New paths
- chosen by the oracle author (a `camp_buffs` module beside the existing camp roll in `crates/rh-sim/src/`)

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (the switch), the camp roll and camp state in `crates/rh-sim/src/` (name the files in
  the brief after reading), the kill grant, `observe.rs` only where the camp row's reward is read
- save, restore and hash coverage for the new camp field (`crates/rh-sim/tests/hash_coverage.rs`)
- `crates/rh-server/src/runtime.rs` (the `source-arena` profile opts in)
- version constants only if a serialized shape changes (checkpoint, replay); say which

## 6. Contracts and references
- C-RNG: the roll draws only from the reward stream, never the sim stream or the public seed; under `Legacy` the draw
  count and order are exactly today's.
- C-OBS: a camp's buff is public the same way its reward row already is (P-WIRE17-HUD-1); nothing new is sent.
- Determinism: ordered iteration only; no float in the draw that differs across platforms (legacy uses whole-number
  balance factors: copy the arithmetic).

## 7. Behaviour to preserve
- Every parity fixture, the hash tape and the determinism sweep byte-identical under the default config.
- Elite camps: elites grant no stat and drop an augment chest; unchanged.
- Training: say in the hand-off whether training opts in (legacy does whatever `camps.ts` does for training rooms).

## 8. Acceptance checks
- Oracle (one loose-proof test, `Themed`, seeds 1-8 of the certified generator or the fixture maps): every camp has a
  buff among the nine kinds; at least 60% of camps pay a buff of their own zone's theme (legacy measured about 70%);
  from every camp each of the nine buffs is within `CAMP_BUFF_MAX_DISTANCE_TILES` or the legacy fallback distance;
  the counts of the nine buffs differ by at most the legacy band.
- Oracle: under `Themed` a credited normal kill at a camp whose buff differs from its mob type grants the buff's stat
  stacks, not the mob type's.
- Oracle: `Legacy` and `Themed` give different statics digests; `Themed` round-trips through checkpoint and replay; a
  default-config state hash is unchanged.
- `cargo run -p rh-parity --bin parity-report` all MATCH; `scripts/gate.sh --oracle packet/P-CAMP-BUFF-THEMES-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-CAMP-BUFF-THEMES-1`

## 9. Validation commands
- `cargo test -p rh-sim camp_buff`, `cargo test -p rh-sim --test hash_coverage`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The draw is about 300 legacy lines with a repair loop; the risks are an extra reward-stream draw under `Legacy`
and a field that misses save, restore or the hash.

## 11. Known traps
- Bots: legacy's Brain reads the buff for its farm route (`buildRoute.ts`, `huntAdapter.ts`, `perception.ts`). The
  ported Brain is not live; list what it would need in the hand-off, do not edit `rh-policy` here.
- A DEVIATIONS row is needed (the live rule differs from the in-repo legacy oracle, as DEV-017 does for regen): propose
  it in the hand-off.
- The toast text change is presentation: out of scope unless the event text is built in `rh-sim`.

## Notes from previous attempts
