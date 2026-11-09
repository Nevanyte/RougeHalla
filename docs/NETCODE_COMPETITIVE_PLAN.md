# Competitive netcode plan (input -> client -> server -> sim -> opponent)

Source: a read-only sweep of the built pipeline on `optimization_port` at `76d170a1` (eight reviewers, 2026-11-09).
Serves ORDER_OF_OPERATIONS polish of the network path. Nothing here changes the 20 Hz step, the tick order, the
`validate` + `Sim::submit` rule or the wire unless a row says so. Figures marked *inferred* come from reading code, not
from a measurement.

## What the pipeline does today

| Stage | Behaviour | Added latency |
|---|---|---|
| Input capture | Polled once per Unity frame in `MatchClient.Update`; sampled, encoded and sent in the same frame | 0 to 1 frame (mean 8 ms at 60 Hz) |
| Uplink | One TCP WebSocket, no batching window, no resend (reliable stream) | network only |
| Server intake | Frame decoded on the connection task, queued to the room task, applied at the next 20 Hz step | 0 to 50 ms, mean 25 ms |
| Sim | Pure Rust, fixed step; all rules, combat, AI and pathing | well under 1 ms per step |
| Fan-out | Per-observer observation and delta encoded on the room task, one batch per tick | under 1 ms *(inferred)* |
| Opponent render | Interpolated 70 to 150 ms behind the newest snapshot (adaptive) | 70 to 150 ms |
| Own movement | Predicted locally in C# (mirror of Rust, checked against Rust vectors), server-corrected | 0 |
| Own attack / cast | Waits for the server's Fx | RTT plus 0 to 50 ms |

The Rust/Unity split is sound: the client audit found no damage, hit, cooldown, vision or AI rule computed in Unity. The
only client-side gameplay code is the sanctioned movement prediction and its pathfinder.

## Wave 1: no owner decision needed (implemented on `claude/peaceful-babbage-rtsgq6`)

| # | Change | Why | Where |
|---|---|---|---|
| 1 | Rewind window counts the honest render lag (RTT/2 plus tick phase), with per-seat clamp diagnostics | Honest players at 60 ms RTT and above are under-rewound by up to 75 ms, about 13 u of target position | `rh-server` `rtt.rs`, rewind |
| 2 | Server latency budget metrics: input age at step, tick deadline to socket flush | Turns the estimates above into measured p50/p99 so later work is judged on data | `rh-server` `room.rs`, `conn.rs`, `metrics.rs` |
| 3 | Prediction keeps its lead: delay-aligned reconciliation, bounded correction speed, reconcile not starved while a key is held | Removes rubber-banding on the first echo and drift on long WASD holds above about 100 ms ping | `RoguehallaNet` `LocalMotion.cs`, `Session.cs` |
| 4 | Prediction uses the speed multiplier the server already sends | Steady drift with any move-speed card or boost | `LocalMotion.cs` |
| 5 | Render clock recovers faster after a jitter spike | Time at elevated delay drops from about 12 s to 4 to 6 s | `RenderClock.cs` |
| 6 | Input path: aim sent on change only, no per-frame allocations | Fewer sends and less WebGL garbage (GC pauses delay input sampling) | `InputSender.cs` |
| 7 | Target picker hit-tests the positions drawn on screen, not the newest snapshot | A click on a moving enemy can miss by 22 to 47 px today; worst for high ping | `MatchClient.cs` |
| 8 | Release/Stop flushed immediately on focus loss | A backgrounded tab can leave the attack held for minutes | `MatchClient.cs` |
| 9 | Remote Fx scheduled on the render clock | Hit flashes lead the drawn pose by 70 to 150 ms today | `ArenaView.cs` |
| 10 | Staging egress shaper no longer queues game frames behind page loads | Up to 1.5 s snapshot stall when another visitor loads the page | `hosting/staging-mvp` |

Items 7 to 9 edit Unity scene scripts, which cannot be compiled outside the Unity editor; they need an editor build
before merge.

