#!/usr/bin/env python3
"""Measures ground tints on rendered pixels (P-UNITY-GROUND-TINT-1). The coordinator runs this on capture PNGs before and after the
implementation; it is the screen-level oracle that the gated tests (RoguehallaNet.Tests/GroundTint*.cs) cannot be.

Why: the first attempt at the Sentenced floor (P-UNITY-SENTENCED-TILES-1) passed every test that modelled colours as albedo and looked wrong on
screen. Every number here is read from sRGB pixels of the real ArenaView, through the real ground shader, lit as in the client.

Capture (graphics on, never -nographics). The capture tool is LandmarkPreviewCapture.cs, an uncommitted editor script (the coordinator's copy with the
-lmVariants scene; see the packet's Established facts for its flags), run as
    <unity> -batchmode -projectPath client-unity/UnityProject -executeMethod Roguehalla.Client.LandmarkPreviewCapture.Run -lmTime 12.5 -lmGroundOnly 1 \
        -lmVariants 1 -lmPatches "$(ground-tint-measure.py --print-edge-patches)" -lmLabel edge -lmOut <dir>
    (-lmTime needs the fixed-time shader patch: RhSun.hlsl reads _RhFixedTime. ONE process renders all three frames of a zone: between processes the frames drift a little
    in Plague and Holy, cause not found, so never compare frames from two runs.)
writes <zone>-var-base.png (open floor, one prop, variant plane all 0), <zone>-var-codes.png (the real server codes through BakeVariants) and
<zone>-var-edge.png (the same frame with strong explicit texels, for the edge geometry only) for fire, sentenced, plague, frost, holy.  Same camera and
frame in all three, so a tile's pixels compare like for like:
    codes 3..8 are 4 x 4 tile patches at tile (16 + 5 * (code - 3), 22); codes 1 and 2 at (16, 34) and (21, 34);
    the camera centres tile (31, 31.5) with orthographic size 9 on 1920 x 1080: 60 px per tile across, 46.8 px per tile down.

Usage:
    ground-tint-measure.py <dir with the *-var-base.png/-codes.png> [--zones fire,sentenced,...] [--check] [--json out.json]
Without --check it prints the table only (the "before" baseline). With --check it also applies THRESHOLDS below and exits 1 on any failure.

Measures per zone and code, over the central 2 x 2 tiles of the patch (clear of the edges), banded image against base image:
    dE      CIE76 distance between the mean CIELAB colours of the same tiles banded and unbanded.
    dC      change of mean CIELAB chroma C* (banded minus base): "saturation raised by" (HSV saturation is not used for the check: a flat pastel fill
            LOWERS it, and it is unstable on dark grounds; it is printed as dS).
    dS      change of HSV saturation of the mean sRGB colour (banded minus base), information only.
    dL      change of mean CIE L* (banded minus base).
    contrast  std of CIE L* over a tile's pixels (3 px margin), banded divided by base, mean over the 4 tiles.
    edge    (from the -edge frame) for the patch's left and right edges: interquartile spread of the transition's x position over the patch rows, in tiles (0 = a straight
            line; the edge follows tile boundaries exactly when this is below edge_p2p_max), and the mean offset from the nominal boundary.
Dependencies: python3, numpy, Pillow.
"""
import json
import sys

import numpy as np
from PIL import Image

PX_X, PX_Y = 60.0, 46.8          # pixels per tile (orthographic size 9, 16:9, ground squash .78)
CX, CY = 31.0, 31.5              # tile at the centre of the frame
W, H = 1920, 1080
ZONES = {"fire": 1, "sentenced": 2, "plague": 3, "frost": 4, "holy": 5}


def patch_tile(code):
    """Top-left tile of the 4 x 4 patch of this variant code in the capture scene."""
    if code >= 3:
        return 16 + 5 * (code - 3), 22
    return 16 + 5 * (code - 1), 34


def tile_rect(tx, ty, margin=3):
    x0 = W / 2 + (tx - CX) * PX_X
    y0 = H / 2 + (ty - CY) * PX_Y
    return int(round(x0)) + margin, int(round(x0 + PX_X)) - margin, int(round(y0)) + margin, int(round(y0 + PX_Y)) - margin


