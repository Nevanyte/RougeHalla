# Matched full-port performance: preparation receipt

**Preparation only. No benchmark, build, browser, server, cloud or load test was run for this receipt, and nothing here is
a performance measurement of either stack.** Everything under `synthetic/` is SYNTHETIC and labelled so in every file.

Serves P-LOAD-3 / R-OPT-4 (final matched legacy versus Rust+Unity comparison on the M5 Pro) and ORDER_OF_OPERATIONS
phase 1 item 9 (Phaser client baseline, prepared as the paired comparator). Prepared in a cloud Linux container, not on
the M5 Pro; the final campaign is executed by Root and the latency/art owners once the integrated full runtime is admitted.

| Identity | Value |
|---|---|
| Base | `cdec00efa6d56661264271ebc3437f7b7f5349c2` (`origin/optimization_port`, descendant of `6a251045`) |
| Code commit | `33651cf2bde17c713276f31f3e8efb7f98791fef` (`tools/full-port-perf/**`) |
| Matrix | `tools/full-port-perf/final-matrix.json`, canonical SHA-256 `37e87e090f7dd5bbdbb0f739a4274c68ac7755f792287de92dc7bbd988ed8176` |
| Tool SHA-256 (sources + matrix + scripts) | `77503d21b6fd48cc9f5c5257552f2f80ec25580240343e0f926339d840ca0e17` |
| Python | 3.13.18, standard library only |

## What exists now

- A paired-workload **validator** (`fpp.py validate`) whose verdict is `ADMITTED`, `ADMITTED-SYNTHETIC-CONTROL` (never
  final evidence) or `REFUSED` with stable codes and JSON paths. Its rules are listed in
  `tools/full-port-perf/fullportperf/admission.py` and summarised in [COMPARABILITY_LIMITS.md](COMPARABILITY_LIMITS.md).
- A **report schema** (`rh-full-port-perf-report/1`): raw per-window/per-trial values only; every metric `measured` with
  raw data or `absent` with a reason; registry-fixed units and instruments; families kept apart (simulation throughput
  versus real-time, callback rate versus presented frames, socket RTT versus input-to-visible, cold versus warm startup).
- Deterministic **summaries** (`fpp.py summarize`) from raw data of admitted reports only, tied by hash to report, matrix
  and tool, with no wall-clock content.
- The exact bounded **experiment matrix**: [EXPERIMENT_MATRIX.md](EXPERIMENT_MATRIX.md) (rendered from the JSON;
  15 cells, estimated 6.80 h including one overhead-control trial per stack and cell, bound 8 h).
- **Adapters** that reuse existing collectors instead of a competing benchmark (below).
- **SYNTHETIC controls**: an admissible pair for every cell and 63 named refusal controls.

## Results (this container)

| Command | Result |
|---|---|
| `python3 -m unittest discover -s tools/full-port-perf/tests -v` | 41 tests, 41 passed, 0 failed, 0 skipped (54 + 9 refusal controls run as subtests) |
| `python3 tools/full-port-perf/fpp.py matrix` | matrix ok: 15 cells, 6.80 h estimated, bound 8.0 h |
| `python3 tools/full-port-perf/fpp.py controls --repo . --receipt .../SYNTHETIC-controls-receipt.json` | 15/15 SYNTHETIC bases admitted as controls (none as final evidence); 63/63 refusal controls refused with their required codes |
| `python3 tools/full-port-perf/fpp.py validate .../SYNTHETIC-C13-report.json --repo .` | `ADMITTED-SYNTHETIC-CONTROL`, 0 refusals, 0 warnings |
| `python3 tools/full-port-perf/fpp.py summarize .../SYNTHETIC-C13-report.json --repo .` | summary written; labels SYNTHETIC and "cold startup only" |
| `python3 tools/full-port-perf/fpp.py assess-existing --repo .` | 5 existing receipts assessed; none admissible (by design, see below) |
| `python3 tools/perfproof/perfproof.py --self-test` (reused gate, unchanged) | 13 cases pass |
| `node --test tools/latency/latency.test.cjs` (reused collector, unchanged) | 12 pass, 0 fail |

Two problems were found by the controls during development and fixed before the code commit: the reference-machine check
used a substring match (a CPU string merely containing "Apple M5 Pro" passed), and multi-room density windows were checked
against a single room's 20 step samples. No retained failure remains.

