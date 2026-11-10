# Unity client controls audit

Date 2026-11-09, branch `feature/unity-rework`. Code reading only: nothing was run, no Unity, no cargo. All latency figures are
**derived from code, not measured**. Section 2 says how to measure them.

Paths are relative to the repo root. `MC` = `client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs`,
`NET` = `client-unity/RoguehallaNet/Net/`, `SAP` = `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs`,
`AV` = `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`, `RAID` = `packages/client/src/scenes/RaidScene.ts` (legacy).

Decisions already taken (not re-litigated here): keep WASD/arrows, mouse aim with the character facing the cursor, right-click move,
Shift+right-click attack-move, keyboard and mouse only.

---

## 1. Input map

All reads are in `MC:290-372` (`ReadInput`), called once per `Update` after `Session.Poll()` and followed by `Session.FlushInput()` in
the same frame (`MC:282-286`). Reads use the Input System polled state (`wasPressedThisFrame`, `isPressed`).

| Input | Code | What it sends | Legacy (`packages/client`) | Difference |
|---|---|---|---|---|
| W/A/S/D, arrows | `MC:358-371` | `Move(x,y)` to **64 u ahead** (`SteerAheadU`, `MC:30`) in the 8-way normalised direction, re-sent every 100 ms (`SteerRepeatMs`, `MC:29`) and at once on direction change. Release of all keys sends `Stop`. | `net/keyboardMovement.ts:9-21` picks a goal that is **body-clear** (`segmentClear`), trying 64 down to 8 u and falling back to each single axis on a diagonal. Sent from the `keydown`/`keyup` event, not the frame (`RAID:1730-1745`, `310-315`). | Unity never checks that the goal is reachable in a straight line (see F1). Key events wait for the next frame (F7). Arrows are ignored only while a UI pane owns arrow navigation (`MC:359`). |
| Mouse move | `MC:316-320` | `Aim(angle)` from the **drawn** player position to the cursor ground point, every frame the pointer is over the world. `InputSender` rate-limits to one per 25 ms (40/s) and drops unchanged values, repeating at 100 ms (`NET/InputSender.cs:14, 138-149`). | `streamAim` (`RAID:1671-1688`) gated by `AimGate`, a turn threshold, and a keepalive. | Equivalent in intent. Unity has no tick-phase alignment (legacy `net/tickPhase.ts`, `uplinkPace.ts`). Aim is not sent while the pointer is over a UI element (`MC:316`). |
| Left button press | `MC:321-335` | Wand with a pickable actor under the pointer: `Target(ref)`. Otherwise `Attack(angle, renderMs)`. | `clickAttack` (`RAID:1400-1417`): same split. Also starts a cosmetic local swing (`localAutos.press`). | Unity has **no local swing animation**; the own swing is shown only when the server `Fx` arrives (F5). |
| Left button release | `MC:299-302` | `Release(angle, renderMs)`. Forwarded even when the pointer is over UI, and when a menu or map opens (`MC:306-309`). | `releaseAttack` (`RAID:1419-1423`). | Same. |
| Right button press | `MC:336-340` | `Move(cursor)`; with Left Shift held, `AttackMove(cursor)`. **Press only.** | Press sends a move; **holding** re-sends it about every 100 ms when the cursor ground point moved (`holdMove`, `RAID:1256-1270`, `575-576`). Shift attack-move did not exist. | **Right-click-and-hold steering is gone.** Dragging the cursor while the button is held does nothing (F4). |
| R | `MC:344-349` | `Cast(slot 0, cursor point, optional picked actor, renderMs)` (Wish) through `Session.CollectWishInput`. | `castSlot("wish")`. | Same. |
| 1 / 2 | `MC:350-354` | `Swap(0)` / `Swap(1)`, unless a chest pane owns digits. | Digit1/Digit2 (`RAID:1751`). | Same. |
| Q | `MC:355` | `Swap()` (toggle). | `swapHand`. | Same. |
| E | `MC:356` | `UseConsumable`. | `drinkPotion`. | Same. |
| F | `MC:357` | `Pickup(focus handle)` when a focus exists. | `interact`. | Same. |
| Window blur | `MC:209-221` | `Release` and `Stop` flushed immediately. | `onWindowBlur` (`RAID:316-324`). | Same. Only fires on Unity application focus loss; see F9 for DOM focus. |
| UI focused | `MC:303-314`, `UI/MatchHud.Features.cs:43-45` | Keyboard blocked (menus, settings, typing, drawer, help, map planning, resume chooser, training console, launch pending): steering stops with one `Stop`, held attack is released, nothing else is read. Pointer blocked also when the pointer is over a UI element. | `isTyping(e.target)` guard only. | Unity is stricter. A blocked frame sends no aim, so the facing goes stale (F6). |
| Mouse capture | none | No `Cursor.lockState`/`visible` use anywhere in `Assets/Scripts`. The cursor is free and can leave the canvas. | Same. | None. |
| Context menu | none found | No `contextmenu` handler in `Assets/WebGLTemplates/Roguehalla/index.html` or any `.jslib`. Unity may suppress it itself; **unverified** (F8). | Phaser disables it. | Verify in a build. |