def load(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(v):
    v = np.clip(v, 0, 1)
    return 255.0 * np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def lab(c):
    """CIELAB (D65) of sRGB bytes, any shape (..., 3)."""
    lin = srgb_to_lin(np.asarray(c, dtype=np.float64))
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    xyz = np.stack([(0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, 0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
                    (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883], axis=-1)   # explicit sums: numpy's matmul warns spuriously on some macOS builds
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def hsv_sat(rgb):
    mx, mn = float(np.max(rgb)), float(np.min(rgb))
    return 0.0 if mx <= 0 else (mx - mn) / mx


def tile_stats(img, tx, ty):
    x0, x1, y0, y1 = tile_rect(tx, ty)
    px = img[y0:y1, x0:x1].reshape(-1, 3)
    L = lab(px)
    return {"mean_rgb": px.mean(axis=0), "mean_lab": L.mean(axis=0), "std_L": float(L[:, 0].std())}


def chroma(lab_rgb):
    return float(np.hypot(lab_rgb[1], lab_rgb[2]))


def patch_measure(base, banded, code):
    tx0, ty0 = patch_tile(code)
    de, ds, dl, dc, ct, base_rgb, band_rgb = [], [], [], [], [], [], []
    for dy in (1, 2):
        for dx in (1, 2):
            b, t = tile_stats(base, tx0 + dx, ty0 + dy), tile_stats(banded, tx0 + dx, ty0 + dy)
            de.append(float(np.linalg.norm(b["mean_lab"] - t["mean_lab"])))
            ds.append(hsv_sat(t["mean_rgb"]) - hsv_sat(b["mean_rgb"]))
            dl.append(float(t["mean_lab"][0] - b["mean_lab"][0]))
            dc.append(chroma(t["mean_lab"]) - chroma(b["mean_lab"]))
            ct.append(t["std_L"] / b["std_L"] if b["std_L"] > 1e-9 else float("nan"))
            base_rgb.append(b["mean_rgb"]); band_rgb.append(t["mean_rgb"])
    return {"dE": float(np.mean(de)), "dS": float(np.mean(ds)), "dL": float(np.mean(dl)), "dC": float(np.mean(dc)), "contrast": float(np.nanmean(ct)),
            "base_rgb": np.mean(base_rgb, axis=0).round(1).tolist(), "band_rgb": np.mean(band_rgb, axis=0).round(1).tolist()}


def edge_positions(base, strong, tx0, ty0, side):
    """Per pixel row of the patch, the x of the transition between untinted and tinted pixels near the patch's left or right edge.
    A pixel differs from the base when any channel differs by >= 6 (the strong frame changes nearly every pixel by more; the renderer is not bit exact in Fire, Plague,
    Frost and Holy: a few levels of noise). The transition is the first (left edge) or last (right edge) x where at least 75 percent of the 12 pixels on the tinted side
    differ and at most 25 percent of the 12 on the other side do."""
    xs = []
    nominal = W / 2 + ((tx0 if side == "left" else tx0 + 4) - CX) * PX_X
    lo, hi = int(nominal) - 45, int(nominal) + 45
    ys = range(int(H / 2 + (ty0 + 0.3 - CY) * PX_Y), int(H / 2 + (ty0 + 3.7 - CY) * PX_Y))
    for y in ys:
        diff = (np.abs(strong[y, lo - 12:hi + 12] - base[y, lo - 12:hi + 12]).max(axis=1) >= 6.0).astype(float)
        found = None
        for x in range(12, 12 + (hi - lo)):
            before, after = diff[x - 12:x].mean(), diff[x:x + 12].mean()
            if side == "left" and after >= .75 and before <= .25:
                found = x; break
            if side == "right" and before >= .75 and after <= .25:
                found = x
        if found is not None:
            xs.append(lo + found - 12)
    return np.array(xs, dtype=np.float64), nominal


def edge_measure(base, strong, code):
    tx0, ty0 = patch_tile(code)
    out = {}
    for side in ("left", "right"):
        xs, nominal = edge_positions(base, strong, tx0, ty0, side)
        if len(xs) < 20:
            out[side] = {"p2p": float("nan"), "offset": float("nan"), "rows": int(len(xs))}
        else:
            out[side] = {"p2p": float((np.percentile(xs, 98) - np.percentile(xs, 2)) / PX_X), "offset": float((np.median(xs) - nominal) / PX_X), "rows": int(len(xs))}   # interquartile: rows of render noise (the renderer is not bit exact in Fire, Plague and Holy) must not count as a wobble
    return out


# The strong explicit texels of the -edge frame: all six patches (codes 3..8 positions) at gain 1.99 in red and .31 in green and blue, strength 255.
EDGE_PATCHES = ";".join("%d,22,4,4,255,40,40,255" % (16 + 5 * j) for j in range(6))

# ---- thresholds (the brief's numbers, adjusted by the packet's measurements: see Established facts) ----------------------------------------------
# Codes 1..6 (rings and bands) are "quiet": a small even step. The capture tool's Fire and Plague grounds are darker than the Web client's and its Plague is
# green-dominant (the renderer's colour crosstalk shrinks tints there), so the lower bound is low; the Web-colour bounds (4 to 10) are in the gated tests.
# Water (7) and mud (8) exist in Plague only and may step more.
THRESHOLDS = {
    "band_dE": (1.5, 10.0),            # codes 1..6, every zone
    "band_dC_max": 8.0,                # codes 1..6: chroma raised by at most this (CIELAB C*)
    "water_mud_dE": (2.5, 25.0),       # codes 7, 8 in plague
    "contrast_min": 0.80,              # every code (7 and 8 in plague only): std of L* banded / base
    "edge_p2p_max": 0.04,              # tiles, interquartile spread over the patch rows (today's warp: see the packet baseline): the band edge follows the tile boundary
    "edge_offset_max": 0.12,           # tiles: and sits on it
}


def main(argv):
    if len(argv) < 2 or argv[1].startswith("--"):
        if "--print-edge-patches" in argv:
            print(EDGE_PATCHES); return 0
        print(__doc__); return 2
    d = argv[1]
    zones = list(ZONES)
    if "--zones" in argv:
        zones = argv[argv.index("--zones") + 1].split(",")
    check = "--check" in argv
    results, failures = {}, []
    print("%-10s %4s %7s %7s %7s %7s %9s %10s %10s   %s -> %s" % ("zone", "code", "dE", "dC", "dS", "dL", "contrast", "edge p2p L", "edge p2p R", "base rgb", "banded rgb"))
    for z in zones:
        base, banded = load("%s/%s-var-base.png" % (d, z)), load("%s/%s-var-codes.png" % (d, z))
        try:
            strong = load("%s/%s-var-edge.png" % (d, z))
        except FileNotFoundError:
            strong = None
            if check:
                failures.append("%s: %s-var-edge.png is missing (render the edge frame: ground-tint-measure.py --print-edge-patches prints its -lmPatches)" % (z, z))
        for code in range(1, 9):
            m = patch_measure(base, banded, code)
            e = edge_measure(base, strong, code) if (code >= 3 and strong is not None) else None
            m["edge"] = e
            results["%s/%d" % (z, code)] = m
            pl, pr = (e["left"]["p2p"], e["right"]["p2p"]) if e else (float("nan"), float("nan"))
            print("%-10s %4d %7.2f %+7.2f %+7.3f %+7.2f %9.3f %10.3f %10.3f   %s -> %s" % (z, code, m["dE"], m["dC"], m["dS"], m["dL"], m["contrast"], pl, pr, m["base_rgb"], m["band_rgb"]))
            if not check:
                continue
            checked_look = code <= 6 or z == "plague"      # water and mud exist in Plague only
            if checked_look:
                lo, hi = THRESHOLDS["water_mud_dE"] if code >= 7 else THRESHOLDS["band_dE"]
                if not (lo <= m["dE"] <= hi):
                    failures.append("%s code %d: colour step %.2f CIE76 outside [%.1f, %.1f]" % (z, code, m["dE"], lo, hi))
                if code <= 6 and m["dC"] > THRESHOLDS["band_dC_max"]:
                    failures.append("%s code %d: chroma raised by %.2f (max %.1f)" % (z, code, m["dC"], THRESHOLDS["band_dC_max"]))
                if not (m["contrast"] >= THRESHOLDS["contrast_min"]):
                    failures.append("%s code %d: texture contrast %.3f of the untinted tile (min %.2f)" % (z, code, m["contrast"], THRESHOLDS["contrast_min"]))
            if e and (code <= 6 or z == "plague"):
                for side in ("left", "right"):
                    s = e[side]
                    if not (s["p2p"] <= THRESHOLDS["edge_p2p_max"]):
                        failures.append("%s code %d: %s edge wobbles %.3f tiles (interquartile) (max %.2f)" % (z, code, side, s["p2p"], THRESHOLDS["edge_p2p_max"]))
                    if not (abs(s["offset"]) <= THRESHOLDS["edge_offset_max"]):
                        failures.append("%s code %d: %s edge is %.3f tiles off the tile boundary (max %.2f)" % (z, code, side, s["offset"], THRESHOLDS["edge_offset_max"]))
    if "--json" in argv:
        with open(argv[argv.index("--json") + 1], "w") as f:
            json.dump(results, f, indent=1)
    if check:
        print("\n" + ("FAIL: %d checks" % len(failures) if failures else "PASS"))
        for f in failures:
            print("  " + f)
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
