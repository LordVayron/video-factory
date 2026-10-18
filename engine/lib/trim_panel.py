"""Trim uniform borders (white margins, black frame lines, gutter strips) off a storyboard panel,
then centre-crop to 9:16 and resize to 768x1366.

    python trim_panel.py <in.png> <out.png>
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.int16)
h, w, _ = a.shape


def is_border(line):
    # A border line is nearly flat in colour (gutter, margin, frame line) - picture content varies.
    return line.std() < 9


def trim(a, axis_len, get, limit):
    lo = 0
    while lo < limit and is_border(get(lo)):
        lo += 1
    hi = axis_len - 1
    while axis_len - 1 - hi < limit and is_border(get(hi)):
        hi -= 1
    return lo, hi


limit_h, limit_w = int(h * 0.2), int(w * 0.2)
top, bottom = trim(a, h, lambda i: a[i, :, :], limit_h)
left, right = trim(a, w, lambda i: a[:, i, :], limit_w)
# A couple of extra pixels removes anti-aliased frame-line edges.
pad = 3
top, left = min(top + pad, h // 3), min(left + pad, w // 3)
bottom, right = max(bottom - pad, h * 2 // 3), max(right - pad, w * 2 // 3)
crop = im.crop((left, top, right + 1, bottom + 1))

cw, ch = crop.size
target = 9 / 16
if cw / ch > target:
    nw = int(ch * target)
    x = (cw - nw) // 2
    crop = crop.crop((x, 0, x + nw, ch))
else:
    nh = int(cw / target)
    y = (ch - nh) // 2
    crop = crop.crop((0, y, cw, y + nh))
crop.resize((768, 1366), Image.LANCZOS).save(dst)
print(f"trimmed t{top} b{h - 1 - bottom} l{left} r{w - 1 - right}")
