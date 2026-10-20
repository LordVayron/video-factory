#!/usr/bin/env node
// Continuity eval. Two layers:
//  1. Plan logic (free): every change of place must happen on screen in a shot with `moves` (lib/state.mjs).
//  2. Picture (vision judge): every filmed scene is split at its cuts, one frame per shot (two for long shots),
//     and a vision model reports where each character is, on what, which side, the time of day, and whether a
//     single leaves the partner's seat empty. Those facts are compared with the planned state. Any mismatch fails
//     the take; edit.mjs refuses a take whose continuity failed.
//  3. Identity (lib/identity.mjs): high-res face crops against the character reference; a face or a distinctive
//     mark (freckles, mole, glasses...) that changes fails the take. Also runs on any video, e.g. the final cut,
//     where it checks across the cuts. Mandatory on every final before delivery, in every format.
//  4. Jumps (lib/jumps.mjs, free): cuts or snaps inside a shot that should be one continuous move.
//
//   node engine/continuity.mjs <slug> [--scene A] [--take N] [--plan]
//   node engine/continuity.mjs <slug> --identity <video> [--cast ana,leo] [--lock-anchor]
//   node engine/continuity.mjs <slug> --jumps <video> [--threshold 8]
import { isNoise } from "./lib/noise.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import { judge } from "./lib/judge.mjs";
import { identityCheck, castOf } from "./lib/identity.mjs";
import { jumpCheck, jumpLines } from "./lib/jumps.mjs";
import * as P from "./lib/project.mjs";
import { planCheck } from "./lib/state.mjs";

const argv = process.argv.slice(2);
const slug = argv[0];
const flag = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
if (!slug) { console.error("usage: continuity.mjs <slug> [--scene A] [--take N] [--plan] | <slug> --identity <video> [--cast a,b] | <slug> --jumps <video>"); process.exit(1); }
const dir = P.projectDir(slug);
const sl = P.loadShotlist(slug);

// 3 on its own: identity on any video of the project (a take, or the final cut across its cuts).
if (flag("--identity")) {
  const f = path.resolve(dir, flag("--identity"));
  const cast = flag("--cast") ? flag("--cast").split(",") : castOf(sl);
  if (!cast.length) { console.error("identity: no cast (pass --cast or set shotlist.cast)"); process.exit(1); }
  // --lock-anchor: on a take the creator approved, save its face as the character's anchor for every later check.
  const r = await identityCheck(f, cast, { lockAnchor: argv.includes("--lock-anchor") });
  P.updateShotlist(slug, (x) => { x.identity = { ...(x.identity || {}), [P.rel(slug, f)]: r }; });
  for (const [name, v] of Object.entries(r.report)) for (const [m, s] of Object.entries(v.marks)) console.log(`${name} ${m}: as the anchor ${s.kept || "-"} | faded or gone ${s.lost || "-"}`);
  console.log(`${path.basename(f)}: ${r.pass ? "IDENTITY PASS" : "IDENTITY FAIL"} (${r.frames} frames, cast ${cast.join(", ")})${r.issues.length ? "\n - " + r.issues.join("\n - ") : ""}${r.notes.length ? "\n   minor: " + r.notes.join("\n   minor: ") : ""}`);
  process.exit(r.pass ? 0 : 1);
}

// 4 on its own: jumps inside one generated shot (not for a final cut, whose cuts are on purpose).
if (flag("--jumps")) {
  const f = path.resolve(dir, flag("--jumps"));
  const r = jumpCheck(f, flag("--threshold") ? { threshold: Number(flag("--threshold")) } : {});
  P.updateShotlist(slug, (x) => { x.jumps = { ...(x.jumps || {}), [P.rel(slug, f)]: r }; });
  console.log(`${path.basename(f)}: ${r.pass ? "JUMPS PASS" : "JUMPS FAIL"}\n${jumpLines(r).map((l) => " " + l).join("\n")}`);
  process.exit(r.pass ? 0 : 1);
}

// 1. Plan logic.
const plan = planCheck(sl);
console.log(plan.problems.length ? `PLAN: ${plan.problems.length} problem(s)\n - ${plan.problems.join("\n - ")}` : "plan: every change of place is shown on screen");
if (argv.includes("--plan")) process.exit(plan.problems.length ? 1 : 0);

