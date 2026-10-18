#!/usr/bin/env node
// Pipeline v4, gate 2: the Production Book. One page with everything the user approves before video money is
// spent (script, direction + DNA pacing checks, characters, set, storyboards, radio cut, animatic, the exact
// video prompts, model and cost). Run again after the final cut to add takes, QC, the final video and real cost.
//
//   node engine/book.mjs <slug>    -> projects/<slug>/book/index.html + assets; prints the files map to publish
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import { getModel } from "./lib/models.mjs";
import { planCheck } from "./lib/state.mjs";

const slug = process.argv[2];
if (!slug) { console.error("usage: book.mjs <slug>"); process.exit(1); }
const dir = P.projectDir(slug);
const sl = P.loadShotlist(slug);
const out = path.join(dir, "book");
fs.mkdirSync(out, { recursive: true });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const files = {};
const jpg = (src, name, width) => {
  if (!src || !fs.existsSync(src)) return null;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", path.join(out, name)]);
  files[name] = name;
  return name;
};
const copy = (src, name) => { if (!src || !fs.existsSync(src)) return null; fs.copyFileSync(src, path.join(out, name)); files[name] = name; return name; };
const abs = (f) => (f ? (path.isAbsolute(f) ? f : path.join(dir, f)) : null);

const final = sl.scenes?.every((sc) => sc.clip != null && sc.clips?.[sc.clip]?.qc?.pass) && fs.existsSync(path.join(dir, "out", `${slug}.mp4`));
const st = P.style(sl.style);
const pick = { video: sl.defaults?.videoModel || st.models?.video, res: sl.defaults?.res || st.models?.res || "480p" };
const vm = getModel(pick.video);

// Script
const laughName = { chuckle: "chuckle", laugh: "laugh", big: "big laugh" };
const scriptHtml = sl.scenes.map((sc) => {
  const rows = P.sceneShots(sl, sc).map((s) => {
    const lines = (s.dialogue || []).map((l) => `<div class="cue"><span class="who">${esc(P.character(l.char).name)}</span>${l.delivery ? `<span class="paren">(${esc(l.delivery)})</span>` : ""}${l.beat ? `<span class="paren">[beat ${l.beat}s]</span>` : ""}<span>${esc(l.text)}</span>${l.laugh ? `<span class="lf">(${laughName[l.laugh] || l.laugh})</span>` : ""}</div>`).join("");
    return lines || `<div class="action">${esc(s.motion)}</div>`;
  }).join("");
  return `<div class="scene">Scene ${esc(sc.id)} · ${esc(sc.summary)}</div>${rows}`;
}).join("");

// Pacing (radio cut) against the DNA rules
const R = sl.radio || {};
const rules = sl.paceRules || { minWpm: 140, maxGap: 0.6, maxDeadPct: 8, maxFirstLaugh: 6, maxSecondsPerLaugh: 7.5 };
const row = (label, val, target, ok) => `<tr><td>${label}</td><td class="num">${val ?? "—"}</td><td class="num">${target}</td><td>${ok ? '<span class="ok">pass</span>' : '<span class="bad">fail</span>'}</td></tr>`;
const pacingHtml = R.file ? `<div class="shots"><table class="narrow"><thead><tr><th>Metric (radio cut)</th><th class="num">Value</th><th class="num">Target</th><th></th></tr></thead><tbody>
${row("Length", `${R.length} s`, "40–60 s", R.length >= 35 && R.length <= 60)}
${row("Delivery", `${R.wpm} wpm`, `≥ ${rules.minWpm}`, R.wpm >= rules.minWpm)}
${row("Longest unplanned gap", `${R.maxUnplannedGap} s`, `≤ ${rules.maxGap} s`, R.maxUnplannedGap <= rules.maxGap)}
${row("Dead air", `${R.deadAirPct} %`, `≤ ${rules.maxDeadPct} %`, R.deadAirPct <= rules.maxDeadPct)}
${row("First laugh", `${R.firstLaugh} s`, `≤ ${rules.maxFirstLaugh} s`, R.firstLaugh != null && R.firstLaugh <= rules.maxFirstLaugh)}
${row("Laughs", `${R.laughs} (one every ${R.secondsPerLaugh} s)`, `every ≤ ${rules.maxSecondsPerLaugh} s`, R.secondsPerLaugh != null && R.secondsPerLaugh <= rules.maxSecondsPerLaugh)}
</tbody></table></div>` : `<p class="muted">No radio cut yet (node engine/radio.mjs ${slug}).</p>`;

