# P-BOT-TUNER-1: an offline, seeded search over the Brain's existing tier and persona numbers

- **Serves:** owner beta-follow-up decision 7 (MIGRATION, 2026-11-10: "add a light offline tuner over existing
  tier/persona numbers"); plan lane F item 3; R-ML narrow exception (REQUIREMENTS, 2026-11-12)
- **Implementer tier:** implementer-opus (cross-crate: rh-headless, rh-policy)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-BOT-LEARN-ON-1
- **D-rules touched:** D1 loose proof · D9 · R-ML: only the exception's second clause

## 1. ID and outcome
The Brain's skill and style come from two tables: `TIERS: [TierParams; 3]` (`crates/rh-policy/src/bots/types.rs:206`)
and `PERSONAS: [PersonaParams; 4]` (`:515`), ported from legacy `brain/types`. Legacy has a small tool that patches
those tables for ablation runs (`packages/server/src/bots/tournament/tune.ts`, `applyTune(spec)` `:28`). When this
lands there are two things, both headless and offline:
1. **The port of `applyTune`:** a tournament can run with a patch of named tier or persona numbers (a JSON spec),
   without changing the compiled tables.
2. **A seeded search over those same numbers:** a simple hill-climb or cross-entropy loop that proposes patches
   inside stated bounds, scores each by tournament placement with a spread term that keeps the four personas
   distinct, and writes the best table found as a JSON file to be reviewed and checked in. Same seed, same table.
The live server only ever reads a checked-in table: nothing in `rh-server` searches or learns from this tool.

## 2. Dependencies
- P-BOT-LEARN-ON-1 merged (the tournament seats Brain bots). The search's results mean something only after
  P-BOT-BRAIN-CONTINUITY-1 (Brain seats are passive until then) and the balance changes already merged.

## 3. Relevant legacy paths
- `packages/server/src/bots/tournament/tune.ts:1-28` (ablations: one tier with another's knowledge, or one persona
  changed at a time); `packages/server/src/bots/brain/types.ts` (`TIERS`, `PERSONAS`)

## 4. New paths
- `crates/rh-headless/src/tune.rs`, `crates/rh-headless/src/bin/tune.rs`, `crates/rh-headless/tests/tune.rs`
- `crates/rh-policy/data/brain_tuning.json` (the checked-in table; this packet ships it equal to the compiled values)

## 5. Exclusive write scope
- the new files; `crates/rh-headless/src/{tournament.rs,lib.rs}` (accept a patch)
- `crates/rh-policy/src/bots/types.rs` and the Brain's constructor path only as far as letting a caller supply a
  patched copy of the two tables (the compiled defaults stay the values legacy has; name every edit)
- Not `crates/rh-server/`; not `compose14.rs`, `memory.rs`, `mob_tracks.rs`

## 6. Contracts and references
- R-ML narrow exception (docs/REQUIREMENTS.md): an offline seeded parameter search over existing Brain tier and
  persona numbers whose only product is a checked-in table. No neural model, no Python, no dataset kept, no
  inference service, no GPU or cloud resources. The search adds no new parameter: it moves numbers that exist.
- C-RNG: the search's draws come from its own seeded stream; determinism across runs and machines (no wall clock,
  no thread-order dependence: matches may run in parallel only if results are folded in a fixed order).

## 7. Behaviour to preserve
- With no patch, every Brain decision is today's (the compiled tables); `parity/policy` corpora green.
- The four personas stay distinct and the three tiers stay ordered (a patch that breaks either is refused).

## 8. Acceptance checks
- `applyTune` port: a spec naming one tier or persona number changes exactly that number in the copy a tournament
  uses; an unknown name or an out-of-bounds value is refused; legacy's two ablation shapes are expressible.
- Search: a three-generation run on a tiny tournament is deterministic (two runs, identical output file); every
  proposed patch stays inside its bounds; the spread term is at least a stated floor on the returned table; the
  objective and bounds are written into the output file with the seed, the plan and the commit they were run on.
