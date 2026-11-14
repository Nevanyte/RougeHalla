#!/usr/bin/env python3
"""Compares two PNG renders: how many pixels differ and by how much. Standard library only.

  look-compare.py <before.png> <after.png> [--crop] [--noise <a.png> <b.png>]
  look-compare.py --noise <a.png> <b.png>

One stdout line of key=value pairs: diff_px total_px max mean size bbox [crop=<path>] [noise_diff_px noise_max noise_mean].
--noise states the same for two renders of one tree (the figure a real change must stand out from).
--crop writes the bounding box of the difference, cut from <after>, as <after-stem>-diff-crop.png beside it.
A refusal (sizes differ, unreadable file, bad arguments) prints one line to stderr and exits 2.
8-bit RGB or RGBA, non-interlaced PNG; alpha is ignored.
"""
import os
import struct
import sys
import zlib


class Refusal(Exception):
    pass


def read_png(path):
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        raise Refusal("cannot read %s: %s" % (path, e.strerror))
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise Refusal("%s is not a PNG" % path)
    pos, ihdr, idat = 8, None, []
    while pos + 8 <= len(data):
        n, typ = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b"IHDR":
            ihdr = body
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
    if ihdr is None or not idat:
        raise Refusal("%s is not a readable PNG" % path)
    w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", ihdr)
    if depth != 8 or ctype not in (2, 6) or interlace != 0:
        raise Refusal("%s: only 8-bit RGB or RGBA, non-interlaced PNG is supported" % path)
    bpp = 3 if ctype == 2 else 4
    stride = w * bpp
    try:
        raw = zlib.decompress(b"".join(idat))
    except zlib.error:
        raise Refusal("%s: corrupt image data" % path)
    if len(raw) < (stride + 1) * h:
        raise Refusal("%s: truncated image data" % path)
    rows, prev = [], bytearray(stride)
    for y in range(h):
        o = y * (stride + 1)
        f = raw[o]
        cur = bytearray(raw[o + 1:o + 1 + stride])
        if f == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = cur[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                cur[i] = (cur[i] + pr) & 255
        elif f != 0:
            raise Refusal("%s: bad filter type %d" % (path, f))
        rows.append(cur)
        prev = cur
    return w, h, bpp, rows


def compare(a, b):
    """Returns (diff_px, total_px, max, mean, w, h, bbox or None)."""
    wa, ha, ba, ra = a
    bb, rb = b[2], b[3]
    diff = mx = total = 0
    x0, y0, x1, y1 = wa, ha, -1, -1
    for y in range(ha):
        r1, r2 = ra[y], rb[y]
        if r1 == r2:
            continue
        for x in range(wa):
            p, q = x * ba, x * bb
            d0 = abs(r1[p] - r2[q])
            d1 = abs(r1[p + 1] - r2[q + 1])
            d2 = abs(r1[p + 2] - r2[q + 2])
            if d0 or d1 or d2:
                diff += 1
                total += d0 + d1 + d2
                m = max(d0, d1, d2)
                if m > mx:
                    mx = m
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    px = wa * ha
    return diff, px, mx, total / (3.0 * px), wa, ha, ((x0, y0, x1, y1) if diff else None)


def load_pair(p1, p2):
    a, b = read_png(p1), read_png(p2)
    if (a[0], a[1]) != (b[0], b[1]):
        raise Refusal("sizes differ: %s is %dx%d, %s is %dx%d" % (p1, a[0], a[1], p2, b[0], b[1]))
    return a, b


def write_crop(img, bbox, path):
    w, h, bpp, rows = img
    x0, y0, x1, y1 = bbox
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    raw = bytearray()
    for y in range(y0, y1 + 1):
        raw.append(0)
        for x in range(x0, x1 + 1):
            raw += rows[y][x * bpp:x * bpp + 3]

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", cw, ch, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main(argv):
    crop, noise, files, i = False, None, [], 0
    while i < len(argv):
        t = argv[i]
        if t == "--crop":
            crop = True
        elif t == "--noise":
            if len(argv) - i < 3:
                raise Refusal("--noise needs two images")
            noise = (argv[i + 1], argv[i + 2])
            i += 2
        elif t.startswith("-"):
            raise Refusal("unknown option %s" % t)
        else:
            files.append(t)
        i += 1
    if len(files) not in (0, 2) or (len(files) == 0 and noise is None):
        raise Refusal("usage: look-compare.py <before.png> <after.png> [--crop] [--noise <a.png> <b.png>]")
    parts = []
    if files:
        a, b = load_pair(files[0], files[1])
        diff, total, mx, mean, w, h, bbox = compare(a, b)
        parts += ["diff_px=%d" % diff, "total_px=%d" % total, "max=%d" % mx, "mean=%.6f" % mean, "size=%dx%d" % (w, h),
                  "bbox=" + ("%d,%d,%d,%d" % bbox if bbox else "none")]
        if crop and bbox:
            path = os.path.splitext(files[1])[0] + "-diff-crop.png"
            write_crop(b, bbox, path)
            parts.append("crop=" + path)
    if noise:
        a, b = load_pair(*noise)
        diff, total, mx, mean, w, h, bbox = compare(a, b)
        parts += ["noise_diff_px=%d" % diff, "noise_max=%d" % mx, "noise_mean=%.6f" % mean]
    print(" ".join(parts))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Refusal as e:
        sys.stderr.write("look-compare: %s\n" % e)
        sys.exit(2)
