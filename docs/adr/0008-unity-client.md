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

**To confirm (packets P-UNITY-1/P-NET-1):** fresh current-source Web build, full browser matrix, flows, verified narrow
prediction, frame time/loading/memory. The owner selected M5 Pro initially and requests maximum sustainable frame rate,
not a 60 FPS stopping goal; Rust simulation/parity/headless completion comes before further visual expansion.

**Amendment (proposed, [ADR0024](0024-competitive-netcode-presentation-and-lag-fairness.md), owner direction 2026-11-09):** the
"do not predict attacks" rule now allows animation-only own-action feedback (the owner's attack clip, Wish telegraph and melee swing
sound at the click, driven by server-sent readiness) and presentation-only draw-ahead of remote players. No outcome, hit, damage,
projectile or cooldown is shown early, and Unity still holds no game rule.
