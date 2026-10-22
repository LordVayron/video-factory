#!/usr/bin/env node
// Gate 2: the Production Book, for every format (flow v5). One page with everything the creator approves before
// video money is spent: intake, script, direction, characters with their marks, set, storyboard or frames,
// radio cut and animatic, the exact video prompts, model and cost, the evals that will run, and every approval
// and override with the creator's own words. Run again by `studio.mjs deliver` after the final QC: it adds the takes
// with their evals, the final video, the final QC and the real cost.
//
//   node engine/book.mjs <slug>    -> projects/<slug>/book/index.html + assets; prints the files map to publish
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import { getModel } from "./lib/models.mjs";
import { planCheck } from "./lib/state.mjs";
import * as F from "./lib/flow.mjs";
import { marksOf } from "./lib/identity.mjs";

const slug = process.argv[2];
if (!slug) { console.error("usage: book.mjs <slug>"); process.exit(1); }
const dir = P.projectDir(slug);
const sl = P.loadShotlist(slug);
const kind = F.kindOf(sl);
const finalPath = F.finalFile(sl);
// Final mode only while the delivered cut still is the current plan: a project reopened after delivery builds a gate
// book again, or its approval would lock the old estimate.
const final = !!sl.finalQc5?.pass && sl.finalQc5.sha === F.fileSha(finalPath) && F.stepStatus(sl, "edit").ok && F.stepStatus(sl, "book").ok; // a reopened book is a gate book again
try { F.requireStep(sl, final ? "deliver" : "book", final ? "book (final)" : "book"); }
catch (e) { if (e instanceof F.FlowStop) { console.error(`ALTO: ${e.message}`); process.exit(2); } throw e; }
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
// A 360 px JPEG of an image for the book (references repeat across scenes; one file per source).
const thumb = (src, name) => { if (!src || !fs.existsSync(src)) return null; if (!files[name]) { execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", "scale=360:-2", "-q:v", "5", path.join(out, name)]); files[name] = name; } return name; };
const abs = (f) => (f ? (path.isAbsolute(f) ? f : path.join(dir, f)) : null);
const usd = (cr) => `$${(cr * 0.005).toFixed(2)}`;
const cname = (id) => { try { return P.character(id).name; } catch { return id; } };
const ok = (b, yes = "pass", noo = "fail") => (b ? `<span class="ok">${yes}</span>` : `<span class="bad">${noo}</span>`);

const st = kind === "longform" ? { models: {} } : P.style(sl.style);
const pick = { video: sl.defaults?.videoModel || st.models?.video || (kind === "clips" ? "veo" : "sd2-mini"), res: sl.defaults?.res || st.models?.res || (kind === "clips" ? "720p" : "480p") };
const vm = getModel(kind === "longform" ? sl.longform?.videoModel || "sd2-mini" : pick.video);
const laughName = { chuckle: "chuckle", laugh: "laugh", big: "big laugh" };
const cue = (l) => `<div class="cue"><span class="who">${esc(cname(l.char))}</span>${l.delivery ? `<span class="paren">(${esc(l.delivery)})</span>` : ""}${l.beat ? `<span class="paren">[beat ${l.beat}s]</span>` : ""}<span>${esc(l.text)}</span>${l.laugh ? `<span class="lf">(${laughName[l.laugh] || l.laugh})</span>` : ""}</div>`;

// ---- Script
let scriptHtml = "";
if (kind === "scenes") scriptHtml = (sl.scenes || []).map((sc) => `<div class="scene">Scene ${esc(sc.id)} · ${esc(sc.summary)}</div>` + P.sceneShots(sl, sc).map((s) => (s.dialogue || []).map(cue).join("") || `<div class="action">${esc(s.motion)}</div>`).join("")).join("");
if (kind === "clips") scriptHtml = (sl.shots || []).map((s) => `<div class="scene">Shot ${esc(s.id)} · ${esc(s.summary || "")} · ${s.duration ?? "?"} s</div><div class="action">${esc(s.action || s.motion || "")}</div>${(s.dialogue || []).map(cue).join("")}`).join("");
if (kind === "longform") scriptHtml = (sl.longform?.script || []).map((s, i) => `<div class="cue"><span class="who">${String(i + 1).padStart(2, "0")}</span><span>${esc(s.text)}</span><span class="paren">[pause ${s.pauseAfter ?? 0} s]</span></div>`).join("") || `<p class="muted">Voice-free ambient.</p>`;

// ---- Launch films: the creative brief, the concepts, the timed plan and the locked style (lib/launch.mjs)
let strategyHtml = "";
if (sl.format === "launch") {
  const rd = (k) => P.readJSON(path.join(dir, "launch", { brief: "brief.json", concepts: "concepts.json", plan: "shot-plan.json", style: "style-bible.json" }[k]), null);
  const b = rd("brief"), c = rd("concepts"), plan = rd("plan"), st2 = rd("style");
  const m = b?.message || {};
  const tc = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
  if (plan?.shots) scriptHtml = plan.shots.map((s) => `<div class="scene">${tc(s.start)}–${tc(s.start + s.duration)} · ${esc(s.id)} · ${esc(s.role)}</div><div class="action">${esc(s.visual)}</div>${s.vo ? `<div class="cue"><span class="who">VO</span><span>${esc(s.vo)}</span></div>` : ""}${(s.text || []).map((o) => `<div class="cue"><span class="who">On screen · ${esc(o.kind)}</span><span>${esc(o.text)}</span></div>`).join("")}${s.logo ? `<div class="cue"><span class="who">Logo</span></div>` : ""}`).join("");
  const brief = b ? `<div class="note"><h3>Creative brief · ${esc(b.product?.name)}</h3><ul>${[["ICP", m.icp], ["Pain", m.pain], ["Consequence", m.consequence], ["Promise", m.promise], ["Before → after", `${m.before} → ${m.after}`], ["Proof", `${m.proof} (${m.proofCapability})`], ["Differentiator", m.differentiator || "none claimed"], ["Emotion", m.emotion], ["CTA", m.cta]].map(([k, v]) => `<li><b>${k}:</b> ${esc(v)}</li>`).join("")}</ul>
    <p class="muted">Sources: ${(b.sources || []).map((s) => `${esc(s.kind)} ${esc(s.ref)}${s.retrievedAt ? ` (${esc(s.retrievedAt.slice(0, 10))})` : ""}`).join(" · ")}</p>
    ${(b.assumptions || []).length ? `<p class="muted">Assumptions: ${b.assumptions.map((a) => `${esc(a.field)} = ${esc(a.value)} ${a.approved ? '<span class="ok">approved</span>' : '<span class="bad">not approved</span>'}`).join(" · ")}</p>` : ""}
    <p class="muted">Proven capabilities: ${(b.capabilities || []).map((x) => `<b>${esc(x.id)}</b> ${esc(x.claim)} (${esc(x.source)})`).join(" · ")}</p></div>` : "";
  const concepts = (c?.concepts || []).map((x) => `<div class="note"><h3>${esc(x.id)}${x.id === c.selected ? ' · <span class="ok">selected</span>' : ""}</h3><p><b>${esc(x.creativeThesis)}</b></p><p>Metaphor: ${esc(x.visualMetaphor)} (${esc(x.metaphorMapsTo)})</p><p>Hook: ${esc(x.openingHook)}</p><p class="muted">${esc(x.storyMode)} · arc: ${esc(x.storyArc.join(" → "))} · risk ${esc(x.risk)} · effort ${esc(x.effort)}</p><p class="muted">${esc(x.rationale)}</p></div>`).join("");
  const cfg = c?.config;
  const planRows = (plan?.shots || []).map((s) => `<tr><td class="num">${tc(s.start)}</td><td class="num">${s.duration} s</td><td>${esc(s.id)} <span class="tag">${esc(s.role)}</span></td><td>${esc(s.source)}</td><td>${esc(s.beat)}<br><span class="muted">${esc(s.takeaway)}</span></td><td>${s.vo ? `<q>${esc(s.vo)}</q>` : "—"}</td><td>${(s.text || []).map((o) => esc(o.text)).join("<br>") || (s.logo ? "logo" : "—")}</td><td>${esc(s.claim || "")}</td></tr>`).join("");
  const look = sl.lookTest?.file ? jpg(abs(sl.lookTest.file), "look-lock.jpg", 900) : null;
  const envs = (st2?.environments || []).map((e) => { const im = e.ref ? jpg(abs(e.ref), `env-${e.id}.jpg`, 600) : null; return `<figure>${im ? `<img src="${im}" alt="${esc(e.name)}" loading="lazy">` : ""}<figcaption><span class="tag">${esc(e.id)}</span> ${esc(e.name)} · ${esc(e.layout)}</figcaption></figure>`; }).join("");
  const swatches = (st2?.palette || []).map((h) => `<span title="${esc(h)}" style="display:inline-block;width:36px;height:36px;border:1px solid var(--rule);background:${esc(h)}"></span>`).join(" ");
  strategyHtml = `<section><div class="slate"><span class="no">00</span><h2>Strategy</h2><span class="muted">${cfg ? `${esc(cfg.intent)} launch film · ${esc(c.concepts.find((x) => x.id === c.selected)?.storyMode || cfg.storyMode)} · ${cfg.durationSeconds} s · ${esc(cfg.aspectRatio)} · ${cfg.fps} fps` : ""}</span></div>${brief}
  ${c ? `<p class="muted">Story mode: ${esc(c.modeRationale)}</p><div class="cols">${concepts}</div>` : ""}
  ${planRows ? `<div class="shots"><table><thead><tr><th class="num">At</th><th class="num">Length</th><th>Shot</th><th>Source</th><th>Beat · takeaway</th><th>Voice-over</th><th>On screen</th><th>Claim</th></tr></thead><tbody>${planRows}</tbody></table></div>` : ""}
  ${st2 ? `<div class="note"><h3>Style bible · ${esc(st2.name)}${sl.lookTest?.said ? ' · <span class="ok">visual identity locked</span>' : ' · <span class="bad">not locked</span>'}</h3><p>${swatches}</p><p>${esc(st2.artStyle)} · ${esc(st2.line)} · ${esc(st2.texture)} · ${esc(st2.lighting)}</p><p class="muted">Never: ${esc((st2.negative || []).join(", "))}</p>${look ? `<figure style="max-width:560px"><img src="${look}" alt="Locked key art"><figcaption>Key art that locks the look${sl.lookTest?.said ? `: "${esc(sl.lookTest.said)}"` : ""}</figcaption></figure>` : ""}<div class="boards">${envs}</div></div>` : ""}</section>`;
}

// ---- Pacing (radio cut, scenes formats)
const R = sl.radio || {};
const rules = sl.paceRules || { minWpm: 140, maxGap: 0.6, maxDeadPct: 8, maxFirstLaugh: 6, maxSecondsPerLaugh: 7.5 };
const row = (label, val, target, pass) => `<tr><td>${label}</td><td class="num">${val ?? "—"}</td><td class="num">${target}</td><td>${ok(pass)}</td></tr>`;
const pacingHtml = kind !== "scenes" ? "" : R.file ? `<div class="shots"><table class="narrow"><thead><tr><th>Metric (radio cut)</th><th class="num">Value</th><th class="num">Target</th><th></th></tr></thead><tbody>
${row("Length", `${R.length} s`, "40–60 s", R.length >= 35 && R.length <= 60)}
${row("Delivery", `${R.wpm} wpm`, `≥ ${rules.minWpm}`, R.wpm >= rules.minWpm)}
${row("Longest unplanned gap", `${R.maxUnplannedGap} s`, `≤ ${rules.maxGap} s`, R.maxUnplannedGap <= rules.maxGap)}
${row("Dead air", `${R.deadAirPct} %`, `≤ ${rules.maxDeadPct} %`, R.deadAirPct <= rules.maxDeadPct)}
${row("First laugh", `${R.firstLaugh} s`, `≤ ${rules.maxFirstLaugh} s`, R.firstLaugh != null && R.firstLaugh <= rules.maxFirstLaugh)}
${row("Laughs", `${R.laughs} (one every ${R.secondsPerLaugh} s)`, `every ≤ ${rules.maxSecondsPerLaugh} s`, R.secondsPerLaugh != null && R.secondsPerLaugh <= rules.maxSecondsPerLaugh)}
</tbody></table></div>` : `<p class="muted">No radio cut yet.</p>`;
const plan = kind === "scenes" ? planCheck(sl) : { problems: [] };
const continuityHtml = kind !== "scenes" ? "" : `<div class="note"><h3>Continuity logic</h3>${plan.problems.length ? `<p class="bad">Blocked: ${plan.problems.length} problem(s)</p><ul>${plan.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="ok">Every character keeps their place; any change of place is shown on screen.</p>`}${(sl.scenes || []).map((sc) => sc.seats ? `<p class="muted">Scene ${esc(sc.id)}: ${Object.entries(sc.seats).map(([id, s]) => `${esc(cname(id))} on ${esc(s.place)} (${s.side})`).join(" · ")}</p>` : "").join("")}</div>`;
const sceneNotes = kind === "scenes" ? (sl.scenes || []).map((sc) => `<div class="note"><h3>Scene ${esc(sc.id)}</h3><p>${esc(sc.blocking)}</p>${sc.lighting ? `<p class="muted">Lighting lock: ${esc(sc.lighting)}</p>` : ""}</div>`).join("") : "";

// ---- Characters: sheet, look, the marks every eval checks, voice, face anchor
const castHtml = F.castIds(sl).map((id) => {
  let c; try { c = P.character(id); } catch { return ""; }
  const lk = P.characterLook(c, sl.style);
  const src = [lk.modelSheet, lk.sheet, ...(c.sheets || []), ...(c.refs || [])].filter(Boolean).map((f) => path.join(c.dir, f)).find((f) => fs.existsSync(f));
  const sheet = jpg(src, `sheet-${id}.jpg`, 1800);
  const anchor = c.faceAnchor ? jpg(path.join(c.dir, c.faceAnchor), `anchor-${id}.jpg`, 300) : null;
  const marks = marksOf(c.look);
  return `<div class="note"><h3>${esc(c.name)}</h3>${sheet ? `<img src="${sheet}" alt="${esc(c.name)} model sheet" loading="lazy">` : ""}<p>${esc(c.look)}</p><p class="muted">Marks checked on every take: ${marks.length ? esc(marks.join(", ")) : "none listed"} · voice ${esc(c.voice?.eleven || "—")} · ${c.approved || lk.status === "approved" ? '<span class="ok">sheet approved</span>' : '<span class="bad">sheet not approved</span>'}</p>${anchor ? `<figure style="max-width:120px"><img src="${anchor}" alt="${esc(c.name)} face anchor"><figcaption>Locked face anchor</figcaption></figure>` : ""}</div>`;
}).join("");
let setImg = null;
if (sl.set) try { const s = P.set(sl.set); setImg = jpg(path.join(s.dir, (s.plates || [])[0] || "plate-empty.png"), "set.jpg", 900); } catch {}

// ---- Storyboard / frames + shot table
let boardsHtml = "", shotRows = "";
if (kind === "scenes") {
  boardsHtml = (sl.scenes || []).map((sc) => { const g = jpg(abs(sc.grid), `grid-${sc.id}.jpg`, 1400); return g ? `<figure><img src="${g}" alt="Scene ${esc(sc.id)} storyboard" loading="lazy"><figcaption><span class="tag">Scene ${esc(sc.id)}</span> ${P.sceneShots(sl, sc).length} shots · ${P.sceneSecs(P.sceneShots(sl, sc))} s generation</figcaption></figure>` : ""; }).join("");
  shotRows = (sl.shots || []).map((s) => {
    const sc = (sl.scenes || []).find((x) => x.shots.includes(s.id));
    const th = jpg(abs(s.board?.file), `${s.id}.jpg`, 300);
    const t0 = s.radio ? `${s.radio.start.toFixed(1)}–${s.radio.end.toFixed(1)} s` : `${s.duration} s`;
    const lines = (s.dialogue || []).map((l) => `<q>${esc(l.text)}</q>${l.laugh ? ` <span class="lf">${laughName[l.laugh]}</span>` : ""}`).join("<br>") || "—";
    return `<tr><td><span class="tag">${esc(sc?.id)}</span> ${esc(s.id)}</td><td>${th ? `<img src="${th}" alt="">` : ""}</td><td class="num">${t0}</td><td>${esc(s.framing)} · ${esc(s.lens)}</td><td>${esc(s.motion)}</td><td>${lines}</td></tr>`;
  }).join("");
}
if (kind === "clips") {
  boardsHtml = (sl.shots || []).map((s) => {
    if (s.source === "card") return `<figure><p class="muted">Card drawn by the editor: exact text and logo, no generation.</p><figcaption><span class="tag">Shot ${esc(s.id)}</span> card · ${s.planned?.duration ?? s.duration} s</figcaption></figure>`;
    const a = /^@/.test(s.frame || "") ? null : jpg(abs(s.frame), `${s.id}-first.jpg`, 700);
    const b = s.last ? jpg(abs(s.last), `${s.id}-last.jpg`, 700) : null;
    return `<figure><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${a ? `<img src="${a}" alt="Shot ${esc(s.id)} first frame">` : `<p class="muted">Opens on ${esc(s.frame)}</p>`}${b ? `<img src="${b}" alt="Shot ${esc(s.id)} last frame">` : ""}</div><figcaption><span class="tag">Shot ${esc(s.id)}</span> first and last frame · ${s.duration} s</figcaption></figure>`;
  }).join("");
}
if (kind === "longform") boardsHtml = (sl.longform?.scenes || []).map((sc) => { const g = jpg(abs(sc.image), `scene-${sc.id}.jpg`, 900); return `<figure>${g ? `<img src="${g}" alt="Scene ${esc(sc.id)}">` : ""}<figcaption><span class="tag">Scene ${esc(sc.id)}</span> ${esc(sc.picture)} · ${esc(sc.motion)}</figcaption></figure>`; }).join("");

// ---- Media
const radio = R.file ? copy(abs(R.file), "radio-cut.mp3") : null;
const animatic = copy(path.join(dir, "out", "animatic.mp4"), "animatic.mp4");
// The book's copy stays under the publish limit, like the final's (a frame-exact launch animatic ran 17 MB).
if (animatic && fs.statSync(path.join(out, animatic)).size > 14e6) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, "out", "animatic.mp4"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path.join(out, animatic)]);

// ---- Prompts + estimate
// Only what is still to film is estimated: a scene or shot with a chosen take costs nothing more. (a
// reopened book re-estimated six filmed scenes and the budget lock jumped from $8.80 to $15.86.)
const filmed = (x) => x.clip != null && !!x.clips?.[x.clip];
let promptsHtml = "", est = 0, estRows = "";
if (kind === "scenes") {
  // Every image a scene sends to the video model is shown next to its prompt (opening frame, each character's face
  // and full-body views, the set plate), so wardrobe and look are checked on the images, not on the text.
  const refThumb = (file, name, label) => { const n = thumb(file, name); return n ? `<figure><img src="${n}" alt="${esc(label)}" loading="lazy"><figcaption>${esc(label)}</figcaption></figure>` : ""; };
  // Filmed shot by shot (sl.filmBy "shot"): each shot's own first frame and the exact text spec the model receives.
  if (sl.filmBy === "shot") promptsHtml = (sl.scenes || []).flatMap((sc) => P.sceneShots(sl, sc).map((s) => `<details><summary>Scene ${esc(sc.id)} · Shot ${esc(s.id)} · ${P.shotGenSecs(s, pick.video)} s · first frame + text</summary><div class="media">${refThumb(abs(s.board?.file), `ref-${s.id}-first.jpg`, `First frame · ${s.board?.from || "storyboard panel"}`)}</div><pre>${esc(P.shotPrompt(sl, sc, s, getModel(pick.video).maxPrompt || 4000))}</pre></details>`)).join("");
  else promptsHtml = (sl.scenes || []).map((sc) => {
    const voices = [...new Set(P.sceneShots(sl, sc).flatMap((s) => (s.dialogue || []).map((l) => l.char)))];
    const refs = P.sceneRefs(sl, sc);
    const first = P.sceneShots(sl, sc)[0]?.board?.file || P.sceneShots(sl, sc)[0]?.boards?.[0];
    const imgs = [refThumb(abs(first), `ref-${sc.id}-open.jpg`, "Image 1 · opening frame"), ...refs.map((r, i) => refThumb(r.file, `ref-${r.id}-${path.basename(r.file, path.extname(r.file))}.jpg`, `Image ${i + 2} · ${r.name}`))].join("");
    return `<details><summary>Scene ${esc(sc.id)} · ${P.sceneSecs(P.sceneShots(sl, sc))} s · ${refs.length + 1} images</summary><div class="media">${imgs}</div><pre>${esc(P.scenePrompt(sl, sc, refs, { voiceRefs: voices }))}</pre></details>`;
  }).join("");
  estRows = (sl.scenes || []).map((sc) => { const secs = P.sceneSecs(P.sceneShots(sl, sc)); const cr = filmed(sc) ? 0 : sl.filmBy === "shot" ? P.sceneShots(sl, sc).reduce((n, s) => n + vm.cost({ res: pick.res, duration: P.shotGenSecs(s, pick.video), sound: true }), 0) : vm.cost({ res: pick.res, duration: secs }); est += cr; return `<tr><td>Scene ${esc(sc.id)}${filmed(sc) ? " (filmed)" : ""}</td><td class="num">${secs} s</td><td class="num">${usd(cr)}</td></tr>`; }).join("");
}
if (kind === "clips") {
  // Launch films: stills and cards cost no video (the editor moves or draws them); generated takes are silent.
  const launch = sl.format === "launch";
  promptsHtml = (sl.shots || []).filter((s) => s.source !== "card").map((s) => `<details><summary>Shot ${esc(s.id)} · ${F.films(s) ? `${esc(getModel(s.model || pick.video).label)} · ${s.duration} s` : "still, moved by the editor"}</summary>${s.framePrompt ? `<pre>First frame (GPT Image 2.5):\n${esc(s.framePrompt)}</pre>` : ""}${F.films(s) ? `<pre>${launch ? "Animation:\n" : ""}${esc(P.clipPrompt(sl, s))}</pre>` : ""}</details>`).join("");
  estRows = (sl.shots || []).filter(F.films).map((s) => { const m = getModel(s.model || pick.video); const cr = filmed(s) ? 0 : m.cost({ res: s.res || pick.res, duration: s.duration, ...(launch ? { sound: false } : {}) }); est += cr; return `<tr><td>Shot ${esc(s.id)}${filmed(s) ? " (filmed)" : ""}</td><td class="num">${s.duration} s</td><td class="num">${usd(cr)}</td></tr>`; }).join("");
  // Frames still to draw (a changed end state drops its last frame) are part of the locked budget too.
  if (launch) { const todo = (sl.shots || []).filter((s) => F.films(s) && !filmed(s)).reduce((n, s) => n + (s.frame ? 0 : 1) + (s.lastPrompt && !s.last ? 1 : 0), 0); if (todo) { const cr = todo * getModel("gpt2.5").cost({ size: "1K" }) * 1.15; est += cr; estRows += `<tr><td>Frames still to draw (GPT Image 2.5, 1K)</td><td class="num">${todo}</td><td class="num">${usd(cr)}</td></tr>`; } }
  if (launch) { const vo = Object.values(sl.launch?.vo || {}); estRows += `<tr><td>Voice-over (ElevenLabs, recorded before the book)</td><td class="num">${vo.reduce((n, v) => n + v.text.length, 0)} chars</td><td class="num">plan</td></tr>`; }
}
// The score (gen.mjs music, Suno) is part of the locked budget when the project has one and it isn't made yet.
if (kind !== "longform" && sl.music?.prompt && !sl.music.files?.length) { const cr = getModel("suno").cost({}); est += cr; estRows += `<tr><td>Score (Suno)</td><td></td><td class="num">${usd(cr)}</td></tr>`; }
if (kind === "longform") {
  const L = sl.longform || {};
  promptsHtml = `<details open><summary>Music · Suno</summary><pre>${esc(L.music?.prompt || "—")}</pre></details>` + (L.scenes || []).map((sc) => `<details><summary>Scene ${esc(sc.id)} · ${sc.motion === "kenburns" ? "still + slow pan" : `${sc.seconds || 8} s loop`}</summary><pre>${esc(`${sc.picture}. ${L.look || ""}\n\nMotion: ${sc.motion}`)}</pre></details>`).join("");
  est = sl.bookEstimate ?? 0;
  estRows = `<tr><td>Stills, loops and music (longform.mjs estimate)</td><td></td><td class="num">${usd(est)}</td></tr>`;
}
const ledger = (() => { try { const l = P.readJSON(path.join(dir, "ledger.json"), []); return Array.isArray(l) ? l : l.jobs || []; } catch { return []; } })();
const spent = ledger.reduce((n, j) => n + (j.ok !== false ? j.credits || 0 : 0), 0);

// ---- Live prices: the options the model was picked from
const pc = sl.priceCheck;
const pricesHtml = !pc ? "" : `<div class="note"><h3>Video model · live APIMart and Kie prices ${esc(pc.at.slice(0, 10))}</h3><div class="shots"><table class="narrow"><thead><tr><th>Model</th><th class="num">Quality</th><th class="num">${pc.seconds} s</th><th>Best for</th></tr></thead><tbody>${pc.options.map((o) => `<tr><td>${o.key === pc.pick.key && o.res === pc.pick.res ? "<b>→ " : ""}${esc(o.label)} ${esc(o.res)}${o.key === pc.pick.key && o.res === pc.pick.res ? "</b>" : ""}${o.key === pc.recommended?.key && o.res === pc.recommended?.res ? ' <span class="tag">recommended</span>' : ""}</td><td class="num">${o.q}/10</td><td class="num">$${o.usd.toFixed(2)}<br><small>${esc(o.provider || "kie")}${o.alt ? ` · ${esc(o.alt.provider)} $${o.alt.usd.toFixed(2)}` : ""}</small></td><td>${esc(o.note)}</td></tr>`).join("")}</tbody></table></div>${pc.newOnKie?.length ? `<p class="muted">Also on Kie, not in the engine yet: ${esc(pc.newOnKie.join(", "))}.</p>` : ""}</div>`;

// ---- Evals that run (the same list every project gets)
const evals = [
  ...(kind === "scenes" ? ["Radio cut pacing (before filming)", "Continuity plan: every change of place shown on screen", "Per take: visual QC, positions, physics, light, geography, dialogue, identity"] : []),
  ...(sl.format === "launch" ? ["Before the book: brief facts with sources, 3+ distinct concepts, timing to ±0.25 s, every measurable claim tied to a proven capability, exact text never drawn by a model", "Final: length to the frame at 24 fps, voice-over word for word, every on-screen text read back from the frames, heuristic quality report on the exact file"] : []),
  ...(kind === "clips" ? ["Per take: identity (face and marks against the locked face anchor)", "Per take: jumps inside the shot (an end snap is trimmed)", "Per take: dialogue (missing, extra or repeated words)"] : []),
  ...(kind === "longform" ? ["Loops: first frame = last frame", "Final: duration, loudness, true peak, dead air"] : []),
  "Prompt check: no prompt may leave out a character's marks",
  "Budget lock: nothing past the approved total without the creator's yes",
  ...(kind !== "longform" ? ["Final: identity across every cut, transcript against the script, -14 LUFS, 720p H.264"] : []),
  "Delivery receipt: the file sent is the file that passed",
];

// ---- Approvals and overrides, in the creator's words
const flowLog = (sl.flow?.log || []).filter((l) => l.said).map((l) => `<tr><td class="num">${esc(l.at.slice(0, 16).replace("T", " "))}</td><td>${esc(l.event)}</td><td><q>${esc(l.said)}</q>${l.reason ? ` · ${esc(l.reason)}` : ""}</td></tr>`).join("");
const overrides = (sl.flow?.overrides || []);

// ---- Final section
let finalHtml = "";
if (final) {
  let fv = copy(finalPath, "final.mp4");
  if (fs.statSync(finalPath).size > 14e6) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", finalPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "25", "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path.join(out, "final.mp4")]);
  const takeRow = (label, c, used) => `<tr><td>${label}${used ? " · <b>used</b>" : ""}</td><td>${esc(c.model || "")}</td><td>${c.evals ? `${ok(c.evals.identity?.pass, "identity", "identity")} · ${ok(c.evals.jumps?.internal === 0, "no jumps", `${c.evals.jumps?.internal} jump(s)`)} · ${ok(c.evals.dialogue?.pass, "dialogue", "dialogue")}` : `${c.qc ? ok(c.qc.pass, "QC", "QC") : ""} ${c.continuity ? ok(c.continuity.pass, "continuity", "continuity") : ""}`}</td><td>${esc([...(c.evals?.identity?.issues || []), ...(c.evals?.dialogue?.issues || []), ...(c.continuity?.issues || [])].join("; "))}</td></tr>`;
  const takes = kind === "scenes" ? (sl.scenes || []).flatMap((sc) => (sc.clips || []).map((c, i) => takeRow(`Scene ${esc(sc.id)} take ${i + 1}`, c, i === sc.clip))).join("")
    : kind === "clips" ? (sl.shots || []).flatMap((s) => (s.clips || []).map((c, i) => takeRow(`Shot ${esc(s.id)} take ${i + 1}`, c, i === s.clip))).join("") : "";
  const q = sl.finalQc5;
  const sheet = copy(abs(q.sheet), "final-sheet.jpg");
  finalHtml = `<section id="final"><div class="slate"><span class="no">10</span><h2>Final cut</h2><span class="muted">final QC, takes and real cost</span></div>
  <div class="final"><figure><video src="${fv}" controls playsinline preload="metadata"></video><figcaption>${q.report.duration?.toFixed(1)} s${q.report.lufs != null ? ` · ${q.report.lufs} LUFS` : ""} · final QC ${q.pass ? "pass" : "fail"}${q.report.identity ? ` · identity ${q.report.identity.pass ? "pass" : "fail"}` : ""}${q.report.dialogue ? ` · dialogue ${q.report.dialogue.pass ? "word for word" : "fail"}` : ""}</figcaption></figure>
  <div style="display:grid;gap:18px;min-width:0">${takes ? `<div class="shots"><table class="narrow"><thead><tr><th>Take</th><th>Model</th><th>Evals</th><th>Notes</th></tr></thead><tbody>${takes}</tbody></table></div>` : ""}
  <p class="big">${usd(spent)}</p><p class="muted">Real spend (${spent.toFixed(0)} credits), every job from the ledger.</p>${sheet ? `<figure><img src="${sheet}" alt="Contact sheet of the final at 4 fps" loading="lazy"><figcaption>Contact sheet, 4 fps</figcaption></figure>` : ""}</div></div></section>`;
}

