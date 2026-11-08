# Measured showcase performance

Runtime: `c6fe0b18de87a870aefc28f2652f32236777a334`; Unity 6000.0.85f2 / URP 17.0.4 / WebGL2 / protocol 11.

**The 144 FPS display acceptance gate remains incomplete.** The M5 Pro host reports one main E2212F display at 1920×1080/60 Hz. Headed Chromium windows reported 1900×941–943 in normal mode. The viewport and actual WebGL drawing buffer were 2560×1440, but that is not evidence of native 1440p/144 Hz scan-out.

All nine capture windows verified Manual High, reduced motion off, render scale 1.0 and a stable actual 2560×1440 backbuffer. No quality or resolution reduction was used. Each window followed 4 seconds of warm-up and contained ordinary movement/attacks plus server-confirmed hit FX. The eight-seat batch used the existing native `--fill-bots 8` server; actor counts below are delivered observer rows, not a claim that all seats were on-screen.

| Batch/run | Seconds | Observer rows p50 / max | Draw callbacks/s | Callback CPU ms p50 / p95 / p99 | GPU ms p50 / p95 / p99 | Callback interval ms p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal run-1 | 15.162 | 4 / 5 | 60.018 | 2.9 / 4.1 / 4.6 | 5.074 / 6.184 / 6.565 | 18.6 |
| Normal run-2 | 15.045 | 3 / 3 | 60.02 | 2.7 / 4.3 / 4.8 | 4.844 / 5.895 / 6.279 | 18.5 |
| Normal run-3 | 15.018 | 4 / 5 | 60.061 | 2.5 / 4 / 4.5 | 5.139 / 6.338 / 6.694 | 18.6 |
| Eight-seat run-1 | 15.251 | 5 / 5 | 60.062 | 2.8 / 4.1 / 4.9 | 4.962 / 6.044 / 6.47 | 18.6 |
| Eight-seat run-2 | 15.141 | 4 / 4 | 60.036 | 2.7 / 3.8 / 4.7 | 4.882 / 6.099 / 6.445 | 18.6 |
| Eight-seat run-3 | 15.137 | 5 / 5 | 59.985 | 2.7 / 4.1 / 4.5 | 5.11 / 6.183 / 6.571 | 18.6 |
| Uncapped diagnostic run-1 | 15.248 | 3 / 4 | 428.187 | 2 / 3.5 / 4.1 | 3.506 / 4.85 / 5.675 | 4.2 |
| Uncapped diagnostic run-2 | 15.057 | 4 / 7 | 471.409 | 1.9 / 3.3 / 3.8 | 3.382 / 4.929 / 5.42 | 3.9 |
| Uncapped diagnostic run-3 | 15.212 | 4 / 5 | 424.73 | 2 / 3.6 / 4.1 | 3.511 / 4.789 / 5.417 | 4.3 |

The normal and eight-seat captures paced at approximately 60 Hz. The separate uncapped diagnostic used Chromium `--disable-frame-rate-limit` and `--disable-gpu-vsync`; its high callback/submission rate measures submission headroom under altered pacing. It does not establish physically displayed frames, compositor delivery or sustained 144 FPS on the requested display. All reports keep `displayProof.eligible=false`.

CPU values time synchronous RAF JavaScript/WASM callbacks, not the whole browser or Unity PlayerLoop. GPU values come from `EXT_disjoint_timer_query_webgl2`; the captured reports had no disjoint observations. CPU and GPU values are overlapping pipeline measurements and must not be added or converted directly into a claimed displayed frame rate. GPU p99 reached 6.694 ms in the normal batch, with a maximum query of 7.003 ms; a real 144 Hz repeat is still needed against the 6.944 ms frame budget.

## Memory, allocations and loading

- Live WebAssembly linear memory stayed at 126,353,408 bytes (120.5 MiB) throughout every measured window. Unity reported roughly 111.65–112.72 MB used WASM memory in the paced batches. The before/after used-memory deltas are retained in the JSON; they are net allocation changes, not gross managed allocations per frame.
- Paced-run JS heap p95 was approximately 43.6–45.0 MB. Browser instrumentation also allocates sampling records, so this is not a pure game-memory number. WebGL buffer creation/deletion counts are recorded in the raw metrics.
- Managed GC allocation bytes/frame, total browser-process memory and driver/GPU memory were unavailable from this release capture. They are not reported as zero, and net heap growth is not substituted for allocation throughput.
- The complete uncompressed distribution is 74,029,211 bytes including license notices. The four runtime resources transferred 73,981,457 bytes including HTTP overhead. WASM is 45,932,069 bytes; data is 27,559,288 bytes. Compression is disabled for the ordinary local static server.
- Normal local load measurements: canvas ready 0.354–0.938 seconds, first Unity frame 0.352–0.684 seconds, active match 5.591–5.964 seconds including the configured 5-second lobby. These are localhost/cached-host observations, not an Internet download estimate.

## Evidence and remaining work

The portable [summary](evidence/summary.json) contains per-run distributions, settings/backbuffer assertions, native display/window gates, Unity memory/loading metrics and raw-report hashes. [Build manifest](evidence/build-manifest.json) pins every distributable file. Raw reports and screenshots remain under `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`.

Capture checks passed 3/3 normal, 3/3 eight-seat, 3/3 uncapped; the exact-build browser flow passed 19/19 and the presentation suite passed 11/11. Capture PASS is distinct from the unfulfilled 144 Hz acceptance condition. Final acceptance requires the confirmed 2560×1440/144 Hz display, fullscreen/native window verification, the same fixed High build, and repeated warmed normal/crowded combat measurements. Broader content/visibility-data limitations remain in [COVERAGE.md](COVERAGE.md).

On a suitable display, the profiler requests a real fullscreen native window automatically; `RH_SHOWCASE_PROFILE_FULLSCREEN=1` also requests that mode explicitly. Its CDP bounds, focus, visibility and physical-mode checks must all pass. The fullscreen path remains to be exercised on the required display. The final recorded runs contained zero console, protocol, page or HTTP errors and also satisfy the final stricter zero-resource-error gate.
