# Unity performance work — bounded handoff, incomplete

Work stopped when the user reprioritized Rust simulation/parity/headless ahead of Unity. No further profiles, builds, F2/F4 or visual work were started after that instruction. The unfinished long browser run was stopped and its in-process samples were not retained. Core agents were immediately released from the quiet-window request. This directory does **not** establish a five-minute comparison, a complete F1 acceptance gate or full-game performance.

## Active source after cleanup

Within this F1 batch, only the independently verified `ActorView.cs` native mesh ownership fix remains active. The later client authority/recovery correction is tracked separately in the migration checkpoint. The unvalidated instanced Arena path, shader/build changes and instancing settings were reverted. `ActorBatches.cs` and its metadata were removed. Their exact draft is preserved in **`deferred-instancing.patch.gz`**, a nonexecuting archive that can reconstruct the deferred work; it is not an accepted or released implementation. It was created against `120ecd93`; reconstruct with `gzip -dc deferred-instancing.patch.gz | git apply` in an isolated checkout of that revision, then integrate later authority fixes before any future activation.

The 53,927,318-byte Web output and the source/artifact fingerprints in `inputs.json` describe that **archival draft**, not current active/released source. No new Editor, browser or build was run during cleanup. The ignored `Build/Web` output still contains the draft and must be rebuilt before using it to represent current source. Profiling tools and completed baseline evidence remain available; the root trace README was preserved unchanged.

## Completed observations

Hardware: Apple M5 Pro, macOS 26.6.1 arm64. The main display reports 2560 × 1440 at 144.00 Hz; another attached display reports 1920 × 1080 at 100.00 Hz. The actual tested Unity canvas was 960 × 600 at DPR 1. Browser: Chromium 156.0.8078.4, Playwright 1.64.1, headed, explicitly using ANGLE Metal; the reported GPU renderer confirms Apple M5 Pro. GPU timings are asynchronous `EXT_disjoint_timer_query_webgl2` elapsed queries with zero disjoint events in the completed valid runs.

| Completed baseline | Duration | Rendered RAF interval p50 / p99 | Synchronous RAF callback CPU p50 / p99 | GPU elapsed p50 / p99 | GL draw calls p50 / p99 |
| --- | --- | --- | --- | --- | --- |
| Live skeleton server configured to fill eight seats | 15 s | 6.9 / 7.9 ms | 0.2 / 0.5 ms | 0.172 / 0.847 ms | 22 / 22 |
| Public synthetic 204-fighter replay | 20 s | 6.9 / 7.9 ms | 1.1 / 1.9 ms | 0.414 / 0.450 ms | 810 / 818 |

These are instrumented **baseline-only** observations. Synchronous callback time measures the JavaScript/wasm loop and drawing submission inside that callback; it excludes other browser work and is not Unity Profiler PlayerLoop or total CPU frame time. GPU elapsed queries cover commands within the callback, not display presentation. Hooks add overhead, including one JavaScript wrapper per draw. The observer also allocates sample objects, so its JS heap figures cannot establish game-only allocation or GC budgets. Browser CPU timing has finite precision. WASM memory was observed as 69,730,304 bytes in the valid crowded replay; it is memory capacity, not live object occupancy.

Observed normal rendered RAF cadence corresponds to the main display's 144 Hz pacing. This is not a claim that the game is limited to 60 FPS, nor a maximum sustainable uncapped/full-game throughput result. No disabled-vsync/uncapped diagnostic run was completed. No FPS figure is derived by inverting partial CPU/GPU timings. The 204-fighter synthetic workload exceeds the supported eight-player match cap and measures rendering/codec stress, not supported full-game density or AI/combat cost.

`baseline-live8-headless.json` is explicitly invalid/excluded: the initial observer selected a temporary feature-test context and software SwiftShader. It contributes no performance evidence. `baseline-freeze204.*` is a frozen public snapshot screenshot and a one-second diagnostic, not a sustained performance run.

## Code and build status

The old actor view has no native mesh ownership cleanup. A live Editor probe creating/destroying 100 remote views left 400 native meshes (`mesh-lifetime-before.json`, Edit mode). The ownership correction was exercised in advancing Play mode: 100 remote departures returned the mesh count from 1 to 1 after deferred destruction (`mesh-lifetime-after.json`). Lifecycle modes differ; these checks demonstrate ownership behavior, not a timing comparison. No automated Unity test run was completed.

The F1 implementation creates arena-owned shared meshes, batches only already observed remote actors, conservatively rejects offscreen instances using the final camera transform, keeps the local view, and releases actor/map/material/batch resources. Shader instancing support and build-time preservation of runtime instancing variants were added. Current known factions require at most eight remote batches; the existing unknown-faction fallback can require a ninth. No gameplay rule, combat/AI calculation, wire codec or prediction algorithm changed.

The new source passed live Editor compilation and a real WebGL IL2CPP build on Unity 6000.0.85f2 (`b028303d8e7d`), producing **53,927,318 bytes**. The locked package graph was preserved. Source fingerprints are in `inputs.json`. The shader/project values match the prior visual settings apart from keeping instancing variants; routine Editor trailing-space serialization was normalized.

**The instanced path has not yet been exercised in a browser.** No before/after benefit, draw bound, pixel equality, five-minute mesh/memory stability, sustainable throughput improvement or visual-readability preservation has been established. The path was removed from active source and archived in `deferred-instancing.patch.gz`; it requires those checks before any future activation. The ownership fix is supported by the live lifecycle probe. Existing art and authority boundaries are intact in scope, but visual parity still needs direct verification.

## Reproduction tools and remaining work

- `client-unity/UnityProject/Tools/profile-web.cjs` loads a Web player and collects RAF/CPU/GPU/draw/memory observations; `webgl-profile-init.js` implements the observer. Configure `RH_PLAYWRIGHT_MODULE`, `RH_PROFILE_URL`, `RH_PROFILE_OUT`, `RH_PROFILE_SECONDS`, `RH_PROFILE_WARMUP_SECONDS`, `RH_PROFILE_HEADED=1` and `RH_PROFILE_METAL=1`. `RH_PROFILE_UNCAPPED=1` is an explicitly nondefault diagnostic setting, not a supported-player guarantee.
- `Tools/replay-wire-trace.cjs` replays the public wire trace at its original tick rate; it never simulates gameplay. Configure `RH_TRACE_PATH`, `RH_TRACE_PORT`, and optionally `RH_TRACE_FREEZE_TICK`. Trace generation/provenance is documented separately in `wire-trace-README.md`.
- `interrupted-long-run.json` records the unfinished five-minute run without fabricated partial statistics.

When Rust priorities allow: first verify the compiled instanced build in-browser; compare frozen N8 pixels and overlapping-crowd readability; compare equivalent N8/68/204 traces; run serial five-minute mesh/buffer/memory checks; then perform actual uncapped hardware-browser diagnostics if useful. Unity PlayerLoop/Camera.Render/Gfx.WaitForPresent, managed GC allocations/collections, realistic full-game combat and the browser matrix remain unmeasured. F2/F4, compression variants and GPU-fill changes were not implemented.

All owned profile browsers, replay servers and static/game servers were stopped. Caffeinate was untouched. No cloud, DNS, authentication change or commit was performed.
