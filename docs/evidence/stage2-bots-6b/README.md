# P-BOTS-6 remainder — the tournament CLI surface, plan payload, --json export and telemetry surface

Status: **slice DONE-VERIFIED; the P-BOTS-6 packet remains INCOMPLETE** (the full print layout, evaluate() criteria,
tune application and full telemetry records are named below). Branch `deepseek/p-bots-6b», base
`deepseek/p-bots-6» @ `f87727dd» (the tournament tip), PR target `deepseek/p-bots-6», stack stated in the PR.

## What landed

- **The full source CLI surface** (`crates/rh-headless/src/tournament_cli.rs», wired by
  `crates/rh-headless/src/bin/tournament.rs»): the source `TournamentArgs»/`parseArgs»/`planOf»/`USAGE» —
  `--games», `--workers», `--lineup», `--seed», `--learn on|off», `--persona mix|farmer|hunter|opportunist|cautious»,
  `--faction mix|fire|sentenced|plague|frost|holy», `--json FILE», `--max-minutes», `--patience», `--sudden»,
  `--latency», `--jitter», `--tune JSON|@file», `--telemetry DIR» (`--telemetry-dir» alias), `--quiet», `--help», both
  `--flag value» and `--flag=value», `--» skipped, the source defaults and the source plain error strings. Exit code 2 on
  a parse error with the usage text, like the source.
- **The plan payload** (`TournamentPlan»): the source planOf fields — games, seed, tiers, persona/faction choice, learn,
  maxSimMs, the patience/sudden-death config patch (with `patienceMinSeconds = 40%»), latency/jitter, tune, telemetryDir.
  `sim_config_for(plan)» applies the patience/sudden patch to the headless sim config, so those two flags change the run,
  not just the payload. `--workers» is carried in the plan/meta (the ported runner plays the games in index order in one
  thread; worker-thread play is the P-BOTS-6 remainder item 4).
- **The --json export**: the source payload shape `{meta, plan, report, games}» with source names (camelCase) and the
  source NaN-as-null convention for a figure with no data; the meta carries the wall and per-game wall (the only clock
  reads, in the binary), the plan is the source planOf object, the report and games are the ported reduced summaries.
- **The telemetry surface**: `--telemetry DIR» writes one reduced summary NDJSON line per game to
  `DIR/runs-<UTC day>.ndjson» (the source telemetry record format, docs/TELEMETRY.md, is the remainder below; the
  flag/file surface is ported and documented, never silently dropped).
- **--tune is explicit**: the flag is parsed (inline JSON or @file) and carried in the plan payload, but the ported runner
  **refuses to run** a tune diagnostic: the TIERS/PERSONAS tables are compile-time constants in rh-policy and the patch
  cannot be applied yet, so the CLI exits 2 with that reason instead of silently ignoring the patch (source tune.ts table
  overrides are the remainder below).
- **No wire, schema, observation, checkpoint or protocol change**; no Cargo.lock edit; only rh-headless, the pinned
  corpus, its capture tool and this evidence directory changed. `cargo fmt»/clippy clean, full workspace gate below.

## Pinned corpus extension (new primitives only)

`parity/policy/bot-tournament.json» (rh-bot-tournament-source/1) now also pins the CLI primitives that were ported:
**28 parseArgs cases** (defaults, every flag, `--flag=value», `--», help, and the source error strings for a
non-integer game count, a bad learn/persona/faction value, an unknown flag, a missing value, a negative seed) and
**6 planOf cases** (the default plan, a reordered lineup, fixed persona+faction, the patience/sudden config patch,
latency/jitter/telemetry, tune and max-minutes), in the source's serialized shape. The corpus grew from 1,171 to
**1,205 cases**; its SHA256 is now `044eeec5a1b14da6be08e71cf5df74623733456ea76ae754b4e23b3778a86d45». It is still written by
`tools/bot-tournament-fixtures/capture.sh» only in the pinned Linux amd64 Node 22.23.4 container and byte-checked by
`--check»; the Rust parity tests replay every new row: `the_cli_surface_matches_the_actual_source» (arguments and plain
errors) and `the_json_export_keeps_the_source_names_and_null_for_absent_figures» (the export shape/null rule).

## Gate (final tree)

`cargo test --workspace --all-features --locked» (pinned PostgreSQL) => 1,476 passed, 0 failed, 3 ignored, 154 test binaries, exit 0; clippy
`--workspace --all-targets --all-features --locked -- -D warnings» => exit 0; `cargo fmt --all -- --check» => exit 0.
Focused: `cargo test -p rh-headless --test tournament» 10/10 (8 existing + the two new CLI/export tests); the pinned
container capture `--check» is byte-identical.

## Exact remainder for P-BOTS-6 (this slice does not claim these)

1. **formatReport's full source column layout and evaluate() pass criteria**, and with them the full report fields:
   per-tier damage/mob-damage/mob-kills splits, never-fought, reactions (p10/p50/p90/table/ratio and pooled), clicks/
   miss/wrong, APM (mean/peak/limit/breaches), dodges/jukes/orb-walk/hesitations/throttled/max stall and the source
   criteria lines. They need the humanizer telemetry block of the bot brain (the P-BOTS-6 remainder item 1), which the
   reduced GameSummary does not carry; the printed report stays the reduced layout and the JSON report keeps the reduced
   fields.
2. **--json payload completeness**: the source `criteria: evaluate(report)» array and the full source GameSummary fields
   (firstKill, deathLog, firstHits, firstMobKill, tp hp, behaviour block) are absent with the same dependency.
3. **tune.ts table overrides**: parse (done) and apply the TIERS/PERSONAS patch through the policy tables; the runner
   currently refuses it explicitly instead of ignoring it.
4. **full docs/TELEMETRY.md records**: the ported telemetry surface writes the reduced summary per game; the source
   record (behaviour/reactions/manager detail and the day file semantics) lands with item 1.
5. **worker-thread parallel play** (split is ported; the runner stays single-threaded by design here) and the source
   simulated latency/jitter of the bot fill config (`--latency»/`--jitter» are parsed and carried, not simulated), plus
   the learning store (`--learn» is carried, P-BOTS-5).

Items 1-5 are exactly the P-BOTS-6 evidence remainder; no game-outcome parity is claimed against the legacy tournament.