---

## 2. Input-to-motion pipeline

### 2.1 Stage by stage (W held from rest)

| # | Stage | Code | Delay added |
|---|---|---|---|
| 1 | Browser `keydown` reaches Unity. The Input System applies queued events at the start of the next player-loop update. | WebGL template, Input System (update mode not verified: assumed default dynamic update) | 0 to 1 frame. 0 to 16.7 ms at 60 Hz. `vSyncCount=0`, `targetFrameRate=-1` (`Bootstrap.cs:54-55`), so on WebGL the frame cadence is the browser's `requestAnimationFrame`. |
| 2 | `Update`: `Session.Poll()` runs `LocalMotion.Step` first, then `ReadInput` creates `Move` (`MC:366-367`), `Motion.Order` plans an A* path (`NET/LocalMotion.cs:201-232`), `FlushInput` encodes and calls `RhWs_Send` (`NET/Session.cs:245-282`, `WebGLTransport.cs:48`). | `MC:266-288` | About 0 for the send (same frame). |
| 3 | `Present` draws `Motion.DrawnX/Y` (`MC:442, 454`). The step for this frame already ran **before** the order existed, so this frame draws no movement. The walk model advances at the next frame's `Poll` (full `dt`, instant 170 u/s, no acceleration). | `NET/Session.cs:263`, `LocalMotion.Step` `318-332` | **+1 frame, 16.7 ms.** |
| 4 | Browser composite and display scan-out. | not in code | 0 to ~16.7 ms. Excluded from the estimates below. |

Local prediction is **on** (section 3). The local sprite does not wait for the server.

Server and remote path (what other players see, and what reconciliation compares against):

| # | Stage | Code | Delay |
|---|---|---|---|
| 5 | Uplink WebSocket. `TCP_NODELAY` is set (`crates/rh-server/src/lib.rs:113-117`). | | RTT/2 (unknown, LAN ~1 ms, internet 15 to 80 ms) |
| 6 | Connection bucket: 60 frames/s, burst 120. | `crates/rh-server/src/conn.rs:32-33, 48-65` | 0 normally. Overflow closes the connection with `RateLimited`. |
| 7 | `RoomCmd::Input` queued and applied **between steps**, through `Sim::submit` and the order budget. The order takes effect in the **next** 50 ms step. | `crates/rh-server/src/room.rs:696-740`; `crates/rh-sim/src/systems/inputs.rs:170-205` | **0 to 50 ms, mean 25** (wait for the tick grid, plus pacer wake lateness) |
| 8 | Step then publish on the same wake. A snapshot is produced every tick (20 Hz). | `room.rs:1240-1377` | encode time, assumed under 5 ms |
| 9 | Downlink. `Poll` drains the JS queue once per frame. | `WebGLTransport.cs:58-79` | RTT/2, plus 0 to 16.7 ms frame wait |
| 10 | Remote actors are drawn `RenderClock.DelayMs` behind the newest snapshot: target = tick + 98th-percentile arrival excess, clamped **70 to 150 ms**, starts at 100. Samples are linearly interpolated, no extrapolation. | `NET/RenderClock.cs:13, 53-54`; `SnapshotBuffer.cs:90-105` | **70 to 150 ms**. Applies to other players only, never to the local sprite. |

### 2.2 Estimates (derived, not measured)

Frame period F = 16.7 ms (60 fps). Scale with the real frame time: a WebGL build at 30 fps doubles the local figures.

