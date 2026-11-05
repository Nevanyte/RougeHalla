# Migration record and checkpoint

The single status record of the Rust + Unity + AWS migration. **Only the coordinator edits this file.** Requirements:
[REQUIREMENTS.md](REQUIREMENTS.md). Invariants and their validation status: [CONTRACTS.md](CONTRACTS.md). Remaining work:
[backlog/README.md](backlog/README.md). Decisions: [adr/](adr/README.md).

## Checkpoint (end of Stage 1)

| | |
|---|---|
| Branch | `optimization_port` (created from `main` at `75c5b83`, the legacy baseline) |
| Stage 1 revision | the head of `optimization_port` carrying this file (Stage 1 commits: `114156b`..HEAD; see `git log 75c5b83..`) |
| Working tree at handoff | clean (everything committed and pushed) |
| Verdict | **READY FOR THE BULK PORT WITH EXTERNAL GATES** (gates below) |
| Sweep revision | `ae0c37b` on `optimization_port`: P2b, P10a, P7a, P5b, P5c, P7b, P5d, P8, P9, the CI perf gate, the P10b measurement, H-server, H-server-2, H-sim and **P10c (protocol v3)** are merged (`git log --merges 07bc297..ae0c37b`) |
| Efficiency and lock-in revision | `b326676` on `optimization_port`: E-sim, E-pub, E-backlog, E-simplify, E-sight (efficiency) and L-envelope, L-durable, L-sim, **L-v4 (protocol v4)** (lock-in) are merged on top of the sweep (`git log --first-parent 056bb31..b326676`; `056bb31` is the merge of the closing sweep docs) |
| Next | The core optimization sweep, the efficiency pass and the lock-in pass are complete ([sweep/README.md](sweep/README.md), "Efficiency and lock-in pass"). Next: backlog wave 0 (P-CAPTURE-1) and wave 1 (the bulk port); P-UNITY-PERF-1 is for the Codex stage. The wire is protocol v4 ([ADR 0011](adr/0011-protocol-v4.md): append-only varint masks over the per-connection deltas of ADR 0010) |
| Sweep status | **Complete** at `ae0c37b` (efficiency and lock-in passes complete at `b326676`); the Stage 1 tables below are kept as recorded and marked, the "Sweep results" section carries the current numbers (merged table, corrections and open follow-ups: sweep/README.md). P10c: protocol v3 per-connection deltas, 908 -> 305 B/player/s on the slice at 1.048x wire Ir, fingerprints identical |

### External gates (cannot be resolved inside this repository)
1. **Unity Editor + license**: none was available. The Unity project (`client-unity/UnityProject`) was never opened,
   compiled or built for Web; the browser path was proven with a JavaScript client and a .NET client instead (below).
   Unblock: a machine with Unity 6 LTS and a license; packet P-UNITY-1.
2. **AWS access + budget authorization**: the environment's AWS credentials were invalid (`sts get-caller-identity` →
   `InvalidClientTokenId`). GameLift staging was not run; a valid TLS certificate and public DNS were not proven.
   Unblock: a sandbox account, a budget guard, a domain; run [hosting/STAGING_EXPERIMENT.md](hosting/STAGING_EXPERIMENT.md)
   (packet P-HOST-1). The 200 matches / 1,600 players scenario stays an assumption.
3. **Owner decisions**: license (none declared), map re-pin policy (P-MAP-1), latency ceilings, the 60 FPS reference
   hardware, profile-API placement, legacy retirement (list in [backlog/README.md](backlog/README.md)).

## What Stage 1 built (and what it did not)
Built and tested: the Rust workspace (`rh-sim`, `rh-protocol`, `rh-policy`, `rh-headless`, `rh-server`, `rh-persist`,
`rh-parity`); a real gameplay slice (movement and collision with the exact legacy A* path, fists melee with zero-windup
player swings, cooldowns and lag-compensated rewind, the damage ledger with the PvP factor, mitigation, hit cap,
simultaneous resolution, kill credit, bounty, GV, the win-bonus gate, leaving as MIA, results); a differential harness that
replays captured legacy scenarios; protocol v1 with golden vectors in Rust and C#; a live WSS server; a browser proof;
PostgreSQL persistence; the policy seam; CI.

**Not ported** (everything else; see the backlog): items and the other weapons, projectiles, target lock, faction
signatures, statuses and Wishes, cards and chests, mobs and camps, consumables, traders, quests, vision memory and bushes,
terrain hazards, planning, coliseum and sudden death, training, telemetry, the bot brain, the map generator, the profile
REST API, the Unity flows and visuals, hosting integration. **The slice is not the full game; no full-game parity or
release readiness is implied.**

## Legacy baseline (revision `75c5b83`)
- Code size: shared 21k, server 37k, client 36k lines of TypeScript; 432 test files.
- Inventory, numbers, random sources, secret vs public state, hosting shape and doc/code disagreements:
  [legacy/INVENTORY.md](legacy/INVENTORY.md). The legacy architecture document moved to
  [legacy/CLAUDE_LEGACY.md](legacy/CLAUDE_LEGACY.md) (verbatim, partly stale: code wins).
- Flow traced: client input → `enqueueClientMessage` (validated, queued) → fixed 20 Hz `step()` (secret per-tick order,
  fixed system order, ledger) → Colyseus state patches + `fxs` tuples to every client (no interest management) → Phaser
  render in the past (adaptive delay) with local prediction → `resolved` results → `ProfileStore` JSON file (single
  writer; production mirrors the whole file to R2).

