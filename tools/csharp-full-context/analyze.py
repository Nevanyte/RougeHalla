#!/usr/bin/env python3
"""Reconcile every diagnostic sample; report surplus without changing the NUnit budget result."""
import argparse
from collections import Counter
import json
from pathlib import Path


def require(ok, why):
    if not ok:
        raise ValueError(why)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    p.add_argument("--expected-windows", type=int, required=True)
    args = p.parse_args()
    rows = [json.loads(f.read_text()) for f in args.directory.glob("*.json")]
    require(len(rows) == args.expected_windows, "missing/extra trace windows")
    rows.sort(key=lambda r: r["ordinal"])
    require([r["ordinal"] for r in rows] == list(range(1, len(rows)+1)), "missing/duplicate windows")
    output = []
    for r in rows:
        require(r["format"] == "rh-allocation-full-context/1", "trace format")
        require(r["warmup"] == 200 and r["iterations"] == 20000, "measurement contract")
        count = r["captured"]
        require(0 <= count <= 20000, "captured count")
        arrays = ["before", "after", "started", "ended", "threads", "indices",
                  "gen0Before", "gen0After", "gen1Before", "gen1After", "gen2Before", "gen2After"]
        require(all(len(r[k]) == 20000 for k in arrays), "raw array length")
        require(r["indices"][:count] == list(range(200, 200+count)), "no discarded measured index")
        require(count == 0 or (len(set(r["threads"][:count])) == 1 and r["threads"][0] != r["callerThread"]), "worker contract")
        deltas = [r["after"][i]-r["before"][i] for i in range(count)]
        require(sum(deltas) == r["bodyCounterDeltaSum"], "delta sum")
        if r["windowCompleted"]:
            require(count == 20000 and r["invocations"] == 20200 and r["failureType"] is None, "full window contract")
            total = r["windowAfter"]-r["windowBefore"]
            require(total == r["totalBytes"] and total-sum(deltas) == r["outsideBodyCounterDelta"], "aggregate reconciliation")
        else:
            require(r["failureType"] is not None and r["totalBytes"] is None, "partial is never reported as a zero-allocation success")
            total = None
        histogram = Counter(deltas)
        common = histogram.most_common(1)[0][0] if count else None
        atypical = [{"index": i+200, "delta": d,
                    "gc0": [r["gen0Before"][i], r["gen0After"][i]],
                    "gc1": [r["gen1Before"][i], r["gen1After"][i]],
                    "gc2": [r["gen2Before"][i], r["gen2After"][i]]}
                   for i, d in enumerate(deltas) if d != common]
        output.append({"ordinal": r["ordinal"], "test": r["test"], "captured": count,
                       "runtime": r["runtime"], "os": r["os"], "architecture": r["architecture"],
                       "totalBytes": total, "outsideBodyCounterDelta": r["outsideBodyCounterDelta"],
                       "histogram": dict(sorted(histogram.items())), "nonModalCount": len(atypical), "firstNonModalExamples": atypical[:8],
                       "backgroundIndex": [r["backgroundIndexBefore"], r["backgroundIndexAfter"]],
                       "gc0Span": [r["gen0Before"][0], r["gen0After"][count-1]] if count else None,
                       "gc1Span": [r["gen1Before"][0], r["gen1After"][count-1]] if count else None,
                       "gc2Span": [r["gen2Before"][0], r["gen2After"][count-1]] if count else None})
    print(json.dumps({"scope": "All windows reconciled, no filtering/correction. NUnit result remains independent; GC overlap alone is not causality.",
                      "windows": len(rows), "capturedSamples": sum(r["captured"] for r in rows), "records": output}, indent=2))


if __name__ == "__main__":
    main()
