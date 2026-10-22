#!/usr/bin/env node
// Cast and sets (phases 3-4). Every character gets a sheet IN THE VIDEO'S STYLE, split into angle
// views that shots use as references. Sets get an approved empty plate.
//
//   node engine/cast.mjs sheet <char> --style <id> [--set <setId>] [--model gpt2.5] [--note "..."] [--project <slug>]  (--project charges it to that project and its cap)
//   node engine/cast.mjs model-sheet <char> --style <id> [--ref <img>] [--project <slug>]   THE standard sheet (one per character)
//   node engine/cast.mjs split <char> --style <id> [--sheet <file>]          re-cut the 2x2 views
//   node engine/cast.mjs approve <char> --style <id> consistency=9 anatomy=9 design=9 style=9 layout=9
//   node engine/cast.mjs plate <set> --style <id> "<description>" [--model gpt2.5]
//   node engine/cast.mjs approve-set <set> --plate <file>
//   node engine/cast.mjs status [--style <id>]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import * as MS from "./lib/modelsheet.mjs";

const argv = process.argv.slice(2);
const [cmd, id] = argv;
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const charFile = (cid) => path.join(P.BIBLE, "characters", cid, "character.json");
const setFile = (sid) => path.join(P.BIBLE, "sets", sid, "set.json");

export const SHEET_RUBRIC = {
  consistency: "The same individual in all four panels: face, markings, body, wardrobe, accessories.",
  anatomy: "Correct anatomy in every panel: limbs, paws/hands, eyes, no fusions.",
  design: "Matches the character description (look, outfit, signature details).",
  style: "Matches the style sheet and its north star (for realistic styles: lit and textured like the scene, nothing pasted in).",
  layout: "Clean 2x2 grid with the requested angles, usable as separate reference crops; no text or labels.",
};

function gen(prompt, out, { model, size = "2K", ar = "1:1", refs = [] }) {
  // --project <slug>: the image is charged to that project (its ledger and its hard budget cap), not ad hoc.
  const project = flag("--project");
  execFileSync(process.execPath, [path.join(ROOT, "engine", "gen.mjs"), "still", prompt, out, "--model", model, "--size", size, "--ar", ar, ...refs.flatMap((r) => ["--ref", r]), ...(project ? ["--project", project] : [])], { stdio: "inherit" });
}

