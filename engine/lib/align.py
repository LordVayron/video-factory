"""Transcribe a cut and align the script's lines to it (word timestamps).

    python align.py <media> <lines.json> <out.json> [lang]

lines.json: [{"id": "s01-1", "text": "..."}]. Output: {"words": [...], "lines": [{"id", "start", "end", "found"}]}.
Runs faster-whisper "small" on the CPU (int8); about real time for a 30 s cut.
"""
import json
import re
import sys
from difflib import SequenceMatcher

from faster_whisper import WhisperModel

media, lines_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
lang = sys.argv[4] if len(sys.argv) > 4 else "en"
norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower().replace("gonna", "going"))

model = WhisperModel("small", device="cpu", compute_type="int8")
# VAD: without it the first word of a line after a silence or a sound effect is stamped at the start of the
# segment (a caption showed 2.4 s early).
segs, _ = model.transcribe(media, language=lang, word_timestamps=True, vad_filter=True, vad_parameters={"min_silence_duration_ms": 300})
words = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for s in segs for w in s.words]

lines = json.load(open(lines_path, encoding="utf8"))

# Whisper writes numbers as digits ("400") while scripts spell them ("four hundred"): a correct take failed its
# dialogue check. A heard number the script doesn't write in digits is spelled out, same timestamps.
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
def spell(n):
    if n < 20: return [ONES[n]]
    if n < 100: return [TENS[n // 10]] + (spell(n % 10) if n % 10 else [])
    if n < 1000: return spell(n // 100) + ["hundred"] + (spell(n % 100) if n % 100 else [])
    return spell(n // 1000) + ["thousand"] + (spell(n % 1000) if n % 1000 else [])
script_text = " ".join(norm(t) for l in lines for t in l["text"].split())
spelled = []
for w in words:
    n = norm(w["w"])
    if n.isdigit() and int(n) < 1000000 and n not in script_text.split():
        spelled += [{**w, "w": part} for part in spell(int(n))]
    else:
        spelled.append(w)
words = spelled
script_tokens, owner = [], []
for i, l in enumerate(lines):
    for t in l["text"].split():
        n = norm(t)
        if n:
            script_tokens.append(n)
            owner.append(i)
heard = [norm(w["w"]) for w in words]

# Map script tokens to heard words; a line's span is its first to last matched word.
span = [[None, None, 0, 0] for _ in lines]  # start, end, matched, total
for i in owner:
    span[i][3] += 1
for a, b, size in SequenceMatcher(None, script_tokens, heard, autojunk=False).get_matching_blocks():
    for k in range(size):
        i, w = owner[a + k], words[b + k]
        s = span[i]
        s[0] = w["start"] if s[0] is None else min(s[0], w["start"])
        s[1] = w["end"] if s[1] is None else max(s[1], w["end"])
        s[2] += 1

# Words the take says that the script doesn't (extra or repeated words, e.g. "set foot... foot").
matched = set()
for a, b, size in SequenceMatcher(None, script_tokens, heard, autojunk=False).get_matching_blocks():
    matched.update(range(b, b + size))
extras = [words[i]["w"] for i in range(len(words)) if i not in matched and heard[i]]
repeats = [words[i]["w"] for i in range(1, len(words)) if heard[i] and heard[i] == heard[i - 1]]
out = {"words": words, "lines": [], "extras": extras, "repeats": repeats}
for l, (st, en, got, tot) in zip(lines, span):
    out["lines"].append({"id": l["id"], "start": st, "end": en, "found": round(got / max(1, tot), 2)})
json.dump(out, open(out_path, "w", encoding="utf8"), indent=1)
print(json.dumps([[x["id"], x["start"], x["end"], x["found"]] for x in out["lines"]]))
