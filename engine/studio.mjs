#!/usr/bin/env node
// Studio: the front door of flow v5. Every project starts here and moves forward only through here.
// Map of the whole flow: docs/workflow-map.html. The step logic lives in engine/lib/flow.mjs.
//
//   node engine/studio.mjs new <slug> --title "..." --series single|episode:<id>|new:<id> --format <format>
//        --start script|idea|scratch --platform <where> --ar 9:16 --seconds 30 --lang en
//        --cast existing|new|self|mixed|none [--chars a,b] --budget cheapest|fixed:<usd>|max --refs "..." [--style <id>]
//   node engine/studio.mjs status <slug>                          every step, done or not, and the exact next action
//   node engine/studio.mjs approve <slug> <step> --said "the creator's exact words" [--notes "..."]
//   node engine/studio.mjs approve-character <id> --said "..."    a new character's sheet, look (with marks) and voice
//   node engine/studio.mjs approve-pilot <slug> --said "..."              the creator approves the first filmed scene/shot; only then the rest
//   node engine/studio.mjs accept-take <slug> <shot> <n> --said "..." --reason "..."   use a take that failed an eval
//   node engine/studio.mjs override <slug> <step> --said "the creator's exact words" --reason "..."   logged, shown in the book
//   node engine/studio.mjs prices <slug> [--pick <model>]          live Kie prices → best quality for the cost; sets the project's video model
//   node engine/studio.mjs qc <slug>                              final QC of out/<slug>.mp4 (identity, dialogue, format, loudness)
//   node engine/studio.mjs deliver <slug>                         delivery receipt + final Production Book
//   node engine/studio.mjs series new <id> --title "..."          series/<id>/series.json from the template
//   node engine/studio.mjs archive-legacy                         projects from before flow v5 become read-only
//   node engine/studio.mjs formats                                formats and their recipes
import fs from "node:fs";
import { MODELS } from "./lib/models.mjs";
import * as RF from "./lib/refs.mjs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import * as F from "./lib/flow.mjs";
import { identityCheck } from "./lib/identity.mjs";
import { backgroundCheck } from "./lib/backgrounds.mjs";
import { dialogueCheck, isVocal } from "./lib/dialogue.mjs";
import { pacingIssues } from "./lib/pacing.mjs";
import * as PR from "./lib/pricing.mjs";
import { livePrices, videoOptions, recommend, newFamilies, QUALITY, measuredWpm, needsOf, NEEDS, testedModels, forTheJob, evidenceOf, recordFit, fitOf } from "./lib/pricing.mjs";
import * as L from "./lib/launch.mjs";
import * as CAM from "./lib/camera.mjs";
import { engineSha } from "./lib/freeze.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").startsWith("--"));
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const SERIES = path.join(ROOT, "series");
const now = () => new Date().toISOString();

// Default look per format until the concept picks one.
const STYLE = { sitcom: "retro-sitcom", "micro-drama": "hyperreal", anime: "anime", influencer: "hyperreal", ugc: "ugc-phone", podcast: "podcast", cinematic: "hyperreal", fantasy: "hyperreal", other: "hyperreal", meditation: null, launch: "storybook" };

const CONCEPT = (sl, a) => `# Concept: ${sl.title}

- **Format:** ${F.FORMATS[sl.format].label}${sl.series ? ` · series ${sl.series}` : " · single video"}
- **Start:** ${a.start}
- **Platform:** ${a.platform.platform} · ${sl.ar} · ${a.platform.seconds} s · ${sl.lang}
- **Cast:** ${a.cast}${sl.cast?.length ? ` (${sl.cast.join(", ")})` : ""}
- **Budget:** ${a.budget.mode}${a.budget.usd ? ` $${a.budget.usd}` : ""}
- **References / tone:** ${a.refs.text}

## Logline
(character + want + obstacle + twist, one sentence)

## Why it works
(the engine of the piece)

## Beats
1. Hook (0-2 s):
2.
3. Button:
`;

function seriesFile(id) { return path.join(SERIES, id, "series.json"); }