### Legacy test baseline (pre-existing; recorded, not caused by Stage 1)
Run on this machine while other work competed for its 4 vCPUs (so time-limited tests are fragile here):
- `npm run typecheck`: passed.
- `npm test -w @raid/client`: 2,838 passed, 5 failed (159 files). All 5 are timeouts (5 s / 30 s limits) in
  `minimapLayout`, `questPathing` and `zoneShapesBake`.
- `npm test -w @raid/server`: 5,831 passed, 8 failed (171 files; `perf.test.ts` then skipped by the script's `&&`). Six are
  timeouts (60-120 s limits: `chestsModule`, `tournament`, `mapPool` x2, `planning` "taken", `terrain` seeds 1..20); two
  are CPU-budget gates under load (`perception` cost 2.08 ms vs < 1 ms; `terrainPerf` step avg 7.2 ms vs < 5 ms).
- `npm test -w @raid/shared`: 1,816 passed, 8 failed. Five are timeouts; three are CPU-budget gates under load (styler
  12.8 ms vs <= 6 ms, pathfind 2.26 ms vs < 2 ms, warren 48.7 ms vs < 30 ms). Re-run the gates on a quiet machine.
None of these is a behavioural failure; they are recorded as pre-existing environment failures. Stage 1 changed no file
under `packages/` (verify: `git diff 75c5b83 --stat -- packages` is empty).

## Tool versions (Stage 1 environment)
rustc 1.97.0 (pinned in `rust-toolchain.toml`), cargo 1.97.0; Node v22.23.4, npm 10.9.9; .NET SDK 8.0.427; PostgreSQL 16.15;
Python 3.13.18; Playwright 1.63.0 with HeadlessChrome 153.0.8010.12; Claude Code 2.1.318. Machine: Linux 6.18 x86_64,
4 vCPU Intel Xeon @ 2.80 GHz (virtualized cloud container, native x86_64 execution, shared CPU), 15 GB RAM.

## Commands and results (actually run at the Stage 1 revision)

| Command | Result |
|---|---|
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | clean |
| `cargo test --workspace --all-features` (with `DATABASE_URL` from `tools/pgtest/start.sh`) | 63 passed, 0 failed, in three consecutive full runs (rh-sim, rh-parity, rh-protocol, rh-policy, rh-headless, rh-server incl. `live` 11, `pg_e2e` 2, `sigterm` 1, `equivalence` 1, rh-persist) |
| `cargo run -p rh-parity --bin parity-report` | 13 slice scenarios MATCH (max position error 5.0e-7 u, max hp error 4.9e-7), including `drop_releases_trigger` and four `tie_kill_credit_*` scenarios decided only by the secret action order; 300 findPath queries MATCH; `bow_wand_capture` capture-only |
| `dotnet test client-unity/RoguehallaNet.Tests` | 72 passed; `client-unity/sync-net.sh --check` up to date |
| `node tools/browser-proof/proof.mjs` | PASS (re-run after the exit-review fixes): admission + map hash, input applied and acked, resume into the same seat, authoritative results, no page errors ([evidence/browser-proof.json](evidence/browser-proof.json)) |
| `dotnet run --project client-unity/RoguehallaNet.Probe -- --url ws://127.0.0.1:7461/ws --content-hash <from /info> ...` | Welcome + 157 snapshots in 8 s, RTT p50 8.4 ms, no errors; the server then drained on SIGTERM ([evidence/csharp-probe.json](evidence/csharp-probe.json)) |
| `npm run typecheck` (legacy) | passed |

### Gates at `3ad072b` (from the H-server report and review; the merge itself re-ran them; P10c, H-server-2 and H-sim ran theirs on their own branches, see sweep/README.md)
Not re-run for this docs-only record; counts are the H-server package's own gate results on its branch (`d5f2eac`..`0aff006`,
merged as `3ad072b`):

| Command | Result |
|---|---|
| `cargo fmt --all --check`; `cargo clippy --workspace --all-targets --all-features -- -D warnings` | clean |
| `cargo test --workspace --all-features` (PostgreSQL via `tools/pgtest/start.sh`) | 262 passed, 0 failed, 1 ignored |
| `cargo run -p rh-parity --bin parity-report` | 13 slice scenarios MATCH + 1 capture-only, 300 pathfinding queries MATCH |
| `dotnet test client-unity/RoguehallaNet.Tests`; `bash client-unity/sync-net.sh --check` | 138 passed (72 at Stage 1, 128 at `a0e705e`; 175 with P10c); Unity copy up to date |
| `node tools/protocol-js/check-vectors.mjs` | 12 server vectors, 31 malformed, 663 checks (v2.json at that revision; `ae0c37b`, v3.json: 14 server vectors, 45 malformed, 9 delta chains, 1945 checks) |
| `cargo build -p rh-server && node tools/browser-proof/proof.mjs` | PASS: 386 snapshots, 110 fx frames, RTT p50 0.9 ms, no page errors, `resultsOk` 2 |
| C# probe against `target/debug/rh-server` | welcome, 118 snapshots in 6 s, RTT p50 7.57 ms, no rejects; the server drained on SIGTERM |
| `pg_e2e` + director/conn/room tests + `transport`, 20 consecutive runs under 4 CPU burners | 20 of 20 green |
| `python3 tools/perfproof/perfproof.py --baseline <merge-base> --max-ir-ratio 1.03 --max-alloc-increase 0` | the CI gate (`.github/workflows/perfproof.yml`, [CONTRIBUTING.md](../CONTRIBUTING.md)); the same command runs locally with valgrind on Linux |

