# Competitive netcode plan (input -> client -> server -> sim -> opponent)

Root integration update2026-11-10: the owner explicitly authorizes the competitive-speed tradeoffs. Wave1 plus the
reviewed stale prediction-echo repair is composed at `fe0e2983`:956 managed tests,102 affected Rust tests, format and
strict server lint pass; actual Unity Client/Net compilation passes. The two retained stale-echo failures demonstrate
why new alignment state needs sent-frame proof as well as the reusable movement byte. The current running demo remains
the frozen pre-Wave1 artifact for a baseline. New builds and real-link measurements are next; the numbers below retain
their original inferred/synthetic scope. Later waves remain proposals, not already implemented features.

The hosting change uses TBF plus fq_codel. Its50ms TBF parameter is not a hard queue-delay bound after replacing the
inner FIFO; actual host queue behavior and concurrent download/game latency remain unmeasured.

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

## Wave 2: owner-approved 2026-11-09 (decisions in [ADR 0024](adr/0024-competitive-netcode-presentation-and-lag-fairness.md), Proposed)

Status key: **built** = in the tree with tests; **partly built** = some of the row; **deferred** = nothing built. "Built" never
means measured: see the unverified list below.

| Change | Status | What the code does |
|---|---|---|
| Cosmetic own-attack feedback at the click (swing clip, bow draw, Wish telegraph) | built | `OwnAttackCue` starts the owner's attack clip on a press that server-sent readiness says will act at once, cuts it if server state rules the action out or no confirmation arrives within RTT + 100 ms (500 ms cap), and absorbs the first server Swing so the clip is not replayed. `MatchClient.StartOwnWishTelegraph` shows a provisional Wish telegraph until the server's cue replaces it; the melee swing sound moves to the click. Bow and wand get no sound early. Switches `OwnAttackFeedback`, `OwnWishTelegraph`. 13 C# tests cover the cue; the scene wiring and the telegraph have none. |
| Bounded draw-ahead for remote players | built | `RemoteDraw` samples players 50 ms later than the render clock and extrapolates at most 50 ms and 10 u past the newest snapshot, only for a steadily walking live player, through a speed-capped follower; switch `MatchClient.DrawAhead`. Attack, Release and Cast carry `Session.AttackRenderMs` (render time plus the lead, never past the newest snapshot). Not done: wall clipping, any lead for mobs or NPCs, facing extrapolation. 11 C# tests. |
| Melee rewinds the attacker's own origin, but the attacker aims from the predicted position | built | DEV-009: with `lag_fairness` a swing starts at the attacker's tick-start position; targets are still rewound. `lag_fairness.rs`. |
| Projectiles and abilities have no lag compensation | built | DEV-010: a player's shot launches `lag - TICK_MS` back (at most 250 ms) and is flown to the clock at once. DEV-011: a unit-target Wish judges range and line of sight against the rewound target. Both are the identity at the one-tick baseline lag. A catching-up shot meets no other flight. |
| RTT estimator rises slowly and rewind is capped by policy | deferred | Only the Wave 1 window and `MAX_REWIND_MS` (300 ms) apply. The estimator was not changed; `rtt.rs` gained only the clamp of the `MoveAt` stamp. |
| Order budget can drop a Release or Attack during sustained steering plus clicking | deferred | No `rh-sim` intake change. |
| Placement score fairness terms | deferred | No placement change. |

All four built server rows sit behind `SimConfig::lag_fairness`: off in `SimConfig::default`, parity, headless, recordings and
tests; on in the live `rh-server` runtime profiles (`Settings::sim()`). Off, the config hashes as before the field existed, so no
tape was re-recorded. The deviations are recorded as DEV-009 to DEV-012 in [DEVIATIONS.md](DEVIATIONS.md), still `pending`.

## Wave 3: protocol 15 (one bump; owner-approved)

| Change | Status | What the code does |
|---|---|---|
| Publish ranged windups to opponents | built | Snapshot and delta actors carry a bow-draw or wand-cast windup (kind, start, duration, and the aim for a cast only) for actors the viewer sees. Melee swings are not published. `ArenaView.PresentWindup` starts the existing clip when the drawn timeline enters the windup and cuts it on a server cancel. |
| Projectile identity and deterministic motion | built | State key 7 rows carry a per-viewer track alias and a straight-line anchor (tick, position, facing, speed). The server re-sends a row only on a sighting, an end, a loss of sight or a re-anchor beyond 0.5 u; rows with an NPC owner still change every tick. `ArenaView` draws each flight every frame with `NetProjectileView.At`. The projectile byte saving was not measured. |
| Delta-coded remote positions, 8-bit facing | built | A changed actor's x and y go as one signed byte each when both fit, else absolute (`AD_STEP`); remote facing in deltas is 1 byte (Full snapshots keep a u16 that the encoder writes as a multiple of 256). Measured with `wirebench` (debug build, 8 bots, payload bytes only): typical 300 to 287 B/s, heavy scrum 619 to 542 B/s. The 37% estimate for a moving crowd was not measured (`--synthetic` was not run). |
| Client send-time stamp on movement orders | partly built | `MoveAt` and `AttackMoveAt` (commands 19 and 20) carry the click time without the render delay; DEV-012 gives an idle walker up to one tick of credit. A moving walker, a direction change and Stop earn nothing. The C# sender stamps both orders once the first pong exists; the JS probe's helper still sends plain Move. |
| Trim per-tick head and self-block redundancy | deferred | All four trims were judged not simple and lossless (tick and ack_input need the base to decode, ready_in_ms and the self facing echo risk display and reconcile errors). |

Rust, C# (1004 tests at the last run) and the JS decoder (`probe.html`, `tools/protocol-js`) were all run against `v15.json`
including malformed frames and delta chains. The earlier Rust-only checkpoint left clients unable to connect at 15; that is closed
on the decoder side.

### What is unverified

- The Unity scene scripts (`MatchClient`, `ArenaView`, `ConfirmedWishPresenter`, `ShowcaseSoundscape`, `SpriteActorPresenter`) were
  edited without a Unity editor and have not been compiled. The C# library under `RoguehallaNet` builds and its tests pass.
- Nothing was measured on a real link. No input-to-photon, perceived-latency, hit-rate or real-network bandwidth number exists for
  any row; the only byte figures are the `wirebench` runs named above. The `tools/latency` end-to-end run with the new
  `attackClipStart` mark and the browser proof against protocol 15 were not run.
- Balance. DEV-009 to DEV-012 were not run through a balance harness, and a lagged player's arrows now reach farther back than
  before.
- Visual quality of the draw-ahead blend-back, the provisional clip cut (there is no cross-fade), the Wish telegraph and the
  windup and projectile drawing was judged from test bounds only, not by eye.
- Whether opponents seeing a wand cast's start aim and a draw's release time is acceptable public information. It matches legacy.
- Open edge cases noted by the packets: a rare double swing when an older Swing Fx is still in flight as a new press starts a
  clip; a long bow windup can outlast its click-time clip; `OwnAttackCue.Update` checks for confirmation before it checks death,
  stun and weapon change; the draw-ahead's walk cache is keyed by timestamp and cleared on Welcome, not on every source-clock cut.

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