// Characters and set
const castIds = [...new Set(sl.shots.flatMap((s) => s.characters || []))];
const castHtml = castIds.map((id) => {
  const c = P.character(id);
  const sheet = jpg(path.join(ROOT, "bible", "characters", id, "model-sheet.png"), `sheet-${id}.jpg`, 1800);
  return sheet ? `<figure><img src="${sheet}" alt="${esc(c.name)} model sheet" loading="lazy"><figcaption><b>${esc(c.name)}</b> · ${esc(c.traits || "")}</figcaption></figure>` : "";
}).join("");
let setImg = null;
try { const s = P.readJSON(path.join(ROOT, "bible", "sets", sl.set, "set.json")); setImg = jpg(path.join(ROOT, "bible", "sets", sl.set, (s.plates || [])[0] || "plate-empty.png"), "set.jpg", 900); } catch {}

// Storyboards + shot table
const boardsHtml = sl.scenes.map((sc) => {
  const g = jpg(abs(sc.grid), `grid-${sc.id}.jpg`, 1400);
  return g ? `<figure><img src="${g}" alt="Scene ${esc(sc.id)} storyboard" loading="lazy"><figcaption><span class="tag">Scene ${esc(sc.id)}</span> ${P.sceneShots(sl, sc).length} shots · ${P.sceneSecs(P.sceneShots(sl, sc))} s generation</figcaption></figure>` : "";
}).join("");
const shotRows = sl.shots.map((s) => {
  const sc = sl.scenes.find((x) => x.shots.includes(s.id));
  const th = jpg(abs(s.board?.file), `${s.id}.jpg`, 300);
  const t0 = s.radio ? `${s.radio.start.toFixed(1)}–${s.radio.end.toFixed(1)} s` : `${s.duration} s`;
  const lines = (s.dialogue || []).map((l) => `<q>${esc(l.text)}</q>${l.laugh ? ` <span class="lf">${laughName[l.laugh]}</span>` : ""}`).join("<br>") || "—";
  return `<tr><td><span class="tag">${esc(sc?.id)}</span> ${esc(s.id)}</td><td>${th ? `<img src="${th}" alt="">` : ""}</td><td class="num">${t0}</td><td>${esc(s.framing)} · ${esc(s.lens)}</td><td>${esc(s.motion)}</td><td>${lines}</td></tr>`;
}).join("");

// Media
const radio = R.file ? copy(abs(R.file), "radio-cut.mp3") : null;
const animatic = copy(path.join(dir, "out", "animatic.mp4"), "animatic.mp4");

// Prompts + estimate
const promptsHtml = sl.scenes.map((sc) => {
  const refs = P.sceneRefs(sl, sc);
  const voices = [...new Set(P.sceneShots(sl, sc).flatMap((s) => (s.dialogue || []).map((l) => l.char)))];
  return `<details><summary>Scene ${esc(sc.id)} · ${P.sceneSecs(P.sceneShots(sl, sc))} s</summary><pre>${esc(P.scenePrompt(sl, sc, refs, { voiceRefs: voices }))}</pre></details>`;
}).join("");
let est = 0;
const estRows = sl.scenes.map((sc) => {
  const secs = P.sceneSecs(P.sceneShots(sl, sc));
  const cr = vm.cost({ res: pick.res, duration: secs });
  est += cr;
  return `<tr><td>Scene ${esc(sc.id)}</td><td class="num">${secs} s</td><td class="num">$${(cr * 0.005).toFixed(2)}</td></tr>`;
}).join("");
const ledger = (() => { try { const l = P.readJSON(path.join(dir, "ledger.json")); return (Array.isArray(l) ? l : l.jobs || []); } catch { return []; } })();
const spent = ledger.reduce((n, j) => n + (j.credits || 0), 0);

