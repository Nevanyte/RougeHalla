# P-KIMI-VERIFY-1: bounded Rust determinism sweep and native architecture checks

## ID and outcome

You are Kimi Code working on Roguehalla. Implement this bounded verification packet, supporting P-CI-2 and the
headless validation requirements. Your deliverable is a useful Rust determinism/stress executable, tests that prove
its failure detection, and a separate native x86_64/aarch64 comparison workflow. You own the verification harness,
not gameplay decisions. Codex will independently review and integrate your work.

Start from the latest `origin/optimization_port` in a **separate checkout**, on `kimi/determinism-sweep`. Record the
exact base commit. Do not change Codex's or Claude's checkout/branch. Open a PR targeting `optimization_port`; do not
merge it. Read `AGENTS.md`, the current `docs/MIGRATION.md`, `docs/CONTRACTS.md` and this packet before implementation.
The inspected baseline was `438074d3`; use current APIs from your actual checkout and report differences.

## Dependencies

The current public Rust simulation/headless/replay/checkpoint APIs are sufficient. No AWS, Unity, database, new
dependencies or gameplay change is required. Current full-game implementation is incomplete; test the implemented
domain honestly. Claude owns server/persistence/hosting. Codex owns gameplay, map generation, policy and integration.
This packet reserves only the new files below from Codex's headless ownership.

## Relevant legacy paths (verified)

- `crates/rh-headless/src/{lib,main,digest}.rs`: authoritative Env, policy seats, recording and existing digest support.
- `crates/rh-headless/tests/{restore_real,map_loading,projectiles,holy,plague,fire,frost,sentenced}.rs`: existing coverage
  and examples of admitted scenarios. Read before designing additional coverage; do not copy these tests wholesale.
- `crates/rh-sim/src/{replay,checkpoint,statics}.rs`, `crates/rh-sim/tests/hash_coverage.rs` and parity documentation.
- `.github/workflows/{rust,perfproof,parity-recapture}.yml`: existing checks; leave these files unchanged.
- `parity/maps/seed1.map.json` and `crates/rh-sim/src/mapdata/fixtures/seed1.map.json`: admitted existing input maps.

## New paths

- `crates/rh-headless/src/bin/determinism_sweep.rs` (auto-discovered binary, named `determinism_sweep`).
- Optional helper modules under `crates/rh-headless/src/bin/determinism_sweep_support/`.
- `crates/rh-headless/tests/determinism_sweep.rs` for the new executable's contract/failure detection.
- `tools/determinism/**` for comparison/provenance helpers, README and synthetic-only small evidence.
- `.github/workflows/determinism.yml` for the new bounded architecture workflow.

## Exclusive write scope

Write only the new paths above. Do not change existing library implementations, other tests, maps, expected parity
fixtures, workflows, root manifests, `Cargo.lock`, toolchain, shared status records or any server/persistence/hosting/
Unity files. No new dependencies. Check Cargo's existing automatic binary discovery before requesting a manifest edit;
if registration really is necessary, supply the minimal proposed hunk separately for Codex to integrate.

If an existing engine/API defect blocks the harness, preserve the failure, minimize a deterministic reproducer and
report the source/tick/input and expected contract. You may fix your own harness inside scope. Do not repair game
rules, invent a workaround in a second simulation, relax a check or skip the failing scenario. Keep independent
work moving when possible. Do not spawn more agents or expand into another packet.

## Contracts and references

Follow C-DET, C-NUM, C-INPUT, C-OBS, C-RNG, C-PARITY and the policy cadence contracts. The timestep stays 20 Hz;
acceleration removes waits, never computation or game rules. All game logic remains in Rust. Do not use unsafe code,
fast-math, changed float tolerances or modified content to make a comparison pass.

