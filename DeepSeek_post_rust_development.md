# DeepSeek post-Rust development goal

**Audience:** DeepSeek V4 Flash (and any later DeepSeek run given this file).
**Branch:** work only from `optimization_port`. Never target `main`.
**Governing packet:** [`docs/backlog/packets/P-NET-1.md`](docs/backlog/packets/P-NET-1.md). If this file and that packet ever disagree on a number or a test, **the packet wins**. Then stop and tell the coordinator.
**Date:** 2026-11-07.
**Author:** coordinator brief for the post-Rust netcode plan. This is an assignment, not a license to redesign the game.

This document tells you exactly what to implement, what “done” means, and when to stop. Do one phase per pull request. After each phase, stop and wait for coordinator review. Do not start the next phase until the owner or coordinator says that phase’s PR is accepted.

---

## 1. Read this first

You are implementing **P-NET-1 only**: client-side prediction of the *local player’s walk*, using the same A* path the server walks, plus a server-measured cap on how far an attack can rewind, plus a bandwidth measurement table.

The Rust authoritative server and the ordered WebSocket snapshot-delta protocol already exist and are frozen. The unverified straight-line / wall-slide C# predictor was removed on 2026-11-05. `LocalMotion` currently draws accepted authoritative self positions and does not walk ahead of the server. That is the correct starting point. You will add a *narrow, tested* movement exception. You will not give the client physics, combat, or AI authority.

Read, in this order, before you write code:

