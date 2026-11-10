#!/usr/bin/env python3
"""contact-sheet.py DIR [cols] [step]: montage of DIR/f*.jpg (every step-th frame) into DIR/sheet.jpg, labelled with ms since the key press."""
import json, sys, glob, os
from PIL import Image, ImageDraw
d = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4; step = int(sys.argv[3]) if len(sys.argv) > 3 else 2
m = json.load(open(os.path.join(d, 'manifest.json')))['frames']
fr = m[::step]; w, h = 500, 330
rows = (len(fr) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h))
for i, f in enumerate(fr):
    im = Image.open(os.path.join(d, f['file'])).resize((w, h)); ImageDraw.Draw(im).text((6, 4), f"+{f['tMs']} ms", fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(os.path.join(d, 'sheet.jpg'), quality=72); print(sheet.size)