For native runner setup, verify current official GitHub documentation and actual account availability:
[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Standard Linux labels documented at packet preparation include `ubuntu-24.04` and `ubuntu-24.04-arm`; labels alone
are not proof of native execution or availability to this repository. Do not create a paid/larger/self-hosted runner,
change billing or provision cloud resources. If a required native runner is unavailable, report the actual gate as
pending; do not silently replace it with emulation or call a macOS-only check a Linux aarch64 CI proof.

## Behaviour to preserve

1. Existing `rh-headless` already runs reproducible matches, records replays and verifies every replay hash. Existing
   `restore_real.rs` already tests many checkpoints and short continuations. Reuse public APIs. Add orchestration,
   broader bounded input coverage, continuation with later recorded inputs, useful failure localization and actual
   cross-architecture comparison; do not rebuild the recorder, checkpoint parser, digest or policy scheduler.
2. Use a fixed, versioned, explicitly enumerated CI inventory with several synthetic seeds/player counts, practice
   and admitted full-layer map cases, a legitimately terminal case and a deliberately truncated case. Name and
   record each scenario's actual config. Default config has `FactionMode::Off`; include an explicitly configured
   current `EngagementHolyPlagueFireFrostSentenced` scenario if supported, rather than claiming factions were tested
   merely because faction IDs were present. Preserve intended PvP/timing and use only already supported mechanics.
3. Drive Env/policy inputs through normal validated APIs and use the existing recorder. Do not reuse observer-local
   handles between independent sessions, call unbudgeted parity-only intake as a normal action, read secrets to make
   policy choices or bypass cooldown/cadence limits. Trusted setup must be explicit and recorded by the existing APIs.
4. Run two fresh independent instances for each case and compare **every tick**, including authoritative state hashes,
   ordered authoritative events, termination/truncation and actual progress. A final hash alone is insufficient.
5. Serialize/reload each recorded replay and verify it through existing `run_replay`. At deterministic sample ticks,
   serialize/restore checkpoints and continue with the **subsequent recorded inputs**, preserving their original
   ordering and tick association; compare every continuation hash and ordered event, not just a few no-input steps.
   Do not claim restored policy/session memory unless that separate contract was actually restored and tested.
6. Keep one scenario/replay in memory at a time; use bounded CLI arguments and workload size. Provide a fast fixed
   `ci` preset and a larger explicitly invoked local `soak` preset with recorded deterministic seed ranges. Measure
   runtime before choosing the default workload. CI should be short enough for routine use, with an explicit job
   timeout. No unbounded fuzz loop, implicit all-core saturation, sleeping to simulate real time or generated GB corpus.
7. Fail nonzero on invalid/unknown/duplicate arguments, zero work, unknown scenario, incomplete inventory, missing map,
   failed restore/replay or any divergence. Print the first case/seed/tick/component mismatch and enough synthetic input
   to reproduce it. A panic, skipped job, timed-out job, absent result or empty output is not a successful verification.

## Acceptance checks

### Rust executable and evidence

- Document working commands for the CI preset, bounded soak preset and reproduction of a single failed case.
- Emit a versioned canonical result manifest with the exact ordered scenario inventory and actual work counters,
  current content identity and format versions, actual ticks, terminal/truncated flags, per-tick state-hash and
  authoritative-event folds. Encode 64-bit hashes as fixed-width hexadecimal strings. Do not round away float differences.
- Keep provenance separate: commit, dirty state, toolchain, target triple, native/emulated status, profile, command,
  map-input checksums, machine/OS and elapsed time. Exclude only explicitly listed machine/timing provenance from
  equality; content, config, seeds, scenario order, work counts and simulation results must match.
- A strict comparator must reject missing, empty, duplicate, reordered or extra scenarios, wrong versions, different
  configs/content, missing artifacts and any result mismatch. Comparing two equally empty manifests must fail.
- Include focused harness tests and negative controls demonstrating failure on altered expected tick hashes/events,
  truncated replay, incomplete inventory and invalid CLI arguments. Do not add a production option to bypass checks
  merely to test them. An unchanged valid control must pass. Do not write tests that merely restate your implementation.
- Preserve mismatch evidence; do not regenerate expected output from the failing result or mask it with a broad tolerance.

### Native cross-architecture workflow

- Separate native Linux x86_64 and aarch64 jobs use the same commit, pinned toolchain, locked dependencies and CI preset.
  Record `rustc -vV`, target and execution architecture. Compilation alone is not a native execution proof.
- Run focused core/policy/headless checks and the existing parity report. No database, npm/browser, Unity or AWS setup
  belongs in this workflow. Do not copy the whole existing integration pipeline into two more jobs.
- A dependent comparison job downloads **both successful** canonical manifests, validates inventories and compares them
  exactly. Upload a small synthetic replay sample from each architecture and verify the other architecture's recordings
  with the same commit/content, using existing replay verification. Missing foreign artifacts must fail explicitly.
  After both producer jobs succeed, run a native x86_64 verifier for aarch64 recordings and a native aarch64 verifier
  for x86_64 recordings. Require both directions plus manifest comparison; a single comparison job cannot prove both.
- Keep permissions read-only, cancel superseded PR runs, isolate caches by architecture/profile, bound time and retain
  diagnostic artifacts briefly. Never use `pull_request_target` to execute untrusted branch code with elevated access.
- Begin with manual dispatch and PR triggers scoped to relevant Rust/harness/workflow inputs. Avoid adding an expensive
  scheduled soak. Make no full-game parity/performance or release claim from this implemented-domain determinism gate.
- Show successful native jobs, comparison and foreign-replay verification before claiming P-CI-2 complete. If CI cannot
  run in your environment, deliver tested local code/workflow plus the exact pending execution gate, not a fabricated pass.

## Validation commands

Existing commands to preserve:

```sh
cargo fmt --all --check
cargo clippy -p rh-headless --all-targets --all-features -- -D warnings
cargo test -p rh-headless
cargo test -p rh-sim -p rh-policy
cargo run -p rh-parity --bin parity-report
```

Use locked dependencies in your actual checks. Add and document the new executable/comparator commands you implement.
Run a small integration test first, then the CI preset; broaden to the bounded soak after correctness checks pass.
Format owned files only while sharing a machine. Use a separate target directory and modest build concurrency.
Do not change global tools, running services, existing worktrees or another worker's files.

## Risk and suggested model tier

Bounded implementation/testing work. Follow the contract literally; leave consequential gameplay, privacy and numeric
decisions to Codex with evidence. No new architecture, model runtime, training/data pipeline or production operation.
All artifacts contain synthetic matches only; private real-player replays and credentials are excluded.

## Known traps

- Cross-architecture equality is an additional requirement, not a replacement for legacy parity. Keep both green.
- A full-layer imported map is not proof of the unfinished Rust map generator or full-game rules.
- State hashes intentionally include private state. Only synthetic test artifacts may be retained by this harness.
- Current format numbers may change as Codex ports mechanics. Read authoritative constants, record them, rebase before
  final validation and do not hardcode a stale expected content hash/version. Never disable the content gate.
- No manual edits to shared MIGRATION/backlog/CONTRACTS/Cargo.lock. Return proposed status text and required shared hunks.
- Report changes, exact commands/results, workload/coverage counts, measured duration, first failing reproduction if any,
  remaining limitations, and base/head commits. Keep the PR focused and wait for Codex review before integration.
