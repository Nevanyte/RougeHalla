# Tournament candidate D: bounded admission repairs

Lead decision, 2026-11-08. `deepseek/pending-compose-r2` at `b9f149c9` contains four composed units against base
`455a202f`: A bot-fill overrides, B Committed barter-slot refusal, C quest producer captures, D tournament/telemetry.
Independent source reviews admit A–C subject to the focused union gate. **D is held** despite the lane's green tests.
Merge commits/prefixes, not a whole-tree replacement against a newer lead tip; keep the accepted Unity work and enum names.

The expert repair worker uses a private `codex/tournament-admission-repair` worktree from `b9f149c9`, with an isolated
Cargo target. The primary checkout, DeepSeek refs/WIP, Cargo.lock and shared status records remain lead-owned.

## Required repairs

1. The CLI defaults learning requested On and newly prints it as active, but no learning store is connected. Report
   requested/effective state honestly or reject explicit unsupported activation with an honest default. Do not connect
   a learning writer or add training to repair a diagnostic.
2. `gameMs` must average individual game wall durations. Parallel total wall time divided by game count is throughput,
   not that source statistic. Retain total elapsed wall time separately and preserve report arithmetic/source fixtures.
3. Bound each seat's delayed command queue at the source's 256-command limit, checking overflow **before** drawing
   jitter. Verify FIFO/overflow and RNG consumption with an actual semantic saturation control.
4. Fix authoritative delayed application timing. The policy-only wrapper drains at observation time and adds a step:
   a click at100ms plus100ms delay applies at250ms instead of200ms. Use the existing queued-seat/delivery seam so an
   opt-in headless queue drains before every real step, including steps when the policy is not due. Delivery still uses
   the seat's ItemObserver, validation, submit and delivery feedback. Normal Env behavior stays unchanged. Test actual
   application ticks for zero/sub-tick/exact/non-multiple delay and a slower policy cadence.
5. Rich damage/first-hit tallies currently read only `Event::Hit`, undercounting allowed ability/signature configurations.
   Correct the nonduplicated source-equivalent landed tally with actual-producer controls, or mark unsupported values/
   profiles unavailable explicitly. Never emit incomplete data as complete or silently replace unavailable with zero.

The per-seat jitter stream and command-only delay are diagnostic deviations from the source manager's shared jitter
stream and self/world observation delays. Label them honestly; this repair does not authorize a full delay/brain model.
Preserve deterministic game-index/seat order, serial/parallel values modulo timing metadata, ordinary C-INPUT handling,
joined workers and propagated write/flush errors. Reuse the existing flush-only failure control where present.

## Scope and finish line

Edit only the affected headless runner/CLI/telemetry path, existing policy delivery seam if strictly necessary, focused
tests and packet evidence. No game-rule, live-server, observation, protocol, checkpoint, replay, content-registry or
persistence changes. Preserve current11/24/18/17/13 identities. The RunRecord fixture consumer remains shape-only;
learning, complete recorder/value production, full source manager timing and full-brain outcome parity remain open.

Success: independently reviewable commit(s), actual targeted tournament/runner/delay/report/CLI/telemetry checks,
affected strict lint/fmt and repaired documentation/help. Run one focused union gate after review; no repeated map
campaign or weakened source corpus. Failure/hold: false active learning, unbounded queue/draw drift, extra delayed step,
mislabelled wall statistics, understated complete telemetry, new privileged policy input or unsupported parity claims.
Report exact SHAs, commands/results and remainder; only the lead merges/pushes integration.