1. This file.
2. [`docs/backlog/packets/P-NET-1.md`](docs/backlog/packets/P-NET-1.md) (acceptance checks, write scope, traps).
3. [`AGENTS.md`](AGENTS.md) (repo-wide non-negotiables).
4. [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — C-TICK, C-NUM, C-INPUT, C-NET, C-OBS, C-PARITY, C-RNG.
5. [`docs/adr/0008-unity-client.md`](docs/adr/0008-unity-client.md) and [`docs/adr/0002-transport-and-protocol.md`](docs/adr/0002-transport-and-protocol.md) and [`docs/adr/0010-snapshot-delta.md`](docs/adr/0010-snapshot-delta.md).
6. The Rust sources named in each phase below, then the matching C# files.

Do **not** treat [`docs/PLAYER_PREDICTION.md`](docs/PLAYER_PREDICTION.md) as a build list. That file mixes shipped TypeScript-era research, owner decisions, and an ML / remote draw-ahead plan that is **out of scope**. You may append a Rust/Unity measurement section to it (Phase 0). You must not implement its Stage 2 walk-hint wire fields, Stage 3 learned gate, or any ML model.

If you are unsure about a policy, a constant, or a protocol change: **stop and report**. Do not invent a new rule.

---

## 2. Mission (one sentence)

Make walking and melee hits feel immediate on a high-ping link without giving the client authority, without changing the 20 Hz `f64` sim, and without changing the WebSocket transport.

---

## 3. Frozen contracts you must not change

These are frozen. Do not “improve” them.

| Contract | What it means for you |
|---|---|
| **C-TICK** | Fixed 20 Hz step. Sim time advances +50 ms per step. Never raise the tick rate. Never reorder the legacy tick order (inputs → abilities → target locks → weapons → movement → history → projectiles → melee (rewound) → damage). |
| **C-NUM** | `f64`, legacy operation order, no FMA, `libm` transcendentals. Do not switch the sim to fixed-point or `f32`. |
| **C-INPUT** | Latest move and latest aim win. `Aim` is free. At most 6 actions per tick. Do not add per-tick analog input frames. Prediction must not increase orders per second. |
| **C-NET** | WebSocket binary frames over TLS. Each tick a player gets Events (reliable), Fx (droppable), and Snapshot (latest-wins, with `ack_input`), each as its own frame. Snapshot deltas assume TCP ordering (no client ack of the delta base). Do not move this onto datagrams or WebTransport. |
| **C-OBS / C-RNG** | Observations never leak hidden state. Secrets never leave the server. Do not ship `rh-sim` or hidden cards / fog / private RNG to the client. |
| **C-PARITY** | Ported movement must match captured fixtures. If a test fails, fix your code, not the fixture, unless you can *prove* the fixture is wrong — then stop and report. |
| **ADR 0008** | Unity contains no game rules except this narrow local-walk prediction, mirrored from Rust, checked with Rust vectors, always corrected by the server. Predict only your own walk. Never predict attacks, HP, deaths, other players, or mobs. |
| **ADR 0010** | Deltas are encoded against the last snapshot this connection wrote. That only works because the transport is ordered. Do not put deltas on an unreliable channel. |

Also from [`AGENTS.md`](AGENTS.md):

- Every actor acts only through `validate` + `Sim::submit`.
- Wire changes that are incompatible must bump `PROTOCOL_VERSION` and regenerate `protocol/fixtures/v<PROTOCOL_VERSION>.json` for Rust, C#, and JS together. **You are not authorized to bump the protocol version in this assignment.** If you think you need a new snapshot field, stop and report.
- No ML training, models, datasets, Python bindings, or inference services.
- Only the coordinator edits shared status records (`docs/MIGRATION.md` checkpoint, `docs/CONTRACTS.md` status table) and `Cargo.lock`. Do not touch those.

---

## 4. Absolute do-not list

Do none of the following, even if a review PDF, a previous DeepSeek branch, or `docs/PLAYER_PREDICTION.md` suggests them:

1. Do not raise the tick rate to 30 Hz or 60 Hz.
2. Do not convert the sim to fixed-point math.
3. Do not introduce WebTransport, QUIC, or datagrams.
4. Do not replace goal/path movement (`Move` / `AttackMove` / `Stop`, including WASD-as-goal) with analog stick / per-tick velocity frames.
5. Do not restore the removed straight-line predictor or its fixed 50 ms latency estimate. Any latency estimate must come from the measured clock / session path.
6. Do not send client positions, hit claims, or predicted state to the server. The client sends only the orders the player gave.
7. Do not predict damage, HP, deaths, other players, mobs, immunity, Last Stand, or hiding.
8. Do not implement remote draw-ahead (that is **P-NET-2**, which has no packet file yet).
9. Do not implement a shared Rust/WASM prediction kernel. The accepted approach is a C# port checked against Rust fixtures (ADR 0008).
10. Do not edit `client-unity/UnityProject/Assets/RoguehallaNet/*.cs`. That tree is generated. Run `client-unity/sync-net.sh`, then `client-unity/sync-net.sh --check`.
11. Do not use C# `float` inside the pathfinder. Use `double` internally; convert at the edge.
12. Do not use `DateTime.Now` in `RoguehallaNet`. Time is injected. Tests drive a fake clock.
13. Do not use reflection, threads, or `unsafe` in `RoguehallaNet`. Language level is C# 9 / `netstandard2.1`.
14. Do not bump `PROTOCOL_VERSION` or regenerate protocol goldens unless the coordinator explicitly asks.
15. Do not merge other open DeepSeek gameplay stacks or fight them over protocol versions 7 / 8 / 9 / 10. Stay off those branches. Your work bases on `optimization_port` only.
16. Do not edit `Cargo.lock`, the MIGRATION checkpoint, or the CONTRACTS status table.
17. Do not change `rh-sim` except the small `note_lag` bound in Phase 3, and flag that shared-file edit in the PR description so the coordinator sees it.
18. Do not implement Wish skillshot rewind policy. Confirm current projectile / `Cast` behaviour and leave a written note; do not invent a per-ability rule.
19. Do not add delta compression unless Phase 0’s measured *typical* load exceeds 20 KB/s per client. Today’s measured snapshot path is far under that. Record “not needed” with the numbers if so.
20. Do not decide owner questions in [section 12](#12-owner-decisions-do-not-decide-these). Report them.

---

## 5. Exclusive write scope

You may create or edit **only** these paths, and only the ones the current phase names:

- `client-unity/RoguehallaNet/**`
- `client-unity/RoguehallaNet.Tests/**`
- `client-unity/sync-net.sh` outputs (by running the script, not by hand-editing generated Unity copies)
- `protocol/fixtures/` — **new files only** (for example `protocol/fixtures/pathfinding_v1.json`)
- `crates/rh-server/src/conn.rs`
- `crates/rh-server/src/room.rs`
- `crates/rh-server/src/rtt.rs` (new)
- `crates/rh-server/tests/**`
- `crates/rh-server/src/bin/netsim.rs` or an in-process lossy-link test (Phase 0 / 3, if you need it)
- `docs/PLAYER_PREDICTION.md` — **append** a Rust/Unity status section only
- `crates/rh-sim` — **only** `note_lag` bounding in Phase 3, called out in the PR

Everything else is out of scope. If a fix seems to require another file, stop and report.

---

## 6. How to work (DeepSeek V4 Flash rules)

These rules exist so a fast model does not silently redesign the game.

1. **One phase, one PR.** Title the PR `P-NET-1 Phase N: <short name>`. Base: `optimization_port`. Never `main`.
2. **Do not merge the PR yourself.**
3. **Stop at the phase’s STOP line.** Paste the validation command output in the PR body.
4. **If a test fails, fix your implementation.** Do not weaken a tolerance, delete a fixture query, or skip a command to go green.
5. **Keep diffs small and on-scope.** No drive-by refactors, no reformatting unrelated files, no extra features.
6. **Prefer existing types and names.** `LocalMotion` already exists; extend it. Do not replace the type or invent a parallel predictor.
7. **Match Rust behaviour, do not reinterpret it.** Read `crates/rh-sim/src/pathfind.rs` and `crates/rh-sim/src/systems/movement.rs` before writing C#.
8. **When two sources conflict, P-NET-1 wins**, then this file, then you stop and ask.

Suggested PR order:

| Order | Phase | Why this order |
|---|---|---|
| First | **Phase 1** — C# pathfinder parity | Mechanical port with a 300-query oracle. Best first PR. |
| Second | **Phase 2** — local walk prediction | Needs Phase 1. This is the player-facing win. |
| Third | **Phase 3** — RTT-bounded rewind | Security-sensitive. Expect extra coordinator review. |
| Anytime before P-NET-1 is closed | **Phase 0** — measure | Independent of prediction. Required before the packet is done. May be its own PR. |

Do not start Phases 4, 5, or 6.

---

## 7. Architecture you are building toward

Keep the authoritative 20 Hz `f64` Rust server (`rh-sim` + `rh-server`) and the ordered `wss://` snapshot-delta protocol.

- The client sends orders as soon as the player gives them (`Aim` is free; the 60 frames/s cap with burst 120 already leaves room). Movement is a *goal*, not a stick: `Move{x,y,seq}`, `AttackMove{x,y,seq}`, and `Stop{seq}` overwrite one slot per tick; `Aim{a}` overwrites separately; `Cast`, `Attack`, `Pickup`, and the rest go into an action buffer of at most 6 per tick.
- The client predicts **only its own walk**, by running a C# port of the server’s A* and string pulling (`PULL_WINDOW` 96, player radius 12, move mask: walls and LOW block) and walking that path at the known player speed times modifiers the client can actually see (weapon multiplier, visible slows). Unknown modifiers are left to server correction.
- Reconciliation uses the snapshot `ack` / self `move_seq`: visual error fades with tau **100 ms**; errors above **96 u** snap; an unacknowledged order is dropped after **1 s**; skip reconciliation while an order is pending (`move_seq` echo); sequence numbers are **1..255** (0 means no order yet).
- Remote players stay interpolated **70–150 ms in the past** (start at 100). The clock never runs backwards (slews at >= 80%, jumps only forward).
- Attack / release already send `t = RenderMs`. In this packet there is no draw-ahead, so keep `t = RenderMs` and add a hook `AttackTime(renderMs)` that currently returns `renderMs`. Do not send a drawn-ahead sample time.
- Server melee (and other instant, hitscan-like checks that already rewind) uses `position_at(rewind_t)`. Bound that rewind by a **server-measured** RTT: `rtt/2 + render delay allowance + one tick`, never above `MAX_REWIND_MS` (300), never below `TICK_MS` (50). A client-picked `t` inside a raw 300 ms window is the known cheat; Phase 3 closes it. Locked attacks still have no `t` (`lagMs = TICK_MS`).
- Projectiles simulate forward from the authoritative cast. Do not invent Wish rewind.

This is presentation plus a fairness clamp. Nothing the client computes is sent except the orders the player gave.

---

## 8. Phase 0 — Measure

**Goal:** answer the bandwidth / delta-compression question with numbers, and collect enough latency evidence that later transport talk is grounded.

**You may edit / create:** whatever `wirebench` already uses (run it, do not rewrite it unless a flag is missing); an extension of `wirebench` *or* a live loopback / `netsim` lossy-link test as P-NET-1 describes; `docs/PLAYER_PREDICTION.md` (append only).

### What you must do

1. Run the existing bench:

   ```bash
   cargo run --release -p rh-server --bin wirebench -- --map parity/maps/seed1.map.json --ticks 2400 --seed 1
   ```

2. Extend it, or add a loopback test with N scripted clients, so the report covers **idle**, **typical**, and **heavy** 8-player fights, split by frame class: Events / Fx / Snapshot. State the load model you used (what “typical” and “heavy” mean in that run).

3. If you can do it without leaving the write scope, also record input-to-photon latency and p95 frame jitter at 50 / 100 / 150 ms RTT with about 1% loss. If that needs new infra beyond `netsim` / an in-process lossy link, implement the minimum test P-NET-1 asked for and note what you could not measure.

4. Append a “Rust / Unity status” section to `docs/PLAYER_PREDICTION.md` with the table and this **decision rule** (do not assume the answer):

   > Add delta compression only if the measured *typical* load exceeds the legacy gate of **20 KB/s per client**, or the owner sets a lower budget. Otherwise record **“not needed”** with the numbers.

5. Do not add delta compression in this phase.

### Success criteria

- [ ] `wirebench` (or the extended bench) runs and produces bytes/player/s and encode time for an 8-player match.
- [ ] The appended table reports idle, typical, and heavy at 8 players, split by Events / Fx / Snapshot.
- [ ] The load model is written down next to the table.
- [ ] The 20 KB/s decision is recorded as either “not needed” plus numbers, or “needed” plus numbers. You did not silently start compression.
- [ ] You did not edit unrelated docs or change the protocol.

### STOP

Open the PR, paste the table and commands, and wait. Do not start compression, WebTransport, or protocol changes based on these numbers.

---

## 9. Phase 1 — C# pathfinder parity

**Goal:** `Pathfinder.cs` produces the same path the Rust server produces, query for query.

**You may edit / create:**

- `client-unity/RoguehallaNet/Net/Pathfinder.cs` (new)
- `client-unity/RoguehallaNet.Tests/PathfindingTests.cs` (new)
- `protocol/fixtures/pathfinding_v1.json` (new), produced from `parity/fixtures/pathfinding_seed1.json`
- generated sync outputs via `client-unity/sync-net.sh`

**Read first:** `crates/rh-sim/src/pathfind.rs` (exact A*, `PULL_WINDOW` 96), `crates/rh-parity/tests/parity.rs` (how Rust accepts the 300 queries), `parity/fixtures/pathfinding_seed1.json`, how the client already decodes a `MapBlob`.

### What you must do

1. Port A* and string pulling to C#. Internal math is `double`. Convert to `float` only at API edges if callers need it.
2. Decode the seed-1 map from a `MapBlob`. The client never generates maps.
3. Use player radius **12** and the same move mask as the server: walls and LOW block.
4. Build `protocol/fixtures/pathfinding_v1.json` from `parity/fixtures/pathfinding_seed1.json` so the C# tests do not have to parse the Rust parity fixture if that format is inconvenient — but the *queries and expected waypoints* must be the same 300.
5. Write `PathfindingTests.cs` that asserts every query’s waypoints match within **1e-6**, the same tolerance `rh-parity` accepts.
6. Keep the library at C# 9 / `netstandard2.1`. No reflection, threads, or `unsafe`.
7. Run `dotnet test` and `sync-net.sh` (then `--check`).

### Success criteria

- [ ] `Pathfinder.cs` exists and is used only as a library (no Unity scene logic).
- [ ] All **300** queries from `parity/fixtures/pathfinding_seed1.json` match Rust waypoints within **1e-6**.
- [ ] The pathfinder uses `double` internally.
- [ ] Maps come from a decoded `MapBlob`, not from a generator.
- [ ] `export PATH=/root/.dotnet:$PATH; dotnet test client-unity/RoguehallaNet.Tests` passes (the existing 71 tests **plus** the new ones).
- [ ] `client-unity/sync-net.sh` then `client-unity/sync-net.sh --check` are clean.
- [ ] You did not edit `Assets/RoguehallaNet/*.cs` by hand.
- [ ] You did not change Rust pathfinding to make C# match.

### STOP

Open the PR titled `P-NET-1 Phase 1: C# pathfinder parity`. Paste `dotnet test` output. Wait for review. If a small number of queries fail, include the query indices, expected vs actual waypoints, and your hypothesis — do not loosen 1e-6.

---

## 10. Phase 2 — Local walk prediction and reconciliation

**Goal:** the local player’s presented walk follows the same path the server will walk, then blends back to the authoritative self snapshot without fighting pending orders.

**Depends on:** Phase 1 merged (or stacked only if the coordinator says you may stack on your own Phase 1 branch).

**You may edit / create:**

- `client-unity/RoguehallaNet/Net/LocalMotion.cs` (extend the current stub; do not replace the type)
- `client-unity/RoguehallaNet/Net/Pathfinder.cs` (only if Phase 2 needs a small API addition)
- tests under `client-unity/RoguehallaNet.Tests/**`
- a committed JSON fixture of server positions per tick, generated from `rh_sim` for the corner-walk cases (new file under `protocol/fixtures/` or the tests folder)
- sync-net outputs via the script
- an `AttackTime(renderMs)` hook as specified below

**Current state of `LocalMotion` (do not regress this while you add prediction):** it stores the last accepted self `x,y`, tracks a pending `move_seq`, and `DrawnX/Y` equal `SimX/Y`. `VisualX/Y` currently return 0 and `Step` is a no-op. `OnSnapshot` applies the snapshot immediately, even while an order is pending. You will change presentation so `drawn = sim + visual`, but you must restore the pending-order reconciliation rule from P-NET-1 (below), which the stub currently does *not* implement (“applies … even while an order is pending”).

### What you must do

1. On `Order` / `StopOrder`, run the Phase 1 pathfinder from the current sim position to the goal (or clear the path on stop) and start walking that path in `Step`.
2. Walk using the same speed model you can know locally: base `PLAYER_SPEED` (170 u/s) times modifiers the client can see (equipped weapon multiplier, visible slows). Anything else waits for correction. Do not guess hidden roots.
3. Presentation model from P-NET-1 / legacy `localMotion.ts`:
   - `drawn = sim + visual`
   - visual error fades with tau **100 ms**
   - errors above **96 u** snap
   - an order unacknowledged after **1 s** is forgotten
   - **skip reconciliation while an order is pending**, using the `move_seq` echo on the self block
   - sequence numbers **1..255** (ignore `seq == 0` as “no order,” matching the stub)
4. Read `packages/client/src/net/localMotion.ts` for the legacy fade / speed-cap / diverge counters if you need the finer `CORRECT_SPEED_*`, `VISUAL_SNAP_DISTANCE` (144), and `DIVERGE_*` behaviour. The **gates** you must meet are the P-NET-1 numbers above. Do not copy the removed C# straight-line prototype.
5. Add `AttackTime(renderMs)` that returns `renderMs` in this packet (no draw-ahead). Assert that. Keep the function so P-NET-2 can later change it without hunting call sites. `MatchClient.cs` already sends `t = Session.Clock.RenderMs` for attack/release; do not point those calls at a drawn-ahead sample.
6. Write tests that walk around a corner and stay within a stated tolerance of a server simulation fed the same orders. Generate that server-position-per-tick fixture from `rh_sim` and commit the JSON. Divergence counters stay zero in the scripted cases.
7. Prediction must not increase orders per second (C-INPUT). Do not send extra `Move`s to “help” the predictor.
8. Do not predict attacks, HP, or deaths. Do not send positions.

### Success criteria

- [ ] `LocalMotion` walks the Phase 1 A* path rather than a straight line or the last velocity.
- [ ] Corner-walk tests match the committed Rust per-tick fixture within the stated tolerance.
- [ ] Divergence counters are zero in those scripted cases.
- [ ] Tau 100 ms, snap at 96 u, 1 s order expiry, and `move_seq` gating are implemented and tested.
- [ ] `AttackTime(renderMs)` returns `renderMs` and is tested.
- [ ] `dotnet test client-unity/RoguehallaNet.Tests` passes (71 existing + Phase 1 + Phase 2).
- [ ] `client-unity/sync-net.sh --check` is clean.
- [ ] Orders per second do not increase by construction (no extra uplink from the predictor).
- [ ] Browser proof still works after `cargo build -p rh-server`: `node tools/browser-proof/proof.mjs`.

### STOP

Open `P-NET-1 Phase 2: local walk prediction`. Paste test output and the fixture path. Wait. A browser feel-check is welcome in the PR notes; it does not replace the fixture tests.

---

## 11. Phase 3 — RTT-bounded rewind

**Goal:** close the cheat where a client picks the most favorable `t` inside a raw 300 ms window, without making honest 150 ms RTT melee miss.

**Depends on:** coordinator review of the planned clamp (paste the formula you will implement in the PR if you deviate one line from the text below). This phase is security- and fairness-sensitive.

**You may edit / create:**

- `crates/rh-server/src/rtt.rs` (new) — per-connection smoothed RTT from existing Ping/Pong
- `crates/rh-server/src/conn.rs`, `crates/rh-server/src/room.rs` — wire the estimate through
- `note_lag` bounding in `crates/rh-sim` (small; flag it)
- `crates/rh-server/tests/**` — unit tests for clamp / floor / ceiling, plus the 150 ms and forged-`t` integration tests
- optionally `crates/rh-server/src/bin/netsim.rs` or an in-process lossy link if the integration test needs it

**Read first:** `crates/rh-sim/src/systems/weapons.rs` (`note_lag`), `crates/rh-sim/src/systems/melee.rs` (`position_at(rewind_t)`), `crates/rh-server/src/{conn.rs,room.rs,wire.rs}` (Ping/Pong, snapshots with `ack_input`).

**Current rewind (what you are tightening, not deleting):** `lag = server_time - t`; no `t` means `TICK_MS`; clamp is `[TICK_MS, MAX_REWIND_MS]`; rewind time is `now - min(300, max(50, lag_ms))`. Locked attacks have no `t` (`lagMs = TICK_MS`) — that rule stays.

### What you must do

1. Estimate RTT on the server from the existing Ping/Pong path. Smooth it. Give it a floor so a single lucky sample cannot collapse the window to nothing.
2. Bound allowed lag by:

   `allowed = clamp(smoothed_rtt_ms / 2 + RENDER_DELAY_ALLOWANCE_MS + TICK_MS, TICK_MS, MAX_REWIND_MS)`

   - `TICK_MS` is 50. `MAX_REWIND_MS` is 300.
   - Define `RENDER_DELAY_ALLOWANCE_MS` as a named constant defaulting to **100** (the client’s starting remote interpolation delay). State that choice in the PR. Do not invent a different fairness policy (no extra shrinking for high-ping players, no raising 300).
3. A `t` in the future, or older than this bound, is **clamped** (not rejected) and **counted** (for later P-OPS-2). Honest play at 150 ms RTT must still land hits on a moving target at the chosen bound.
4. Keep locked-attack behaviour: no `t` means `lagMs = TICK_MS`.
5. Do not change how projectiles simulate (forward). Do not add Wish-specific rewind.
6. Parity and replay must stay unchanged for cases that do not depend on a forged `t`.

### Success criteria

- [ ] `rtt.rs` exists and each connection has a smoothed, floored RTT estimate from server-measured Ping/Pong (not from the client’s claimed `t`).
- [ ] Unit tests cover clamp by RTT, floor, and ceiling.
- [ ] Integration test: simulated **150 ms RTT** — hits on a moving target still register at the chosen bound.
- [ ] Integration test: forged `t = now - 300` at **20 ms RTT** is clamped (and counted).
- [ ] Locked attacks with no `t` still use `TICK_MS`.
- [ ] `MAX_REWIND_MS` is still 300; `TICK_MS` is still 50.
- [ ] `cargo test -p rh-server` passes.
- [ ] `cargo test -p rh-protocol` passes.
- [ ] `cargo test --workspace` passes (use `eval "$(tools/pgtest/start.sh)"` if Postgres tests require it).
- [ ] You flagged the `note_lag` / `rh-sim` touch in the PR description.
- [ ] You did not bump `PROTOCOL_VERSION`.

### STOP

Open `P-NET-1 Phase 3: RTT-bounded rewind`. Paste the formula as implemented, the allowance constant, clamp-count behaviour, and test output. Wait for coordinator review before any follow-up.

---

## 12. Owner decisions (do not decide these)

Stop and report if your work seems to require an answer to any of the following:

1. Unfreeze C-TICK to 30 or 60 Hz.
2. Change rewind fairness further (favor the attacker more/less, lower the 300 ms cap, shrink the window for high-ping players).
3. Whether Wish skillshots should rewind like melee or keep simulating forward like projectiles. Default while waiting: **do not change them**.
4. Whether WASD should become direct velocity instead of a pathfinder goal.
5. Whether a shared Rust/WASM movement core should replace the C# port (that would amend ADR 0008).
6. Adopting WebTransport or dropping older Safari.
7. Whether this work jumps ahead of other unmerged gameplay stacks, and who may bump protocol versions.
8. Remote draw-ahead (P-NET-2) and whether melee `t` stays the non-draw-ahead render time (already decided “yes, `t` stays render time” in `docs/PLAYER_PREDICTION.md` decision 5 — do not reopen it).

---

## 13. Later phases — do not start

### Phase 4 — Input responsiveness (owner must say go)

Send sampled inputs as soon as they happen, within the existing 60 frames/s cap (burst 120). Local windup / audio for casts is already in scope for presentation; hits still come from the server. Write down current Wish `t` handling; do not change it. Exit would be median input-to-intent-visible latency under one frame, without raising orders above C-INPUT.

### Phase 5 — P-NET-2 remote draw-ahead (no packet file yet)

Legacy “draw remote fighters ahead,” with `AttackTime` returning the *non*-draw-ahead render time. Do not build this until P-NET-1 Phases 0–3 are done and a P-NET-2 packet exists.

### Phase 6 — Transport (owner only)

WebTransport is not in scope. If Phase 0 later shows head-of-line stalls under loss as a real problem, the coordinator will write an ADR. Events and deltas would stay on reliable streams. WSS remains the fallback.

---

## 14. Validation commands (copy into the PR)

Use the ones that apply to the phase. Do not skip a failing command.

```bash
export PATH=/root/.dotnet:$PATH
dotnet test client-unity/RoguehallaNet.Tests
client-unity/sync-net.sh
client-unity/sync-net.sh --check

cargo test -p rh-server
cargo test -p rh-protocol
cargo test --workspace
cargo run --release -p rh-server --bin wirebench -- --map parity/maps/seed1.map.json --ticks 2400 --seed 1

cargo build -p rh-server
node tools/browser-proof/proof.mjs
```

Headless probe against a local server (content hash `0` is **not** a wildcard; the server refuses a mismatched hash):

```bash
cargo run -p rh-server -- --bind 127.0.0.1:7777
# in another shell, after /info is up:
dotnet run --project client-unity/RoguehallaNet.Probe -- \
  --url ws://127.0.0.1:7777/ws \
  --profile probe1 \
  --token t1 \
  --seconds 10 \
  --content-hash "$(curl -s http://127.0.0.1:7777/info | python3 -c "import json,sys; print(int(json.load(sys.stdin)['contentHash'],16))")"
```

---

## 15. What “P-NET-1 done” means

All four packet acceptance checks are green:

1. Pathfinder reproduces all 300 seed-1 queries within 1e-6.
2. `LocalMotion` uses it; corner tests match a committed Rust per-tick fixture; divergence counters are zero in scripted cases.
3. RTT-bounded rewind unit tests plus the 150 ms hit test and the forged `t = now - 300` at 20 ms RTT test.
4. Bandwidth table written; delta compression added only if typical load > 20 KB/s per client, otherwise “not needed” with numbers.

Plus: `dotnet test client-unity/RoguehallaNet.Tests` passes (71 existing + new); `sync-net.sh --check` is clean; protocol golden vectors are byte-identical because you did not bump the version.

---

## 16. Coordinator review (what another reviewer will check)

Expect every PR to be reviewed against this list. Failures here are more important than style:

- Did you stay inside the exclusive write scope?
- Did you change C-TICK, C-NUM, C-INPUT, C-NET, or bump `PROTOCOL_VERSION`?
- Did you send positions or predict combat outcomes?
- Did you restore straight-line prediction or a fixed 50 ms latency guess?
- For Phase 1: is the pathfinder `double`, and do all 300 queries pass at 1e-6 without edited fixtures?
- For Phase 2: is reconciliation skipped while `move_seq` is pending? Does `AttackTime` return `renderMs`?
- For Phase 3: is RTT server-measured? Is a forged old `t` at low RTT clamped and counted? Do honest 150 ms hits still land?
- Did workspace tests and `sync-net.sh --check` actually run?

---

## 17. References

- [`docs/backlog/packets/P-NET-1.md`](docs/backlog/packets/P-NET-1.md)
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md)
- [`docs/adr/0002-transport-and-protocol.md`](docs/adr/0002-transport-and-protocol.md)
- [`docs/adr/0008-unity-client.md`](docs/adr/0008-unity-client.md)
- [`docs/adr/0010-snapshot-delta.md`](docs/adr/0010-snapshot-delta.md)
- [`crates/rh-sim/src/pathfind.rs`](crates/rh-sim/src/pathfind.rs)
- [`crates/rh-sim/src/input.rs`](crates/rh-sim/src/input.rs)
- [`crates/rh-sim/src/systems/movement.rs`](crates/rh-sim/src/systems/movement.rs)
- [`crates/rh-sim/src/systems/weapons.rs`](crates/rh-sim/src/systems/weapons.rs)
- [`crates/rh-sim/src/systems/melee.rs`](crates/rh-sim/src/systems/melee.rs)
- [`client-unity/RoguehallaNet/Net/LocalMotion.cs`](client-unity/RoguehallaNet/Net/LocalMotion.cs)
- [`parity/fixtures/pathfinding_seed1.json`](parity/fixtures/pathfinding_seed1.json)
