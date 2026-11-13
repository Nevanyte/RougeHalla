# Rules for a worker session on a farmed-out packet

You are a **worker session**, not the coordinator. One coordinator session owns the integration branch, the shared
records, reviews and merges. You own one packet. These rules restate `AGENTS.md` and `CLAUDE.md` for that role; where
they differ from this file, `AGENTS.md` and `CLAUDE.md` win.

## Read first
`AGENTS.md`, `CLAUDE.md`, `docs/agent/README.md`, the top sections of `docs/MIGRATION.md` (the checkpoint and the owner
decisions dated 2026-11-12), and your packet brief in `docs/backlog/packets/<ID>.md`. Any directory with its own
`AGENTS.md` adds local rules: read it before editing there.

## Branches
1. Start from `origin/feature/unity-rework` at or after the commit your prompt names.
2. `packet/<ID>`: two commits. `stub: <ID> ...` holds everything the implementation will replace or edit (signatures
   with placeholder behaviour, `mod` lines, mechanical changes to existing tests) so the tree compiles. `oracle: <ID>
   ...` holds only the new failing tests and the brief, updated with what you verified against the code (correct any
   path, line number or claim in it that is wrong). The tests fail on assertions, not on compile errors, for the
   reason the brief states. A test-file `const` in `rh-sim` is rejected by `crates/rh-sim/tests/content.rs`: use
   functions.
3. `agent/<your-tool>/<ID>`, branched from `packet/<ID>`: the implementation. Files of the `oracle:` commit are
   read-only there. If an oracle test is wrong, say so in the hand-off with the evidence; do not edit it.
4. Push only these two branches. Never push to, merge into, rebase or force anything on `feature/unity-rework`,
   `main` or `optimization_port`.

## Scope
- Stay inside the brief's exclusive write scope. If the work needs a file outside it, stop and report the file and
  the edit; do not widen the scope yourself.
- `packages/` is the legacy reference: read-only. `parity/**` and `protocol/fixtures/**` change only by their
  documented commands and only if the brief says so. `.github/`, `.claude/`, `scripts/gate.sh` and every
  `AGENTS.md`/`CLAUDE.md` are not yours to edit; `hosting/` only if your brief names it.
- Shared records are the coordinator's: `docs/MIGRATION.md`, `Cargo.lock` (so: no new dependency), the status table
  in `docs/CONTRACTS.md`, `docs/PROJECT_COORDINATION.md`, `docs/agent/INTEGRATION_BRANCH`. List proposed edits in the
  hand-off.
- No deploys and no `aws` command that changes resources.

## Non-negotiables (from AGENTS.md)
Rust decides every outcome. `rh-sim` is pure and deterministic at a fixed 20 Hz; legacy tick order is never
reordered. Every actor acts only through `validate` + `Sim::submit`. Observations carry only what that viewer may
see; secrets stay on the server. RNG is injected and seeded, and draw order is behaviour. Every new serialized field
reaches save, restore and the state hash. Port a mechanic by reading the legacy code and add one test showing its
numbers are not drastically off; an intentional difference from legacy gets a proposed `DEVIATIONS.md` row.

## Gate
- While iterating: `scripts/gate.sh --quick`. Before hand-off: `scripts/gate.sh --oracle packet/<ID>` (full). With
  PostgreSQL 16 available, `eval "$(tools/pgtest/start.sh)"` first so the Postgres suites run; say what was skipped.
- Build with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` to keep build directories small.
- The quick gate stops at its first red step: after it passes, run the full gate, not only the steps you expect.
- Known flake, not yours to fix: `GarbageTests.ASessionReceivingSnapshotsMakesNoGarbage` in
  `client-unity/RoguehallaNet.Tests` fails in about one whole-suite run in five on any branch; rerun and say so.

## If the packet is wrong or too large
If the brief contradicts the code, two tests or contracts conflict, or the implementation would exceed about 450
changed lines: stop. Cut the packet (the first part's oracle, and a brief for each later part in
`docs/backlog/packets/`), and say what you cut and why in the hand-off.

## Hand-off
Commit `docs/coordination/HANDOFF_<ID>_<date>.md` on the agent branch with the report block from `AGENTS.md` ("Work
and hand-off": PACKET, BRANCH, GATE, CHANGED, D-RULES, DEVIATIONS, SHARED RECORDS, LEGACY DOUBTS, NOT ESTABLISHED,
RISKS), the output of `git diff --stat packet/<ID>`, and on a failed gate its failure block. State plainly what the
evidence does not prove. The coordinator session reviews the branch and merges it; expect review notes.
