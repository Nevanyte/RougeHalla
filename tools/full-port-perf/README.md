# Matched full-port performance preparation

Preparation tooling for the final P-LOAD-3 / R-OPT-4 comparison of the legacy TypeScript/Colyseus/Phaser game against
the Rust native server plus the actual Unity Web client on the Apple M5 Pro. **It measures nothing and launches nothing.**
It decides whether a legacy/port report pair is admissible, computes deterministic summaries from raw data, and holds the
bounded final experiment matrix. Python 3 standard library only (the repository uses 3.13).

```sh
python3 tools/full-port-perf/fpp.py matrix                         # validate the matrix, print its hash and time bound
python3 tools/full-port-perf/fpp.py validate REPORT --repo .       # ADMITTED / ADMITTED-SYNTHETIC-CONTROL / REFUSED (exit 1)
python3 tools/full-port-perf/fpp.py summarize REPORT --repo .      # summary from raw data of an admitted report only
python3 tools/full-port-perf/fpp.py controls --repo .              # every SYNTHETIC admission and refusal control
python3 tools/full-port-perf/fpp.py assess-existing --repo .       # existing receipts through the adapters (read only)
python3 -m unittest discover -s tools/full-port-perf/tests -v      # the test suite
```

| File | Role |
|---|---|
| `final-matrix.json` | The exact, bounded experiment matrix (15 cells; thresholds await ratification before the first run). Rendered view: `docs/evidence/full-port-perf-preparation/EXPERIMENT_MATRIX.md` (`fpp.py matrix --markdown`). |
| `scripts/*.json` | Stack-neutral scripted browser input (R-GAME-2 controls only); both sides report the script's canonical SHA-256. |
| `fullportperf/registry.py` | Metric vocabulary: one id, unit, family and allowed instrument per quantity; families that must stay apart cannot merge. |
| `fullportperf/admission.py` | The paired-workload validator (rules listed in its module docstring). |
| `fullportperf/summary.py` | Deterministic summaries (nearest-rank percentiles) from raw samples; no wall-clock content. |
| `fullportperf/adapters.py` | Adapters over existing collectors: `tools/latency` reports, rh-server `/control/health`, the first-playable receipts, `tools/map-bench`, `tools/perfproof`, `densitybench`. |
| `fullportperf/synthetic.py` | SYNTHETIC admissible pairs for every cell and named refusal controls. Never evidence of performance. |

A report is a JSON object `rh-full-port-perf-report/1` with `sides.legacy` and `sides.port`, each holding builds,
environment, workload, recorder (with its A/B overhead control) and trials of contiguous windows of raw metric values.
Every metric is either `measured` with raw `samples`/`value` or `absent` with a reason; see `fullportperf/registry.py`.
`docs/evidence/full-port-perf-preparation/` holds the comparability limits, the controls receipt and a small example.
