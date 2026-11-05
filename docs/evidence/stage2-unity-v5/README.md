# Integrated protocol 5 Unity verification

Verified on `optimization_port`, HEAD `50bb06a79b140ace29f8cb8b7b276d1d39854e22` plus the integrated working-tree changes fingerprinted in `inputs.json`. This supersedes the protocol 4 bootstrap as evidence for the current wire and content; historical evidence in `stage2-unity/` remains unchanged.

The authoritative verification server reported protocol **5** and content hash **`b0b7169709bd0a83`**. `Tools/build-web.sh` obtained that identity from `/info` and generated `Assets/Scripts/BakedContent.cs`; the source was not hand-edited. The tested compiled server binary is fingerprinted in `inputs.json`. Unity-generated YAML trailing whitespace was normalized after the build; the fingerprints retain the actual tested bytes.

Unity **6000.0.85f2** (`b028303d8e7d`), arm64, completed the actual IL2CPP/WebGL build with **zero C# compiler errors**. The pinned package graph stayed unchanged. Build output is **53,892,988 bytes** with compression disabled, threads disabled and WebGL2. Offline gzip totals **13,926,832 bytes**; this is an estimate, not a compressed hosting test. File sizes and SHA-256 fingerprints are in `web-build.json`, and the sanitized success excerpt is in `build-log-excerpt.txt`.

Actual browser checks used Chromium **156.0.8078.4**, Playwright **1.64.1**, on an Apple M5 Pro running macOS 26.6.1 arm64:

| Check | HTTP / WS | HTTPS / WSS |
| --- | --- | --- |
| Welcome protocol | 5 | 5 |
| Canonical map | 48 × 32, hash 2384865409 | 48 × 32, hash 2384865409 |
| Decoded snapshots | 54 | 54 |
| Advancing authoritative ticks | 2 → 53 | 2 → 53 |
| Acknowledged movement sequence | 0 → 16 | 0 → 16 |
| Authoritative position changed | Passed | Passed |
| Page exceptions / console errors | 0 / 0 | 0 / 0 |
| Time to authoritative self snapshot | 2,689 ms | 2,696 ms |

The HTTPS/WSS check explicitly accepted local self-signed certificates. Each run produced four GPU ReadPixels performance warnings. The snapshot-loading times above are smoke observations, not first-frame measurements or performance budgets. The owner selected the M5 Pro as the initial 60 FPS reference on 2026-11-05; full-game performance has not been measured.

`chromium-http-smoke.json` and `chromium-https-smoke.json` retain the browser console, public observed self state, frame counts, movement checks and advancing ticks. The corresponding PNGs show the actual map and player canvas. Admission tokens are redacted. No session identifiers, licensing/authentication diagnostics, absolute home paths or private game files are included. Full raw local build diagnostics are intentionally excluded.

Reproduction uses the existing `Tools/build-web.sh` and `Tools/smoke-web.cjs`. This run used a temporary copy of the smoke tool with an additional initial/final tick assertion; production source was unchanged. Start the protocol 5 Rust server with `--min-players 1 --fill-bots 2 --lobby-seconds 1 --fill-seconds 0`, build against its `/info`, serve `Build/Web`, then point `RH_UNITY_SMOKE_URL` at that page and the server WebSocket URL. Run local TLS separately with `--self-signed` and `RH_UNITY_SMOKE_ALLOW_SELF_SIGNED=1`. All verification servers/static hosts were stopped afterward. No cloud, DNS, login or activation action was performed.

This verifies current-protocol skeleton build, rendering, transport, snapshots and movement only. It does not establish complete gameplay/UI flows, combat/results, reconnect presentation, the full browser matrix, adaptive quality or performance budgets.
