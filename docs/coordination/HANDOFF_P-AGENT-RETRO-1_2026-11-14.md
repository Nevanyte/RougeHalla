# Hand-off: P-AGENT-RETRO-1 (2026-11-14, land-generation session)

```
PACKET:          P-AGENT-RETRO-1 — not in the plan: owner approval given ("Please fix 1-8", 2026-11-14, in the
                 land-generation session's chat, answering that session's retrospective)
BRANCH:          agent/fable/P-AGENT-RETRO-1 @ c6e09632b (the changes; this hand-off is the next commit), on
                 feature/unity-rework @ 947958208
GATE:            PASS (full, `scripts/gate.sh --allow-protected`, on c6e09632b, 1651 s on a machine running a second
                 full gate) [skipped: Postgres suites (no DATABASE_URL); the CI/owner-hardware-only steps the gate
                 lists]. Log .agent-runs/gate/*-agent-fable-P-AGENT-RETRO-1-full.log
CHANGED:         Cargo.toml; .claude/agents/{debugger, implementer, implementer-sonnet, implementer-opus, oracle-author,
                 reviewer, reviewer-opus}.md; .claude/settings.json; .claude/hooks/{guard-kill.sh, session-env.sh} (new);
                 CLAUDE.md; scripts/{gate.sh, gate.test.sh}; docs/agent/{README.md, LANES.md (new)};
                 crates/rh-mapdress/tests/{anchor.rs, marsh.rs, sentenced_rings.rs}; the brief; this file
D-RULES:         none touched: no sim, wire, save, state-hash or content-hash change; no generated map changes (every
                 pin and golden green under the new build profile); D2 n/a
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none
NOT ESTABLISHED: whether the PATH the SessionStart hook writes reaches sub-agents' shells (the Claude Code documentation
                 does not say; the hooks only run in sessions started after the merge reaches the main checkout);
                 the Postgres suites under the new profile; CI's timing
RISKS:           `.claude/settings.json` has an uncommitted local change in the main checkout (seen at this session's
                 start): the merge must keep it; the routing row moves map-generator refactors to Sonnet on the strength
                 of a digest guard
```

## Evidence
- **1, the build profile.** Summed test time in the full gate: 2391 s (272 test binaries; P-MAPGEN-SIG-BLUEPRINT-2's
  gate, unoptimised) against 990 s (283 binaries; this branch). `rh-sim` integration tests: `hash_coverage` 455 s to
  56 s, `mapgen_signature_aprons` 114 s to 11 s, `mapgen_land_plague` 99 s to under 10 s. `cargo test -p rh-mapdress`
  whole: 9 s. Debug assertions stay on (`-C opt-level=2 -C debug-assertions=on` on the unit-test build, checked with
  `cargo test -v`).
- **Tried and reverted:** also optimising every dependency and `rh-policy` (`[profile.dev.package."*"]`). The two
  binaries that stay slow did not move enough to pay for it: `rh-sim` unit tests 534 s to 428 s, `rh-policy` unit tests
  206 s to 228 s (same machine, varying load). They are the next place to look: 30 `rh-sim` unit tests run over 60 s
  each even optimised (`bots::temporal_percept::memory::source_tests`, `mapgen::{pipeline, landmarks::recipes,
  style_*, repair, certify}::tests`, `systems::planning::native_tests`). Why they are slow is not established.
- **3, `--oracle-check`.** `bash scripts/gate.test.sh`: 12 passed, 0 failed (three new cases). On
  `packet/P-MAPGEN-GUARANTEES-1` (`--base agent/opus/P-MAPGEN-LANDMARK-FRAME-1`): `GATE ORACLE-CHECK PASS — red
  on the stub, in oracle files only: -p rh-sim --test mapgen_guarantees` (as the mode prints it since amendment 2; at
  the time of this run the line still began `GATE PASS (oracle-check)`), with the assertion lines printed. On the session's
  earlier mislabelled commit `1a6679895`: `GATE FAIL: source files in a commit that is not 'stub:'`, naming
  `signature/mod.rs`, in the path checks. On `packet/P-MAPGEN-SIG-SCALE-4` the commit rule passes.