## Benchmarks (labelled; the machine is a shared 4-vCPU container, read the shape, not the decimals)
The tables in this section are the **Stage 1 record** (revision at the checkpoint above, wall-clock, protocol v1); the
sweep and the later passes changed the tick, the wire and the server since. Current deterministic numbers are in "Efficiency and lock-in pass" (newest) and "Sweep results" below. Wire
bytes and the tick costs in the tables below are historical; do not quote them as current.
Release builds; `x86_64`, native; the shared 4-vCPU container described above. Sources: `parity-bench`,
`parity/legacy-capture/bench.ts`, `wirebench`, `rh-headless`, and the legacy `stepBench.ts` / `bandwidth.ts`.

**Tick CPU on identical recorded workloads** (same map, inputs, outcomes; 20 runs after warm-up; µs per `step()`):

| Scenario (ticks per run) | Rust slice mean / p50 / p99 | Legacy TS (Node 22) mean / p50 / p99 |
|---|---|---|
| `crowded_8`: 8 players brawling (901) | 1.81 / 1.44 / 6.01 | 883.6 / 946.6 / 1894.6 |
| `fists_duel` (280) | 0.84 / 0.63 / 2.99 | 69.4 / 32.9 / 444.5 |
| `duel_chase` with pathfinding (716) | 0.52 / 0.31 / 1.36 | 113.6 / 54.7 / 455.0 |

Not a like-for-like "port speedup": the outcomes are identical, but the legacy world also runs every installed system
(vision memory, stat-mirror folding, camps/quests/consumables bookkeeping) while the Rust number covers the slice only.
What it does show: the slice's mechanics cost a few microseconds per tick in Rust.

**Legacy full game** (`stepBench.ts`, 8 scripted players, 204 mobs, 1,200 ticks): step avg 5.90 ms, p50 5.69, p99 12.41,
max 15.12 (gate avg < 5: exceeded on this busy machine; CPU-time avg 8.62 ms). With hazards on every 4th tile: avg 6.22.
This, not the slice, is the workload the Rust port must eventually beat; measure it per mechanic as packets land.

