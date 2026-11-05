# P-UNITY-PERF-1: Unity client efficiency (instanced actors, allocation-free netcode, build size, GPU fill)

## ID and outcome
P-UNITY-PERF-1. The browser client stops paying per-actor GameObject costs and steady-state garbage: remote actors are drawn
with a handful of instanced draws instead of about 4 draw calls and 8 native transform calls each, the native `Mesh` leak on
every departure is gone, Fx frames nobody reads are no longer decoded into heap objects, the receive and send paths allocate
0 B per frame in steady state, the WebGL build ships compressed, and the GPU fill settings are set in code. Gameplay, the wire,
prediction scope, C-OBS and C-INPUT do not change: this is view, transport-contract and build-settings work.

**Owner decision (final efficiency review): the Unity optimizations are deferred to the later Codex stage. Nothing in this
packet is implemented yet.** It was written from the efficiency review so that stage starts from evidence.

## Evidence legend (read before trusting a number)
- **MEASURED (.NET)**: figures from a throwaway console harness that compiled the `client-unity/RoguehallaNet` sources into a
  net8.0 Release exe and ran them under the .NET 8 RyuJIT (tiered, PGO), median of many passes after warm-up, on a shared
  4-vCPU container. Timings are wall clock and noisy (about 10%). Allocation bytes are exact
  (`GC.GetAllocatedBytesForCurrentThread`). This is **not** IL2CPP/WebAssembly: expect IL2CPP-wasm to be a few times slower per
  op; the allocation figures carry over unchanged. Sources: the review profile of revision `ae0c37b` (protocol v3 at that revision; the library
  code is identical at `056bb31`) and, for the F2 per-item Fx figures, the efficiency review's own harness (`eff-client-fx`) at `056bb31`.
- **READ**: counted from the code (object, renderer and call counts). Exact for the code as written; says nothing about time.
- **ESTIMATE**: an expectation, not a measurement. **No Unity Editor was available**, so no Unity-side cost (draw calls,
  frame time, Mesh memory, download size) was measured. Every Unity item below must be sized by the profile this packet asks
  for, before and after, on the hardware named in P-UNITY-1.

## Dependencies
P-UNITY-1 (the Unity project has never been compiled or opened; F1, F3 and F5 need an Editor, a WebGL build and its
`BUILD_REPORT.md` baseline). F2 and F4 are library-only (`client-unity/RoguehallaNet`, `dotnet test`) and could land earlier, but
the owner has deferred the whole packet. The open follow-up for the capacity-sized `Actors` array
(`SnapshotTracker.CopyActorsTo`, listed under Follow-ups in [../../sweep/README.md](../../sweep/README.md)) is not part of this
packet; F4's 0 B steady-state assertion needs it (land it first or together).

## Relevant legacy paths (verified)
- Unity view: `client-unity/UnityProject/Assets/Scripts/View/{ArenaView,ActorView,MeshUtil}.cs` (`ActorView.Create`/`Part`,
  `ArenaView.Present`), `Assets/Scripts/Net/{MatchClient,WebGLTransport,NativeTransport}.cs`, `Assets/Scripts/Bootstrap.cs`,
  `Assets/Resources/Shaders/RhVertexColor.shader`, `Assets/Plugins/WebGL/RhWebSocket.jslib`, `Assets/Editor/RhBuild.cs`
  (`BuildWeb` sets `compressionFormat = Disabled`, `decompressionFallback = false`).
- Library: `client-unity/RoguehallaNet/Net/{Session,InputSender,SnapshotBuffer,RenderClock}.cs` (`ITransport` is declared in
  `Session.cs`), `Protocol/{Messages,Codec,SnapshotTracker}.cs`. Tests: `client-unity/RoguehallaNet.Tests/{GarbageTests,SessionTests,ProtocolVectorTests}.cs`.