| Quantity | Best | Worst | Basis |
|---|---|---|---|
| Key-down to first local pixel movement (excl. display) | **~17 ms** | **~33 ms** | stages 1 + 3 |
| Key-up to local sprite stopped | ~0 ms (same frame: `StopOrder` clears the path before `Present`) to 17 ms | 17 ms | `LocalMotion.StopOrder` `237-252`. The walk animation then lingers 120 ms (SAP:146, F10). |
| Key-down to server-confirmed position change visible to the **owner** (what reconciliation uses) | RTT + 0 ms + 0 ms ≈ RTT | RTT + 50 + 17 ms | stages 5, 7, 9 |
| Key-down to **another player's screen** shows movement | ~1 + 0 + 1 + 70 ≈ **72 ms** (LAN) | RTT_me/2 + 50 + RTT_obs/2 + 150 + 17 ≈ **RTT + 217 ms** | stages 5 to 10 |
| Mouse move to local facing change | ~17 to 33 ms (same path as the sprite; uses `_aimAngle` directly, `MC:442`) | | |
| Mouse move to the **server's** facing | 25 ms send floor + RTT/2 + up to 50 ms tick | | `InputSender.AimMinIntervalMs`, `weapons.rs:17-21` (`set_aim` also sets `body.facing`) |
| Left click to own swing animation | ≈ RTT + 0 to 50 ms + frame | | Swing plays on the server `Fx` (`AV:296-319`, `SAP:77-86`) |

Stop-latency note: the client stops itself immediately, the server later by delay D. `LocalMotion` compares each sample with the
model's pose at (sample time − D), so the server's stop point equals the client's stop point; there is no overshoot to snap back.

### 2.3 How to measure in a running WebGL build

The existing `LatencyTrace` (`Net/LatencyTrace.cs`) marks only Unity-side frame events (`frameStart`, `sampleMove`, `sampleStop`,
`presentSelf`, `presentActor`) through `RhLatency_*` jslib hooks, so it cannot see the browser event time or the display time. Add
these, all behind the existing `LatencyTrace.Enabled` flag so ordinary players record nothing:

1. **Browser keydown timestamp.** In the harness page, add `window.addEventListener('keydown', e => RH.keyDown(e.code, e.timeStamp))`
   and the same for `keyup` and `mousedown`/`mousemove`. `event.timeStamp` is a `performance.now()` value taken at dispatch.
2. **Frame boundary.** `performance.now()` at the top of the first `RhLatency_Mark("frameStart")` of each frame (already marked).
   The jslib `RhLatency_Mark` must stamp each record with `performance.now()`; today it records frame number only (check the jslib).
3. **Local pixel mark.** In `MC.Present` (`MC:445-446`) the `presentSelf` mark already carries `DrawnX/Y`. The analyser takes the first
   `presentSelf` after the key-down whose `DrawnX/Y` differs from the previous one. Delta to the keydown timestamp = stages 1 to 3.
4. **Send mark.** `Mark("sampleMove", seq, x, y)` exists. Record its `performance.now()` to confirm same-frame send.
5. **Server echo.** In `MatchClient`'s `SnapshotReceived`, mark `ackMove` (`Session.Me.MoveSeq`, `snap.Tick`, `snap.AckInput`) at arrival
   time. First snapshot whose `MoveSeq` equals the `sampleMove` seq: delta to `sampleMove` = RTT + tick wait. Subtract the Ping RTT
   (`Session.RttSample`, `Sync.LastRttMs`) to isolate the tick wait (expect uniform 0 to 50 ms).
6. **First server-position change.** Mark `serverPosChanged` when `Session.Me.X/Y` first differs after the order. This is the owner's
   view of authority.
7. **Remote view.** Run two clients; on client B log `presentActor` for A's id and take the first X change. Delta to A's keydown
   (clocks differ: use one machine, two tabs, same `performance.timeOrigin`-aligned page, or a single headless harness).
8. **Display.** Optional: Chrome DevTools Performance panel "Frames" lane, or `requestVideoFrameCallback` on a screen recording at 120 fps.
9. **On-screen debug overlay** (cheap alternative): a dev-only line in `MatchHud` showing, per press, `keyDown→send`, `send→echo`,
   `keyDown→first drawn change`, frame ms (`Time.unscaledDeltaTime`), RenderClock `DelayMs`, `Snaps`, `ExpiredOrders`,
   `ConsecutiveOutOfToleranceSamples` (all exist on `LocalMotion`/`RenderClock`).
10. Run each at: 60 fps and a forced 30 fps tab; localhost and a remote server; 30 presses each; report median and p95.

Also log frame time: if the WebGL build is below 60 fps, section 2.2's local figures grow proportionally and become the dominant term.

---

