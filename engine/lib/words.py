# Word timings of a recording (faster-whisper, CPU, free): [{"w","start","end"}] as JSON.
# Used by launch.mjs voice --from to cut a narration the creator chose into the plan's lines.
#   python words.py <audio> [en|es]
import json, sys
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")
segs, _ = model.transcribe(sys.argv[1], word_timestamps=True, language=(sys.argv[2] if len(sys.argv) > 2 else "en"))
print(json.dumps([{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for s in segs for w in s.words]))