**Rust headless throughput** (`rh-headless`, 8 brawler bots): practice arena: 50 matches, all terminated, 76,523
ticks/s on one thread (p50 per-match mean step 14.1 µs); legacy seed-1 map 160x160: 20 matches, 364,595 ticks/s
(2.7 µs/step), all truncated at 12,000 ticks because the wandering bots rarely meet on the big map (a scripted-bot
limitation, not the sim's).

**Bytes per player, Stage 1, protocol v1** (payload only, no WebSocket/TCP/TLS framing; protocol v2 is 908, v3 305 and v4 285 B/player/s on
the "players only" workload, see "Sweep results" and "Efficiency and lock-in pass"; the other rows were not re-measured):

| | Rust slice (`wirebench`) | Legacy (`bandwidth.ts`, seed 1) |
|---|---|---|
| Players only, spread over the 160x160 map | 1.89 KB/s (mean 1.5 actors in sight) | 4.94 KB/s ("no mobs" scenario) |
| Worst case: 8 fighters in one room, all in sight | 4.87 KB/s | n/a |
| Typical / heavy with ~204 mobs | n/a (no mobs yet) | 11.18 / 15.17 KB/s |
| Join payload | Welcome with the 160x160 map: 4,911 B | first full sync 32.8 KB (6.6 KB players only); the map itself was generated client-side |

Encoding: observe + encode one player's frames 1.33 µs per tick (seed-1 map), 2.19 µs (8 in sight).

**Join and RTT** (browser proof, loopback, debug build): Hello→Welcome 2.4 ms; page load→Welcome 129 ms (TLS, `/info`);
resume Hello→Welcome 2.5 ms; Ping RTT p50 1.4 ms. C# probe: RTT p50 8.25 ms under load. Not measured: real-network RTT,
browser frame times (the Unity client does not exist yet; the legacy Phaser figures in `docs/legacy/CLAUDE_LEGACY.md`
are historical, not re-measured), memory per match (the slice's `Sim` is small; measure with mobs).

**Capacity:** not established. The slice's numbers say nothing about the full game's density; the sizing scenario
(200 matches / 1,600 players) remains an assumption (ADR 0004). The sweep added an in-process density estimate, clearly
labelled below ("Sweep results"); it is not AWS capacity.

## Sweep results (core optimization sweep, complete; merged head `ae0c37b`)
Machine for every number here: x86_64 cloud container, 4 vCPU (Intel Xeon @ 2.80 GHz, shared), Linux 6.18. Instruction and
allocation figures are **deterministic counts** (valgrind callgrind Ir and DHAT, deterministic up to the stated noise floor); wall times are not
used for any claim. Packages merged: P2b, P10a, P7a, P5b, P5c, P7b, P5d, P8, P9, the CI gate, the P10b measurement,
H-server, H-server-2, H-sim and P10c (details, per-package proofs, the merge-message omissions and the corrections to merged
claims: [sweep/README.md](sweep/README.md)). The wire was protocol v3 at this record (it is v4 since the lock-in pass, next section); figures labelled v2 or Stage 1 are history.

**Noise floor.** perfproof's self-comparison noise is about +-0.1% (up to 0.3% on the smallest per-step workloads), not the
+-0.02% earlier records stated: the sweep-wide proofs review compared `a0e705e` with itself and measured 0.9989 (crowded_8),
0.9994 (duel_chase) and 0.9991 (fists_duel), and 0.9971 on fists_duel between two revisions with no Rust change. The CI gate
(Ir ratio 1.03) and the per-package gates were sized with that in mind; differences under 0.3% are not evidence.

**Per-package results since `a0e705e`** (each against its own merge-base, deterministic counts; the full rows are in
[sweep/README.md](sweep/README.md)):

| Package | Result |
|---|---|
| P8 state identity | 0 unhashed leaves of 12,696 (66 before); hashing cost 15,170 -> 2,915 Ir per tick (0.192x); verify_replay 0.444x; step cost +1.2% (crowded_8) and +0.6% (headless_seed1_8bots), unattributed |
| P9 observation and publish | wire 32,345 -> 25,842 Ir/step (0.799x); publish 1.13 allocations per viewer-tick (22.73 -> 9.08 per step); headless 0.717x; headless_arena 0.529x |
| CI perf gate | `perfproof.yml`: Ir <= 1.03x, no allocation increase, declared fingerprints; dry run passes; not yet seen on a real PR |
| P10b delta measurement | 62.0% of bytes at 8 players (908 -> 345 B/player/s), about 1.06x publish Ir (estimate); decision: protocol v3, shipped as P10c |
| H-server hardening | wire 25,811 -> 25,918 Ir/step (+0.41%), densitybench +0.30% Ir per match-second, fingerprints identical |
| H-server-2 | small server follow-ups (camelCase `/info` keys, no session for a gone room, duplicate result reports give their lease back); no sim or wire figure |
| H-sim restore hardening | `Sim::restore` refuses the states its rules cover (rules: CONTRACTS C-DET), saturating counters, opaque `Command`; Ir vs `3ad072b` within 1.0056 on four workloads (worst `sim_duel_chase`), allocations and fingerprints identical, base-recorded replays verify; 0 false refusals on between-step checkpoints of bot and lobby matches (`restore_real.rs`) |
| P10c protocol v3 | per-connection Full/Delta snapshots encoded in the writer task, deferred never-dropped Resync (forced Fulls 20 ticks apart); wirebench 908 -> 305 B/player/s (mean snapshot 43.0 -> 12.8 B); `wire_seed1_8bots` 25,929 -> 27,178 Ir/step (1.0482x vs `2e8682c`), allocations 9.08 = 9.08, allocated bytes 366 -> 827; outcome digest and state-hash folds identical; Rust, C# (175 tests) and JS (1,945 checks) agree on `v3.json` |

**Cumulative against the Stage 1 head `7d94332`** (sim and headless rows measured at `2e8682c`: `python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,headless_seed1_8bots,headless_arena_8bots`; they stay valid at `ae0c37b` because P10c changed nothing in `crates/rh-sim`, `rh-headless` or `rh-policy` (`git diff --stat 2e8682c ae0c37b` on them is empty). The wire row was measured at `ae0c37b`: `python3 tools/perfproof/perfproof.py --baseline 7d94332 --only wire_seed1_8bots --allow-fingerprint-change wire_seed1_8bots.bytesPerPlayerPerSec,wire_seed1_8bots.meanSnapshotBytes`. Needs valgrind; gate: pass for both):

| Workload (per step / tick) | Instructions | Allocations |
|---|---|---|
| sim_crowded_8 | 15,273 -> 7,667 (0.502x, harness caveat) | 19.32 -> 0.13 |
| sim_duel_chase | 5,899 -> 3,030 (0.514x, harness caveat) | 10.71 -> 0.07 |
| sim_fists_duel | 5,511 -> 2,718 (0.493x, harness caveat) | 10.45 -> 0.18 |
| wire_seed1_8bots (protocol v3; allocated bytes 5,273 -> 827) | 50,692 -> 27,179 (0.536x) | 72.16 -> 9.08 |
| headless_seed1_8bots | 14,647 -> 7,307 (0.499x) | 13.34 -> 0.06 |
| headless_arena_8bots | 48,844 -> 21,836 (0.447x) | 32.15 -> 0.46 |

Against `3ad072b` (the previous record) the sim-side rows moved by +0.46% (crowded_8, 7,632 -> 7,667), +0.70% (duel_chase,
3,009 -> 3,030), -0.22% (fists_duel, 2,724 -> 2,718), +0.11% (headless_seed1, 7,299 -> 7,307) and +0.21% (headless_arena,
21,791 -> 21,836), from H-sim (saturating tile arithmetic and the finiteness test in the pathfinder), not isolated further.
crowded_8 and duel_chase are above the noise floor, and headless_arena arguably too. These deltas compare against an earlier
record, not an A/B run, which is why duel_chase reads 1.0070 here against the H-sim A/B maximum of 1.0056. Allocations and
bytes per unit are unchanged. Outcome digests equal the previous record; the H-sim A/B against `3ad072b` found every
fingerprint identical. At `a0e705e` (before P8, P9, H-server) the same table read 7,545 / 2,979 / 2,665 for the three sim rows, 32,345 for wire,
10,124 for headless_seed1 and 41,315 for headless_arena. The sim rows rose 1.0% to 2.2% with P8 (the statics digest and the hash
walk; above the noise floor), the wire and headless rows fell with P9. The wire row at `ae0c37b` is 0.536x of Stage 1
(v2 at `3ad072b`: 0.511x): the delta encoder costs 1.0482x for 66% fewer bytes.

Harness caveat: the `sim_*` rows compare the old `parity_bench` (parsed fixture JSON inside the measured loop) with the new one
(P7b moved the parsing out), so they include removing the harness's own work. With an overlay of the new harness on both sides
(P7b report, never committed, not re-runnable): crowded_8 0.595x and duel_chase 0.612x Ir per step vs `7d94332` at `29d341c`.
Behaviour fingerprints equal the per-package ones; the base at `7d94332` prints no outcome digest or final hash, so identity to
it is transitive across the package gates. Declared changes over the sweep: the P10a wire bytes, the P8 hash values and the
P10c wire bytes. (At `3ad072b` the declared ones were the P10a bytes and the P8 hash definition; the sim-side run at `2e8682c`
declared nothing because the base prints no hash; the wire run at `ae0c37b` declared the two byte keys.)

**Wire** (`cargo run --release -p rh-server --bin wirebench`, seed 1, 8 bots, 2,400 steps, payload bytes only), measured at
`ae0c37b`: **305 B/player/s** (snapshot 256, fx 48, events 0; 22.9 frames per player-second; mean snapshot 12.8 B, 8 Full and
19,192 Delta frames; mean 1.49 actors in sight; Welcome 4,911 B). History: 1,888 B/player/s (mean snapshot 89.8 B) under
protocol v1 at `7d94332`, 908 under v2 (P10a), 305 under v3 (P10c): 0.162x of Stage 1. The wire workload is 0.536x Ir/step of
Stage 1 at `ae0c37b`, including everything else that changed. Not measured: v3 on a real network (a client that keeps refusing
deltas costs one Full frame per 20 ticks).

**Server density** (`densitybench`, in-process: the real Room, Outbox and Pacer on a paused clock, in-process clients, no
sockets, TLS or kernel network). `cargo build --release -p rh-server --features bench --bin densitybench`, then
`target/release/densitybench --rooms 4 --humans 8 --secs 20` (practice map, 8 humans per room, no bots): notifies 1.0 and
writer wakes 1.0 per human-tick (1.097 notifies before P5c), 1.0947 frames and 92.83 B per human-tick, **4,178,279 Ir per
match-second** (callgrind: (519,590,708 at `--secs 30` - 185,328,394 at `--secs 10`) / (4 rooms x 20 s)). From the P5b report,
not re-run here: about 82 KB heap per room (DHAT, practice map, `--rooms 1` vs `--rooms 5` t-gmax), 31.1 M Ir per match-second
on the seed-1 map (2 rooms), per-room step telemetry 384 B (fixed histogram; was an unbounded sample list).

**Capacity estimate (an ESTIMATE, not measured AWS capacity):** the bench prints matches per vCPU from this machine's
single-thread paused-clock wall time with 50% CPU headroom: 539.5 on the practice map in the run above (wall time is noisy);
the P5b report recorded 566 (practice map) and 73 (seed-1 map, the large map) per vCPU. There are no sockets, TLS or kernel
network in it; the Stage 1 audit measured sockets at about 80% of server CPU on the slice, so a real instance will be well
below these figures and must be measured on the target instance (ADR 0004, P-HOST-1). Use the deterministic counts (Ir per
match-second per map, wakes and notifies per human-tick, heap per room) as the sizing inputs, not these wall-clock estimates.

**Scaling** (`cargo run --release -p rh-headless --features bench --bin scalebench -- step 212 200`). The P7b report's "ledger
Ir per entry 873 at N=32 and 878 at N=212 (1.006x; 3.96x before P7b)" did not reproduce and is **withdrawn**. Reproducible
(the sweep-wide review; `valgrind --tool=callgrind --toggle-collect='*ledger*apply*' target/release/scalebench step <N> 100`,
toggled Ir divided by the ledger entries the bench counts): **664 Ir per entry at N=32 and 740 at N=212 over the first 100
ticks, 1.115x**, under the 1.3x limit. In steady state (a differential of T=400 minus T=300) it is 592 and 945 Ir per entry,
**1.60x, over the limit**, from the linear `Credit.damaged.contains` scans in `systems/ledger.rs`; an O(1) membership is an open
follow-up (sweep/README.md). `Sim::step` Ir per fighter per step in a packed melee 1,730 / 2,628 / 5,019 / 7,204 at N = 8 / 32 /
128 / 212 (17,425 at N=212 before P7b: the melee candidate scan is still O(attackers x bodies)); observe 7.3 us and publish
9.6 us at 204 synthetic actors (wall, noisy). These P7b figures were not re-run for this record.

**Commands for these numbers:** perfproof as above (self-contained: it builds the baseline in a temporary worktree; use
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only` and about 6 GB of free disk; delete `target/perfproof`
afterwards); `cargo run --release -p rh-server --bin wirebench`; densitybench and scalebench as above;
`cargo test -p rh-sim --test no_alloc` (0 allocations per steady-state step); the CI gate and its local form are in
[CONTRIBUTING.md](../CONTRIBUTING.md) (`python3 tools/perfproof/perfproof.py --baseline $(git merge-base origin/main HEAD)
--max-ir-ratio 1.03 --max-alloc-increase 0`).

## Efficiency and lock-in pass (complete; merged head `b326676`)
Same machine and method as the sweep (deterministic callgrind Ir and DHAT counts; wall time is not used for any claim). Two stages
followed the core sweep: **efficiency** (E-sim, E-pub, E-backlog, E-simplify, E-sight) from the final efficiency review, and
**lock-in** (L-envelope, L-durable, L-sim, L-v4) for the decisions that are cheap before the bulk port and expensive after it.
What each package changed, what was dropped and why, and the open follow-ups with their locations:
[sweep/README.md](sweep/README.md), "Efficiency and lock-in pass". Per-package figures are from the package reports, each against
its own merge-base:

| Package | Result |
|---|---|
| E-sim kernel fast paths (bit-identical) | `sim_crowded_8` 0.964x, `sim_duel_chase` 0.919x, `sim_fists_duel` 0.999x, `paths_300` 0.948x, `headless_arena_8bots` 0.872x, wire 0.940x; scalebench step N=212 1,562,992 -> 1,297,737 Ir (0.830x) with identical final hashes; every fingerprint identical |
| E-pub publish path | wire Ir 0.950x; allocated bytes per wire step 827 -> 107 at equal allocation counts; `densitybench` Ir -1.0% and allocated bytes -47%; v3 bytes identical |
| E-backlog | docs: P-UNITY-PERF-1 (Codex stage), P-NET-7 |
| E-simplify | type-aware content scan (`NON_GAMEPLAY` 58 -> 17), lease conformance table on both stores, dead APIs removed |
| E-sight sight memo | wire 0.875x, `headless_arena_8bots` 0.832x, `headless_seed1_8bots` 0.985x; worst case (all-moving humans) +0.30% / +0.04% Ir per match-second; fingerprints identical |
| L-envelope | frozen Hello prefix and Reject frame, unknown Reject codes decode, strings over 255 bytes refused; owned Unity `Net/` views; wire 1.0000x |
| L-durable | `profile_id` key, versioned match record and `matches` table, tolerant blobs, `schema_compat` gate, build and content headers on replays and checkpoints, pinned durable ids; gameplay fingerprints identical. **The initial migration `0001_init.sql` changed: local and test databases must be recreated; the first production deployment freezes it** |
| L-sim | policy contract v2 (`MatchStart`), optional damage source, `FighterIx` addressing; Ir at most 1.0045x, fingerprints identical |
| L-v4 protocol v4 | **305 -> 285 B/player/s**; wire Ir 1.0041x; headless 1.0000x; Rust, C# (199 tests) and JS (2,078 checks) agree on `protocol/fixtures/v4.json`; the Result is re-sent after a resume |

**Cumulative against the Stage 1 head `7d94332`**, measured at `b326676` for this record:
`python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,wire_seed1_8bots,headless_seed1_8bots,headless_arena_8bots --allow-fingerprint-change wire_seed1_8bots.bytesPerPlayerPerSec,wire_seed1_8bots.meanSnapshotBytes`
(needs valgrind; gate `pass`; the declared changes are the two wire byte keys):

| Workload (per step / tick) | Instructions | Allocations | Allocated bytes |
|---|---|---|---|
| sim_crowded_8 | 15,272 -> 7,432 (0.487x, harness caveat) | 19.32 -> 0.13 | 1,804 -> 125 |
| sim_duel_chase | 5,895 -> 2,790 (0.473x, harness caveat) | 10.71 -> 0.07 | 625 -> 58 |
| sim_fists_duel | 5,518 -> 2,718 (0.493x, harness caveat) | 10.45 -> 0.18 | 669 -> 116 |
| wire_seed1_8bots (protocol v4) | 50,692 -> 22,344 (0.441x) | 72.16 -> 9.08 | 5,273 -> 99 |
| headless_seed1_8bots | 14,647 -> 7,098 (0.485x) | 13.34 -> 0.06 | 1,502 -> 284 |
| headless_arena_8bots | 48,845 -> 15,912 (0.326x) | 32.15 -> 0.47 | 5,014 -> 281 |

Harness caveat for the `sim_*` rows: the base side runs the old `parity_bench` (fixture JSON parsed inside the measured loop) and the
candidate the new one (P7b moved the parsing out), so those rows include the removal of the harness's own work and overstate the
simulator's gain (same-harness figures from the P7b report, not re-runnable: crowded_8 0.595x, duel_chase 0.612x at `29d341c`);
the `wire_*` and `headless_*` rows do not use `parity_bench`. Against the `ae0c37b` record above, the same rows read
7,667 -> 7,432, 3,030 -> 2,790, 2,718 -> 2,718, 27,179 -> 22,344, 7,307 -> 7,098 and 21,836 -> 15,912 Ir. Outcome digests, final
state hashes and state-hash folds equal the `ae0c37b` record, so the two passes changed no gameplay outcome. The headless rows allocate
22 to 29 bytes more per tick than at `ae0c37b` at an equal allocation count (not isolated; see the sweep README).

**Wire** (`wirebench`, seed 1, 8 bots, 2,400 steps, payload only): **285 B/player/s** with v4 (snapshot 236, fx 48; mean snapshot
11.8 B; 8 Full and 19,192 Delta frames; Welcome 4,911 B). History: 1,888 (v1), 908 (v2), 305 (v3), 285 (v4): 0.151x of Stage 1.
Crowd: 204 synthetic fighters cost 20,085 B/viewer/s with the shipped codec (`wirebench --synthetic 204`, under the `bench` feature); at
1000 fighters 757 of 800 viewer snapshots exceed `MAX_ACTORS` and are refused (a limit for the mobs stage, not new).

**Not measured, not addressed:** the kernel socket cost. In a live run kernel and socket work is about 53% of server CPU, about one
`sendto` per viewer-tick; no package here changes that (P-NET-7, which builds on v4, is the candidate and needs an owner decision).
The `densitybench` capacity estimate above still excludes sockets, TLS and the kernel network, so it is not AWS capacity.

## Optimizations made in Stage 1 (with evidence)
| Change | Mechanism | Evidence | Behavioural risk |
|---|---|---|---|
| Interest-managed replication | Each client gets only what its observation contains (legacy synced every entity to everyone) | `wirebench` bytes per player (table above); leak tests | Vision trail memory not yet ported: a client sees less than legacy until P-VISION-1 (never more) |
| Server-sent canonical map | Clients no longer run the generator and compare hashes; one RLE blob per join | Welcome size (table above) | Generator port must keep layers identical (P-MAP-1) |
| Rust core on identical workload | Native code, no GC; same algorithms and order (parity holds) | `parity-bench` vs `bench.ts` (table above) | None measured (parity suite) |
| Off-tick durable I/O with idempotency | Results through a retrying writer (~2 min, capped backoff; the process waits for it on exit), keyed by (match, profile), fenced by the lease the seat was admitted under | `rh-persist` tests, `pg_e2e` | Lease renewal not wired; no local spool (P-PERSIST-2) |
| Hashed tokens | Profiles store SHA-256 of tokens (legacy stored plain tokens) | `rh-persist` tests | Rollback to legacy needs the original file |
| *Sweep:* derived state hash | `Sim::state_hash` is a serde walk over `World`; a new component is hashed when it becomes a serde field | `hash_coverage.rs`: 0 unhashed of 12,696 leaves; hashing 0.192x | Replays are `rh-replay/2`; the hash is server-private (C-RNG) |
| *Sweep:* due-only bot observation, one publish path | Bots build an observation only on decision ticks; the room and `wirebench` share `Publisher::frames` with reused buffers | wire 0.799x, headless 0.717x, 1.13 allocations per viewer-tick | Events between decisions are bounded (256) |
| *Sweep:* batched egress, fair reader, refusing encoders | One push and one notify per client per tick; flush once per wake; reader fairness; Events and Fx refuse, never clamp | notifies per human-tick 1.097 -> 1.0; mutation-checked tests | Superseded on the wire by v3 deltas (next row) |
| *Sweep:* per-connection snapshot delta (protocol v3) | The writer task encodes Full or Delta against the last snapshot that connection wrote; Resync deferred, never dropped | wirebench 908 -> 305 B/player/s; wire 1.048x Ir; vectors agree in Rust, C#, JS | Clients refuse and Resync on a delta they cannot apply; a lossy link costs Full frames (1 per 20 ticks at most) |
| *Efficiency and lock-in:* kernel fast paths, shared quantization, sight memo | Bit-identical fast paths in the sim kernel (E-sim), each actor checked and quantized once per wake and right-sized frames (E-pub), a derived exact-endpoint sight memo (E-sight) | wire 0.441x and headless_arena 0.326x of Stage 1; allocated bytes per wire step 99; fingerprints identical | None measured (parity, replays of base-recorded matches verify) |
| *Lock-in:* protocol v4 | Append-only varint masks, actor kind, a reserved State channel, an admission ticket, the Result kept across a resume | wirebench 305 -> 285 B/player/s; wire 1.0041x Ir; vectors agree in Rust, C#, JS | A stale client gets a decodable reload (the envelope is frozen) |
Queued with evidence or as measurement tasks: spatial indexing for
mobs and perception (P-MOBS-1, when entity counts rise), client-side A* for prediction (P-NET-1), Graviton builds (P-HOST-1).

## Defects found and fixed in Stage 1 (with regression evidence)
1. TLS crypto provider panic: two rustls providers compiled in and none selected; the server panicked at the first TLS
   handshake. Found by the browser proof; fixed by building axum-server without a provider and installing `ring`
   (`crates/rh-server/src/main.rs`). Regression: `tools/browser-proof/proof.mjs` (in CI).
2. A new room closed itself before its first player was seated when admission was still acquiring the durable lease
   (fast in memory, slower in PostgreSQL). Found by `pg_e2e`; fixed with an unclaimed-room timeout
   (`crates/rh-server/src/room.rs` `UNCLAIMED_TIMEOUT`). Regression: `pg_e2e`.
3. JSON replays/checkpoints were not bit-exact (serde_json's default float parsing); fixed with `float_roundtrip`.
   Regression: `rh-headless/tests/env.rs`.

Found by the exit review (below) or by its re-runs; each fixed on this branch with the regression named:

4. Rooms did not report the lobby → run transition; once any run was in progress new players were refused `MatchFull`
   instead of getting a new lobby. Regression: `live.rs` `a_new_player_gets_a_new_lobby_while_a_run_is_in_progress`.
5. A half-open old socket could steer or detach the seat its resume had replaced. Fixed with per-connection ids.
   Regression: `live.rs` `a_replaced_connection_can_neither_steer_nor_detach_the_resumed_seat`.
6. A player who left mid-run lost the MIA result in PostgreSQL: the profile's lease was freed first and the write
   presented fence 0 (`StaleFence`). Leases were also never released on leave, refusal or room close. Regression:
   `pg_e2e.rs` `an_mia_leave_is_banked_under_its_fence` (fails on the old code).
7. The last human's MIA result was dropped when the room closed before its next step. Regression: `live.rs`
   `the_last_humans_mia_result_is_banked_although_the_room_closes`.
8. SIGTERM (what ECS/GameLift send) was not handled: only Ctrl-C drained. Regression: `sigterm.rs` runs the real binary.
9. No liveness: a silent half-open connection held its seat forever and a stuck socket write blocked its writer.
   Regression: `live.rs` `a_silent_connection_is_dropped_and_its_seat_lapses`.
10. C# client: closing raced queued sends (a Leave was lost); a `TooSlow` reject ended the session instead of resuming.
    Regression: `RoguehallaNet.Tests`.
11. A dropped connection kept its trigger held (legacy releases it and drains queued inputs). Regression: legacy
    fixture `drop_releases_trigger`.
12. `state_hash` missed fields that decide later outcomes (GV parts, credit state, budgets, drop times, pending results);
    checkpoints lost results emitted between steps; replays loaded from JSON lacked map tables. Regression:
    `sim.rs` `the_state_hash_sees_every_outcome_field`, `a_checkpoint_keeps_results_emitted_between_steps`.
13. The parity suite never exercised the secret action order, so its negative control passed trivially. Regression: four
    `tie_kill_credit_*` fixtures and a negative control that swaps in a consistent salt and must catch the changed killer.
14. The result writer gave up after a few attempts and the process exited without waiting for in-flight writes.
15. A rate-limited (flooding) client could miss its `RateLimited` reject: the server dropped the socket with unread input
    and the kernel reset it (1 failure in a full-suite run under load). Fixed with a 1 s close linger
    (`conn.rs` `CLOSE_LINGER`). Regression: `live.rs` `a_flooding_client_is_rate_limited` (0 failures in 3 full-suite and
    6 `live` runs after the fix).
16. Docs overstated C-PERSIST, C-HOST and C-NET as fully passed; [CONTRACTS.md](CONTRACTS.md) now states what is and is
    not proven.

Found and fixed during the sweep (each with a regression test that fails on the old code; details in sweep/README.md):

17. P5d: two real admission races in `director.rs` and a test race behind the `pg_e2e` rejoin flake (3 of 15 failures under CPU
    load before, 30 of 30 green after).
18. P9: on a multi-step wake an event was judged against a later step's line of sight and some events were dropped; fixed by
    per-step filtering with a per-human carry (`publish.rs`, mutation-checked).
19. H-server: a failed admission attempt could free its profile entry before its own lease give-back landed, and a give-back could
    run in parallel with the result write it fences (owner tokens, lease states); permanent write refusals were retried; the
    `LEAVING_WAIT` bound was per attempt (about 12 s worst case); a room panic left seats and leases held; an overloaded room
    starved its inbox; Ping and Pong were not charged to the frame bucket; a flood of ready frames could hide a finished writer;
    Welcome and Reject sends had no timeout; Events and Fx could be encoded with clamped values; the JS decoder and the C#
    encoders accepted what Rust refuses.

## Exit gate: independent review
One review workflow, run read-only against this branch: four independent reviewers (high effort; lenses: simulation and
determinism, networking and server, persistence and hosting, handoff and requirements), each asked to challenge the
foundation against [REQUIREMENTS.md](REQUIREMENTS.md) and executable evidence, then one skeptic per critical or major
finding trying to refute it (6 verified, all confirmed). Ten agents in total. Every confirmed finding and the
consequential minor ones are fixed above (4-16). Accepted as open, with owners:
- Lease renewal and the crash lockout: a crashed host's profiles stay leased for the fixed 3600 s TTL; unwritten
  results live only in memory (~2 min of retries), with no local spool (P-PERSIST-2).
- A database error at admission is reported with a generic reject code (minor; P-PERSIST-2).
- The secret order salt is observable through tied outcomes (inherited from legacy; [CONTRACTS.md](CONTRACTS.md) C-RNG).
- Legacy callsigns are case-sensitive while the new store is not (owner decision; backlog list).
- Unity build and AWS staging: external gates 1 and 2.

## Risks (ranked) and next actions
1. Unity Web build unproven (external gate 1): the C# library is tested, the Unity glue was written without a compiler.
2. Hosting unproven on AWS (external gate 2): TLS/DNS on container fleets and `ca-west-1` are the main unknowns.
3. Durable sessions are not crash-safe yet: no lease renewal, no result spool (P-PERSIST-2 before any real players). A room
   panic is now contained (H-server), but a crashed host still leaves its leases to their TTL.
4. The slice's per-tick cost says little about the full game's (mobs, signatures, statuses, quests): measure each
   mechanic as it lands (`stepBench`-style gates per packet) before choosing host density.
5. Legacy behaviour lives in ~95k lines; parity coverage grows only as fast as fixtures are captured (P-CAPTURE-1 first).
6. Observation scope (current sight only) is stricter than legacy (120 s tile trail): the client will show less until
   P-VISION-1.
7. The CI perf gate has not run on a real pull request, and the state hash is server-private (never log or export it).
8. Protocol v4 (L-v4, over the v3 deltas of P10c) is merged and has only been exercised in process and over loopback (no real-network test; kernel socket work is about 53% of server CPU in a live run and is not addressed). Restore hardening (H-sim) is merged: `Sim::restore` refuses
   the states the tick cannot survive (CONTRACTS C-DET); a packet that moves bodies past `COORD_MARGIN` or adds items or ranged
   actions must widen those rules.

## Agents used in Stage 1 (recorded per the brief)
Verified once: Claude Code 2.1.318; the Agent tool exposed a model and an effort setting per invocation; no `.claude/agents`
definitions were needed; no organization override was observed. The coordinator/lead architect was the interactive session.
Workers: legacy-inventory scout (low effort), hosting investigator (medium, web access), persistence builder (medium, isolated
worktree), C# builder (medium), backlog builder (medium); exit-gate reviewers and verifiers (high effort; 10 agents in one
workflow, outside the two-worker limit, run once at the exit gate). At most two building workers ran at once. Model names are
deliberately not recorded in this repository. The sweep used one implementer and one independent reviewer per package, plus
a fix pass where the review blocked (sweep/README.md, Method).