## 3. Prediction and snap-back

**Prediction is on** for the owner's walk only (`LocalMotion`, ADR 0008's one exception). `ArenaView.Present` draws
`motion.DrawnX/Y` for the local actor (`AV:148`); the camera follows `DrawnX/Y` (`MC:454`). Remote players are interpolated 70 to
150 ms in the past.

How it works (`NET/LocalMotion.cs`):

- `Order`/`StopOrder` (`201-252`) plan the same A* path as the server and start walking at once; `Step` (`318-332`) advances along the path at
  `170 u/s × speed_milli/1000` (the Rust `advance_along_path` mirror, `Walk` `444-469`). Per-step stall cap 100 ms (`MaxStepMs`).
- `OnSnapshot` (`342-393`) sets `Sim` to the server position, then `Reconcile` (`649-691`) compares it with the model's pose one
  measured order delay earlier. The first echo of a *timing* order (start, stop, or a turn over 12°) measures D = sample time − 50 ms −
  order time (clamped −50 to 400 ms, `NoteEcho` `556-574`). A held key's same-direction repeats are not timing orders.
- Error ≤ 96 u (`SnapDistance`): the model is shifted by the error and the **visual offset** carries the difference, decaying at tau
  100 ms but capped at 70 to 120 u/s while walking and 255 u/s at rest (`Decay` `485-502`). A walking character is slowed or hurried,
  never turned.
- Error > 96 u, or the composed offset > 96 u: `SnapToSim` (`694-710`), a visible teleport.
- A hard cut (server displacement, death, revival) discards the path (`372-391`). Locked gates suspend prediction entirely
  (`Session.cs:445-453`).
- An order not echoed within 1 s is forgotten (`ExpireOrders` `733-742`); the walk continues, samples keep reconciling.

**When the character rubber-bands** (all by design, but visible):

1. **Server-side movement pauses and slows are not predicted.** `LocalMotion.SpeedModifier` returns 1.0 (`432`). The server sets the
   move multiplier to **0** during a swing, and from `lands_at − 200 ms` (`RANGED_RELEASE_PAUSE_MS`, `constants.rs:139`) before every bow
   or wand release, and during `root_until` (`weapons.rs:253-263`). Chill slows 0.7× (`constants.rs:223`). So attacking with a
   ranged weapon while walking: the server stops for ~200 ms and the client keeps walking, a lead of up to 34 u that is then pulled
   back at 70 to 120 u/s. Legacy predicted this (`syncLocalRangedPause`, `RAID:679, 1416`). The server already computes the data
   (`systems/walk_hint`), but nothing in `client-unity` consumes it (no `WalkHint` hit in `*.cs`).
2. **Dropped orders.** `Sim::submit` returns `OverBudget` when a seat exceeds 15 orders/s (burst 30; aim exempt:
   `crates/rh-sim/src/input.rs:1061-1064`, `constants.rs:172-173`) and `room.rs:731` ignores the result silently. A held WASD uses
   10/s, so 5/s remain for `Attack`, `Release`, `Swap`, `Move`, `Cast`. Rapid clicking while steering can exhaust it. A lost `Stop`
   (sent once, `MC:371`) makes the server walk on to the 64 u goal (up to 0.38 s) while the client stands still; the model sits
   ahead/behind until the 1 s expiry. A lost `Move` stalls the steer for 100 ms.
3. **Steering into walls.** The server plans a path to a goal inside a wall by snapping the goal to the nearest floor **tile centre**
   (`crates/rh-sim/src/pathfind.rs:260-273`), and a goal on the far side of a thin wall is reached by walking **around** it. The client
   mirror does the same (so it is consistent, not a snap), but the character visibly veers sideways or loops (F1).
4. **Server displacement** (knockback, blink, teleports >256 u): hard cut by design.
5. **Network stall.** A stall of more than 376 ms (64 u at 170 u/s) lets the server walker reach the steer goal and stop while the
   key is still held.
6. **Locked gates** suspend prediction: the local character then follows server positions and feels 1 RTT + tick behind.

---

## 4. Feel problems, ranked by impact

### F1. Keyboard steering sends an unchecked 64 u goal (high)

`MC:358-371`: `OrderMove(myX + dir.x * 64, myY + dir.y * 64)` with no reachability test. The server (and the client mirror) treat it as a
**path order**, so:

- Holding W against a wall: goal falls in the wall, snaps to the nearest floor tile centre (`pathfind.rs:260-273`): the character is
  pulled toward a tile centre that may be sideways of the held direction, instead of stopping or sliding.
