# client-unity: Roguehalla Unity (Web) client, Stage 1

Client for the Rust authoritative server (`crates/rh-server`), speaking rh-protocol v4 (`crates/rh-protocol`, golden vectors in `protocol/fixtures/v4.json`, [ADR 0011](../docs/adr/0011-protocol-v4.md); a snapshot carries `tick` only and `Snapshot.ServerMs` is derived as `Tick * 50`; remote actors arrive quantized, see `Quant`; snapshots arrive as Full frames and deltas against the last one received, which `SnapshotTracker` applies, and `Session` asks for a Full one with `Resync` when it refuses a delta).

## Layout

| Path | What | Status |
|---|---|---|
| `RoguehallaNet/` | `netstandard2.1`, C# 9 library: `Protocol/` (byte-exact wire mirror, map blob), `Net/` (SnapshotBuffer, RenderClock, LocalMotion, InputSender, ClockSync, Session, ITransport). No engine, reflection, serializers, threads or `unsafe`. | built and tested |
| `RoguehallaNet.Tests/` | NUnit (net8.0): every golden vector round-trips byte for byte, malformed frames rejected, Net logic, Session with a fake transport, the probe against an in-process WebSocket server, Unity-copy drift check | 180 tests pass |
| `RoguehallaNet.Probe/` | console client over `ClientWebSocket` | built; tested against a fake server and run against the real server (protocol 3) |
| `UnityProject/` | Unity 6 project skeleton (WebGL jslib bridge, transports, `MatchClient`, views, bootstrap, editor build menu) | **NOT OPENED, NOT COMPILED, NO WEB BUILD** |
| `sync-net.sh` | copies the library sources into `UnityProject/Assets/RoguehallaNet/` (`--check` verifies) | works |

## Library: build and test

```
export PATH=/root/.dotnet:$PATH            # .NET 8 SDK
dotnet test client-unity/RoguehallaNet.Tests
client-unity/sync-net.sh                    # after ANY change under RoguehallaNet/Protocol or Net
```
`dotnet test` fails if the Unity copy is stale. The dotnet library is the source of truth; never edit `Assets/RoguehallaNet/*.cs`.

## API for gameplay code

