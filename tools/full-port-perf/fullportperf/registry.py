"""The metric vocabulary. Every measured quantity has exactly one id, one family and one unit; families that the owner
asked to keep apart (simulation throughput vs real-time end-to-end, callback rate vs displayed frames, socket RTT vs
input-to-visible response, warm vs cold startup) are distinct ids with incompatible sources, so no report can merge them.

A metric value in a window or trial is either
    {"status": "measured", "source": <instrument>, "unit": <unit>, "samples": [...]}       (raw samples), or
    {"status": "measured", "source": ..., "unit": ..., "value": <number>}                   (a window counter), or
    {"status": "measured", "source": ..., "unit": ..., "histogram": {"bounds": [...], "counts": [...]}}, or
    {"status": "absent", "reason": <one of ABSENT_REASONS>, "detail": "<why>"}.
Missing keys, null, empty sample lists and "0 meaning unknown" are refused by the validator."""

ABSENT_REASONS = ("unsupported-by-stack", "unsupported-by-browser", "instrument-unavailable", "not-collected",
                  "not-applicable")

# Cell classes (see final-matrix.json).
REALTIME = "realtime-e2e"
THROUGHPUT = "sim-throughput"
DENSITY = "server-density-realtime"
LATENCY = "input-latency"
STARTUP = "startup"
DIAGNOSTIC = "diagnostic-uncapped"
CELL_CLASSES = (REALTIME, THROUGHPUT, DENSITY, LATENCY, STARTUP, DIAGNOSTIC)
PACED = (REALTIME, DENSITY, LATENCY, DIAGNOSTIC)


def M(family, unit, kind, scope="window", zero_ok=False, sources=None, forbidden=(), classes=PACED, comparable=True):
    return {"family": family, "unit": unit, "kind": kind, "scope": scope, "zeroOk": zero_ok,
            "sources": tuple(sources) if sources else None, "forbiddenSources": tuple(forbidden),
            "classes": tuple(classes), "crossStackComparable": comparable}


