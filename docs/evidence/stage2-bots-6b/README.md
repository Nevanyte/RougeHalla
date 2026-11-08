# P-BOTS-6 remainder — the tournament CLI surface, the full report/evaluate layout and the complete --json payload

Historical slice evidence below. The current composed runner boundary, learning gate, command-delay scope,
measurement fixes and remaining telemetry gaps are recorded in [the admission repair](../tournament-admission-repair/README.md).

Status: **slices 1-2 DONE-VERIFIED; the P-BOTS-6 packet remains INCOMPLETE** (the brain-layer hunt/tactics counters and the items named below are the exact gap). PR #62 in the P-BOTS-6 stack. Branch `deepseek/p-bots-6b`, base
`deepseek/p-bots-6` @ `f87727dd` (the tournament tip), PR target `deepseek/p-bots-6`, stack stated in the PR.

## What landed

- **The full source CLI surface** (`crates/rh-headless/src/tournament_cli.rs`, wired by
  `crates/rh-headless/src/bin/tournament.rs`): the source `TournamentArgs`/`parseArgs`/`planOf`/`USAGE` —
  `--games`, `--workers`, `--lineup`, `--seed`, `--learn on|off`, `--persona mix|farmer|hunter|opportunist|cautious`,
  `--faction mix|fire|sentenced|plague|frost|holy`, `--json FILE`, `--max-minutes`, `--patience`, `--sudden`,
  `--latency`, `--jitter`, `--tune JSON|@file`, `--telemetry DIR` (`--telemetry-dir` alias), `--quiet`, `--help`, both
  `--flag value` and `--flag=value`, `--` skipped, the source defaults and the source plain error strings. Exit code 2 on
  a parse error with the usage text, like the source.
- **The plan payload** (`TournamentPlan`): the source planOf fields — games, seed, tiers, persona/faction choice, learn,
  maxSimMs, the patience/sudden-death config patch (with `patienceMinSeconds = 40%`), latency/jitter, tune, telemetryDir.
  `sim_config_for(plan)` applies the patience/sudden patch to the headless sim config, so those two flags change the run,
  not just the payload. `--workers` is carried in the plan/meta (the ported runner plays the games in index order in one
  thread; worker-thread play is the P-BOTS-6 remainder item 4).
- **The --json export**: the source payload shape `{meta, plan, report, games}` with source names (camelCase) and the
  source NaN-as-null convention for a figure with no data; the meta carries the wall and per-game wall (the only clock
  reads, in the binary), the plan is the source planOf object, the report and games are the ported reduced summaries.
- **The telemetry surface**: `--telemetry DIR` writes one reduced summary NDJSON line per game to
  `DIR/runs-<UTC day>.ndjson` (the source telemetry record format, docs/TELEMETRY.md, is the remainder below; the
  flag/file surface is ported and documented, never silently dropped).
- **--tune is explicit**: the flag is parsed (inline JSON or @file) and carried in the plan payload, but the ported runner
  **refuses to run** a tune diagnostic: the TIERS/PERSONAS tables are compile-time constants in rh-policy and the patch
  cannot be applied yet, so the CLI exits 2 with that reason instead of silently ignoring the patch (source tune.ts table
  overrides are the remainder below).
- **No wire, schema, observation, checkpoint or protocol change**; no Cargo.lock edit; only rh-headless, the pinned
  corpus, its capture tool and this evidence directory changed. `cargo fmt`/clippy clean, full workspace gate below.

## Pinned corpus extension (new primitives only)

`parity/policy/bot-tournament.json` (rh-bot-tournament-source/1) now also pins the CLI primitives that were ported:
**28 parseArgs cases** (defaults, every flag, `--flag=value`, `--`, help, and the source error strings for a
non-integer game count, a bad learn/persona/faction value, an unknown flag, a missing value, a negative seed) and
**6 planOf cases** (the default plan, a reordered lineup, fixed persona+faction, the patience/sudden config patch,
latency/jitter/telemetry, tune and max-minutes), in the source's serialized shape. The corpus grew from 1,171 to
**1,205 cases**; its SHA256 is now `044eeec5a1b14da6be08e71cf5df74623733456ea76ae754b4e23b3778a86d45`. It is still written by
`tools/bot-tournament-fixtures/capture.sh` only in the pinned Linux amd64 Node 22.23.4 container and byte-checked by
`--check`; the Rust parity tests replay every new row: `the_cli_surface_matches_the_actual_source` (arguments and plain
errors) and `the_json_export_keeps_the_source_names_and_null_for_absent_figures` (the export shape/null rule).

## Gate (final tree)