Gameplay scripts (HUD, views, abilities, input) are written against `Net/` only: `Session` (state, `Me`, `Snapshots.Sample`, `Clock`, `Motion`, `Input`, `OrderMove`), `SelfView` (the local player: one owned object the session overwrites per applied snapshot, so it never aliases a recycled snapshot and makes no garbage), `InterpActor` (a remote actor at the render time) and the typed codes `ActorStatus`, `FactionId`, `WeaponId` (`Net/Views.cs`; a value outside the named ones is a newer server's, so cast and never assume).

**`Protocol/*` is the codec layer, mostly internal to the netcode.** `Net/` owns the self and actor views (`Session.Me` / `SelfView`, `InterpActor`, `ActorStatus`, `FactionId`, `WeaponId`): a protocol change to snapshots is absorbed there. `ServerMsg`, `ClientMsg`, `WireSelf`, `WireActor`, `Session.Latest` and the `SnapshotReceived` payload are recycled once they leave the 40-snapshot buffer and change with every protocol bump, so scripts must not hold them. Known exceptions, which have no `Net/` view yet and are the only codec types scripts may import (`using Roguehalla.Net.Protocol;`): `MapBlob` (and its tile constants; `ArenaView.Build`), `RejectCode` (`MatchClient` logs it), `Session.Welcome`, `Session.LastResult` (`WireResult`) and the `EventsReceived` / `FxReceived` events (raw `ServerMsg.Events` / `ServerMsg.Fx`). A wire change to the map, events, fx or results is therefore NOT absorbed in `Net/` yet; owned views for them are future work.

`SelfView.HpPct` rounds half up (the old `ArenaView` used banker's rounding), caps at 100, and is 0 for a non-finite Hp: a cosmetic HUD difference only.

Unnamed `RejectCode` values are legal: a newer server may refuse for a reason this build has no name for, which ends the session as `Rejected` with `RejectCode` set to the raw value (`(ushort)code`, `Enum.IsDefined` false) and `RejectReason` holding the server's text. A Hello string (build, profile) over 255 bytes, or an admission ticket (`SessionOptions.Ticket`, opaque bytes, at most `Wire.MaxTicket`) over its bound, is never cut: the encoder throws `EncodeException` and the session fails with that reason. The probe's `--token` is sent as the ticket's UTF-8 bytes.

## Probe

```
dotnet run --project client-unity/RoguehallaNet.Probe -- --url ws://127.0.0.1:7777/ws --profile probe1 --token t1 --seconds 10 \
    [--content-hash <u64>] [--faction 0..4] [--insecure]
```
Sends Hello (protocol 3; content hash 0 means "ask": a `ContentMismatch` reject is printed with the server's reason), a Ping per second and a Move order every 500 ms, then prints one JSON line
`{welcome, snapshots, lastTick, deltasRefused, resyncsSent, rttMsP50, rejects, resultSeen, errors}`. Exit codes: 0 clean, 1 errors or no Welcome, 2 usage, 3 rejected. `--insecure` accepts a self-signed certificate for `wss://` (local testing only). Run against the real Rust server (P10c, protocol 3): 157 snapshots in 8 s (1 Full, 156 deltas by the server's counters), no refused delta, no Resync, no errors.

## Unity: status and steps

**Not opened, not compiled, no web build.** Stage 1 had no Unity install or license. Everything under `UnityProject/` except the copied library sources (which compile in dotnet) is unverified. `Packages/manifest.json` and `ProjectSettings/ProjectVersion.txt` (`6000.0.23f1`) are **provisional**: package versions (URP 17.0.3, Input System 1.11.2, Test Framework 1.4.5, uGUI 2.0.0) and the editor patch must be confirmed by opening the project. No `.meta` files are committed; Unity generates them.

For a person with Unity 6 LTS (6000.0.x) and the WebGL module:
1. Open `client-unity/UnityProject` in Unity Hub. Let it resolve packages; accept the Input System backend switch if asked; fix any compile errors (expected on a first open) and update the manifest/version files.
2. Project Settings > Graphics: assign a URP asset (create one via Assets > Create > Rendering > URP Asset) as the default render pipeline asset. Project Settings > Player > Active Input Handling: Input System Package.
3. Menu **Roguehalla > Create Main Scene**, then **File > Build Profiles > Web**, switch platform. (`Roguehalla > Build Web (WebGL)` does the settings and the build to `Build/Web`: Compression Disabled, threads off, WebGL2.)
4. Serve `Build/Web` over HTTPS or localhost, e.g. `python3 -m http.server 8080 -d Build/Web`. Run the server: `cargo run -p rh-server -- --bind 127.0.0.1:7777` (add `--tls-cert/--tls-key` for `wss://`; an HTTPS page can only open `wss://`).
5. Browse to `http://localhost:8080/?server=ws://127.0.0.1:7777/ws&profile=name&token=secret[&hash=<u64>&faction=<0-4>]`. In the Editor, press Play: defaults to `ws://127.0.0.1:7777/ws` through `NativeTransport`. Controls: WASD move, right-click move, left-click attack toward the cursor.

### Browser and AOT constraints
- WebGL is single threaded: no `Thread`, and the code never needs `Task` on the hot path. `Session.Update()` is polled from `MatchClient.Update`.
- `System.Net.WebSockets`/`Sockets` do not work in the player. `WebGLTransport` + `RhWebSocket.jslib` use the browser `WebSocket` (binary, `arraybuffer`) and queue frames that C# drains each frame (no JS-to-C# callbacks). `NativeTransport` is compiled out of WebGL player builds.
- IL2CPP stripping: the library uses no reflection, so no `link.xml` is needed. If reflection is ever added, add one.
- `Shader.Find` needs the shader kept in the build: `Assets/Resources/Shaders/RhVertexColor.shader` lives in a Resources folder for that reason.
- WebGL2 is the baseline; WebGPU is optional and experimental in Unity 6, not used.
- Brotli/Gzip builds need `Content-Encoding` headers from the host; threaded builds need COOP/COEP. The build script avoids both.

## Prediction scope and limits
- **Remote actors**: drawn 70-150 ms in the past (start 100, follows snapshot jitter), linear interpolation, newest held when starved, no extrapolation. Render time never runs backwards (slows to 80%, catches up at 1%, only jumps forward).
- **Local player**: only the walk is predicted (170 u/s, radius 12, tiles != 0 block). Snapshots reconcile through a visual offset decaying with tau 100 ms; an error over 96 u snaps. Reconciliation is skipped while a move order's `move_seq` is unacknowledged (expires after 1 s). Attacks, damage, deaths and other players are never predicted.
- **Limitation**: the server walks an A* path (legacy `findPath`); this model walks a straight line and slides along walls, so around corners it diverges and the server corrects it. Porting `crates/rh-sim/src/pathfind.rs` is a later stage. The comparison uses a one-way latency estimate (`LocalMotion.LatencyMs`, default 50 ms) that is not yet fed from `ClockSync`; a wrong value shows up as a small steady correction.
- Order sequences are 1..255 (0 is `move_seq` before any order). Aim is limited to 40/s, 16 commands per frame.
