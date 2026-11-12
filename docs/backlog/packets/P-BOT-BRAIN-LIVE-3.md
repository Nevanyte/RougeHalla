# P-BOT-BRAIN-LIVE-3: `rh-server --bot-brain`, seat choice, fault fallback, learning facts (piece 3 of 3)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decision 7; approval 7, 2026-11-12 (see [P-BOT-BRAIN-LIVE-1](P-BOT-BRAIN-LIVE-1.md))
- **Implementer tier:** implementer-opus (live seats; fault handling; learning store contract)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework with P-BOT-BRAIN-LIVE-1 and -2 merged
- **D-rules touched:** D1 loose proof · D2 n/a · D5 none · D9 bots act only through validate + submit

**Status: brief only. Its oracle is written by `oracle-author` after piece 2 lands.**

## 1. ID and outcome
`rh-server --bot-brain off|full` (default `off`: live behaviour, replays and hashes byte-identical). With `full`, fill bots
are seated as `BrainBot`; a faulting Brain seat falls back to `HumanBot`, not `Idle`; Brain choices reach the learner.

## 2. Dependencies
P-BOT-BRAIN-LIVE-2 merged.

## 3. Relevant paths (rechecked 2026-11-12)
- `crates/rh-server/src/room.rs:1164-1190` `seat_fill_bot` (the seat choice: `HumanBot::new(spec.tier, spec.persona)` at :1170, replay `BotPolicy { name: "human", .. }` at :1176, fallback `scripted::Idle` at :1185); `:964-965` training seats
- `crates/rh-server/src/main.rs:297,324` flag parsing (`--fill-bots`), `src/bot_fill.rs`, `src/director.rs`
- `crates/rh-server/src/bot_learning.rs:59` `BotRunFacts`, `:463` `LiveLearning`, `:590` `record`
- `crates/rh-policy/src/lib.rs:298` `Seat.budget`, `:263` `Fault::OverBudget`
- `packages/server/src/bots/BotManager.ts` (learning record at match end), `bots/brain/brain.ts` (`end(result)`)

## 4. New paths
- `crates/rh-server/tests/` or in-crate tests for the oracle (decided by `oracle-author`)

## 5. Exclusive write scope
- `crates/rh-server/src/{main.rs,bot_fill.rs,room.rs,director.rs,bot_learning.rs}`, `docs/DEVIATIONS.md` (the degraded-profile
  row: list every `undefined` leaf from the piece 1 table; owner signs)
- not `hosting/`, `.github/`, `rh-policy` (a policy-side gap goes back to the coordinator)

## 6. Contracts and references
C-INPUT, C-OBS, C-POLICY, C-RNG, R-ML (statistics only); replay `Join` records carry the policy name `"brain"` and the seed.

## 7. Behaviour to preserve
With `--bot-brain off`: seat choice, replay bytes, state hashes and metrics unchanged. Training rooms and void/interrupted
runs write no learning facts.

## 8. Acceptance checks (to become oracle tests)
- flag parse: default `off`; `full` seats `BrainBot` with the replay name `"brain"`; unknown value refused
- a faulting Brain seat is replaced by `HumanBot` mid-match, the room keeps running, the fault is reported once
- `seat.budget` is set for Brain seats
- `Policy::finish` once per resolved run -> `LiveLearning::record` with the Brain's choices (opener, second, spawn, boon, camp);
  nothing for training, void or interrupted runs; no duplicate on close paths
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-LIVE-3` passes (full)

## 9. Validation commands
`cargo test -p rh-server`; with Postgres: `eval "$(tools/pgtest/start.sh)"` then the gate.

## 10. Risk and suggested model tier
High, about 350 lines. Opus, Opus review.

## 11. Known traps
- Learner writes need the single-writer lease and only non-training, non-void runs.
- Do not widen the fill-bot seed path: `BotSeatSpec.seed` is the policy's own randomness.

2026-11-12 (coordinator, from the reviewer-opus review of piece 1 @ 13c5d90e): the degraded-profile DEVIATIONS row
lists, beyond the brief's table: quest-giver names, container weapon when contents are unknown, event names without a
roster row, hit and signature-hit weapon (always unknown), projectile `from` = the wire owner (null when not drawn),
field/container/chest ids built from public cues or positions (two identical ground weapons on one 1/8-unit point
share an id), camp id taken from the map (the wire's camp row has no id), `hud.playerCount` capped by the 32-row
roster, off-screen NPC deaths dropped (an undrawn elite's death announcement is lost), a focused cannon marked
interactable, all events of a frame stamped with its `source_time` with fx before events, a refused frame's events
lost, `build` in card catalog order, no bleed/ability damage ticks, owner notices or `extras.skills`.
Measure `seat.budget` with 8 Brain bots: hot spots are `extras.effects` (a string allocation per drawn row and actor),
`sort_by_key(actor_key)` (allocates per comparison: `sort_by_cached_key`), and the roster `find` per fighter;
`compose()` is one 520-line function to split.
