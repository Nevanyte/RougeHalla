# ADR0024: animation-only own-action feedback, remote draw-ahead and lag-fairness deviations

Status: **Proposed - owner direction 2026-11-09.** Waves 2 and 3 of [the competitive netcode plan](../NETCODE_COMPETITIVE_PLAN.md)
are built as described below, on the Rust side and in the C#/JS codecs with tests. The Unity scene scripts were never
compiled and nothing was measured on a real link, so this record is not Accepted. It amends the attack-prediction rule of
[ADR0008](0008-unity-client.md) and records two groups of deliberate departures from legacy parity.

## Context

ADR0008 and P-NET-1 allow exactly one kind of local prediction in Unity: the owner's walk, mirrored from Rust and always
corrected by the server. "Do not predict attacks" followed from that. The sweep behind the plan found that an own swing, bow
draw or Wish telegraph starts only after RTT plus up to one tick, the largest felt-latency cost in the pipeline, and that
ranged players have to lead their targets by their view lag while melee players do not. The owner approved the changes on
2026-11-09, including the departures from legacy parity (C-PARITY) that some of them need. Nothing here changes the 20 Hz
step, the legacy tick order (C-TICK), `validate` + `Sim::submit` (C-INPUT), the redaction of observations (C-OBS), or the rule
that Unity decides no hit, damage, cooldown or outcome.

## Decision

### 1. Amendment to ADR0008: what the client may start before the server answers

The client may start an animation or telegraph for the local player's own action before the server confirms it, and may
draw other players and projectiles ahead of the snapshot buffer, under these limits.

Own-action feedback (`OwnAttackCue`, `MatchClient.StartOwnAttackCue` and `StartOwnWishTelegraph`, `ConfirmedWishPresenter.Provisional`,
`ShowcaseSoundscape.PlayOwnSwing`):

- What may start early: the attack clip of the local player (sword, axe, shield or fists swing, bow draw, wand cast), a
  half-transparent Wish telegraph at the caster, and the melee swing sound. A bow or wand gets no sound early.
- What may never be shown early: a hit, a damage number, a hit flash, a projectile, a cooldown change, a block, a kill or any
  other outcome. The server's Fx and the server's projectile tracks remain the only source of those.
- It never gates or alters what is sent. The Attack or Cast command goes out on every press whatever the cue decides.
- A clip starts only when server-sent facts say the press will act at once: match in play, player alive, no stun or casting
  effect bit, a ping-clock sample exists, and the server's weapon readiness (`Latest.ServerMs + ReadyInMs`) falls no later than the
  estimated arrival of the press plus one tick. The Wish telegraph starts under the same kind of readiness test on the owner's
  Wish block (`ReadyAt`, no cast in progress, charges left).
- An unconfirmed clip is cut when newer server state rules the action out (dead, stunned, casting, out of play, weapon
  changed) or when no confirmation arrives within `max(RTT) + 100 ms` (at most 500 ms). A later ready-time jump in the owner
  block confirms and keeps the clip. The Wish telegraph is replaced by the first server Wish cue for that caster and is dropped
  after at most `min(600 ms, RTT + 150 ms)` otherwise.
- The first server Swing for the local player after a started melee press does not restart the clip or repeat the swing
  sound, but its flash still shows.
- Switches: `MatchClient.OwnAttackFeedback` and `OwnWishTelegraph`, both default on. Off restores the previous server-driven behaviour exactly.

Remote draw-ahead and server-line drawing (`RemoteDraw`, `ArenaView`):

- Remote players are sampled 50 ms later than the render clock. Inside the snapshot buffer that is exact interpolation. Past the
  newest snapshot a live player that is walking steadily is extrapolated along its last segment for at most 50 ms and 10 u; no
  lead is given to a stopped, sharply turning, damaged, effect-carrying, displaced or short-history actor. The drawn pose follows
  that target through a speed-capped follower and snaps only on a cut, a displacement or status change, or an error past 32 u.
  Mobs and NPCs are not drawn ahead. `MatchClient.DrawAhead` (default on) is the switch; off is exactly `SnapshotBuffer.Sample`.
- The one server-facing effect is the render time attached to Attack, Release and Cast: `Session.AttackRenderMs` is the render
  time advanced by the lead, never later than the newest snapshot the client holds. The server still clamps it into the
  RTT-bounded window. The player therefore aims at the pose drawn, and the server rewinds to the same drawn time.
- Remote bow draws and wand casts arrive as protocol 15 windups. They start the existing attack clip once per windup when the
  drawn timeline enters it, and cut it only if the server ends the windup well before its release. A projectile is drawn every
  frame from the server's track anchor with the library rule `NetProjectileView.At`; Unity runs no projectile physics and tests no
  collision. A flight anchored in the past (a lag-compensated shot) appears at its current point on the line.

These are presentation. They do not move any rule into Unity: every start condition is a fact the server sent, and every
outcome still comes from the server.

### 2. Lag-fairness deviations from legacy (docs/DEVIATIONS.md DEV-009 to DEV-012)

Four server behaviours differ from the legacy resolution. All four are gated by `SimConfig::lag_fairness`.

