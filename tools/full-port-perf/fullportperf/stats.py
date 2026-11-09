"""Order statistics from raw samples. Nearest-rank percentiles, as the first-playable receipts used, so a reported
percentile is always an observed sample; histogram quantiles are bucket upper bounds and say so."""

import math

PERCENTILES = (50, 90, 95, 99, 99.9)


def nearest_rank(sorted_values, p):
    """The smallest sample with at least p% of the samples at or below it (p in (0, 100])."""
    if not sorted_values:
        raise ValueError("no samples")
    if not 0 < p <= 100:
        raise ValueError(f"percentile {p} outside (0, 100]")
    rank = math.ceil(p / 100.0 * len(sorted_values))
    return sorted_values[max(1, rank) - 1]


def describe(values):
    """count/min/max/mean and nearest-rank percentiles. Mean uses math.fsum (exact rounding, order independent)."""
    if not values:
        raise ValueError("no samples")
    s = sorted(values)
    out = {"count": len(s), "min": s[0], "max": s[-1], "mean": math.fsum(s) / len(s)}
    for p in PERCENTILES:
        out[pkey(p)] = nearest_rank(s, p)
    return out


def pkey(p):
    return "p" + (str(p).replace(".", "_") if p != int(p) else str(int(p)))


def median(values):
    return nearest_rank(sorted(values), 50)


def histogram_describe(bounds, counts):
    """`bounds[i]` is the inclusive upper edge of bucket i (the last may be None: overflow). Quantiles are the upper edge
    of the bucket holding that rank, so they are never below the true value; overflow ranks report None."""
    if len(bounds) != len(counts):
        raise ValueError("histogram bounds and counts differ in length")
    total = sum(counts)
    if total <= 0:
        raise ValueError("empty histogram")
    out = {"count": total, "resolution": "bucket-upper-bound"}
    for p in PERCENTILES:
        rank = max(1, math.ceil(p / 100.0 * total))
        seen = 0
        val = None
        for b, c in zip(bounds, counts):
            seen += c
            if seen >= rank:
                val = b
                break
        out[pkey(p)] = val
    out["overflowCount"] = counts[-1] if bounds[-1] is None else 0
    return out


def consecutive_jitter(values):
    """Mean absolute difference between consecutive samples (RFC 3550-style interarrival variation, unsmoothed)."""
    if len(values) < 2:
        return None
    return math.fsum(abs(b - a) for a, b in zip(values, values[1:])) / (len(values) - 1)
