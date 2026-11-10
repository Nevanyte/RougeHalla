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
| Bounded draw-ahead for remote players | built | `RemoteDraw` samples players 50 ms later than the render clock and extrapolates at most 50 ms and 10 u past the newest snapshot, only for a steadily walking live player, through a speed-capped follower; switch `MatchClient.DrawAhead`. Attack, Release and Cast carry `Session.AttackRenderMs`, the time remote players are drawn at (aiming policy below). The follower never trails its target by more than 20 u. Not done: wall clipping, any lead for mobs or NPCs, facing extrapolation. |
| Melee rewinds the attacker's own origin, but the attacker aims from the predicted position | built | DEV-009: with `lag_fairness` a swing starts at the attacker's tick-start position; targets are still rewound. `lag_fairness.rs`. |
| Projectiles and abilities have no lag compensation | built | DEV-010: a player's shot launches `lag - TICK_MS` back (at most 250 ms) and is flown to the clock at once. DEV-011: a unit-target Wish judges range and line of sight against the rewound target. Both are the identity at the one-tick baseline lag. A catching-up shot meets the flights still live at the clock (see "What a catching-up projectile meets"). |
| RTT estimator rises slowly and rewind is capped by policy | deferred | Only the Wave 1 window and `MAX_REWIND_MS` (300 ms) apply. The estimator was not changed; `rtt.rs` gained only the clamp of the `MoveAt` stamp. |
| Order budget can drop a Release or Attack during sustained steering plus clicking | deferred | No `rh-sim` intake change. |
| Placement score fairness terms | deferred | No placement change. |

All four built server rows sit behind `SimConfig::lag_fairness`: off in `SimConfig::default`, parity, headless, recordings and
tests; on in the live `rh-server` runtime profiles (`Settings::sim()`, `runtime.rs`). Off, the config hashes as before the field
existed, so no tape was re-recorded. The deviations are recorded as DEV-009 to DEV-012 in [DEVIATIONS.md](DEVIATIONS.md), still `pending`.

**Activation of `lag_fairness`.** The owner approved turning it on on 2026-11-09 and again in the handoff. It is ON in the live
`rh-server` runtime profiles and OFF in `SimConfig::default`, parity, headless, recordings and tests. Turning it off is one line
(`lag_fairness: true` in `Settings::sim`). Root owns the final activation at integration. [ADR 0024](adr/0024-competitive-netcode-presentation-and-lag-fairness.md)
stays Proposed until the owner accepts it.

### Aiming policy (handoff finding 3)

`RemoteDraw.AttackTime` stamps the time remote players are drawn at: render + 50 ms inside the snapshot buffer, and past the newest
snapshot `newest + min(render + 50 - newest, 50)`; with too few samples to extrapolate, the newest snapshot. Newest 1000 / render 980
now draws and stamps 1030 (before: drew 1030, stamped 1000, so a steady walker was judged 5.1 u behind the drawn figure). The stamp is
never later than newest + 50 ms, so the server's future clamp does not move it. The design does not claim exact pose equality. Stated
residual, pinned as constants in `RemoteDrawAimTests`: time between drawn and judged pose at most 50 ms (`AimTimeErrorBoundMs`); target
pose against judged pose at most `AimTargetErrorBound(v)` = min(10, 0.05 v) + 0.05 v, which is 17 u at walk speed (0 inside the buffer
and for a steady straight walker, at most 8.5 u for a held player); the drawn figure trails its target by at most `MaxFollowLag` = 20 u,
so drawn figure against judged pose is at most 37 u at walk speed. Mobs and NPCs are not drawn ahead but are judged up to one lead (50
ms) after their drawn pose. On a near-zero link the sim's one-tick lag floor moves the judged time back to the newest snapshot (5.1 u in
the 1000/980 case). The replay numbers are synthetic traces, not a real link; they are in the evidence file. Windups and projectiles
stay on the capped timeline (`Session.DrawTimelineMs`, render + 50 ms, never past the newest snapshot), so no flight is extrapolated.

### What a catching-up projectile meets (handoff finding 5)

A shot launched back-dated meets, at each 10 ms catch-up sub-step and before that sub-step's body test, every flight that is still live
at the clock, of another owner and the other kind (arrow against ball). The other flight is placed at its own past position for the same
sub-step (`pos - velocity * (time - t)`, exact for a flight with no homing target; a homing flight is taken back along its present
heading, which is approximate and has no test). The rule is the sweep's `delete_arrows`: within 28 u, a clear line, the arrow is
deleted and the ball weakened (x0.6). Flights that already ended are not met: a recorded hit stays. One measured case this cannot fix:
a ball lagged 300 ms spawns in a tick whose sweep already let the baseline arrow hit the victim (48.5 damage). That outcome is left as
it is and is a Root policy decision (DEV-010). No state, checkpoint or hash field was added; the code runs only with catch-up above zero.

## Wave 3: protocol 15 (one bump; owner-approved)

