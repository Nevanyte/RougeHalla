# client-unity: Roguehalla Unity (Web) client

Client for the Rust authoritative server (`crates/rh-server`), speaking rh-protocol v10 (`crates/rh-protocol`, golden vectors in `protocol/fixtures/v10.json`, [ADR 0018](../docs/adr/0018-keyed-state-protocol-v6.md); a snapshot carries `tick` only and `Snapshot.ServerMs` is derived as `Tick * 50`; remote actors arrive quantized, see `Quant`; snapshots arrive as Full frames and deltas against the last one received, which `SnapshotTracker` applies, and `Session` asks for a Full one with `Resync` when it refuses a delta).

The first-playable profile is documented in [maps/README](../maps/README.md). Start `rh-server --first-playable`,
serve `UnityProject/Build/Web`, and use `?server=ws%3A%2F%2F127.0.0.1%3A7777%2Fws` locally. Ordinary visits show the
nickname/faction menu; explicit `?profile=` keeps automated autojoin, overridable with `?auto=0`. The Web build must
bake the server's current content hash through `UnityProject/Tools/build-web.sh`. Prepare fonts once using
`Roguehalla.Editor.RhBuild.PrepareUiResources` without `-quit`; the method exits batch mode after import completes.

The functional proof command is `node client-unity/UnityProject/Tools/playable-web.cjs` after starting the matching
server/Web build (its `RH_UNITY_PLAYABLE_*` variables select endpoints). Exit0/PASS requires all15 outcomes; an ordinary
run without an actual reward choice, result or visible mob is INCOMPLETE/exit2. An observed failure/decoder/runtime
error is FAIL/exit1. Coverage-contract checks run separately without a browser using
`node --test client-unity/UnityProject/Tools/proof-contract.test.cjs`.

[Actual browser proof and screenshots](../docs/evidence/first-playable-unity/INTEGRATION.md) ·
[M5 Pro baseline](../docs/evidence/first-playable-performance/README.md) · [asset provenance](THIRD_PARTY_ASSETS.md).

## Layout

| Path | What | Status |
|---|---|---|
| `RoguehallaNet/` | `netstandard2.1`, C# 9 library: `Protocol/` (byte-exact wire mirror, map blob), `Net/` (SnapshotBuffer, RenderClock, LocalMotion, InputSender, ClockSync, Session, ITransport). No engine, reflection, serializers, threads or `unsafe`. | built and tested |
| `RoguehallaNet.Tests/` | NUnit (net8.0): golden vectors, malformed frames, session/recovery and authoritative presentation, probe transport, Unity-copy drift check | 267 tests pass |
| `RoguehallaNet.Probe/` | console client over `ClientWebSocket` | built; current protocol tests pass; historical real-server protocol-4 runs are recorded below |
| `UnityProject/` | Unity6 Web client (WebSocket bridge, authoritative HUD, input, batched world views, menu/results, editor build menu) | 6000.0.85f2 Editor/Web build and actual Chromium full MVP loop verified; Calgary practice-domain loop verified; full browser matrix remains open |
| `sync-net.sh` | copies the library sources into `UnityProject/Assets/RoguehallaNet/` (`--check` verifies) | works |

## Library: build and test

```
export PATH=/root/.dotnet:$PATH            # .NET 8 SDK
dotnet test client-unity/RoguehallaNet.Tests
client-unity/sync-net.sh                    # after ANY change under RoguehallaNet/Protocol or Net
```
`dotnet test` fails if the Unity copy is stale. The dotnet library is the source of truth; never edit `Assets/RoguehallaNet/*.cs`.

## API for client presentation and input

