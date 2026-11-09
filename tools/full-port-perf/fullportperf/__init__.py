"""Matched full-port performance preparation: report schema, admission validator, summaries, adapters and matrix.

Preparation only. Nothing in this package launches a browser, a server, a build or a benchmark. It reads JSON written by
the existing collectors (or by the SYNTHETIC control generator) and decides whether a legacy/port pair is admissible.
"""

FORMAT_REPORT = "rh-full-port-perf-report/1"
FORMAT_SUMMARY = "rh-full-port-perf-summary/1"
FORMAT_MATRIX = "rh-full-port-perf-matrix/1"
FORMAT_VERDICT = "rh-full-port-perf-verdict/1"
FORMAT_SCRIPT = "rh-full-port-perf-input-script/1"

SYNTHETIC_LABEL = "SYNTHETIC CONTROL - not a measurement of any build or machine"
