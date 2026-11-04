# Core optimization sweep (in progress)

Owner's goal: "do a final optimization sweep, and make provable improvements to the architecture as this will be the core
for the rest of the project. The architecture should NOT be 1:1 as legacy version but in new languages but should also be
substantially improved." Gameplay stays identical to legacy: every package keeps the parity report at all MATCH.

Status at `a0e705e` (head of `optimization_port` when this was written): the audit packages P1-P7b, P10a and P5a-P5d are
merged. **Still in progress on other branches: P8 (state identity), P9 (observation and publish path), P10b (gated delta
snapshots) and the CI perf gate**, then the final review. This file is the handoff: read it, then [PACKAGES.md](PACKAGES.md).
(The sweep was paused once to move development from the cloud session to a local Mac; the macOS resume notes are kept below.)

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

## Merged into `optimization_port`

Numbers are deterministic counts (callgrind Ir, DHAT allocations) against the package's own merge-base unless noted. They
were taken by the package's engineer or reviewer and copied from the per-package reports; only the "Cumulative" section
below was re-measured for this record. Merge commits are listed in [PACKAGES.md](PACKAGES.md).

| Package | What it changed | Proven |
|---|---|---|
| perfproof + schedule record | A/B proof harness; the legacy tick schedule as data (`parity/schedule/legacy_schedule.json`) | self-test ratios 1.000 +- 0.0002 |
| P1 proof gate | parity discovery by format, unknown keys refused, preconditions asserted, per-entity tables; link-level legacy hook capture (append/wrap/replace); hash-independent outcome digest; replay A/B; CI gate flags | synthetic unknown keys MATCH at the base, refused now; digest detects a one-number rule change |
| P6 encoder | exact-size single-allocation frames, `encode_into`, `SnapshotWriter`, pre-encoded map, MAX_ACTORS refused; C# value-type actors, allocation-free snapshot path | 4.69 -> 1.00 allocations per frame; encode 0.247x Ir; wire workload 0.710x Ir/step; C# decode garbage 0 B steady |
| P2a module split | `sim.rs` 1,868 -> 272 lines: World / MatchStatic / TickScratch, 8 systems as `fn(&mut Cx)`, accessors, `Arc<Arena>`, tagged checkpoint (`rh-checkpoint/1`, now `/3`) | base-recorded replays verify step for step; Ir/step 0.96x on all sim workloads |
| P3 kernel | O(explored) A* reset, nav step mask, memoized string pull, hit-only rays, integer floor, exact `js_round`, validating TileMap | path query 0.778x Ir, allocations 5.4 -> 1.3; `find_path` in bot matches 0.411x; headless 0.893x; 300 legacy paths MATCH; rays equal on 1e6 segments x 2 maps |
| P4 content registry | every gameplay number declared once (50 rows); `content_hash` derived from the registry; source scan | 0 unhashed (about 20 missing before); every row perturbs the hash |
| P5a-2 transport | one shared `serve()` with TCP_NODELAY on plain and TLS; 4 KiB WebSocket read buffers | nodelay on 100% of sockets (0% before); 64 idle connections 9.10 -> 0.97 MB peak heap |
| P5a-1 lifecycle | rooms close at the first wake after the last human; reservations no longer erased; fullest-lobby-first; outbox counters in stats; one `Arc<Arena>` per map; Welcome map encoded once | a failing-before test per bug; per-room heap (seed-1 map, DHAT slope) 210,096 -> 18,566 B per room (-91%); Welcome bytes identical |
| P2b executable schedule | the tick is data: `crates/rh-sim/src/schedule.rs` (phases, systems, hook chains, actions, move modifiers; Ported or Pending rows) checked against `parity/schedule/legacy_schedule.json` in three worlds with mutation tests; hook dispatch (`hooks.rs`, `loot.dropBody` ported through it); `World::pay`, the same-tick `payLater` seam (kill credit routed through it); `Cx::submit` input seam; [ADR 0009](../adr/0009-core-layout.md) | parity all MATCH; base-recorded replay verifies; outcome digests and state hashes identical; Ir 0.97-1.00x vs `95272a3`; allocations 17.40 -> 14.73 per step (crowded_8); flipping `collecting` to false is caught by the slice fixtures (reviewer mutation) |
| P10a protocol v2 | snapshots drop `server_ms` (= tick x 50 ms); remote actors quantized (u16 position at 1/8 u, u16 facing, hp percent, per-actor field mask, varints), the self view keeps full precision; out-of-range positions are refused, never clamped; `wire::arena_fits` at startup; `protocol/fixtures/v2.json` shared by the Rust, C# and JS decoders | wirebench 1,888 -> 908 B/player/s (0.481x), mean snapshot 89.8 -> 43.0 B; encoder 1.0426x Ir/step of the v1 encoder (budget 1.05x), allocations 37.16 -> 30.11 per step; gameplay digests unchanged |
| P7a allocation-free tick | `Sim::step_into(&mut Vec<Event>)`; scratch cleared not taken; inline input queues; history ring; path cursor; Copy ledger entries with names resolved from an append-only `Roster` at result time; `tests/no_alloc.rs` (dhat); `rh-checkpoint/2` (typed refusal of `/1`) | 0 allocations per steady-state step (crowded_8, duel_chase, fists_duel); perfproof allocations per step 14.73 -> 0.12 and 7.26 -> 0.06 vs `dd867d9`; Ir/step vs `7d94332` crowded_8 0.691x (target 0.70 met), duel_chase 0.688x (target 0.62 **missed**; 0.592x with only the step measured); all fingerprints identical |
| P5b density bench + telemetry | biased room-loop select with one pinned `Sleep` (a due step runs before a queued command); per-room step telemetry is a fixed 384 B log-linear histogram (was an unbounded sample list); process metrics on `/control/health`; `densitybench` (real Room, Outbox, Pacer on a paused clock) | 3 callgrind runs within 0.0012%; telemetry 384 B per room (budget 1 KB); 4.18 M Ir per match-second (practice map, 8 humans), about 82 KB heap per room (DHAT) |
| P5c batched egress | one outbox push and one notify per client per tick; the writer drains in priority order and flushes once per wake under one `SEND_TIMEOUT` (early flushes keep the feed under `WS_MAX_WRITE_BUFFER`); reader liveness by last-seen time on a coarse timer | notifies per human-tick 1.097 -> 1.0 (asserted in `tests/density.rs`); frames byte-identical in the old order (counting-sink test); densitybench Ir +1.7% because the bench has no sockets, so the flush, timer and syscall savings are NOT measured |
| P7b identity and data model | `Store<T>` in id order (`EntityId`), dense per-slot ranks and bounties, `FighterCore` components with `Seat`/`Credit`/`Fate`, `FighterRef`, `rh-checkpoint/3`, `scalebench` (feature `bench`); `parity_bench` parses its fixture outside the measured loop | ledger Ir per entry from N=32 to N=212 grows 1.006x (base 3.96x); same-harness sim-only Ir vs `94a34c1`: crowded_8 0.940x, duel_chase 0.980x, fists_duel 0.971x; vs `7d94332` on one harness: crowded_8 0.595x, duel_chase 0.612x; sim allocations per bot tick 0.387 -> 0.004 |
| P5d reader and admission fixes | biased reader select (a ready client frame beats an overdue liveness tick); two real director admission races fixed plus the test race behind the `pg_e2e` rejoin flake; batched padded metrics counters (shared RMWs 28 -> 7 per wake); refused-snapshot log once per room; real notify counts in densitybench | `pg_e2e` 30 of 30 green under 4 CPU burners (the base failed 3 of 15); the fairness test fails unbiased and passes biased; fingerprints identical; single-thread densitybench Ir +0.26% (unattributed; the RMW saving does not show in single-thread Ir) |

