// One-off sound cues a line can trigger (sl.cues = { canopener: { prompt, seconds, gainDb, lead, at: "start" | "end" } }, line.cue = "canopener").
// Generated once per project with ElevenLabs sound effects (free); laid `lead` seconds before the line starts.
import fs from "node:fs";
import path from "node:path";
import * as eleven from "./eleven.mjs";

export async function cueFile(dir, sl, name) {
  const c = sl.cues?.[name];
  if (!c) throw new Error(`unknown cue "${name}" (add it to sl.cues)`);
  const f = path.join(dir, "audio", `cue-${name}.mp3`);
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); await eleven.sfx({ text: c.prompt, seconds: c.seconds || 2, out: f }); }
  return { file: f, gainDb: c.gainDb ?? -6, lead: c.lead ?? 0.8, at: c.at || "start" };
}
