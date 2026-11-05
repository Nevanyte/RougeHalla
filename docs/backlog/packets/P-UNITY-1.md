# P-UNITY-1: open the Unity project, first Web build against `rh-server`

## ID and outcome
P-UNITY-1. The Unity project in `client-unity/UnityProject` compiles in the Editor on the exact Unity 6 LTS patch the team
chooses, builds for WebGL, and a browser tab running that build plays a match against `rh-server` over `wss://` (join, map,
move, attack, result). The browser matrix (Chrome, Firefox, Safari, Edge), frame time, memory and download size are measured
and written down; adaptive quality tiers exist. This is the first time the Unity code is compiled: everything under
`UnityProject/` except the copied library sources is unverified.

## Dependencies
None in the repo. External gate: a Unity Editor + licence (Unity 6 LTS, WebGL module) and, for Safari, a Mac. The server side
needs nothing new (`cargo run -p rh-server`). Visual direction ([../../VISUAL_DIRECTION.md](../../VISUAL_DIRECTION.md)) is **not** a dependency: use the existing colored primitives; only its quality tiers (Low/Medium/High) and the list of budgets to establish are inputs here.

## Relevant legacy paths (verified)
- Current state: `client-unity/README.md` (status table, "Unity: status and steps", prediction scope), `docs/adr/0008-unity-client.md` (Provisional), `client-unity/UnityProject/ProjectSettings/ProjectVersion.txt` (`6000.0.23f1`, a **provisional** patch), `Packages/manifest.json` (URP 17.0.3, Input System 1.11.2, Test Framework 1.4.5, uGUI 2.0.0 are provisional; the manifest also lists ~30 `com.unity.modules.*` including xr, vehicles, terrain, unityanalytics: trim those not needed to reduce build size).
- Unity sources: `Assets/Scripts/{Bootstrap.cs,Net/{MatchClient,NativeTransport,WebGLTransport,TransportFactory}.cs,View/{ArenaView,ActorView,MeshUtil}.cs,Roguehalla.Client.asmdef}`, `Assets/Editor/{RhBuild.cs,Roguehalla.Editor.asmdef}`, `Assets/Plugins/WebGL/{RhWebSocket.jslib,RhPage.jslib}`, `Assets/Resources/Shaders/RhVertexColor.shader`. The `RoguehallaNet` library is copied into `Assets/RoguehallaNet/` by `client-unity/sync-net.sh` (never edit the copy).
- Legacy client for behaviour reference (not to port here): `packages/client/src/main.ts`, `scenes/RaidScene.ts`, `net/connection.ts`. Legacy performance reference: 144 fps, p99 8.6 ms, ~35 draw calls in Chrome on a 144 Hz window with 8 players (docs/legacy/CLAUDE_LEGACY.md "Frame rate").
- Proof harness to reuse: `tools/browser-proof/proof.mjs` (Chromium over WSS using the browser's WebSocket) and `GET /probe` page served by `rh-server`.

## New paths
`client-unity/UnityProject/Assets/Tests/` (EditMode/PlayMode asmdefs), `client-unity/UnityProject/Packages/packages-lock.json`, `ProjectSettings/*` Unity writes, `.meta` files (Unity generates them: commit them, this is the first time), `client-unity/BUILD_REPORT.md` (the measurements), `tools/browser-proof/unity-proof.mjs` (to be created by this packet: drives a built Web build in headless Chromium).

## Exclusive write scope
`client-unity/UnityProject/**` (except `Assets/RoguehallaNet/*.cs`, owned by `sync-net.sh`), `client-unity/README.md`, `client-unity/BUILD_REPORT.md`, `docs/adr/0008-unity-client.md` (status line and "confirmed" values, coordinator reviews), `tools/browser-proof/unity-proof.mjs`. Library changes under `client-unity/RoguehallaNet/**` are allowed only for compile fixes and need `dotnet test` + `sync-net.sh` (and the protocol golden vectors must stay byte-identical).

## Contracts and references
C-NET (protocol v4 and its C# mirror; the content hash in Hello must match or the server refuses: `ContentMismatch`), C-MAP (the Welcome carries the map blob), C-OBS, ADR 0002, 0003, 0008. Prediction scope in `client-unity/README.md` (walk only; remote actors interpolated 70-150 ms in the past).

## Behaviour to preserve
- The wire (`RoguehallaNet/Protocol`) is the contract; do not hand-edit it to make Unity compile, fix call sites instead. Admission order and refusal reasons: `docs/CONTRACTS.md` C-NET.
- WebGL constraints (from the README): single thread, no `System.Net.Sockets`; the transport is `WebGLTransport` + `RhWebSocket.jslib` (frames queued by JS, drained by C# each frame; no JS->C# callbacks); `NativeTransport` compiled out of WebGL; `Shader.Find` needs the shader in `Resources/`; build settings from `RhBuild.cs`: Compression Disabled, threads off, WebGL2. An HTTPS page can only open `wss://`: use `--self-signed` locally (the proof harness accepts it) and a real certificate on staging (P-HOST-2).
- Controls today: WASD move, right-click move, left-click attack toward the cursor. URL parameters: `?server=wss://host/ws&profile=name&token=secret[&hash=<u64>&faction=<0-4>]`.
- Remote smoothing: render clock starts 100 ms, follows jitter between 70 and 150 ms, never runs backwards; local walk prediction is straight-line + slide until P-NET-1 ports A*.

## Acceptance checks
1. Editor opens with zero compile errors on the chosen patch; record the **exact** patch (`ProjectVersion.txt`, `m_EditorVersion`) and the exact package versions Unity resolved (`packages-lock.json`); update `manifest.json` accordingly and say which ones changed from the provisional list.
2. `Roguehalla > Create Main Scene` and `Roguehalla > Build Web (WebGL)` succeed; the build runs from `python3 -m http.server` (http, `ws://127.0.0.1`) and from HTTPS with `wss://` to `rh-server --self-signed` or a trusted certificate.
3. The client sends the server's exact content hash (`rh_sim::content::content_hash()`, served at `GET /info` as `contentHash`): bake it into the build from the Rust side (a generated C# constant), never hard-code 0 (the server refuses a mismatch with `ContentMismatch`).
4. A two-player match (two tabs, or one tab + the `RoguehallaNet.Probe`) completes: join, Welcome with map, move acknowledged, attack lands, `Resolved` shown. Evidence: console log + screenshot per browser.
4. Browser matrix: Chrome, Firefox, Safari, Edge each run the same scenario; record versions, pass/fail, and any WebGL2/audio/WebSocket anomaly. Safari throttles `requestAnimationFrame` to 60 fps unless a developer option is set; record it.
5. Budgets, measured and written to `BUILD_REPORT.md`: download size (compressed and uncompressed, `Build/Web`), first-frame time, steady frame time p50/p99, JS heap + WASM memory after 5 minutes, GC allocations per frame in steady state. The owner selected Apple M5 Pro initially and updated `docs/REQUIREMENTS.md` R-WEB-3 on 2026-11-05 to pursue the highest sustainable frame rate with intended quality intact. Record CPU/GPU frame times separately from browser/display limits, plus download size, first frame, memory and draw calls. Establish measured budgets and explain tradeoffs in the report; 60 FPS is not the stopping goal.
6. Adaptive quality tiers per VISUAL_DIRECTION (Low: 1x resolution, no post, minimal particles; Medium; High; Low is the accessible tier and every tier keeps all essential gameplay indicators; no effect may reveal a hidden actor), selectable by URL and switched automatically from a frame-time moving average, with hysteresis; document triggers; a test that the switch logic is deterministic (pure C# unit test in `RoguehallaNet.Tests` or a PlayMode test).
7. `dotnet test client-unity/RoguehallaNet.Tests` still passes (71 tests) and `client-unity/sync-net.sh --check` is clean.

## Validation commands
- `export PATH=/root/.dotnet:$PATH; dotnet test client-unity/RoguehallaNet.Tests`
- `client-unity/sync-net.sh --check`
- `cargo build -p rh-server && cargo run -p rh-server -- --bind 127.0.0.1:7777 --self-signed --min-players 1 --fill-bots 1` (flags verified in `crates/rh-server/src/main.rs` header)
- `node tools/browser-proof/proof.mjs` (server + Chromium baseline; unchanged by this packet)
- Unity batchmode build: command line "to be created by this packet" (wrap `RhBuild.cs` as `-executeMethod`).

## Risk and suggested model tier
Medium risk with an external gate: Unity APIs (URP 17, Input System) changed between versions and none of this code has ever
been compiled. A strong builder with an Editor session; if only the CLI is available the packet is Blocked, do not guess fixes
blind. Keep fixes minimal and mechanical.

## Known traps
- **Unity code was written without a compiler.** Expect API drift (`Camera`, Input System enums, `Mesh` APIs, `UnityWebRequest` is unused) and WebGL IL2CPP stripping surprises; the library itself has no reflection.
- Do not commit `Library/`, `Temp/`, `Build/` (see `UnityProject/.gitignore`).
- `.meta` files: none are committed; generating them changes GUIDs, so commit them once and never regenerate.
- Never edit `Assets/RoguehallaNet/*.cs`; `dotnet test` fails if the copy is stale.
- The jslib bridge must not call back into C# per message (no `SendMessage` per frame); keep polling.
- The content hash and protocol version gate joins: when the server's `content_hash()` changes (any `rh-sim` content edit) the client must be rebuilt or it is refused.
- Brotli/Gzip builds need `Content-Encoding` headers from the host and threaded builds need COOP/COEP: the build avoids both; changing that is a hosting decision (P-HOST-5).
