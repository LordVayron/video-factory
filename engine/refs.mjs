#!/usr/bin/env node
// The reference engine's commands. The creator never types these: they say "here are three UGC videos I like" (files
// or links) and Claude runs them, looks at every sheet, writes the breakdown and asks only what it can't tell.
//   node engine/refs.mjs add <file|url> [--note "name"] [--lang en|es]   copy or download, measure, cut the sheets
//   node engine/refs.mjs measure <id>                                     measure and cut the sheets again
//   node engine/refs.mjs show <id>                                        profile, format guess, sheet paths
//   node engine/refs.mjs breakdown <id> --file breakdown.json            check and save Claude's breakdown
//   node engine/refs.mjs page <id>                                        the breakdown page for the creator (HTML)
//   node engine/refs.mjs approve <id> --said "..." [--format-said "..."]  into the bank, in the creator's words
//   node engine/refs.mjs bank [--format ugc]                              approved patterns and their combined ranges
//   node engine/refs.mjs list
import fs from "node:fs";
import path from "node:path";
import * as R from "./lib/refs.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const pos = rest.filter((a, i) => !a.startsWith("--") && !(rest[i - 1] || "").startsWith("--"));
const flag = (k, d = null) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function summary(id) {
  const p = R.profileOf(id), m = R.metaOf(id);
  return `${id} · ${m.status}${m.format ? ` · ${m.format}` : ""}
  ${p.duration} s · ${p.size} (${p.orientation}) · ${p.shotList.length} shots (average ${p.avgShot} s, ${p.cutsPerMin} cuts/min)
  voice: ${p.narration.words} words, ${p.narration.wpm} wpm, covers ${Math.round(p.narration.coverage * 100)} %, first word at ${p.hook.firstWordAt ?? "—"} s
  hook (3 s): "${p.hook.text3s}" · ${p.hook.cutsIn3s} cuts
  under the voice: ${p.bed ? `${p.bed.db} dB (${p.bed.music ? "music/ambience" : "silence"})` : "—"} · mix ${p.loudness.spread} dB · brightness ${p.picture.brightness}, saturation ${p.picture.saturation}, movimiento ${p.motion.mean}
  music: ${p.sound?.tempo ? `${p.sound.tempo.bpm} bpm ${p.sound.tempo.steady ? "(steady beat)" : "(no steady beat)"}` : "—"} · effects outside the voice: ${p.sound?.sfx?.length ? p.sound.sfx.map((e) => `${e.at} s`).join(", ") : "none"}
  on-screen text: ${p.onScreenText?.length ? p.onScreenText.slice(0, 6).map((x) => `"${x.text}" (${x.from}–${x.to} s)`).join(" · ") : "none"}
  formato sugerido: ${p.guess.format} (${Math.round(p.guess.confidence * 100)} %): ${p.guess.why.join("; ")}
  hojas: ${path.join(R.dirOf(id), "sheets")} (overview, shot-NN, join-NN)`;
}

