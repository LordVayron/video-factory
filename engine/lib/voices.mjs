// One voice per character per series. series/<id>/series.json -> voices.<char> is the single source of truth
// (ElevenLabs voice, model, fixed settings and seed, the official sample, the target pitch). The radio cut (TTS),
// the video model's voice reference and the speech-to-speech re-voicing all read it, so every episode sounds alike.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { character } from "./project.mjs";

export function voiceProfile(sl, id) {
  const c = character(id);
  const base = { eleven: c.voice?.eleven, ttsModel: "eleven_v3", tts: { stability: 0.5 }, sts: { stability: 0.55, similarity_boost: 0.9, style: 0, use_speaker_boost: true }, sample: null, pitchHz: 0 };
  if (!sl?.series) return base;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, "series", sl.series, "series.json"), "utf8"));
    const v = s.voices?.[id];
    if (!v) return base;
    return { ...base, ...v, sample: v.sample ? path.join(ROOT, "series", sl.series, v.sample) : null };
  } catch { return base; }
}
