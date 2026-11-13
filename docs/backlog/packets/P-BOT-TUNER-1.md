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
- listed by the oracle author on `packet/P-BOT-TUNER-1`

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
