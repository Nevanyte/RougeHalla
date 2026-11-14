#!/usr/bin/env python3
"""Render check of P-UNITY-FROST-WALL-READ-1: how well a standing Frost Wall and its aim preview read on the ground, measured on the
look-capture PNGs (not in the gate; the colour-model test FrostWallReadEditModeTests is the gated half, this is the half that sees pixels).

  wall-read-check.py <dir with frost-wall.png, frost-wall-cracking.png, frost-wall-preview.png, frost-wall-preview-invalid.png> [--check]
                     [--debug <dir>]   write each PNG with the sampling windows outlined, to see what was measured

Capture the PNGs with  client-unity/UnityProject/Tools/look-capture.sh frost-wall frost-wall-cracking frost-wall-preview \
frost-wall-preview-invalid --out <dir>  (1920 x 1080, sRGB). Dependencies: python3, numpy, Pillow.

Every number is a WCAG contrast ratio of RELATIVE LUMINANCE (0.2126 R + 0.7152 G + 0.0722 B on linearised sRGB, (hi+.05)/(lo+.05)), the same
definition as Tools/contrast-lib.cjs: the sampled element against the median luminance of the ground pixels just outside it (windows below).
Windows are pixel boxes in the capture's fixed frame (60 px per tile across, 46.8 down; the scenes are deterministic: LookCapture.BuildWallScene).
A column of tiles that a pine or crystal overlaps is avoided; each element is the MEDIAN over its columns of the best row in a small band, so a
tree in one column does not move it. The valid preview's centre dot sits on an ice crystal in the capture scene, so it is reported but not gated here (the colour-model test gates it; the invalid scene's dot, on rock, is gated). A 1 px line is measured on its best row (that biases a faint line up by about 1.05, the ground's texture).

Prints one line per measure. With --check it applies FLOORS (the packet's acceptance bounds) and exits 1 when any is missed.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

# ---- floors (docs/backlog/packets/P-UNITY-FROST-WALL-READ-1.md section 8) ----
TOP_RATIO, EDGE_RATIO, FACE_OVER_TOP = 1.6, 3.0, 1.4
PREVIEW_CELL, PREVIEW_MARK, INVALID_MARK = 2.5, 2.0, 3.0
CRACK_CHANGE, CRACK_HUE = 1.25, 25

# ---- windows: (x0, x1, y0, y1), end exclusive ----
WALL_COLS = [(936, 984), (1116, 1164)]          # tiles 30 and 33 of the horizontal wall (tile 27 is x 750..810)
W = dict(
    top=(490, 516), face=(530, 557), north_rim=(477, 485), base=(560, 567), east_end=(1166, 1176),
    ground_n=(452, 472), ground_s=(572, 590),
)
VALID = dict(
    cols=[(780, 940), (1000, 1160)], outline_rows=(359, 367), fill_rows=(372, 380), line_rows=(382, 389), dot=(954, 967, 380, 391),
    ground_rows=[(330, 355), (414, 438)], ring_cols=(940, 981), ring_rows=(38, 58), ring_ground=[(26, 36), (62, 72)],
)
INVALID = dict(
    cols=[(760, 940), (980, 1160)], line_rows=(289, 296), dot=(954, 967, 285, 299), ground_rows=[(268, 282), (302, 316)],
    ring_cols=(940, 981), ring_rows=(130, 150), ring_ground=[(118, 128), (152, 162)],
)


def lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def lum(px):
    l = lin(px)
    return .2126 * l[..., 0] + .7152 * l[..., 1] + .0722 * l[..., 2]


def ratio(a, b):
    hi, lo = np.maximum(a, b), np.minimum(a, b)
    return (hi + .05) / (lo + .05)


class Img:
    def __init__(self, path):
        self.path = path
        self.px = np.array(Image.open(path).convert('RGB'))
        self.L = lum(self.px)
        self.boxes = []

    def box(self, x0, x1, y0, y1, tag=''):
        self.boxes.append((x0, x1, y0, y1, tag))
        return self.L[y0:y1, x0:x1], self.px[y0:y1, x0:x1]

    def ground(self, cols, row_bands):
        v = [self.box(x0, x1, y0, y1, 'ground')[0].ravel() for (x0, x1) in cols for (y0, y1) in row_bands]
        return float(np.median(np.concatenate(v)))

    def median_color(self, cols, rows, tag):
        v = [self.box(x0, x1, rows[0], rows[1], tag)[1].reshape(-1, 3) for (x0, x1) in cols]
        return np.median(np.concatenate(v), axis=0)

    def median_lum(self, cols, rows, tag):
        return float(np.median(np.concatenate([self.box(x0, x1, rows[0], rows[1], tag)[0].ravel() for (x0, x1) in cols])))

    def best_rows(self, cols, rows, ground, tag):
        """Median over columns of (the best row's contrast ratio), and the rgb of the winning pixel of the median column."""
        per = []
        for (x0, x1) in cols:
            a = self.box(x0, x1, rows[0], rows[1], tag)[0]
            r = ratio(a, ground)
            per.append(r.max(axis=0))
        return float(np.median(np.concatenate(per)))

    def best_pixel(self, cols, rows, ground):
        best, rgb = 0.0, None
        for (x0, x1) in cols:
            a = self.L[rows[0]:rows[1], x0:x1]; r = ratio(a, ground)
            i = np.unravel_index(np.argmax(r), r.shape)
            if r[i] > best: best, rgb = float(r[i]), self.px[rows[0] + i[0], x0 + i[1]]
        return best, rgb

    def save_debug(self, outdir):
        im = Image.fromarray(self.px); d = ImageDraw.Draw(im)
        for (x0, x1, y0, y1, tag) in self.boxes:
            d.rectangle([x0 - 1, y0 - 1, x1, y1], outline=(255, 0, 255) if tag != 'ground' else (255, 160, 0))
        im.save(os.path.join(outdir, os.path.basename(self.path)))


def wall_numbers(im):
    g = im.ground(WALL_COLS, [W['ground_n'], W['ground_s']])
    out = {'ground_lum': g}
    out['top_ratio'] = float(ratio(im.median_lum(WALL_COLS, W['top'], 'top'), g))
    out['face_ratio_ground'] = float(ratio(im.median_lum(WALL_COLS, W['face'], 'face'), g))
    lt, lf = im.median_lum(WALL_COLS, W['top'], 'top'), im.median_lum(WALL_COLS, W['face'], 'face')
    out['face_over_top'] = float(ratio(lt, lf))
    n = im.best_rows(WALL_COLS, W['north_rim'], g, 'edge')
    s = im.best_rows(WALL_COLS, W['base'], g, 'edge')
    # east end: best column in the strip across the wall's end, median over rows
    a = im.box(W['east_end'][0], W['east_end'][1], W['top'][0], W['top'][1], 'edge')[0]
    e = float(np.median(ratio(a, g).max(axis=1)))
    out['edge_north'], out['edge_base'], out['edge_east'] = n, s, e
    out['edge_ratio'] = min(n, s, e)
    out['top_rgb'] = im.median_color(WALL_COLS, W['top'], 'top').astype(int).tolist()
    out['face_rgb'] = im.median_color(WALL_COLS, W['face'], 'face').astype(int).tolist()
    out['lum'] = {'top': lt, 'face': lf}
    return out


def preview_numbers(im, spec, valid):
    g = im.ground(spec['cols'], spec['ground_rows'])
    out = {'ground_lum': g}
    if valid:
        out['outline'] = im.best_rows(spec['cols'], spec['outline_rows'], g, 'outline')
        out['fill'] = float(ratio(im.median_lum(spec['cols'], spec['fill_rows'], 'fill'), g))
    out['line'], out['line_rgb'] = im.best_pixel(spec['cols'], spec['line_rows'], g)
    d = spec['dot']; out['dot'], out['dot_rgb'] = im.best_pixel([(d[0], d[1])], (d[2], d[3]), g)
    for (x0, x1, y0, y1) in [(spec['dot'][0], spec['dot'][1], spec['dot'][2], spec['dot'][3])]:
        im.box(x0, x1, y0, y1, 'dot')
    rg = im.ground([spec['ring_cols']], spec['ring_ground'])
    out['ring'] = im.best_rows([spec['ring_cols']], spec['ring_rows'], rg, 'ring')
    return out


def is_red(rgb):
    import colorsys
    h, sat, v = colorsys.rgb_to_hsv(*[int(c) / 255.0 for c in rgb])
    deg = h * 360.0
    return (deg >= 335 or deg <= 25) and sat >= .25


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'):
        print(__doc__); return 2
    d = argv[1]; check = '--check' in argv
    dbg = argv[argv.index('--debug') + 1] if '--debug' in argv else None
    need = ['frost-wall', 'frost-wall-cracking', 'frost-wall-preview', 'frost-wall-preview-invalid']
    for n in need:
        if not os.path.exists(os.path.join(d, n + '.png')):
            print('wall-read-check: missing %s.png in %s' % (n, d), file=sys.stderr); return 2
    imgs = {n: Img(os.path.join(d, n + '.png')) for n in need}
    for n, im in imgs.items():
        if im.px.shape != (1080, 1920, 3):
            print('wall-read-check: %s is %s, the windows are for 1920 x 1080' % (n, im.px.shape[:2][::-1]), file=sys.stderr); return 2
    fresh = wall_numbers(imgs['frost-wall']); crack = wall_numbers(imgs['frost-wall-cracking'])
    pv = preview_numbers(imgs['frost-wall-preview'], VALID, True)
    pi = preview_numbers(imgs['frost-wall-preview-invalid'], INVALID, False)
    # the crack: the same wall 500 ms from its end against fresh, element by element (the ground is the same pixels)
    ch = {}
    ch['top'] = float(ratio(crack['lum']['top'], fresh['lum']['top']))
    ch['face'] = float(ratio(crack['lum']['face'], fresh['lum']['face']))
    a = imgs['frost-wall'].L; b = imgs['frost-wall-cracking'].L
    rim = []
    for (x0, x1) in WALL_COLS:
        ya, yb = W['north_rim'][0] - 2, W['north_rim'][1] + 1
        rim.append(float(np.median(ratio(b[ya:yb, x0:x1], a[ya:yb, x0:x1]).max(axis=0))))
    ch['edge'] = float(np.median(rim))
    ch['max'] = max(ch['top'], ch['face'], ch['edge'])
    import colorsys
    def hue(rgb): return colorsys.rgb_to_hsv(*[c / 255.0 for c in rgb])
    hd = 0.0
    for k in ('top_rgb', 'face_rgb'):
        ha, sa, _ = hue(fresh[k]); hb, sb, _ = hue(crack[k])
        if sa >= .15 and sb >= .15:
            d = abs(ha - hb) * 360; hd = max(hd, min(d, 360 - d))
    ch['hue'] = hd
    def f(x): return '%.2f' % x
    print('fresh   ground_lum=%.3f top_ratio=%s face_over_top=%s face_vs_ground=%s edge_ratio=%s (north %s base %s east %s) top_rgb=%s face_rgb=%s' % (
        fresh['ground_lum'], f(fresh['top_ratio']), f(fresh['face_over_top']), f(fresh['face_ratio_ground']), f(fresh['edge_ratio']),
        f(fresh['edge_north']), f(fresh['edge_base']), f(fresh['edge_east']), fresh['top_rgb'], fresh['face_rgb']))
    print('cracking top_ratio=%s face_over_top=%s edge_ratio=%s  change_vs_fresh: top=%s face=%s edge=%s max=%s hue_shift=%.0f deg' % (
        f(crack['top_ratio']), f(crack['face_over_top']), f(crack['edge_ratio']), f(ch['top']), f(ch['face']), f(ch['edge']), f(ch['max']), ch['hue']))
    print('preview ground_lum=%.3f outline=%s fill=%s ring=%s line=%s dot=%s' % (pv['ground_lum'], f(pv['outline']), f(pv['fill']), f(pv['ring']), f(pv['line']), f(pv['dot'])))
    print('invalid ground_lum=%.3f ring=%s line=%s dot=%s line_rgb=%s dot_rgb=%s' % (pi['ground_lum'], f(pi['ring']), f(pi['line']), f(pi['dot']), list(map(int, pi['line_rgb'])), list(map(int, pi['dot_rgb']))))
    if dbg:
        os.makedirs(dbg, exist_ok=True)
        for im in imgs.values(): im.save_debug(dbg)
        print('wall-read-check: windows drawn into', dbg)
    if not check: return 0
    bad = []
    def need_(ok, what):
        if not ok: bad.append(what)
    for tag, w in (('fresh', fresh), ('cracking', crack)):
        need_(w['top_ratio'] >= TOP_RATIO or w['edge_ratio'] >= EDGE_RATIO, '%s: top %.2f < %.1f and edge %.2f < %.1f' % (tag, w['top_ratio'], TOP_RATIO, w['edge_ratio'], EDGE_RATIO))
        need_(w['face_over_top'] >= FACE_OVER_TOP, '%s: face over top %.2f < %.1f' % (tag, w['face_over_top'], FACE_OVER_TOP))
    need_(ch['max'] >= CRACK_CHANGE or ch['hue'] >= CRACK_HUE, 'crack: the largest luminance change against the fresh wall is %.2f < %.2f and the hue shift %.0f < %d degrees' % (ch['max'], CRACK_CHANGE, ch['hue'], CRACK_HUE))
    need_(max(pv['outline'], pv['fill']) >= PREVIEW_CELL, 'valid preview: cell outline %.2f / fill %.2f < %.1f' % (pv['outline'], pv['fill'], PREVIEW_CELL))
    for k in ('ring', 'line'): need_(pv[k] >= PREVIEW_MARK, 'valid preview: %s %.2f < %.1f' % (k, pv[k], PREVIEW_MARK))
    for k in ('line', 'dot'): need_(pi[k] >= INVALID_MARK, 'invalid preview: %s %.2f < %.1f' % (k, pi[k], INVALID_MARK))
    need_(pi['ring'] >= PREVIEW_MARK, 'invalid preview: ring %.2f < %.1f' % (pi['ring'], PREVIEW_MARK))
    need_(is_red(pi['line_rgb']) and is_red(pi['dot_rgb']), 'invalid preview: line %s / dot %s is not red (hue 335..25 degrees, saturation at least .25)' % (list(map(int, pi['line_rgb'])), list(map(int, pi['dot_rgb']))))
    for b_ in bad: print('FAIL ' + b_)
    print('wall-read-check: %s' % ('PASS' if not bad else '%d floor(s) missed' % len(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