- Near a thin wall or pillar corner: the goal lies beyond it, A* routes around it (a detour the player never asked for).
- A diagonal into a wall gives no axis fallback, so the character cannot slide along walls. Legacy slid by trying each axis.
- The path is re-planned on the server and in `LocalMotion.Order` every 100 ms (A* on the WebGL main thread).

**Fix.** Port `keyboardMoveGoal` (`packages/client/src/net/keyboardMovement.ts:9-21`): candidate headings = held direction, then on a
diagonal each single axis; for each, distances 64, 56, ..., 8 u; first goal whose straight segment is body-clear wins; none clear →
no new order, and if previously moving, `Stop`. It chooses *which destination to send* only; collision truth stays in Rust.
`Pathfinder.SegmentRaysClear`/`CircleClear` (`NET/Pathfinder.cs:509, 542`) are private mirrors of rh-sim `segment_clear`; expose one
`internal bool SegmentClear(MapBlob, ax, ay, bx, by, radius)` and test it against the existing collision fixtures
(`RoguehallaNet.Tests/CollisionFixtureTests.cs`). Cheaper interim: accept a goal only if `FindPath` returns a single waypoint equal to
the goal. Keep `SteerRepeatMs = 100` and `Stop` on release.

### F2. Ranged attack pause is unpredicted: rubber-band on every shot while moving (high)

`NET/LocalMotion.cs:432` (`SpeedModifier` = 1.0) against `weapons.rs:253-263` (multiplier 0 for the last 200 ms of a ranged windup and
during swings/roots). See section 3 item 1. Legacy had `syncLocalRangedPause` (`RAID:679`).

**Fix.** Implement the legacy pause in `LocalMotion.SpeedModifier(nowMs)` driven by the local press time and the equipped weapon's
timings, **or** consume the server's WalkHint. Both need Rust-generated vectors (C-PARITY) and an ADR 0008 amendment (the file comment
at `LocalMotion.cs:35-38` says windup is "deliberately not guessed"), so this is a coordinator decision. Until then, reduce the
visible cost: while an attack is held with a bow or wand and `Session.Me` reports it, apply a lower `CorrectSpeedMoving` ceiling so
the pull-back is smooth rather than a snap.

### F3. Camera follows the drawn position with no smoothing, and is moved after input is read (medium)

`AV:392-396` sets the camera to `DrawnX/Y` exactly each frame. `DrawnX/Y` includes the decaying reconcile offset (`LocalMotion.cs:142-147`),
so every 2 to 6 u correction moves the whole screen. Legacy absorbed this with `CameraFollow` (`packages/client/src/render/CameraFollow.ts`,
tau 35 ms, cut over 256 u or after a teleport). Separately, `Follow` runs inside `Present` (`MC:454`), **after** `ReadInput`, but
`ScreenToServer` (`AV:423-428`) uses the camera as left by the previous frame while `myX/myY` are this frame's: the aim angle is skewed
by one frame of motion (about 2.8 u; ~1° at 150 u range, constant while strafing, enough to flip an 8-way sprite sector at a boundary).

**Fix.** (a) Move the `Follow` block (`MC:450-454`) to immediately after `Session.Snapshots.Sample` and before `ReadInput` (`MC:280-284`),
so the cursor ground point matches this frame's camera. (b) Add a 35 ms exponential smoother in `ArenaView.Follow`, bypassed on
`TacticalMap.IsPeeking` and on jumps over 256 u or `dt` over 250 ms, as legacy. If smoothed, compute `ScreenToServer` from the *smoothed*
camera position.

### F4. Right-click hold does nothing (medium)

`MC:336` uses `wasPressedThisFrame` only. Legacy re-sent the move while the button was held and the cursor ground point moved
(`holdMove`, `RAID:1256-1270, 575-576`), which is how players steer with the mouse alone. Also, `OrderStop()` on WASD release
(`MC:371`) cancels a right-click walk begun while a key was held, and a held key overrides a right-click within 100 ms (legacy
behaved the same; keep).

**Fix.** In `ReadInput`: `if (mouse.rightButton.isPressed && !_steering && haveCursor)` re-send `OrderMove`/`AttackMove` every 100 ms
(`HoldRepeatMs`) when the cursor ground point moved more than 8 u from the last sent point (legacy `TARGET_GOAL_MOVED`
equivalent). Respect `blocked`. Share the 15 orders/s budget with F6 below.