- **5, the kill guard.** Exit 2 on `pkill -f …`, `… && killall …`, `pgrep … | xargs kill -9`, `kill $(pgrep …)`, and
  `pkill` after a newline; exit 0 on `kill 12345`, `grep -n pkill …`, `echo "do not pkill here"`, `pgrep -fl cargo`.
- **4, the PATH hook.** Run by hand with `CLAUDE_ENV_FILE` set: the line it writes puts `~/.cargo/bin` first once, and
  `cargo` resolves after sourcing it.
- **7, `print_goldens`.** `cargo test -p rh-mapdress -- --ignored --nocapture print_goldens` prints `OFF_GOLDEN`,
  `NO_ANCHOR_GOLDEN`, `SIG_GOLDEN`, `OFF_GOLDEN` (marsh) and `NO_ORIGIN_GOLDEN`; each equals its constant in the file.
- **2, 6, 8:** text only (`reviewer.md`, `reviewer-opus.md`, `CLAUDE.md`, `docs/agent/README.md`, `docs/agent/LANES.md`).
  For 8 the owner did not choose between adding a Sonnet row and dropping the "most sub-agents are Sonnet" line; the
  row was added because it follows that standing preference.

## After the merge
- New sessions get the two hooks. In the first one, run `command -v cargo` in the main session and in a sub-agent; if
  both resolve, the per-command `export PATH=…` prefix can go from briefs.
- The implementer definitions still say "iterate with `scripts/gate.sh --quick`": unchanged here.

## Amendment (same day): `.claude/settings.json` is left as it was
The coordinator reported that the owner's checkout carries an uncommitted local change to `.claude/settings.json` and
that the owner has said that file is not to be committed or edited: a commit touching it would block the checkout's
fast-forward. This branch therefore restores the committed file byte for byte (`git diff 947958208 -- .claude/settings.json`
is empty). The two hook scripts stay in `.claude/hooks/` but are registered nowhere by this branch:
- `guard-kill.sh`: the coordinator's P-ENV-RETRO-1 has a hook for the same purpose, registered in the agent
  definitions' frontmatter; its merge plan keeps one of the two.
- `session-env.sh` (cargo on PATH from the session's start): a `SessionStart` hook has no registration point but a
  settings file. It is offered to the owner as one entry for their own settings; until then the per-command
  `export PATH="$HOME/.cargo/bin:$PATH"` prefix stays.
The full gate was not re-run for this commit: it changes one file the gate only path-checks.

## Amendment 2 (same day): the coordinator's review of `14130fd1b` (its reviewer-opus: LAND after these fixes)
- `card_bleed_alloc` and `card_bleed_alloc_public_output` (ignored, CI-only) under the new profile, by CI's command
  (`cargo test --locked -p rh-sim --features trusted-status-probes --lib card_bleed_alloc -- --ignored
  --test-threads=1`): 2 passed.
- `--oracle-check` prints `GATE ORACLE-CHECK PASS`, never `GATE PASS` (its tree is red by design and coordinators grep
  `^GATE (PASS|FAIL)`); `gate.test.sh` asserts it. It reads cargo test targets only: `oracle-author.md` makes it the
  GATE line for Rust oracles and keeps `--quick` for C# and JS oracles; the mode's "no Rust crate changed" failure says
  so.
- `.claude/hooks/guard-kill.sh` is withdrawn from this branch: on the reviewer's 23 commands it refused 6 of 13 kills
  and wrongly refused a commit message that mentions the word; the coordinator's `no-pattern-kill.sh` refused 12 and no
  safe command. One hook, theirs. (The file never reached the integration branch.)
- The routing row says "inside `rh-sim` alone (single crate)": rule 2 still sends a refactor that touches a second crate
  to Opus.
- Still to do when the coordinator's P-ENV-RETRO-1 is on origin (a merge commit, not a rebase, by its reviewer's plan):
  the gate's flag block and rustfmt placement, `--oracle-check` refusing `--keep-going`, the combined
  `oracle-author.md`, reviewer and `CLAUDE.md` pipeline texts, and `docs/agent/LANES.md` corrected from the
  coordinator's list (the one full gate is the coordinator's on the merged tree; its own reviewer reviews every merge;
  re-pins after a merge are its; lane-chat approvals are confirmed in its chat; each push is its own approval; nothing
  is left untracked in the main checkout; worktree registration; no kill by pattern in main sessions; notice before
  touching shared files in general).
