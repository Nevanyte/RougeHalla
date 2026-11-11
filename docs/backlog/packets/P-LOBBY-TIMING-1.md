# P-LOBBY-TIMING-1: 15-second lobby, bots join at second 13 when no human match formed

- **Serves:** not in the plan: owner direction 2026-11-10 (MIGRATION checkpoint, decision 8)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (an intentional difference from legacy, behind a flag; legacy fixtures stay MATCH) · D2 n/a (no combat number) ·
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

## 3. Relevant legacy paths (verified 2026-11-10)
- `packages/shared/src/constants.ts:130-134`: `MIN_PLAYERS_TO_START = 2`, `LOBBY_SECONDS = 30` (timer from the first join),
  `LOBBY_FILL_SECONDS = 5`
- `packages/server/src/sim/step.ts:164-171`: only humans count; at `minPlayers` the deadline is pulled in to
  `serverTime + fillSeconds`; the lobby closes at `MAX_PLAYERS` humans or at the deadline
- `packages/server/src/bots/brain/types.ts:1246-1247`: `BOT_FILL_DEFAULTS` (`fillTo = 8`, `arrivalSeconds = 12`)
- Rust mirrors, all unchanged in the legacy mode:
  - `crates/rh-sim/src/systems/lobby.rs:23-26` (the pull-in) and `:28` (close at `MAX_PLAYERS` humans or the deadline);
  - `crates/rh-sim/src/sim.rs:410-412`: `lobby_ends_at = server_time + lobby_seconds` is set when the first player is
    seated, so the sim's clock already runs from the first human's arrival (bots never seat into an empty room);
  - `crates/rh-server/src/main.rs:174-177` (first-playable flags, defaults 2 / 0 / 30 / 5), `:497-505` (the same flags on
    the plain path), `:652-670` (`server_fill_config`, `cfg.bot_fill`); `crates/rh-server/src/runtime.rs:133-155`
    (profile flags, same defaults; training forces 0) and `:187-189` (`sim()`);
  - `crates/rh-server/src/bot_fill.rs` `BotFillConfig` and its defaults (`fill_to 8`, `arrival_seconds 12`),
    `lobby_tick` (arrivals drawn when the deadline is within `arrival_seconds`, last arrival `ARRIVAL_END_MARGIN_MS = 1000`
    before the end, `squeeze` when the deadline moves in) and `lobby_closing` (seats the missing bots at once on the
    closing step);
  - `crates/rh-server/src/room.rs:390-391,497-498,515-516` (the room keeps `min_players` / `fill_seconds` from `cfg.sim`),
    `:921-960` (`fill_bots`, the immediate placeholder fill used only when no `BotFillState` is installed),
    `:962-971` (`with_bot_fill`), `:1091-1131` (`fill_step`: `closing = humans >= MAX_PLAYERS || now >= ends ||
    (humans >= min_players && fill_seconds <= 0)`), `:835-865` (a joining human takes the newest bot's seat when the
    lobby is full);
  - `crates/rh-server/src/director.rs:784-790` (`fill_policy`: the room's `fill_to` over the configured
    `BotFillConfig`) and `:798-820` (`spawn_room` builds `RoomConfig { sim: self.cfg.sim.clone(), .. }` then
    `with_bot_fill`).
- Corrections to the earlier draft: the sim's rule is `lobby.rs:23-26`, not in `room.rs`; the placeholder fill at
  `room.rs:921` is not the managed fill; the flags are parsed in two places (`main.rs` and `runtime.rs`).

## 4. New paths
- none (the oracle is `crates/rh-server/tests/lobby_timing.rs`, already committed)

