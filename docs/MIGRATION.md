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
| Verdict | **READY FOR GPT WITH EXTERNAL GATES** (gates below) |
| Next | Backlog wave 0 (P-CAPTURE-1), then wave 1 packets in parallel |

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
- `npm test -w @raid/shared`: not completed (stopped to free the CPU for the benchmarks; it includes the 200-seed map
  certification). Re-run on a quiet machine.
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
| `cargo test --workspace` (with `DATABASE_URL` from `tools/pgtest/start.sh`) | 54 passed, 0 failed (rh-sim, rh-parity, rh-protocol, rh-policy, rh-headless, rh-server, rh-persist) |
| `cargo test -p rh-server --features postgres --test pg_e2e` | 1 passed |
| `cargo run -p rh-parity --bin parity-report` | 8 slice scenarios MATCH (max position error 5.0e-7 u, max hp error 4.9e-7); 300 findPath queries MATCH; `bow_wand_capture` capture-only |
| `dotnet test client-unity/RoguehallaNet.Tests` | 71 passed |
| `node tools/browser-proof/proof.mjs` | PASS: admission + map hash, input applied and acked, resume into the same seat, authoritative results, no page errors ([evidence/browser-proof.json](evidence/browser-proof.json)) |
| `dotnet run --project client-unity/RoguehallaNet.Probe -- --url ws://127.0.0.1:7461/ws ...` | Welcome + 157 snapshots in 8 s, no errors ([evidence/csharp-probe.json](evidence/csharp-probe.json)) |
| `npm run typecheck` (legacy) | passed |

## Benchmarks (labelled; the machine is a shared 4-vCPU container, read the shape, not the decimals)
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

**Bytes per player** (payload only, no WebSocket/TCP/TLS framing):

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
(200 matches / 1,600 players) remains an assumption (ADR 0004).

## Optimizations made in Stage 1 (with evidence)
| Change | Mechanism | Evidence | Behavioural risk |
|---|---|---|---|
| Interest-managed replication | Each client gets only what its observation contains (legacy synced every entity to everyone) | `wirebench` bytes per player (table above); leak tests | Vision trail memory not yet ported: a client sees less than legacy until P-VISION-1 (never more) |
| Server-sent canonical map | Clients no longer run the generator and compare hashes; one RLE blob per join | Welcome size (table above) | Generator port must keep layers identical (P-MAP-1) |
| Rust core on identical workload | Native code, no GC; same algorithms and order (parity holds) | `parity-bench` vs `bench.ts` (table above) | None measured (parity suite) |
| Off-tick durable I/O with idempotency | Results through a retrying writer, keyed by (match, profile) | `rh-persist` tests, `pg_e2e` | Lease renewal not wired (P-PERSIST-2) |
| Hashed tokens | Profiles store SHA-256 of tokens (legacy stored plain tokens) | `rh-persist` tests | Rollback to legacy needs the original file |
Queued with evidence or as measurement tasks: delta snapshot compression (only if bandwidth needs it), spatial indexing for
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

## Risks (ranked) and next actions
1. Unity Web build unproven (external gate 1): the C# library is tested, the Unity glue was written without a compiler.
2. Hosting unproven on AWS (external gate 2): TLS/DNS on container fleets and `ca-west-1` are the main unknowns.
3. The slice's per-tick cost says little about the full game's (mobs, signatures, statuses, quests): measure each
   mechanic as it lands (`stepBench`-style gates per packet) before choosing host density.
4. Legacy behaviour lives in ~95k lines; parity coverage grows only as fast as fixtures are captured (P-CAPTURE-1 first).
5. Observation scope (current sight only) is stricter than legacy (120 s tile trail): the client will show less until
   P-VISION-1.

## Agents and models used in Stage 1 (recorded per the brief)
Verified once: Claude Code 2.1.318; the Agent tool exposed `model` (sonnet, opus, haiku, fable) and `effort`
(low/medium/high/xhigh/max) per invocation; no `.claude/agents` definitions were needed; no organization override was
observed. Coordinator/lead architect: this session's model (Opus 5.5 configured; serving model not independently
verified). Workers: legacy-inventory scout (sonnet, low), hosting investigator (sonnet, medium, web access), persistence
builder (sonnet, medium, isolated worktree), C# builder (sonnet, medium), backlog builder (sonnet, medium); exit-gate
reviewers (opus, high). At most two workers ran at once.
