# P-FACTION-4: Sentenced hunt

## 1. Outcome

Port `packages/server/src/sim/sentencedHunt.ts` and `packages/shared/src/sentencedHunt.ts` into `rh-sim`: one living rival
selection per living Sentenced player, the source's `+5%` toward-target movement multiplier, one completed-hunt Mark
stack per real target death, the selected actor's fog/bush visibility exception, and the source lifecycle clears
(`fighterOut`, `runEnded`). `huntStacks` scales the Mark pulse by `1 + 0.02 x stacks`.

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/sentencedHunt.ts` — `handleHuntTarget`, `huntMoveMultiplier`, `fighterOut`, `runEnded`.
- `packages/shared/src/sentencedHunt.ts` — the three constants and `sentencedHuntMarkMultiplier`.
- `packages/server/src/sim/factions.ts` — `recordPulse` applies `sentencedHuntMarkMultiplier(c.s.huntStacks)`.
- `packages/server/src/sim/vision.ts` — `canPlayerSeeActor` returns true only for the selected living rival.
- `packages/server/src/sim/gameplay.ts` — install order immediately after bruiser passives, before `mods`/plague zombies.
- `packages/server/test/sentencedHunt.test.ts` — selection, real death, MIA, own death, movement legs and vision.

## 3. Write scope (this packet)

`crates/rh-sim/src/systems/sentenced_hunt.rs` (+ `tests.rs`), `state.rs`, `input.rs`, `systems/inputs.rs`, `systems/mod.rs`,
`schedule.rs`, `events.rs`, `constants.rs`, `vision.rs`, `observe.rs`, `checkpoint.rs`, `modifiers/mod.rs`,
`crates/rh-parity/src/{lib.rs,mapping.rs,canon.rs,hunt.rs}`, `crates/rh-parity/tests/hunt.rs`,
`crates/rh-headless/src/digest.rs`, `parity/legacy-capture/{capture.ts,scenarios/types.ts,scenarios/hunt.ts}`,
`parity/fixtures/sentenced_hunt_*.json`, this evidence, and the progress ledger. Protocol files are a later packet commit.

## 4. Contracts

- C-INPUT: `huntTarget` is a `RawCommand`/`PublicCommand`/`ActionCmd` variant validated at intake; no state is set by a
  handler outside the tick.
- C-TICK: the action sits at its existing `ACTIONS` position; the movement modifier is row 6 of `MOVE_MODIFIERS`; the
  `fighterOut` and `runEnded` links keep their recorded positions.
- C-OBS: `hunt_target`/`hunt_stacks` are in the owner's `SelfView` only; the selected actor exception reveals that actor,
  never its terrain or neighbours. The state stays private from other observers until protocol exposure is added.
- C-RNG: no random stream.
- C-DET: state fields are serialized, hashed and checkpoint-validated; the restored continuation is checked every tick.

## 5. Behaviour to preserve

- A living current target cannot be replaced; a dead/absent target can. Self, non-players, dead players, non-active
  phases and non-Sentenced hunters are refused.
- A real target death (`Down` + `Dead` + active) clears the target and adds one stack to every OTHER living Sentenced
  hunter tracking it, with the source toast. MIA/removal clears only.
- A hunter's own death clears its own selection and earns nothing.
- The walk bonus applies only when the next path leg's normalized dot at the target is `> 0.3`; it is `1.05` otherwise
  `1`, and is a move-modifier row folded in legacy order.
- `runEnded` clears every selection, never the completed stacks.
- The selected living rival is visible to that hunter through fog and bush; hidden/untargetable still refuse lock/cast.
- Mark pulses multiply by `1 + 0.02 x stacks` at the end of the existing pulse expression.

## 6. Acceptance checks

- [x] Six actual-source scenarios (select/death, MIA, own death, toward/away movement, vision exception, run end) compare
  at every tick through `rh-parity`.
- [x] Every captured tick restores from a checkpoint and continues with identical events/hash.
- [x] Unit tests for selection, MIA, own death, movement vectors, actor-only vision, Mark scaling and run end.
- [x] Checkpoint refusal for a self/missing target and an over-large stack count.
- [x] Warmed `no_alloc` and full hash-coverage gates pass.
- [x] Six committed mutants with semantic failures and a restoring runner (`tools/hunt-fixtures/run-mutants.sh`, 6/6 killed).
- [ ] Protocol exposure (`huntTarget` input, self fields, v7 vectors, C#/JS mirrors).
- [ ] Full workspace gate and PR.

## 7. Commands

See `docs/evidence/deepseek-rust/PROGRESS.md`. Captures are run in the pinned Linux x64 Node `v22.23.4` container; the
fixture files were produced by `node --import tsx parity/legacy-capture/capture.ts --out parity/fixtures --only <name>`.

## 8. Traps

- The first captured input tick is 2, not 1 (the lobby closes on step 1).
- The raid-start spawn shuffle can leave a viewer with a 30 s trail at its old spawn; a vision scenario must place the
  inspected point outside both the final position's 900 u radius and every initial spawn trail. This capture avoids a
  custom bootstrap because the Rust preconditions reserve that setup for the Sentenced public-producer triple.
- `fighterOut` fires before kill credit and with the victim already `Dead`; `realDeath` must read that state, not the
  cause alone.
- `huntStacks` is an integer state counter, but the Mark multiplier is f64 and must be applied in the source's final
  multiplication position.
