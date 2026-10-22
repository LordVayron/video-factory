# Screens in a frame: the solid bright-green areas a launch film's still was drawn with (TV screens, phones,
# monitors), so the editor can play real footage inside them. Prints JSON: [{"x","y","w","h"}] as fractions of
# the frame, in reading order (top row first, left to right). Small specks are ignored.
#   python screens.py <image>
import json, subprocess, sys
from collections import deque
import numpy as np

W, H = 640, 360
# The same cover crop the editor uses, so the fractions land on the same pixels in the film.
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
px = np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)
r, g, b = px[..., 0], px[..., 1], px[..., 2]
mask = (g > 150) & (g - r > 70) & (g - b > 70)

seen = np.zeros_like(mask)
boxes = []
for y0, x0 in zip(*np.nonzero(mask)):
    if seen[y0, x0]:
        continue
    q = deque([(y0, x0)]); seen[y0, x0] = True
    ys, xs = [], []
    while q:
        y, x = q.popleft(); ys.append(y); xs.append(x)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    if len(ys) < W * H * 0.002:
        continue
    boxes.append({"x": min(xs) / W, "y": min(ys) / H, "w": (max(xs) - min(xs) + 1) / W, "h": (max(ys) - min(ys) + 1) / H, "fill": round(len(ys) / ((max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)), 2)})

# Reading order: rows by vertical center (boxes whose centers are within half a box height share a row).
boxes.sort(key=lambda b: b["y"] + b["h"] / 2)
rows = []
for bx in boxes:
    if rows and abs((rows[-1][0]["y"] + rows[-1][0]["h"] / 2) - (bx["y"] + bx["h"] / 2)) < bx["h"] / 2:
        rows[-1].append(bx)
    else:
        rows.append([bx])
print(json.dumps([bx for row in rows for bx in sorted(row, key=lambda b: b["x"])]))
