# Core optimization sweep (in progress)

Owner's goal: "do a final optimization sweep, and make provable improvements to the architecture as this will be the core
for the rest of the project. The architecture should NOT be 1:1 as legacy version but in new languages but should also be
substantially improved." Gameplay stays identical to legacy: every package keeps the parity report at all MATCH.

The sweep was paused here to move development from the cloud session to a local Mac (more parallel agents, easier
testing). Everything below is committed and pushed. This file is the handoff: read it, then [PACKAGES.md](PACKAGES.md).

## Method
- **Audit**: six measured lenses (sim architecture, sim hot path, observation/wire, server density, determinism seams,
  legacy carry-over), an architect and a critic. Full record with every design and baseline number:
  [audit_result.json](audit_result.json).
- **Proof harness**: [`tools/perfproof/perfproof.py`](../../tools/perfproof/perfproof.py) builds a baseline revision and the
  working tree and compares deterministic valgrind counts (callgrind instructions, DHAT allocations) per unit of work, plus
  behaviour fingerprints (outcome digest, state-hash fold, bytes, replay verification of base-recorded replays). Machine
  load does not change the counts; self-comparison noise is +-0.02%.
- **Per package**: one engineer agent (Sonnet) in its own git worktree and branch, an independent reviewer (Opus), a fix
  pass if the review blocks, then the coordinator merges and re-runs every gate. The reusable Claude Code workflow is
  [`tools/sweep/core-stage.workflow.js`](../../tools/sweep/core-stage.workflow.js).
- **Gates on every merge**: `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace --all-features` (with PostgreSQL), `cargo run -p rh-parity --bin parity-report` (all MATCH), the C#
  tests and `sync-net.sh --check` when client-unity changes, the browser proof when the server or wire changes.

## Merged into `optimization_port` (head after this file: see `git log`)

| Package | What it changed | Proven (deterministic, vs its merge-base unless noted) |
|---|---|---|
| perfproof + schedule record | A/B proof harness; the legacy tick schedule as data (`parity/schedule/legacy_schedule.json`) | self-test ratios 1.000 +- 0.0002 |
| P1 proof gate | parity discovery by format, unknown keys refused, preconditions asserted, per-entity tables; link-level legacy hook capture (append/wrap/replace); hash-independent outcome digest; replay A/B; CI gate flags | synthetic unknown keys MATCH at the base, refused now; digest detects a one-number rule change |
| P6 encoder | exact-size single-allocation frames, `encode_into`, `SnapshotWriter`, pre-encoded map, MAX_ACTORS refused; C# value-type actors, allocation-free snapshot path | 4.69 -> 1.00 allocations per frame; encode 0.247x Ir; wire workload 0.710x Ir/step; C# decode garbage 0 B steady |
| P2a module split | `sim.rs` 1,868 -> 272 lines: World / MatchStatic / TickScratch, 8 systems as `fn(&mut Cx)`, accessors, `Arc<Arena>`, tagged checkpoint `rh-checkpoint/1` | base-recorded replays verify step for step; Ir/step 0.96x on all sim workloads |
| P3 kernel | O(explored) A* reset, nav step mask, memoized string pull, hit-only rays, integer floor, exact `js_round`, validating TileMap | path query 0.778x Ir, allocations 5.4 -> 1.3; `find_path` in bot matches 0.411x; headless 0.893x; 300 legacy paths MATCH; rays equal on 1e6 segments x 2 maps |
| P4 content registry | every gameplay number declared once (50 rows); `content_hash` derived from the registry; source scan | 0 unhashed (about 20 missing before); every row perturbs the hash |
| P5a-2 transport | one shared `serve()` with TCP_NODELAY on plain and TLS; 4 KiB WebSocket read buffers | nodelay on 100% of sockets (0% before); 64 idle connections 9.10 -> 0.97 MB peak heap |
| P5a-1 lifecycle | rooms close at the first wake after the last human; reservations no longer erased; fullest-lobby-first; outbox counters in stats; one `Arc<Arena>` per map; Welcome map encoded once | a failing-before test per bug; per-room heap (seed-1 map, DHAT slope) 210,096 -> 18,566 B per room (-91%); Welcome bytes identical |