// Final section (after the cut)
let finalHtml = "";
if (final) {
  // The page has a 16 MB per-file limit: re-encode the final for the book if it's bigger.
  const src = path.join(dir, "out", `${slug}.mp4`);
  let fv = copy(src, "final.mp4");
  if (fs.statSync(src).size > 14e6) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path.join(out, "final.mp4")]);
  const takes = sl.scenes.map((sc) => sc.clips.map((c, i) => `<tr><td>Scene ${esc(sc.id)} take ${i + 1}</td><td>${esc(c.model || "")}</td><td class="num">${c.qc?.avg ?? "—"}</td><td>${c.qc ? (c.qc.pass ? '<span class="ok">pass</span>' : '<span class="bad">fail</span>') : "—"}${i === sc.clip ? " · used" : ""}</td><td>${c.continuity ? (c.continuity.pass ? '<span class="ok">continuity pass</span>' : '<span class="bad">continuity fail</span> ' + esc(c.continuity.issues.join("; "))) : ""} ${esc(c.qc?.issues || "")}</td></tr>`).join("")).join("");
  const fq = sl.finalQc || {};
  finalHtml = `<section id="final"><div class="slate"><span class="no">09</span><h2>Final cut</h2><span class="muted">QC and real cost</span></div>
  <div class="final"><figure><video src="${fv}" controls playsinline preload="metadata"></video><figcaption>${fq.loudness ?? "—"} LUFS · true peak ${fq.truePeak ?? "—"} dB · ${fq.duration ?? "—"} s · ${fq.pass ? "final QC pass" : "final QC: " + esc((fq.problems || []).join("; "))}</figcaption></figure>
  <div style="display:grid;gap:18px;min-width:0"><div class="shots"><table class="narrow"><thead><tr><th>Take</th><th>Model</th><th class="num">QC</th><th></th><th>Notes</th></tr></thead><tbody>${takes}</tbody></table></div>
  <p class="big">$${(spent * 0.005).toFixed(2)}</p><p class="muted">Real spend for this episode (${spent.toFixed(0)} credits), every job from the ledger.</p></div></div></section>`;
}

const concept = fs.existsSync(path.join(dir, "concept.md")) ? fs.readFileSync(path.join(dir, "concept.md"), "utf8") : "";
const conceptLines = concept.split("\n").filter((l) => /^- /.test(l)).map((l) => `<li>${esc(l.slice(2)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>`).join("");
const sceneNotes = sl.scenes.map((sc) => `<div class="note"><h3>Scene ${esc(sc.id)}</h3><p>${esc(sc.blocking)}</p>${sc.lighting ? `<p class="muted">Lighting lock: ${esc(sc.lighting)}</p>` : ""}</div>`).join("");

