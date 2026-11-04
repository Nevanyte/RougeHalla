# P-NET-1: client prediction parity and the rewind bound

## ID and outcome
P-NET-1. The C# client predicts the local walk with the same A* path the server walks (so corners no longer diverge), sends
attack render times that the server can trust, the server bounds a client's rewind by its measured RTT, and the
bandwidth/delta-compression question is answered by measurement. Remote draw-ahead is not in this packet (P-NET-2).

## Dependencies
None. The Unity project is not compiled yet (P-UNITY-1), so all C# work lands in the engine-independent library
`client-unity/RoguehallaNet` and is tested with `dotnet test`. Server-side work is in `rh-server`/`rh-sim`.

## Relevant legacy paths (verified)
- Legacy client prediction: `packages/client/src/net/localMotion.ts` (the model: order -> same shared A* path, `drawn = sim + visual`, reconcile against `S(T)` at the measured order delay, `VISUAL_TAU_MS`, correction speed caps `CORRECT_SPEED_*`, `SNAP_DISTANCE` 96, `VISUAL_SNAP_DISTANCE` 144, `DIVERGE_*`, `ORDER_EXPIRE_MS`), `localPrediction.ts`, `remoteDraw.ts`, `confirmedDamage.ts`, `uplinkPace.ts`, `tickPhase.ts`; `packages/shared/src/interp.ts` (`SnapshotBuffer`, `ServerClock`, `RenderClock`), `packages/shared/src/pathfind.ts` (the A*), `walk.ts` (ice).
- Docs: `docs/PLAYER_PREDICTION.md` (what is legitimate to predict, the measured stages, owner decisions), docs/legacy/CLAUDE_LEGACY.md "Clients render in the past", "Combat netcode" and "Uplink pacing" (partly stale for the Rust stack: legacy is Colyseus).
- Benches for method: `packages/server/bench/netProbe.ts`, `netProbeMatrix.ts`, `netTraceEval.ts`, `bandwidth.ts` (legacy gate < 20 KB/s per client).
- Rust server side: `crates/rh-sim/src/pathfind.rs` (exact A* port, `PULL_WINDOW` 96), `sim.rs` (`note_lag` l.818: `lag = server_time - t`, clamped to `[TICK_MS, MAX_REWIND_MS]`; no `t` means `TICK_MS`; rewind uses `now - min(300, max(50, lag_ms))`), `crates/rh-server/src/{conn.rs,room.rs,wire.rs}` (frames, Ping/Pong, snapshots with `ack_input`).
- C# side: `client-unity/RoguehallaNet/Net/{LocalMotion,RenderClock,SnapshotBuffer,ClockSync,InputSender,Session}.cs`, `Protocol/*`; `UnityProject/Assets/Scripts/Net/MatchClient.cs` l.55-72 (already sends `t = Session.Clock.RenderMs` with attack/release).

## New paths
`client-unity/RoguehallaNet/Net/Pathfinder.cs` (+ `Pathfinding` tests), `client-unity/RoguehallaNet.Tests/PathfindingTests.cs` using a new golden file `protocol/fixtures/pathfinding_v1.json` produced from `parity/fixtures/pathfinding_seed1.json`; server: `crates/rh-server/src/rtt.rs` (per-connection RTT estimate), a bench bin `crates/rh-server/src/bin/netsim.rs` or a test with an in-process lossy link (to be created by this packet).

## Exclusive write scope
`client-unity/RoguehallaNet/**`, `client-unity/RoguehallaNet.Tests/**`, `client-unity/sync-net.sh` outputs (run it), `protocol/fixtures/` (new files only), `crates/rh-server/src/{conn.rs,room.rs,rtt.rs}`, `crates/rh-server/tests/`, `docs/PLAYER_PREDICTION.md` (append a Rust/Unity status section). `rh-sim` changes only to `note_lag` bounding (small, flag it to the coordinator: shared file).