Gates on the merged head (cloud session, x86_64): fmt and clippy clean, 133 Rust tests pass, parity 13 slice scenarios + 1
capture-only + 300 pathfinding queries all MATCH, browser proof PASS. Cumulative numbers against the Stage 1 head are in
"Cumulative" below.

## In progress: two branches on the remote, NOT merged

1. **`sweep/P10a-integration-wip`**: protocol v2 (Opus review: accept). Snapshots drop `server_ms` (= tick x 50, decoders
   derive it), remote actors are quantized (u16 position at 1/8 u, u16 facing, hp percent, per-actor field mask, varints);
   the self view keeps full precision. Measured on its branch: wirebench 1,888 -> 908 B/player/s (0.481x); 204 remote actors
   22 -> 10.0 B per actor; Rust, C# and JS decoders agree on `protocol/fixtures/v2.json`; browser proof and C# probe PASS;
   gameplay digest unchanged. The branch is `863c930` + the P10a merge + "refuse out-of-range positions" + doc updates
   (CLAUDE.md/AGENTS.md/CONTRIBUTING fixture rule) + **one unverified WIP commit** (`2f5c48c`, compute each actor's mask
   once; stopped mid-change). To finish:
   - Verify the WIP commit (byte-identical `v2.json`; perfproof `wire_seed1_8bots` Ir/step <= 1.05x of the v1 encoder at
     `863c930`, since v2 cost 1.162x before this fix) or drop it.
   - Merge `optimization_port` into the branch (P5a-1/P5a-2 touched `room.rs`, `lib.rs`, `tests/live.rs`), run all gates
     including the C# tests, `node tools/protocol-js/check-vectors.mjs`, the browser proof (expects protocol 2) and the C#
     probe; Opus review of the integration; merge.
   - Coordinator: update docs/CONTRACTS.md C-NET (protocol v2, v2.json) and MIGRATION benchmarks.