const html = `<title>${esc(sl.title.replace(/^.*—\s*/, ""))} Production Book</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=IBM+Plex+Sans:wght@400;500;600&family=Courier+Prime:wght@400;700&display=swap">
<style>
/* Layout: the studio's production binder — slate tabs per step, script in typewriter face, boards as contact sheets. */
:root { --paper:#f2f1ec; --card:#fbfaf7; --ink:#1d2230; --muted:#5d6272; --rule:#d6d4cb; --navy:#1f2a44; --tungsten:#b8661a; --gate:#a8302a; --ok:#2f7a4b;
  --display:"Barlow Condensed","Arial Narrow",sans-serif; --body:"IBM Plex Sans",system-ui,sans-serif; --type:"Courier Prime","Courier New",monospace; color-scheme:light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#12151d; --card:#1a1e29; --ink:#e9e7e1; --muted:#a2a6b3; --rule:#2c3242; --navy:#9fb2e0; --tungsten:#e7a25a; --gate:#e2756e; --ok:#6cc28e; color-scheme:dark; } }
:root[data-theme="dark"] { --paper:#12151d; --card:#1a1e29; --ink:#e9e7e1; --muted:#a2a6b3; --rule:#2c3242; --navy:#9fb2e0; --tungsten:#e7a25a; --gate:#e2756e; --ok:#6cc28e; color-scheme:dark; }
body { background:var(--paper); color:var(--ink); font:400 16px/1.6 var(--body); }
.wrap { max-width:1040px; margin:0 auto; padding-inline:20px; padding-block:40px 80px; display:grid; gap:60px; }
h1,h2,h3 { font-family:var(--display); font-weight:800; line-height:1.05; text-wrap:balance; margin:0; text-transform:uppercase; }
h1 { font-size:clamp(2.6rem,8vw,4.4rem); } h2 { font-size:clamp(1.8rem,5vw,2.5rem); } h3 { font-size:1.2rem; font-weight:600; color:var(--navy); }
p { margin:0; max-width:68ch; } .muted { color:var(--muted); }
.eyebrow { font:600 .78rem/1 var(--body); letter-spacing:.14em; text-transform:uppercase; color:var(--tungsten); }
section { display:grid; gap:20px; }
.slate { display:flex; align-items:baseline; gap:14px; border-top:3px solid var(--ink); padding-top:12px; flex-wrap:wrap; }
.slate .no { font:800 1rem/1 var(--display); background:var(--ink); color:var(--paper); padding:6px 10px; letter-spacing:.08em; }
.status { display:inline-block; font:800 .9rem/1 var(--display); letter-spacing:.12em; text-transform:uppercase; color:var(--gate); border:2px solid var(--gate); padding:6px 10px; transform:rotate(-2deg); justify-self:start; }
.status.done { color:var(--ok); border-color:var(--ok); }
ul { margin:0; padding-left:1.1em; display:grid; gap:4px; }
.script { background:var(--card); border:1px solid var(--rule); padding:24px clamp(16px,5vw,52px); font:400 15px/1.55 var(--type); display:grid; gap:10px; overflow-x:auto; }
.script .scene { font-weight:700; text-transform:uppercase; margin-top:8px; }
.script .cue { display:grid; gap:1px; margin-left:clamp(0px,12vw,160px); max-width:40ch; }
.script .who { text-transform:uppercase; margin-left:clamp(0px,6vw,70px); }
.script .paren { margin-left:clamp(0px,3vw,36px); color:var(--muted); }
.lf { color:var(--tungsten); font-family:var(--type); }
.cols { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:18px; }
.note { background:var(--card); border:1px solid var(--rule); padding:18px; display:grid; gap:8px; align-content:start; min-width:0; }
figure { margin:0; display:grid; gap:8px; min-width:0; }
figure img, figure video { width:100%; height:auto; display:block; border:1px solid var(--rule); background:#000; }
figcaption { font-size:.85rem; color:var(--muted); }
.sheets, .boards { display:grid; gap:24px; }
.boards { grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); align-items:start; }
.shots { overflow-x:auto; border:1px solid var(--rule); background:var(--card); }
table { border-collapse:collapse; width:100%; min-width:760px; font-size:.9rem; } table.narrow { min-width:440px; }
th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--rule); vertical-align:top; }
th { font:600 .72rem/1.2 var(--body); letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
td img { width:64px; border:1px solid var(--rule); display:block; } td q { font-family:var(--type); }
.tag { display:inline-block; font:600 .7rem/1 var(--body); letter-spacing:.08em; text-transform:uppercase; padding:4px 6px; border:1px solid currentColor; color:var(--navy); }
.ok { color:var(--ok); font-weight:600; } .bad { color:var(--gate); font-weight:600; }
.media { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,320px)); gap:20px; align-items:start; }
audio { width:100%; }
details { background:var(--card); border:1px solid var(--rule); } summary { cursor:pointer; padding:14px 18px; font-weight:600; }
summary:focus-visible { outline:2px solid var(--tungsten); }
pre { margin:0; padding:0 18px 18px; font:400 13px/1.55 var(--type); white-space:pre-wrap; word-break:break-word; }
.final { display:grid; grid-template-columns:minmax(0,340px) minmax(0,1fr); gap:28px; align-items:start; }
@media (max-width:700px) { .final { grid-template-columns:1fr; } }
.big { font:800 clamp(2.2rem,6vw,3.2rem)/1 var(--display); color:var(--ok); }
tfoot td { font-weight:600; border-bottom:0; }
footer { font-size:.85rem; color:var(--muted); }
</style>
<div class="wrap">
<header style="display:grid;gap:16px">
  <span class="eyebrow">${esc(sl.title.split("—")[0].trim())} · Production Book</span>
  <h1>${esc(sl.title.replace(/^.*—\s*/, ""))}</h1>
  <span class="status${final ? " done" : ""}">${final ? "Final · delivered" : "Gate 2 · awaiting your approval"}</span>
  <ul>${conceptLines}</ul>
  <p class="muted">${sl.shots.length} shots · ${sl.scenes.length} scenes · ${esc(sl.style)} · ${esc(sl.ar)} · video: ${esc(vm.label)} ${esc(pick.res)} · images: GPT Image 2.5</p>
</header>

<section><div class="slate"><span class="no">01</span><h2>Script</h2><span class="muted">laughs and beats as cut in the radio cut</span></div><div class="script">${scriptHtml}</div></section>

<section><div class="slate"><span class="no">02</span><h2>Direction</h2><span class="muted">pacing checked against the vertical DNA, blocking and light per scene</span></div>${pacingHtml}${(() => { const pc = planCheck(sl); return `<div class="note"><h3>Continuity logic</h3>${pc.problems.length ? `<p class="bad">Blocked: ${pc.problems.length} problem(s)</p><ul>${pc.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="ok">Every character keeps their place; any change of place is shown on screen.</p>`}${sl.scenes.map((sc) => sc.seats ? `<p class="muted">Scene ${esc(sc.id)}: ${Object.entries(sc.seats).map(([id, s]) => `${esc(P.character(id).name)} on ${esc(s.place)} (${s.side})`).join(" · ")}</p>` : "").join("")}</div>`; })()}<div class="cols">${sceneNotes}</div></section>

<section><div class="slate"><span class="no">03</span><h2>Characters</h2></div><div class="sheets">${castHtml}</div></section>

${setImg ? `<section><div class="slate"><span class="no">04</span><h2>Set</h2></div><figure style="max-width:560px"><img src="${setImg}" alt="Set plate" loading="lazy"></figure></section>` : ""}

<section><div class="slate"><span class="no">05</span><h2>Storyboard</h2><span class="muted">one GPT Image 2.5 grid per scene</span></div><div class="boards">${boardsHtml}</div>
<div class="shots"><table><thead><tr><th>Shot</th><th>Board</th><th class="num">Time</th><th>Framing</th><th>Action</th><th>Lines</th></tr></thead><tbody>${shotRows}</tbody></table></div></section>

<section><div class="slate"><span class="no">06</span><h2>Radio cut and animatic</h2><span class="muted">the free draft: this timing is what gets filmed</span></div>
<div class="media">${radio ? `<figure><audio src="${radio}" controls preload="metadata"></audio><figcaption>Radio cut · ${R.length} s · voices, laughs, outro</figcaption></figure>` : ""}${animatic ? `<figure><video src="${animatic}" controls playsinline preload="metadata"></video><figcaption>Animatic: boards cut to the radio cut</figcaption></figure>` : ""}</div></section>

<section><div class="slate"><span class="no">07</span><h2>Video prompts</h2><span class="muted">exactly what ${esc(vm.label)} receives, one generation per scene</span></div>${promptsHtml}</section>

<section><div class="slate"><span class="no">08</span><h2>Cost</h2><span class="muted">${final ? "estimate before filming" : "what approving this book will spend"}</span></div>
<div class="shots"><table class="narrow"><thead><tr><th>Item</th><th class="num">Length</th><th class="num">Cost</th></tr></thead><tbody>${estRows}<tr><td>Voices, laughs, music (ElevenLabs)</td><td></td><td class="num">$0.00</td></tr><tr><td>Already spent (storyboards)</td><td></td><td class="num">$${(spent * 0.005).toFixed(2)}</td></tr></tbody>
<tfoot><tr><td>${final ? "Episode total (real)" : "Episode total (no rerolls)"}</td><td></td><td class="num">${((spent + (final ? 0 : est)) * 0.005).toFixed(2)}</td></tr></tfoot></table></div></section>
${finalHtml}
<footer>AI Video Factory · pipeline v4 · ${new Date().toISOString().slice(0, 10)}</footer>
</div>`;
fs.writeFileSync(path.join(out, "index.html"), html);
if (!final) { const s3 = P.loadShotlist(slug); s3.bookEstimate = Math.ceil(est); P.saveShotlist(slug, s3); }
fs.writeFileSync(path.join(out, "files.json"), JSON.stringify(files, null, 2));
console.log(path.join(out, "index.html"));
console.log(`${Object.keys(files).length} files · ${final ? "final" : "gate 2"} · estimate $${(est * 0.005).toFixed(2)} video`);
