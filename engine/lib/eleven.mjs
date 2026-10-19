// Direct ElevenLabs TTS. Used when Kie's ElevenLabs endpoint is down, and for
// voices only your own account has (premade voices on free plans, clones on paid).
import fs from "node:fs";
import path from "node:path";
import { elevenKey } from "./env.mjs";

export async function tts({ text, voice, model = "eleven_v3", out, stability = 0.5, settings = null, seed = null }) {
  const key = elevenKey();
  if (!key) throw new Error("no ELEVENLABS_API_KEY for direct fallback");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings || { stability }, ...(seed != null ? { seed } : {}) }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

// Sound effects (works on the free plan; billed in ElevenLabs characters, not Kie credits).
export async function sfx({ text, seconds, out, influence = 0.45 }) {
  const key = elevenKey();
  if (!key) throw new Error("no ELEVENLABS_API_KEY for sound effects");
  const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(seconds ? { duration_seconds: seconds } : {}), prompt_influence: influence }),
  });
  if (!r.ok) throw new Error(`ElevenLabs SFX ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

// Speech-to-speech: re-voice a recorded line with a character's voice, keeping its exact timing (lip sync holds).
export async function sts({ file, voice, out, model = "eleven_multilingual_sts_v2", settings = null, seed = null }) {
  const fs = await import("node:fs");
  const fd = new FormData();
  fd.append("audio", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), "line.wav");
  fd.append("model_id", model);
  // No noise removal (it adds metallic artifacts); steady, faithful voice settings; higher bitrate.
  fd.append("remove_background_noise", "false");
  fd.append("voice_settings", JSON.stringify(settings || { stability: 0.55, similarity_boost: 0.9, style: 0, use_speaker_boost: true }));
  if (seed != null) fd.append("seed", String(seed));
  const r = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voice}?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": elevenKey() }, body: fd });
  if (!r.ok) throw new Error(`ElevenLabs STS ${r.status}: ${(await r.text()).slice(0, 160)}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

// Voice Design: a new voice from a written description. Returns previews (mp3 files + generated ids) to audition;
// nothing is added to the account until saveDesignedVoice() keeps one.
export async function designVoice({ description, text, outBase, model = "eleven_ttv_v3" }) {
  const r = await fetch("https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ voice_description: description, model_id: model, ...(text ? { text } : { auto_generate_text: true }) }),
  });
  if (!r.ok) throw new Error(`ElevenLabs voice design ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { previews = [] } = await r.json();
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  return previews.map((p, i) => {
    const file = `${outBase}-${i + 1}.mp3`;
    fs.writeFileSync(file, Buffer.from(p.audio_base_64, "base64"));
    return { file, id: p.generated_voice_id };
  });
}

// Keep one designed preview as a voice on the account; returns its voice_id.
export async function saveDesignedVoice({ name, description, generatedId }) {
  const r = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
    method: "POST",
    headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ voice_name: name, voice_description: description, generated_voice_id: generatedId }),
  });
  if (!r.ok) throw new Error(`ElevenLabs save voice ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).voice_id;
}