| Change | Status | What the code does |
|---|---|---|
| Publish ranged windups to opponents | built | Snapshot and delta actors carry a bow-draw or wand-cast windup (kind, start, duration, and the aim for a cast only) for actors the viewer sees. Melee swings are not published. `ArenaView.PresentWindup` starts the existing clip when the drawn timeline enters the windup and cuts it on a server cancel. An actor that enters the viewer's sight mid-windup is published with the windup's true `started_at` and `lands_at`, a time from before the viewer could see it; this is inherited legacy exposure (legacy showed `drawStartedAt` and the wand windup fx to anyone in sight), pinned by `observe::windup_tests::an_actor_entering_sight_mid_draw_shows_the_true_start_time` and not changed. |
| Projectile identity and deterministic motion | built | State key 7 rows carry a per-viewer track alias and a straight-line anchor (tick, position, facing, speed). The server re-sends a row only on a sighting, an end, a loss of sight or a re-anchor beyond 0.5 u; rows with an NPC owner still change every tick. `ArenaView` draws each flight every frame with `NetProjectileView.At`; an ended track stops drawing when the drawn tick reaches the last State that showed it live. Fresh tracks are numbered after NPC owners are mapped to the references the viewer sees, ordered by (kind, x, y, facing, speed, presented owner), so equal rows no longer depend on private storage or launch order (finding 4); no private id is in the key. The projectile byte saving was not measured. |
| Delta-coded remote positions, 8-bit facing | built | A changed actor's x and y go as one signed byte each when both fit, else absolute (`AD_STEP`); remote facing is on a 1/256-turn grid from v15 in Full frames too (a u16 field whose low byte is 0; deltas carry one byte). Measured with `wirebench` (debug build, 8 bots, payload bytes only): typical 300 to 287 B/s, heavy scrum 619 to 542 B/s. The 37% estimate for a moving crowd was not measured (`--synthetic` was not run). |
| Client send-time stamp on movement orders | partly built | `MoveAt` and `AttackMoveAt` (commands 19 and 20) carry the click time without the render delay; DEV-012 gives an idle walker up to one tick of credit. A moving walker, a direction change and Stop earn nothing. The C# sender stamps both orders once the first pong exists; the JS probe's helper still sends plain Move. |
| Trim per-tick head and self-block redundancy | deferred | All four trims were judged not simple and lossless (tick and ack_input need the base to decode, ready_in_ms and the self facing echo risk display and reconcile errors). |

Rust, C# (1070 tests, from the consumers report) and the JS decoder (`probe.html`, `tools/protocol-js`) were all run against `v15.json`
including malformed frames and delta chains; the regenerated vectors added state projectile, facing-grid and kit-lifecycle vectors and 30
malformed cases (15 client, 15 server), and C# and JS gained the missing expectations. The earlier Rust-only checkpoint left clients unable to connect at 15; that is closed
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
- Whether the real frame loop always delivers the own Swing Fx before `OwnAttackCue.Update`, which keeping a genuine late effect relies on;
  the test simulates that order.
- Open edge cases: a rare double swing when an older Swing Fx is still in flight as a new press starts a clip; a long bow windup can
  outlast its click-time clip; `SnapshotBuffer` replace-current-tick with an equal `ServerMs` replaces content under one timestamp
  without a cut, so the walk cache could in principle be stale (not shown reachable, not changed); the homing-flight past position in
  the catch-up meeting is approximate and untested; a ball lagged 300 ms still loses to the arrow's recorded hit (Root decision); the
  JS probe's move helper still sends plain Move (and `tools/browser-proof` depends on it); the scene-candidate tools are protocol 14
  tools and say nothing about 15; the Rust and JS reason strings for the 15 new malformed server names were not compared.
- Closed in this pass (details in the next section): `OwnAttackCue.Update` now checks death, stun, weapon change and timeout before
  adopting a ready-time jump; `Session` clears `RemoteDraw` on a source-clock cut; the aiming policy is defined and bounded; tied fresh
  projectile tracks bind by presented owner; a catching-up shot meets crossing flights; `MoveAt`/`AttackMoveAt` stamps are dropped at
  intake when `lag_fairness` is off; the v15 consumers (Rust, C#, JS) all run the regenerated vectors.

## Review pass: the five handoff findings

Evidence, test names and counts are in [coordination/CLAUDE_NETCODE_CHECKPOINT_RESULT.md](coordination/CLAUDE_NETCODE_CHECKPOINT_RESULT.md).
All results are from worker reports, not re-run by the author of these records.

| # | Finding | Result |
|---|---|---|
| 1 | `OwnAttackCue.Update` adopted a ready-time jump before checking blockers | Reproduced for death, stun, weapon change and timeout; fixed. A jump seen together with a blocker is rejected and the provisional clip cut; a genuine late server effect is still absorbed once. |
| 2 | `Session` source cut did not clear `RemoteDraw` | Reproduced (stale walk applied after a backwards cut; figure blended from its pre-cut pose after an equal-time cut). Fixed: `RemoteDraw.Reset()` in the cut block. The equal-time walk cache itself could not be reused (one sample); the stale follower state was the defect. |
| 3 | Draw-ahead and `AttackTime` described different poses | Reproduced (1000 vs 1030). Policy chosen and bounded: see "Aiming policy". No server change. |
| 4 | Fresh track numbering ignored the presented owner | Reproduced; fixed in `projectile_view::number`. |
| 5 | Catch-up projectiles skipped ball/arrow deletion | Reproduced (48.54 damage through a ball); fixed except the ball-lagged-300 ms case, returned to Root. |

Also found and fixed: with `lag_fairness` off a `MoveAt`/`AttackMoveAt` stamp reached the queue and changed the state hash (it is now
dropped at intake); the JS probe accepted a non-finite stamp; the projectile lookup was a linear scan and is now a binary search; the
protocol 15 comment in `scene_candidate` said additive and was wrong. Wish landing and cancellation and press/burst/release admission at
the seat boundary got tests with `lag_fairness` on and off and showed no defect.

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
