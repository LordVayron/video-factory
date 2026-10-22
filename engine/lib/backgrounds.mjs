// Backgrounds across the whole cut: judging each scene on its own lets one person's close-up show a different
// background in every scene while every scene passes. This check looks at the finished film: every close-up of the same person must show the same background
// and about the same framing size, matching their locked angle frame when there is one. It fails closed.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as P from "./project.mjs";
import { judgeJSON } from "./judge.mjs";

const grab = (file, t) => execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");
const img = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
const still = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-vf", "scale=360:-2", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");

export async function backgroundCheck(file, sl, cast) {
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  const n = Math.min(24, Math.max(8, Math.round(dur)));
  const times = Array.from({ length: n }, (_, k) => ((k + 0.5) * dur) / n);
  const angles = cast.map((id) => [id, P.angleFile(sl, id)]).filter(([, f]) => f && fs.existsSync(f));
  const content = [
    { type: "text", text: `You are the script supervisor checking a finished short film for background continuity. People: ${cast.map((id) => `${P.character(id).name} = ${P.character(id).look}`).join(" | ")}. The film is shot / reverse shot in one room: each person's close-ups are filmed from ONE camera position, so everything behind a person must be the same in all of their close-ups (same wall, same window position, same frames, plants and furniture) and the framing size must stay about the same. A reverse angle on the OTHER person naturally shows a different wall; that is correct.${angles.length ? " The first images are each person's locked close-up angle: their close-ups must match it." : ""}\nFor EACH numbered frame: who is the main subject (a name, or none), the framing (close-up / medium close-up / medium / wide), and what is behind them in a few concrete words. Then compare each person's frames with each other${angles.length ? " and with their locked angle" : ""}.\nAnswer with JSON only: {"frames":[{"frame":1,"person":"name or none","framing":"...","background":"..."}],"mismatches":[{"person":"name","frames":[3,9],"detail":"what is different"}]}. A mismatch is a different wall, window, frames, plants or furniture behind the same person, or a jump of two or more framing sizes. Lighting flicker, focus and a slightly different head position are not mismatches.` },
    ...angles.flatMap(([id, f]) => [{ type: "text", text: `Locked close-up angle of ${P.character(id).name}` }, img(still(f))]),
    ...times.flatMap((t, k) => [{ type: "text", text: `Frame ${k + 1} (t=${t.toFixed(1)}s)` }, img(grab(file, t))]),
  ];
  const { json } = await judgeJSON(content, { maxTokens: 4000 });
  const issues = (json.mismatches || []).filter((m) => m.person && !/^none$/i.test(m.person))
    .map((m) => `fondo distinto en los close-ups de ${m.person} (frames ${(m.frames || []).join(", ")} = ${(m.frames || []).map((k) => times[k - 1]?.toFixed(1) + " s").join(", ")}): ${m.detail}`);
  return { pass: !issues.length, issues, frames: json.frames || [] };
}
