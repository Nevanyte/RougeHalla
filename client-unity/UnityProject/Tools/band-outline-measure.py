#!/usr/bin/env python3
"""Measures how straight the outline of a decoration band is on rendered pixels (P-UNITY-GROUND-BANDS-1). Not in the gate: the PNGs need graphics.

Input: the three PNGs of Tools/band-outline-check.sh (Assets/Editor/Look/BandOutlineCapture.cs), one 60 x 60 Plague map, ground only, camera on the middle of a 6 x 4 bog
pool (tiles x 27..32, y 28..31), the server's marsh bands round it (water 7 at distance 1, mud 8 at 2..3):
    band-with.png      the bands drawn
    band-without.png   the same map, empty variant plane
    band-without2.png  a second render of that (the noise of one tree: wind and light run on the shader clock)
Pixels per tile: 60 across, 46.8 down (orthographic size 9, 16:9, ground squash .78); image centre = tile (30, 30).

How the outline is found (no colour model, no guess at the band's hue):
  1. D = |box-blurred ((with - without) . u)|, u the unit colour-change vector of the mud tile (below), blurred over a 13 px window: the signed difference is projected on the band's
     own colour direction, so the grass's animation (noise of both signs) averages out. Units are sRGB 0..255 along u.
  2. L = median of blurred D over the middle of the mud tile at distance 2 (x 25, y 30; 1.5 tiles inside the band's outer edge, clear of the soft edge). THR = fraction * L, the
     fraction being 0.5: the half-strength contour of the band.
  3. The band mask is blurred D > THR inside the ring's bounding box (tiles x 24..35, y 25..34, plus one tile). The outer outline is the outermost mask pixel of each pixel column (top
     and bottom profiles) and each pixel row (left and right profiles).
  4. The longest straight run is the longest stretch of a profile whose values stay within TOL (the outline's own position, 0.15 tile by default) of each other, in tiles along the
     outline. A hard, tile-aligned square gives a run of the side's whole length (12 tiles across, 10 down, less the corner blur).
Sensitivity: the table of threshold fractions .35 .5 .65 against tolerances .10 .15 .25 tile is printed; the headline is (.5, .15). A noise check compares the blurred
|without - without2| (its 99th percentile, projected the same way) with THR and warns when it is above 60 percent of THR (the numbers are then unreliable).
Also printed: the mean sRGB of the middle of the mud tile at distance 2 and of the water tile at distance 1 (x 26, y 30), with and without, for "a tile inside the band differs from
today's by no more than render noise": compare these across trees (the without image is the same map, so its means are the noise reference).

Usage: band-outline-measure.py <dir> [--max <tiles>]      exit 1 when the headline run is >= --max (acceptance: 1.5), 2 on bad input.
Dependencies: python3, numpy, Pillow.
"""
import sys

import numpy as np
from PIL import Image

PX_X, PX_Y = 60.0, 46.8
BLUR = 6                               # box radius in pixels (window 13)
W, H = 1920, 1080
CX, CY = 30.0, 30.0
RING = (24, 25, 35, 34)                # tile bbox of the outer ring: x0, y0, x1, y1 (inclusive)


def load(path):
    try:
        return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    except OSError as e:
        print("band-outline-measure: cannot read %s: %s" % (path, e), file=sys.stderr)
        sys.exit(2)


def box(a, r):
    """Separable box blur of radius r (window 2r+1), edge-replicated."""
    k = 2 * r + 1
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis)
        n = a.shape[axis]
        a = (np.take(c, range(k, k + n), axis=axis) - np.take(c, range(0, n), axis=axis)) / k
    return a


def tile_px(tx, ty):
    return (W / 2 + (tx - CX) * PX_X, H / 2 + (ty - CY) * PX_Y)


def tile_slice(tx, ty, frac=.5):
    """Pixel slices of the middle `frac` of a tile."""
    x0, y0 = tile_px(tx, ty)
    mx, my = PX_X * (1 - frac) / 2, PX_Y * (1 - frac) / 2
    return slice(int(round(y0 + my)), int(round(y0 + PX_Y - my))), slice(int(round(x0 + mx)), int(round(x0 + PX_X - mx)))