### F5. Own attack has no local feedback until the server confirms (medium)

The swing/shoot/cast animation for the owner starts on the server `Fx` (`MC:254-264` → `AV:296-319` → `SAP:77-86`, `ConfirmedCue`), so
a click shows nothing for ≈ RTT + 0 to 50 ms + a frame. Legacy started a cosmetic swing at press (`localAutos.press`, `RAID:1414-1415`).

**Fix.** On `Attack` send (`MC:329`), call a presentation-only `ArenaView.LocalAttackCue(Session.PlayerId)` that sets `AttackAt`/`AttackUntil`
in `SpriteActorPresenter` using the same clip selection (`AttackFrames`), and de-duplicate against the later confirmed `Fx`. No hit,
damage, or cooldown is shown (C-OBS; Unity holds no rules). If the server rejects (stun, cooldown) the cue is cancelled by the next `Fx`
absence after 300 ms.

### F6. Orders can be dropped silently; `Stop` is not repeated (medium)

Section 3 item 2. `InputSender` has no retry and `room.rs:731` ignores `submit` errors. Stop is the highest-risk order.

**Fix.** (a) In `MC:371`, after sending `Stop`, if `Session.Motion.OrderPending` is still true after 150 ms (no `move_seq` echo), send
`Stop` again once. Stop is idempotent. (b) Keep the shared order count under budget: do not re-send `Move` while the new goal equals the
last goal and the client is within 16 u of it. (c) Coordinator question: should the server exempt `Stop` from the order budget (as Aim
is, `input.rs:1062`)? That is a Rust change, not made here.

### F7. Key presses wait for the frame (low to medium)

Legacy sent the steer order from the `keydown` event (`RAID:1741-1743`). Unity polls once per frame (`MC:266-288`), adding 0 to 16.7 ms
(mean 8) plus the one-frame draw delay already counted. Not fixable without leaving the polled Input System; a WebGL event hook would
add a jslib. Leave it, but make sure the build holds 60 fps (section 2.3 item 10). If frame time exceeds 25 ms this becomes the
largest local term.

### F8. Right-click may open the browser context menu (verify, potentially high)

No `contextmenu` suppression in `Assets/WebGLTemplates/Roguehalla/index.html` (grep: no hit). Unity's WebGL runtime may already
`preventDefault` on the canvas; this must be confirmed in a build. If it opens a menu the first right-click is lost and the canvas loses
focus.

**Fix.** Add `canvas.addEventListener('contextmenu', e => e.preventDefault())` in the template after `const canvas = ...`
(`index.html:~186`). Proposed only; the template was not edited.

### F9. Stuck keys after DOM focus loss (verify, low)

`OnApplicationFocus(false)` (`MC:209-221`) only fires for Unity application focus. A click on a DOM element in the template or a
browser dialog that takes focus without an application focus change can swallow a `keyup`, leaving W "pressed" in the Input System and
the character running until the 64 u goals repeat forever. Legacy cleared on `blur` (`RAID:316`).

**Fix.** Add a `window.blur` and `visibilitychange` hook in the template that calls a `SendMessage("MatchClient","ReleaseAllInput","")`;
`ReleaseAllInput` does the same body as `MC:213-220`. Proposed only.

### F10. Animation: forward walk while moving backward; walk phase is global; 120 ms foot-slide on stop (high, owner-reported)

See section 5. Additional details at the same site:

- `SAP:165` uses `elapsed = Time.unscaledTime` for the walk loop, so every actor shares one global phase and a walk starts on an arbitrary
  frame instead of the contact pose. This reads as a delayed, mushy start.
- `SAP:146` holds the walk 120 ms after the last position change; after a (locally immediate) stop the feet keep moving.
- `SAP:184` selects the 8-way sector from the **server-space** angle with no hysteresis. The squash (`GroundSquash = 0.78`, `AV:15`)
  makes the server angle differ from the on-screen angle by up to ~7°, and a still cursor on a sector boundary jitters between sprites.

### F11. Aim uses predicted position, the server uses its own (low)

`MC:319` aims from `DrawnX/Y` (predicted). The server resolves the attack from its own, delayed position (up to RTT/2 + tick behind). While
strafing at 170 u/s the position differs by up to 170 × 0.1 s = 17 u, an angle error of ~10° at 100 u range for the *server's* shot. This is
inherent in the prediction design (legacy identical); noted so nobody tunes the wrong thing. No change proposed.