- Existing docs: [../../../client-unity/README.md](../../../client-unity/README.md), [../../adr/0008-unity-client.md](../../adr/0008-unity-client.md),
  [../../VISUAL_DIRECTION.md](../../VISUAL_DIRECTION.md) (device pixel ratio up to 2x capped by a pixel budget; quality tiers).
- Legacy reference for behaviour only: `packages/client/src/scenes/RaidScene.ts`, `packages/client/src/render/*`.

## New paths
`client-unity/UnityProject/Assets/Scripts/View/ActorBatches.cs` (instanced remote-actor renderer; name indicative),
`Assets/Scripts/Net/ReplayTransport.cs` (an `ITransport` that feeds a recorded frame dump into `Session`), a committed version of
the profile's frame-dump generator (E-pub removed the `synthetic` feature; the crowd now comes from `wirebench --synthetic N` under the `bench` feature of `rh-server`; N = 8, 68, 204 fighters through
`Publisher::frames_in` and `ConnEncoder`), a minimal WebGL template under `Assets/WebGLTemplates/`, and the URP asset and
renderer data (created by `RhBuild` or committed). Results go into `client-unity/BUILD_REPORT.md` (owned by P-UNITY-1).

## Exclusive write scope
`client-unity/UnityProject/**` (except `Assets/RoguehallaNet/*.cs`, owned by `sync-net.sh`), `client-unity/RoguehallaNet/**`
and `client-unity/RoguehallaNet.Tests/**` (then `bash client-unity/sync-net.sh`), `client-unity/BUILD_REPORT.md` (append a
section), and a new file under `crates/rh-server/src/bin/` for the frame-dump generator behind the `bench` feature (no wire
code). Not in scope: `crates/rh-protocol`, `protocol/fixtures/**` (the wire is untouched; if a change seems to need a wire edit,
stop: it belongs to a protocol packet such as P-NET-3 or P-NET-7).

## Contracts and references
C-NET (wire v4 and its C# mirror stay byte-identical), C-OBS (nothing here may show an actor the observation did not send; the
camera cull only removes work for actors already visible), C-INPUT (the send path still goes through the `Session` input rate
limits), ADR 0008, ADR 0010, [../../REQUIREMENTS.md](../../REQUIREMENTS.md) R-WEB-3, VISUAL_DIRECTION budgets.

## Work items

### F1. Instanced remote-actor drawing (largest likely browser-CPU item; also fixes the Mesh leak)
- **Today (READ):** each remote actor is a root GameObject plus Body, Nose, BarBack, BarFill = 5 GameObjects, 4
  MeshFilter+MeshRenderer pairs and 4 freshly built `Mesh` objects (`ActorView.Create` :21-30), never shared. At 204 visible
  actors that is about 1020 GameObjects, 816 renderers and about 816 draw calls (272 at 68, 32 at 8) plus one for the map, and
  about 8 native transform calls per actor per frame (about 1600 per frame at 204) although snapshots arrive at 20 Hz. Every
  arrival costs 5 `new GameObject`, 9 `AddComponent`, 4 `new Mesh`, 12 `List`s and about 100 `Cos/Sin` calls.
- **Leak (READ):** `ArenaView.Present` :83 calls `Destroy(gameObject)` on departure, but the `Mesh` objects built in `ToMesh`
  are native objects that are not destroyed with it: 4 meshes leak per departure. In the 204-fighter stream there are about 0.15
  departures per snapshot, about 3 per second, so about 12 meshes per second (about 43k per hour); nonzero at 8 actors too, since
  vision (900 u) makes actors enter and leave. **ESTIMATE:** about 1.3 KB of vertex data each plus Mesh and GL-buffer overhead,
  roughly 50 MB per hour in a 204 crowd.
