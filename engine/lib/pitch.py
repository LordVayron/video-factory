"""Median speaking pitch (Hz) of audio files, for keeping each character's voice at one pitch.

    python pitch.py <file> [<file> ...]   -> JSON {file: hz}
"""
import json
import subprocess
import sys

import numpy as np


def f0(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32)
    w, vals = 640, []
    for i in range(0, len(x) - w, 320):
        s = x[i:i + w]
        if np.sqrt((s ** 2).mean()) < 500:
            continue
        s = s - s.mean()
        c = np.correlate(s, s, "full")[w - 1:]
        lo, hi = 16000 // 400, 16000 // 70
        k = lo + int(np.argmax(c[lo:hi]))
        if c[k] > 0.3 * c[0]:
            vals.append(16000 / k)
    return float(np.median(vals)) if vals else 0.0


print(json.dumps({f: f0(f) for f in sys.argv[1:]}))