// Cuts inside a take (same detector as qc.mjs), then the frames to judge.
function shotsOf(file) {
  const len = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", "scdet=threshold=10", "-f", "null", "-"], { encoding: "utf8" });
  const cuts = [...(r.stderr || "").matchAll(/lavfi\.scd\.time: ([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.3 && t < len - 0.3);
  const bounds = [0, ...cuts, len];
  return bounds.slice(0, -1).map((a, i) => ({ a, b: bounds[i + 1] }));
}
const frame = (file, t) => execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");

async function evalTake(sc, ci) {
  const clip = sc.clips[ci];
  let file = path.join(dir, clip.file);
  // sc.cutOut: the ranges the edit drops are dropped here too, so the take is judged as it will be cut
  // (2026-10-19, a past drama: an improvised tail that the edit removes failed the whole take).
  if (sc.cutOut?.length || sc.muteOut?.length) {
    const tf = P.takeFilters(sc);
    const trimmed = path.join(dir, "out", `_eval-${sc.id}-${ci + 1}.mp4`);
    fs.mkdirSync(path.dirname(trimmed), { recursive: true });
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `${tf.vf}null`, "-af", `${tf.af}anull`, "-c:v", "libx264", "-crf", "16", "-preset", "fast", trimmed]);
    file = trimmed;
  }
  const shots = P.sceneShots(sl, sc);
  const segs = shotsOf(file);
  // Map filmed segments to planned shots: same count → in order; otherwise by planned time.
  const planned = shots.map((s) => P.shotSecs(s));
  const total = planned.reduce((a, b) => a + b, 0);
  const bounds = planned.reduce((acc, d) => [...acc, acc.at(-1) + d], [0]);
  const shotAt = (t, i) => segs.length === shots.length ? shots[i] : shots[Math.min(shots.length - 1, bounds.findIndex((x, k) => k > 0 && (t / segs.at(-1).b) * total < x) - 1)] || shots.at(-1);
  const frames = [];
  // Dense sampling: a frame every 0.5 s across the whole take (physics glitches last a fraction of a second).
  const takeLen = segs.at(-1).b, step = Math.max(0.5, takeLen / 32);
  for (let t = 0.25; t < takeLen; t += step) { const i = segs.findIndex((g) => t >= g.a && t < g.b); frames.push({ t, shot: shotAt(t, Math.max(0, i)) }); }
  if (false) segs.forEach((g, i) => {
    const sh = shotAt((g.a + g.b) / 2, i);
    // A shot where someone moves gets a frame every ~0.7 s so the movement itself is seen.
    const n = Math.max(3, Math.ceil((g.b - g.a) / 0.7));
    const ts = sh.moves ? Array.from({ length: n }, (_, k) => g.a + 0.2 + (k * (g.b - g.a - 0.4)) / (n - 1)) : g.b - g.a > 3 ? [g.a + 0.4, g.b - 0.4] : [(g.a + g.b) / 2];
    for (const t of ts) frames.push({ t, shot: shotAt(t, i) });
  });
  const cast = [...new Set(shots.flatMap((s) => s.characters || []))];
  const expected = frames.map((f, k) => {
    const st = P.placesAt(sl, f.shot.id);
    const mv = Object.entries(f.shot.moves || {}).map(([id, m]) => `${P.character(id).name} is PLANNED to move during this shot: ${m.how}, ending on ${m.to} (leaving the frame is correct here)`).join("; ");
    return `Frame ${k + 1} (t=${f.t.toFixed(1)}s, planned ${f.shot.framing}${(f.shot.characters || []).length === 1 ? ", a single on " + P.character(f.shot.characters[0]).name : ""}): ` +
      Object.entries(st).map(([id, p]) => `${P.character(id).name} starts on ${p.place}, frame ${p.side}`).join("; ") + (mv ? `. ${mv}` : "");
  });
  const content = [
    { type: "text", text: `You are the continuity supervisor of a 1990s multi-camera sitcom. These are frames from ONE continuous scene, in order. Characters: ${cast.map((id) => `${P.character(id).name} = ${P.character(id).look}`).join(" | ")}. Scene lighting: ${sc.lighting || "as filmed"}.\n${sl.series ? (() => { try { const m = JSON.parse(fs.readFileSync(path.join(P.projectDir(slug), "..", "..", "series", sl.series, "series.json"), "utf8")).roomMap; return m ? `Room map (geography is fixed): ${m.layout} Eyelines: ${m.eyelines} Exits: ${m.exits}
` : ""; } catch { return ""; } })() : ""}For EACH frame report what you actually SEE (not what should be). PHYSICS CHECK on every frame: is any person or animal standing INSIDE the couch, a chair or a table, legs hidden inside a seat, passing through furniture, or a body merging with another? Report it in body_intersects_furniture (who = none if nothing).  Then compare with the plan below.\nPlan:\n${expected.join("\n")}\n\nAnswer with JSON only: {"frames":[{"frame":1,"characters":[{"name":"...","visible":"full|partial|edge|no","on":"couch|floor|armchair|chair|table|standing|other","seat":"left|center|right|n/a","screen_side":"left|center|right"}],"time_of_day":"night|day|dusk","single_with_empty_partner_seat":true|false,"body_intersects_furniture":{"who":"name or none","detail":"..."},"same_room_as_frame_1":true|false}],"violations":[{"frame":1,"type":"location|side|teleport|lighting|empty_seat|room|identity|geography|physics|background","severity":"major|minor","detail":"..."}]}\nA violation is anything that breaks the plan or the logic between frames: a character on a different piece of furniture or the floor, sides swapped, a character appearing somewhere new with no movement shown, night turning to day, a single whose partner's seat is visibly empty, a different room, missing glasses/cardigan/collar, or PHYSICS: a body passing through furniture, a person or animal clipping through the couch, limbs merging, objects appearing or vanishing (type physics), or GEOGRAPHY: someone entering/exiting through the wrong side, or looking the wrong way for the room map (type geography). Severity: major = wrong furniture or floor, characters' sides swapped, teleport, night/day change, empty partner seat in a single, clearly a different room, missing wardrobe. minor = background details (lamp, shelf, window) seen from a different camera angle; in a multi-camera sitcom each camera sees a different wall, so that alone is never major.` },
    ...frames.flatMap((f, k) => [{ type: "text", text: `Frame ${k + 1}` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame(file, f.t) } }]),
  ];
  const { model, text } = await judge(content);
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  // Major violations fail the take; background details seen from another camera angle are notes only
  // (in a multi-camera sitcom every camera sees a different wall).
  const fmt = (v) => `${sc.id} frame ${v.frame} (${frames[v.frame - 1]?.shot.id}, ${frames[v.frame - 1]?.t.toFixed(1)}s) ${v.type}: ${v.detail}`;
  // Severity is decided here, not by the judge (it is inconsistent): the judge reports facts, the rules decide.
  const facts = [];
  for (const f of json.frames || []) {
    const fr = frames[f.frame - 1];
    if (!fr) continue;
    const st = P.placesAt(sl, fr.shot.id);
    const movers = new Set(Object.keys(fr.shot.moves || {}));
    for (const c of f.characters || []) {
      const id = Object.keys(st).find((k) => P.character(k).name.toLowerCase().includes(String(c.name).toLowerCase().replace(/^mr\.?\s*/, "")));
      if (!id || movers.has(id) || c.visible === "no" || c.visible === "edge") continue;
      const want = st[id];
      // A planned pose wins (standing beside a chair is standing); any chair or seat accepts the judge's chair words.
      // (2026-10-19, a past drama: a dinner table read as "other" and failed a correct take.)
      const wantOn = /stand/i.test(want.pose || "") ? ["standing"] : /(cushion|on the) (of the )?(plaid )?(couch|sofa)|couch cushion/i.test(want.place) ? ["couch"] : /floor|rug/i.test(want.place) ? ["floor"] : /chair|seat|stool|bench/i.test(want.place) || /seat|sit/i.test(want.pose || "") ? ["armchair", "chair", "other"] : null;
      // A close-up can't show whether someone stands or sits: place is judged only on wider framings.
      const tight = /close|insert|single|cu\b/i.test(fr.shot.framing || "") && !/medium|wide/i.test(fr.shot.framing || "");
      if (wantOn && c.on && !tight && !wantOn.includes(c.on)) facts.push({ frame: f.frame, type: "location", detail: `${P.character(id).name} is on the ${c.on}, planned on ${want.place}` });
      if (c.visible === "full" && ["left", "right"].includes(c.seat) && ["left", "right"].includes(want.side) && c.seat !== want.side && (fr.shot.characters || []).length > 1)
        facts.push({ frame: f.frame, type: "side", detail: `${P.character(id).name} is on the ${c.seat} seat, planned ${want.side}` });
    }
    const bi = f.body_intersects_furniture;
    if (bi && bi.who && !/^none$/i.test(bi.who)) facts.push({ frame: f.frame, type: "physics", detail: `${bi.who}: ${bi.detail || "intersects furniture"}` });
    if (/night/i.test(sc.lighting || "") && f.time_of_day === "day") facts.push({ frame: f.frame, type: "lighting", detail: "reads as daytime in a night scene" });
    const partnerGone = Object.entries(st).some(([id, p]) => movers.has(id) || !/couch|sofa/i.test(p.place));
    if (f.single_with_empty_partner_seat === true && !partnerGone && (fr.shot.characters || []).length === 1) facts.push({ frame: f.frame, type: "empty_seat", detail: "single shows the partner's seat empty" });
  }
  const majorTypes = new Set(["location", "side", "teleport", "lighting", "empty_seat", "identity"]);
  const judged = json.violations || [];
  const realIdentity = (v) => v.type === "identity" && /(missing|without|no longer|lost|not wearing|no) (his |her |the )?(glasses|cardigan|collar|tag|jacket|hoops?|earrings?|freckles|mole|scar|tattoo|beard|moustache)|different (cat|dog|woman|man|person|animal|face)|wrong (cat|dog|character)/i.test(v.detail);
  const realGeography = (v) => v.type === "geography" && /door|kitchen|exit|wrong (side|direction|wall)|eyeline|looking (the )?wrong/i.test(v.detail);
  const realTeleport = (v) => v.type === "teleport" && !frames[v.frame - 1]?.shot.moves && !frames[v.frame - 2]?.shot.moves;
  // Outside the sitcom the camera is locked and every single of a person has one background: a background or room
  // change on a fixed-camera shot fails the take (2026-10-20, a past drama pilot: the set changed in the last 1.5 s of a3).
  // Trim it with cutOut and re-judge, or reroll.
  const fixedCam = (fr) => fr && /fixed|tripod|locked|static/i.test(fr.shot.camera || "");
  const realBackground = (v) => sl.format !== "sitcom" && ["background", "room"].includes(v.type) && fixedCam(frames[v.frame - 1])
    && !/acceptable|expected|reverse (angle|shot)|opposite (angle|direction)|consistent/i.test(v.detail); // a reverse angle sees another wall
  const issues = [...facts, ...judged.filter((v) => realBackground(v) || realTeleport(v) || realIdentity(v) || realGeography(v) || (v.type === "physics" && /through|clip|merg|pass(es|ing)? (into|through)|vanish|appear|intersect|inside the|fus/i.test(v.detail)))].map(fmt);
  const notes = judged.filter((v) => (!majorTypes.has(v.type) || v.type === "room") && !realBackground(v)).map(fmt);
  // Dialogue check on the take itself: every line said, nothing extra, no stutters (a past take said "set foot... foot").
  const vocal = (l) => l.vocal || /^(mwa|ha|awoo|woof|meow|grr|hm+|ah+|oh+)[-a-z! ]*$/i.test(l.text.trim());
  const sLines = shots.flatMap((s) => (s.dialogue || []).filter((l) => !vocal(l)).map((l, i) => ({ id: `${s.id}-${i + 1}`, text: l.text })));
  const tmpL = path.join(dir, "out", `_lines-${sc.id}.json`), tmpA = path.join(dir, "out", `_align-${sc.id}.json`);
  fs.mkdirSync(path.dirname(tmpL), { recursive: true });
  fs.writeFileSync(tmpL, JSON.stringify(sLines));
  const ar = spawnSync("python", [path.join(ROOT, "engine", "lib", "align.py"), file, tmpL, tmpA, sl.lang === "es" ? "es" : "en"], { encoding: "utf8" });
  if (ar.status === 0) {
    const al = JSON.parse(fs.readFileSync(tmpA, "utf8"));
    for (const l of al.lines) if (l.found < 0.8) issues.push(`${sc.id} dialogue: line ${l.id} missing or garbled (${Math.round(l.found * 100)}% of its words heard)`);
    const noise = isNoise;
    const extras = (al.extras || []).filter((w) => w.replace(/[^a-z]/gi, "").length > 1 && !noise(w));
    if (extras.length > 2) issues.push(`${sc.id} dialogue: ${extras.length} words not in the script: ${extras.slice(0, 8).join(" ")}`);
    for (const w of (al.repeats || []).filter((x) => !noise(x))) issues.push(`${sc.id} dialogue: repeated word "${w}"`);
  } else notes.push(`${sc.id} dialogue check could not run`);
  // Identity: faces and distinctive marks at full resolution against the reference. It fails closed.
  try {
    const idr = await identityCheck(file, cast);
    issues.push(...idr.issues.map((x) => `${sc.id} ${x}`));
    notes.push(...idr.notes.map((x) => `${sc.id} ${x}`));
  } catch (e) { issues.push(`${sc.id} identity check could not run: ${e.message.slice(0, 120)}`); }
  const result = { pass: !issues.length, issues, notes, judge: model, frames: frames.length, at: new Date().toISOString() };
  // A passing take becomes the scene's chosen take unless one is already chosen and passing (2026-10-20, a past drama:
  // three passing scenes still read "sin toma elegida", so the flow could not reach the edit).
  P.updateShotlist(slug, (x) => {
    const s = P.scene(x, sc.id);
    s.clips[ci].continuity = result;
    if (result.pass && (s.clip == null || !s.clips[s.clip]?.continuity?.pass)) s.clip = ci;
  });
  console.log(`${sc.id} take ${ci + 1}: ${result.pass ? "CONTINUITY PASS" : "CONTINUITY FAIL"} (${frames.length} frames, ${model})${issues.length ? "\n - " + issues.join("\n - ") : ""}${notes.length ? "\n   minor: " + notes.join("\n   minor: ") : ""}`);
  return result;
}

