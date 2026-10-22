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
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import * as F from "./lib/flow.mjs";
import { identityCheck } from "./lib/identity.mjs";
import { backgroundCheck } from "./lib/backgrounds.mjs";
import { dialogueCheck, isVocal } from "./lib/dialogue.mjs";
import { livePrices, videoOptions, recommend, newFamilies, QUALITY, measuredWpm } from "./lib/pricing.mjs";
import * as L from "./lib/launch.mjs";

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

  new() {
    const slug = pos[0];
    const need = ["--title", "--series", "--format", "--start", "--platform", "--ar", "--seconds", "--lang", "--cast", "--budget", "--refs"];
    const missing = need.filter((n) => !flag(n));
    if (!slug || missing.length) throw new F.FlowStop(`Intake incompleto. Faltan: ${[!slug && "<slug>", ...missing].filter(Boolean).join(", ")}\nLas 7 preguntas (hazlas una a una, con botones):\n${F.INTAKE.map((q, i) => `  P${i + 1}. ${q.q}`).join("\n")}`);
    if (fs.existsSync(path.join(P.PROJECTS, slug, "shotlist.json"))) throw new F.FlowStop(`el proyecto ${slug} ya existe`);
    const format = flag("--format");
    if (!F.FORMATS[format]) throw new F.FlowStop(`formato desconocido "${format}". Opciones: ${Object.keys(F.FORMATS).join(", ")}. Un formato nuevo necesita su ADN primero (studio skill).`);
    const [mode, seriesId] = flag("--series").split(":");
    if (!["single", "episode", "new"].includes(mode) || (mode !== "single" && !seriesId)) throw new F.FlowStop("--series: single | episode:<id> | new:<id>");
    if (mode === "episode") {
      if (!fs.existsSync(seriesFile(seriesId))) throw new F.FlowStop(`no existe la serie ${seriesId}`);
      if (!P.readJSON(seriesFile(seriesId)).approved) throw new F.FlowStop(`la serie ${seriesId} no está aprobada; su biblia se aprueba primero`);
    }
    if (mode === "new") {
      if (fs.existsSync(seriesFile(seriesId))) throw new F.FlowStop(`la serie ${seriesId} ya existe; usa --series episode:${seriesId}`);
      commands.series(["new", seriesId]);
      // The template is a sitcom's; a new series takes its format's style and DNA (a micro-drama inherited
      // "retro-sitcom" and its scene prompts asked for a 1990s multi-camera look, 2026-10-19).
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
      if (!R.ar.includes(intake.platform.ar) || !R.seconds.includes(intake.platform.seconds)) throw new F.FlowStop(`Product launch film: por ahora solo ${R.seconds.join("/")} s en ${R.ar.join("/")} a ${R.fps.join("/")} fps (Release 1). ${intake.platform.seconds} s en ${intake.platform.ar} todavía no está disponible.`);
      if (flag("--style") && !R.styles.includes(flag("--style"))) throw new F.FlowStop(`Product launch film: por ahora solo el estilo ${R.styles.join(", ")} (Release 1)`);
    }
    const chars = flag("--chars") ? flag("--chars").split(",") : [];
    for (const id of chars) if (!fs.existsSync(path.join(P.BIBLE, "characters", id, "character.json")) && intake.cast === "existing") throw new F.FlowStop(`el personaje ${id} no existe en la biblia`);
    const series = mode === "single" ? undefined : seriesId;
    const sStyle = series ? P.readJSON(seriesFile(series), {}).style : null;
    const dir = path.join(P.PROJECTS, slug);
    if (format === "meditation") {
      const r = spawnSync(process.execPath, [path.join(ROOT, "engine", "longform.mjs"), "new", slug, "--title", flag("--title"), "--minutes", String(Math.max(1, Math.round(intake.platform.seconds / 60))), "--lang", intake.platform.lang, "--ar", intake.platform.ar], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    } else {
      P.writeJSON(path.join(dir, "shotlist.json"), { slug, title: flag("--title"), format, lang: intake.platform.lang, ar: intake.platform.ar, style: flag("--style") || sStyle || STYLE[format], shots: [], ...(F.FORMATS[format].kind === "scenes" ? { scenes: [], captions: { marginV: 0.16 }, sfx: {}, overlays: [] } : {}), ...(format === "launch" ? { fps: 24, launch: {} } : {}) });
      if (format === "launch") fs.mkdirSync(path.join(dir, "launch"), { recursive: true });
    }
    P.updateShotlist(slug, (sl) => {
      Object.assign(sl, { format, series, cast: chars, intake, flow: { v: 5, created: now(), approved: {}, overrides: [], log: [{ at: now(), event: "intake" }] } });
      // A meditation of 30 s or less is a demo or preview (short lead-in and fades, voice by ~2 s).
      if (format === "meditation" && intake.platform.seconds <= 30) Object.assign(sl.longform, { demo: true, seconds: intake.platform.seconds });
    });
    const sl = P.loadShotlist(slug);
    P.writeJSON(path.join(dir, "intake.json"), intake);
    fs.writeFileSync(path.join(dir, "concept.md"), CONCEPT(sl, intake));
    console.log(`creado projects/${slug}/ · ${F.FORMATS[format].label} · receta: ${F.recipe(sl).join(" → ")}`);
    commands.status([slug]);
  },

  status(args = pos) {
    const slug = args[0];
    const sl = P.loadShotlist(slug);
    F.assertV5(sl);
    const { steps, current } = F.status(sl);
    console.log(`${sl.title} · ${F.FORMATS[sl.format]?.label} · ${sl.series ? "serie " + sl.series : "video individual"} · gastado $${(P.ledgerTotal(slug) * 0.005).toFixed(2)}${sl.budget ? ` de $${(sl.budget.approvedCredits * 0.005).toFixed(2)} aprobados` : ""}\n`);
    for (const s of steps) console.log(`${s.ok ? " ✓" : s === current ? " →" : "  "} ${s.name.padEnd(22)} ${s.who === "creator" ? "[creador]" : "[auto]  "}${s.detail || ""}`);
    console.log(current ? `\nSiguiente: ${current.name}. ${current.next}` : "\nProyecto cerrado.");
  },

  approve() {
    const [slug, step] = pos;
    F.approve(slug, step, flag("--said"), flag("--notes") ? { notes: flag("--notes") } : {});
    const sl = P.loadShotlist(slug);
    if (step === "series") P.writeJSON(seriesFile(sl.series), { ...P.readJSON(seriesFile(sl.series)), approved: { said: flag("--said"), at: now() } });
    if (step === "book") console.log(`presupuesto bloqueado: ${sl.budget.approvedCredits} cr ($${(sl.budget.approvedCredits * 0.005).toFixed(2)}). Cualquier gasto extra necesita otro sí del creador.`);
    console.log(`aprobado: ${step}`);
    commands.status([slug]);
  },

  "approve-character"() {
    const id = pos[0], said = flag("--said");
    if (!id || !said) throw new F.FlowStop('approve-character <id> --said "palabras exactas del creador"');
    const f = path.join(P.BIBLE, "characters", id, "character.json");
    const c = P.readJSON(f, null);
    if (!c) throw new F.FlowStop(`no existe bible/characters/${id}`);
    if (!c.look?.trim()) throw new F.FlowStop(`${id}: escribe su look completo, con sus marcas (pecas, lunares, lentes, aretes...)`);
    const d = path.dirname(f);
    // In-style sheets (cast.mjs sheet --style) live under looks.<style>.sheet.
    if (![...(c.refs || []), ...(c.sheets || []), ...Object.values(c.looks || {}).flatMap((l) => [l.modelSheet, l.sheet])].filter(Boolean).some((x) => fs.existsSync(path.join(d, x)))) throw new F.FlowStop(`${id}: falta su model sheet o referencia`);
    P.writeJSON(f, { ...c, approved: { said, at: now() } });
    console.log(`personaje aprobado: ${id}`);
  },

  // A take that failed an eval (for example a jump inside the shot) is used only if the creator accepts that exact take, in his words.
  // The look test (lib/flow.mjs modelsCheck): one still of the leads in the set, approved in the creator's words, before any
  // video price or book of a drama.
  "approve-look"() {
    const slug = pos[0], file = flag("--file"), said = flag("--said");
    if (!slug || !file || !said) throw new F.FlowStop('approve-look <slug> --file <imagen del proyecto> --said "palabras exactas del creador"');
    if (!fs.existsSync(P.abs(slug, file))) throw new F.FlowStop(`no existe ${file} en el proyecto`);
    P.updateShotlist(slug, (sl) => { F.assertV5(sl); sl.lookTest = { file, said, at: now() }; sl.flow.log.push({ at: now(), event: `approve-look ${file}`, said }); });
    console.log("prueba de look aprobada con las palabras del creador");
  },

  // The intake's fixed budget is a hard cap (gen.mjs job, book, phase budget). Only the creator's words raise it.
  cap() {
    const slug = pos[0], usd = Number(flag("--usd")), said = flag("--said");
    if (!slug || !usd || !said) throw new F.FlowStop('cap <slug> --usd <nuevo tope> --said "palabras exactas del creador"');
    P.updateShotlist(slug, (sl) => {
      F.assertV5(sl);
      const old = sl.intake?.budget?.usd;
      if (sl.intake?.budget?.mode !== "fixed") throw new F.FlowStop("este proyecto no tiene tope fijo en el intake");
      sl.intake.budget.usd = usd;
      sl.flow.log.push({ at: now(), event: `cap $${old} -> $${usd}`, said });
    });
    console.log(`tope del proyecto: $${usd} (palabras del creador registradas)`);
  },

  // The pilot gate (lib/flow.mjs): the creator approves the first filmed scene or shot before the rest is filmed.
  "approve-pilot"() {
    const slug = pos[0], said = flag("--said");
    if (!slug || !said) throw new F.FlowStop('approve-pilot <slug> --said "palabras exactas del creador" [--ok-fast]');
    // The pilot draft must speak at the format's pace, or the creator must accept the measured rate in so many words
    // (2026-10-20, a past drama: the pilot ran 204 wpm, the rest was filmed on the same model, and the final failed on it).
    const dq = (() => { try { return JSON.parse(fs.readFileSync(path.join(P.projectDir(slug), "out", "draft-qc.json"), "utf8")); } catch { return null; } })();
    if (dq?.maxWpm && dq.wpm > dq.maxWpm && !argv.includes("--ok-fast"))
      throw new F.FlowStop(`el piloto habla a ${dq.wpm} wpm (máximo ${dq.maxWpm}) en ${dq.model}. Dile al creador ese número y las opciones (otro modelo para el piloto, o aceptarlo); solo con su sí explícito al ritmo: --ok-fast`);
    F.approvePilot(slug, said);
    console.log(`piloto aprobado con las palabras del creador; ya se puede filmar el resto (gen.mjs scenes / clip)`);
  },

  "accept-take"() {
    const [slug, id, n] = pos, said = flag("--said"), reason = flag("--reason");
    if (!slug || !id || !n || !said || !reason) throw new F.FlowStop('accept-take <slug> <shot> <take number> --said "palabras exactas del creador" --reason "qué falla y por qué se acepta"');
    P.updateShotlist(slug, (sl) => {
      F.assertV5(sl);
      const s = P.findItem(sl, id), t = s.clips?.[Number(n) - 1]; // a shot (clips formats) or a scene (scenes formats)
      if (!t) throw new F.FlowStop(`${id} no tiene toma ${n}`);
      t.accepted = { said, reason, at: now() };
      s.clip = Number(n) - 1;
      sl.flow.overrides = [...(sl.flow.overrides || []), { step: "film", take: `${id} take ${n}`, said, reason, at: now(), fp: "take" }];
      sl.flow.log.push({ at: now(), event: `accept-take ${id} #${n}`, said, reason });
    });
    console.log(`toma ${n} de ${id} aceptada con las palabras del creador; queda en el Production Book.`);
  },

  override() {
    const [slug, step] = pos;
    F.override(slug, step, flag("--said"), flag("--reason"));
    console.log(`override registrado en ${slug}: ${step}. Aparece en el Production Book.`);
  },

  // Live price analysis (models step): every video model the engine can run for this format, priced live on Kie for
  // this project's length and resolution, ranked by quality; the recommendation follows the intake's budget mode.
  async prices() {
    const slug = pos[0];
    let sl = P.loadShotlist(slug);
    F.requireStep(sl, "models", "studio prices");
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
    if (!options.length) throw new F.FlowStop("ningún modelo del motor aparece en los precios en vivo; revisa engine/lib/pricing.mjs");
    const baseline = kind === "longform" ? sl.longform?.videoModel : (() => { try { return P.style(sl.style).models?.video; } catch { return null; } })();
    // Speaking formats outside the sitcom are held to the edit's 175 wpm: a model measured faster is not recommended.
    // A launch film's takes are silent (the voice-over is ElevenLabs), so the model's speaking rate doesn't apply.
    const maxWpm = kind !== "longform" && !["sitcom", "launch"].includes(sl.format) ? 175 : null;
    const rec = recommend(options, { format: sl.format, budget: sl.intake?.budget, baseline, maxWpm });
    const want = flag("--pick");
    const pick = want ? options.find((o) => o.key === want.split("@")[0] && (!want.includes("@") || o.res === want.split("@")[1])) : rec;
    if (!pick) throw new F.FlowStop(`--pick ${want} no está entre las opciones: ${options.map((o) => `${o.key}@${o.res}`).join(", ")}`);
    const fresh = newFamilies(live.rows);
    sl = P.updateShotlist(slug, (x) => {
      x.priceCheck = { at: now(), seconds: secs, fetched: live.fetched, warning: live.warning || null, options: options.slice(0, 10), recommended: rec, pick, picked: want ? "creator" : "recommended", newOnKie: fresh };
      if (kind === "longform") { x.longform.videoModel = pick.key; x.longform.res = pick.res; }
      else x.defaults = { ...(x.defaults || {}), videoModel: pick.key, res: pick.res };
    });
    console.log(`Precios en vivo de Kie${live.fetched ? " (recién descargados)" : ` (de hace ${live.ageH.toFixed(1)} h)`} · ${secs} s de video · ${F.FORMATS[sl.format].label}${live.warning ? `\nAVISO: ${live.warning}` : ""}\n`);
    for (const o of options) { const w = measuredWpm(o.key); console.log(`${o === pick ? " →" : o === rec ? " *" : "  "} ${`${o.key}@${o.res}`.padEnd(16)} calidad ${String(o.q).padStart(2)}/10  $${o.usd.toFixed(2).padStart(6)}  ${w ? `habla ${w} wpm${maxWpm && w > maxWpm ? " (rápido)" : ""}  ` : ""}${o.note}`); }
    if (maxWpm && measuredWpm(pick.key) > maxWpm) console.log(`AVISO: ${pick.label} se midió hablando a ${measuredWpm(pick.key)} wpm (máximo ${maxWpm}); díselo al creador antes del book.`);
    console.log(`\nRecomendado (${sl.intake?.budget?.mode || "cheapest"}): ${rec.label} ${rec.res}, $${rec.usd}. Elegido: ${pick.label} ${pick.res}${want ? " (elección del creador)" : ""}.`);
    if (fresh.length) console.log(`Modelos en Kie que el motor aún no usa: ${fresh.join(", ")}. Si alguno promete más calidad o menos costo para este formato, propón probarlo.`);
    console.log("Muestra esta tabla al creador; queda también en el Production Book.");
  },

  // Final QC: one pass over the whole final, every format. Writes sl.finalQc5 tied to the file's hash.
  async qc() {
    const slug = pos[0];
    let sl = P.loadShotlist(slug);
    F.requireStep(sl, "qc", "studio qc");
    const file = F.finalFile(sl), dir = P.projectDir(slug), issues = [], report = {};
    // --no-judge --said "...": the creator's call when the vision judge is down (2026-10-21, a launch film v6: "You can't
    // waste more time with the vision judge"). Identity and text read-back are skipped and say so in the receipt;
    // every other check runs, and Claude has watched the whole final frame by frame.
    const noJudge = process.argv.includes("--no-judge");
    if (noJudge && !flag("--said")) throw new F.FlowStop('qc --no-judge necesita --said "palabras exactas del creador"');
    if (noJudge) report.judgeSkipped = { said: flag("--said"), at: now() };
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt,codec_type:format=duration,size", "-of", "json", file]).toString());
    const v = probe.streams.find((s) => s.codec_type === "video"), a = probe.streams.find((s) => s.codec_type === "audio");
    const longform = F.kindOf(sl) === "longform";
    const wantH = longform ? { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 }[sl.longform?.output || "1080p"] || 1080 : 720;
    if (!v || v.codec_name !== "h264" || v.pix_fmt !== "yuv420p") issues.push(`video ${v?.codec_name}/${v?.pix_fmt}, se pide H.264 yuv420p`);
    if (v && Math.min(v.width, v.height) !== wantH) issues.push(`resolución ${v.width}×${v.height}, se pide ${wantH}p`);
    if (!a) issues.push("sin audio");
    report.duration = Number(probe.format.duration);
    report.sizeMB = +(Number(probe.format.size) / 1e6).toFixed(1);
    // Format-specific QC the editors already ran (pacing for scenes, loudness and dead air for long-form).
    if (F.kindOf(sl) !== "clips" && !sl.finalQc?.pass) issues.push(`QC del editor: ${(sl.finalQc?.problems || sl.finalQc?.issues || ["no pasó"]).join("; ")}`);
    if (!longform) {
      const e = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      report.lufs = Number((e.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
      if (!(Math.abs(report.lufs - -14) <= 1.5)) issues.push(`volumen ${report.lufs} LUFS, se pide -14`);
      // Every scripted line, in order, heard in the final.
      const lines = (sl.shots || []).flatMap((s) => (s.dialogue || []).filter((l) => !isVocal(l)).map((l, i) => ({ id: `${s.id}-${i + 1}`, text: l.text })));
      if (lines.length) { const d = dialogueCheck(file, lines, sl.lang); report.dialogue = d; issues.push(...d.issues.map((x) => `diálogo: ${x}`)); }
      // Faces and marks across every cut, against each character's locked anchor.
      const cast = F.castIds(sl).filter((id) => { try { return P.character(id).species !== "set"; } catch { return false; } });
      if (cast.length && !noJudge) { const r = await identityCheck(file, cast); report.identity = { pass: r.pass, issues: r.issues, notes: r.notes }; issues.push(...r.issues); }
      // Outside the sitcom: every close-up of a person keeps one background across all scenes (a past drama, 2026-10-20).
      if (sl.format !== "sitcom" && cast.length && (sl.scenes || []).length > 1) {
        try { const b = await backgroundCheck(file, sl, cast); report.backgrounds = b; issues.push(...b.issues); }
        catch (e) { issues.push(`no se pudo revisar los fondos entre escenas: ${e.message.slice(0, 120)}`); }
      }
    }
    // Launch films: the editor's own QC, the length to the frame at the plan's fps, the voice-over word for word, the
    // composited text read back from the frames, and Claude's heuristic quality report on this exact file.
    if (sl.format === "launch") {
      const plan = L.read(slug, "plan"), fps = plan?.fps || 24;
      if (!sl.finalQc?.pass) issues.push(`QC del editor: ${(sl.finalQc?.problems || ["no pasó"]).join("; ")}`);
      const vs = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=r_frame_rate,nb_read_frames", "-of", "json", file]).toString()).streams[0];
      report.frames = Number(vs.nb_read_frames);
      if (vs.r_frame_rate !== `${fps}/1`) issues.push(`${vs.r_frame_rate} fps, se pide ${fps}`);
      if (plan && Math.abs(report.frames - Math.round(plan.durationSeconds * fps)) > 1) issues.push(`${report.frames} cuadros; ${plan.durationSeconds} s a ${fps} fps son ${Math.round(plan.durationSeconds * fps)} (tolerancia 1 cuadro)`);
      const vo = (plan?.shots || []).filter((s) => s.vo).map((s) => ({ id: s.id, text: s.vo }));
      if (vo.length) { const d = dialogueCheck(file, vo, sl.lang); report.voiceover = d; issues.push(...d.issues.map((x) => `voz en off: ${x}`)); }
      const overlays = (plan?.shots || []).flatMap((s) => (s.text || []).map((o) => ({ text: o.text, t: s.start + ((o.at || 0) + Math.min(o.until ?? s.duration, s.duration)) / 2 })));
      if (!noJudge) try { const tc = await L.textCheck(file, overlays); report.text = tc.read; issues.push(...tc.issues); }
      catch (e) { issues.push(`no se pudo leer el texto del final: ${e.message.slice(0, 120)}`); }
      issues.push(...L.qualityRules(L.read(slug, "quality"), F.fileSha(file)));
    }
    // The 4 fps contact sheet (thumbnails for the whole cut). Identity is checked above at full resolution.
    const sheet = path.join(dir, "out", `${slug}-sheet.jpg`);
    const fps = longform ? `1/${Math.max(10, Math.round(report.duration / 60))}` : "4";
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `fps=${fps},scale=160:-2,tile=12x${longform ? 6 : Math.ceil((report.duration * 4) / 12)}`, "-frames:v", "1", "-q:v", "4", sheet]);
    const res = { pass: !issues.length, issues, report, sheet: P.rel(slug, sheet), sha: F.fileSha(file), at: now() };
    sl = P.updateShotlist(slug, (x) => { x.finalQc5 = res; });
    console.log(`${res.pass ? "QC DEL FINAL: PASA" : "QC DEL FINAL: FALLA"} · ${report.duration?.toFixed(1)} s · ${report.sizeMB} MB${report.lufs != null ? ` · ${report.lufs} LUFS` : ""}`);
    for (const i of issues) console.log(` - ${i}`);
    console.log(`Hoja de contacto: ${sheet}\nMírala completa antes de entregar (regla del creador), junto con la transcripción.`);
    process.exitCode = res.pass ? 0 : 1;
  },

  deliver() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    F.requireStep(sl, "deliver", "studio deliver");
    const file = F.finalFile(sl);
    const receipt = { file: P.rel(slug, file), sha: F.fileSha(file), at: now(), qc: sl.finalQc5.report, overrides: sl.flow.overrides || [] };
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
    console.log(`\nRecibo: projects/${slug}/delivery.json\nAhora: republica el Production Book, envía ${receipt.file} al creador con cualquier problema conocido, y haz el backup (npm run check, git push). Después: retro.`);
  },

  series(args = pos) {
    const [sub, id] = args;
    if (sub !== "new" || !id) throw new F.FlowStop('series new <id> --title "..."');
    const f = seriesFile(id);
    if (fs.existsSync(f)) throw new F.FlowStop(`la serie ${id} ya existe`);
    const tpl = P.readJSON(path.join(ROOT, "templates", "series.json"));
    delete tpl._how;
    P.writeJSON(f, { ...tpl, id, title: flag("--title", id), approved: null, episodes: [] });
    console.log(`series/${id}/series.json creado desde la plantilla. Llénalo con the creator (premisa, cast con deseos, mapa de sets, voces, intro, cierre, reglas) y apruébalo con el primer episodio: studio.mjs approve <slug> series --said "..."`);
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
