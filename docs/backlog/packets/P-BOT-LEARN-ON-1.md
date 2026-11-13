# P-BOT-LEARN-ON-1: the headless tournament seats Brain bots and runs the legacy learner

- **Serves:** owner beta-follow-up decision 7 (MIGRATION, 2026-11-10: "turn the legacy learner on"); plan lane F
  item 2; R-ML narrow exception (REQUIREMENTS, 2026-11-12)
- **Implementer tier:** implementer-opus (cross-crate: rh-headless, rh-policy)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof; existing `parity/policy` learner fixtures stay green · D9 bots act only
  through validate + submit · R-ML: the ported legacy learner only

## 1. ID and outcome
The legacy learner is ported (`crates/rh-policy/src/bots/learning.rs`: `DOMAINS` eight domains `:25`, `Stats` `:124`
with `snapshot` `:167` and `apply` `:179`, `LearnedBias` `:269`, `LEARN_EXPLORE = 0.05` `:17`) and the live server
records Brain choices (`crates/rh-server/src/bot_learning.rs`: `LiveLearning`, `record_choices` `:599`). The headless
tournament cannot use either: `TournamentPlan` has `learn: bool` (`crates/rh-headless/src/tournament.rs:87-99`) but
refuses it ("tournament learning is unsupported; use learning off", `:536-537`; the binary refuses `--learn on` at
`src/bin/tournament.rs:49-50`), and the binary has no way to seat Brain bots (`BotKind { Brawler, Human, Brain }` is
`crates/rh-headless/src/lib.rs:521`; `run_bot_match_kind` `:593`).

When this lands, `tournament --policy brain --learn on` plays a seeded series of headless matches with Brain seats,
feeds each finished match's choices and placements into an in-memory learner store in the legacy order, hands the
frozen bias snapshot to the next match's seats, and writes the final store and bias as a JSON file. Same seed and
plan, same file, byte for byte. `--learn off` and the default policy behave exactly as today.

## 2. Dependencies
- P-BOT-BRAIN-RECONCILE-1 merged (in the base). Meaningful learning needs P-BOT-BRAIN-CONTINUITY-1 (Brain seats are
  passive until it lands): this packet builds and proves the machinery; the long runs come after.

## 3. Relevant legacy paths
- `packages/server/src/bots/tournament/` (the runner; `tune.ts` is the next packet) and
  `packages/server/src/bots/BotManager.ts` (`onResult`: the order in which choices and the faction key are recorded)
- `packages/server/src/bots/brain/learning*.ts` as ported in `rh_policy::bots::learning` (do not re-port)

## 4. New paths
- `crates/rh-headless/tests/tournament_learning.rs`; a small in-memory store type in `crates/rh-headless/src/`

## 5. Exclusive write scope
- `crates/rh-headless/src/{tournament.rs,lib.rs,bin/tournament.rs}` and its tests
- `crates/rh-policy/src/bots/learning.rs` only for a missing public accessor (name each); not `brain_bot.rs`,
  `compose14.rs`, `memory.rs`, `mob_tracks.rs` (P-BOT-BRAIN-CONTINUITY-1 owns them)
- Not `crates/rh-server/` (the live path is unchanged), not `crates/rh-persist/`

## 6. Contracts and references
- R-ML narrow exception (docs/REQUIREMENTS.md): the ported learner only: a decayed mean of placement per choice key
  with 5 percent exploration; no model, no dataset kept beyond the store, no Python.
- C-RNG: exploration draws come from the policy's own seeded stream, never the sim's; C-INPUT; determinism.

## 7. Behaviour to preserve
- `tournament` with today's arguments produces today's output byte for byte; the `parity/policy` learner fixtures;
  the live server's learning path.

## 8. Acceptance checks
- A two-match Brain tournament with `--learn on`: the store after match 1 holds a cell for every choice the seats
  reported, updated by the legacy rule with the placements of that match; match 2's seats were built with that
  snapshot; the output file round-trips; two runs with the same seed give identical files.
- `--learn on` with a policy that reports no choices is refused with a message; `--learn off` is byte-identical to
  today (golden of a short run).
- A faulted Brain seat contributes no choices (as `Seat::finish` now returns none).
- `scripts/gate.sh --oracle packet/P-BOT-LEARN-ON-1` passes (full).

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/tournament_learning.rs`
- `crates/rh-headless/tests/fixtures/tournament_learn_off.json` (golden of today's runner: `small_plan(2)`, seed 7,
  E,N,H, the fast lifecycle, learning off, HumanBot seats; generated from 038f83c8 before any implementation)

## Verified against the code (oracle author, 2026-11-12)
- Paths and lines above checked at 038f83c8. `BotKind` is `lib.rs:523`, `run_bot_match_kind` `:593`.
- The CLI parser and `USAGE` live in `crates/rh-headless/src/tournament_cli.rs`, outside the write scope, and its
  `args_json` is compared to the pinned source CLI corpus. So the new flags (`--policy human|brain`, `--learn-out FILE`)
  are taken out of argv by `tournament_learning::split_learning_args` in the binary before the source parser sees it,
  and `TournamentPlan` gets no new field (no literal changes; `--json` payloads unchanged). The `USAGE` line saying
  `--learn on` is refused becomes stale: proposed edit for the coordinator.
- Source order (`BotManager.onResult` :471-484): a seat is recorded when its result arrives, as `runner.end(result)`
  choices then `faction|<persona>|<faction>`; a seat that never resolved records nothing. The live server does the
  same (`rh-server/src/room.rs:1657-1665`, `bot_learning.rs:599`), and records the faction key even when the seat's
  `finish` is `None` (faulted). The oracle pins that: a faulted seat contributes no Brain choices, only the faction key.
- Source learning keeps one store per worker batch (`tournament/worker.ts:111-125`), so a source learning run depends
  on the worker count. The port plays a learning series in plan order with one store (proposed DEVIATIONS row).
- New module: `crates/rh-headless/src/tournament_learning.rs` (the store, the series runner, the flag split);
  `Env::finish_seat` in `lib.rs` exposes `Seat::finish`.
- A Brain game on the practice arena with patience 3 s / sudden death 2 s resolves in about 950 ticks (~0.3 s debug).

## 9. Validation commands
- `cargo test -p rh-headless`; `cargo run --release -p rh-headless --bin tournament -- --help`; `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The recording order is behaviour: a different order of `apply` calls gives a different store.

## 11. Known traps
- The tournament's plan struct is built literally in tests: adding a field needs every literal updated (list them).
- No new dependency (`Cargo.lock` is the coordinator's).

## Notes from previous attempts