2. **`sweep/P2b-wip`**: the executable tick schedule (`crates/rh-sim/src/schedule.rs`, `hooks.rs`), legacy-checked in three
   worlds with mutation tests, an execution trace (feature `schedule-trace`), the hook dispatch seam (loot.dropBody ported
   through it), `Cx::submit` as the in-sim input seam, ADR 0009. Its review proofs passed (parity all MATCH, base-recorded
   replays verified, Ir 0.97-0.99x) except **one blocking finding**: only the next-tick deferred queue existed, not the
   same-tick `payLater` seam legacy hooks use. The fix commit `2986a0a` ("World::pay with typed PayLater payouts, kill credit
   routed through it") is **unverified** (stopped before its gates). Because it reroutes kill-credit payouts, it must be proven
   bit-identical (parity, `verify_replay`, outcome digest) before merging. Then re-review (Opus), merge onto
   `optimization_port` (P2b branched from `179c7f5`; P4 since added a source scan, so new consts in `schedule.rs`/`hooks.rs`
   must be classified in `crates/rh-sim/tests/content.rs`).

Then the packages in [PACKAGES.md](PACKAGES.md), in dependency order (P7a needs P2b).

## Known issues
- `pg_e2e` ("ProfileInUse on rejoin") failed once under heavy machine load in two separate runs and passed on rerun; the
  reviewers saw the same flake at the base revision. Likely a real race between a leave's lease release and a quick rejoin
  (the profile stays reserved until the release lands): investigate with P-PERSIST-2.
- perfproof's absolute instruction counts are architecture-specific (the numbers here are x86_64); compare A/B on one machine.

## Resuming on macOS
Tools: Xcode command line tools; `rustup` (the toolchain comes from `rust-toolchain.toml`); Node 22; the .NET 8 SDK;
PostgreSQL 16 (Homebrew `postgresql@16`); Docker Desktop (for perfproof); Unity Hub with the Unity 6.0 LTS Editor + WebGL module
(for P-UNITY-1; prefer the newest 6.0 patch over the pinned `6000.0.23f1`, which predates a Unity security advisory).

```
git fetch origin optimization_port sweep/P10a-integration-wip sweep/P2b-wip
git checkout optimization_port
export PGBIN="$(brew --prefix postgresql@16)/bin"   # tools/pgtest/start.sh defaults to Linux paths
eval "$(tools/pgtest/start.sh)"                       # throwaway cluster; tools/pgtest/stop.sh stops it
cargo test --workspace --all-features && cargo run -p rh-parity --bin parity-report
dotnet test client-unity/RoguehallaNet.Tests && bash client-unity/sync-net.sh --check
npm i --no-save playwright@1.63.0 && npx playwright install chromium
cargo build -p rh-server && node tools/browser-proof/proof.mjs
```

perfproof needs valgrind, which does not run on macOS: run it in a Linux container from the repo root (arm64 Linux is
fine; it builds both sides itself):

```
docker run --rm -v "$PWD":/src -w /src rust:1-bookworm bash -lc \
  'apt-get update -qq && apt-get install -y -qq valgrind python3 >/dev/null && python3 tools/perfproof/perfproof.py --baseline <rev>'
git worktree prune   # afterwards: the container's temporary worktree path does not exist on the Mac
```

Agents: run Claude Code in the repo and invoke the stage workflow with `scriptPath: tools/sweep/core-stage.workflow.js` and
`args: {scratch: <a temp dir>, base: <optimization_port sha>, packages: [...]}` (specs in PACKAGES.md; `resume` +
`resume_note` continue an existing branch). A workflow runs up to min(16, CPUs - 2) agents at once, so a 12-core Mac runs
10. Implementers and fixers are Sonnet, reviewers Opus. Give each worktree its own target dir (the default) and keep an
eye on disk: `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only` keeps each worktree's build small.

## Cumulative (merged head `9ef486a` vs the Stage 1 head `7d94332`)
`python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,wire_seed1_8bots,headless_seed1_8bots,headless_arena_8bots`
(x86_64 cloud container; deterministic counts per unit of work; gate: pass, behaviour identical on every key both sides print):

| Workload | Instructions | Allocations | Allocated bytes |
|---|---|---|---|
| sim_crowded_8 (8 players brawling, per step) | 15,259 -> 14,480 (0.949x) | 19.32 -> 17.40 | 1,804 -> 1,467 |
| sim_duel_chase (pathfinding, per step) | 5,896 -> 5,556 (0.942x) | 10.71 -> 9.26 | 625 -> 492 |
| sim_fists_duel (per step) | 5,514 -> 5,299 (0.961x) | 10.45 -> 9.09 | 669 -> 549 |
| wire_seed1_8bots (step + observe + encode for 8, per step) | 50,692 -> 32,974 (0.651x) | 72.16 -> 37.16 | 5,273 -> 3,840 |
| headless_seed1_8bots (full bot tick, per tick) | 14,678 -> 12,729 (0.867x) | 13.34 -> 11.94 | 1,502 -> 1,333 |
| headless_arena_8bots (per tick) | 48,796 -> 45,555 (0.934x) | 32.15 -> 30.11 | 5,014 -> 4,658 |

The packages with the largest expected gains are not merged yet: the allocation-free tick (P7a, target <= 0.25 allocations
per step), the serde-derived state hash (P8, hashing cost <= 0.30x), the observation/publish path (P9) and protocol v2
(P10a: 0.481x bytes per player on its branch). Wire bytes above are still protocol v1 (1,888 B/player/s).
