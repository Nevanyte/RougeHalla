# P-BOTS-6: the tournament runner on rh-headless

Stacked PR: deepseek/p-bots-6 -> deepseek/p-bots-3's successor deepseek/p-bots-4 @ 10937871; branch created at that
head, clean before work. No wire/protocol change (protocol 7), no dependency or Cargo.lock change, no schedule or
serialized-state change. Ledger row: docs/evidence/deepseek-rust/PROGRESS.md.

Status: DONE-VERIFIED slice; P-BOTS-6 remains INCOMPLETE at packet level (exact remainder below). No packet file
exists: the scope was derived from the backlog row (line 162: "Tournament runner on rh-headless (per-tier win rates,
Wilson intervals)", dep P-BOTS-1, sources server/src/bots/tournament/), the P-BOTS evidence remainders and the legacy
code.

## Assessment before writing (code and git, not memory)

rh-headless already exposes the seam this packet needs: Env (reset/step over the authoritative Sim at the fixed
timestep, with Agent::Policy seats), rh-policy HumanBot (tier,persona) seats, SeatStats (proposed/accepted/rejected/
decisions/faults), the public Event stream (RaidStarted/Teleported/Death/Resolved/Hit) and RunResult (outcome, place,
kills, gv, killed_by/killed_by_bot). The legacy tournament directory is a runner+report layer over the same idea:
tournament/game.ts (GameSummary/BotGameSummary), tournament/headlessRoom.ts (HEADLESS_CONFIG timers, seeded streams),
tournament/worker.ts (mix/dealEvenly/planGame, the deterministic per-game schedule), tournament/runTournament.ts
(parseLineup/split/defaultWorkers/planOf/usage), tournament/report.ts (wilson/percentile/meanInterval/tableReactionMean
and aggregate). Nothing in the tournament layer was ported: no runner, no schedule, no report. The learning store
(BotStatsStore, P-BOTS-5) is off by default in tournaments (learn off makes a game a pure function of its seed) and is
not needed for this slice.

## Delivered

- crates/rh-headless/src/tournament.rs: the runner module.
  - Schedule (actual-source parity): MAX_GAME_MS, STALL_LIMIT_MS, TIER_IDS/PERSONA_IDS/FACTION_IDS orders, the
    murmur mix(seed, tag), dealEvenly (shuffle-based even deal), planGame (game seed in the Room's 2^31 range, bot
    seed, fully fixed lineup), split, defaultWorkers, parseLineup with the source error messages, SeatSpec,
    PersonaChoice/FactionChoice, TournamentPlan/GamePlan.
  - Runner: run_game/play/run over the ordinary Env::new(EnvConfig, agents, seed) with Agent::Policy
    HumanBot::new(tier, persona) seats, so perception is Observation-only and every action still goes through
    validate + submit; a game is a pure function of the plan. GameSummary/BotSummary/ManagerCounts capture the
    publicly observable part: seed, lineup, ended, winner/draw, duration, ticks, firstDeathMs, teleportMs, per-bot
    place/outcome/kills/deaths/gv/diedAtMs/diedTo, and the seat counters (sent/applied/refused/lost/frames/errors).
  - Report (actual-source parity): wilson, percentile, meanInterval, tableReactionMean and aggregate over the reduced
    summary: overall games/decided/draws/capped/duration distribution/first-death median/teleport share/sudden-death
    share/refused/lost/errors, the per-tier TierAgg (bot-games, wins, draws, capped, win rate with its 95% Wilson
    interval, share of wins, mean place with its 90% interval, kills/deaths/gv per bot, alive seconds, died-to
    counts), and the per-persona/per-faction GroupAggs. defaultSimConfig maps the source HEADLESS_CONFIG timers onto
    the port's arena rules (source lifecycle: patience 120/48, sudden death 30).
  - format_report: a deterministic text report for the CLI (source layout, reduced columns; NaN prints "-").
- crates/rh-headless/src/lib.rs: registers the module.
- crates/rh-headless/src/bin/tournament.rs: the CLI over the runner (--games/--seed/--lineup/--max-minutes/--quiet),
  printing the report; the wall clock is read only for its progress line.