Gates on each merge: fmt and clippy clean, the workspace tests (with PostgreSQL), parity all MATCH, the C# tests and
`sync-net.sh --check` when client-unity or the wire changed, and the browser proof when the server or wire changed. The
perfproof gates were run per package against its merge-base, with fingerprints identical except the declared P10a byte change.

## In progress, NOT merged (other branches)
- **P8 state identity** (serde-derived state hash, no secrets in the digest, leaf-perturbation coverage test, `rh-replay/2`,
  disallowed std APIs in rh-sim) and **P9 observation and publish path** (`observe_into`, exhaustive event visibility,
  due-only bot observation, direct snapshot encoding): specs in [PACKAGES.md](PACKAGES.md).
- **P10b** gated per-connection delta snapshots (after P9), and the **CI perf gate** (perfproof against the PR merge-base).
- Then the **final** review and the last status-record update. Until P8 lands, the state hash still lists its fields by hand
  (66 serialized leaves unhashed at `7d94332`, per the audit baseline in the P8 spec).

## Known issues
- The `pg_e2e` rejoin flake is FIXED (P5d): two real admission races in `director.rs` and a test race. Do not reopen it
  without a failing run.
- P7a's duel_chase Ir target (<= 0.62x of `7d94332`) was missed (0.688x in perfproof, 0.592x step-only). The difference is the
  old `parity_bench` harness's per-step JSON work, which P7b removed from the harness (see the note under "Cumulative").