def longest_run(profile, tol_px):
    """Longest count of consecutive entries whose max - min <= tol_px."""
    n, best, j = len(profile), 0, 0
    from collections import deque
    mx, mn = deque(), deque()
    for i in range(n):
        v = profile[i]
        while mx and profile[mx[-1]] <= v:
            mx.pop()
        mx.append(i)
        while mn and profile[mn[-1]] >= v:
            mn.pop()
        mn.append(i)
        while profile[mx[0]] - profile[mn[0]] > tol_px:
            j += 1
            while mx[0] < j:
                mx.popleft()
            while mn[0] < j:
                mn.popleft()
        best = max(best, i - j + 1)
    return best


def outline_runs(blurred, thr, tol_tiles):
    """(longest run in tiles, which side) over the four profiles of the outer outline."""
    x0, y0 = tile_px(RING[0] - 1, RING[1] - 1)
    x1, y1 = tile_px(RING[2] + 2, RING[3] + 2)
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    mask = blurred[y0:y1, x0:x1] > thr
    out = []
    for name, prof, along, normal in (("top", None, PX_X, PX_Y), ("bottom", None, PX_X, PX_Y), ("left", None, PX_Y, PX_X), ("right", None, PX_Y, PX_X)):
        if name in ("top", "bottom"):
            cols = [np.flatnonzero(mask[:, c]) for c in range(mask.shape[1])]
            keep = [i for i, c in enumerate(cols) if len(c)]
            p = [cols[i][0] if name == "top" else cols[i][-1] for i in keep]
        else:
            rows = [np.flatnonzero(mask[r, :]) for r in range(mask.shape[0])]
            keep = [i for i, r in enumerate(rows) if len(r)]
            p = [rows[i][0] if name == "left" else rows[i][-1] for i in keep]
        if len(p) < 10:
            out.append((0.0, name))
            continue
        out.append((longest_run(p, tol_tiles * normal) / along, name))
    return max(out)


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    d = argv[1].rstrip("/")
    limit = float(argv[argv.index("--max") + 1]) if "--max" in argv else None
    a, b, b2 = load(d + "/band-with.png"), load(d + "/band-without.png"), load(d + "/band-without2.png")
    if not (a.shape == b.shape == b2.shape == (H, W, 3)):
        print("band-outline-measure: images must be %d x %d" % (W, H), file=sys.stderr)
        return 2
    ys, xs = tile_slice(25, 30)
    mean = (a - b)[ys, xs].mean(axis=(0, 1))
    u = mean / max(float(np.linalg.norm(mean)), 1e-9)       # the band's colour change in the mud tile: the direction every pixel is projected on
    D = np.abs(box((a - b)[:, :, 0] * u[0] + (a - b)[:, :, 1] * u[1] + (a - b)[:, :, 2] * u[2], BLUR))
    Nz = np.abs(box((b2 - b)[:, :, 0] * u[0] + (b2 - b)[:, :, 1] * u[1] + (b2 - b)[:, :, 2] * u[2], BLUR))
    level = float(np.median(D[ys, xs]))
    if level < 8:
        print("band-outline-measure: the band is not visible in the difference image (level %.1f): wrong scene or the band is not drawn" % level, file=sys.stderr)
        return 2
    noise = float(np.percentile(Nz, 99))
    print("level=%.1f noise_p99=%.1f (sRGB units along u)" % (level, noise))
    if noise > .6 * .5 * level:
        print("WARNING: the noise of one tree is above 60 percent of the half-strength threshold: the numbers are unreliable")
    print("tile_mean_rgb (with / without):")
    for name, (tx, ty) in (("mud d2 (25,30)", (25, 30)), ("water d1 (26,30)", (26, 30))):
        ys, xs = tile_slice(tx, ty)
        print("  %-18s with=%s without=%s" % (name, tuple(round(float(v), 1) for v in a[ys, xs].mean(axis=(0, 1))), tuple(round(float(v), 1) for v in b[ys, xs].mean(axis=(0, 1)))))
    print("longest straight run of the band's outer outline, in tiles (rows: threshold fraction of the band's level; columns: tolerance in tiles):")
    fracs, tols = (.35, .5, .65), (.10, .15, .25)
    print("          " + "".join("tol=%.2f      " % t for t in tols))
    head = None
    for f in fracs:
        row = []
        for t in tols:
            run, side = outline_runs(D, f * level, t)
            row.append("%5.2f (%s)" % (run, side[0]))
            if f == .5 and t == .15:
                head = run
        print("  thr=%.2f " % f + "  ".join(row))
    print("outline_longest_run_tiles=%.2f" % head)
    if limit is not None and head >= limit:
        print("FAIL: longest straight run %.2f tiles >= %.2f" % (head, limit), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
