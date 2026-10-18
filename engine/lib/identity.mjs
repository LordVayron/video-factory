// Identity check: a character's face and distinctive marks (freckles, moles, scars, glasses, earrings...) must match
// the reference in every frame where the face can be seen, across shots and across the cut.
// Added 2026-10-19: a character lost her freckles in one shot and nothing caught it. The old check judged 360 px frames
// (freckles are invisible at that size), only within one scene (never across the cut), and only knew wardrobe.
// Two passes: 1) small frames → where each face is; 2) high-res face crops + the reference → what marks are there.
// The judge reports what it sees; the rules below decide pass or fail.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "./project.mjs";
import { judgeJSON } from "./judge.mjs";

const MARKS = [
  [/freckle/i, "freckles"], [/\bmoles?\b|beauty mark/i, "mole"], [/\bscars?\b/i, "scar"], [/tattoo/i, "tattoo"],
  [/birthmark/i, "birthmark"], [/dimple/i, "dimples"], [/\bbeard/i, "beard"], [/moustache|mustache/i, "moustache"],
  [/stubble/i, "stubble"], [/glasses|spectacles/i, "glasses"], [/\bhoops?\b|earrings?/i, "earrings"],
  [/piercing|nose ring|septum/i, "piercing"], [/gap(-| )tooth|tooth gap/i, "tooth gap"], [/braces/i, "braces"],
];

export const marksOf = (look = "") => MARKS.filter(([re]) => re.test(look)).map(([, n]) => n);

// Marks in a character's locked look that a generation prompt leaves out. A model only keeps what the prompt says.
export function missingMarks(prompt, ids) {
  const out = [];
  for (const id of ids) {
    const c = P.character(id);
    for (const [re, n] of MARKS) if (re.test(c.look || "") && !re.test(prompt)) out.push(`${c.name}: ${n}`);
  }
  return out;
}

// Characters a prompt is about: named in it, or the only character of the project.
export function castOf(sl, prompt = "") {
  const all = [...new Set([...(sl.cast || []), ...(sl.shots || []).flatMap((s) => s.characters || [])])];
  const named = all.filter((id) => new RegExp(`\\b(${id}|${P.character(id).name})\\b`, "i").test(prompt));
  return named.length ? named : all.length === 1 ? all : [];
}

function refImage(id) {
  const c = P.character(id), d = path.join(P.BIBLE, "characters", id);
  const f = [...(c.refs || []), ...(c.sheets || [])].map((x) => path.join(d, x)).find((x) => fs.existsSync(x));
  return f ? execFileSync("ffmpeg", ["-v", "error", "-i", f, "-vf", "scale='min(1024,iw)':-2", "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64") : null;
}

const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const dims = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).toString().trim().split(",").map(Number);
const grab = (file, t, vf, q = 4) => execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", vf, "-q:v", String(q), "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");
const img = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });

// Longest stretch, in seconds, of samples taken 0.5 s apart.
const longestRun = (ts) => ts.reduce((a, t) => (a.length && t - a.at(-1)[1] < 0.8 ? (a.at(-1)[1] = t, a) : [...a, [t, t]]), []).reduce((m, [a, b]) => Math.max(m, b - a), 0);
// Runs of frames as "0.2–6.2 s", for the report.
const spans = (ts) => ts.reduce((a, t) => (a.length && t - a.at(-1)[1] < 0.8 ? (a.at(-1)[1] = t, a) : [...a, [t, t]]), []).map(([a, b]) => (a === b ? `${a.toFixed(1)} s` : `${a.toFixed(1)}–${b.toFixed(1)} s`)).join(", ");