const cmds = {
  add() {
    const src = pos[0];
    if (!src) throw new Error('add <archivo|link> [--note "nombre"]');
    const id = R.ingest(src, { note: flag("--note", "") });
    R.measure(id, { lang: flag("--lang", "en") });
    console.log(summary(id));
    console.log(`\nNext: look at overview.jpg, every shot-NN.jpg and every join-NN.jpg, write the breakdown and save it with refs.mjs breakdown ${id} --file <json>`);
  },
  measure() { R.measure(pos[0], { lang: flag("--lang", R.profileOf(pos[0])?.lang || "en") }); console.log(summary(pos[0])); },
  show() { console.log(summary(pos[0])); },
  breakdown() {
    const id = pos[0], f = flag("--file");
    if (!id || !f) throw new Error("breakdown <id> --file breakdown.json");
    const b = JSON.parse(fs.readFileSync(f, "utf8")), bad = R.breakdownRules(b, R.profileOf(id));
    if (bad.length) { console.error(`The breakdown doesn't pass:\n - ${bad.join("\n - ")}`); process.exit(2); }
    fs.writeFileSync(path.join(R.dirOf(id), "breakdown.json"), JSON.stringify(b, null, 2) + "\n");
    const m = R.metaOf(id); fs.writeFileSync(path.join(R.dirOf(id), "meta.json"), JSON.stringify({ ...m, status: m.status === "approved" ? "approved" : "broken-down" }, null, 2) + "\n");
    console.log(`breakdown of ${id} saved; build the page (refs.mjs page ${id}) and show it to the creator`);
  },
  page() {
    const id = pos[0], p = R.profileOf(id), b = R.breakdownOf(id), m = R.metaOf(id);
    if (!b) throw new Error(`${id}: no breakdown`);
    const shot = (s) => { const x = p.shotList.find((y) => y.n === s.n) || {}; const pad = String(s.n).padStart(2, "0");
      return `<article class="shot"><img src="sheets/shot-${pad}.jpg" alt="Shot ${s.n}" loading="lazy"><div><h3>${s.n} · ${x.start ?? "?"}–${x.end ?? "?"} s</h3><p><b>${esc(s.what)}</b></p><p>${esc(s.framing)} · ${esc(s.camera)}</p><p>${esc(s.action)}</p>${s.transitionOut ? `<p class="join">→ ${esc(s.transitionOut.type)}: ${esc(s.transitionOut.how)}</p>` : ""}</div></article>`; };
    const html = `<title>${esc(m.note || id)} · reference</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{--bg:#f6f3ee;--fg:#1d1b18;--muted:#6b655c;--line:#ddd5c8;--accent:#b5482f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171513;--fg:#ede7dd;--muted:#a59d90;--line:#36312b;--accent:#e2805f;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#171513;--fg:#ede7dd;--muted:#a59d90;--line:#36312b;--accent:#e2805f;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:16px/1.55 Georgia,serif;margin:0}
main{max-width:1000px;margin:0 auto;padding-block:32px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1,h2,h3{font-family:system-ui,sans-serif;margin:0;text-wrap:balance}h1{font-size:2rem}h2{font-size:1.3rem}h3{font-size:1rem}
.k{font:600 .75rem system-ui;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px 24px}.grid div{border-top:2px solid var(--line);padding-top:8px;min-width:0}
.shot{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;border-top:1px solid var(--line);padding-top:16px}.shot img{width:100%;border-radius:4px}
.join{color:var(--accent)}img{max-width:100%}ul{margin:0;padding-left:1.2em}
@media(max-width:640px){.shot{grid-template-columns:1fr}}
</style>
<main>
<header><span class="k">Reference · ${esc(b.format)}</span><h1>${esc(m.note || id)}</h1><p>${esc(b.summary)}</p></header>
<img src="sheets/overview.jpg" alt="The whole video, frame by frame">
<section class="grid">
<div><b>Length</b><br>${p.duration} s, ${esc(p.size)}</div><div><b>Shots</b><br>${p.shotList.length} (average ${p.avgShot} s, ${p.cutsPerMin}/min)</div>
<div><b>Voice</b><br>${p.narration.words} words · ${p.narration.wpm} wpm · ${Math.round(p.narration.coverage * 100)} % of the video</div><div><b>Mix</b><br>varies ${p.loudness.spread} dB · bajo la voz ${p.bed ? `${p.bed.db} dB` : "—"}</div>
</section>
<section><h2>Hook (${b.hook.seconds} s · ${esc(b.hook.type)})</h2><p>"${esc(b.hook.text)}"</p><p>${esc(b.hook.why)}</p></section>
<section><h2>Structure</h2><ul>${b.structure.map((x) => `<li>${x.from}–${x.to} s · ${esc(x.beat)}</li>`).join("")}</ul></section>
<section><h2>Voice, music and effects</h2><p><b>Voice:</b> ${esc(b.voice.who)}. ${esc(b.voice.delivery)}</p><p><b>Music:</b> ${b.music.present ? `${esc(b.music.style)} — ${esc(b.music.role)}` : "no"}</p>${b.sfx.length ? `<ul>${b.sfx.map((x) => `<li>${x.at} s · ${esc(x.what)}</li>`).join("")}</ul>` : ""}${b.onScreenText.style ? `<p><b>On-screen text:</b> ${esc(b.onScreenText.style)}</p>` : ""}<p><b>Look:</b> ${esc(b.look)}</p></section>
<section><h2>Shot by shot</h2>${b.shots.map(shot).join("")}</section>
<section class="grid"><div><h2>What we learn</h2><ul>${b.takeaways.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div><div><h2>What we never copy</h2><ul>${b.neverCopy.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div></section>
<p><a href="#"></a>${esc(p.narration.text ? `Transcript: ${p.narration.text}` : "No voice")}</p>
</main>`;
    const out = path.join(R.dirOf(id), "page.html"); fs.writeFileSync(out, html); console.log(out);
  },
  approve() {
    const id = pos[0], f = R.approve(id, { said: flag("--said"), formatSaid: flag("--format-said") });
    console.log(`${id} approved: it joins the ${f} bank (${R.approved(f).length} ${f} reference(s))`);
  },
  bank() { console.log(JSON.stringify(R.bank(flag("--format")), null, 2)); },
  list() { for (const id of R.list()) { const m = R.metaOf(id); console.log(`${id.padEnd(32)} ${m.status.padEnd(12)} ${m.format || R.profileOf(id)?.guess?.format || ""}`); } },
};
try {
  if (!cmds[cmd]) throw new Error(`comandos: ${Object.keys(cmds).join(", ")}`);
  await cmds[cmd]();
} catch (e) { console.error(`ALTO: ${e.message}`); process.exit(2); }
