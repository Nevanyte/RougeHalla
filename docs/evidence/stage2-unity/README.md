# Stage 2 Unity bootstrap evidence

Base revision: `e7e85338`, branch `optimization_port`, with the scoped Unity setup changes in this branch. The proof server was the unmodified frozen-baseline binary, not a claim about later gameplay changes. Its protocol is 4 and `/info` content identity is `f47c30e6c8ca3493`.

- Editor: Unity 6000.0.85f2, revision `b028303d8e7d`, arm64, installed with Web Build Support. Existing Unity Personal entitlement used. No login, activation, CLI update or cloud deployment performed.
- Host: Apple M5 Pro, macOS 26.6.1 arm64. The owner selected this machine as the initial 60 FPS reference on 2026-11-05; these historical movement checks do not measure full-game performance.
- `editor-compile.json`: live Pipeline console ground truth after initial import, content bake, Main scene/URP creation and package trimming: no compiler failure/errors. Scene and assets were created by Editor APIs, not authored as YAML.
- `web-build.json`: actual IL2CPP/WebGL build succeeded, 53,887,440 bytes across output files. The 13,925,223-byte gzip total is an offline estimate, not what was hosted; build compression is disabled. Threads are disabled, WebGL2 is used.
- `chromium-http-smoke.*`: actual Web build served by `python3 -m http.server`, browser WebSocket to local Rust server. Valid protocol-4 Welcome/map, advancing snapshots, acknowledged WASD movement, changed authoritative position, screenshot and no page exceptions.
- `chromium-https-smoke.*`: the same Web player served over local HTTPS and connected to `rh-server --self-signed` over WSS. The browser context explicitly accepted self-signed certificates for this local test.

Browser: Chromium 156.0.8078.4, driven by isolated Playwright 1.64.1. Console entries are captured in each JSON report. GPU ReadPixels warnings appeared; these smoke runs do not establish performance budgets. `timeToAuthoritativeSelfSnapshotMs` includes page navigation/loading through the first decoded self snapshot and is not a first-frame measurement.

Successful build logs (authentication/license diagnostics and local home paths redacted): `web-build-log.txt` and `wrapper-build-log.txt`. Additional local diagnostic logs:

- `/tmp/rougehalla-unity-editor-compile.log`
- `/tmp/rougehalla-unity-web-build.log` (first build; the wrapper rebuild is `/tmp/rougehalla-unity-wrapper-build.log`)
- `/tmp/rougehalla-unity-smoke-server.log`
- `/tmp/rougehalla-unity-wss-server.log`

Reproduction: start `rh-server` locally, run `client-unity/UnityProject/Tools/build-web.sh`, serve `Build/Web`, and run `Tools/smoke-web.cjs` with `RH_UNITY_SMOKE_URL` pointing at that page plus its encoded `server` query parameter. The smoke requires Playwright; `RH_PLAYWRIGHT_MODULE` may point at an isolated installation. For local self-signed TLS only, opt in with `RH_UNITY_SMOKE_ALLOW_SELF_SIGNED=1`. The smoke records evidence; it does not spawn servers or deploy anything.

Not verified here: attacks landing, authoritative result presentation, full player flows, reconnect UI, Chrome stable/Firefox/Safari/Edge matrix, five-minute memory/GC/frame-time/draw-call budgets, adaptive quality or mid-range hardware performance. P-UNITY-1 remains incomplete. This is a verified skeleton compile/build/transport/movement milestone only.