### Checked and fine

- **Diagonal speed:** `dir.Normalize()` (`MC:364`) gives the same order distance in all 8 directions; the server walks the path at a constant
  170 u/s. No √2 bug. On screen, vertical travel looks 22% slower than horizontal (`GroundSquash`); legacy `Y_SCALE` did the same.
- **Aim rate:** `Aim` ≤ 40/s, repeat 100 ms, exempt from the order budget; the server keeps the newest aim per tick; stale after
  `AIM_STALE_MS = 1000` (`constants.rs:92`), after which the server turns the fighter to its path (`movement.rs:78-79, 106-112, 132-157`).
  The local sprite uses `_aimAngle` (`MC:442`) so it never shows that flip; remote viewers do see it if the owner's cursor is over UI
  for over a second (aim stops being sent while `blocked`).
- **Connection bucket:** at most one input frame per client frame, so a 144 Hz client with aim 40/s + steer 10/s + clicks stays under 60/s;
  the burst of 120 covers spikes.
- **Direction change and key release:** a direction change sends immediately (`MC:365`, `dir != _lastDir`). Releasing one key of a diagonal
  changes `dir` and re-sends. Releasing the last key sends `Stop` and the local walk ends the same frame.
- **UI focus:** `keyboardBlocked` cleanly stops steering and releases the attack (`MC:303-314`). Release is never swallowed
  (`MC:299-302`). Digits and arrows are surrendered only to the panes that need them (`MC:350, 359`).
- **Camera zoom:** fixed ortho size 9 (`Bootstrap.cs:50`); no zoom input, none in the decisions.

---

## 5. The backward-walk fix

**Where:** `SAP.Present`, lines 135-191 (animation choice at 163-178, direction and frame at 179-188). No server, wire or `LocalMotion`
change. The math should be a pure function in `client-unity/RoguehallaNet` so `dotnet test` covers it without Unity (suggested
`Roguehalla.Net.Gait.Classify`).

**Inputs.** Server-space velocity direction `v` and facing `f` (`facing`, already the cursor angle for the local actor via `_aimAngle`,
the interpolated server facing for others). Velocity from the frame delta in `SAP:145-147`:

```
dxw = position.x - a.LastPosition.x;           // world units
dyw = position.y - a.LastPosition.y;
sx  =  dxw / ArenaView.Scale;                  // back to server units
sy  = -dyw / (ArenaView.Scale * ArenaView.GroundSquash);
```

Guard: `Present` can run twice per frame for NPCs (`AV:RetainObservedActors → PresentLatestNpcs` and `Present`). Skip the update when
`Time.unscaledTime == a.StampTime`, otherwise `dt = 0` produces NaN.

**Per-actor state (add to `Art`):** `Vector2 Vel` (smoothed server-space velocity), `float WalkPhase`, `bool Reversed`, `float StampTime`.

```
float now = Time.unscaledTime, dt = now - a.StampTime;
if (dt > 1e-4f) {
    var raw = new Vector2(sx, sy) / dt;                     // u/s
    a.Vel = Vector2.Lerp(a.Vel, raw, 1f - Mathf.Exp(-dt / 0.08f));   // direction only
    bool walking = raw.magnitude > 10f;                      // idle threshold; no 120 ms hold
    a.StampTime = now;
    ...
}
```

Use the **raw** speed for the walking/idle switch (so the feet stop on the frame the body stops) and the **smoothed** velocity only for
the angle (so the reconcile offset and interpolation noise do not flip direction). Teleports (`|raw| > 600 u/s`, matching
`SnapshotBuffer.TeleportDistance` per tick) and respawns: reset `a.Vel = 0`, do not classify.

**Classification.** `c = dot(a.Vel.normalized, (cos f, sin f))` when `|a.Vel| > 25 u/s`, else keep the previous result.

| Angle between motion and facing | `c` | Result | Clip |
|---|---|---|---|
| 0° to 67.5° | ≥ 0.383 | forward | walk, normal |
| 67.5° to 112.5° | −0.383 to 0.383 | strafe | walk, **normal** (no strafe clips; sprites already face the cursor) |
| 112.5° to 180° | ≤ −0.383 | backward | walk, **reversed** |

