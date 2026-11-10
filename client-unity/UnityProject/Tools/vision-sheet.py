#!/usr/bin/env python3
"""Contact sheet for one vision-shots.cjs sequence directory (leave-N / enter-N): crops every frame around the actor and labels it
with its time from the logged event. Screen mapping of the Web player at 1600x900: orthographic size 9 = 50 px per tile horizontally,
39 px vertically (ground squash .78), the player's feet at (800, 525).   python3 vision-sheet.py DIR [DIR...]"""
import glob, os, re, sys
from PIL import Image, ImageDraw

for d in sys.argv[1:]:
    ev = open(os.path.join(d, 'event.txt')).read()
    m = re.search(r'tile=(\d+),(\d+) me=(\d+),(\d+)', ev)
    frames = sorted(glob.glob(os.path.join(d, 'f*.jpg')))
    if not m or not frames:
        print('skip', d); continue
    tx, ty, mx, my = map(int, m.groups())
    cx, cy = 800 + (tx - mx) * 50, 525 + (ty - my) * 39
    box = (max(0, cx - 120), max(0, cy - 190), min(1600, cx + 120), min(900, cy + 50))
    cols = 8
    cells = []
    for f in frames:
        im = Image.open(f).convert('RGB')
        if im.size != (1600, 900): im = im.resize((1600, 900))
        c = im.crop(box).resize((240, 240))
        t = re.search(r'_(-?\d+)ms', f).group(1)
        ImageDraw.Draw(c).text((6, 4), t + ' ms', fill=(255, 255, 0))
        cells.append(c)
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 240, rows * 240), (0, 0, 0))
    for i, c in enumerate(cells): sheet.paste(c, ((i % cols) * 240, (i // cols) * 240))
    out = d.rstrip('/') + '-sheet.png'
    sheet.save(out); print('wrote', out, len(cells), 'frames')