const concept = fs.existsSync(path.join(dir, "concept.md")) ? fs.readFileSync(path.join(dir, "concept.md"), "utf8") : "";
const conceptLines = concept.split("\n").filter((l) => /^- /.test(l)).map((l) => `<li>${esc(l.slice(2)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>`).join("");
const title = sl.title.replace(/^.*—\s*/, "");
const status = final ? "Final · delivered" : sl.flow?.approved?.book ? "Approved · budget locked" : "Gate 2 · awaiting the creator's approval";

const html = `<title>${esc(title)} Production Book</title>
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
  <span class="eyebrow">${esc(F.FORMATS[sl.format]?.label || sl.format)}${sl.series ? ` · ${esc(sl.series)}` : ""} · Production Book</span>
  <h1>${esc(title)}</h1>
  <span class="status${final ? " done" : ""}">${status}</span>
  <ul>${conceptLines}</ul>
  <p class="muted">${kind === "longform" ? `${sl.longform?.minutes} min` : `${(sl.shots || []).length} shots`}${kind === "scenes" ? ` · ${(sl.scenes || []).length} scenes` : ""} · ${esc(sl.style || "")} · ${esc(sl.ar)} · video: ${esc(vm.label)} ${esc(kind === "longform" ? sl.longform?.res || "720p" : pick.res)} · images: GPT Image 2.5</p>
</header>

${strategyHtml}

<section><div class="slate"><span class="no">01</span><h2>Script</h2></div><div class="script">${scriptHtml}</div></section>

${kind === "scenes" ? `<section><div class="slate"><span class="no">02</span><h2>Direction</h2><span class="muted">pacing checked against the vertical DNA, blocking and light per scene</span></div>${pacingHtml}${continuityHtml}<div class="cols">${sceneNotes}</div></section>` : ""}

${castHtml ? `<section><div class="slate"><span class="no">03</span><h2>Characters</h2><span class="muted">look, marks, voice and locked face</span></div><div class="cols">${castHtml}</div></section>` : ""}

${setImg ? `<section><div class="slate"><span class="no">04</span><h2>Set</h2></div><figure style="max-width:560px"><img src="${setImg}" alt="Set plate" loading="lazy"></figure></section>` : ""}

<section><div class="slate"><span class="no">05</span><h2>${kind === "clips" ? "Frames" : kind === "longform" ? "Scenes" : "Storyboard"}</h2></div><div class="boards">${boardsHtml}</div>
${shotRows ? `<div class="shots"><table><thead><tr><th>Shot</th><th>Board</th><th class="num">Time</th><th>Framing</th><th>Action</th><th>Lines</th></tr></thead><tbody>${shotRows}</tbody></table></div>` : ""}</section>

${radio || animatic ? `<section><div class="slate"><span class="no">06</span><h2>Radio cut and animatic</h2><span class="muted">the free draft: this timing is what gets filmed</span></div>
<div class="media">${radio ? `<figure><audio src="${radio}" controls preload="metadata"></audio><figcaption>Radio cut · ${R.length} s</figcaption></figure>` : ""}${animatic ? `<figure><video src="${animatic}" controls playsinline preload="metadata"></video><figcaption>${sl.format === "launch" ? "Animatic: frames, voice-over and on-screen text at the exact timing" : "Animatic: boards cut to the radio cut"}</figcaption></figure>` : ""}</div></section>` : ""}

<section><div class="slate"><span class="no">07</span><h2>Prompts</h2><span class="muted">exactly what the models receive</span></div>${promptsHtml}</section>

<section><div class="slate"><span class="no">08</span><h2>Cost and checks</h2><span class="muted">${final ? "estimate before filming" : "what approving this book locks as the budget"}</span></div>
<div class="shots"><table class="narrow"><thead><tr><th>Item</th><th class="num">Length</th><th class="num">Cost</th></tr></thead><tbody>${estRows}<tr><td>Already spent</td><td></td><td class="num">${usd(spent)}</td></tr></tbody>
<tfoot><tr><td>${final ? "Total (real)" : "Total (no rerolls)"}</td><td></td><td class="num">${usd(spent + (final ? 0 : est))}</td></tr></tfoot></table></div>
${pricesHtml}<div class="note"><h3>Evals that run on this video</h3><ul>${evals.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div></section>

<section><div class="slate"><span class="no">09</span><h2>Approvals</h2><span class="muted">in the creator's words</span></div>
${flowLog ? `<div class="shots"><table class="narrow"><thead><tr><th>When</th><th>Step</th><th>Creator</th></tr></thead><tbody>${flowLog}</tbody></table></div>` : `<p class="muted">Nothing approved yet.</p>`}
${overrides.length ? `<div class="note"><h3 class="bad">Overrides</h3><ul>${overrides.map((o) => `<li><b>${esc(o.step)}</b>: <q>${esc(o.said)}</q> · ${esc(o.reason)}</li>`).join("")}</ul></div>` : ""}</section>
${finalHtml}
<footer>AI Video Factory · flow v5 · ${new Date().toISOString().slice(0, 10)}</footer>
</div>`;
fs.writeFileSync(path.join(out, "index.html"), html);
if (!final && kind !== "longform") P.updateShotlist(slug, (x) => { x.bookEstimate = Math.ceil(est); });
fs.writeFileSync(path.join(out, "files.json"), JSON.stringify(files, null, 2));
console.log(path.join(out, "index.html"));
console.log(`${Object.keys(files).length} files · ${final ? "final" : "gate 2"} · estimate ${usd(est)}`);