- P5d: single-thread densitybench shows +0.26% Ir per match-second that nobody attributed (swapping the base room.rs and
  metrics.rs back in recovered only part of it).
- Left by the reviews: the observation path still allocates per seat per tick (P9); `SnapshotWriter` duplicates
  `encode_snapshot_into`'s refusal logic (a test keeps them equal); per-fighter step cost still grows with N in a packed melee
  (1,730 -> 7,204 Ir per fighter at N=8 -> 212, from the O(attackers x bodies) melee candidate scan).
- perfproof's absolute instruction counts are architecture-specific (the numbers here are x86_64); compare A/B on one machine.

## Resuming on macOS
Tools: Xcode command line tools; `rustup` (the toolchain comes from `rust-toolchain.toml`); Node 22; the .NET 8 SDK;
PostgreSQL 16 (Homebrew `postgresql@16`); Docker Desktop (for perfproof); Unity Hub with the Unity 6.0 LTS Editor + WebGL module
(for P-UNITY-1; prefer the newest 6.0 patch over the pinned `6000.0.23f1`, which predates a Unity security advisory).

```
git fetch origin optimization_port   # plus the branches of the packages still in progress (P8, P9, P10b, CI)
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

## Cumulative (merged head `a0e705e` vs the Stage 1 head `7d94332`)
Measured for this record at `a0e705e` with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only`:
`python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,wire_seed1_8bots,headless_seed1_8bots,headless_arena_8bots`
(x86_64 cloud container, 4 vCPU; deterministic counts per unit of work):

| Workload | Instructions | Allocations | Allocated bytes |
|---|---|---|---|
| sim_crowded_8 (8 players brawling, per step) | 15,272 -> 7,545 (0.494x; see note) | 19.32 -> 0.13 | 1,804 -> 124 |
| sim_duel_chase (pathfinding, per step) | 5,893 -> 2,979 (0.506x; see note) | 10.71 -> 0.07 | 625 -> 57 |
| sim_fists_duel (per step) | 5,521 -> 2,665 (0.483x; see note) | 10.45 -> 0.18 | 669 -> 112 |
| wire_seed1_8bots (step + observe + encode for 8, per step) | 50,692 -> 32,345 (0.638x) | 72.16 -> 22.73 | 5,273 -> 2,724 |
| headless_seed1_8bots (full bot tick, per tick) | 14,647 -> 10,124 (0.691x) | 13.34 -> 3.38 | 1,502 -> 813 |
| headless_arena_8bots (per tick) | 48,844 -> 41,315 (0.846x) | 32.15 -> 14.74 | 5,014 -> 3,544 |

Behaviour fingerprints are identical on every workload (outcome digests, final state hashes, state-hash folds; the candidate
prints keys the base does not), except the declared P10a change on `wire_seed1_8bots`: 1,888 -> 908 B/player/s and mean
snapshot 89.8 -> 43.0 B. perfproof therefore printed `GATE FAILED` for exactly those two fingerprint keys (it needs
`--allow-fingerprint-change` to declare them); nothing else tripped.

**Note on the `sim_*` rows.** They run `parity_bench`. At `7d94332` that harness parsed the fixture's JSON inside the measured
loop (per-step `Value` lookups for every input); P7b moved the parsing out of the loop. The base side of the table runs the old
harness and the candidate the new one, so the `sim_*` rows (instructions, allocations and bytes alike) include the removal of
the harness's own work and overstate the simulator's gain. Same-harness figures from the P7b report (not re-run for this
record): Ir per step vs `7d94332` with the new harness on both sides, crowded_8 12,673 -> 7,546 (0.595x) and duel_chase
4,869 -> 2,978 (0.612x), final hashes identical. The simulator itself is proven allocation-free per steady-state step by
`crates/rh-sim/tests/no_alloc.rs`. The `wire_*` and `headless_*` rows do not use `parity_bench`.

Deterministic server figures re-measured at `a0e705e` (not part of perfproof): wirebench 908 B/player/s (snapshot 859, fx 48,
22.9 frames per player-second, Welcome 4,911 B); densitybench `--rooms 4 --humans 8 --secs 20` (practice map, no bots):
notifies 1.0 and writer wakes 1.0 per human-tick, 1.0947 frames and 92.83 B per human-tick, 4,178,279 Ir per match-second
((519,590,708 at 30 s - 185,328,394 at 10 s) / (4 rooms x 20 s), callgrind).

The largest gains still to come: the serde-derived state hash (P8, hashing cost <= 0.30x), the observation and publish path
(P9: publish allocations <= 1.2 per viewer-tick, wire Ir <= 0.75x) and per-connection deltas (P10b).