The thresholds are the 8-way sprite sector edges, so strafing at 90° never looks like a wrong-way walk, and "backward" is only the rear
three sectors. Add hysteresis of ±0.10 in `c` (enter reversed at `c ≤ −0.483`, leave at `c ≥ −0.283`) so a cursor circling the character
at the boundary does not flicker. The rule needs no special case for remote actors: when the server is not aiming it faces along its path
(`movement.rs:106-112, 150-152`), so `c ≈ +1`.

**Reversing the clip, with a continuous phase.** Replace the global-time frame index (`SAP:165, 185`) for the **walk** branch only:

```
// walk branch: instead of elapsed = Time.unscaledTime
if (!a.WasWalking) a.WalkPhase = 0f;                       // start on the contact pose, not mid-cycle
a.WalkPhase += dt * fps * (a.Reversed ? -1f : 1f);         // dt is the stamped dt above
int count  = frames.Length / 8;
int frame  = Mathf.FloorToInt(Mathf.Repeat(a.WalkPhase, count));   // Repeat handles negatives
a.WasWalking = true;
```

`a.WalkPhase` is carried, so flipping `Reversed` mid-stride just changes the direction the phase counts; there is no jump. Every other
branch (idle, attack, hit, block, death) is untouched and sets `a.WasWalking = false`. `reduced` (reduced motion) already pins
frame 0 (`SAP:186-187`) and stays that way. Use the 8-way `direction` from `facing` exactly as today (`SAP:184`), unchanged: the sprite
keeps facing the cursor and only the leg cycle runs backwards. Optionally scale `fps` by `clamp(speed / 170, 0.6, 1.2)` to match the
stride to the travelled distance, in which case the slowed-by-correction walk also looks right.

**Replace** `MovingUntil = now + 0.12` (`SAP:146`) with the `walking` boolean above; delete the 120 ms hold. `ResetTransientTimers`
(`SAP:62-71`) must also zero `Vel`, `WalkPhase`, `WasWalking`, `Reversed`.

**Tests (no Unity).** Table-driven in `RoguehallaNet.Tests` against `Gait.Classify(vx, vy, facing, prevReversed)`:
`(v=east, f=east)` forward; `(v=east, f=west)` backward; `(v=east, f=north)` strafe not reversed; boundary pairs at 112.5° ± 1° with
the hysteresis expected; `|v| < 25` keeps the previous value; NaN/zero `dt` returns the previous state. Then a screenshot check in the
browser harness: walk away from the cursor and record 10 frames; the leg frame indices must descend.

---

## 6. What must not change

- **`LocalMotion` and `Pathfinder` constants and arithmetic** are a mirror of rh-sim and are checked with Rust vectors
  (`RoguehallaNet.Tests/LocalMotionTests.cs`, `CollisionFixtureTests.cs`): `PlayerSpeed = 170`, `TickMs = 50`, the `Walk` budget-per-waypoint
  loop (`NET/LocalMotion.cs:444-469` mirrors `movement.rs:132-157`), `MoveMultFloor = 0.35`, A* tie-breaking, `PlayerRadius = 12`. F1's
  `SegmentClear` must be added to the vector-checked set, not hand-written.
- **Reconciliation constants** (`SnapDistance 96`, `VisualTauMs 100`, `OrderExpireMs 1000`, correction caps 70/120/255, the 12° timing-order
  rule) were ported from the legacy client and drive the delay alignment. Retune only with a measured trace (section 2.3).
- **Unity holds no game rules.** Everything proposed above sends destinations and intents or draws pixels: F1 chooses which destination to
  send; F2 needs a Rust-generated vector and an ADR 0008 decision before any pause logic lands; F5 is a cosmetic cue with no damage,
  cooldown or hit result; F10/section 5 reads positions only. No client-side collision resolution, hit test, cooldown or targeting rule
  may be added.
- **Every actor acts through `validate` + `Sim::submit`** (C-INPUT): no extra command kinds for convenience. The order budget stays
  server-side (`input.rs:1061`); client changes must stay under it (steer 10/s).
- **Observations never leak hidden state** (C-OBS): the facing and velocity used in section 5 come from already-delivered fields; do not
  read the private server pose.
- **Wire and protocol:** no change in this audit; none of the fixes bumps `PROTOCOL_VERSION`.
- **`InputSender` semantics:** aim latest-wins at 25 ms, 16 commands per frame, per-frame `Seq` (`NET/InputSender.cs:14, 138-161`).
- **Headless/policy runs never use `LocalMotion`.** Keep the presentation changes (camera smoothing, gait, local attack cue) out of
  `RoguehallaNet` paths that headless uses; the gait function is pure and presentation-only.