HUD, view and input scripts are written against `Net/` only: `Session` (state, `Me`, `Snapshots.Sample`, `Clock`, `Motion`, `Input`, `OrderMove`), `SelfView` (the local player: one owned object the session overwrites per applied snapshot, so it never aliases a recycled snapshot and makes no garbage), `InterpActor` (a remote actor at the render time) and the typed codes `ActorStatus`, `FactionId`, `WeaponId` (`Net/Views.cs`; a value outside the named ones is a newer server's, so cast and never assume).

**`Protocol/*` is the codec layer, mostly internal to the netcode.** `Net/` owns the self and actor views (`Session.Me` / `SelfView`, `InterpActor`, `ActorStatus`, `FactionId`, `WeaponId`): a protocol change to snapshots is absorbed there. `ServerMsg`, `ClientMsg`, `WireSelf`, `WireActor`, `Session.Latest` and the `SnapshotReceived` payload are recycled once they leave the 40-snapshot buffer and change with every protocol bump, so scripts must not hold them. Known exceptions, which have no `Net/` view yet and are the only codec types scripts may import (`using Roguehalla.Net.Protocol;`): `MapBlob` (and its tile constants; `ArenaView.Build`), `RejectCode` (`MatchClient` logs it), `Session.Welcome`, `Session.LastResult` (`WireResult`) and the `EventsReceived` / `FxReceived` events (raw `ServerMsg.Events` / `ServerMsg.Fx`). A wire change to the map, events, fx or results is therefore NOT absorbed in `Net/` yet; owned views for them are future work.

`Session.Input.Swap(slot)` (null toggles) and `Session.Input.Pickup(handle)` queue normal validated inputs in order. The current combat protocol carries these commands; visible item discovery, owner inventory and the selected MVP HUD are implemented. `Session.Collections` retains all seven reliable views; missing retains and empty clears. `Choose`, `UseConsumable`, `Target` and `AttackMove` queue normal user intents. Remaining content stays in the backlog. Scripts must not obtain pickup targets from privileged simulation state.

`SelfView.HpPct` rounds half up (the old `ArenaView` used banker's rounding), caps at 100, and is 0 for a non-finite Hp: a cosmetic HUD difference only.

Unnamed `RejectCode` values are legal: a newer server may refuse for a reason this build has no name for, which ends the session as `Rejected` with `RejectCode` set to the raw value (`(ushort)code`, `Enum.IsDefined` false) and `RejectReason` holding the server's text. A Hello string (build, profile) over 255 bytes, or an admission ticket (`SessionOptions.Ticket`, opaque bytes, at most `Wire.MaxTicket`) over its bound, is never cut: the encoder throws `EncodeException` and the session fails with that reason. The probe's `--token` is sent as the ticket's UTF-8 bytes.

## Probe

```
dotnet run --project client-unity/RoguehallaNet.Probe -- --url ws://127.0.0.1:7777/ws --profile probe1 --token t1 --seconds 10 \
    [--content-hash <u64>] [--faction 0..4] [--insecure]
```
Sends Hello (protocol 9; content hash 0 means "ask": a `ContentMismatch` reject is printed with the server's reason), a Ping per second and a Move order every 500 ms, then prints one JSON line
`{welcome, snapshots, lastTick, deltasRefused, resyncsSent, rttMsP50, rejects, resultSeen, errors}`. Exit codes: 0 clean, 1 errors or no Welcome, 2 usage, 3 rejected. `--insecure` accepts a self-signed certificate for `wss://` (local testing only). Run against the real Rust server (the P10c run, protocol 3; a v4 run at `b0b2bb3` gave 118 and 158 snapshots, no refused delta, no errors): 157 snapshots in 8 s (1 Full, 156 deltas by the server's counters), no refused delta, no Resync, no errors.

## Unity: status and steps

**Editor and IL2CPP/WebGL build verified on Unity 6000.0.85f2 (b028303d8e7d), macOS arm64.** The selected MVP match loop is playable in Chromium: menu, combat/mobs, loot, potion and chest choice, results, reconnect and fresh rejoin. Broader content and the full browser matrix remain in the backlog. The first import exposed an invalid unused dependency, `com.unity.modules.clothing`, which prevented package resolution and was removed. Unity resolved URP 17.0.4, Input System 1.20.0, Test Framework 1.6.0 and uGUI 2.0.0; `Packages/packages-lock.json` now records the full graph. The provisional versions were URP 17.0.3, Input System 1.11.2 and Test Framework 1.4.5. The Pipeline package is local Editor tooling, version 0.10.0-exp.1. Unused direct AI, Android JNI, Director, terrain, tilemap, analytics, vehicles, video, wind and XR modules were removed through the Editor Package Manager API. No build-size improvement is claimed without a comparison.

The Editor generated the tracked `.meta` files, Main scene, URP pipeline/renderer/global settings, and project settings. Preserve their GUIDs. The Input System backend is enabled, and the URP asset is assigned. The scene remains empty by design: `Bootstrap` creates the camera and match presentation at runtime.

Local reproduction (Unity Personal or another valid existing license, plus Web Build Support required):

1. Start the Rust server from the repository root: `cargo run -p rh-server -- --first-playable --bind 127.0.0.1:7777 --min-players 1 --fill-bots 4 --lobby-seconds 5 --fill-seconds 3`.
2. Close this project's Editor before a batch build. Run `client-unity/UnityProject/Tools/build-web.sh`. It obtains the authoritative hexadecimal `contentHash` from `/info`, generates `Assets/Scripts/BakedContent.cs` **before** compiling, resolves the pinned installed Editor and invokes `RhBuild.BuildWeb`. `RH_SERVER_INFO_URL`, `RH_UNITY_EDITOR` and `RH_UNITY_BUILD_LOG` may override the local defaults. To update only the hash before using the Editor menus, append `--prepare-only`.
3. Serve the output: `python3 -m http.server 8080 -d client-unity/UnityProject/Build/Web`.
4. Open `http://localhost:8080/?server=ws://127.0.0.1:7777/ws` and join through the menu. Explicit `profile`, `token` and `faction` query parameters remain available for local automation; omit `profile` for the normal menu. The optional `hash=<decimal-u64>` override exists for local diagnostics; a normal build uses the generated exact server identity. Rebuild whenever Rust content changes.
5. For HTTPS hosting, the server connection must use `wss://`. `rh-server --self-signed` is for local testing with an explicitly trusted/accepted local certificate; publicly trusted TLS remains a hosting requirement.

The build uses WebGL2, disabled compression and no threads. `RhBuild.BuildWeb` throws when Unity reports failure so batch builds cannot silently succeed. Current inputs are WASD/arrows or right-click movement, left-click attack (wand uses the delivered target handle), Shift+click attack-move, 1/2 or Q swap, F pickup/open and E potion. HUD buttons issue the same ordinary inputs and block clicks from reaching the arena. Results support leaving and a fresh join.

Current evidence: [first playable Unity browser](../docs/evidence/first-playable-unity/INTEGRATION.md) and [M5 Pro runtime baseline](../docs/evidence/first-playable-performance/README.md). The measured uncompressed Web tree is55,836,754 bytes. Actual Chromium exercises the MVP loop against Rust with zero decoder/page errors. The [Calgary practice-domain proof](../docs/evidence/first-playable-calgary/README.md) now verifies public TLS/DNS and the same MVP loop. Full browser matrix, adaptive quality and further loading optimization remain open. The [earlier bootstrap](../docs/evidence/stage2-unity/README.md) records its own historical build and local WSS checks.

### Browser and AOT constraints
- WebGL is single threaded: no `Thread`, and the code never needs `Task` on the hot path. `Session.Update()` is polled from `MatchClient.Update`.
- `System.Net.WebSockets`/`Sockets` do not work in the player. `WebGLTransport` + `RhWebSocket.jslib` use the browser `WebSocket` (binary, `arraybuffer`) and queue frames that C# drains each frame (no JS-to-C# callbacks). `NativeTransport` is compiled out of WebGL player builds.
- IL2CPP stripping: the library uses no reflection, so no `link.xml` is needed. If reflection is ever added, add one.
- `Shader.Find` needs the shader kept in the build: `Assets/Resources/Shaders/RhVertexColor.shader` lives in a Resources folder for that reason.
- WebGL2 is the baseline; WebGPU is optional and experimental in Unity 6, not used.
- Brotli/Gzip builds need `Content-Encoding` headers from the host; threaded builds need COOP/COEP. The build script avoids both.

## Presentation and prediction boundary
- **Remote actors**: drawn 70-150 ms in the past (start 100, follows snapshot jitter), linear interpolation, newest held when starved, no extrapolation. Render time never runs backwards (slows to 80%, catches up at 1%, only jumps forward).
- **Local player**: `LocalMotion` currently presents confirmed server self coordinates directly. Orders transmit normally;
  frame stepping runs no movement or collision calculation. Newer authoritative positions apply even while an order is
  unacknowledged, and accepted self absence clears the local view. Movement can look stepped at the server cadence until
  presentation interpolation or verified prediction is completed.
- The unverified straight-line/wall-slide prototype was removed. Narrow local movement prediction remains P-NET-1: mirror
  Rust, verify Rust-produced vectors, always accept server correction, and never use this client code in headless runs.
- Stale/duplicate Full frames cannot replace the delta base or rewind Latest/Me/Motion. A requested same-tick Full can
  repair that base and replace the newest sample without adding a clock sample; ordinary duplicates remain ignored.
- Order sequences are 1..255 (0 is `move_seq` before any order). Aim is limited to 40/s, 16 commands per frame.

## Historical protocol-5 Web verification

The earlier IL2CPP/WebGL player at protocol 5/content `b0b7169709bd0a83` compiled and passed Chromium WS/local WSS
movement checks; see [its exact build evidence](../docs/evidence/stage2-unity-v5/README.md). That historical checkpoint
is superseded by the current protocol6 MVP build and267 C# tests linked above. [Performance evidence](../docs/evidence/stage2-unity-perf/README.md) preserves baseline-only measurements and a
deferred, inactive instancing patch. Remaining content and visual polish follow the current milestone scope.