## 5. Exclusive write scope
- `crates/rh-server/src/bot_fill.rs` and `crates/rh-server/src/bot_fill/` (the oracle's stub lives here: `LobbyTiming`,
  `BotFillConfig::lobby_timing`, `BotFillConfig::apply_lobby_timing`; the implementer replaces the stub body and may
  change the enum's variants only if `tests/lobby_timing.rs` still compiles unchanged)
- `crates/rh-server/src/room.rs` (lobby closing and bot top-up, around `:920` and `:1091-1131`)
- `crates/rh-server/src/director.rs` (fill config per room, around `:784-790`)
- `crates/rh-server/src/main.rs` (flags, `:174-177`, `:497-505`, `:652-670`) and `crates/rh-server/src/runtime.rs`
  (`:133-155`, `:187-189`): one new flag, suggested `--lobby-timing legacy|matchmaking` (default `legacy`), accepted on
  both paths, with `matchmaking` meaning `LobbyTiming::Matchmaking { lobby_seconds: 15., bots_at_seconds: 13. }`. Training
  rejects it. When it is `matchmaking`, `--min-players`, `--lobby-seconds` and `--fill-seconds` are ignored for the lobby
  (the host's current flags keep working); `--fill-bots` is still the fill target.
- Not in scope: `crates/rh-sim/src/systems/lobby.rs` (the sim's deadline rule mirrors legacy and stays), `hosting/`
  (the launch flags change in a separate, owner-approved step).

## 6. Contracts and references
- C-INPUT: bots still join and act through the seat contract; C-RNG: bot arrival times that used a private stream keep
  their draw order in the legacy mode.
- Bots never count toward the human minimum and never close the lobby (`room.rs:920`): unchanged.
- `docs/DEVIATIONS.md`: a row is proposed in the hand-off (legacy 30/5/12 versus the owner's 15/13), category platform.
- Parity fixtures for bot fill (`parity/policy/`, `tools/bot-fill-fixtures`) pin the legacy timing and must stay MATCH.

### How the 15 s lobby holds without editing the sim (the seam)
The sim's rule (`lobby.rs:23-26`) pulls the deadline in to `server_time + fill_seconds` as soon as `humans >= min_players`.
It stays. The sim already starts its clock at the first player's seating (`sim.rs:410-412`) and already closes at
`MAX_PLAYERS` humans (`lobby.rs:28`). So in the new mode the director hands the sim knobs that make the pull-in
unreachable and set the clock to 15 s: `lobby_seconds = 15`, `min_players = MAX_PLAYERS`, `fill_seconds = 0`. With those, a
lobby of fewer than eight humans runs to its deadline, and eight humans close it at once through the existing rule (the
FLIP test below). `BotFillConfig::apply_lobby_timing(&self, &mut SimConfig)` is that adjustment; the director calls it on
the cloned `SimConfig` in `spawn_room` before `Room::new`, so `Room` reads the same values for its own `closing` rule
(`room.rs:497-498`). It is a no-op for `Legacy`. The adjustment has to happen before `Room::new` because the sim and
recorder are built there. No sim seam is needed.

The bot side: the room installs `BotFillState` in both modes. In `Matchmaking` mode `lobby_tick` must seat nothing before
`bots_at_seconds` after the first human and must seat all missing bots, to `fill_to`, at that mark (not spread over the
last 2 s; the oracle pins "filled by 13.1 s"). `lobby_closing` at 15 s then tops up anything that left in between. The
legacy draw order in `lobby_tick` / `lobby_closing` must not change for `Legacy`.

## 7. Behaviour to preserve
- Default flags give today's behaviour exactly; every existing rh-server and parity test passes unchanged.
- Training rooms are unaffected.
- The sim's lobby deadline rule and its fixtures.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-LOBBY-TIMING-1` passes (full).
- `cargo test -p rh-server --test lobby_timing` passes (11 tests; see "Oracle files"). Every `matchmaking_*` test runs
  three flag sets (today's defaults `2/30/5`, the beta host's `1/10/3`, and `1/15/0`) and must give the same timeline.
- The two `legacy_*` timeline tests and `legacy_timing_leaves_the_sim_knobs_alone` pass before and after, unedited.
- Reviewer checks, not covered by a test: the director calls `apply_lobby_timing` in `spawn_room`; the new flag is parsed
  on both the first-playable and the profile paths and defaults to `legacy`; `hosting/` is untouched.

## Oracle files (read-only for implementers)
- `crates/rh-server/tests/lobby_timing.rs`: 8 `matchmaking_*` tests (fail on the stub, by assertion) and 3 `legacy_*`
  tests (pass today; they pin the legacy timeline: one human, `2/30/5`, fill 6: first bot at slot 389, 6 players and the
  raid at slot 600; second human at 3 s: first bot at slot 101, raid at slot 161 with 6 players).
- The three owner-flippable readings have their own tests: `matchmaking_a_full_human_lobby_starts_early_with_no_bot`,
  `matchmaking_bots_fill_the_lobby_at_second_13` (all at once, not spread over 13..15) and
  `matchmaking_clock_runs_from_the_first_humans_arrival`.
- Tick convention: wake number `i` runs at `i * 50 ms`; boundary assertions allow one tick of slack.
- Stub (write scope, not oracle): `LobbyTiming`, `BotFillConfig::lobby_timing`, `BotFillConfig::apply_lobby_timing` in
  `crates/rh-server/src/bot_fill.rs`.

## 9. Validation commands
- `cargo test -p rh-server`
- `cargo run -p rh-parity --bin parity-report`

## 10. Risk and suggested model tier
Sonnet: one crate, server orchestration outside the sim. The risk is breaking the legacy fill fixtures; the default mode
guards that.

## 11. Known traps
- "Second 13" and "second 15" are server time from the first human's arrival, not from room creation (the sim sets
  `lobby_ends_at` when it seats the first player). The bot mark must be taken from the same moment, not from room creation.
- The sim pulls the deadline in when the human minimum is reached: with `--min-players 1` that fires at once. See "the
  seam" above; no sim edit.
- Bots arrive together at second 13, not spread (the legacy 12 s spread, and `ARRIVAL_END_MARGIN_MS`, do not apply in the
  new mode). The oracle pins this stricter reading of "compressed into the last 2 s"; if the owner prefers a spread,
  only `matchmaking_bots_fill_the_lobby_at_second_13` changes.
- A human joining a full lobby takes the newest bot's seat (`room.rs:857-859`); unchanged.
- Not tested here: the flag parsing in `main.rs` / `runtime.rs` (binary code) and the director wiring. The reviewer reads
  them.

## Proposed DEVIATIONS row (for the owner to sign; next free id at the time of writing is DEV-013)
| DEV-013 | platform | Lobby timing is `MIN_PLAYERS_TO_START = 2`, `LOBBY_SECONDS = 30` from the first join, pulled in to `LOBBY_FILL_SECONDS = 5` once two humans are in; fill bots arrive spread over the last 12 s, the last one 1 s before the end (`constants.ts:130-134`, `step.ts:164-171`, `BOT_FILL_DEFAULTS`). | Behind `--lobby-timing matchmaking`: the lobby is 15 s from the first human's arrival; no bot before second 13; at second 13 the lobby is filled with bots to the fill target; the match starts at second 15; a lobby of eight humans starts at once; a second human neither restarts nor shortens the clock; `--min-players`, `--lobby-seconds`, `--fill-seconds` are ignored in this mode. Default `legacy` is the left column unchanged. | Owner direction 2026-11-10 (MIGRATION checkpoint, decision 8): "wait 15 seconds; if by second 13 no match can be found, add bots to the lobby". Evidence: `crates/rh-server/tests/lobby_timing.rs`. | Legacy-mode timeline tests and the bot-fill parity fixtures (`parity/policy/`) stay unchanged and MATCH; no combat or balance number moves. | Drop the flag (or run `--lobby-timing legacy`); delete the `Matchmaking` variant and the row's filter together. | pending |
- An open question for the owner is recorded in the checkpoint: whether a full human lobby starts early. The oracle pins
  "yes" and names that test so it is easy to flip.

## Notes from previous attempts
