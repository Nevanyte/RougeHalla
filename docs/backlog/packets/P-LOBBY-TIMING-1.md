# P-LOBBY-TIMING-1: 15-second lobby, bots join at second 13 when no human match formed

- **Serves:** not in the plan: owner direction 2026-11-10 (MIGRATION checkpoint, decision 8)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (an intentional difference from legacy, behind configuration) · D2 n/a (no combat number) ·
  D5: owner-directed design change, recorded in the checkpoint · D6/D9 none

## 1. ID and outcome
Owner rule: "wait 15 seconds; if by second 13 no match can be found, add bots to the lobby". Legacy and the Rust defaults
are a 30 s lobby that is pulled to 5 s once 2 humans are in, with bots arriving spread over 12 s from the start; the beta
host runs a 10 s lobby pulled to 3 s once 1 human is in. When this lands the server has a fill mode in which, measured
from the first human's arrival: no bot joins before second 13; at second 13, if the lobby is not full of humans, bots
fill it to the fill target; the match starts at second 15; a lobby that fills with humans earlier starts early through
the existing rule. The mode is selected by flags, the legacy timing stays the default, and existing fixtures do not move.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/shared/src/constants.ts:130-134`: `MIN_PLAYERS_TO_START = 2`, `LOBBY_SECONDS = 30`, `LOBBY_FILL_SECONDS = 5`
- `packages/server/src/sim/step.ts:169-170`: the deadline pulled in once the human minimum is reached
- `packages/server/src/bots/brain/types.ts:1246-1247`: `BOT_FILL_DEFAULTS` (`arrivalSeconds = 12`, `fillTo = 8`)

## 4. New paths
- tests beside the code they cover in `crates/rh-server/` (the oracle author names them)

## 5. Exclusive write scope
- `crates/rh-server/src/bot_fill.rs` and `crates/rh-server/src/bot_fill/`
- `crates/rh-server/src/room.rs` (lobby closing and bot top-up, around `:920` and `:1091-1131`)
- `crates/rh-server/src/director.rs` (fill config per room, around `:784-790`)
- `crates/rh-server/src/main.rs` (flags, around `:174-177`) and `crates/rh-server/src/runtime.rs` if a profile sets them
- Not in scope: `crates/rh-sim/src/systems/lobby.rs` (the sim's deadline rule mirrors legacy and stays), `hosting/`
  (the launch flags change in a separate, owner-approved step).

## 6. Contracts and references
- C-INPUT: bots still join and act through the seat contract; C-RNG: bot arrival times that used a private stream keep
  their draw order in the legacy mode.
- Bots never count toward the human minimum and never close the lobby (`room.rs:920`): unchanged.
- `docs/DEVIATIONS.md`: a row is proposed in the hand-off (legacy 30/5/12 versus the owner's 15/13), category platform.
- Parity fixtures for bot fill (`parity/policy/`, `tools/bot-fill-fixtures`) pin the legacy timing and must stay MATCH.

## 7. Behaviour to preserve
- Default flags give today's behaviour exactly; every existing rh-server and parity test passes unchanged.
- Training rooms are unaffected.
- The sim's lobby deadline rule and its fixtures.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-LOBBY-TIMING-1` passes (full).
- Timeline tests in the new mode, driven by simulated time: one human at t0 gives no bot before 13 s, the fill target at
  13 s and a start at 15 s; a second human at 6 s does not restart the clock; a lobby full of humans at 4 s starts through
  the existing early rule with no bot; a human who leaves at 14 s is replaced before the start; zero humans never start
  a match.
- The legacy mode's timeline test is byte-identical before and after.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-LOBBY-TIMING-1`

## 9. Validation commands
- `cargo test -p rh-server`
- `cargo run -p rh-parity --bin parity-report`

## 10. Risk and suggested model tier
Sonnet: one crate, server orchestration outside the sim. The risk is breaking the legacy fill fixtures; the default mode
guards that.

## 11. Known traps
- "Second 13" and "second 15" are server time from the first human's arrival, not from room creation.
- The sim pulls the deadline in when the human minimum is reached: with `--min-players 1` that fires at once. The new
  mode must hold the 15 s lobby without editing the sim rule (for example by how the room sets the minimum and the
  deadline); say in the hand-off how.
- Bots joining at 13 s need their arrival compressed into the last 2 s; do not reuse the 12 s spread.
- An open question for the owner is recorded in the checkpoint: whether a full human lobby starts early. The oracle pins
  "yes" and names that test so it is easy to flip.

## Notes from previous attempts
