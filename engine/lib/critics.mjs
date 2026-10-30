// Critics of a generated sequence, measured before anyone sees it (free: ffmpeg only). The cuts a sequence plans must
// be in the take, near their planned times, and no other cut may be; inside each shot the picture must flow.
import { spawnSync, execFileSync } from "node:child_process";

const len = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// Scene-change events (ffmpeg scdet). Calibrated on real takes: at 6 every jump between stitched shots shows, and no
// continuous take (big pull-backs included) scores a false cut.
export function detectCuts(file, { threshold = 6 } = {}) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", `scdet=threshold=${threshold}`, "-f", "null", "-"], { encoding: "utf8" });
  const hits = [...(r.stderr || "").matchAll(/lavfi\.scd\.score: ([\d.]+), lavfi\.scd\.time: ([\d.]+)/g)].map((m) => ({ t: +Number(m[2]).toFixed(3), score: +m[1] })).filter((h) => h.t > 0.06);
  // Neighbouring frames are one event.
  return hits.reduce((a, h) => (a.length && h.t - a.at(-1).t < 0.12 ? a : [...a, h]), []);
}

// Planned cuts against detected ones. A planned cut missing, or a cut nobody planned (outside the last few frames,
// where models snap), fails the take. Offsets say where each planned cut really landed, for the editor.
export function cutsMatch(file, planned, { tol = 0.4, threshold = 6, endWindow = 0.25 } = {}) {
  const found = detectCuts(file, { threshold }), total = len(file);
  const used = new Set(), offsets = [];
  const missing = [];
  for (const p of planned) {
    const k = found.findIndex((c, i) => !used.has(i) && Math.abs(c.t - p) <= tol);
    if (k < 0) { missing.push(p); continue; }
    used.add(k);
    offsets.push({ planned: p, at: found[k].t });
  }
  const unplanned = found.filter((c, i) => !used.has(i) && c.t < total - endWindow).map((c) => c.t);
  const endSnap = found.find((c, i) => !used.has(i) && c.t >= total - endWindow)?.t ?? null;
  const issues = [
    ...missing.map((t) => `the planned cut at ${t.toFixed(2)} s is not in the take (the shots blended into one)`),
    ...unplanned.map((t) => `a cut nobody planned at ${t.toFixed(2)} s`),
  ];
  return { pass: !issues.length, planned, found: found.map((c) => c.t), offsets, missing, unplanned, endSnap, issues };
}

// Words the video model painted into the picture (local OCR, free). Exact text is the editor's job: a model-drawn word
// is misspelled or half there, so any readable word fails the take.
import path from "node:path";
import { fileURLToPath } from "node:url";
const PY = path.join(path.dirname(fileURLToPath(import.meta.url)), "ref_media.py");
export function screenText(file) {
  const r = spawnSync("python", [PY, "ocr", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  let j;
  try { j = JSON.parse(r.stdout || "{}"); } catch { return { ran: false, words: [], issues: [] }; }
  const words = (j.text || []).filter((x) => /[A-Za-z]{3,}/.test(x.text));
  return { ran: true, words, issues: words.map((w) => `the model drew the words "${w.text}" at ${w.from.toFixed(1)} s (text is composited by the editor; describe screens by shapes and colors)`) };
}

// Things that must not happen inside a take, judged on a contact sheet of the whole take: the shot's own "stays as
// it is" rules, and nothing appearing from nowhere, multiplying or leaving the screen or frame it belongs to (UI
// windows floating out of a monitor and faces spreading to every screen passed every other critic). A judge that
// can't run is a note, not a failure: a provider outage must not buy a reroll.
import fs from "node:fs";
import os from "node:os";
import { judgeJSON } from "./judge.mjs";
export const stillRules = (prompt = "") => (prompt.match(/These stay exactly as they are and do not move: ([^.]+)\./)?.[1] || "").split(/;\s*/).map((x) => x.trim()).filter(Boolean);
export async function stillCheck(file, rules = []) {
  const sheet = path.join(os.tmpdir(), `still-${process.pid}-${Date.now()}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "fps=2,scale=768:-2,tile=4x3", "-frames:v", "1", "-q:v", "4", sheet]);
  const data = fs.readFileSync(sheet).toString("base64");
  fs.rmSync(sheet, { force: true });
  const all = [...rules, "nothing appears from nowhere, multiplies or duplicates (people, faces, screens, windows, props)", "every app window, picture or face shown on a screen stays inside that screen; nothing floats in the air", "walls, windows and buildings keep their shape; nothing turns into a screen"];
  try {
    const { model, json } = await judgeJSON([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
      { type: "text", text: `These are up to 12 frames of one generated video shot, 0.5 s apart, left to right then top to bottom; frame 1 is the approved opening. Compare every frame with frame 1, object by object: look for a panel, window, card or picture outside a screen's frame or in the air, a face or screen that was not in frame 1, a wall or window that became a screen, a person or object that doubled. Then check every rule below. Report only violations you can see.\nRules:\n${all.map((r, i) => `${i + 1}. ${r}`).join("\n")}\nReply with JSON only: {"violations":[{"rule":<number>,"frame":<number>,"what":"<short description>"}]}` },
    ], { maxTokens: 800 });
    const v = (json.violations || []).filter((x) => x?.what);
    return { ran: true, model, violations: v, issues: v.map((x) => `${all[x.rule - 1] ? `"${all[x.rule - 1]}" broken` : "a rule broken"} near ${((x.frame - 1) * 0.5).toFixed(1)} s: ${x.what}`) };
  } catch (e) {
    return { ran: false, violations: [], issues: [], note: `still check did not run: ${e.message.slice(0, 100)}` };
  }
}
