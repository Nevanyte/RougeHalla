# Bot tournament report/schedule witness (P-BOTS-6)

These tools capture the actual TypeScript source's pure tournament statistics and deterministic scheduling for the Rust
headless runner: the report primitives of `packages/server/src/bots/tournament/report.ts` (wilson, percentile,
meanInterval, tableReactionMean and the whole `aggregate` over synthetic source GameSummary rows), and the schedule of
`tournament/worker.ts` + `tournament/runTournament.ts` (mix, dealEvenly, planGame, split, defaultWorkers, parseLineup),
plus the constants of `tournament/game.ts` and `tournament/headlessRoom.ts`.

Only the pinned official Linux amd64 Node 22.23.4 runtime is accepted (the image is pinned by digest in
`capture.sh`; the corpus records Node/platform/arch and the hashed source closure). Inputs are declared constants,
synthetic source game summaries, plans, seeds, tier/persona/faction lists and lineup strings. Expected values are the
actual exported source functions' outputs; no expected value is computed from Rust and no entropy is read.

## Capture and check

```sh
tools/bot-tournament-fixtures/capture.sh            # write parity/policy/bot-tournament.json
tools/bot-tournament-fixtures/capture.sh --check    # one canonical recapture/compare
```

`RH_TOURNAMENT_OUTPUT` selects another output directory. Capture and check each execute the harness once; the
repository is mounted read-only and `npm ci --ignore-scripts` uses the lockfile in a temporary node_modules mount.

Rust validation: `cargo test -p rh-headless --all-features --test tournament` (8 tests: the report primitives, the
full aggregate over source games, the constants/id orders, the whole deterministic schedule, and the runner's
determinism, invariants, capped/teleport summary behavior and empty-report NaN semantics).

## Mutants

```sh
CARGO=... tools/bot-tournament-fixtures/run-mutants.sh
```

Each committed mutant reverts one ported rule (a Wilson-interval term, the seed mix constant, the even-deal slot rule,
the share-of-wins denominator); each must make the parity tests fail semantically, and the unchanged control must pass.