- **Why not just share meshes and pool views (correction to the profile's first suggestion; code evidence, not measured):**
  `RhVertexColor.shader` is SRP-Batcher compatible (`UnityPerMaterial` CBUFFER) and has no `#pragma multi_compile_instancing`.
  Under URP the SRP Batcher takes precedence over GPU instancing for GameObject renderers, and dynamic batching is off in URP
  assets by default, so shared-mesh GameObjects would still issue one GL draw per renderer through emscripten's JS GL layer.
  Explicit instanced draws are required. In WebGL every draw is a JS call, so draw count is the most likely CPU limit at crowd
  sizes (**ESTIMATE**: needs the WebGL profile to size).
- **Mechanism:** step 0 stopgap: `ActorView.OnDestroy` destroys the meshes it created (or use static shared meshes). Then, in
  `ArenaView.Present`, drop the GameObjects for remote actors. Build 8 shared meshes once (body disc per faction = 5, one nose,
  bar back and fill). Each frame walk the `Sample` output once; skip actors whose disc is outside the orthographic camera
  rectangle plus one radius (a 2D test; this removes the off-screen per-frame work, since the server sends everything within
  900 u while the camera shows about 512 x 288 u); append a hand-written `Matrix4x4` per instance (translation, rotation about Y
  for the nose from the same `Atan2` as today, `scale.x` for the hp fill; no native `TRS` call); issue at most 8
  `Graphics.RenderMeshInstanced` calls with a `RenderParams` whose `worldBounds` is the camera rectangle. Add
  `#pragma multi_compile_instancing` and the `UNITY_VERTEX_INPUT_INSTANCE_ID` / `UNITY_SETUP_INSTANCE_ID` macros to the shader,
  and `material.enableInstancing = true`. The local player may stay a GameObject or become one more instance. Heights, and so
  draw order (body 0, nose 0.02, bars 0.03 and 0.04), are unchanged. The `ArenaView` API is unchanged, so `MatchClient` needs no
  edit.
- **Per-frame work (READ), part of this item:** `Present` does a `Dictionary.TryGetValue`, a `HashSet.Add` and three transform
  writes per actor (`position`, `_nose.localRotation = Quaternion.Euler(...)`, `_bar.localScale` get-modify-set), each crossing
  the managed/native boundary and invalidating 4 child transforms, then a second pass over the dictionary for stale ids. The
  instanced path removes the transform writes and the dictionary; if a GameObject path is kept for any part, write nose and bar
  only when the value changed.
- **Expected (counted, READ):** actor draws go from 4 per actor to 8 or fewer regardless of N; native transform calls from about
  8 per actor per frame to 0; arrivals and departures allocate nothing; the leak goes to 0. **ESTIMATE:** managed matrix writes
  about 816 x 64 B = 52 KB per frame, under 0.1 ms in wasm, against hundreds of removed emscripten GL calls.

### F2. Do not decode Fx frames that have no consumer
- **MEASURED (.NET):** `ServerMsg.Decode` on an Fx frame: 2 items = 22 B wire, 396 ns, 216 B allocated; 8 items = 72 B, 745 ns,
  592 B; 40 items = 344 B, 3.3 us, 3,096 B; 200 items = 1,797 B, 7.7 us, 13,896 B. So the Fx frame alone allocates about
  12 KB/s at 8 fx per tick and 278 KB/s at 200 fx per tick. The combined Events plus Fx path at N=204 is 9.4 us and 28 KB per
  frame (560 KB/s) in the review profile; events plus fx are also about 2/3 of the stream bytes at 204 (not delta coded).
- **READ:** `Session.OnReceived` raises `FxReceived` only if it is subscribed, and nothing subscribes (no `FxReceived` use in
  `UnityProject/Assets/Scripts`, the probe or the tests): every `WireFx` (a 48 B class), the `List` growth and the `Fx` object
  are garbage at once.
- **Mechanism:** in `Session.OnReceived`, when `frame[0] == 0x85` and `FxReceived == null`, call a new allocation-free
  `ServerMsg.ValidateFx(frame, length)`: the same `Reader` walk as the `TFx` case (tick varint, the count check against
  `ushort.MaxValue`, tag 1/2 bodies, the trailing-bytes check, the same `DecodeException`) but building nothing; then return,
  counting `DecodeErrors` and `Ignored` (an Fx frame before InMatch or Ended) exactly as today. When a view starts consuming Fx (swing and hit visuals, P-UI-7), decode into a
  Session-owned `FxBatch` (struct `WireFx[]` plus `Count`, reused like `SnapshotDelta.Changed`), valid only during the callback.
  `ServerMsg.Decode` stays for the vectors and the probe. Events frames are rare and may stay as they are.
- **Expected:** the MEASURED cost removed (216 to 13,896 B per frame); **ESTIMATE:** the validating walk keeps about a third of
  the decode CPU.

### F4. Allocation-free steady-state receive and send path
- **MEASURED (.NET), exact bytes:** `Session.Update` per render frame with no input 34 B (the `new List<ClientMsg.Input>()` in
  `InputSender.Flush`, 32 B, plus foreach), constant: 2 KB/s at 60 fps; Move+Flush 256 B; Aim+Flush 80 B; `Ping.Encode` 72 B;
  `Input` (1 move) `Encode` 80 B (a `Writer` plus its buffer per message). `Session.OnReceived` steady 3,893 B per snapshot at
  N=204 (mostly the exact-length `Actors` reallocation, the separate open follow-up).
- **READ:** `WebGLTransport.Poll` (:63-77) does `new byte[got]` plus `Buffer.BlockCopy` per received frame after the jslib has
  already copied into the staging `_rx` (`RhWs_NextLength`, `RhWs_Receive` with `HEAPU8.set`): about 92 KB/s at N=204 (from the
  profile's stream bytes), **ESTIMATE** 2 to 3 KB/s at N=8 (87 B per tick plus about 24 B of array header per frame).
  `RhWs_Send` does a `HEAPU8.slice` copy per send. The profile's total garbage is about 25 KB/s at 8 actors and 0.7 MB/s at 204.
  Unity WebGL's Boehm GC is non-generational, so allocation rate turns into pause frequency (**ESTIMATE**, needs the WebGL
  profile).
- **Mechanism:** change `ITransport` to `event Action<byte[], int> Received` (the buffer is valid only during the callback) and
  `Send(byte[] buf, int len)`; `WebGLTransport` passes `_rx, got` with no new array; the Native and Probe transports pass their
  own buffers; `Session.OnReceived` uses the length parameter instead of `frame.Length`. Add `ClientMsg.EncodeInto(Writer w)`
  over a Session-owned reusable `Writer` (keep `Encode()` for tests and vectors). `InputSender.Flush` fills a list it owns and
  reuses `ClientMsg.Input` objects, clearing their `Commands`. Optionally merge `RhWs_NextLength` and `RhWs_Receive` into one
  jslib call to halve the JS crossings (an idle `Poll` makes 2 jslib calls per render frame today).
- **Not a CPU item:** netcode CPU is small (MEASURED (.NET): about 0.46 ms of .NET time per second at N=204, 0.05% of a core;
  even at 10x for IL2CPP-wasm under 0.5%). The point is garbage, and a 0 B assertion that stays in CI.

### F3. WebGL build compression and size settings
- **READ:** `RhBuild.BuildWeb` sets `compressionFormat = Disabled` and `decompressionFallback = false`, its stated reason being
  plain static hosting with no `Content-Encoding` headers (repeated in `client-unity/README.md` and P-UNITY-1, which defers the
  choice to P-HOST-5). Unity's `decompressionFallback` exists for exactly that case: it embeds a JS decompressor and loads
  `.unityweb` files without the headers. `ProjectSettings` holds only `ProjectVersion.txt`, so managed stripping level, code
  optimization mode and wasm feature level are editor defaults. The manifest module trim is already in P-UNITY-1 and is not
  repeated here. No build has been made: **there is no byte count**.
- **Mechanism:** Gzip with `decompressionFallback = true` as the default for unknown static hosts; Brotli without the fallback
  behind a flag for hosts that serve `Content-Encoding` (P-HOST-5); set managed stripping to High explicitly (the library has no
  reflection; Input System ships its own `link.xml`); set the WebGL code optimization mode explicitly; try the Unity 6
  "WebAssembly 2023" feature set (native wasm exceptions instead of emscripten's JS exception emulation; `Session.OnReceived` and
  `Reader.Str` contain try blocks) after confirming the option exists on the pinned 6000.0 patch; keep data caching on.
- **ESTIMATE (typical for Unity WebGL, not measured here):** wasm plus data shrink about 3x with Gzip and 4x to 5x with Brotli over
  Disabled; High stripping and size optimization commonly another 10% to 30% of wasm; the fallback costs JS-side decompression at
  load (a few hundred ms for Gzip on desktop, more for Brotli, which is why Brotli is paired with real headers).

### F5. GPU fill settings in code
- **READ:** `client-unity/README.md` step 2 creates the URP asset by hand with editor defaults; no URP asset or renderer data is
  committed; `Bootstrap` creates a bare Camera; `RhBuild` sets no WebGL template, so the default template keeps the canvas at the
  full `window.devicePixelRatio` (its own comment suggests `config.devicePixelRatio = 1` for mobile). VISUAL_DIRECTION already
  states "device pixel ratio up to 2x, capped by a pixel budget" but nothing enforces it. `Cull Off` in the shader doubles
  rasterisation only for back faces the top-down camera never sees (negligible).
- **Mechanism:** create the URP asset and renderer from `RhBuild` (or commit them) with HDR off, MSAA off or 2x, post-processing
  off, depth and opaque textures off, render scale 1, so URP renders straight to the backbuffer with no final blit; set the
  camera's `UniversalAdditionalCameraData` explicitly (`renderPostProcessing = false`, no depth or opaque texture requests);
  commit a minimal WebGL template that sets `config.devicePixelRatio = min(window.devicePixelRatio, 2)` with a lower cap on a
  pixel budget.
- **ESTIMATE:** fragment and bandwidth cost scales with pixel count: a 3x-DPR display capped at 2x shades 2.25x fewer pixels, a 2x
  display capped at 1.5x shades 1.78x fewer; removing an HDR intermediate target saves one full-screen copy per frame (about
  33 MB of read plus write per frame at 3840x2160, from 4 B per pixel). Matters mostly on integrated GPUs and mobiles. Record
  HDR-off as a budget decision, not a permanent rule: VISUAL_DIRECTION lights and emissive accents may need it back.

## Behaviour to preserve
- Wire bytes identical: `protocol/fixtures/v4.json` untouched; the Rust, C# and JS vector tests pass unchanged.
- `Session` semantics: `Ignored` is counted exactly as today; a malformed Fx frame still counts in `DecodeErrors` and sets the same `Error`; send order and the
  `InputSender` rate limits are unchanged; prediction scope (walk only; remote actors interpolated 70-150 ms in the past) and
  interpolation output are unchanged.
- Visuals: same shapes, colours, heights and draw order; coplanar bodies of different actors already z-fight today (unchanged).
  The camera cull never hides an actor from game logic and nothing reveals an actor the server did not send (C-OBS).
- The WebGL constraints in P-UNITY-1 hold (single thread, polling transport, no per-message JS to C# callbacks). Brotli or Gzip
  without the fallback needs host headers (P-HOST-5); the default stays a build that works on plain static hosting.

## Acceptance checks
1. F1: with the `ReplayTransport` feeding recorded N = 8, 68 and 204 streams in a WebGL development build, actor draw calls
   (ProfilerRecorder "Draw Calls Count" and "SetPass Calls Count") are 8 or fewer at every N; the `Mesh` object count (Memory
   Profiler) is constant over 5 minutes of the N=204 replay; a side-by-side pixel compare of the same replay frame at N=8, before
   and after, shows no difference beyond the intended culling of off-screen actors.
2. F2: a `GarbageTests` case drives a `Session` InMatch on a fake transport with 1,000 Fx frames of 8 and of 200 items and
   asserts 0 B from `GC.GetAllocatedBytesForCurrentThread` after warm-up; a `SessionTests` case feeds every `malformedServer` Fx
   vector in `v4.json` and asserts `DecodeErrors`, `Ignored` and `Error` are identical with and without a subscriber.
3. F4: a whole-`Session` `GarbageTests` case replays a recorded N=8 stream (Full then deltas, events, fx) for 2,000 frames while
   calling `Session.Update` with Aim and Move each frame and asserts 0 allocated bytes after warm-up (needs F2 and the
   `CopyActorsTo` follow-up); `EncodeInto` equals `Encode()` byte for byte on every client vector in `v4.json` and on random
   Input frames.
4. F3: four variants built from `RhBuild` (Disabled; Gzip with fallback; Brotli; Brotli with High stripping and size
   optimization), each with `du -b Build/Web/Build/*`, transfer size and time to first frame (Playwright against
   `python3 -m http.server` with no headers, and against a host that sets `Content-Encoding`), and a successful InMatch on the
   replayed N=8 stream. The table goes to `BUILD_REPORT.md` and the default is chosen from it.
5. F5: a Spector.js capture shows no intermediate render target or final blit, and the draw count; frame time p50/p99 from the
   browser performance panel with DPR full against capped and HDR on against off, on the named P-UNITY-1 hardware plus one HiDPI
   laptop. No thresholds are invented here: record before/after and propose budgets for owner approval, as P-UNITY-1 does.
6. A per-frame record in `BUILD_REPORT.md` (before and after each item, same hardware): PlayerLoop ms, `Camera.Render` ms,
   `Gfx.WaitForPresent`, GC allocated per frame, GC collections over 5 minutes, JS heap and WASM memory after 5 minutes.
7. `dotnet test client-unity/RoguehallaNet.Tests` and `bash client-unity/sync-net.sh --check` pass; the test count only grows.

## Validation commands
- `PATH=$HOME/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh`, then `bash client-unity/sync-net.sh --check`
- `cargo build -p rh-server && node tools/browser-proof/proof.mjs` (no wire change; confirms the transport contract end to end)
- Frame-dump generator, WebGL build, ProfilerRecorder and Spector.js runs: **commands to be created by this packet** (no Unity
  batchmode wrapper exists yet; P-UNITY-1 creates the `-executeMethod` wrapper for `RhBuild.cs`).

## Risk and suggested model tier
Medium. F2 and F4 are mechanical library work with byte-level tests (a strong builder, no Editor). F1, F3 and F5 need an Editor
session and a WebGL profile: URP 17 and Input System APIs drift, `Graphics.RenderMeshInstanced` and the instancing macros must
compile for WebGL2, and High stripping can remove something reached by reflection (found only at runtime in the build). If only
the CLI is available, do F2 and F4 and mark the rest Blocked; do not guess Unity fixes blind.

## Known traps
- Do not follow the profile's first suggestion (share meshes, pool views, expect batching): under URP the SRP Batcher wins over
  GPU instancing for GameObject renderers; only explicit instanced draws collapse the count. Sizing needs a Unity profile.
- Per-batch `worldBounds` is one box: do the CPU rectangle cull first or instances get culled together.
- A consumer that keeps the received buffer past the callback sees it overwritten once `Received` takes `(byte[], int)`;
  `Session` never does (decode copies into `Snapshot` objects), but document the rule on `ITransport`.
- Never edit `Assets/RoguehallaNet/*.cs`; `dotnet test` fails if the copy is stale.
- Exceptions on refused delta bursts, the `RenderClock` sort and the `as` cast chain in `OnReceived` were reviewed and left out as
  micro items (each below 0.1% of a frame at .NET speed); the capacity-sized `Actors` array is a Follow-ups row.
- `ProjectVersion.txt` pins `6000.0.23f1` provisionally; P-UNITY-1 fixes the exact patch. The WebAssembly 2023 option raises the
  minimum browser versions: record it.
- The IL2CPP-wasm slowdown over the .NET figures is unmeasured; do not quote the .NET timings as browser costs.