## Reused collectors and how

| Existing tool | Reuse |
|---|---|
| `tools/latency` (`e2e.cjs`, `report.cjs`, `ws-proxy.cjs`) | `adapters.latency_report` takes only a complete PASS verdict and converts its trials to port-side `latency.*` samples; its ws-proxy is the impairment for C10-C12 (same proxy hash on both sides). Its Ping/Pong RTT is summary-only, so `net.socket_rtt_ms` is reported absent. |
| rh-server `GET /control/health` | `adapters.server_health_series` turns successive bodies into per-window `server.ticks`, budget misses (late + dropped steps) and RSS where available; per-window step time is reported absent (cumulative histogram only). |
| First-playable / domain browser receipts | Their window definition, GPU timer query, synchronous-callback CPU and environment block are the model for the shared recorder; `adapters.first_playable_receipt` explains why the receipts themselves are not admissible. |
| `tools/map-bench` | The one genuinely paired raw benchmark: `adapters.map_bench_result` recomputes its summaries from raw samples and classifies it as a slice. |
| `tools/perfproof` + `.github/workflows/perfproof.yml` | The port-internal optimise-then-repeat regression gate (R-OPT-4); `adapters.perfproof_report` marks it not cross-stack. |
| `densitybench` | Port-side planning input for which room counts C06-C09 bracket; paused clock, so not admissible for real-time density. |
| `packages/server/bench/stepBench.ts`, client `PerfSampler` | Legacy references for C05 and the legacy frame histogram; both are summary-only today (see remaining work). |

## Existing receipts through the adapters

[existing-receipts-assessment.json](existing-receipts-assessment.json) reads five committed receipts (by hash, unchanged)
and copies no private string:

- first-playable normal, first-playable uncapped and domain normal browser receipts: not admissible; 10-13 channels
  hold quantiles without raw values, single stack, no matrix cell or pinned map, and 2-4 values per receipt are a
  home-directory path, a player name or a player-identifying URL parameter (counted, not copied). The uncapped one is
  also a diagnostic-only receipt.
- stage2 map-bench: genuinely paired (same 40 seeds and hashes per mode, alternating order) but a slice and measured
  from a dirty tree; its stored medians are midpoint medians (three truncated to integer ns), which the raw samples
  reproduce.
- input-latency Linux RTT sweep: PASS verdict, port-only Unity trace, 3 events per profile (the matrix requires 30 per
  trial); not pairable without a stack-neutral endpoint.

## Blockers for the final campaign (precise)

1. Root has not admitted the integrated full runtime; every cell's mechanics list requires it.
2. Legacy live map selection: no seam selects `7:0:6255dbbe` (crypto-random `MapPool`); legacy game code is outside
   this lane.
3. Per-window raw step times are not exported by rh-server (cumulative quantiles only) or by legacy live rooms.
4. Per-window server-side load counts (privileged, never sent to clients) are not exported by either stack.
5. No stack-neutral input-to-visible endpoint exists (the post-Present trace is Unity-only); C10-C12 cannot run.
6. The shared page recorder (rAF timestamps, wrapped-callback CPU, WebGL timer query, socket byte tap, self-timer,
   minimal mode for the A/B control) and the OS process sampler do not exist yet; they are browser/OS instrumentation
   this lane was told not to run.
7. Thresholds, floors, window lengths and the trial order are proposals awaiting ratification; D7's 16.7 ms p99
   backstop conflicts with R-WEB-3 and is flagged in [COMPARABILITY_LIMITS.md](COMPARABILITY_LIMITS.md).

## Files

- [EXPERIMENT_MATRIX.md](EXPERIMENT_MATRIX.md): the rendered matrix (a test fails if it drifts from the JSON).
- [COMPARABILITY_LIMITS.md](COMPARABILITY_LIMITS.md): what stays different or unproven, and the D7 flag.
- [existing-receipts-assessment.json](existing-receipts-assessment.json): adapters over committed receipts.
- `synthetic/SYNTHETIC-controls-receipt.json`: every control's verdict, codes and report hash (a test re-runs and compares).
- `synthetic/SYNTHETIC-C13-report.json`, `-verdict.json`, `-summary.json`: one small worked example (cold startup cell).
- `synthetic/SYNTHETIC-content-pairing.json`: the stand-in content-correspondence receipt the synthetic pairs cite.