// Cut a 2x2 sheet into four views, trimming the gutters.
function split(sheet, outDir, views) {
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", sheet]).toString().trim().split(",").map(Number);
  const cw = Math.floor(w / 2), ch = Math.floor(h / 2), inset = Math.round(Math.min(w, h) * 0.012);
  const out = {};
  views.slice(0, 4).forEach((v, k) => {
    const x = (k % 2) * cw + inset, y = Math.floor(k / 2) * ch + inset;
    const f = path.join(outDir, `${v}.png`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", sheet, "-vf", `crop=${cw - 2 * inset}:${ch - 2 * inset}:${x}:${y}`, f]);
    out[v] = f;
  });
  return out;
}

const commands = {
  sheet() {
    const styleId = flag("--style");
    if (!id || !styleId) throw new Error("usage: sheet <char> --style <id> [--set <setId>]");
    const st = P.style(styleId);
    const c = P.character(id);
    const setId = flag("--set");
    const setLook = setId ? P.set(setId).look : st.kind === "realistic" ? "a plain, softly lit everyday room" : "a plain light background";
    const lk = P.characterLook(c, styleId);
    const who = `${c.name}, ${lk.look}`;
    // Sheets are references for every shot: a neutral pose, so no gesture leaks into a scene (a chin on a hand did, a past drama).
    const neutral = "Neutral reference pose in every panel: upright, arms relaxed, hands away from the face, holding nothing, no props, calm neutral expression. ";
    const prompt = neutral + st.characterSheet.prompt.replaceAll("{who}", who).replaceAll("{set}", setLook).replaceAll("{look}", st.look)
      + (st.imageRules ? ` ${st.imageRules}` : "") + (st.negative ? ` Avoid: ${st.negative}.` : "") + (flag("--note") ? ` ${flag("--note")}` : "");
    // Realistic styles are born in the set (only the plate as a ref); stylized styles from text.
    const refs = [];
    if (setId && st.refPolicy === "native") {
      const s = P.set(setId);
      const plate = (s.plates || []).map((p) => path.join(s.dir, p)).find((f) => fs.existsSync(f));
      if (plate) refs.push(plate);
    }
    const dir = path.join(c.dir, styleId);
    fs.mkdirSync(dir, { recursive: true });
    let k = 1; while (fs.existsSync(path.join(dir, `sheet-${k}.png`))) k++;
    const out = path.join(dir, `sheet-${k}.png`);
    gen(prompt, out, { model: flag("--model", st.models?.keyframe || "gpt2.5"), refs });
    const views = split(out, dir, st.characterSheet.views);
    const data = P.readJSON(charFile(id));
    data.looks ||= {};
    data.looks[styleId] = { ...(data.looks[styleId] || {}), sheet: path.relative(c.dir, out).replace(/\\/g, "/"), views: Object.fromEntries(Object.entries(views).map(([v, f]) => [v, path.relative(c.dir, f).replace(/\\/g, "/")])), status: "draft" };
    P.writeJSON(charFile(id), data);
    console.log(`${out}\nviews: ${Object.keys(views).join(", ")}\nReview it, then: node engine/cast.mjs approve ${id} --style ${styleId} ${Object.keys(SHEET_RUBRIC).map((k2) => `${k2}=N`).join(" ")}`);
  },
  // The standard sheet (lib/modelsheet.mjs): one character, the studio layout, in the project's style. Needs
  // character.json sheetSpec (label, expressions, poses, details, palette, notes). --ref <image> keeps a design the creator
  // already approved (e.g. an older sheet).
  "model-sheet"() {
    const styleId = flag("--style");
    if (!id || !styleId) throw new Error("usage: model-sheet <char> --style <id> [--ref <image>]... [--project <slug>]");
    const st = P.style(styleId), c = P.character(id);
    if (MS.isGroup(c.look)) throw new Error(`${id}: the look describes more than one character. One sheet, one character: split it into one bible character each.`);
    const miss = MS.specProblems(c);
    if (miss.length) throw new Error(`${id}: character.json is missing ${miss.join("; ")}`);
    const dir = path.join(c.dir, styleId);
    fs.mkdirSync(dir, { recursive: true });
    let k = 1; while (fs.existsSync(path.join(dir, `model-sheet-${k}.png`))) k++;
    const out = path.join(dir, `model-sheet-${k}.png`);
    const refs = argv.flatMap((a, i) => (a === "--ref" && argv[i + 1] ? [path.resolve(argv[i + 1])] : []));
    gen(MS.prompt(c, st), out, { model: flag("--model", st.models?.keyframe || "gpt2.5"), ar: "16:9", refs });
    const data = P.readJSON(charFile(id));
    data.looks ||= {};
    data.looks[styleId] = { ...(data.looks[styleId] || {}), modelSheet: path.relative(c.dir, out).replace(/\\/g, "/"), status: "draft" };
    P.writeJSON(charFile(id), data);
    console.log(`${out}\nReview every label and drawing, then: node engine/cast.mjs approve ${id} --style ${styleId} ${Object.keys(SHEET_RUBRIC).map((k2) => `${k2}=N`).join(" ")}`);
  },
  split() {
    const styleId = flag("--style");
    const c = P.character(id);
    const lk = P.characterLook(c, styleId);
    const sheet = flag("--sheet") ? path.resolve(flag("--sheet")) : path.join(c.dir, lk.sheet);
    const views = split(sheet, path.join(c.dir, styleId), P.style(styleId).characterSheet.views);
    const data = P.readJSON(charFile(id));
    data.looks[styleId] = { ...data.looks[styleId], sheet: path.relative(c.dir, sheet).replace(/\\/g, "/"), views: Object.fromEntries(Object.entries(views).map(([v, f]) => [v, path.relative(c.dir, f).replace(/\\/g, "/")])), status: "draft" };
    P.writeJSON(charFile(id), data);
    console.log(Object.values(views).join("\n"));
  },
  approve() {
    const styleId = flag("--style");
    const st = P.style(styleId);
    const scores = Object.fromEntries(argv.filter((a) => /^\w+=\d+(\.\d+)?$/.test(a)).map((a) => { const [k, v] = a.split("="); return [k, Number(v)]; }));
    const missing = Object.keys(SHEET_RUBRIC).filter((k) => !(k in scores));
    if (missing.length) throw new Error(`score every criterion: ${missing.join(", ")}\n${Object.entries(SHEET_RUBRIC).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
    const vals = Object.values(scores), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const pass = vals.every((v) => v >= (st.qc?.minEach ?? 7)) && avg >= (st.qc?.minAvg ?? 8);
    const data = P.readJSON(charFile(id));
    const lk = data.looks?.[styleId];
    if (!lk?.views && !lk?.modelSheet) throw new Error(`no ${styleId} sheet for ${id}; run model-sheet first`);
    lk.qc = { scores, avg: +avg.toFixed(2), pass, at: new Date().toISOString() };
    lk.status = pass ? "approved" : "rejected";
    P.writeJSON(charFile(id), data);
    console.log(`${id} @ ${styleId}: ${pass ? "APPROVED" : "REJECTED"} (avg ${avg.toFixed(2)})${pass ? "" : " — regenerate with --note describing the fix"}`);
  },
  plate() {
    const styleId = flag("--style");
    // The description is the first positional argument after the set id, wherever the flags go (it used to be
    // argv[2], so `plate <set> --style <id> "<desc>"`, the documented order, sent "--style" as the description).
    const desc = argv.slice(2).find((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").startsWith("--"));
    if (!id || !styleId || !desc) throw new Error('usage: plate <set> --style <id> "<description>"');
    const st = P.style(styleId);
    const dir = path.join(P.BIBLE, "sets", id);
    fs.mkdirSync(dir, { recursive: true });
    let k = 1; while (fs.existsSync(path.join(dir, `${styleId}-plate-${k}.png`))) k++;
    const out = path.join(dir, `${styleId}-plate-${k}.png`);
    const prompt = [st.look, `Wide establishing shot of an empty location, no people, no animals: ${desc}.`, st.imageRules, st.negative ? `Avoid: ${st.negative}.` : "", "No text."].filter(Boolean).join(" ");
    gen(prompt, out, { model: flag("--model", st.models?.keyframe || "gpt2.5"), ar: flag("--ar", "9:16") });
    const s = P.readJSON(setFile(id), { id, name: id });
    P.writeJSON(setFile(id), { ...s, look: s.look || desc, style: styleId, status: "draft" });
    console.log(out);
  },
  "approve-set"() {
    const plate = flag("--plate");
    const s = P.readJSON(setFile(id), null);
    if (!s) throw new Error(`no set "${id}"`);
    if (plate) s.plates = [path.basename(plate), ...(s.plates || []).filter((p) => p !== path.basename(plate))];
    s.status = "approved";
    P.writeJSON(setFile(id), s);
    console.log(`set ${id} approved (plate ${s.plates?.[0]})`);
  },
  status() {
    const want = flag("--style");
    for (const d of fs.readdirSync(path.join(P.BIBLE, "characters"))) {
      const c = P.readJSON(charFile(d), null);
      if (!c) continue;
      const looks = Object.entries(c.looks || {}).filter(([s]) => !want || s === want).map(([s, l]) => `${s}:${l.status}${l.qc ? `(${l.qc.avg})` : ""}`);
      console.log(`${d.padEnd(10)} ${looks.join("  ") || "no in-style sheets"}`);
    }
    for (const d of fs.readdirSync(path.join(P.BIBLE, "sets"))) {
      const s = P.readJSON(setFile(d), null);
      if (s) console.log(`set ${d.padEnd(6)} ${s.status || "draft"} ${s.style || ""} ${s.plates?.[0] || ""}`);
    }
  },
};

try {
  if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
  commands[cmd]();
} catch (e) { console.error("ERROR:", e.message); process.exit(1); }
