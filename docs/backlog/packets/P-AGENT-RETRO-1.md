# P-AGENT-RETRO-1: eight fixes to the agents' environment from the land-generation session's retrospective

- **Serves:** not in the plan: owner approval given. The owner ran a retrospective on the land-generation session
  (2026-11-14) and answered its eight ranked suggestions with **"Please fix 1-8"** in that session's chat. That answer
  is the owner approval the protected paths below need (`.claude/`, `CLAUDE.md`, `scripts/gate.sh`).
- **Implementer:** the land-generation session itself (tooling and steering text; no game code).
- **Reviewer:** the coordinator's merge review.
- **Integration base:** `feature/unity-rework` @ `947958208`.
- **D-rules touched:** none. No sim, wire, save, state-hash or content-hash change; no generated map changes.

## 1. ID and outcome
Evidence for each item is in the session's retrospective (transcript counts, `.agent-runs/log.csv`, one timing run).

1. **The compute-bound crates are optimised in dev and test builds** (`Cargo.toml`: `[profile.dev.package.rh-sim]` and
   `[profile.dev.package.rh-mapdress]`, `opt-level = 2`). Debug assertions and overflow checks stay on. Measured before
   the change: `mapgen_signature_blueprint` 41.7 s unoptimised against 5.2 s; `mapgen_signature_church` 50.7 s against
   5.9 s. This is also CI's build.
2. **A review note is a real finding.** `reviewer.md`, `reviewer-opus.md`, `CLAUDE.md` pipeline step 4 and
   `docs/agent/README.md` step 5: a note is a defect in behaviour, a broken guarantee or a structural problem; smaller
   points go in one `Minor, not notes` list that is copied into the hand-off and gets no packet (owner direction
   2026-11-13).
3. **`scripts/gate.sh --oracle-check`**, the preflight of a packet branch before an implementer starts: a commit that
   is not `stub:` holds no source file; formatter and clippy clean; every test builds; at least one target is red on
   the stub and every red target is an oracle file of the packet. `scripts/gate.test.sh` covers the commit rule.
   `oracle-author.md` reports its result as GATE.
4. **A brief may name the worktree to work in** (step 1 of the implementer, debugger and oracle-author definitions; the
   reviewers' inputs; `CLAUDE.md`). **`cargo` is on PATH from the session's start** (`.claude/hooks/session-env.sh`, a
   `SessionStart` hook writing to `CLAUDE_ENV_FILE`).
5. **A process is stopped by its id.** This branch's own hook (`guard-kill.sh`) was withdrawn: the coordinator's
   `no-pattern-kill.sh` (P-ENV-RETRO-1) does the same job better (12 of 13 kills refused against 6; no safe command
   refused) and is the one registered.
6. **`docs/agent/LANES.md`**: the rules for a session working beside the coordinator, with a pointer in `CLAUDE.md`.
7. **`print_goldens`**, an ignored test in each of `crates/rh-mapdress/tests/{anchor.rs, marsh.rs,
   sentenced_rings.rs}` that prints its golden constants ready to paste, for `re-pin:` commits.
8. **A routing row for the map generator**: a refactor in `rh-sim` map generation that changes no generated map and no
   draw, proven by a digest guard in its oracle, goes to `implementer-sonnet` and is reviewed by `reviewer-opus`.

## 2. Dependencies
None.

## 3. Relevant legacy paths
None.

## 4. New paths
`.claude/hooks/session-env.sh` (registered nowhere: see the hand-off), `docs/agent/LANES.md`, this brief.

## 5. Exclusive write scope
`Cargo.toml` (the two profile tables); `.claude/agents/*.md`; `.claude/settings.json` (two hook entries);
`.claude/hooks/{guard-kill.sh, session-env.sh}`; `CLAUDE.md`; `scripts/gate.sh`; `scripts/gate.test.sh`;
`docs/agent/{README.md, LANES.md}`; `crates/rh-mapdress/tests/{anchor.rs, marsh.rs, sentenced_rings.rs}` (one ignored
test each); this brief and the hand-off.

## 6. Contracts and references
`AGENTS.md` "Protected paths" (owner approval: above). The gate's own rule for packet commits (`scripts/gate.sh`,
`--oracle`).

## 7. Behaviour to preserve
Every existing gate mode and its results; every test, pin and golden (the optimisation level changes speed, not
results: the full gate on this branch is the proof); the three golden constants files' values.

## 8. Acceptance checks
- `bash scripts/gate.test.sh`: all cases pass, the three new ones included.
- `scripts/gate.sh --oracle-check` on a real packet branch passes and names its red target; on a branch whose
  `oracle:` commit touches a source file it fails in the path checks.
- Each `print_goldens` prints exactly the constants in its file.
- The hooks: `guard-kill.sh` exits 2 on `pkill`, `killall`, `pgrep … | xargs kill` and `kill $(pgrep …)`, and 0 on
  `kill <pid>` and on commands that only mention the words; `session-env.sh` writes a PATH line that finds `cargo`.
- `scripts/gate.sh --allow-protected` (full) passes.

## 9. Validation commands
`bash scripts/gate.test.sh`; `cargo test -p rh-mapdress -- --ignored --nocapture print_goldens`;
`scripts/gate.sh --allow-protected`.

## 10. Risk and suggested model tier
- The profile change alters CI's build. A test that only passed unoptimised would show in the full gate.
- The two hooks take effect in sessions started after the merge reaches the main checkout. Whether the PATH written
  at session start reaches sub-agents' shells is not stated in the Claude Code documentation: check with one
  `command -v cargo` in a new session and a sub-agent, then retire the lane's memory note about the PATH prefix.
- The routing row moves refactor work from Opus to Sonnet on the strength of the digest guard; `reviewer-opus` still
  reads the paths the guard's seeds do not reach.

## 11. Known traps
- `--oracle-check` cannot tell whether a red test fails for the reason its brief gives: it prints the first assertion
  lines for the author to read.
- A packet whose oracle is a capture or a golden vector with no red test target has no use for `--oracle-check`.
