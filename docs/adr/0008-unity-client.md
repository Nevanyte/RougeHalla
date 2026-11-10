# ADR 0008: Unity Web client with an engine-independent C# net library

**Status:** Accepted baseline; actual Unity 6000.0.85f2 Web build and Chromium transport/movement have been verified
(historical build inputs in `docs/evidence/stage2-unity-v5/`). Full flows, browser matrix and performance remain open.
The later snapshot-only client correction is library-tested and still needs a fresh Web build. **Decision.**
- Unity 6 LTS (`client-unity/UnityProject/ProjectSettings/ProjectVersion.txt`, pinned patch), URP, the Input
  System; Web (WebGL2) target first; WebGPU optional later behind a fallback.
- All protocol and client-network logic lives in `client-unity/RoguehallaNet` (netstandard2.1, C# 9, no reflection, no
  threads on the hot path): built and tested with plain `dotnet` against the golden vectors, so it does not
  need the Editor. The Unity project copies it (`client-unity/sync-net.sh`, checked by a test).
- WebGL transport: a jslib bridge to the browser WebSocket (`RhWebSocket.jslib`), polled each frame; Editor/desktop use
  `ClientWebSocket`.
- All rules, physics, collision, combat and AI are Rust-only. The current client presents accepted authoritative self
  positions and interpolates remote presentation in the past. Its former straight-line walk/collision approximation was
  removed after the owner's boundary clarification (2026-11-05). Local walk prediction may return only after mirroring
  Rust movement, passing Rust-produced vectors and retaining server correction (P-NET-1); headless runs never use it.
- Stale/duplicate Full snapshots are validated without replacing the delta base. Only an accepted newer snapshot updates
  public Latest/Me/Motion or invokes SnapshotReceived; decoded-frame counters remain separate. A fresh Welcome resets
  that timeline and an accepted self absence clears the local presentation.
- Owner amendment 2026-11-05: visual assets need not match legacy art one-to-one. Compatible open-source assets,
  original Unity/procedural assets and creative visual redesign are allowed; retain readability, authoritative Rust
  geometry and third-party terms. This supersedes the initial existing-art-only clause. Targets:
  [../VISUAL_DIRECTION.md](../VISUAL_DIRECTION.md).
- **Amendment 2026-11-10 (owner-approved: attack movement pause).** The one prediction exception now also mirrors the server's
  attack pause, and nothing else about attacks. Rust rule (`crates/rh-sim/src/systems/weapons.rs`, `move_multiplier`): the step
  ending at tick `T` does not move the owner while a swing winds up, from `RANGED_RELEASE_PAUSE_MS` (200 ms) before a bow or wand
  shot lands (`T >= landsAt - 200`) until it lands (weapons run before movement in a tick, so `T < landsAt`, with `TIE_EPS_MS` for
  a landing on a step), and while `root_until` holds. `LocalMotion` mirrors the first two **from delivered facts only**: the owner's
  `Windup` fx (the tick it was sent in plus its whole-millisecond wait is the landing), ended early by the owner's `Stagger` fx
  (the stagger's own tick is still stopped), the owner's `Cancel` fx (the step before the cancel's tick is the last stopped), and
  by a stun bit or a weapon change in the self block (the step before that sample). The client never times an attack from a key
  press and holds no weapon timing: its only new rule constants are `RangedReleasePauseMs = 200` and `TieEpsMs = 1e-6`
  (`TickMs` and `PlayerSpeed` were already mirrored), pinned to the Rust values by the fixture. The window is kept in server time
  and mapped onto the model clock through the sample stamp and the measured order delay reconciliation already uses, so the walk
  stops exactly where the server's does (no frame quantisation: the walk is integrated over the part of each frame outside the
  window). Server correction is unchanged and authoritative; headless and policy runs never build a `LocalMotion`.
  **Not mirrored:** roots, slows, terrain; the **bow** release (the sim announces no `Windup` for a bow draw and the owner block
  carries no landing time, so there is no delivered fact; the gap is pinned by a test and needs a separate reviewed sim or wire
  change); a player's melee swing has no wind-up, so nothing changes for melee. **Proof (C-PARITY):**
  `protocol/fixtures/ranged_pause_v1.json`, written by `crates/rh-parity/tests/ranged_pause_golden.rs` from the real sim
  (`RH_WRITE_FIXTURES=1`; the test fails if the file is not what the current core produces): per 50 ms tick the server's
  position and whether the step moved, and only the owner-observable facts, for wand single, held (3 casts), rejected by
  cooldown, staggered before and inside the pause, weapon swap in the pause, bow and sword.
  `client-unity/RoguehallaNet.Tests/RangedPausePredictionTests.cs` checks that the mirror stops exactly the steps the server
  stopped, and replays the cases through `Session` with link latency: with the mirror the drawn walk equals the zero-latency
  server timeline to 0.01 u at 0 to 150 ms RTT (without it: 23 to 32 u, a model-vs-server pull-back of 8.5 u at every sample of the
  pause), never snaps, and a cancel arriving after the model has already paused costs at most the part of the pause reached
  (bounded by 4 steps, never a snap). Browser measurement on the real Web build (`client-unity/UnityProject/Tools/pause-proof.cjs`, `--first-playable` server, 24 left-click shots while walking, pull-back = summed model-versus-server error in the 1.2 s after each press; the walk-only baseline is 0.15 u): **bow, mirror on: median 34.1 u per shot (max 53.3); mirror off (`?pausepredict=0`): median 34.0 u (max 34.5)**, i.e. unchanged, as designed (no bow fact is delivered: 0 `Windup` fx seen). **The wand could not be measured in the browser**: no wand lies on the floor of the `--first-playable` map, and the practice room that has one needs the PostgreSQL-backed account service; the wand result rests on the Rust-vector replay above.

**To confirm (packets P-UNITY-1/P-NET-1):** fresh current-source Web build, full browser matrix, flows, verified narrow
prediction, frame time/loading/memory. The owner selected M5 Pro initially and requests maximum sustainable frame rate,
not a 60 FPS stopping goal; Rust simulation/parity/headless completion comes before further visual expansion.