## Contracts and references
C-NET (protocol v1; any new field is a version bump with golden vectors on both sides), C-PARITY (the C# A* must match `findPath` outputs: the pathfinding fixture has 300 queries), C-INPUT (no extra orders per second from prediction), ADR 0008 (prediction scope: only the local walk; never attacks, damage, deaths or other players).

## Behaviour to preserve
- Server authority: the client sends inputs only; prediction is presentation; nothing it computes is sent except orders the player gave.
- The model walks the same path the server will (A* with string pulling, `PULL_WINDOW` 96, player radius 12, move mask: walls and LOW block); the visual offset decays with tau 100 ms; errors above 96 u snap; an order unacknowledged after 1 s is forgotten; reconciliation is skipped while an order is pending (`move_seq` echo); order sequences are 1..255 (0 before any order).
- Render time: remote actors 70-150 ms in the past (start 100), never runs backwards (slews at >= 80%, jumps only forward), stalls (>= 1 s gap) and steps are told from jitter. The legacy draw-ahead's rule (owner decision 5 in PLAYER_PREDICTION): when drawing ahead, the attack `t` is the render time the setting off would have, not the drawn-ahead sample time. In this packet there is no draw-ahead, so `t = RenderMs`; assert that and keep the hook (a function `AttackTime(renderMs)`).
- Server rewind: legacy trusts `t` anywhere inside `[now - MAX_REWIND_MS, last published tick]` (300 ms): a cheater can pick the best `t` in that window (Known TODO). Mitigation to implement: bound `lag` by `rtt/2 + render delay allowance + one tick` using a server-measured RTT (smoothed, with a floor), never above `MAX_REWIND_MS`, never below `TICK_MS`; a `t` in the future or before the bound is clamped (and counted for P-OPS-2). Legacy fact: 300 ms covers render delay + RTT + one tick for RTT up to about 180 ms at the usual delay; beyond that swings at moving targets start to miss.
- Locked attacks have no `t` (`lagMs = TICK_MS`); that rule stays with P-COMBAT-3.

## Acceptance checks
1. `Pathfinder.cs` reproduces all 300 queries of `parity/fixtures/pathfinding_seed1.json` (same waypoints within 1e-6 as the Rust `rh-parity` test accepts, see `crates/rh-parity/tests/parity.rs`); runs on the seed-1 map decoded from a `MapBlob` (the client never generates maps).
2. `LocalMotion` uses it: new tests walk around a corner and stay within a stated tolerance of a server simulation fed the same orders (use `rh_sim` through a small generated fixture of server positions per tick, committed JSON); divergence counters stay zero in the scripted cases.
3. RTT-bounded rewind: unit tests in `rh-server` (clamp by RTT, floor, ceiling); an integration test with a simulated 150 ms RTT proves hits on a moving target still register at the chosen bound and a forged `t = now - 300` at 20 ms RTT is clamped.
4. Bandwidth measurement: start from the existing `cargo run --release -p rh-server --bin wirebench -- --map parity/maps/seed1.map.json --ticks 2400 --seed 1` (bytes per player per second and encode time on a headless 8-bot match) and extend it (or add a live loopback test with N scripted clients) to report idle, typical and heavy fights at 8 players, split by frame class (events/fx/snapshot). Write the table to `docs/PLAYER_PREDICTION.md` or the packet hand-off. **Decision rule** (record it, do not assume): add delta compression only if the measured typical load exceeds the legacy gate (20 KB/s per client) or the owner sets a lower budget; otherwise record "not needed" with the numbers. The slice sends full observations; heavier mechanics will change the answer, so state the load model used.
5. `dotnet test client-unity/RoguehallaNet.Tests` passes (71 existing + new); `client-unity/sync-net.sh --check` clean; protocol golden vectors byte-identical unless a version bump is made on both sides.

## Validation commands
`export PATH=/root/.dotnet:$PATH; dotnet test client-unity/RoguehallaNet.Tests`; `client-unity/sync-net.sh` then `client-unity/sync-net.sh --check`;
`cargo test -p rh-server`, `cargo test -p rh-protocol`, `cargo test --workspace`, `cargo run --release -p rh-server --bin wirebench`; `node tools/browser-proof/proof.mjs` (after `cargo build -p rh-server`);
`dotnet run --project client-unity/RoguehallaNet.Probe -- --url ws://127.0.0.1:7777/ws --profile probe1 --token t1 --seconds 10` against `cargo run -p rh-server -- --bind 127.0.0.1:7777`.

## Risk and suggested model tier
Medium: algorithmic port with an exact oracle (the fixture) plus a security-relevant clamp. Strong builder; strongest model for the
rewind bound design (it trades fairness against cheating and must be justified with measurements).

## Known traps
- C# `float` vs the server's `f64`: the legacy client used doubles; prediction tolerates drift, but the A* fixture check needs `double` internally (use `double` in the pathfinder, convert at the edge).
- Language level is C# 9 / netstandard2.1, no reflection, no threads, no `unsafe` in the library.
- The Unity copy of the library is generated: never edit `Assets/RoguehallaNet/*.cs`; the test fails if stale.
- The `LatencyMs` estimate in `LocalMotion` is not yet fed from `ClockSync` (README): wire it, or the comparison uses a fixed 50 ms.
- Do not predict attacks, hp or deaths (ADR 0008). Do not send positions.
- Time sources: no `DateTime.Now` in the library; time is injected (tests drive a fake clock).
