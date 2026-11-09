# Comparability limits of the matched full-port performance comparison

Scope: the final legacy TypeScript/Colyseus/Phaser versus Rust native server + actual Unity Web comparison on the Apple
M5 Pro (R-WEB-3, R-OPT-3, R-OPT-4, P-LOAD-3). This page lists what the prepared harness can and cannot make comparable.
It is written before any final run; nothing here is a measurement.

## What the harness enforces

A pair is admitted only when both stacks ran the same matrix cell (by matrix hash) on the same machine configuration,
display, browser executable and flags, viewport, power state and network shaping; with clean release builds whose
artifacts were hashed before and after the run; with the same map pin, bot seed and tier, seats, mechanics, scripted
input (by hash), room count and 20 Hz C-TICK schedule; in the interleaved trial order; with contiguous windows of the
declared length in which the authoritative tick advanced at 20 Hz; above the workload's load floors in every window and
within the load tolerance of each other; with passing initial and outcome checks; with every cell metric present as raw
data or as an explicit absence; with the same instrument for every required metric; and with a recorder whose own cost
is bounded per window and checked by an A/B control. The validator never repairs a sample, never subtracts overhead and
never relaxes a threshold. Summaries are computed only from raw data of an admitted report.

## What remains different or unproven

1. **The full Rust runtime is not complete.** MIGRATION.md (2026-11-09) still lists the full bot Memory/strategy/reflex/
   hunt/loot/learning/tournament path, card-only bleed hit feedback and complete browser/account flows as open. Every
   cell fixes the mechanics list; a port build missing one of them cannot satisfy its workload, so no cell can run until
   Root admits the integrated full runtime. A partial slice is refused by design (no matrix cell exists for it).
2. **The legacy live server cannot select a map today.** `packages/server/src/mapPool.ts` certifies crypto-random seeds,
   world randomness uses `Math.random` and the reward/quest salts are crypto-random. Only the bot seed is settable
   (`BOTS_SEED`). Without a reviewed legacy test seam the pinned map `7:0:6255dbbe` cannot be selected, so every
   browser and latency cell would be refused on `mapPin`. This harness does not add that seam (game code is out of
   scope). Even with it, legacy matches are not replayable: load comparability is enforced statistically (floors and
   median tolerance), not by identical outcomes.
3. **Per-window raw server step times do not exist on either live stack.** rh-server exports cumulative log-histogram
   quantiles (`stepUs` count/p50/p99/max, up to 25% conservative) and no bucket counts; legacy live rooms export no tick
   timing at all (`stepBench.ts` measures a headless room and prints summaries). `server.tick_ms` is required in the
   real-time and density cells, so a reviewed per-step or per-window bucket export is needed on both stacks.
4. **Server-side load counts are not exported per window.** The floors and tolerance need seated players, alive humans,
   alive mobs, projectiles and accepted commands per window from the authoritative side. These are privileged
   diagnostics: they must be collected out of band and never reach a client (C-OBS). The legacy client happens to see
   the whole Colyseus state, the Unity client by design does not, so client-side counts are not comparable.
5. **Same machine means same configuration.** The check compares CPU, model, memory, OS build, architecture, native
   execution, power and thermal state. It does not identify a physical device (no serial numbers are collected).
   The interleaved order assumes one session; the receipt must say so.
6. **Display limits.** A 60 Hz (or ProMotion 120 Hz/variable) display bounds the requestAnimationFrame callback rate.
   When both stacks sit at the refresh, the callback interval says nothing about headroom; the summary marks this
   (`callbackP50AtRefresh`). Per-frame CPU/GPU time and the diagnostic cell C04 carry the headroom signal, and C04 is a
   submission rate with frame limit and vsync disabled, never displayed or shipping FPS. The display mode (fixed or
   variable refresh) is recorded and must match; whether to pin ProMotion to a fixed rate is an owner decision.
7. **Callback rate is not displayed frames.** `frame.presented_interval_ms` needs a presentation-side source (Chrome
   tracing or an OS compositor trace) and is optional; a rAF-derived value is refused. Without it, no displayed-FPS
   statement is admissible.