- parity/policy/bot-tournament.json (rh-bot-tournament-source/1, 235,716 bytes, 1,171 cases, SHA256
  95c80743260b8cf95b680de4fa064521f373601cb7707b6e9b1b823a459cb11e), captured only in the pinned Linux amd64 Node
  22.23.4 container by tools/bot-tournament-fixtures/capture.sh and byte-checked by --check: the source constants and
  id orders, 36 Wilson cases, 45 percentile cases, 12 mean-interval cases, 21 table-reaction means, 3 whole
  aggregates over synthetic source GameSummary sets (four mixed games, two games in one tier, empty), 30 mix cases,
  972 even-deal cases (persona/faction/generic kinds, 2-8 seats, seeds/tags/indices), 28 planGame cases, 6 splits, 6
  defaultWorkers, and 12 lineup parses including the source error messages; plus the hashed source closure.
- crates/rh-headless/tests/tournament.rs: 8 tests. Parity: the report primitives, the full source aggregate, the
  constants/id orders, and the whole deterministic schedule (mix/dealEvenly/planGame/split/defaultWorkers/
  parseLineup) are compared exactly. Runner: a two-game tournament replays byte-identically and its report invariants
  hold (counts, Wilson bounds, duration ordering, per-tier bot-games, zero lost/errors, accepted commands); a
  tick-capped game reports capped survivors with place 1; a real patience/coliseum game has its teleport in the
  summary; the empty report keeps the source NaN semantics.
- tools/bot-tournament-fixtures/: capture tool/README plus run-mutants.sh with 4 committed mutants (Wilson term, mix
  constant, even-deal slots, share-of-wins denominator): 4/4 killed, unchanged control passes.

## Honest deviations from the source (documented, not faked)

1. Game outcomes are NOT compared with the legacy tournament: a legacy game is played by the full bot brain
   (strategy/tactics/memory: the P-BOTS-1/P-BOTS-3/P-BOTS-4 remainder) and the remaining gameplay producers. The
   schedule and report are compared exactly; the games are self-consistent and deterministic.
2. The summary carries only what the public Env exposes: no humanizer behaviour telemetry (commands/reactions/APM/
   stalls), no mob-kill or mob-damage split, and no sudden-death start (no public event). Those columns are absent
   rather than zeroed; the report's sudden-death share is 0 for a non-empty run it could not observe and NaN for an
   empty one (the source prints "-").
3. The public Env derives every policy seed and the match secrets from one seed, while the source game separates the
   world seed from botSeed; the runner passes the scheduled game seed (scheduling itself is exact).
4. A fixed lineup starts the raid at once, so the port uses fill_seconds 0 (source lobby fill 5); the default practice
   arena has no camp/loot layers, so mobs stay Off. Both are followed by default_sim_config and can be overridden
   through the sim config passed to play/run (a layered arena with initial_loot enables the Pve profile).
5. The CLI exposes the subset of source flags the runner implements; tune/telemetry/JSON export, learning-store
   wiring, simulated latency/jitter and worker-thread parallel play are remainder (split() is ported and pinned).

## Verification

- tools/bot-tournament-fixtures/capture.sh --check: byte-identical pinned-container recapture (1,171 cases).
- cargo test -p rh-headless --all-features --test tournament: 8 passed / 0 failed.
- tools/bot-tournament-fixtures/run-mutants.sh: 4/4 mutants killed; unchanged control passes.
- cargo test --workspace --all-features --locked with the PostgreSQL test cluster (tools/pgtest/start.sh):
  1,474 passed / 0 failed / 3 existing ignored across 154 test binaries; exit 0.
- cargo clippy --workspace --all-targets --all-features -- -D warnings: clean (exit 0, zero warnings).
- cargo fmt --all -- --check: clean.

## Exact remainder for P-BOTS-6

1. Full outcome parity needs the complete bot brain and gameplay producers (P-BOTS-1/P-BOTS-3/P-BOTS-4 remainder):
   the humanizer telemetry columns, mob-kill/mob-damage split, behaviour and reaction aggregates, sudden-death
   observation and the source pass criteria (evaluate()).
2. The learning store (P-BOTS-5) and the source learn on/off batch semantics.
3. tune.ts table overrides, telemetry records (docs/TELEMETRY.md) and the --json games+report export.
4. Worker-thread parallel play (split() is ported; play() is single-threaded by design here) and simulated
   latency/jitter of the source bot fill config.
5. The remaining CLI flags/usage text and formatReport's full column layout.

This slice reads only public Observation through the Env seats, submits only through validate + submit, keeps the
seats deterministic and changes no wire, schedule or serialized state; P-BOTS-6 INCOMPLETE covers items 1-5 above.