// A background change only in the last seconds of a take (the camera creeping wider as the generation ends) is cut
// off automatically and the take judged again, when no line is spoken there and a beat of the last shot remains
// (2026-10-20, a past drama: both A and C drifted in their last 1.5-2 s and the trims were set by hand).
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
async function evalWithTailTrim(sc, ci) {
  const r = await evalTake(sc, ci);
  if (r.pass || sl.format === "sitcom") return r;
  const bg = r.issues.filter((x) => / (background|room): /.test(x)), other = r.issues.filter((x) => !bg.includes(x));
  if (!bg.length || other.length) return r;
  const len = dur(path.join(dir, sc.clips[ci].file));
  const cut = sc.cutOut || [];
  if (cut.length > 1 || (cut.length === 1 && cut[0][1] < len - 0.05)) return r; // only a single tail cut can be extended
  const kept = cut.length ? cut[0][0] : len;
  const times = bg.map((x) => Number((x.match(/, ([\d.]+)s\)/) || [])[1])).filter((t) => !Number.isNaN(t));
  const start = Math.round((Math.min(...times) - 0.3) * 10) / 10;
  let lastWord = 0;
  try { const a = JSON.parse(fs.readFileSync(path.join(dir, "out", `_align-${sc.id}.json`), "utf8")); lastWord = Math.max(0, ...(a.words || []).map((w) => w.end)); } catch {}
  if (times.length !== bg.length || start < kept - 2.5 || start < lastWord + 0.8) { console.log(`${sc.id}: background change not only in a silent tail; no automatic trim`); return r; }
  P.updateShotlist(slug, (x) => { P.scene(x, sc.id).cutOut = [[start, Math.ceil(len * 10) / 10 + 0.5]]; });
  sc.cutOut = [[start, Math.ceil(len * 10) / 10 + 0.5]];
  console.log(`${sc.id}: background drift in the last ${(kept - start).toFixed(1)} s; cut from ${start} s and judged again`);
  return evalTake(sc, ci);
}

const only = flag("--scene") || flag("--scenes");
const take = flag("--take");
const jobs = (sl.scenes || []).filter((sc) => (!only || only.split(",").includes(sc.id)) && sc.clips?.length)
  .map((sc) => evalWithTailTrim(sc, take != null ? Number(take) - 1 : sc.clips.length - 1));
const results = await Promise.all(jobs);
process.exit(results.every((r) => r.pass) && !plan.problems.length ? 0 : 1);