8. **CPU and GPU coverage differ by API.** The synchronous callback CPU envelope excludes asynchronous browser/GPU-process
   work; OS process CPU per window covers it but at process granularity. WebGL timer queries need
   `EXT_disjoint_timer_query(_webgl2)`; the legacy Phaser renderer may use a WebGL1 context where the extension is
   unavailable, in which case `gpu.elapsed_ms` is recorded absent, never 0, and no GPU ratio is reported.
9. **Memory and GC models differ.** Legacy keeps all game state in the JS heap; Unity keeps it in Wasm linear memory with
   a small JS heap. `client.js_heap_bytes`, `client.wasm_heap_bytes`, `client.managed_alloc_bytes` and
   `client.gc_pause_ms` are therefore stack-specific and never ratioed; browser process-tree RSS is the cross-stack
   memory figure. Unity per-frame GC allocation counters generally need a development build, which is not admissible,
   so that channel is expected to be explicitly absent on the port side.
10. **Wire bytes are application payload.** `net.*_bytes` counts WebSocket message payload seen by the page (Colyseus
    schema patches plus msgpack messages versus protocol14 binary frames). WebSocket framing, TLS, TCP/IP and
    compression are excluded; localhost runs say nothing about WAN behaviour or packet loss.
11. **Socket RTT is not input-to-visible response.** `net.socket_rtt_ms` is application ping/pong (Colyseus room ping
    versus Unity Ping/Pong) and has different code paths per stack. Input-to-visible needs a stack-neutral endpoint;
    the existing `tools/latency` post-Present trace exists only in Unity, so C10-C12 stay unrunnable until a
    pixel-change probe exists on both stacks. The ws-proxy injects delay and jitter on a reliable stream: loss is not
    emulated and `net.loss_fraction` is expected absent.
12. **Throughput is not real time.** C05 compares unpaced step cost (V8 JIT after warm-up versus AOT Rust) for a headless
    room. Instruction counts (perfproof) have no legacy counterpart and are not used across stacks. Legacy headless
    determinism for a seed is a prerequisite that has not been verified here.
13. **Density reflects architecture.** Legacy rooms share one Node event loop; Rust rooms run on a multi-threaded runtime.
    C06-C09 measure each stack as built; the result is a property of the architecture, not of per-room code alone.
    densitybench's paused-clock estimate is not admissible for these cells.
14. **Startup compares different artifacts.** A Vite bundle and a Unity Web build tens of megabytes larger (55.8 MB decoded payload at first playable) are both measured as served by
    the same local static server with the same compression policy. Loopback and CDP throttling (C14) approximate a
    20 Mbit/s link; they are not WAN, CDN or AWS measurements.
15. **Visual work is not equal.** The port is allowed to redesign art (R-VIS-1). Equal workload means equal game load,
    not equal pixels; R-OPT-4 requires recording visual-quality differences, which this schema does not yet capture
    (screenshots per cell and side are remaining work).
16. **Statistics are descriptive.** Five interleaved trials per stack give pooled nearest-rank percentiles, per-trial
    medians and their range. No significance test is applied; overlapping trial ranges do not support a claim, and the
    ratio of two pooled percentiles is not a speedup factor for the whole game.
17. **Recorder effect.** The A/B control bounds, but cannot remove, the observer effect on the measured metric; other
    metrics may be affected differently. A control above the bound refuses the cell; nothing is subtracted.
18. **Thresholds are proposals.** Load tolerance 10% (with absolute slack for small counts), recorder share 1%, recorder
    A/B shift 2%, floors and window lengths must be ratified before the first run and never adjusted after data is seen.

## Conflict flagged for the owner

ORDER_OF_OPERATIONS.md decision D7 (not an ADR) proposes an absolute weak-hardware backstop of "p99 frame time
<= 16.7 ms at 960x600", which is a 60 FPS frame gate. R-WEB-3 (owner, 2026-11-05) replaced the 60 FPS goal with the
highest sustainable frame rate. This harness applies no frame-rate threshold, goal or cap; it records the display
refresh as a measured limit. Per CLAUDE.md the accepted requirement governs until the owner resolves D7.
