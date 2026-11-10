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
- **Amendment 2026-11-10 (owner-approved: attack movement pause; bow added the same day).** The one prediction exception now also
  mirrors the server's attack pause, and nothing else about attacks. Rust rule (`crates/rh-sim/src/systems/weapons.rs`,
  `move_multiplier`): the step ending at tick `T` does not move the owner while a swing winds up, from `RANGED_RELEASE_PAUSE_MS`
  (200 ms) before a bow or wand shot lands (`T >= landsAt - 200`) until it lands (weapons run before movement in a tick, so
  `T < landsAt`, with `TIE_EPS_MS` for a landing on a step), and while `root_until` holds. `LocalMotion` mirrors the first two **from
  delivered facts only**, never from a key press:
  - **Wand and swings:** the owner's `Windup` fx (the tick it was sent in plus its whole-millisecond wait is the landing).
    Ended early by the owner's `Stagger` fx (the stagger's own tick is still stopped) and `Cancel` fx (the step before the cancel's tick
    is the last stopped).
  - **Bow:** the sim announces no fx for a bow draw, so the landing is derived from the **owner block** (`draw_started_at`,
    `ready_at`, both u32 server ms): `interval = (ready_at - draw_started_at) / 1000` and
    `landsAt = draw_started_at + 1000 * min(BOW_WINDUP_MAX_S, BOW_WINDUP_INTERVAL_SHARE * interval)` (rh-sim `player_timings`), then the same
    last-200 ms release pause as the wand. A new nonzero `draw_started_at` is a new draw; the clock returning to 0 before the shot lands
    is a cancelled draw (the pause ends the step before). A stagger does not cancel a draw (rh-sim `stagger_cancel` skips
    `Draw` and emits no fx for it), so a bow window ignores the `Stagger` fx. If the owner's windup mirror is above 1 the
    wait is scaled by a rule the client does not hold, so that draw is left unpredicted. Nothing else about bows is mirrored (no
    damage, no charge rule).
  - **Both:** a stun bit or a weapon change in the self block ends the pause (the step before that sample).
  The client's new rule constants are `RangedReleasePauseMs = 200`, `TieEpsMs = 1e-6`, `BowWindupMaxS = 0.5` and
  `BowWindupIntervalShare = 0.55` (`TickMs` and `PlayerSpeed` were already mirrored), each pinned to the Rust value by the fixture. The window is
  kept in server time and mapped onto the model clock through the sample stamp and the measured order delay reconciliation already uses,
  so the walk stops exactly where the server's does (the walk is integrated over the part of each frame outside the window). Server
  correction is unchanged and authoritative; headless and policy runs never build a `LocalMotion`. **Not mirrored:** roots, slows,
  terrain, a draw under a windup scale above 1, and any attack-speed buff the interval does not already carry. A player's melee
  swing has no wind-up, so nothing changes for melee. **Proof (C-PARITY):** `protocol/fixtures/ranged_pause_v2.json`, written by
  `crates/rh-parity/tests/ranged_pause_golden.rs` from the real sim (`RH_WRITE_FIXTURES=1`; the test fails if the file is not what the
  current core produces): per 50 ms tick the server's position and whether the step moved, the owner block as delivered, the
  server's own `lands_at`/`draw_started_at`/`ready_at`, and the owner-visible fx; wand single, held, cooldown-rejected, staggered
  before and inside the pause, swap; bow single, held (4 draws), three factions (intervals 0.28 s, 0.54 s, 0.85 s and 1.14 s, the last
  on the 0.5 s cap), cooldown-rejected, staggered mid-draw (no fx, pause untouched), swap mid-draw and early in the draw; sword. The Rust test
  checks the derived bow landing against the server's on every draw (146 rows, worst error 0.711 ms, the u32 truncation of the two
  clocks). `client-unity/RoguehallaNet.Tests/RangedPausePredictionTests.cs` checks that the mirror stops exactly the steps the server stopped on every
  case, and replays the cases through `Session` with link latency: with the mirror the drawn walk equals the zero-latency server
  timeline to 0.01 u at 0 to 150 ms RTT for wand and bow (without it: 23 to 32 u, a model-vs-server pull-back of 8.5 u at every sample of
  the pause), never snaps. A cancel arriving after the model has already paused (a swap or stagger on a slow link) costs at most the part of
  the pause reached (bounded by 4 steps; for a mid-draw swap 22 u at 100 ms RTT against 8.5 u unpredicted), never a snap. Not vector-proved: the
  stun bit and the `Cancel` fx timing (no stun or order-cancel can be produced from `rh-parity` without editing `rh-sim`); an
  attack-speed modifier (only faction rates reach the interval from `rh-parity`). Browser measurement on the real Web build (`client-unity/UnityProject/Tools/pause-proof.cjs`, `--runtime source-arena` on seed 1 with 7 bots, weapons picked up from the ground, left-click shots while walking, pull-back = summed model-versus-server error in the 1.2 s after each press; a shot counts only when the server's own fact for it arrived (bow draw in the owner block, wand `Windup` fx); "clean" = no damage taken over the window; "walking" = the server position moved before and after the press; walk-only baseline 0.0 to 0.9 u). **Bow, 40 shots each, 31 to 32 walking:** mirror off (`?pausepredict=0`) median 34.0 u per shot (mean 32.1, max 84.7; walking and clean: median 34.0, mean 33.9); mirror on median 0 (mean 0.82, max 17.0; walking and clean, n=24: median 0, mean 1.3). Clean shots: 39 of 40 off, 29 of 40 on (the rest were hurt by a bot; they are included in the first figures and pull back no more). **Wand, 40 shots on, 29 off:** off median 34.2 u (mean 37.7; walking and clean, n=15: median 34.2, mean 40.0; one 137 u outlier with a snap); on median 0.17 (mean 4.35, max 43.9 from standing or blocked presses; walking and clean, n=15: median 0.17, mean 0.9, max 5.6).

**To confirm (packets P-UNITY-1/P-NET-1):** fresh current-source Web build, full browser matrix, flows, verified narrow
prediction, frame time/loading/memory. The owner selected M5 Pro initially and requests maximum sustainable frame rate,
not a 60 FPS stopping goal; Rust simulation/parity/headless completion comes before further visual expansion.