RAF = ("raf-timestamps",)
METRICS = {
    # Browser callback rate: requestAnimationFrame timestamps. This is NOT displayed frames.
    "frame.callback_interval_ms": M("frame-callback", "ms", "samples", sources=RAF, classes=(REALTIME, DIAGNOSTIC, LATENCY)),
    "frame.callback_cpu_ms": M("frame-callback", "ms", "samples", zero_ok=True, sources=("raf-sync-cpu",),
                               classes=(REALTIME, DIAGNOSTIC)),
    # Displayed/presented frames need a presentation-side source; a rAF-derived value is refused.
    "frame.presented_interval_ms": M("frame-presented", "ms", "samples",
                                     sources=("cdp-tracing-presentation", "os-compositor-trace"),
                                     forbidden=RAF + ("raf-sync-cpu",), classes=(REALTIME, DIAGNOSTIC)),
    "gpu.elapsed_ms": M("gpu", "ms", "samples", sources=("webgl-timer-query",), classes=(REALTIME, DIAGNOSTIC)),
    "gpu.timer_disjoint": M("gpu", "count", "counter", zero_ok=True, sources=("webgl-timer-query",),
                            classes=(REALTIME, DIAGNOSTIC)),
    "cpu.browser_process_s": M("cpu", "cpu_s", "counter", zero_ok=False, sources=("os-process-sampler",),
                               classes=(REALTIME, DIAGNOSTIC)),
    "cpu.server_process_s": M("cpu", "cpu_s", "counter", zero_ok=False, sources=("os-process-sampler",),
                              classes=(REALTIME, DENSITY, DIAGNOSTIC)),
    # Authoritative real-time server work at the fixed 20 Hz.
    "server.tick_ms": M("server-tick", "ms", "samples", zero_ok=True, sources=("server-step-timer",),
                        classes=(REALTIME, DENSITY, DIAGNOSTIC, LATENCY)),
    "server.ticks": M("server-tick", "ticks", "counter", sources=("server-counters",),
                      classes=(REALTIME, DENSITY, DIAGNOSTIC, LATENCY)),
    "server.tick_budget_misses": M("server-tick", "ticks", "counter", zero_ok=True, sources=("server-counters",),
                                   classes=(REALTIME, DENSITY, DIAGNOSTIC, LATENCY)),
    "server.rss_bytes": M("memory", "bytes", "samples", sources=("os-process-sampler", "server-counters"),
                          classes=(REALTIME, DENSITY, DIAGNOSTIC, THROUGHPUT)),
    "client.browser_rss_bytes": M("memory", "bytes", "samples", sources=("os-process-sampler",),
                                  classes=(REALTIME, DIAGNOSTIC)),
    # The JS heap holds all legacy game state but only Unity's glue; reported per stack, never ratioed.
    "client.js_heap_bytes": M("memory", "bytes", "samples", sources=("js-heap",), classes=(REALTIME, DIAGNOSTIC),
                              comparable=False),
    # Stack-specific memory/GC channels: reported, never ratioed across stacks.
    "client.wasm_heap_bytes": M("memory", "bytes", "samples", sources=("wasm-memory",), classes=(REALTIME, DIAGNOSTIC),
                                comparable=False),
    "client.managed_alloc_bytes": M("gc", "bytes", "counter", zero_ok=True,
                                    sources=("unity-profiler-recorder", "v8-heap-sampling"),
                                    classes=(REALTIME, DIAGNOSTIC), comparable=False),
    "client.gc_pause_ms": M("gc", "ms", "samples", zero_ok=True, sources=("unity-profiler-recorder", "cdp-tracing-gc"),
                            classes=(REALTIME, DIAGNOSTIC), comparable=False),
    # Application payload on the game socket (both directions), per window.
    "net.down_bytes": M("network-bytes", "bytes", "counter", sources=("ws-frame-tap",),
                        classes=(REALTIME, DIAGNOSTIC, LATENCY)),
    "net.up_bytes": M("network-bytes", "bytes", "counter", sources=("ws-frame-tap",),
                      classes=(REALTIME, DIAGNOSTIC, LATENCY)),
    # Socket round trip: application ping/pong only. Never an input-to-visible figure.
    "net.socket_rtt_ms": M("network-rtt", "ms", "samples", scope="trial", sources=("app-ping-pong",),
                           forbidden=("input-to-post-present-trace", "pixel-change-probe"),
                           classes=(REALTIME, LATENCY, DIAGNOSTIC)),
    "net.loss_fraction": M("network-loss", "fraction", "counter", scope="trial", zero_ok=True, sources=("proxy-loss-counter",),
                           classes=(LATENCY,)),
    # Input to visible response: input event to a presented change. Never derived from ping.
    "latency.input_to_self_visible_ms": M("input-to-visible", "ms", "samples", scope="trial",
                                          sources=("pixel-change-probe", "input-to-post-present-trace"),
                                          forbidden=("app-ping-pong",), classes=(LATENCY,)),
    "latency.input_to_opponent_visible_ms": M("input-to-visible", "ms", "samples", scope="trial",
                                              sources=("pixel-change-probe", "input-to-post-present-trace"),
                                              forbidden=("app-ping-pong",), classes=(LATENCY,)),
    # Unpaced simulation throughput: never mixed with real-time cells.
    "sim.step_wall_us": M("sim-throughput", "us", "samples", sources=("headless-step-timer",), classes=(THROUGHPUT,)),
    "sim.steps": M("sim-throughput", "ticks", "counter", sources=("headless-step-timer",), classes=(THROUGHPUT,)),
    # Startup (per trial, with a declared cache state).
    "startup.encoded_bytes": M("startup", "bytes", "counter", scope="trial", sources=("resource-timing",),
                               classes=(STARTUP,)),
    "startup.decoded_bytes": M("startup", "bytes", "counter", scope="trial", sources=("resource-timing",),
                               classes=(STARTUP,)),
    "startup.payload_complete_ms": M("startup", "ms", "counter", scope="trial", sources=("resource-timing",),
                                     classes=(STARTUP,)),
    "startup.engine_ready_ms": M("startup", "ms", "counter", scope="trial", sources=("lifecycle-marks",),
                                 classes=(STARTUP,)),
    "startup.first_snapshot_ms": M("startup", "ms", "counter", scope="trial", sources=("lifecycle-marks",),
                                   classes=(STARTUP,)),
    "startup.join_to_active_ms": M("startup", "ms", "counter", scope="trial", sources=("lifecycle-marks",),
                                   classes=(STARTUP,)),
    # Recorder self-cost, required in every window it is in (overhead admission).
    "recorder.self_ms": M("recorder", "ms", "counter", zero_ok=True, sources=("recorder-self-timer",),
                          classes=CELL_CLASSES),
}

# Keys whose presence means a frame-rate goal or cap, or an overhead/budget adjustment. All are refused.
FORBIDDEN_KEYS = {
    "targetFps": "a frame-rate target (no 60 FPS goal or cap)",
    "fpsTarget": "a frame-rate target (no 60 FPS goal or cap)",
    "fpsCap": "a frame-rate cap",
    "frameCap": "a frame-rate cap",
    "maxFps": "a frame-rate cap",
    "overheadSubtracted": "recorder overhead subtraction without evidence",
    "overheadCorrection": "recorder overhead subtraction without evidence",
    "budgetRelaxation": "budget relaxation",
    "adjustedSamples": "adjusted (non-raw) samples",
}

# Keys that may carry credentials or personal data; refused anywhere in a report.
PRIVATE_KEYS = ("token", "password", "passcode", "secret", "cookie", "authorization", "credential", "apikey",
                "api_key", "sessionid", "session_id", "email", "privatekey", "nickname", "callsign")


def required_metric_ok(metric_id, cell_class):
    m = METRICS.get(metric_id)
    return m is not None and cell_class in m["classes"]