`cargo test --workspace --all-features --locked` (pinned PostgreSQL) => 1,476 passed, 0 failed, 3 ignored, 154 test binaries, exit 0; clippy
`--workspace --all-targets --all-features --locked -- -D warnings` => exit 0; `cargo fmt --all -- --check` => exit 0.
Focused: `cargo test -p rh-headless --test tournament` 10/10 (8 existing + the two new CLI/export tests); the pinned
container capture `--check` is byte-identical.

## Slice 2 — seat telemetry extraction, the full report layout and the complete --json payload (task-33)

Status: **slice DONE-VERIFIED; the P-BOTS-6 packet remains INCOMPLETE** for the exact gap below (the hunt/tactics counters
have no producer yet in the ported policy). Everything the source report and evaluate() read from the ported policy and
from public match facts is now produced, laid out and evaluated exactly.

### What landed

- **Seat telemetry extraction.** `rh_policy::PolicyStats` is the owned snapshot of the source BrainStats humanizer block;
  `Policy::stats()` (default `None`, so every earlier policy is unchanged) is implemented by `HumanBot` from
  `HumanizerStats` (all 10 command-type counters, raw reaction samples per stimulus kind, target clicks, miss/wrong,
  hesitations, lapses, throttled, superseded, APM peak). `Seat::stats()` exposes it per seat and
  `Env::seat_telemetry()` returns it in seat order after a match.
