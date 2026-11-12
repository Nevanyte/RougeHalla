# P-BOT-BRAIN-LIVE-1 hand-off, 2026-11-12 (cloud session)

Worker hand-off, not a coordinator record: no shared status record, `Cargo.lock`, protected path or integration branch was
changed, nothing was merged or deployed. Base: `claude/youthful-cerf-qur7nu` @ `60117c0d` (the packet brief and the
2026-11-11 hand-off). Commits follow the stub/oracle/implementation convention: `567c105d` stub, `807c898a` oracle (fails
against the stub on assertions), `e3e1334e` implementation.

```
PACKET:          P-BOT-BRAIN-LIVE-1 — serves not in the plan: owner beta-follow-up decision 7 (MIGRATION 2026-11-10);
                 degraded fair profile approved by the owner 2026-11-11 (chat)
BRANCH:          claude/festive-babbage-dkwvrm @ e3e1334e (stub 567c105d, oracle 807c898a)
GATE:            see "Gate" below
CHANGED:         new: crates/rh-policy/src/bots/brain_bot.rs (+ brain_bot/tests.rs),
                 crates/rh-policy/src/bots/temporal_percept/brain/{compose14.rs, compose14/tests.rs, room_paths.rs},
                 crates/rh-headless/tests/brain_bots.rs
                 edited: crates/rh-policy/src/{lib.rs, bots/mod.rs, bots/bot.rs, bots/temporal_percept.rs,
                 bots/temporal_percept/brain.rs, bots/temporal_percept/brain/adapters.rs, bots/temporal_percept/memory.rs},
                 crates/rh-headless/src/lib.rs, crates/rh-server/src/{main.rs, bot_fill.rs, bot_fill_tests.rs, room.rs,
                 director.rs, bot_learning.rs, bot_learning/tests.rs}, docs/DEVIATIONS.md
D-RULES:         D1 loose proof: composed percepts pass the frozen source validators (build_percept); D2 n/a;
                 D9: bots act only through validate + submit (the seat path is unchanged)
DEVIATIONS:      proposed DEV-018 (platform): the degraded fair profile, as built (row in docs/DEVIATIONS.md)
SHARED RECORDS:  proposed edits: MIGRATION (record P-BOT-BRAIN-LIVE-1 and DEV-018); backlog row P-BOT-BRAIN-LIVE-1
                 "implemented behind --bot-brain, off by default"; crates/rh-policy/AGENTS.md first paragraph ("the full
                 legacy Brain ... is not wired to live bots") is now stale (protected file: owner edit)
LEGACY DOUBTS:   packages/server/src/bots/brain/memory.ts:563-605 — Memory never forgets a mob; with sample-scoped NPC
                 references that is an unbounded leak (see below)
NOT ESTABLISHED: play quality against the in-process legacy Brain (no tournament comparison); a live room with
                 --bot-brain full and real clients; the learner write path end to end with PostgreSQL (unit-tested
                 with the in-memory backend only); Unity-facing behaviour
RISKS:           Brain seats are passive in the measured runs (one death per 6,000-tick 8-seat match) because mob
                 goals cannot survive the per-tick NPC reference renewal; derived mobKills departs from the literal
                 "undefined" ruling (owner confirmation needed)
```

## What was built

- **Composer** (`compose14.rs`): `Composer14` fences the accepted history with `FairPerceptRing14` (session, sample order,
  clock) and builds the complete source `Percept` record (`BVal`, source own-key order) from the accepted `Frame14` only.
  Unpublished leaves are own `undefined` members; the typed adapters (`adapters.rs`) read each with the source's
  `undefined` behaviour (NaN numbers, a held-but-redacted lock as an id equal to no fighter, a self-equal minimap clock,
  JS truthiness for labels). Names and the bot flag come from the roster group, remote immunity from the delivered
  teleport-immunity flag, the private plan deal is emitted as the source's `private plan` event when the plan group
  changes, event times are the batch tick's server time. Feature verdicts are bound from the server `SimConfig`.
- **Path service** (`room_paths.rs`): open and gate-locked `RoomPathService`s over the public map.
- **BrainBot** (`brain_bot.rs`): seeds from the low 32 bits of `MatchStart.seed`, builds the Brain map projections from
  the arena's public layers, maps released commands through the shared `emit_command` (factored out of `bot.rs`;
  HumanBot is byte-identical: its pickup/choose still resolve to nothing). A Brain-native error is
  `InputRefusal::PolicyFailed`; a runtime without the source lifecycle is `InputRefusal::ArenaUnavailable`; either faults
  the seat to its fallback.
- **`Policy::finish` / `Seat::finish`** (once only, panics caught, never for an unattached policy or the fallback).
- **rh-server**: `--bot-brain off|full` (default off; off is today's HumanBot + Idle, no budget, replay name "human").
  Full seats `BrainBot` with the fill config's learning snapshot, HumanBot as the fault fallback,
  `seat.budget = BRAIN_DECISION_BUDGET` (40 ms) and replay name "brain". A resolved bot's `Seat::finish` choices travel
  in `RoomReport::Result.bot_choices` to `LearningSink::record_choices`; `LiveLearning` records them before the
  manager's faction key (source `onResult` order).
- **rh-headless**: `BotKind { Brawler (default), Human, Brain }` and `run_bot_match_kind`; `run_bot_match_config` is
  unchanged. The tournament binary's `--policy` was NOT added (the tournament seats HumanBot in `tournament.rs` and its
  plan struct is built literally in tests outside the write scope).

## Two decisions the owner should confirm

1. **`self.mobKills` is derived, not undefined.** An `undefined` count makes `feed_score` NaN, so every farm candidate
   scores NaN and the softmax/sort orders diverge from anything sensible. The composer counts the seat's own accepted
   `Death` events of regional mobs credited to it (`by == me`). It is an under-count only if a credited death is outside
   this seat's sight.
2. **Memory drops mob records whose reference is gone** (`Brain::use_sample_scoped_mob_ids`, live seats only; the
   frozen-corpus paths keep the source rule). NPC references renew every tick (`rh-sim/src/actor_refs.rs`), and source
   Memory keeps every mob for the run: kept, the record list grew by the visible mobs every tick and decisions became
   quadratically slower (a 2,400-tick 8-seat run did not finish in minutes). The fair fix is an entitled per-session NPC
   continuity provider (field-closure "needs provider"); until then mob goals cannot persist across ticks.

## Measurements

- `cargo test --release -p rh-headless --test brain_bots` (8 Brain seats, source-arena profile, seed1 map, 6,000-tick
  cap, two seeds × two runs in parallel, 69 s on 4 cores): no fault, every seat proposed and had every proposal
  accepted, seed 3 one death (first at tick 5,976), seed 11 one death (tick 3,827), equal hashes per seed
  (`5c697bc96ea735ba`, `23505433ab458c99`), both replays verify every step. The test is ignored in debug builds (over ten
  minutes); the debug suites keep the shorter Brain seat tests in rh-policy.
- Per-seat decision CPU (release, `profile_brain_seats`, 8 seats, 2,400 ticks, earlier run on the same code): mean
  0.20-0.33 ms, p99 0.76-1.85 ms, max 5.6-15.8 ms; the composer is 14-22% of it. P-BOTS-1 target: mean < 1.5 ms,
  p99 < 6 ms.
- Seats are passive: 10-259 proposals per seat over 6,000 ticks.

## Gate

See the final message of the session for the result of `scripts/gate.sh --base origin/claude/youthful-cerf-qur7nu`
(full, no Postgres; run with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` because the container's disk allowance
filled with debuginfo on the first attempt).
