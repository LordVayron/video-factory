#!/usr/bin/env node
// Style sheets (phase 2). A style decides look, camera, motion, audio, finish, models and extra QC.
//
//   node engine/style.mjs list
//   node engine/style.mjs new <id> --from <template> [--name "..."]      copy a template (or _template)
//   node engine/style.mjs northstar <id> "<scene description>" [--model gpt2.5] [--ar 9:16] [--ref img]...
//   node engine/style.mjs approve <id> --northstar <file>                  lock the style (gate for phase 2)
//   node engine/style.mjs winner <id> --video <key> --res 1080p [--keyframe gpt2.5] --note "..."   (phase 6)
//   node engine/style.mjs lesson <id> "<what we learned>"                 (phase 9)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";

const argv = process.argv.slice(2);
const [cmd, id] = argv;
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flags = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));
const dirOf = (sid) => path.join(P.BIBLE, "styles", sid);
const fileOf = (sid) => path.join(dirOf(sid), "style.json");
const load = (sid) => { const s = P.readJSON(fileOf(sid), null); if (!s) throw new Error(`no style "${sid}"`); return s; };
const save = (s) => P.writeJSON(fileOf(s.id), s);

const commands = {
  list() {
    const d = path.join(P.BIBLE, "styles");
    for (const f of fs.readdirSync(d)) {
      const s = P.readJSON(path.join(d, f, "style.json"), null);
      if (s) console.log(`${s.id.padEnd(14)} ${String(s.status).padEnd(9)} ${s.kind.padEnd(10)} ${s.lookTest?.winner ? "tested " : "untested"}  ${s.name}`);
    }
  },
  new() {
    if (!id) throw new Error("usage: new <id> --from <template>");
    if (fs.existsSync(fileOf(id))) throw new Error(`style "${id}" exists`);
    const from = flag("--from", "_template");
    const src = from === "_template" ? P.readJSON(path.join(P.BIBLE, "styles", "_template.json")) : load(from);
    const s = { ...structuredClone(src), id, name: flag("--name", src.name || id), status: "draft", northStar: null, lookTest: { winner: null, results: [] }, lessons: [], derivedFrom: from };
    save(s);
    console.log(`created bible/styles/${id}/style.json from ${from}. Edit look, imageRules, negative, camera, motion, audio, finish, qc.extra, then make a north star.`);
  },
  northstar() {
    const scene = argv[2];
    if (!scene) throw new Error('usage: northstar <id> "<scene>"');
    const s = load(id);
    fs.mkdirSync(dirOf(id), { recursive: true });
    let k = 1; while (fs.existsSync(path.join(dirOf(id), `north-star-${k}.png`))) k++;
    const out = path.join(dirOf(id), `north-star-${k}.png`);
    const prompt = [s.look, scene, s.imageRules, `Avoid: ${s.negative}.`, "Single frame, no text, no collage."].filter(Boolean).join(" ");
    const args = [path.join(ROOT, "engine", "gen.mjs"), "still", prompt, out, "--model", flag("--model", s.models?.keyframe || "gpt2.5"), "--size", s.models?.imageSize || "2K", "--ar", flag("--ar", "9:16"), ...flags("--ref").flatMap((r) => ["--ref", r])];
    execFileSync(process.execPath, args, { stdio: "inherit" });
    console.log(out);
  },
  approve() {
    const s = load(id);
    const ns = flag("--northstar") || s.northStar;
    if (!ns) throw new Error("approve needs --northstar <file> (the frame every shot is judged against)");
    const rel = path.isAbsolute(ns) ? path.relative(dirOf(id), ns) : path.basename(ns);
    if (!fs.existsSync(path.join(dirOf(id), rel))) throw new Error(`north star not found: ${rel}`);
    s.northStar = rel.replace(/\\/g, "/");
    s.status = "approved";
    s.approvedAt = new Date().toISOString();
    save(s);
    console.log(`style ${id} approved (north star ${s.northStar})`);
  },
  winner() {
    const s = load(id);
    const video = flag("--video");
    if (!video) throw new Error("usage: winner <id> --video <model> --res 1080p [--keyframe gpt2.5] --note ...");
    s.lookTest ||= { results: [] };
    s.lookTest.winner = { video, res: flag("--res", s.models.res), keyframe: flag("--keyframe", s.models.keyframe), date: new Date().toISOString().slice(0, 10) };
    s.lookTest.results.push({ date: s.lookTest.winner.date, winner: video, notes: flag("--note", "") });
    s.models = { ...s.models, video, res: s.lookTest.winner.res, keyframe: s.lookTest.winner.keyframe };
    save(s);
    console.log(`look test recorded for ${id}: ${video} @ ${s.lookTest.winner.res}, keyframes ${s.lookTest.winner.keyframe}`);
  },
  lesson() {
    const s = load(id);
    const text = argv[2];
    if (!text) throw new Error('usage: lesson <id> "<text>"');
    (s.lessons ||= []).push(`${new Date().toISOString().slice(0, 10)}: ${text}`);
    save(s);
    console.log(`lesson added to ${id}`);
  },
};

try {
  if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
  commands[cmd]();
} catch (e) { console.error("ERROR:", e.message); process.exit(1); }