As built, and what to confirm:

- Item 1 widens the accepted rewind window to `srtt + 150 + 50 + 20` ms, still capped at `MAX_REWIND_MS` (300). From
  about 80 ms RTT every client gets the full cap, and a client with no RTT sample yet gets 300 ms (was 200). The cap was
  already reachable by delaying pongs, so nothing new is exploitable, but this is a fairness policy change for the owner
  to confirm.
- Item 4 mirrors `speed_milli` and is checked against a C# server model only. A Rust-generated vector for a buffed walk
  should follow (C-PARITY), and `docs/PLAYER_PREDICTION.md` / P-NET-1 still describe the old reconcile rule.
- Item 5 measured: recovery after a spike 6440 ms to 3232 ms on a synthetic trace. The 4 s jitter window is unchanged.
- Item 6 re-sends an unchanged aim every 100 ms, because the server drops aim while stunned or target-locked.
- Item 10 replaces the 1 s FIFO with a 50 ms token bucket plus `fq_codel`; the `tc` commands were not run on a host.
- No number in this wave was measured on a real link. Item 2's metrics are the way to get them.

## Wave 2: needs an owner decision first

| Change | Gain | Decision needed |
|---|---|---|
| Cosmetic own-attack feedback at the click (swing clip, bow draw, Wish telegraph) | Own action shows at the click instead of after RTT plus up to 50 ms; the largest felt-latency win found | ADR 0008 and P-NET-1 say "do not predict attacks"; this is animation only, with no outcome predicted |
| Bounded draw-ahead for remote players | About 40 to 50 ms less display latency for opponent movement | Soft conflict with "Unity holds no game rules"; presentation-only extrapolation |
| Melee rewinds the attacker's own origin, but the attacker aims from the predicted position | Removes up to 17 to 50 u of self-position error on chase swings | Legacy parity of melee resolution |
| Projectiles and abilities have no lag compensation | Ranged players at 100 ms RTT must lead by about 34 u while melee need not | Legacy parity; fairness policy |
| RTT estimator rises slowly and rewind is capped by policy | Makes pong-delay abuse slower and bounded | Fairness policy (also slows adaptation for honest players whose link degrades) |
| Order budget can drop a Release or Attack during sustained steering plus clicking | No silent loss of combat input when kiting | `rh-sim` intake change; replay determinism of old recordings |
| Placement score fairness terms | Smaller worst pairwise RTT gap in a room | Placement policy |

## Wave 3: protocol bump (batch into one version)

| Change | Gain |
|---|---|
| Publish ranged windups to opponents | A 450 to 500 ms telegraph opponents do not get today |
| Projectile identity and deterministic motion | About 90% fewer projectile bytes; smooth arrows at frame rate |
| Delta-coded remote positions, 8-bit facing | About 37% of per-actor snapshot bytes |
| Client send-time stamp on movement orders | Sub-tick ordering fairness, up to 50 ms of order timing |
| Trim per-tick head and self-block redundancy | 3 to 8 bytes per tick |

## Wave 4: infrastructure and measurement

| Change | Gain |
|---|---|
| Wire the regional latency probe into the client and account API | Placement currently falls back to configured region order ("no latency data") |
| Latency rig with packet loss, tails and WAN profiles | Shows what 0.5 to 5% loss does to p99 before any transport decision |
| `TCP_NOTSENT_LOWAT` on game sockets | Keeps stale snapshots out of the kernel buffer after a link stall (needs a new dependency) |
| Optional WebTransport datagram lane | Tail latency under loss only; gate on the rig's numbers |

## Considered and deferred

Running prediction as Rust compiled to WASM instead of the C# mirror is feasible but not worth it now. Drift is already
held by tests (300 path queries at 1e-6, 723 walk ticks at 0.01 u), and it would need a crate extraction from `rh-sim`
plus a second WASM module beside Unity's. Revisit when prediction grows beyond walking (ice, knockback).
