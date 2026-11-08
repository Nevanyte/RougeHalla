# Bounded tournament admission repair

Private branch `codex/tournament-admission-repair`, based on immutable composed candidate
`b9f149c99533fa1b8b5a159db2da200c5bcb2e7e`. This repairs candidate D; it does not admit the
candidate or alter primary, observation 17/policy 13/protocol 11, checkpoint 24, replay 18 or content.

## Result and boundaries

- Actual tournament play defaults to learning **off**. Explicit CLI `--learn on` fails before
  playing/writing output; library play rejects an enabled plan. No store is installed. The source
  parser defaults on: its unchanged corpus retains that fact, and the comparison names/asserts the
  single deliberate absent-option default deviation. Explicit option parsing and all other source
  parser/report comparisons remain pinned.
- `play_measured` times each individual worker game. `gameMs` averages those durations; `wallMs`
  independently measures the entire parallel play call. Pure play results contain no clock and
  remain equal serially and in parallel. Timers, writer errors and final flush errors are preserved.
- Delay is opt-in and command-only. Each seat holds at most the source's 256 pending commands;
  overflow is refused **before** drawing jitter or updating the FIFO arrival clock. Normal Env
  construction still uses the prior direct-drive path. The optional path uses existing
  `drive_seats_queued`, then drains before every actual upcoming fixed step. It resolves through
  the seat's ItemObserver, records validated attempts, calls `Sim::submit` and notes accepted/refused
  delivery. Policy decisions receive no future clock, privileged state or delayed observation.
- The source's `afterPatch` produces commands and `beforeStep(stepT)` delivers arrival<=stepT.
  Real Env assertions cover a click at 100ms with delay 0/1/50/100/120ms applying at
  150/150/150/200/250ms, respectively. A slower policy clicks at 200ms and applies its 100ms-delayed
  command at 300ms, between decisions. A completed observation step cannot be retroactively changed.
- RNG ownership is intentionally a **diagnostic deviation**: independent per-seat jitter streams
  derive from policy seeds; legacy BotManager uses one manager-wide line stream. The runner also
  retains its reduced Env identity/seed construction and undelayed observations. This is no claim
  of full manager/network/source-game parity.
- Rich damage/first-hit telemetry is available only in the reduced melee profile. Any enabled
  faction/ability/mob/terrain/loot/quest/training profile is conservatively unavailable: typed
  `Option` fields `BotSummary.damage`, `mob_damage`, `GameSummary.first_hits` become `None`, JSON
  null; dependent damage aggregates and `neverFought` print unavailable. This prevents Hit-only
  tallies silently omitting SignatureHit/AbilityHit chunks. Playing those profiles is not blocked;
  adding correct chunk accounting requires its own source-equivalence proof.
- The fixture-only full RunRecord shape remains disconnected. No recorder hooks, persistence
  writes, memory/strategy, schema/visibility changes, ML or gameplay are activated.

## Checks

`checks.json` records tool versions and the exact scoped command: 47 passed, 0 failed, 0 ignored
across headless library, tournament, CLI timers, runner, telemetry shape, Env, bots and item offers.
Affected all-target/all-feature strict Clippy and formatting pass. Existing timer/flush-only sink,
replay, handle/privacy and serial/parallel value controls are retained. No fixture bytes changed;
no map campaign, full workspace test or source recapture was run for these Rust-only adaptations.

Two compiled semantic mutations fail with exit 101, then the restored 47-test control passes:

1. Draining at the old observation clock reproduces the extra step: 1ms delay applies at 200ms
   instead of 150ms.
2. Consuming a jitter draw on overflow changes the next accepted arrival from 1086.2963942438364ms
   to 1107.4226079508662ms. The second seat and queue capacity are also controlled.

Source anchors (hashes in `source-hashes.json`): `BotManager.ts`'s MAX_QUEUED/deliver/beforeStep,
`tournament/worker.ts`'s per-game wall measurement, `runTournament.ts`'s mean worker duration and
learning behavior, and `tournament/game.ts`'s hit observer. Private raw logs live alongside this
checkout in the task directory (`final-tests.log`, `clippy.log`, `fmt.log`, `mutant-*.log`).

Integration API notes: no external Env constructor changed; `new_delayed` is crate-private.
`GameResult` stays deterministic; `MeasuredGame`, `play_measured` and `mean_game_ms` are additive
diagnostic APIs. Rust consumers of the three damage/first-hit fields must handle `Option`; the
in-repo fixture adapter and JSON/report consumers are adapted. No public game protocol changed.