const commands = {
  formats() {
    for (const [k, v] of Object.entries(F.FORMATS)) console.log(`${k.padEnd(12)} ${v.kind.padEnd(9)} ${F.recipe({ format: k, intake: {} }).join(" → ")}`);
  },

  async new() {
    const slug = pos[0];
    const need = ["--title", "--series", "--format", "--start", "--platform", "--ar", "--seconds", "--lang", "--cast", "--budget", "--refs"];
    const missing = need.filter((n) => !flag(n));
    if (!slug || missing.length) throw new F.FlowStop(`Intake incomplete. Missing: ${[!slug && "<slug>", ...missing].filter(Boolean).join(", ")}\nThe 7 questions (ask them one at a time, with buttons):\n${F.INTAKE.map((q, i) => `  P${i + 1}. ${q.q}`).join("\n")}`);
    if (fs.existsSync(path.join(P.PROJECTS, slug, "shotlist.json"))) throw new F.FlowStop(`the project ${slug} already exists`);
    const format = flag("--format");
    if (!F.FORMATS[format]) throw new F.FlowStop(`unknown format "${format}". Options: ${Object.keys(F.FORMATS).join(", ")}. A new format needs its DNA first (studio skill).`);
    const [mode, seriesId] = flag("--series").split(":");
    if (!["single", "episode", "new"].includes(mode) || (mode !== "single" && !seriesId)) throw new F.FlowStop("--series: single | episode:<id> | new:<id>");
    if (mode === "episode") {
      if (!fs.existsSync(seriesFile(seriesId))) throw new F.FlowStop(`the series ${seriesId} doesn't exist`);
      if (!P.readJSON(seriesFile(seriesId)).approved) throw new F.FlowStop(`the series ${seriesId} is not approved; its bible is approved first`);
    }
    if (mode === "new") {
      if (fs.existsSync(seriesFile(seriesId))) throw new F.FlowStop(`the series ${seriesId} already exists; use --series episode:${seriesId}`);
      commands.series(["new", seriesId]);
      // The template is a sitcom's; a new series takes its format's style and DNA (a micro-drama inherited
      // "retro-sitcom" and its scene prompts asked for a 1990s multi-camera look).
      P.writeJSON(seriesFile(seriesId), { ...P.readJSON(seriesFile(seriesId)), style: flag("--style") || STYLE[format], vertical: format });
    }
    const [bmode, busd] = flag("--budget").split(":");
    const intake = {
      series: mode, format, start: flag("--start"),
      platform: { platform: flag("--platform"), ar: flag("--ar"), seconds: Number(flag("--seconds")), lang: flag("--lang") },
      cast: flag("--cast"), budget: { mode: bmode, usd: busd ? Number(busd) : null }, refs: { text: flag("--refs") }, at: now(),
    };
    if (!["script", "idea", "scratch"].includes(intake.start)) throw new F.FlowStop("--start: script | idea | scratch");
    if (!["existing", "new", "self", "mixed", "none"].includes(intake.cast)) throw new F.FlowStop("--cast: existing | new | self | mixed | none");
    // Launch films, Release 1: only what the editor finishes today is offered (never a selector that doesn't work).
    if (format === "launch") {
      const R = L.RELEASE;
      if (!R.ar.includes(intake.platform.ar) || !R.seconds.includes(intake.platform.seconds)) throw new F.FlowStop(`Product launch film: for now only ${R.seconds.join("/")} s in ${R.ar.join("/")} at ${R.fps.join("/")} fps (Release 1). ${intake.platform.seconds} s in ${intake.platform.ar} is not available yet.`);
      if (flag("--style") && !R.styles.includes(flag("--style"))) throw new F.FlowStop(`Product launch film: available styles ${R.styles.join(", ")}, or a custom one from the creator's references (launch.mjs style-from-refs)`);
    }
    const chars = flag("--chars") ? flag("--chars").split(",") : [];
    for (const id of chars) if (!fs.existsSync(path.join(P.BIBLE, "characters", id, "character.json")) && intake.cast === "existing") throw new F.FlowStop(`the character ${id} is not in the bible`);
    const series = mode === "single" ? undefined : seriesId;
    const sStyle = series ? P.readJSON(seriesFile(series), {}).style : null;
    const dir = path.join(P.PROJECTS, slug);
    if (format === "meditation") {
      const r = spawnSync(process.execPath, [path.join(ROOT, "engine", "longform.mjs"), "new", slug, "--title", flag("--title"), "--minutes", String(Math.max(1, Math.round(intake.platform.seconds / 60))), "--lang", intake.platform.lang, "--ar", intake.platform.ar], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    } else {
      P.writeJSON(path.join(dir, "shotlist.json"), { slug, title: flag("--title"), format, lang: intake.platform.lang, ar: intake.platform.ar, style: flag("--style") || sStyle || STYLE[format], shots: [], ...(F.FORMATS[format].kind === "scenes" ? { scenes: [], captions: { marginV: 0.16 }, sfx: {}, overlays: [] } : {}), ...(format === "launch" ? { fps: 24, launch: {} } : {}), cameraRequired: true });
      if (format === "launch") fs.mkdirSync(path.join(dir, "launch"), { recursive: true });
    }
    P.updateShotlist(slug, (sl) => {
      Object.assign(sl, { format, series, cast: chars, intake, flow: { v: 5, created: now(), approved: {}, overrides: [], log: [{ at: now(), event: "intake" }] }, engine: { sha: engineSha(), at: now() } });
      // A meditation of 30 s or less is a demo or preview (short lead-in and fades, voice by ~2 s).
      if (format === "meditation" && intake.platform.seconds <= 30) Object.assign(sl.longform, { demo: true, seconds: intake.platform.seconds });
    });
    const sl = P.loadShotlist(slug);
    P.writeJSON(path.join(dir, "intake.json"), intake);
    fs.writeFileSync(path.join(dir, "concept.md"), CONCEPT(sl, intake));
    console.log(`created projects/${slug}/ · ${F.FORMATS[format].label} · recipe: ${F.recipe(sl).join(" → ")}`);
    const bankIds = RF.approved(format);
    { const rec = CAM.recommendedKit(format); console.log(rec ? `camera kit recommended for ${format}: ${rec} (${CAM.KITS[rec].label}). Offer it and the alternatives (studio.mjs camera ${slug} --list); the cast gate waits for the creator's choice.` : `camera: the ${format} style owns the look; only framing and moves apply.`); }
    if (bankIds.length) console.log(`approved ${format} references: ${bankIds.join(", ")}. Offer them to the creator (studio.mjs refs ${slug} --use ... | --none); the concept waits for their choice.`);
    await commands.catalog([slug]);
    commands.status([slug]);
  },

  status(args = pos) {
    const slug = args[0];
    const sl = P.loadShotlist(slug);
    F.assertV5(sl);
    const { steps, current } = F.status(sl);
    console.log(`${sl.title} · ${F.FORMATS[sl.format]?.label} · ${sl.series ? "series " + sl.series : "single video"} · spent $${(P.ledgerTotal(slug) * 0.005).toFixed(2)}${sl.budget ? ` de $${(sl.budget.approvedCredits * 0.005).toFixed(2)} aprobados` : ""}\n`);
    for (const s of steps) console.log(`${s.ok ? " ✓" : s === current ? " →" : "  "} ${s.name.padEnd(22)} ${s.who === "creator" ? "[creator]" : "[auto]  "}${s.detail || ""}`);
    console.log(current ? `\nSiguiente: ${current.name}. ${current.next}` : "\nProyecto cerrado.");
    // The clock and the rework count, on every status: a production that drifts for hours or days is seen at once.
    const mins = (a) => Math.round((Date.now() - Date.parse(a)) / 60000), fmt = (m) => (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
    const delivered = (sl.flow?.log || []).some((e) => e.event === "deliver"), bookAt = sl.flow?.approved?.book?.at;
    const since = sl.remake?.at || sl.flow?.created || "";
    const runs = P.readJSON(path.join(P.PROJECTS, slug, "ledger.json"), []).filter((e) => e.ok && !e.test && (e.at || "") > since);
    const assets = new Set(runs.map((e) => e.label)).size;
    // Warnings, not gates: the live catalog check and the model research are reported on every status.
    if (!delivered && !sl.cancelled && !sl.startCheck) console.log(`WARNING: the live catalog check hasn't run for this project (studio.mjs catalog ${slug}); prices and new models may be stale.`);
    if (!delivered && sl.priceCheck?.unresearched?.length) console.log(`WARNING: ${sl.priceCheck.unresearched.length} video model(s) on sale have no fresh researched profile (${sl.priceCheck.unresearched.slice(0, 5).join(", ")}${sl.priceCheck.unresearched.length > 5 ? "..." : ""}); research them (studio.mjs model-research --file ...) before ruling them out.`);
    if (sl.cancelled) console.log(`CANCELLED (${sl.cancelled.at}): nothing more is spent on it.`);
    else if (!delivered) {
      console.log(`Clock: ${fmt(mins(sl.remake?.at || sl.flow?.created))} since ${sl.remake ? `remake v${sl.remake.n}` : "the intake"}${bookAt ? `; ${fmt(mins(bookAt))} since the book was approved (limit: 15 min to delivery${mins(bookAt) > 15 ? ", OVER" : ""})` : ""}.`);
      console.log(`Paid jobs: ${runs.length} for ${assets} assets${runs.length > 2 * assets && runs.length >= 10 ? " (more than two per asset: REWORK STOP is on)" : ""}.`);
    }
  },

  approve() {
    const [slug, step] = pos;
    F.approve(slug, step, flag("--said"), flag("--notes") ? { notes: flag("--notes") } : {});
    const sl = P.loadShotlist(slug);
    if (step === "series") P.writeJSON(seriesFile(sl.series), { ...P.readJSON(seriesFile(sl.series)), approved: { said: flag("--said"), at: now() } });
    if (step === "book") console.log(`budget locked: ${sl.budget.approvedCredits} cr ($${(sl.budget.approvedCredits * 0.005).toFixed(2)}). Any extra spend needs another yes from the creator.`);
    console.log(`approved: ${step}`);
    commands.status([slug]);
  },

  "approve-character"() {
    const id = pos[0], said = flag("--said");
    if (!id || !said) throw new F.FlowStop('approve-character <id> --said "the creator\'s exact words"');
    const f = path.join(P.BIBLE, "characters", id, "character.json");
    const c = P.readJSON(f, null);
    if (!c) throw new F.FlowStop(`no existe bible/characters/${id}`);
    if (!c.look?.trim()) throw new F.FlowStop(`${id}: write their full look, with their marks (freckles, moles, glasses, earrings...)`);
    const d = path.dirname(f);
    // In-style sheets (cast.mjs sheet --style) live under looks.<style>.sheet.
    if (![...(c.refs || []), ...(c.sheets || []), ...Object.values(c.looks || {}).flatMap((l) => [l.modelSheet, l.sheet])].filter(Boolean).some((x) => fs.existsSync(path.join(d, x)))) throw new F.FlowStop(`${id}: their model sheet or reference is missing`);
    P.writeJSON(f, { ...c, approved: { said, at: now() } });
    console.log(`character approved: ${id}`);
  },

  // A take that failed an eval is used only if the creator accepts that exact take, in their words.
  // The look test (lib/flow.mjs modelsCheck): one still of the leads in the set, approved in the creator's words, before any
  // video price or book of a drama.
  "approve-look"() {
    const slug = pos[0], file = flag("--file"), said = flag("--said");
    if (!slug || !file || !said) throw new F.FlowStop('approve-look <slug> --file <project image> --said "the creator\'s exact words"');
    if (!fs.existsSync(P.abs(slug, file))) throw new F.FlowStop(`${file} doesn't exist in the project`);
    P.updateShotlist(slug, (sl) => { F.assertV5(sl); sl.lookTest = { file, said, at: now() }; sl.flow.log.push({ at: now(), event: `approve-look ${file}`, said }); });
    console.log("look test approved in the creator's words");
  },

  // The intake's fixed budget is a hard cap (gen.mjs job, book, phase budget). Only the creator's words raise it.
  // Which approved references this production follows (or none), in the creator's words. Claude offers them from the
  // The camera kit: the format's recommended kit or any other, whole or with parts changed, in the creator's words.
  // Offer the recommendation and the alternatives with buttons; the creator never types this.
  //   camera <slug> --list | --kit <id> [--body <id>] [--lens <id>] [--focal <mm>] [--aperture <f>] --said "..."
  camera() {
    const slug = pos[0];
    const sl0 = slug ? P.loadShotlist(slug) : null;
    if (!slug || process.argv.includes("--list")) {
      const rec = sl0 ? CAM.recommendedKit(sl0.format) : null;
      console.log(`Camera kits${sl0 ? ` (recommended for ${sl0.format}: ${rec || "none, the style owns the look"})` : ""}:`);
      for (const [id, k] of Object.entries(CAM.KITS)) console.log(`${id === rec ? " →" : "  "} ${id.padEnd(15)} ${k.label.padEnd(30)} ${k.focal}mm f/${k.aperture} · ${k.for}${k.tested.length ? "" : " (not tested side by side yet)"}`);
      console.log(`\nParts: bodies ${Object.keys(CAM.BODIES).join(", ")}; lenses ${Object.keys(CAM.LENSES).join(", ")}; focal ${Object.keys(CAM.FOCALS).join("/")}mm; aperture f/${Object.keys(CAM.APERTURES).sort((a, b) => a - b).join(", f/")}`);
      console.log(`Moves (shot.move): ${Object.entries(CAM.MOVES).map(([id, m]) => id + (m.bold ? "*" : "")).join(", ")}  (* bold: once per film)`);
      return;
    }
    const kit = flag("--kit"), said = flag("--said");
    if (!kit || !said?.trim()) throw new F.FlowStop('camera <slug> --kit <id> [--body] [--lens] [--focal] [--aperture] --said "the creator\'s exact words"');
    const parts = Object.fromEntries(["body", "lens", "focal", "aperture"].filter((k) => flag(`--${k}`) != null).map((k) => [k, ["focal", "aperture"].includes(k) ? Number(flag(`--${k}`)) : flag(`--${k}`)]));
    const bad = CAM.cameraRules({ camera: { kit, ...parts }, shots: [] });
    if (bad.length) throw new F.FlowStop(bad.join("; "));
    P.updateShotlist(slug, (sl) => { sl.camera = { kit, ...parts, said, at: now() }; sl.flow.log.push({ at: now(), event: `camera ${kit}${Object.keys(parts).length ? " " + JSON.stringify(parts) : ""}`, said }); });
    const r = CAM.rigOf({ camera: { kit, ...parts } });
    console.log(`camera kit: ${CAM.KITS[kit].label} · ${CAM.BODIES[r.body].label} · ${CAM.LENSES[r.lens].label} · ${r.focal}mm · f/${r.aperture} (the creator's words recorded). Shots can change it with shot.rig and set shot.move.`);
  },

  // bank with buttons; The creator never types this.
  refs() {
    const slug = pos[0], said = flag("--said"), use = flag("--use"), none = process.argv.includes("--none");
    if (!slug || !said || (!use && !none)) throw new F.FlowStop('refs <slug> --use id,id --said "..." | --none --said "..."');
    const sl0 = P.loadShotlist(slug), ids = none ? [] : use.split(",").map((x) => x.trim()).filter(Boolean);
    const bad = ids.filter((id) => !RF.approved(sl0.format).includes(id));
    if (bad.length) throw new F.FlowStop(`not approved ${sl0.format} references: ${bad.join(", ")} (approved: ${RF.approved(sl0.format).join(", ") || "none"})`);
    P.updateShotlist(slug, (sl) => { sl.refsChoice = { ids, said, at: now() }; sl.flow.log.push({ at: now(), event: `refs ${ids.join(",") || "none"}`, said }); });
    console.log(ids.length ? `references chosen: ${ids.join(", ")} (the script rules are calibrated to them)` : "no references (the creator's words recorded)");
  },

  cap() {
    const slug = pos[0], usd = Number(flag("--usd")), said = flag("--said");
    if (!slug || !usd || !said) throw new F.FlowStop('cap <slug> --usd <new cap> --said "the creator\'s exact words"');
    P.updateShotlist(slug, (sl) => {
      F.assertV5(sl);
      const old = sl.intake?.budget?.usd;
      if (sl.intake?.budget?.mode !== "fixed") throw new F.FlowStop("this project has no fixed cap in the intake");
      sl.intake.budget.usd = usd;
      sl.flow.log.push({ at: now(), event: `cap $${old} -> $${usd}`, said });
    });
    console.log(`project cap: $${usd} (the creator's words recorded)`);
  },

  // The pilot gate (lib/flow.mjs): The creator approves the first filmed scene or shot before the rest is filmed.
  "approve-pilot"() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop('approve-pilot <slug> --said "the creator\'s exact words" [--ok-fast]');
    // The pilot draft must speak at the format's pace, or the creator must accept the measured rate in so many words
    // (a fast pilot means the rest, filmed on the same model, will be fast too).
    const dq = (() => { try { return JSON.parse(fs.readFileSync(path.join(P.projectDir(slug), "out", "draft-qc.json"), "utf8")); } catch { return null; } })();
    if (dq?.maxWpm && dq.wpm > dq.maxWpm && !argv.includes("--ok-fast"))
      throw new F.FlowStop(`the pilot speaks at ${dq.wpm} wpm (max ${dq.maxWpm}) on ${dq.model}. Tell the creator that number and the options (another model for the pilot, or accept it); only with their explicit yes to the pace: --ok-fast`);
    F.approvePilot(slug, said);
    console.log(`pilot approved in the creator's words; the rest can be filmed now (gen.mjs scenes / clip)`);
  },

  "accept-take"() {
    const [slug, id, n] = pos, said = flag("--said"), reason = flag("--reason");
    if (!slug || !id || !n || !said || !reason) throw new F.FlowStop('accept-take <slug> <shot> <take number> --said "the creator\'s exact words" --reason "what fails and why it is accepted"');
    P.updateShotlist(slug, (sl) => {
      F.assertV5(sl);
      const s = P.findItem(sl, id), t = s.clips?.[Number(n) - 1]; // a shot (clips formats) or a scene (scenes formats)
      if (!t) throw new F.FlowStop(`${id} has no take ${n}`);
      t.accepted = { said, reason, at: now() };
      s.clip = Number(n) - 1;
      sl.flow.overrides = [...(sl.flow.overrides || []), { step: "film", take: `${id} take ${n}`, said, reason, at: now(), fp: "take" }];
      sl.flow.log.push({ at: now(), event: `accept-take ${id} #${n}`, said, reason });
    });
    console.log(`take ${n} of ${id} accepted in the creator's words; it is recorded in the Production Book.`);
  },

  // A motion test, reviewed frame by frame, becomes evidence of how well that model does this video's need.
  fit() {
    const slug = pos[0], key = flag("--model"), fit = Number(flag("--fit")), note = flag("--note");
    if (!slug || !key || !Number.isFinite(fit) || fit < 0 || fit > 10 || !note) throw new F.FlowStop('fit <slug> --model <k> --fit <0-10> --note "what the test showed"');
    const sl = P.loadShotlist(slug);
    if (!PR.testedModels(sl)[key]) throw new F.FlowStop(`${key} has no motion test in ${slug}: test it first (gen.mjs clip ${slug} --shot <id> --test --model ${key} --said "...")`);
    const needs = needsOf(sl, (() => { try { return P.style(sl.style); } catch { return null; } })());
    if (!needs.length) throw new F.FlowStop(`${slug} has no need to score (no people acting)`);
    for (const n of needs) recordFit(n, key, fit, note, slug);
    console.log(`evidence recorded: ${key} ${fit}/10 for ${needs.join(", ")} (${slug})`);
  },

  override() {
    const [slug, step] = pos;
    F.override(slug, step, flag("--said"), flag("--reason"));
    console.log(`override recorded in ${slug}: ${step}. It appears in the Production Book.`);
  },

  // Live price analysis (models step): every video model the engine can run for this format, priced live on Kie for
  // this project's length and resolution, ranked by quality; the recommendation follows the intake's budget mode.
  async prices() {
    const slug = pos[0];
    let sl = P.loadShotlist(slug);
    // A remake re-runs the model analysis before anything paid (frames included): it needs only the approved cast.
    const remakePricing = sl.remake && (!(sl.priceCheck?.at > sl.remake.at) || !!flag("--pick"));
    F.requireStep(sl, remakePricing ? "cast" : "models", "studio prices");
    // A scene filmed shot by shot (sl.filmBy "shot") is priced like clips: every shot is its own generation.
    const byShot = F.kindOf(sl) === "scenes" && sl.filmBy === "shot";
    const kind = byShot ? "clips" : F.kindOf(sl);
    const secs = byShot ? (sl.shots || []).reduce((n, s) => n + P.shotGenSecs(s), 0) : kind === "scenes" ? (sl.scenes || []).reduce((n, sc) => n + P.sceneSecs(P.sceneShots(sl, sc)), 0)
      : kind === "clips" ? (sl.shots || []).filter(F.films).reduce((n, s) => n + (s.duration || 8), 0) : (sl.longform?.scenes || []).filter((s) => s.motion !== "kenburns").reduce((n, s) => n + (s.seconds || 8), 0);
    const clips = kind === "clips" ? (sl.shots || []).filter(F.films).length : kind === "longform" ? (sl.longform?.scenes || []).length : (sl.scenes || []).length;
    const live = await livePrices();
    let options = videoOptions(live.rows, { format: sl.format, kind, seconds: secs, clips });
    // A launch film's shots are choreographed to a drawn last frame: only models that take one are offered.
    if (sl.format === "launch") options = options.filter((o) => MODELS[o.key]?.lastFrame);
    if (!options.length) throw new F.FlowStop("no engine model appears in the live prices; check engine/lib/pricing.mjs");
    const baseline = kind === "longform" ? sl.longform?.videoModel : (() => { try { return P.style(sl.style).models?.video; } catch { return null; } })();
    // Speaking formats outside the sitcom are held to the edit's 175 wpm: a model measured faster is not recommended.
    // A launch film's takes are silent (the voice-over is ElevenLabs), so the model's speaking rate doesn't apply.
    const maxWpm = kind !== "longform" && !["sitcom", "launch"].includes(sl.format) ? 175 : null;
    // What this video asks of the model (painted characters acting, photoreal people...) ranks before price.
    const needs = needsOf(sl, (() => { try { return P.style(sl.style); } catch { return null; } })());
    const rec = recommend(options, { format: sl.format, budget: sl.intake?.budget, baseline, maxWpm, needs });
    const want = flag("--pick");
    const pick = want ? options.find((o) => o.key === want.split("@")[0] && (!want.includes("@") || o.res === want.split("@")[1])) : rec;
    if (!pick) throw new F.FlowStop(`--pick ${want} is not among the options: ${options.map((o) => `${o.key}@${o.res}`).join(", ")}`);
    const fresh = newFamilies(live.rows);
    // MODEL RESEARCH: the whole catalog of both providers, not only the models the engine runs.
    const cat = await PR.apimartCatalog();
    const unresearched = PR.researchGaps(live.rows, cat), candidates = PR.researchCandidates(live.rows, sl.format, cat);
    sl = P.updateShotlist(slug, (x) => {
      x.priceCheck = { at: now(), needs, seconds: secs, fetched: live.fetched, warning: live.warning || null, options: options.slice(0, 10), recommended: rec, pick, picked: want ? "creator" : "recommended", newOnKie: [...fresh, ...candidates.map((c) => c.family).filter((f) => !fresh.includes(f))], unresearched, candidates: candidates.map((c) => ({ family: c.family, usdPerSec: c.usdPerSec, why: c.why })) };
      if (kind === "longform") { x.longform.videoModel = pick.key; x.longform.res = pick.res; }
      else x.defaults = { ...(x.defaults || {}), videoModel: pick.key, res: pick.res };
    });
    if (unresearched.length) console.log(`MODEL RESEARCH: ${unresearched.length} video model(s) on sale at APIMart or Kie have no researched profile; read each one's documentation and record it (studio.mjs model-research --file <profiles.json>) before ruling it out:\n  ${unresearched.join("\n  ")}\n`);
    if (candidates.length) console.log(`Researched models the engine doesn't run yet that could serve a ${sl.format} (test or add them before ruling them out):\n${candidates.map((c) => `  ${c.family}: $${c.usdPerSec}/s, ${c.why}`).join("\n")}\n`);
    console.log(`Live prices from APIMart and Kie (each model on the cheaper provider; APIMart wins ties)${live.fetched ? " (just fetched)" : ` (${live.ageH.toFixed(1)} h old)`} · ${secs} s de video · ${F.FORMATS[sl.format].label}${live.warning ? `\nAVISO: ${live.warning}` : ""}\n`);
    const tested = testedModels(sl), job = forTheJob(options, needs);
    const row = (o, tag) => { const w = measuredWpm(o.key); console.log(`${o === pick ? " →" : o === rec ? " *" : "  "} ${`${o.key}@${o.res}`.padEnd(16)} ${tag.padEnd(14)} $${o.usd.toFixed(2).padStart(6)} ${(o.provider || "kie").padEnd(7)}${o.alt ? ` (${o.alt.provider} $${o.alt.usd.toFixed(2)})` : ""}  ${w ? `habla ${w} wpm${maxWpm && w > maxWpm ? " (fast)" : ""}  ` : ""}${needs.length ? (evidenceOf(o.key, needs).map((e) => e.note).join("; ") || o.note) : o.note}`); };
    if (needs.length) {
      // Only models that do this job well are offered; untested ones are listed to try, poor ones are left out.
      console.log(`This video needs: ${needs.map((n) => NEEDS[n]).join("; ")}.
Good for this job (best first, then cheapest):`);
      for (const o of [...job.good].sort((x, y) => y.fit - x.fit || x.credits - y.credits)) row(o, `fit ${o.fit}/10`);
      if (!job.good.length) console.log("   none tested yet: test at least two candidates on one representative shot (gen.mjs clip --test)");
      if (job.untested.length) { console.log("To test on this job (no evidence yet):"); for (const o of job.untested) row(o, `calidad ${o.q}/10`); }
      if (job.poor.length) console.log(`Left out (did this job poorly in tests): ${job.poor.map((o) => `${o.key} ${o.fit}/10`).join(", ")}.`);
      console.log(`Tested in this project: ${Object.keys(tested).join(", ") || "none yet"}. Record each test's fit after the review: studio.mjs fit ${slug} --model <k> --fit <0-10> --note "...".`);
    } else for (const o of options) row(o, `calidad ${o.q}/10`);
    if (maxWpm && measuredWpm(pick.key) > maxWpm) console.log(`WARNING: ${pick.label} measured speaking at ${measuredWpm(pick.key)} wpm (max ${maxWpm}); tell the creator before the book.`);
    console.log(`\nRecommended (${sl.intake?.budget?.mode || "cheapest"}): ${rec.label} ${rec.res}, $${rec.usd}. Chosen: ${pick.label} ${pick.res}${want ? " (the creator's choice)" : ""}.`);
    if (fresh.length) console.log(`Models on Kie the engine doesn't use yet: ${fresh.join(", ")}. If one promises better quality or lower cost for this format, propose testing it.`);
    console.log("Show this table to the creator; it is also in the Production Book.");
  },

  // Final QC: one pass over the whole final, every format. Writes sl.finalQc5 tied to the file's hash.
  async qc() {
    const slug = pos[0];
    let sl = P.loadShotlist(slug);
    F.requireStep(sl, "qc", "studio qc");
    const file = F.finalFile(sl), dir = P.projectDir(slug), issues = [], report = {};
    // --no-judge --said "...": the creator's call when the vision judge is down. Identity and text read-back are skipped and say so in the receipt;
    // every other check runs, and Claude has watched the whole final frame by frame.
    const noJudge = process.argv.includes("--no-judge");
    if (noJudge && !flag("--said")) throw new F.FlowStop('qc --no-judge needs --said "the creator\'s exact words"');
    if (noJudge) report.judgeSkipped = { said: flag("--said"), at: now() };
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt,codec_type:format=duration,size", "-of", "json", file]).toString());
    const v = probe.streams.find((s) => s.codec_type === "video"), a = probe.streams.find((s) => s.codec_type === "audio");
    const longform = F.kindOf(sl) === "longform";
    const wantH = longform ? { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 }[sl.longform?.output || "1080p"] || 1080 : 720;
    if (!v || v.codec_name !== "h264" || v.pix_fmt !== "yuv420p") issues.push(`video ${v?.codec_name}/${v?.pix_fmt}, H.264 yuv420p is required`);
    if (v && Math.min(v.width, v.height) !== wantH) issues.push(`resolution ${v.width}×${v.height}, ${wantH}p is required`);
    if (!a) issues.push("no audio");
    report.duration = Number(probe.format.duration);
    report.sizeMB = +(Number(probe.format.size) / 1e6).toFixed(1);
    // Format-specific QC the editors already ran (pacing for scenes, loudness and dead air for long-form).
    if (F.kindOf(sl) !== "clips" && !sl.finalQc?.pass) issues.push(`editor QC: ${(sl.finalQc?.problems || sl.finalQc?.issues || ["failed"]).join("; ")}`);
    if (!longform) {
      const e = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      report.lufs = Number((e.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
      if (!(Math.abs(report.lufs - -14) <= 1.5)) issues.push(`loudness ${report.lufs} LUFS, -14 is required`);
      // Every scripted line, in order, heard in the final.
      const lines = (sl.shots || []).flatMap((s) => (s.dialogue || []).filter((l) => !isVocal(l)).map((l, i) => ({ id: `${s.id}-${i + 1}`, text: l.text })));
      if (lines.length) { const d = dialogueCheck(file, lines, sl.lang); report.dialogue = d; issues.push(...d.issues.map((x) => `dialogue: ${x}`)); }
      // Faces and marks across every cut, against each character's locked anchor.
      const cast = F.castIds(sl).filter((id) => { try { return P.character(id).species !== "set"; } catch { return false; } });
      if (cast.length && !noJudge) { const r = await identityCheck(file, cast); report.identity = { pass: r.pass, issues: r.issues, notes: r.notes }; issues.push(...r.issues); }
      // Outside the sitcom: every close-up of a person keeps one background across all scenes.
      if (sl.format !== "sitcom" && cast.length && (sl.scenes || []).length > 1) {
        try { const b = await backgroundCheck(file, sl, cast); report.backgrounds = b; issues.push(...b.issues); }
        catch (e) { issues.push(`couldn't check the backgrounds across scenes: ${e.message.slice(0, 120)}`); }
      }
    }
    // Launch films: the editor's own QC, the length to the frame at the plan's fps, the voice-over word for word, the
    // composited text read back from the frames, and Claude's heuristic quality report on this exact file.
    if (sl.format === "launch") {
      const plan = L.read(slug, "plan"), fps = plan?.fps || 24;
      if (!sl.finalQc?.pass) issues.push(`editor QC: ${(sl.finalQc?.problems || ["failed"]).join("; ")}`);
      const vs = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=r_frame_rate,nb_read_frames", "-of", "json", file]).toString()).streams[0];
      report.frames = Number(vs.nb_read_frames);
      if (vs.r_frame_rate !== `${fps}/1`) issues.push(`${vs.r_frame_rate} fps, ${fps} is required`);
      if (plan && Math.abs(report.frames - Math.round(plan.durationSeconds * fps)) > 1) issues.push(`${report.frames} frames; ${plan.durationSeconds} s at ${fps} fps is ${Math.round(plan.durationSeconds * fps)} (tolerance 1 frame)`);
      const vo = (plan?.shots || []).filter((s) => s.vo).map((s) => ({ id: s.id, text: s.vo }));
      if (vo.length) { const d = dialogueCheck(file, vo, sl.lang, sl.launch?.voice?.pronounce); report.voiceover = d; issues.push(...d.issues.map((x) => `voice-over: ${x}`)); }
      const overlays = (plan?.shots || []).flatMap((s) => (s.text || []).map((o) => ({ text: o.text, t: s.start + ((o.at || 0) + Math.min(o.until ?? s.duration, s.duration)) / 2 })));
      if (!noJudge) try { const tc = await L.textCheck(file, overlays); report.text = tc.read; issues.push(...tc.issues); }
      catch (e) { issues.push(`couldn't read the final's text: ${e.message.slice(0, 120)}`); }
      issues.push(...L.qualityRules(L.read(slug, "quality"), F.fileSha(file)));
    }
    // Talking short-form formats are paced like their playbook: voice at once, the format's wpm, no stalls.
    if (["influencer", "ugc", "podcast"].includes(sl.format)) { const pi = pacingIssues(file, sl.format, report.duration, sl.lang); report.pacing = pi; issues.push(...pi.map((x) => `pacing: ${x}`)); }
    // The 4 fps contact sheet (thumbnails for the whole cut). Identity is checked above at full resolution.
    const sheet = path.join(dir, "out", `${slug}-sheet.jpg`);
    const fps = longform ? `1/${Math.max(10, Math.round(report.duration / 60))}` : "4";
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `fps=${fps},scale=160:-2,tile=12x${longform ? 6 : Math.ceil((report.duration * 4) / 12)}`, "-frames:v", "1", "-q:v", "4", sheet]);
    const res = { pass: !issues.length, issues, report, sheet: P.rel(slug, sheet), sha: F.fileSha(file), at: now() };
    sl = P.updateShotlist(slug, (x) => { x.finalQc5 = res; });
    console.log(`${res.pass ? "FINAL QC: PASS" : "FINAL QC: FAIL"} · ${report.duration?.toFixed(1)} s · ${report.sizeMB} MB${report.lufs != null ? ` · ${report.lufs} LUFS` : ""}`);
    for (const i of issues) console.log(` - ${i}`);
    console.log(`Contact sheet: ${sheet}\nLook at all of it before delivering, along with the transcript.`);
    process.exitCode = res.pass ? 0 : 1;
  },

  // The AI label for a realistic synthetic video: how it is labelled on each platform it goes to.
  // A plan changed after the approved book: the creator approves the new live estimate for this exact plan, and that
  // amount becomes the budget the remaining jobs may spend.
  "approve-replan"() {
    const slug = pos[0], said = flag("--said"), usd = Number(flag("--usd"));
    if (!slug || !said || !(usd > 0)) throw new F.FlowStop('approve-replan <slug> --usd N --said "the creator\'s exact words"');
    const sl = P.loadShotlist(slug);
    if (!sl.priceCheck?.at || Date.now() - new Date(sl.priceCheck.at).getTime() > 7 * 864e5 || (sl.remake && !(sl.priceCheck.at > sl.remake.at))) throw new F.FlowStop(`run studio.mjs prices ${slug} first (after the remake started): the creator approves a live estimate`);
    P.updateShotlist(slug, (x) => {
      x.replanApproved = { plan: F.planSha(x), usd, said, at: now() };
      const spent = P.ledgerTotal(slug), next = Math.ceil(spent + usd / 0.005);
      x.budget = { ...(x.budget || {}), approvedCredits: next, history: [...(x.budget?.history || []), { add: next - (x.budget?.approvedCredits || 0), note: `replan approved: "${said}"` }] };
    });
    console.log(`replan approved: $${usd} on top of what is spent; the budget lock is now ${(P.ledgerTotal(slug) * 0.005 + usd).toFixed(2)} USD`);
  },

  // REMAKE: redoing a video is a new version that walks every step in order. Steps whose material still holds are
  // marked reused; the model analysis and the estimate always run again, and nothing paid runs before the creator
  // approves that estimate (REMAKE STOP in gen.mjs).
  // ENGINE FREEZE release: continue this production on the changed engine, in the creator's words.
  "engine-update"() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop("engine-update <slug> --said 'the creator exact words'");
    const sl = P.updateShotlist(slug, (x) => { x.engine = { sha: engineSha(), at: now(), said, from: x.engine?.sha }; x.flow.log.push({ at: now(), event: "engine-update", said }); });
    console.log(`${slug} continues on engine ${sl.engine.sha} (was ${sl.engine.from || "unrecorded"}).`);
  },
  // What the product does NOT do and what every video must say, in the creator's words (formats that sell something).
  // --does-not "makes clips:clips,clip maker" (repeatable; "none" records an empty list), --must-say "streams live:live,stream".
  product() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop("product <slug> --does-not 'what:word,word' | none --must-say 'what:word,word' --said 'the creator exact words'");
    const parse = (v) => { const [what, words] = v.split(":"); return { what: what.trim(), words: (words || what).split(",").map((w) => w.trim()).filter(Boolean) }; };
    const dn = argv.flatMap((a, i) => (a === "--does-not" && argv[i + 1] ? [argv[i + 1]] : [])), ms = argv.flatMap((a, i) => (a === "--must-say" && argv[i + 1] ? [argv[i + 1]] : []));
    P.updateShotlist(slug, (x) => { x.product = { doesNot: dn.filter((v) => v !== "none").map(parse), mustSay: ms.map(parse), said, at: now() }; });
    console.log(`${slug}: ${dn.filter((v) => v !== "none").length} thing(s) it doesn't do, ${ms.length} must-say point(s).`);
  },
  // Records researched model profiles (read from each model's documentation): a JSON array of
  // { family, docs, inputs, audioOut, maxSecs, resolutions, usdPerSec, use, verdict, fits, why }.
  "model-research"() {
    const file = flag("--file");
    if (!file || !fs.existsSync(file)) throw new F.FlowStop("model-research --file <profiles.json>");
    const n = PR.recordResearch(JSON.parse(fs.readFileSync(file, "utf8")));
    console.log(`model research: ${n} families on record (engine/data/model-research.json)`);
  },
  // LIVE CATALOG CHECK: both providers' catalogs and prices, fetched fresh. Runs at every intake; the concept gate
  // waits for it. Re-run any time with studio.mjs catalog <slug>.
  async catalog(args = pos) {
    const slug = args[0];
    if (!slug) throw new F.FlowStop("catalog <slug>");
    let c;
    try { c = await PR.liveCatalogCheck(); } catch (e) { console.log(`LIVE CATALOG CHECK failed: ${e.message.slice(0, 160)}. Run studio.mjs catalog ${slug} again before the concept.`); return; }
    P.updateShotlist(slug, (x) => { x.startCheck = { at: c.at, newModels: c.newModels, priceChanges: c.priceChanges.length }; });
    console.log(`Live catalog check: Kie price list${c.fetched ? " fetched now" : " (cached: " + (c.warning || "") + ")"}, APIMart docs catalog ${c.catalog} video pages.`);
    if (c.newModels.length) console.log(`  NEW video models since the last research (research them before the book): ${c.newModels.join(", ")}`);
    else console.log("  No new video models: every model on sale has a researched profile.");
    if (c.priceChanges.length) console.log(`  Price changes (${c.priceChanges.length}):\n${c.priceChanges.slice(0, 25).map((p) => `    ${p.model}: $${p.was} → $${p.now} ${p.unit || ""}`).join("\n")}`);
    else console.log("  No price changes.");
  },
  // A cancelled project spends nothing more (every paid job refuses it).
  cancel() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop("cancel <slug> --said 'the creator exact words'");
    P.updateShotlist(slug, (x) => { x.cancelled = { at: now(), said }; x.flow.log.push({ at: now(), event: "cancel", said }); });
    console.log(`${slug} cancelled; nothing more will be spent on it.`);
  },
  remake() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop('remake <slug> --said "the creator\'s exact words"');
    let sl = P.loadShotlist(slug);
    sl = P.updateShotlist(slug, (x) => { x.remake = { n: (x.remake?.n || 0) + 1, at: now(), said }; x.engine = { sha: engineSha(), at: now() }; x.flow.log = [...(x.flow.log || []), { at: now(), event: `remake v${x.remake.n}`, said }]; });
    console.log(`remake v${sl.remake.n} started. Every step, in order:`);
    for (const id of F.recipe(sl)) {
      const st = F.stepStatus(sl, id), always = ["models", "book"].includes(id);
      console.log(`  ${always ? "→ redo " : st.ok ? "✓ reuse" : "→ redo "} ${F.STEPS[id].name}${always ? " (always re-run on a remake)" : st.ok ? "" : `: ${String(st.detail || "").slice(0, 140)}`}`);
    }
    console.log(`\nNext, before anything paid: studio.mjs prices ${slug} (the best model at the best live price for this plan), gen.mjs estimate ${slug}, then the creator approves that estimate (studio.mjs approve-replan ${slug} --usd N --said "...").`);
  },

  // The creator's call on the models the providers sell that the engine doesn't run yet (listed by studio.mjs prices).
  "new-models"() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop('new-models <slug> --said "the creator\'s exact words"');
    const sl = P.loadShotlist(slug);
    if (!sl.priceCheck?.at) throw new F.FlowStop(`run studio.mjs prices ${slug} first`);
    P.updateShotlist(slug, (x) => { x.newModelsReviewed = { at: x.priceCheck.at, said, list: x.priceCheck.newOnKie || [] }; });
    console.log("the creator's call on the new models is recorded for this price check");
  },

  // Skipping the two-model comparison, only in the creator's words.
  "waive-compare"() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop('waive-compare <slug> --said "the creator\'s exact words"');
    P.updateShotlist(slug, (x) => { x.modelCompareWaived = { said, at: now() }; });
    console.log("model comparison waived in the creator's words (recorded in the book)");
  },

  disclose() {
    const slug = pos[0];
    if (!slug || !flag("--label") || !flag("--said")) throw new F.FlowStop('disclose <slug> --label "how it is labelled on each platform" --said "the creator\'s exact words"');
    P.updateShotlist(slug, (x) => { x.aiDisclosure = { label: flag("--label"), said: flag("--said"), at: now() }; });
    console.log("AI disclosure recorded; it goes into the delivery receipt");
  },

  deliver() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    F.requireStep(sl, "deliver", "studio deliver");
    // Realistic synthetic people or voices are labelled as AI on YouTube and TikTok; the receipt carries how.
    const realistic = ["influencer", "ugc", "podcast", "micro-drama", "cinematic"].includes(sl.format) || (() => { try { return P.style(sl.style).kind === "realistic"; } catch { return false; } })();
    if (realistic && !sl.aiDisclosure && (sl.flow?.created || "") >= "2026-10-26") throw new F.FlowStop('realistic synthetic people or voices: record how the video is labelled as AI before delivering (studio.mjs disclose <slug> --label "..." --said "...")');
    const file = F.finalFile(sl);
    const receipt = { file: P.rel(slug, file), sha: F.fileSha(file), at: now(), qc: sl.finalQc5.report, overrides: sl.flow.overrides || [], ...(sl.aiDisclosure ? { aiDisclosure: sl.aiDisclosure } : {}) };
    P.writeJSON(path.join(P.projectDir(slug), "delivery.json"), receipt);
    P.updateShotlist(slug, (x) => { x.flow.log.push({ at: receipt.at, event: "deliver", sha: receipt.sha }); });
    // Launch films ship with their source: brief, concepts, script, shot plan, style bible, QC, manifest, captions.
    if (sl.format === "launch") {
      const r = spawnSync(process.execPath, [path.join(ROOT, "engine", "launch.mjs"), "package", slug], { encoding: "utf8" });
      process.stdout.write(r.stdout || "");
      if (r.status !== 0) throw new Error(`launch.mjs package: ${r.stderr}`);
    }
    const b = spawnSync(process.execPath, [path.join(ROOT, "engine", "book.mjs"), slug], { encoding: "utf8" });
    process.stdout.write(b.stdout || "");
    if (b.status !== 0) throw new Error(`book.mjs: ${b.stderr}`);
    console.log(`\nReceipt: projects/${slug}/delivery.json\nNow: republish the Production Book, send ${receipt.file} to the creator with any known problem, and back up (npm run check, then the repo routine). Then: retro.`);
  },

  series(args = pos) {
    const [sub, id] = args;
    if (sub !== "new" || !id) throw new F.FlowStop('series new <id> --title "..."');
    const f = seriesFile(id);
    if (fs.existsSync(f)) throw new F.FlowStop(`the series ${id} already exists`);
    const tpl = P.readJSON(path.join(ROOT, "templates", "series.json"));
    delete tpl._how;
    P.writeJSON(f, { ...tpl, id, title: flag("--title", id), approved: null, episodes: [] });
    console.log(`series/${id}/series.json created from the template. Fill it in with the creator (premise, cast with wants, set map, voices, intro, ending, rules) and approve it with the first episode: studio.mjs approve <slug> series --said "..."`);
  },

  "archive-legacy"() {
    for (const d of fs.readdirSync(P.PROJECTS)) {
      const f = path.join(P.PROJECTS, d, "shotlist.json");
      if (!fs.existsSync(f)) continue;
      const sl = P.readJSON(f);
      if (sl.flow?.v) continue;
      sl.flow = { v: 5, archived: "proyecto anterior al flujo v5: solo lectura (se puede ver y reproducir, no gastar ni editar)", at: now() };
      P.writeJSON(f, sl);
      console.log(`archivado: ${d}`);
    }
  },
};

const run = commands[cmd];
if (!run) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
try { await run(); } catch (e) { if (e instanceof F.FlowStop) { console.error(`ALTO: ${e.message}`); process.exit(2); } throw e; }
