# Measured showcase performance

Runtime: `ebff286bc68027d4e32eee3607d2ae6807038f9d`; Unity 6000.0.85f2 / URP 17.0.4 / WebGL2 / protocol 11.

**The 144 FPS display acceptance gate remains incomplete.** The M5 Pro host reports one main E2212F display at 1920×1080/60 Hz. Headed Chromium windows reported 1900×941–943 in normal mode. The viewport and actual WebGL drawing buffer were 2560×1440, but that is not evidence of native 1440p/144 Hz scan-out.

All nine capture windows verified Manual High, reduced motion off, render scale 1.0 and a stable actual 2560×1440 backbuffer. No quality or resolution reduction was used. Each window followed 4 seconds of warm-up and contained ordinary movement/attacks plus server-confirmed hit FX. The eight-seat batch used the existing native `--fill-bots 8` server; actor counts below are delivered observer rows, not a claim that all seats were on-screen.

| Batch/run | Seconds | Observer rows p50 / max | Draw callbacks/s | Callback CPU ms p50 / p95 / p99 | GPU ms p50 / p95 / p99 | Callback interval ms p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal run-1 | 15.176 | 5 / 5 | 60.029 | 2.7 / 4.1 / 4.6 | 5.061 / 6.097 / 6.486 | 18.7 |
| Normal run-2 | 15.209 | 4 / 4 | 60.03 | 2.6 / 4 / 4.3 | 5.067 / 6.11 / 6.586 | 18.7 |
| Normal run-3 | 15.172 | 3 / 4 | 60.045 | 2.8 / 3.7 / 4.3 | 4.755 / 5.757 / 6.199 | 18.7 |
| Eight-seat run-1 | 15.096 | 7 / 9 | 60.016 | 2.7 / 3.9 / 4.4 | 5.04 / 6.2 / 6.607 | 18.6 |
| Eight-seat run-2 | 15.129 | 7 / 8 | 60.017 | 2.6 / 3.6 / 4.1 | 4.746 / 5.784 / 6.272 | 18.6 |
| Eight-seat run-3 | 15.167 | 6 / 8 | 59.999 | 2.9 / 3.7 / 4.2 | 5.138 / 6.154 / 6.733 | 18.3 |
| Uncapped diagnostic run-1 | 15.218 | 3 / 5 | 406.427 | 2.1 / 3.6 / 4.1 | 3.658 / 5.105 / 5.874 | 4.2 |
| Uncapped diagnostic run-2 | 15.174 | 2 / 4 | 421.51 | 2 / 3.5 / 4 | 3.599 / 4.843 / 5.401 | 4.2 |
| Uncapped diagnostic run-3 | 15.225 | 5 / 6 | 408.933 | 2.1 / 3.7 / 4.2 | 3.586 / 5.175 / 5.943 | 4.3 |

The normal and eight-seat captures paced at approximately 60 Hz. The separate uncapped diagnostic used Chromium `--disable-frame-rate-limit` and `--disable-gpu-vsync`; its high callback/submission rate measures submission headroom under altered pacing. It does not establish physically displayed frames, compositor delivery or sustained 144 FPS on the requested display. All reports keep `displayProof.eligible=false`.

CPU values time synchronous RAF JavaScript/WASM callbacks, not the whole browser or Unity PlayerLoop. GPU values come from `EXT_disjoint_timer_query_webgl2`; the captured reports had no disjoint observations. CPU and GPU values are overlapping pipeline measurements and must not be added or converted directly into a claimed displayed frame rate. GPU p99 reached 6.733 ms across the paced batches, with a maximum query of 7.358 ms; callback CPU maxima include an isolated 9.7 ms sample. These are recorded outliers, not omitted from the report; a real 144 Hz repeat is still needed against the 6.944 ms frame budget.

## Memory, allocations and loading

- Live WebAssembly linear memory stayed at 126,353,408 bytes (120.5 MiB) throughout every measured window. Unity reported roughly 111.63–112.49 MB used WASM memory in the paced batches. The before/after used-memory deltas are retained in the JSON; they are net allocation changes, not gross managed allocations per frame.
- Paced-run JS heap p95 was approximately 44.1–45.0 MB. Browser instrumentation also allocates sampling records, so this is not a pure game-memory number. WebGL buffer creation/deletion counts are recorded in the raw metrics.
- Managed GC allocation bytes/frame, total browser-process memory and driver/GPU memory were unavailable from this release capture. They are not reported as zero, and net heap growth is not substituted for allocation throughput.
- The complete uncompressed distribution is 74,029,313 bytes including license notices. The four runtime resources transferred 73,981,559 bytes including HTTP overhead. WASM is 45,932,171 bytes; data is 27,559,288 bytes. Compression is disabled for the ordinary local static server.
- Normal local load measurements: canvas ready 0.347–0.978 seconds, first Unity frame 0.337–0.745 seconds, active match 5.559–5.987 seconds including the configured 5-second lobby. These are localhost/cached-host observations, not an Internet download estimate.

## Evidence and remaining work

The portable [summary](evidence/summary.json) contains per-run distributions, settings/backbuffer assertions, native display/window gates, Unity memory/loading metrics and raw-report hashes. [Build manifest](evidence/build-manifest.json) pins every distributable file. Raw reports and screenshots remain under `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/evidence/`.

Capture checks passed 3/3 normal, 3/3 eight-seat, 3/3 uncapped; the exact-build browser flow passed 19/19 and the presentation suite passed 11/11. Capture PASS is distinct from the unfulfilled 144 Hz acceptance condition. Final acceptance requires the confirmed 2560×1440/144 Hz display, fullscreen/native window verification, the same fixed High build, and repeated warmed normal/crowded combat measurements. Broader content/visibility-data limitations remain in [COVERAGE.md](COVERAGE.md).

On a suitable display, the profiler requests a real fullscreen native window automatically; `RH_SHOWCASE_PROFILE_FULLSCREEN=1` also requests that mode explicitly. Its CDP bounds, focus, visibility and physical-mode checks must all pass. The fullscreen path remains to be exercised on the required display. The final recorded runs contained zero console, protocol, page or HTTP errors and also satisfy the final stricter zero-resource-error gate.