- The shipped `brain_tuning.json` equals the compiled defaults (a test), so merging this packet changes no bot.
- `scripts/gate.sh --oracle packet/P-BOT-TUNER-1` passes (full).

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/tune.rs`

## Verified against the code (oracle author, 2026-11-12)
- `TIERS` is `types.rs:206`, `PERSONAS` `:515` (before this packet's edits); legacy `tune.ts:28` is `applyTune`. Each
  tier has 62 leaves (60 numbers, `route.horizon` a whole number, `route.walkPaths` a boolean), each persona 16.
- **The Brain's constructor path is not edited.** Every reader of the two tables (`BrainBot::reset`
  `brain_bot.rs:185-186`, HumanBot `bot.rs:154-158`, the humanizer, `memory_prefix.rs`, `reflex.rs`, `planning.rs`)
  goes through `TierParams::by_id` / `PersonaParams::by_id`. The patch is installed there: `types::with_tables(&'static
  BrainTables, f)` sets a per-thread override for the duration of `f` and restores it (also on panic). Live code never
  calls it, so live bots read the compiled tables. This keeps the packet out of `brain_bot.rs`, which
  P-BOT-BRAIN-CONTINUITY-1 owns. Like legacy (which patches the tables in place for a whole worker), the patch applies
  to every seat of the game.
- The legacy spec format is kept: `{"tiers":{"easy":{"knowledge":0.95}},"personas":{"hunter":{"engageEdge":0}}}` with
  legacy camelCase names, ported as the same deep merge over a JSON form of the tables. Stricter than legacy: values
  must lie in a validity range (shares and probabilities in [0, 1], `appraisal.bias` in [-1, 1], `route.horizon` a
  whole number in [1, 64], the rest non-negative), and `id` is not patchable.
- **Conflict in the brief, resolved here:** section 7 says a patch that breaks the tier order is refused; section 8 says
  legacy's ablation shapes are expressible, and legacy's own example (easy with hard's knowledge, 0.95) breaks the
  order. The oracle refuses an order-breaking patch unless the spec says `"ablation": true` (a diagnostic only; the
  search never sets it and the checked-in table is always checked without it). The persona spread floor applies to
  every patch. Tier order: a leaf whose compiled values run easy -> normal -> hard in one direction keeps that weak
  direction. Spread: the smallest pairwise RMS distance between personas, each leaf scaled by its largest compiled
  magnitude; the floor is half the compiled spread.
- The tournament binary refused `--tune` at `src/bin/tournament.rs:51-56`; accepting a patch means editing that file
  (not listed in section 5; one refusal replaced by a validation). `TournamentPlan.tune` already carries the patch,
  so no plan literal changes. The `--tune` line in `tournament_cli.rs` `USAGE` becomes stale (proposed edit).
- Search: a seeded (1+lambda) hill-climb from the compiled tables over every leaf with a non-zero number, bounds half to
  one and a half of the compiled value inside the validity range. Objective: minus each tier's distance from its
  legacy win band (`tournament::win_band`, the source report's criterion; a win is placement 1), plus 0.1 times the
  persona spread relative to the compiled spread (capped at 1). The output file records seed, commit, plan, objective,
  bounds, every candidate and the best table.
- The checked-in table `crates/rh-policy/data/brain_tuning.json` is written by `tune --write-compiled` and equals the
  compiled tables; nothing reads it at run time yet (the live server reads the compiled constants).

## 9. Validation commands
- `cargo test -p rh-headless`; `cargo run --release -p rh-headless --bin tune -- --help`; `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. Scope creep is the risk: this is a table search, not a learning system. Anything beyond the exception's
wording goes back to the owner.

## 11. Known traps
- Adopting a searched table for live bots is a separate, reviewed change (a balance decision with a DEVIATIONS row):
  this packet never changes the compiled defaults or the shipped table's values.
- No new dependency (`Cargo.lock` is the coordinator's): the search is plain Rust.
- A second pair of `TIERS`/`PERSONAS` name tables exists at `temporal_percept/tactics/source_strict.rs:168-169`
  (string names): do not confuse them with the parameter tables.

## Notes from previous attempts