| Row | Legacy | With `lag_fairness` |
|---|---|---|
| DEV-009 melee | The swing origin is the attacker's own rewound position. | The origin is where the attacker stood at the tick start (`position_at(now - TICK_MS)`), the place its own prediction drew it; targets are still rewound by the attacker's lag, capped at `MAX_REWIND_MS` (300 ms). |
| DEV-010 projectiles | A shot launches at the clock and meets bodies at present times. | A player's shot launches `lag - TICK_MS` back (whole 10 ms sub-steps, at most 250 ms) and is flown to the clock at once with the ordinary stretch, wall and body tests, bodies and homing sampled at each sub-step's past time. It meets no other flight while catching up. Mobs and locks never catch up. |
| DEV-011 unit-target Wish | Range and line of sight are judged at the target's present position. | Both use the target rewound by the cast's clamped lag. Vision, hostility, immunity and untargetable remain present-time checks, so a rewind never reaches a target the caster cannot see. |
| DEV-012 move orders | Every Move or AttackMove walks exactly one tick from the next step boundary. | Protocol 15 `MoveAt` and `AttackMoveAt` carry the client's issue time `t`. A walker that stood still through the whole previous tick gets a one-off credit `clamp(now - TICK_MS - t, 0, TICK_MS)`, walked in the ordinary `walk_one` along the ordinary path. A walker that was moving, a Stop, a non-player actor and any map with slippery terrain earn nothing. |

Gating and identity guarantees:

- The flag is false in `SimConfig::default`, the parity harness, headless and policy runs, recordings, the core and first-playable
  configuration in `rh-server/src/main.rs`, and every test unless a test turns it on. `rh-server` `Settings::sim()` turns it on for
  both live runtime profiles (source arena and training). Every legacy fixture therefore runs unfiltered, and the C-PARITY
  evidence is unchanged.
- Each rule is the identity at the one-tick baseline lag (no `t`, a `t` at most one tick old, or a lock): the melee origin equals the
  legacy tick-start sample, the shot catch-up is zero, the cast rewind applies only when the lag exceeds one tick. A stamp that earns no
  credit gives exactly the walk of the same order without a stamp; `rh-sim/tests/move_stamp.rs` compares state hashes. With the flag
  off every stamp is the plain order bit for bit.
- State-hash identity: with the flag off, `SimConfig::lag_fairness` serializes as a unit value, which the state-hash serializer
  writes no word for, so the static digest and every state hash equal those from before the field existed and no recorded
  tape needed re-recording. With the flag on it serializes as `true` and changes the digest, as intended.
- Determinism: the validated command records the stamp, so replays and checkpoints reproduce a stamped run bit for bit
  (`move_stamp.rs`, `lag_fairness.rs`).
- Bounds: rewind is capped at `MAX_REWIND_MS`; a shot catches up at most 250 ms; the order credit is at most one tick; the room clamps
  `t` into the connection's RTT-bounded window (`rh-server/src/rtt.rs`) and counts a clamp in the rewind-clamp telemetry; a
  non-finite stamp validates as a plain Move; `Sim::submit` strips the stamp from any non-player actor.

Known costs, accepted by the owner: a victim can be hit up to 250 ms after leaving a line, never further back than the melee rewind; an
arrow first appears up to 225 u (a wand ball 95 u) out from the bow; walls are the current map; above about 50 ms RTT nearly every
idle walk start earns the full tick, a fixed one-tick head start for an idle walker, the same for every client; a direction change
while walking and Stop earn no credit. The deviations were not checked against a balance harness (none exists).

### 3. Wire: protocol 15

Context for the above, not a separate decision: `PROTOCOL_VERSION` is 15 and `protocol/fixtures/v15.json` holds the golden vectors,
which the Rust, C# and JS decoders all run. It adds the commands `MoveAt` (19) and `AttackMoveAt` (20); a ranged windup record on
snapshot actors (mask bit 10) and delta actors (bit 13); State key 7 as projectile tracks with per-viewer aliases and straight-line
anchors; a position-step delta form (`AD_STEP`, bit 3) and 8-bit remote facing in deltas. In the actor-delta mask `AD_KIT` moved from
bit 3 to bit 14 and kit bytes come last; the protocol 14 layout is unchanged in `v14.json`.

Disclosure: opponents now see a bow draw's start and release time and a wand cast's start aim and release time. Legacy showed both (a
public `drawStartedAt` and the wand windup fx with aim). Lock target, packet and outcome are never sent. A projectile alias is issued
on a sighting, numbered by public row order, and dropped when the flight leaves the viewer's sight; the private launch id never
leaves the server, and an anchor is never older than the sighting.

## Consequences

- ADR0008's sentence that all rules are Rust-only stands; the prediction exception now covers the owner's walk plus the
  animation-only feedback above. Anything that would show an outcome early still needs a new decision.
- Reversal is cheap. The server side is one flag (`lag_fairness`), or the client sends plain Move and AttackMove. The client side is
  `DrawAhead`, `OwnAttackFeedback` and `OwnWishTelegraph` on `MatchClient`.
- Open: the Unity scene scripts (`MatchClient`, `ArenaView`, `ConfirmedWishPresenter`, `ShowcaseSoundscape`, `SpriteActorPresenter`)
  have not been compiled; no input-to-photon, bandwidth-on-a-real-link or hit-rate figure was measured; DEV-009 to DEV-012 stay
  `pending` in the deviations register; the Wave 2 and 3 rows the plan lists as deferred remain deferred.
