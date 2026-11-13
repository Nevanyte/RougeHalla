# Hand-off: P-BOT-LEARN-ON-1 (2026-11-12)

```
PACKET:          P-BOT-LEARN-ON-1 — serves owner beta-follow-up decision 7 (MIGRATION 2026-11-10, "turn the legacy
                 learner on"); plan lane F item 2; R-ML narrow exception clause 1 (the ported learner only)
BRANCH:          agent/claude/P-BOT-LEARN-ON-1 @ 7581eb46 (gated; this hand-off commit is docs only) (packet/P-BOT-LEARN-ON-1 @ b7c2150d: stub 903c55dc, oracle b7c2150d)
GATE:            PASS (full, with PostgreSQL 16: rh-server and rh-placement Postgres suites ran)
                 [not run: CI/owner-hardware checks the gate lists: capture --check, perfproof, cross-arch
                 determinism, browser proof, Unity Web build]. Earlier full runs failed only in rh-server: once
                 "Connection refused" (shared pgtest cluster stopped by another session), once
                 runtime_admission::source_endpoint_hello_planning_ready_and_live_quest_trade_state timing out at
                 load average ~56 (passed 2 of 3 standalone reruns, 2.5 s each; rh-server is untouched here).
CHANGED:         crates/rh-headless/src/tournament_learning.rs (new), crates/rh-headless/src/{lib.rs,tournament.rs,
                 bin/tournament.rs}, crates/rh-policy/src/bots/learning.rs (one accessor: Stats::entry_order);
                 oracle: crates/rh-headless/tests/tournament_learning.rs, tests/fixtures/tournament_learn_off.json
D-RULES:         D1 loose proof: the learner is not re-ported; the oracle pins the plumbing (legacy record order,
                 snapshot hand-over, refusal, file) and folds records with rh-policy's own Stats::apply; parity/policy
                 fixtures untouched and green. D2 n/a. D9: Brain seats act only through the ordinary seat path
                 (validate + Sim::submit); the store is read only as a frozen LearnedBias at seat construction.
                 C-RNG: exploration draws stay inside the Brain's own seeded stream (unchanged code).
DEVIATIONS:      proposed DEV-028: a learning tournament plays its games one after another in plan order through one
                 store (source tournament/worker.ts:111-125 keeps one store per worker batch, so a source learning run
                 depends on the worker count); same plan and seed give the same store on any machine.
SHARED RECORDS:  proposed edits: crates/rh-headless/src/tournament_cli.rs USAGE (outside this write scope): the
                 "--learn on|off ... explicit on is refused" line is stale; suggested text "learning off by default; on
                 needs --policy brain (see --policy, --learn-out)". docs/MIGRATION.md checkpoint: record the packet.
                 docs/DEVIATIONS.md: DEV-028 above.
LEGACY DOUBTS:   none on the order (BotManager.ts:471-484 is unambiguous). Live server and this port both record the
                 faction key for a faulted seat whose finish is None (rh-server room.rs:1657-1665 +
                 bot_learning.rs:599); legacy has no notion of a faulted seat, so this follows the live Rust path.
NOT ESTABLISHED: that learning improves anything. Brain seats are passive until P-BOT-BRAIN-CONTINUITY-1: in every
                 short run here the Brain reported no choices of its own, so the stores hold only the manager's
                 faction|persona|faction keys. The Brain-choice path (opener/spawn/boon/... keys) is proven only by
                 the hand-made records in the oracle and by Env::finish_seat returning Some for a seated Brain.
                 Long learning campaigns were deliberately not run. Learning runs ignore --workers (sequential).
RISKS:           Env::finish_seat lets a caller ask a seat for its summary mid-match (only once; the tournament calls
                 it at the Resolved event, as the live room does). The default tournament path (HumanBot) now goes
                 through run_game_seats with a no-op hook; the learning-off golden pins it byte for byte.
```

## How to run

```
cargo run --release -p rh-headless --bin tournament -- --policy brain --learn on --games 20 --learn-out store.json
```

`--policy brain` without `--learn on` seats Brain bots with learning switched off (parallel workers, plan order).
`--learn on` with the default policy is refused (exit 2) with the message the existing CLI test pins
("no learning store is activated").

The store file: `{"plan": {...,"policy":"brain"}, "store": {"format":"rh-bot-learning/1","version":1,
"baseline":{tier:{n,s}}, "entries":{key:{n,s}} (sorted), "order":[keys oldest first], "bias":{key:bias}}}`.
`order` keeps the eviction age, so `LearnStore::from_json` restores an equal `Stats`.

## Notes for review

- The new flags are split out of argv in the binary (`split_learning_args`) before the source parser, because the
  parser and `args_json` (compared to the pinned source CLI corpus) live in `tournament_cli.rs`, outside the scope.
  `TournamentPlan` gained no field, so no literal and no `--json` payload changed.
- `cargo fmt` reformatted the oracle test file once before the agent branch existed; the formatting was folded into
  the oracle commit (amended before anything was pushed). No oracle file differs on the agent branch.
- Gate runs: the default pgtest state directory is shared between sessions; a private `RH_PGTEST_STATE` avoids another
  session's `stop.sh` taking the cluster down mid-run. `runtime_admission`'s quest/trade test is load-sensitive.

## git diff --stat packet/P-BOT-LEARN-ON-1

```
 crates/rh-headless/src/bin/tournament.rs      |  57 +++++-
 crates/rh-headless/src/lib.rs                 |   6 +-
 crates/rh-headless/src/tournament.rs          |  31 +++-
 crates/rh-headless/src/tournament_learning.rs | 255 +++++++++++++++++++++++---
 crates/rh-policy/src/bots/learning.rs         |   5 +
 5 files changed, 309 insertions(+), 45 deletions(-)
```
