"""Reference measurements that need signal processing (2026-10-22): the creator wants the reference engine to measure
everything on its own, not leave sound effects, music and on-screen text to Claude's eyes and ears.

  python ref_media.py audio <video>   -> {"tempo": {...}, "events": [...], "envelope": {...}}
  python ref_media.py ocr <video>     -> {"text": [{"text", "from", "to"}], "frames": n}

audio: an onset envelope (spectral flux) gives the music's tempo (autocorrelation, 60-180 BPM) and the sharp audio
events that stand out from the bed (candidate sound effects, hits and whooshes); Node drops the ones inside speech.
ocr: one frame per second (at most 90) read with RapidOCR (local, onnxruntime); the same text on consecutive frames is
one caption with its on-screen time. Everything is local and free.
"""
import json, subprocess, sys
import numpy as np

SR = 22050


def pcm(path, sr=SR):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def audio(path):
    x = pcm(path)
    if len(x) < SR:
        return {"tempo": None, "events": [], "envelope": None}
    n, hop = 2048, 512
    win = np.hanning(n).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * win
    mag = np.abs(np.fft.rfft(frames, axis=1))
    flux = np.maximum(0, np.diff(np.log1p(mag), axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    fps = SR / hop
    # Tempo: autocorrelation of the normalized onset envelope over 60-180 BPM.
    o = (flux - flux.mean()) / (flux.std() + 1e-9)
    ac = np.correlate(o, o, mode="full")[len(o) - 1:]
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 60)
    seg = ac[lo:hi]
    tempo = None
    if len(seg) > 2 and ac[0] > 0:
        k = int(np.argmax(seg)) + lo
        conf = float(seg.max() / ac[0])
        tempo = {"bpm": round(60 * fps / k, 1), "confidence": round(conf, 2), "steady": conf > 0.25}
    # Events: onset peaks far above the typical onset (median + 6 MAD), at least 0.25 s apart, with their loudness jump.
    med = np.median(flux)
    mad = np.median(np.abs(flux - med)) + 1e-9
    thr = med + 6 * mad
    events, last = [], -1.0
    for i in range(1, len(flux) - 1):
        if flux[i] > thr and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1]:
            t = i / fps
            if t - last >= 0.25:
                before = float(np.median(db[max(0, i - int(fps * 0.5)):i])) if i > 2 else float(db[i])
                events.append({"at": round(t, 2), "strength": round(float((flux[i] - med) / mad), 1), "jumpDb": round(float(db[min(len(db) - 1, i + 2)] - before), 1)})
                last = t
    events.sort(key=lambda e: -e["strength"])
    return {"tempo": tempo, "events": sorted(events[:60], key=lambda e: e["at"]), "envelope": {"p10Db": round(float(np.percentile(db, 10)), 1), "p50Db": round(float(np.percentile(db, 50)), 1), "p90Db": round(float(np.percentile(db, 90)), 1)}}


def ocr(path):
    from rapidocr_onnxruntime import RapidOCR
    import cv2
    eng = RapidOCR()
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps if fps else 0
    step = max(1.0, total / 90)
    out, t = [], 0.0
    while t < total:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            break
        res, _ = eng(frame)
        words = [r[1].strip() for r in (res or []) if r[2] >= 0.6 and len(r[1].strip()) >= 2]
        text = " ".join(words)
        if text:
            if out and out[-1]["text"] == text and t - out[-1]["to"] <= step + 0.01:
                out[-1]["to"] = round(t, 2)
            else:
                out.append({"text": text, "from": round(t, 2), "to": round(t, 2)})
        t += step
    return {"text": out, "frames": int(total / step) + 1}


if __name__ == "__main__":
    mode, path = sys.argv[1], sys.argv[2]
    print(json.dumps(audio(path) if mode == "audio" else ocr(path)))