- **The runner summary.** `BotBehaviour` carries the humanizer block in the source shape (commands sorted by name like
  `sortedRecord`, reactions sorted by kind with the source `Math.round` ms, commandsTotal, the click/APM counters) plus the
  hunt/tactics/goals counters as `Option`s that stay absent (never zeroed) until those brain layers land. `BotSummary` now
  carries `mobKills`, `damage`, `mobDamage`, `firstMobKillMs` and `tpHp`, tallied from the public hit/death events exactly
  as the source fx observer does (damage to players vs mobs, kills vs mob kills, first kill/mob kill); `GameSummary` now
  carries `firstKillMs`, `deathLog` and `firstHits` (pair first-hit tuples with the source's rounded hp shares and busy
  flags). Timer semantics are explicitly out of this slice: `sudden_death_ms` stays null on real runner games exactly as at
  the base commit (the lead's timer-repair slice owns the burn clock); the report/format/evaluate/JSON code still carries
  and renders the source `suddenDeathMs` field from declared source games in the pinned corpus.
- **The full source report.** `TierAgg`/`Report` are now the complete source shapes, and `aggregate` computes the per-tier
  damage/mob-damage/mob-kill splits, never-fought, deaths, reactions (per-kind p10/p50/p90/mean/table and the pooled plain
  kinds), target clicks, miss/wrong rates, APM mean/peak/limit/breaches, dodges/jukes/orb-walk/hesitations/throttled/max
  stall/stalls, the groups and the duration/first-death/teleport/sudden shares.
- **formatReport and evaluate().** `format_report_with(report, meta)` is the source `formatReport` layout line for line —
  header, games/length/first-death lines, the optional throughput and per-game lines, PER TIER, HOW THEY DIED, REACTION
  DELAYS per tier with the pooled row, CLICKS/RATE/MANEUVERS, PER PERSONA, PER FACTION, MANAGER and the CRITERIA block —
  and `evaluate()` is the source `evaluate` criterion list (place/win ordering, non-overlap, win bands, reaction ratio,
  refused/errors/breaches/capped/stalls), with the source's n/a rendering for an uncheckable verdict.
- **The complete --json payload.** The export is the source `{meta, plan, report, criteria, games}`: report with all source
  fields, `criteria` as `{ok, text}` (null verdicts preserved), games with the source GameSummary fields (firstKill,
  deathLog, firstHits, teleport/sudden death, manager) and bots with the full BotGameSummary shape — id/name, kills,
  mobKills, damage, mobDamage, deaths, gv, diedAt, firstMobKill, tpHp, diedTo and the behaviour block (commands, reactions,
  clicks/APM counters; the unported hunt/tactics counters as null, never zeroed). `--telemetry` now writes those richer
  game records as NDJSON (the full docs/TELEMETRY.md record remains the documented remainder).
- No wire, schema, observation, checkpoint or protocol change; no Cargo.lock edit; no MIGRATION/CONTRACTS status table edit.

### Pinned corpus (new primitives only)

`parity/policy/bot-tournament.json` now also pins a `reportViews` section: three views — two behaviour-populated source
GameSummary sets (one with wall timing, one stored/report-only) and the empty set — each recording the source `aggregate`
report JSON, the source `formatReport` string under a declared meta and the source `evaluate` criteria. The corpus is
**1,208 cases** (302,231 bytes), SHA256 `5d8f1fff55038787e8732d6373d789ba1877c9a1c04cf5d5d5e7c1e9d5182310`, still written
only by `tools/bot-tournament-fixtures/capture.sh` in the pinned Linux amd64 Node 22.23.4 container and byte-checked by
`--check`. The new test `the_report_views_match_the_actual_source` replays every view: the Rust aggregate reproduces the
source report JSON field for field (numbers by value), the printed layout matches the source string exactly and every
criterion verdict/text matches. The existing runner tests were updated where the port now observes more: the source header
layout and determinism (compared by the rendered report, because absent telemetry is NaN and NaN is not reflexive); the
teleport test pins that the timer-owned sudden-death figure stays null in this slice.
- **Timer scope, no overlap:** this slice does not edit `default_sim_config`, `sim_config_for`, `default_config` or any
  lifecycle/timer/config wiring, and derives nothing from the timer clocks inside `run_game`; the run_game work here is the
  per-tick public-event telemetry tally (hit/death/first-hit/tpHp) and the summary builder. The textually overlapping
  hunks with the lead's timer-repair branch are exactly those `run_game` telemetry/summary hunks; the lead resolves the
  merge order.

### Mutants

The tournament mutant suite is now **6/6 killed, unchanged control passes**
(`tools/bot-tournament-fixtures/run-mutants.sh`): the four earlier report/schedule mutants, plus a new evaluate win-band
mutant and a new printed reaction-ratio mutant; the share-of-wins mutant was regenerated for the rewritten tier aggregate.

### Gate (final tree)

**Gate (final tree).** `cargo test --workspace --all-features --locked` (pinned PostgreSQL) => **1,477 passed, 0 failed, 3 ignored, 154 test binaries, exit 0**; workspace clippy `--all-targets --all-features --locked -- -D warnings` => exit 0; `cargo fmt --all -- --check` => exit 0. Focused: `cargo test -p rh-headless --test tournament` **11/11**; pinned-container corpus `--check` byte-identical; the tournament mutant suite **6/6 killed, unchanged control passes**.

### Exact gap (why the packet stays INCOMPLETE)

The source BrainStats also carries counters written by the hunt/tactics/goals layers (mobTargets, mobDrops, retreats,
mobFocusMs, grabs, maxStallMs, dodges, jukes, kiteCycles, goals). Those layers are the P-BOTS-1/P-BOTS-3/P-BOTS-4
remainder and are not ported into the policy, so no producer exists for them: the port keeps them `None`, prints `-` in
those columns (the source's own absent-figure rendering) and emits null in JSON — it does not invent zeros. Producing
them needs the brain layers, not a report change. The remaining P-BOTS-6 items also include the full docs/TELEMETRY.md
record body, worker-thread parallel play and the source simulated latency/jitter and learning store.

## Exact remainder for P-BOTS-6 (this slice does not claim these)

1. **formatReport's full source column layout and evaluate() pass criteria**, and with them the full report fields:
   per-tier damage/mob-damage/mob-kills splits, never-fought, reactions (p10/p50/p90/table/ratio and pooled), clicks/
   miss/wrong, APM (mean/peak/limit/breaches), dodges/jukes/orb-walk/hesitations/throttled/max stall and the source
   criteria lines. They need the humanizer telemetry block of the bot brain (the P-BOTS-6 remainder item 1), which the
   reduced GameSummary does not carry; the printed report stays the reduced layout and the JSON report keeps the reduced
   fields.
2. **--json payload completeness**: the source `criteria: evaluate(report)` array and the full source GameSummary fields
   (firstKill, deathLog, firstHits, firstMobKill, tp hp, behaviour block) are absent with the same dependency.
3. **tune.ts table overrides**: parse (done) and apply the TIERS/PERSONAS patch through the policy tables; the runner
   currently refuses it explicitly instead of ignoring it.
4. **full docs/TELEMETRY.md records**: the ported telemetry surface writes the reduced summary per game; the source
   record (behaviour/reactions/manager detail and the day file semantics) lands with item 1.
5. **worker-thread parallel play** (split is ported; the runner stays single-threaded by design here) and the source
   simulated latency/jitter of the bot fill config (`--latency`/`--jitter` are parsed and carried, not simulated), plus
   the learning store (`--learn` is carried, P-BOTS-5).

Items 1-5 are exactly the P-BOTS-6 evidence remainder; no game-outcome parity is claimed against the legacy tournament.