// Side by side: the anchor face (LEFT) next to one frame's face (RIGHT), one image, so the judge compares directly.
function pair(a, b) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "idpair-"));
  const fa = path.join(tmp, "a.jpg"), fb = path.join(tmp, "b.jpg");
  fs.writeFileSync(fa, Buffer.from(a, "base64")); fs.writeFileSync(fb, Buffer.from(b, "base64"));
  const out = execFileSync("ffmpeg", ["-v", "error", "-i", fa, "-i", fb, "-filter_complex", "[0][1]hstack=2", "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

// The anchor is the approved look of the face in THIS video: the first clear frontal frame (or opts.anchor).
// Video models smooth skin, so a still reference is too strict a yardstick; the error to catch is the face
// CHANGING across the video (for example: freckles in shot A, none in shot B). The reference still decides whether
// the anchor itself has the marks and whether it is the same person.
export async function identityCheck(file, ids, { step = 0.5, lockAnchor = false } = {}) {
  const issues = [], notes = [], report = {};
  ids = ids.filter((id) => P.character(id).species !== "set");
  if (!ids.length) return { pass: true, issues, notes: ["identity: no cast to check"], report };
  const len = dur(file), [W, H] = dims(file);
  const ts = [];
  for (let t = 0.25; t < len - 0.05; t += step) ts.push(t);
  const names = ids.map((id) => P.character(id).name);

  // Pass 1: where is each face (normalised box) and which way it looks, on small frames.
  const p1 = await judgeJSON([
    { type: "text", text: `These are ${ts.length} frames of a video, in order. Characters: ${ids.map((id) => `${P.character(id).name} = ${P.character(id).look}`).join(" | ")}.\nFor each frame give, for each character whose face is in the frame, the bounding box of the FACE (forehead to chin, ear to ear) as fractions [x0,y0,x1,y1] of the frame width and height, and the view: frontal | three_quarter | profile | away | blurred. Leave a character out when the face is not in the frame. Answer with JSON only: {"frames":[{"frame":1,"faces":{"${names[0]}":{"box":[0.2,0.1,0.7,0.4],"view":"frontal"}}}]}` },
    ...ts.flatMap((t, k) => [{ type: "text", text: `Frame ${k + 1}` }, img(grab(file, t, "scale=320:-2", 5))]),
  ], { maxTokens: 8000 });
  const boxes = p1.json.frames || [];

  // Pass 2, per character: every face crop side by side with the anchor, plus the reference.
  for (const id of ids) {
    const c = P.character(id), marks = marksOf(c.look), ref = refImage(id);
    const crops = [];
    ts.forEach((t, k) => {
      const f = boxes.find((x) => x.frame === k + 1)?.faces?.[c.name], b = f?.box;
      if (!Array.isArray(b) || b.length !== 4 || !["frontal", "three_quarter"].includes(f.view)) return;
      const cx = ((b[0] + b[2]) / 2) * W, cy = ((b[1] + b[3]) / 2) * H;
      const side = Math.min(W, H, Math.max((b[2] - b[0]) * W, (b[3] - b[1]) * H) * 1.5);
      if (side < 40) return; // too small to judge marks
      const x = Math.round(Math.max(0, Math.min(W - side, cx - side / 2))), y = Math.round(Math.max(0, Math.min(H - side, cy - side / 2)));
      crops.push({ t, view: f.view, data: grab(file, t, `crop=${Math.round(side)}:${Math.round(side)}:${x}:${y},scale=448:448:flags=lanczos`, 2) });
    });
    if (crops.length < 2) { notes.push(`identity ${c.name}: face seen clearly in ${crops.length} frame(s), not enough to check`); continue; }
    // A locked anchor (bible/characters/<id>/face-anchor.jpg, cut from an approved take) wins: a take that is wrong
    // from its first frame (shot B alone looked consistent, just without freckles) is then still caught.
    const locked = c.faceAnchor && path.join(P.BIBLE, "characters", id, c.faceAnchor);
    const anchor = locked && fs.existsSync(locked) ? { t: -1, locked: true, data: fs.readFileSync(locked).toString("base64") } : crops.find((x) => x.view === "frontal") || crops[0];
    const rest = crops.filter((x) => x !== anchor);
    if (lockAnchor && !anchor.locked) {
      fs.writeFileSync(path.join(P.BIBLE, "characters", id, "face-anchor.jpg"), Buffer.from(anchor.data, "base64"));
      const cf = path.join(P.BIBLE, "characters", id, "character.json");
      P.writeJSON(cf, { ...P.readJSON(cf), faceAnchor: "face-anchor.jpg" });
      notes.push(`identity ${c.name}: face anchor locked from ${path.basename(file)} at ${anchor.t.toFixed(1)} s`);
    }
    const { model, json: j } = await judgeJSON([
      { type: "text", text: `Continuity check of ${c.name}'s face across a video. Locked look: ${c.look}.\nMarks to verify: ${marks.length ? marks.join(", ") : "none listed; compare the face itself"}.\n${ref ? "First, the REFERENCE image of the character, then the ANCHOR: her/his face early in the video, the approved look.\n" : "First the ANCHOR: the face early in the video, the approved look.\n"}Then ${rest.length} PAIRS, in time order. In each pair the LEFT half is the ANCHOR and the RIGHT half is a later frame.\nFor EACH pair compare the RIGHT face with the LEFT one and report what you actually SEE:\n- same_person: yes | no | unsure (bone structure, nose, eyes, brows, skin tone)\n- marks: for each mark, same | weaker | absent | not_visible. same = about as visible and as many as on the LEFT. weaker = clearly fainter, fewer or smaller than on the LEFT. absent = that skin is clearly visible on the RIGHT and the mark is not there. not_visible ONLY when the angle, motion blur, hair, a hand or the light really hides that part of the face. Normal changes of light or compression are "same"; a mark that has faded or vanished is not.\nAlso report, for the ANCHOR${ref ? " and the REFERENCE" : ""}, each mark as present | absent.\nAnswer with JSON only, "detail" under 12 words: {"anchor":{"freckles":"present"},${ref ? '"reference":{"freckles":"present"},' : ""}"pairs":[{"pair":1,"same_person":"yes","marks":{"freckles":"same"},"detail":"..."}]}` },
      ...(ref ? [{ type: "text", text: "REFERENCE" }, img(ref)] : []),
      { type: "text", text: anchor.locked ? "ANCHOR (the approved face, locked in the character bible)" : `ANCHOR (t=${anchor.t.toFixed(1)} s)` }, img(anchor.data),
      ...rest.flatMap((cr, k) => [{ type: "text", text: `Pair ${k + 1} (RIGHT at t=${cr.t.toFixed(1)} s)` }, img(pair(anchor.data, cr.data))]),
    ], { maxTokens: 8000 });
    const rows = j.pairs || [], at = (r) => rest[r.pair - 1]?.t ?? 0;
    report[c.name] = { anchor: anchor.locked ? "locked" : anchor.t, crops: crops.length, judge: model, marks: {} };
    for (const m of marks) {
      // The marks must be there from the start: an anchor without a mark the reference shows is already wrong.
      if (ref && j.reference?.[m] === "present" && j.anchor?.[m] === "absent") issues.push(`identity ${c.name}: ${m} missing on the anchor face`);
      // "weaker" counts as missing: a mark that fades between shots is the same continuity error (a real failure).
      const kept = rows.filter((r) => r.marks?.[m] === "same").map(at);
      const lost = rows.filter((r) => ["weaker", "absent"].includes(r.marks?.[m])).map(at);
      const keptAll = (anchor.locked ? kept : [anchor.t, ...kept]).sort((a, b) => a - b);
      report[c.name].marks[m] = { kept: spans(keptAll), lost: spans(lost) };
      // Fail on a sustained change: lost for 1 s or more in a row, or in 40 % of the frames compared. In the failure behind this, the freckles
      // were gone for 7 s; a frame or two at a head turn is judge noise and goes to the notes.
      const sustained = (ts) => longestRun(ts) >= 1 || ts.length >= 0.4 * Math.max(1, rows.length);
      if (lost.length >= 2 && sustained(lost)) issues.push(`identity ${c.name}: ${m} faded or gone at ${spans(lost)}${keptAll.length ? ` (as the anchor at ${spans(keptAll)})` : ""}`);
      else if (lost.length) notes.push(`identity ${c.name}: ${m} doubtful at ${spans(lost)}`);
    }
    const other = rows.filter((r) => r.same_person === "no").map(at);
    if (other.length >= 2 && (longestRun(other) >= 1 || other.length >= 0.4 * rows.length)) issues.push(`identity ${c.name}: a different face at ${spans(other)}`);
    else if (other.length) notes.push(`identity ${c.name}: face doubtful at ${spans(other)}`);
  }
  return { pass: !issues.length, issues, notes, report, frames: ts.length, at: new Date().toISOString() };
}
