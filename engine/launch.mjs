#!/usr/bin/env node
// Product launch films (flow v5): the plan's tools and the editor. The creative files and their rules are in
// lib/launch.mjs; the gates are in lib/flow.mjs. Paid generation stays in gen.mjs (frames, clips, music, effects).
//
//   node engine/launch.mjs check <slug>             every launch rule on the brief, concepts, plan and style bible (free)
//   node engine/launch.mjs apply <slug>             the approved plan becomes the shotlist (keeps frames and takes of unchanged shots)
//   node engine/launch.mjs voice <slug> [--redo]    ElevenLabs voice-over per shot; measures each line against its room
//   node engine/launch.mjs animatic <slug>          frames (or placeholders) + voice + composited text, at the exact timing
//   node engine/launch.mjs build <slug> [--draft]   the film: takes, stills and cards cut to the frame, text, logo, captions,
//                                                   voice-over, ducked music, effects, -14 LUFS; editor QC + production manifest
//   node engine/launch.mjs package <slug>           (studio deliver) out/<slug>-package/ with every source file of the film
//
// The editor draws every exact element itself (titles, labels, UI cards, the CTA, the logo): video and image models
// never write text. Shots are cut on frame boundaries from the plan's timecodes, so the film lands on its length to
// the frame. Takes are silent; the sound is the voice-over, the music and the effects.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import * as F from "./lib/flow.mjs";
import * as L from "./lib/launch.mjs";
import * as eleven from "./lib/eleven.mjs";
import * as REF from "./lib/reference.mjs";
import * as RF from "./lib/refs.mjs";

const argv = process.argv.slice(2);
const [cmd, slug] = argv;
const has = (n) => argv.includes(n);
const flag = (n) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
const now = () => new Date().toISOString();
const ff = (args, cwd) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { cwd, maxBuffer: 1 << 26 });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const lufs = (f) => Number((spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
const SFX_LUFS = -36; // effects ~21 dB under the narration (-15 LUFS); still too loud at -31
const sha = (v) => crypto.createHash("sha1").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex").slice(0, 12);

// The creative files, parsed with their defaults. A rule that fails stops the command with the reasons.
function load(sl) {
  const plan = L.ShotPlan.parse(L.read(slug, "plan"));
  const style = L.StyleBible.parse(L.read(slug, "style"));
  const config = L.read(slug, "concepts")?.config;
  if (!config) throw new F.FlowStop("sin launch/concepts.json");
  return { plan, style, config, brief: L.read(slug, "brief") };
}

const commands = {
  // The reference the creator gave, measured (lib/reference.mjs) into launch/reference.json; the plan rules and the
  // final QC compare the film against it. Free: whisper and ffmpeg run locally.
  reference() {
    const sl = P.loadShotlist(slug);
    F.assertV5(sl);
    const file = flag("--file");
    if (!file || !fs.existsSync(file)) throw new F.FlowStop("reference <slug> --file <video de referencia>");
    const p = REF.profile(file, { lang: sl.lang === "es" ? "es" : "en" });
    P.writeJSON(path.join(P.projectDir(slug), "launch", "reference.json"), { ...p, at: now() });
    console.log(JSON.stringify(p, null, 1));
  },

  check() {
    const sl = P.loadShotlist(slug);
    F.assertV5(sl);
    const brief = L.read(slug, "brief"), concepts = L.read(slug, "concepts"), style = L.read(slug, "style");
    const groups = [
      ["brief.json", L.briefRules(brief)], ["concepts.json", L.conceptRules(concepts, brief)],
      ["shot-plan.json", L.planRules(L.read(slug, "plan"), { brief, concepts, style, reference: L.read(slug, "reference") || RF.asReference(sl.refsChoice?.ids || []) })], ["style-bible.json", L.styleRules(style, { slug, cast: F.castIds(sl) })],
    ];
    for (const [name, out] of groups) console.log(`${out.length ? "✗" : "✓"} ${name}${out.map((x) => `\n   - ${x}`).join("")}`);
    const plan = L.read(slug, "plan");
    if (plan?.shots) {
      console.log(`\n${plan.shots.length} tomas · ${+plan.shots.reduce((n, s) => n + s.duration, 0).toFixed(2)} s · ${plan.shots.reduce((n, s) => n + (s.vo?.match(/\S+/g) || []).length, 0)} palabras de voz en off`);
      for (const s of plan.shots) console.log(`  ${String(s.start.toFixed(2)).padStart(5)}–${(s.start + s.duration).toFixed(2).padEnd(5)} ${s.id.padEnd(4)} ${s.role.padEnd(11)} ${s.source.padEnd(8)} ${s.beat}${s.vo ? `  VO: "${s.vo}"` : ""}${(s.text || []).map((o) => `  [${o.kind}: ${o.text}]`).join("")}`);
    }
    process.exitCode = groups.some(([, o]) => o.length) ? 1 : 0;
  },

  // The plan becomes the shotlist. A shot whose prompts didn't change keeps its frame and takes (rebuild only what
  // depends on what changed); a changed shot starts clean.
  apply() {
    let sl = P.loadShotlist(slug);
    F.requireStep(sl, "board", "launch apply");
    const { plan, style } = load(sl);
    const bad = L.planRules(L.read(slug, "plan"), { brief: L.read(slug, "brief"), concepts: L.read(slug, "concepts"), style: L.read(slug, "style"), reference: L.read(slug, "reference") || RF.asReference(sl.refsChoice?.ids || []) });
    if (bad.length) throw new F.FlowStop(`el plan no pasa:\n - ${bad.join("\n - ")}`);
    // The cast is the style bible's characters (the intake's --chars is usually empty for a new launch cast).
    const cast = [...new Set([...(sl.cast || []), ...style.characters.map((c) => c.id)])];
    const fresh = L.toShots(plan, style, P.style(sl.style), cast);
    let kept = 0;
    sl = P.updateShotlist(slug, (x) => {
      const old = new Map((x.shots || []).map((s) => [s.id, s]));
      x.shots = fresh.map((s) => {
        const o = old.get(s.id);
        // --keep S7,S8: a reviewed frame stays even though its prompt text changed (its takes don't).
        // A still that becomes an animated shot keeps its first frame too (every launch shot is animated).
        const sameKind = o?.source === s.source || (o?.source === "still" && s.source === "generate");
        const takeFits = (o, s) => { const t = o.clips?.[o.clip], len = t && fs.existsSync(P.abs(slug, t.file)) ? dur(P.abs(slug, t.file)) : 0; return o.prompt === s.prompt && len > 0; }; // a re-timed shot kept dropping a good take; the editor reports a short one
        if (o?.frame && sameKind && (flag("--keep") || "").split(",").includes(s.id) && (o.framePrompt !== s.framePrompt || o.source !== s.source)) { kept++; return { ...s, frame: o.frame, frameKeptFrom: o.framePrompt, ...(takeFits(o, s) ? Object.fromEntries(Object.entries({ clips: o.clips, clip: o.clip, duration: o.duration, cutOut: o.cutOut, cleanPatch: o.cleanPatch, retime: o.retime, splice: o.splice, in: o.in }).filter(([, v]) => v !== undefined)) : {}) }; }
        if (!o || o.framePrompt !== s.framePrompt || o.source !== s.source) return s;
        kept++;
        const keep = { frame: o.frame, firstPrompt: o.firstPrompt, ...(o.lastPrompt === s.lastPrompt ? { last: o.last } : {}) };
        // A filmed take is kept when its animation prompt is the same and it is long enough for the new timing
        // (re-filming a take that already fits would waste money).
        const take = o.clips?.[o.clip], len = take && fs.existsSync(P.abs(slug, take.file)) ? dur(P.abs(slug, take.file)) : 0;
        if (o.prompt === s.prompt && len > 0) Object.assign(keep, { clips: o.clips, clip: o.clip, duration: o.duration, cutOut: o.cutOut, cleanPatch: o.cleanPatch, retime: o.retime, splice: o.splice, in: o.in }); // edit decisions travel with their take
        return { ...s, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) };
      });
      x.fps = plan.fps;
      x.cast = cast;
      x.music = plan.musicPrompt ? (x.music?.prompt === plan.musicPrompt ? x.music : { prompt: plan.musicPrompt }) : undefined;
      x.sfx = plan.sfx;
      x.launch = { ...(x.launch || {}), applied: F.planSha(x) };
    });
    console.log(`shotlist = plan ${plan.conceptId}: ${fresh.length} tomas (${fresh.filter(F.films).length} generadas, ${fresh.filter((s) => s.source === "still").length} fijas, ${fresh.filter((s) => s.source === "card").length} tarjetas); ${kept} conservan su cuadro`);
    for (const s of sl.shots.filter((s) => s.source !== "card" && !s.frame)) console.log(`  falta cuadro: node engine/gen.mjs frame ${slug} ${s.id} first --planned`);
  },

  // Voice-over before the book (like the sitcom's radio cut): ElevenLabs, billed in its own characters. Each line
  // is measured on the real audio against the room it has until the next line (or the end of the film).
  async voice() {
    const sl = P.loadShotlist(slug);
    // The single take is the narration's radio cut: it is recorded before the script gate so the creator approves the
    // text with its real timing (the narrator's voice must already be chosen).
    F.requireStep(sl, has("--take") ? "script" : "board", "launch voice");
    const { plan, config } = load(sl);
    if (!config.voiceover) return console.log("la película va sin voz en off");
    const V = sl.launch?.voice || {};
    if (!V.eleven) throw new F.FlowStop("falta la voz del narrador: sl.launch.voice.eleven (se elige con the creator en el casting)");
    const lines = plan.shots.filter((s) => s.vo);
    if (has("--take")) return takeVoice(plan, lines, V);
    const from = flag("--from") || V.source;
    if (from) return importVoice(plan, lines, from);
    const vo = { ...(sl.launch?.vo || {}) };
    let chars = 0;
    for (const [k, s] of lines.entries()) {
      const out = P.abs(slug, `audio/vo/${s.id}.mp3`);
      const key = sha([s.vo, V]);
      if (!(vo[s.id]?.key === key && fs.existsSync(out)) || has("--redo")) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await eleven.tts({ text: s.vo, voice: V.eleven, model: V.model || "eleven_multilingual_v2", settings: V.settings || { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true }, seed: V.seed ?? null, out });
        P.ledger(slug, { ok: true, label: `vo ${s.id}`, model: "elevenlabs-direct", credits: 0, chars: s.vo.length, files: [P.rel(slug, out)] });
        chars += s.vo.length;
      }
      const next = lines[k + 1];
      const room = +(((next ? next.start + next.voAt : plan.durationSeconds - 0.3) - (s.start + s.voAt))).toFixed(2);
      vo[s.id] = { text: s.vo, file: P.rel(slug, out), secs: +dur(out).toFixed(2), room, key };
    }
    P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), vo }; });
    const words = lines.reduce((n, s) => n + s.vo.split(/\s+/).length, 0), secs = Object.values(vo).reduce((n, v) => n + v.secs, 0);
    console.log(`voz en off: ${lines.length} líneas · ${words} palabras en ${secs.toFixed(1)} s de voz (${Math.round((words / secs) * 60)} wpm) · ${chars} caracteres de ElevenLabs nuevos`);
    for (const s of lines) { const v = vo[s.id]; console.log(`  ${s.id.padEnd(4)} ${v.secs.toFixed(2)} s de ${v.room} s ${v.secs > v.room + 0.05 ? "NO CABE" : "ok"}  "${s.vo}"`); }
  },

  async animatic() {
    const sl = P.loadShotlist(slug);
    F.requireStep(sl, "board", "launch animatic");
    // --approve --said: The creator watched this plan's animatic (storyboard panels or frames, voice, text, timing).
    // No frame is paid for before it (every cut and bridge is judged on the storyboard first).
    if (has("--approve")) {
      if (!flag("--said")) throw new F.FlowStop('animatic --approve necesita --said "palabras exactas del creador"');
      if (!sl.launch?.animatic || !fs.existsSync(path.join(P.projectDir(slug), "out", "animatic.mp4"))) throw new F.FlowStop("primero arma el animatic (launch.mjs animatic) y enséñaselo al creador");
      P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), animaticApproved: { plan: F.planSha(x), sig: F.launchSig(x), said: flag("--said"), at: now() } }; });
      return console.log("animatic aprobado con las palabras del creador; ya se pueden dibujar los cuadros (gen.mjs frame --planned)");
    }
    const out = await build(sl, "animatic");
    P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), animatic: { sig: F.launchSig(x), at: now() } }; });
    console.log(`${P.rel(slug, out)} · animatic (cuadros, voz y texto al tiempo exacto; sin música)`);
  },

  // A style made from the creator's own references: their images are copied into the bible, the look is
  // written out in words, and every frame and character sheet of the project receives the images.
  //   style-from-refs <slug> --name <id> --ref a.png --ref b.png [--ref c.png] --look "..." --negative "..." --said "..."
  "style-from-refs"() {
    const id = flag("--name"), refs = process.argv.flatMap((a, i) => (a === "--ref" && process.argv[i + 1] ? [process.argv[i + 1]] : []));
    if (!id || !flag("--look") || !flag("--negative") || !flag("--said")) throw new F.FlowStop('style-from-refs <slug> --name <id> --ref a.png --ref b.png --look "..." --negative "..." --said "palabras exactas del creador"');
    if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(id)) throw new F.FlowStop("--name: minúsculas, números y guiones (3–40)");
    const dir = path.join(P.BIBLE, "styles", id);
    if (fs.existsSync(path.join(dir, "style.json")) && JSON.parse(fs.readFileSync(path.join(dir, "style.json"), "utf8")).kind !== "custom") throw new F.FlowStop(`ya existe el estilo ${id} y no es propio; usa otro nombre`);
    fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
    const copied = refs.map((f, k) => { if (!fs.existsSync(f)) throw new F.FlowStop(`no existe la referencia ${f}`); const to = `refs/ref-${k + 1}${path.extname(f).toLowerCase() || ".png"}`; fs.copyFileSync(f, path.join(dir, to)); return to; });
    const base = P.style("storybook");
    const st = {
      id, name: id, kind: "custom", status: "draft", description: "A style made from the creator's own reference images.",
      look: flag("--look"), negative: flag("--negative"),
      imageRules: "Match the reference images: the same line, color, texture, light and depth in every frame. One clear focal action per frame; clean space where the editor places text.",
      camera: base.camera, motion: "Small, purposeful actions; keep the exact look of the first frame for the whole shot.",
      characterSheet: { ...base.characterSheet, prompt: "A 2x2 character model sheet of the same {who} in the style of the reference images, on a plain background: top-left front view, top-right three-quarter view, bottom-left side profile, bottom-right full body with its props. {look}. Identical shapes, colors, outfit and props in all four, neutral reference pose. Thin gutters between panels. No text, no labels." },
      refs: copied, refPolicy: "sheet", setRef: false, finish: "none", models: base.models,
      launch: { insertTreatment: flag("--footage") || "none", note: "real footage kept as it is unless the creator asks for a grade" },
      madeFrom: { said: flag("--said"), at: now() },
    };
    fs.writeFileSync(path.join(dir, "style.json"), JSON.stringify(st, null, 2) + "\n");
    const problems = L.customStyleRules({ ...st, dir });
    if (problems.length) throw new F.FlowStop(problems.join("; "));
    P.updateShotlist(slug, (x) => { x.style = id; });
    console.log(`estilo propio ${id}: ${copied.length} referencias en bible/styles/${id}; el proyecto usa este estilo. Pon visualStyle "${id}" en concepts.json y preset "${id}" en el style bible; la identidad visual se aprueba igual (studio.mjs approve-look).`);
  },

  // The motion test before the book can be skipped only in the creator's words.
  "waive-test"() {
    if (!flag("--said")) throw new F.FlowStop('waive-test <slug> --said "palabras exactas del creador"');
    P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), motionTestWaived: { said: flag("--said"), at: now() } }; });
    console.log("prueba de movimiento omitida con las palabras del creador (queda en el book)");
  },

  async build() {
    const sl = P.loadShotlist(slug);
    const draft = has("--draft");
    F.requireStep(sl, draft ? "film" : "edit", draft ? "launch build --draft" : "launch build");
    if (sl.format !== "launch") throw new F.FlowStop("launch.mjs build es solo para Product launch films");
    await build(sl, draft ? "draft" : "final");
  },

  // TAKE REVIEW: thumbnails at 2 fps miss things that pop in, sink or change mid-shot. Every take is looked at frame
  // by frame (4 fps, full width) against
  // a checklist before the final may use it; the verdict is tied to that take and its prompt.
  review() {
    const sl = P.loadShotlist(slug);
    F.requireStep(sl, "film", "launch review");
    const id = flag("--shot"), s = id && P.shot(sl, id), i = s?.clip ?? (s?.clips || []).length - 1, t = s?.clips?.[i];
    if (!t) throw new F.FlowStop("review <slug> --shot <id> [--ok \"qué se revisó\" | --reject \"qué falla\"]");
    const sheet = path.join(P.projectDir(slug), "out", "_review", `${id}.jpg`), joinSheet = path.join(P.projectDir(slug), "out", "_review", `${id}-join.jpg`);
    const prevShot = sl.shots[sl.shots.indexOf(s) - 1];
    if (flag("--ok")) {
      // A verdict answers every point of the checklist in words, after the sheets of this exact take were made
      // (a take "without things appearing" was approved while it melted, idled and broke the story).
      const pts = { motion: "--motion", join: "--join", logic: "--logic", appear: "--appear", end: "--end" };
      const miss = Object.entries(pts).filter(([, f]) => !flag(f)?.trim() || flag(f).trim().split(/\s+/).length < 2).map(([, f]) => f);
      if (miss.length) throw new F.FlowStop(`${id}: la revisión responde cada punto en palabras: ${miss.join(" ")} (movimiento natural sin deformarse; unión con la toma anterior; lógica de la historia; nada aparece, desaparece o se queda sin hacer nada; el último cuadro es el final planeado)`);
      const fresh = (f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= fs.statSync(P.abs(slug, t.file)).mtimeMs;
      if (!fresh(sheet)) throw new F.FlowStop(`${id}: primero mira la hoja cuadro por cuadro de esta toma (launch.mjs review ${slug} --shot ${id})`);
      if (prevShot && !fresh(joinSheet)) throw new F.FlowStop(`${id}: primero mira la unión con ${prevShot.id} (launch.mjs review ${slug} --shot ${id} genera ${id}-join.jpg)`);
    }
    if (flag("--ok") || flag("--reject")) {
      const answers = flag("--ok") ? { motion: flag("--motion"), join: flag("--join"), logic: flag("--logic"), appear: flag("--appear"), end: flag("--end") } : null;
      P.updateShotlist(slug, (x) => { const tk = P.shot(x, id).clips[i]; tk.review = { ok: !!flag("--ok"), notes: flag("--ok") || flag("--reject"), ...(answers ? { answers } : {}), file: tk.file, prompt: sha(P.shot(x, id).prompt), at: now() }; });
      return console.log(`${id}: revisión ${flag("--ok") ? "APROBADA" : "RECHAZADA"} (${flag("--ok") || flag("--reject")})`);
    }
    const out = path.join(P.projectDir(slug), "out", "_review", `${id}.jpg`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const n = Math.ceil(dur(P.abs(slug, t.file)) * 4);
    ff(["-i", P.abs(slug, t.file), "-vf", `fps=4,scale=640:-2,tile=4x${Math.ceil(n / 4)}`, "-frames:v", "1", "-q:v", "3", out]);
    // The join: the last second of the previous shot's take and the first second of this one, as the film plays them.
    const pt = prevShot?.clips?.[prevShot.clip ?? prevShot.clips.length - 1];
    if (pt && fs.existsSync(P.abs(slug, pt.file))) {
      const pf = P.abs(slug, pt.file), a = Math.max(0, dur(pf) - 1), b = s.in ?? 0;
      ff(["-ss", String(a), "-t", "1", "-i", pf, "-ss", String(b), "-t", "1", "-i", P.abs(slug, t.file), "-filter_complex", "[0:v]fps=6,scale=480:-2[a];[1:v]fps=6,scale=480:-2[b];[a][b]concat=n=2:v=1:a=0,tile=6x2", "-frames:v", "1", "-q:v", "3", joinSheet]);
      console.log(`unión con ${prevShot.id}: ${joinSheet}`);
    }
    const st = L.read(slug, "style") || {};
    console.log(`${out}
Mira cada cuadro y revisa:
 - ¿aparece, desaparece o se multiplica algo o alguien que no está en el plan? (gente, manos, objetos)
 - física: ¿todo lo que se mueve tiene causa visible y termina donde dice el final? (nada se hunde, nada sale de cuadro sin razón)
 - el hilo (${st.thread || "—"}) se ve igual que su ficha; ninguna mano o personaje distinto
 - reglas de continuidad: ${(st.continuity || []).map((c) => `${c.subject}: ${c.rule}`).join("; ") || "—"}
 - letras o logos dibujados por el modelo
 - el último cuadro coincide con el final planeado: ${P.shot(sl, id).end || L.read(slug, "plan")?.shots?.find((x) => x.id === id)?.end || "—"}
Luego: launch.mjs review ${slug} --shot ${id} --ok "..." --motion "..." --join "..." --logic "..." --appear "..." --end "..." | --reject "..."`);
  },

  package() {
    const sl = P.loadShotlist(slug);
    F.requireStep(sl, "deliver", "launch package");
    const d = P.projectDir(slug), pkg = path.join(d, "out", `${slug}-package`);
    fs.mkdirSync(pkg, { recursive: true });
    const names = { brief: "creative-brief.json", concepts: "concepts.json", plan: "shot-plan.json", style: "style-bible.json", quality: "quality-report.json" };
    for (const [k, n] of Object.entries(names)) fs.copyFileSync(L.fileOf(slug, k), path.join(pkg, n));
    for (const f of ["production-manifest.json"]) fs.copyFileSync(path.join(d, "launch", f), path.join(pkg, f));
    const srt = path.join(d, "out", `${slug}.srt`);
    if (fs.existsSync(srt)) fs.copyFileSync(srt, path.join(pkg, `${slug}.srt`));
    fs.writeFileSync(path.join(pkg, "script.md"), scriptMd(sl, load(sl)));
    const plan = load(sl).plan, last = plan.shots.at(-1);
    ff(["-ss", (last.start + last.duration / 2).toFixed(2), "-i", F.finalFile(sl), "-frames:v", "1", "-q:v", "2", path.join(pkg, "poster.jpg")]);
    console.log(`paquete: ${P.rel(slug, pkg)}/ (${fs.readdirSync(pkg).join(", ")})`);
  },
};

// ONE TAKE, PICTURE CUT TO IT. The whole narration is recorded in a single take with the narrator's voice, so the
// delivery flows as one performance; whisper times every word; each shot then starts where its
// line starts in the take (a short lead before the word) and the plan is rewritten with those times. The lines are
// cut from the take without touching its pauses. Rewriting the plan reopens the script gate, as any timing change does.
async function takeVoice(plan, lines, V) {
  const d = P.projectDir(slug);
  let k = 1; while (fs.existsSync(path.join(d, "audio", `narration-take-${k}.mp3`))) k++;
  const text = lines.map((s) => s.vo.trim()).join(" ");
  // --recut: the latest take again (the one the creator approved), only cut anew.
  if (has("--recut")) { if (k === 1) throw new F.FlowStop("no hay toma de narración que recortar"); k--; }
  const take = path.join(d, "audio", `narration-take-${k}.mp3`);
  fs.mkdirSync(path.dirname(take), { recursive: true });
  if (!has("--recut")) {
    const T = V.take || { model: "eleven_v3", settings: { stability: 0.5 } };
    await eleven.tts({ text, voice: V.eleven, model: T.model, settings: T.settings, out: take });
    P.ledger(slug, { ok: true, label: `narration take ${k}`, model: "elevenlabs-direct", credits: 0, chars: text.length, files: [P.rel(slug, take)] });
  }
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const ws = REF.words(take, L.read(slug, "concepts")?.config?.language === "es" ? "es" : "en").map((w) => ({ ...w, n: norm(w.w) })).filter((w) => w.n);
  const spans = [];
  let at = 0;
  for (const s of lines) {
    const toks = s.vo.split(/\s+/).map(norm).filter(Boolean);
    let j = -1;
    for (let x = at; x <= ws.length - toks.length && j < 0; x++) if (toks.every((t, q) => ws[x + q].n === t)) j = x;
    if (j < 0) throw new F.FlowStop(`${s.id}: la toma no dice "${s.vo}" palabra por palabra (narration-take-${k}.mp3); vuelve a grabar`);
    // The words around the line bound its cut: whisper puts word ends early (a cut at a word's end can clip its last
    // sound), so a line ends just before the next word starts, never at a fixed margin after its own.
    spans.push({ s, a: ws[j].start, b: ws[j + toks.length - 1].end, prevEnd: ws[j - 1]?.end ?? 0, nextStart: ws[j + toks.length]?.start ?? null });
    at = j + toks.length;
  }
  // Retime: line i starts its shot (lead 0.12 s); a closing shot without a line starts 0.3 s after the last word.
  const fps = plan.fps, q = (t) => Math.round(t * fps) / fps, lead = 0.12, n0 = plan.narrationStart;
  // shot.pause: seconds of breathing after a shot's line, kept on every re-cut (--recut re-timed the plan
  // from the narration and dropped the extra second the creator wanted after a line and the full celebration).
  const pauses = plan.shots.map((s) => s.pause || 0), before = (i) => pauses.slice(0, i).reduce((n, v) => n + v, 0);
  const end = n0 + spans.at(-1).b + before(spans.length), last = plan.shots.at(-1), tail = !last.vo;
  if (end > plan.durationSeconds - (tail ? 1.8 : 0.3)) throw new F.FlowStop(`la narración termina en ${end.toFixed(2)} s y la película dura ${plan.durationSeconds} s${tail ? " con el cierre de marca" : ""}; acorta el texto`);
  const starts = spans.map((x, i) => (i ? Math.floor((n0 + x.a - lead + before(i)) * fps) / fps : 0)); // down to the frame, so no line starts before its shot
  if (tail) starts.push(q(Math.max(end + 0.3, plan.durationSeconds - 3.5)));
  const p2 = L.read(slug, "plan");
  p2.shots.forEach((s, i) => { s.start = starts[i]; s.duration = +(((i + 1 < starts.length ? starts[i + 1] : plan.durationSeconds) - starts[i])).toFixed(4); });
  // Cut points: each line starts a little before its first word (never into the previous word) and ends exactly
  // where the next line starts, so lines are contiguous in the take and never overlap; the line is placed by its cut.
  spans.forEach((x) => { x.ca = Math.max(0, x.prevEnd + 0.02, x.a - 0.12); });
  spans.forEach((x, i) => { x.cb = spans[i + 1] ? spans[i + 1].ca : Math.min(dur(take), x.b + 0.6); });
  spans.forEach((x, i) => { p2.shots[i].voAt = +(n0 + x.ca + before(i) - starts[i]).toFixed(3); });
  const short = p2.shots.filter((s) => s.duration < 1);
  if (short.length) throw new F.FlowStop(`con esta toma ${short.map((s) => `${s.id} dura ${s.duration.toFixed(2)} s`).join(", ")}; reparte el texto (una toma necesita al menos 1 s)`);
  P.writeJSON(L.fileOf(slug, "plan"), p2);
  const vo = {};
  for (const [i, x] of spans.entries()) {
    const out = P.abs(slug, `audio/vo/${x.s.id}.mp3`), s = p2.shots[i];
    const a = x.ca, b = x.cb;
    ff(["-i", take, "-af", `atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, b - a - 0.03).toFixed(3)}:d=0.03`, "-c:a", "libmp3lame", "-q:a", "2", out]);
    // Each cut line is heard again: its first and last words must come out whole.
    const want = x.s.vo.split(/\s+/).map(norm).filter(Boolean), got = REF.words(out, "en").map((w) => norm(w.w)).filter(Boolean);
    if (got[0] !== want[0] || got.at(-1) !== want.at(-1)) throw new F.FlowStop(`${x.s.id}: el corte se oye "${got.join(" ")}" y la línea es "${want.join(" ")}"; revisa la toma`);
    const nx = p2.shots[i + 1];
    const room = +(((nx?.vo ? nx.start + nx.voAt : p2.durationSeconds - 0.3) - (s.start + s.voAt))).toFixed(2);
    vo[s.id] = { text: s.vo, file: P.rel(slug, out), secs: +dur(out).toFixed(2), room, key: sha([s.vo, P.rel(slug, take)]), source: P.rel(slug, take) };
  }
  P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), voice: { ...(x.launch?.voice || {}), source: P.rel(slug, take), takeMode: true }, vo }; });
  const words = text.split(/\s+/).length;
  console.log(`narración en una toma: ${P.rel(slug, take)} · ${words} palabras en ${(spans.at(-1).b - spans[0].a).toFixed(1)} s (${Math.round(words / (spans.at(-1).b - spans[0].a) * 60)} wpm) · el plan se recortó a la narración:`);
  for (const s of p2.shots) console.log(`  ${s.start.toFixed(2).padStart(5)}–${(s.start + s.duration).toFixed(2).padEnd(5)} ${s.id.padEnd(4)} ${s.vo ? `"${s.vo}"` : "(cierre)"}`);
}

// The voice-over from a recording the creator chose (a Voice Design preview of the whole script can't be
// reproduced by the saved voice, so the recording itself is used). The recording's words are timed with whisper,
// every plan line is found in order word for word (or nothing is written), each line is cut at its words, and only
// silences longer than 0.35 s inside a line are shortened to 0.3 s. The words themselves are never sped up.
async function importVoice(plan, lines, from) {
  const file = P.abs(slug, from);
  if (!fs.existsSync(file)) throw new F.FlowStop(`no existe la grabación ${from}`);
  const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "words.py"), file, L.read(slug, "concepts")?.config?.language === "es" ? "es" : "en"], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`words.py: ${(r.stderr || "").slice(-200)}`);
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const words = JSON.parse(r.stdout).map((w) => ({ ...w, n: norm(w.w) })).filter((w) => w.n);
  const total = dur(file), vo = {};
  let k = 0;
  for (const [i, s] of lines.entries()) {
    const toks = s.vo.split(/\s+/).map(norm).filter(Boolean);
    let at = -1;
    for (let j = k; j <= words.length - toks.length && at < 0; j++) if (toks.every((t, q) => words[j + q].n === t)) at = j;
    const next = lines[i + 1];
    const room = +(((next ? next.start + next.voAt : plan.durationSeconds - 0.3) - (s.start + s.voAt))).toFixed(2);
    if (at < 0) {
      // A line written after the recording (the new hook): the narrator's saved voice records it in the
      // calmest setting, and it is marked so the creator hears it next to the recording before it is used.
      const V = P.loadShotlist(slug).launch?.voice || {}, out = P.abs(slug, `audio/vo/${s.id}.mp3`);
      if (!V.eleven) throw new F.FlowStop(`${s.id}: "${s.vo}" no está en ${from} y no hay voz guardada para grabarla`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const fill = V.fill || { model: "eleven_multilingual_v2", settings: { stability: 0.85, similarity_boost: 0.8, style: 0, use_speaker_boost: true } };
      await eleven.tts({ text: s.vo, voice: V.eleven, model: fill.model, settings: fill.settings, out });
      P.ledger(slug, { ok: true, label: `vo ${s.id} (saved voice)`, model: "elevenlabs-direct", credits: 0, chars: s.vo.length, files: [P.rel(slug, out)] });
      vo[s.id] = { text: s.vo, file: P.rel(slug, out), secs: +dur(out).toFixed(2), room, key: sha([s.vo, V.eleven, fill]), source: "saved voice" };
      continue;
    }
    const ws = words.slice(at, at + toks.length);
    k = at + toks.length;
    // Pieces of speech split at long silences; each long silence becomes 0.3 s (0.15 s of air on each side).
    const pieces = [];
    let a = Math.max(0, ws[0].start - 0.06);
    for (let q = 1; q < ws.length; q++) if (ws[q].start - ws[q - 1].end > 0.35) { pieces.push([a, ws[q - 1].end + 0.15]); a = ws[q].start - 0.15; }
    pieces.push([a, Math.min(total, ws.at(-1).end + 0.15)]);
    const out = P.abs(slug, `audio/vo/${s.id}.mp3`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const graph = pieces.map(([x, y], q) => `[0:a]atrim=${x.toFixed(3)}:${y.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, y - x - 0.02).toFixed(3)}:d=0.02[p${q}]`).join(";") + `;${pieces.map((_, q) => `[p${q}]`).join("")}concat=n=${pieces.length}:v=0:a=1[o]`;
    ff(["-i", file, "-filter_complex", graph, "-map", "[o]", "-c:a", "libmp3lame", "-q:a", "2", out]);
    vo[s.id] = { text: s.vo, file: P.rel(slug, out), secs: +dur(out).toFixed(2), room, key: sha([s.vo, from]), source: from };
  }
  P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), voice: { ...(x.launch?.voice || {}), source: from }, vo }; });
  P.ledger(slug, { ok: true, label: "vo imported", model: "recording", credits: 0, files: Object.values(vo).map((v) => v.file) });
  console.log(`voz en off desde ${from}: ${lines.length} líneas, palabra por palabra`);
  for (const s of lines) { const v = vo[s.id]; console.log(`  ${s.id.padEnd(4)} ${v.secs.toFixed(2)} s de ${v.room} s ${v.secs > v.room + 0.05 ? "NO CABE" : "ok"}  "${s.vo}"`); }
}

function scriptMd(sl, { plan, brief, config }) {
  const tc = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
  return `# ${sl.title}\n\n${brief?.product?.name} · ${config.intent} launch film · ${plan.durationSeconds} s · ${config.aspectRatio} · ${plan.fps} fps · concept ${plan.conceptId}\n\n` +
    plan.shots.map((s) => `## ${tc(s.start)}–${tc(s.start + s.duration)} · ${s.id} · ${s.role}\n\n**Beat:** ${s.beat}  \n**Takeaway:** ${s.takeaway}  \n**Picture:** ${s.visual}  \n${s.vo ? `**VO:** ${s.vo}  \n` : ""}${s.text.map((o) => `**On screen (${o.kind}):** ${o.text}  \n`).join("")}${s.logo ? "**Logo**  \n" : ""}`).join("\n");
}

// The green screens of a still (lib/screens.py), cached per frame file on the shotlist.
function screensOf(sl, id, frame) {
  const c = sl.launch?.screens?.[id];
  if (c?.frame === frame) return c.boxes;
  const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "screens.py"), P.abs(slug, frame)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`screens.py: ${(r.stderr || "").slice(-200)}`);
  const boxes = JSON.parse(r.stdout);
  P.updateShotlist(slug, (x) => { x.launch = { ...(x.launch || {}), screens: { ...(x.launch?.screens || {}), [id]: { frame, boxes } } }; });
  sl.launch = { ...(sl.launch || {}), screens: { ...(sl.launch?.screens || {}), [id]: { frame, boxes } } };
  return boxes;
}

// ---- the editor (animatic, draft and final share it)
const assColor = (hex, alpha = 0) => `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const assTime = (t) => { const cs = Math.max(0, Math.round(t * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const srtTime = (t) => { const ms = Math.round(t * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
const assText = (s) => String(s).replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, "\\N");
const ALIGN = { top: 8, center: 5, bottom: 2, "lower-third": 1 };

async function build(sl, mode) {
  const { plan, style, config, brief } = load(sl);
  const d = P.projectDir(slug), tmp = path.join(d, "out", "_launch");
  fs.mkdirSync(tmp, { recursive: true });
  const fps = plan.fps, [W, H] = config.aspectRatio === "16:9" ? [1280, 720] : config.aspectRatio === "9:16" ? [720, 1280] : [720, 720];
  const total = plan.durationSeconds, N = Math.round(total * fps);
  const fr = (t) => Math.round(t * fps);
  const bg = style.text.box || style.palette[0];
  const problems = [], parts = [];

  // 1. Picture, shot by shot, each exactly its frames: [round(start*fps), round(end*fps)). A shot whose successor comes
  // in on a transition renders that many extra frames from its own take, so the overlap never shortens the film.
  const overlap = (i) => { const nx = plan.shots[i + 1]; return nx?.transitionIn && nx.transitionIn !== "cut" ? fr(nx.transitionSecs) : 0; };
  for (const [i, ps] of plan.shots.entries()) {
    const s = P.shot(sl, ps.id);
    const n = (i === plan.shots.length - 1 ? N : fr(ps.start + ps.duration)) - fr(ps.start);
    const m = n + overlap(i);
    const seg = path.join(tmp, `seg-${String(i).padStart(2, "0")}.mp4`);
    const enc = ["-frames:v", String(m), "-r", String(fps), "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", seg];
    const fit = `fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    const push = (z = 0.06) => `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='1+${z}*on/${Math.max(1, m)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${m}:s=${W}x${H}:fps=${fps},setsar=1`;
    const t = s.clips?.[s.clip ?? (mode === "draft" ? (s.clips || []).length - 1 : -1)];
    const frameFile = s.frame && fs.existsSync(P.abs(slug, s.frame)) ? P.abs(slug, s.frame) : null;
    let used = null, input = null, base = null;
    if (ps.source === "generate" && mode !== "animatic") {
      if (!t) throw new F.FlowStop(`${ps.id} no tiene toma`);
      if (mode === "final" && !F.takeOk(t)) throw new F.FlowStop(`${ps.id}: su toma no pasó todos los evals`);
      if (mode === "final" && !(t.review?.ok && t.review.file === t.file && t.review.prompt === sha(s.prompt))) throw new F.FlowStop(`${ps.id}: su toma no tiene revisión cuadro por cuadro aprobada (launch.mjs review ${slug} --shot ${ps.id})`);
      // s.cutOut: an edit decision on the filmed take (an unplanned element enters later): used up to here, then the
      // last clean frame holds. It does not reopen the approved plan.
      // s.retime {upTo}: an edit decision (when the model invents motion late in a take): only the
      // clean part up to here is used, slowed with motion interpolation to fill the planned length (never below 0.65x).
      // Every edit decision on a take is the creator's call, in their words.
      if (mode === "final") for (const k of ["retime", "splice", "cutOut", "cleanPatch"]) if (s[k] && !s[k].said?.trim()) throw new F.FlowStop(`${ps.id}: la decisión de edición ${k} no tiene las palabras del creador (${k}.said)`);
      const file = P.abs(slug, t.file), a = s.in ?? 0, b = Math.min(s.retime?.upTo ?? Infinity, s.cutOut?.at ?? Infinity, t.evals?.jumps?.trimAt ?? Infinity, dur(file));
      // s.splice {keep: [[from, to], ...], fade}: an edit decision (when something appears mid-take that
      // shouldn't): the clean pieces of one take joined by short dissolves, slowed to fill the shot.
      const sp = s.splice, fade = sp?.fade ?? 0.3, spLen = sp ? sp.keep.reduce((n, [x, y]) => n + (y - x), 0) - fade * (sp.keep.length - 1) : 0;
      const slow = sp ? (m / fps) / spLen : s.retime ? (m / fps) / (b - a) : 1;
      if (slow > 1 / 0.65) throw new F.FlowStop(`${ps.id}: retime ralentiza ${slow.toFixed(2)}x; el máximo es 1.54x`);
      if (sp) problems.push(`${ps.id}: empalme de ${sp.keep.map(([x, y]) => `${x}-${y}`).join(" + ")} s con fundidos de ${fade} s, ralentizado ${slow.toFixed(2)}x (splice)`);
      else if (s.retime) problems.push(`${ps.id}: se usa ${a}-${b.toFixed(2)} s de la toma, ralentizado ${slow.toFixed(2)}x (retime)`);
      else if (b - a < m / fps - 0.05) problems.push(`${ps.id}: la toma útil dura ${(b - a).toFixed(2)} s y la toma planeada ${(m / fps).toFixed(2)} s; se congela el último cuadro`);
      input = sp ? ["-i", file] : ["-ss", String(a), "-t", (b - a).toFixed(3), "-i", file];
      let join = "";
      if (sp) {
        const k = sp.keep.length; let acc = "p0", off = 0;
        join = `split=${k}${sp.keep.map((_, j) => `[s${j}]`).join("")};` + sp.keep.map(([x, y], j) => `[s${j}]trim=${x}:${y},setpts=PTS-STARTPTS,fps=${fps}[p${j}];`).join("");
        sp.keep.forEach(([x, y], j) => { off += y - x - fade; if (j) { join += `[${acc}][p${j}]xfade=transition=fade:duration=${fade}:offset=${(off - (y - x) + fade).toFixed(3)}[x${j}];`; acc = `x${j}`; } });
        join = join.slice(0, -`[${acc}];`.length) + ",";
      }
      // ps.zoomInto: the camera flies into a screen in the last secs of the shot (eased), ending with the screen's rect
      // filling the frame; the next shot dissolves in as the world that screen showed.
      const z = ps.zoomInto, zoom = z ? (() => {
        const T = n / fps, st = Math.max(0, T - z.secs) /* the zoom completes at the cut; a transition after it plays on the full screen */, p = `min(1,max(0,(n/${fps}-${st.toFixed(3)})/${z.secs}))`, e = `(${p}*${p}*(3-2*${p}))`;
        const k = `(1/(1-(1-${z.w})*${e}))`, ax = z.x / (1 - z.w), ay = z.y / (1 - z.w);
        // zoompan, not scale+crop: crop keeps the size it was configured with and drifted to the top-left corner.
        return `,scale=${W * 2}:${H * 2}:flags=bicubic,zoompan=z='${k.replace(/n\//g, 'on/')}':x='(iw-iw/zoom)*${ax.toFixed(4)}':y='(ih-ih/zoom)*${ay.toFixed(4)}':d=1:s=${W}x${H}:fps=${fps}`;
      })() : "";
      base = `${join}${slow > 1 ? `setpts=PTS*${slow.toFixed(5)},minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1,` : ""}${fit},tpad=stop_mode=clone:stop_duration=${Math.ceil(m / fps) + 1}${zoom}`;
      used = { file: t.file, model: t.model, take: (s.clip ?? s.clips.length - 1) + 1, ...(sp ? { splice: { ...sp, slow } } : s.retime ? { retime: { upTo: b, slow } } : {}) };
    } else if (ps.source !== "card" && frameFile) {
      // The animatic (and any legacy still) shows the first frame; with real footage inside it, it stays put.
      input = ["-loop", "1", "-i", frameFile];
      base = ps.inserts.length ? fit : push(ps.source === "still" ? 0.06 : 0.03);
      used = { file: s.frame, still: true };
    } else if (ps.source === "card") {
      ff(["-f", "lavfi", "-i", `color=c=${bg.replace("#", "0x")}:s=${W}x${H}:r=${fps}`, ...enc]);
      used = { card: bg };
    } else {
      if (mode !== "animatic") throw new F.FlowStop(`${ps.id} no tiene cuadro (gen.mjs frame ${slug} ${ps.id} first --planned)`);
      // A storyboard animatic before any frame is paid for: the shot's drawn start panel
      // dissolves into its end panel (launch/boards/<id>-a.png, -b.png), so the cuts and bridges are judged first.
      const bd = (k) => path.join(P.projectDir(slug), "launch", "boards", `${ps.id}-${k}.png`);
      if (fs.existsSync(bd("a")) && fs.existsSync(bd("b"))) {
        const d = m / fps, x = Math.min(0.5, d * 0.25), off = Math.max(0.1, d * 0.55 - x / 2);
        ff(["-loop", "1", "-t", String(d + 1), "-i", bd("a"), "-loop", "1", "-t", String(d + 1), "-i", bd("b"), "-filter_complex", `[0:v]${fit}[a];[1:v]${fit}[b];[a][b]xfade=transition=fade:duration=${x.toFixed(3)}:offset=${off.toFixed(3)}`, ...enc]);
        used = { boards: [path.relative(P.projectDir(slug), bd("a")), path.relative(P.projectDir(slug), bd("b"))] };
      } else {
        ff(["-f", "lavfi", "-i", `color=c=0x888888:s=${W}x${H}:r=${fps}`, ...enc]); // placeholder: timing preview before frames
        used = { placeholder: true };
      }
    }
    if (input && ps.inserts.length) {
      // Real footage inside the picture: each clip plays behind its green screen (reading order, found on the first
      // frame), and the green is keyed out of every frame, so on an animated shot with a locked camera the clips stay
      // inside their screens while the room around them moves.
      if (!frameFile) throw new F.FlowStop(`${ps.id} no tiene cuadro para encontrar sus pantallas`);
      const boxes = screensOf(sl, ps.id, s.frame);
      if (boxes.length < ps.inserts.length) throw new F.FlowStop(`${ps.id}: el cuadro tiene ${boxes.length} pantallas verdes y lleva ${ps.inserts.length} clips; rehaz el cuadro`);
      const pad = 0.012, g = [`[0:v]${base},format=rgba,colorkey=0x00FF00:0.35:0.08[fg]`, `color=c=black:s=${W}x${H}:r=${fps}[b0]`];
      ps.inserts.forEach((_, k) => {
        const b = boxes[k], x = Math.max(0, Math.round((b.x - pad) * W)), y = Math.max(0, Math.round((b.y - pad) * H));
        const w = Math.min(W - x, Math.round((b.w + 2 * pad) * W)) & ~1, h = Math.min(H - y, Math.round((b.h + 2 * pad) * H)) & ~1;
        // Real footage graded into the illustrated world (raw photoreal clips broke the storybook universe).
        // The project style says how (bible/styles/<id>/style.json launch.insertTreatment; "none" keeps it raw).
        const lt = (() => { try { return P.style(sl.style).launch?.insertTreatment; } catch { return null; } })();
        const treat = ps.inserts[k].treatment !== "none" && lt && lt !== "none" ? `,${lt}` : "";
        g.push(`[${k + 1}:v]fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1${treat},tpad=stop_mode=clone:stop_duration=${Math.ceil(m / fps) + 1}${ps.inserts[k].onAt != null ? `,fade=t=in:st=${ps.inserts[k].onAt}:d=0.12` : ""}[c${k}]`, `[b${k}][c${k}]overlay=${x}:${y}[b${k + 1}]`);
      });
      g.push(`[b${ps.inserts.length}][fg]overlay=0:0,setsar=1`);
      ff([...input, ...ps.inserts.flatMap((i) => ["-ss", String(i.from), "-i", P.abs(slug, i.file)]), "-filter_complex", g.join(";"), ...enc]);
      used = { ...used, inserts: ps.inserts.map((i, k) => ({ ...i, screen: boxes[k] })) };
    } else if (input && s.cleanPatch && ps.source === "generate" && mode !== "animatic") {
      // CLEAN PATCH (when the model writes or draws something on a static area mid-shot, camera still): the region
      // from the take's first frame is laid over the whole shot. An edit decision on the take, recorded with its reason.
      const c = s.cleanPatch, sx = W / 1280;
      const [x, y, w, h] = [c.x, c.y, c.w, c.h].map((v) => Math.round(v * sx) & ~1);
      ff([...input, "-filter_complex", `[0:v]${base},split[m][f];[f]trim=end_frame=1,loop=loop=-1:size=1:start=0,setpts=N/${fps}/TB,crop=${w}:${h}:${x}:${y}[p];[m][p]overlay=${x}:${y}:shortest=1`, ...enc]);
      used = { ...used, cleanPatch: c };
    } else if (input) ff([...input, "-vf", base, ...enc]);
    parts.push({ ps, n, m, seg, used });
  }
  // ONE LOOK (generated shots drift in brightness and color from one to the next; a film holds one look).
  // Each shot is measured and leveled to the style bible's grade, or to the film's median.
  const meas = parts.map((p) => {
    const e = spawnSync("ffmpeg", ["-hide_banner", "-i", p.seg, "-vf", "fps=4,signalstats,metadata=print:key=lavfi.signalstats.YAVG,metadata=print:key=lavfi.signalstats.SATAVG", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const xs = (k) => [...e.matchAll(new RegExp(`${k}=([\\d.]+)`, "g"))].map((x) => Number(x[1]));
    const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    return { y: mean(xs("YAVG")), s: mean(xs("SATAVG")) };
  });
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const look = style.grade || { brightness: med(meas.map((x) => x.y)), saturation: med(meas.map((x) => x.s)) };
  parts.forEach((p, i) => {
    if (p.used?.card || p.used?.placeholder || p.used?.boards) return; // storyboard panels keep their drawing
    const b = Math.max(-0.25, Math.min(0.25, (look.brightness - meas[i].y) / 255)), sat = Math.max(0.7, Math.min(1.35, look.saturation / Math.max(1, meas[i].s)));
    if (Math.abs(b) < 0.01 && Math.abs(sat - 1) < 0.03) return;
    const graded = p.seg.replace(/\.mp4$/, "-g.mp4");
    ff(["-i", p.seg, "-vf", `eq=brightness=${b.toFixed(3)}:saturation=${sat.toFixed(3)}`, "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", graded]);
    fs.renameSync(graded, p.seg);
    p.grade = { brightness: +b.toFixed(3), saturation: +sat.toFixed(3) };
  });
  // chain "exact": the cut must disappear. The previous shot's last frame and this shot's first frame, as the film plays
  // them, are compared (SSIM); a jump means the take drifted from its drawn last frame or the in-point moved.
  if (mode !== "animatic") for (let i = 1; i < parts.length; i++) if (parts[i].ps.chain === "exact" && parts[i].ps.source === "generate") {
    const a1 = path.join(tmp, `join-${i}-a.png`), b1 = path.join(tmp, `join-${i}-b.png`);
    ff(["-sseof", "-0.05", "-i", parts[i - 1].seg, "-update", "1", "-frames:v", "1", a1]);
    ff(["-i", parts[i].seg, "-frames:v", "1", b1]);
    const e = spawnSync("ffmpeg", ["-hide_banner", "-i", a1, "-i", b1, "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const v = Number((e.match(/All:([\d.]+)/) || [])[1] ?? 0);
    parts[i].join = +v.toFixed(3);
    if (v < 0.8) problems.push(`${parts[i].ps.id}: la unión con ${parts[i - 1].ps.id} salta (SSIM ${v.toFixed(2)}, mínimo 0.80 para un corte invisible); revisa el in de la toma o el último cuadro de ${parts[i - 1].ps.id}`);
  }
  const picture = path.join(tmp, "picture.mp4");
  if (parts.every((p) => p.m === p.n)) {
    fs.writeFileSync(path.join(tmp, "segments.txt"), parts.map((p) => `file '${path.basename(p.seg)}'`).join("\n"));
    ff(["-f", "concat", "-safe", "0", "-i", "segments.txt", "-c", "copy", picture], tmp);
  } else {
    // Transitions (xfade) where the plan asks for one, hard cuts elsewhere; the total stays N frames.
    const g = parts.map((p, i) => `[${i}:v]fps=${fps},settb=1/${fps},format=yuv420p[s${i}]`);
    let acc = "s0", len = parts[0].m;
    for (let i = 1; i < parts.length; i++) {
      const ov = parts[i - 1].m - parts[i - 1].n, out = `x${i}`;
      const tr = parts[i].ps.transitionIn, timing = `duration=${(ov / fps).toFixed(4)}:offset=${((len - ov) / fps).toFixed(4)}`;
      if (ov && tr === "ripple") {
        // RIPPLE: a ring wave spreads from the touch point (rippleAt), bends both pictures and carries one into the other.
        const at = parts[i].ps.rippleAt || { x: 0.5, y: 0.3 }, cx = (at.x * W).toFixed(1), cy = (at.y * H).toFixed(1);
        // One ring of water travels out from the touch point; only the ring bends the picture, inside it the new world
        // is already clean (a whole-frame wave read as melting).
        const q = "(1-P)", d = `hypot(X-${cx},Y-${cy})`, R = `(${q}*hypot(W,H)*1.05)`, ring = `exp(-pow((${d}-${R})/55,2))`;
        const amp = `(9*${ring}*(1-0.7*${q}))`, wv = `sin((${d}-${R})/10)`;
        const xs = `clip(X+(X-${cx})/max(${d},1)*${amp}*${wv},0,W-1)`, ys = `clip(Y+(Y-${cy})/max(${d},1)*${amp}*${wv},0,H-1)`;
        const front = `clip((${d}-${R})/35+0.5,0,1)`; // 0 inside the ring (new world), 1 outside (old picture)
        const pl = (f) => `if(eq(PLANE,0),${f}0(${xs},${ys}),if(eq(PLANE,1),${f}1(${xs},${ys}),${f}2(${xs},${ys})))`;
        g.push(`[${acc}]format=gbrp[ra${i}]`, `[s${i}]format=gbrp[rb${i}]`, `[ra${i}][rb${i}]xfade=transition=custom:${timing}:expr='${pl("a")}*${front}+${pl("b")}*(1-${front})',format=yuv420p,settb=1/${fps}[${out}]`);
        len += parts[i].m - ov;
      } else if (ov) { g.push(`[${acc}][s${i}]xfade=transition=${tr === "dissolve" ? "fade" : tr}:${timing},settb=1/${fps}[${out}]`); len += parts[i].m - ov; }
      else { g.push(`[${acc}][s${i}]concat=n=2:v=1:a=0,settb=1/${fps}[${out}]`); len += parts[i].m; }
      acc = out;
    }
    ff([...parts.flatMap((p) => ["-i", path.basename(p.seg)]), "-filter_complex", g.join(";"), "-map", `[${acc}]`, "-frames:v", String(N), "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "picture.mp4"], tmp);
  }

  // 2. Exact text: titles, labels, UI cards, the CTA, captions. ASS through libass with the style bible's font.
  const m = style.brand.safeMargin, size = (k) => Math.round(H * k);
  const box = style.text.box || "#FFFFFF", accent = style.text.accent || style.palette[1];
  const styles = [
    `Style: title,${style.text.font},${size(0.075)},${assColor(style.text.color)},${assColor(style.text.color)},${assColor(box)},&H64000000,1,0,0,0,100,100,0,0,1,0,${Math.round(H * 0.003)},5,${Math.round(W * m)},${Math.round(W * m)},${Math.round(H * m)},1`,
    // Labels sit on footage, so they carry their own paper box (legible over any picture). UI text is a white card,
    // distinct from the cream card background it usually sits on.
    // The brand reveal: the product's name large enough to own the card (at title size it reads small).
    `Style: brand,${style.text.font},${size(0.15)},${assColor(style.text.color)},${assColor(style.text.color)},${assColor(box)},&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,${Math.round(W * m)},${Math.round(W * m)},${Math.round(H * m)},1`,
    `Style: label,${style.text.font},${size(0.05)},${assColor(style.text.color)},${assColor(style.text.color)},${assColor(box, 0x18)},&H00000000,1,0,0,0,100,100,0,0,3,${Math.round(H * 0.014)},0,2,${Math.round(W * m)},${Math.round(W * m)},${Math.round(H * m)},1`,
    `Style: cta,${style.text.font},${size(0.06)},${assColor(box)},${assColor(box)},${assColor(accent)},&H00000000,1,0,0,0,100,100,0,0,3,${Math.round(H * 0.018)},0,2,${Math.round(W * m)},${Math.round(W * m)},${Math.round(H * m)},1`,
    `Style: ui,${style.text.font},${size(0.05)},${assColor(style.text.color)},${assColor(style.text.color)},${assColor(style.text.uiBox || "#FFFFFF")},&H00000000,0,0,0,0,100,100,0,0,3,${Math.round(H * 0.03)},0,5,${Math.round(W * m)},${Math.round(W * m)},${Math.round(H * m)},1`,
    `Style: caption,${style.text.font},${size(0.045)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(H * 0.004))},0,2,${Math.round(W * 0.1)},${Math.round(W * 0.1)},${Math.round(H * 0.06)},1`,
  ];
  const events = [];
  for (const { ps } of parts) {
    for (const o of ps.text) {
      const a = ps.start + o.at, b = ps.start + Math.min(o.until ?? ps.duration, ps.duration);
      const pos = ALIGN[o.position] ?? 2, mv = o.position === "lower-third" ? `,0,0,${size(0.2)}` : ",0,0,0";
      events.push(`Dialogue: 1,${assTime(a)},${assTime(b)},${o.kind},,${mv.slice(1)},,{\\an${pos}\\fad(120,120)}${assText(o.text)}`);
    }
    // No logo file: the brand name is set in the title style (deterministic, never a model's lettering).
    if (ps.logo && !style.brand.logo) events.push(`Dialogue: 1,${assTime(ps.start + (ps.logoAt ?? 0))},${assTime(ps.start + ps.duration)},brand,,0,0,${Math.round(H * 0.06)},,{\\an8\\fad(200,0)}${assText(style.brand.name)}`); // in the sky, above the picture's subject
  }
  // Captions: the voice-over lines at their recorded time (only when the concept gate asked for captions).
  const srt = [];
  if (config.captions) for (const { ps } of parts) {
    const v = sl.launch?.vo?.[ps.id];
    if (!ps.vo || !v) continue;
    const a = ps.start + ps.voAt, b = Math.min(total, a + v.secs + 0.2);
    events.push(`Dialogue: 0,${assTime(a)},${assTime(b)},caption,,0,0,0,,${assText(ps.vo)}`);
    srt.push(`${srt.length + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${ps.vo}\n`);
  }
  fs.writeFileSync(path.join(tmp, "text.ass"), `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles.join("\n")}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`);
  const fontsdir = style.text.fontFile ? `:fontsdir=${path.relative(d, path.dirname(P.abs(slug, style.text.fontFile))).replace(/\\/g, "/") || "."}` : "";

  // 3. Sound: voice-over at its shot, music ducked under it and shaped by each shot's intensity, effects on cue.
  const ins = [], chains = [], vo = [], fx = [];
  const add = (f, extra = []) => { ins.push(...extra, "-i", f); return ins.filter((x) => x === "-i").length; }; // input index (0 = picture)
  for (const { ps } of parts) {
    const v = sl.launch?.vo?.[ps.id];
    if (!ps.vo) continue;
    if (!v || !fs.existsSync(P.abs(slug, v.file))) { if (mode !== "animatic") throw new F.FlowStop(`${ps.id}: falta la voz en off (launch.mjs voice)`); continue; }
    const k = add(P.abs(slug, v.file)), ms = Math.round((ps.start + ps.voAt) * 1000);
    chains.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${k}]`);
    vo.push(`[vo${k}]`);
    if (ps.start + ps.voAt + v.secs > total + 0.02) problems.push(`${ps.id}: la voz se corta al final de la película`);
  }
  for (const { ps } of parts) for (const x of ps.sfx) {
    const e = typeof x === "string" ? { name: x, at: 0, db: -8 } : x, f = P.abs(slug, `audio/sfx-${e.name}.mp3`);
    if (!fs.existsSync(f)) { if (mode === "final") throw new F.FlowStop(`falta el efecto ${e.name} (gen.mjs sfx)`); continue; }
    // Effects sit under the voice (raw generated effects vary widely in loudness and the loud ones bury the
    // film). Each file is measured and brought to SFX_LUFS, peaks held at -14 dBFS; `gain` (dB)
    // nudges one cue up or down from there.
    const k = add(f), ms = Math.round((ps.start + e.at) * 1000);
    const lu = Number([...spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1] ?? -24);
    const g = Math.max(-30, Math.min(12, SFX_LUFS - lu + (e.gain ?? 0)));
    chains.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${g.toFixed(1)}dB,alimiter=limit=0.2:attack=2:release=50:level=false,adelay=${ms}|${ms}[fx${k}]`);
    fx.push(`[fx${k}]`);
  }
  const musicFile = config.music && mode !== "animatic" && sl.music?.files?.length ? P.abs(slug, sl.music.files[sl.music.pick ?? 0]) : null;
  if (config.music && mode === "final" && !musicFile) throw new F.FlowStop("falta la música (gen.mjs music)");
  const mix = [];
  // A gentle compressor evens the narration's own swings between sentences.
  if (vo.length) { chains.push(`${vo.join("")}amix=inputs=${vo.length}:normalize=0,acompressor=threshold=0.06:ratio=3:attack=8:release=250:makeup=1.6[vobus]`); }
  if (musicFile) {
    const k = add(musicFile);
    // Gentle moves only: a bed under a continuous narration stays even (a good reference moves about 3 dB across the film).
    const lvl = { low: 0.85, mid: 0.92, high: 1 };
    // Nested from the last shot outwards, so the first shot's test is the outermost one (each shot gets its own level).
    const shape = [...parts].reverse().reduce((e, { ps }) => `if(lt(t,${(ps.start + ps.duration).toFixed(3)}),${lvl[ps.music]},${e})`, "1");
    chains.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS,volume=-10dB,volume='${shape}':eval=frame,afade=t=in:d=0.4,afade=t=out:st=${(total - 1.6).toFixed(2)}:d=1.6[mus]`);
    // The key is padded to the film's length: sidechaincompress stops when its key ends, and the voice ends before the
    // brand card (otherwise the music can go silent before the end).
    if (vo.length) { chains.push("[vobus]asplit=2[vomix][vokey0]", `[vokey0]apad=whole_dur=${total}[vokey]`, "[mus][vokey]sidechaincompress=threshold=0.05:ratio=3:attack=30:release=600[duck]"); mix.push("[vomix]", "[duck]"); }
    else mix.push("[mus]");
  } else if (vo.length) mix.push("[vobus]");
  mix.push(...fx);
  if (!mix.length) { const k = add(`anullsrc=r=48000:cl=stereo`, ["-f", "lavfi"]); chains.push(`[${k}:a]atrim=0:${total}[silence]`); mix.push("[silence]"); }
  chains.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total},asetpts=PTS-STARTPTS[a]`);

  // 4. Picture + logo + text + sound, encoded once to the exact frame count; then one linear loudness pass.
  const vchain = [];
  let vin = "[0:v]";
  if (style.brand.logo && parts.some((p) => p.ps.logo)) {
    const k = add(P.abs(slug, style.brand.logo), ["-loop", "1"]);
    const on = parts.filter((p) => p.ps.logo).map((p) => `between(t,${(p.ps.start + (p.ps.logoAt ?? 0)).toFixed(3)},${(p.ps.start + p.ps.duration).toFixed(3)})`).join("+");
    vchain.push(`[${k}:v]scale=${Math.round(W * 0.28)}:-1,format=rgba[logo]`, `${vin}[logo]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1:enable='${on}'[vl]`);
    vin = "[vl]";
  }
  vchain.push(`${vin}subtitles=out/_launch/text.ass${fontsdir},format=yuv420p[v]`);
  const mov = path.join(tmp, "film.mov");
  ff(["-i", "out/_launch/picture.mp4", ...ins.map((x) => (x.startsWith(d) ? path.relative(d, x).replace(/\\/g, "/") : x)), "-filter_complex", [...chains, ...vchain].join(";"), "-map", "[v]", "-map", "[a]", "-frames:v", String(N), "-r", String(fps), "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-t", String(total), path.relative(d, mov)], d);
  const name = mode === "animatic" ? "animatic.mp4" : mode === "draft" ? `${slug}-DRAFT.mp4` : `${slug}.mp4`;
  const out = path.join(d, "out", name);
  const target = mode === "animatic" ? -16 : -14;
  const me = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", mov, "-af", `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(me.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  const silent = !Number.isFinite(Number(j.input_i));
  ff(["-i", mov, "-c:v", "copy", ...(silent ? [] : ["-af", `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`]), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  if (mode === "animatic") return out;

  // 5. Editor QC: the length to the frame, the voice-over without overlaps or cut-offs, the loudness.
  const frames = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out]).toString());
  if (Math.abs(frames - N) > 1) problems.push(`${frames} cuadros y se piden ${N} (${total} s a ${fps} fps)`);
  const lines = plan.shots.filter((s) => s.vo && sl.launch?.vo?.[s.id]);
  for (const [k, s] of lines.entries()) { const nx = lines[k + 1]; const end = s.start + s.voAt + sl.launch.vo[s.id].secs; if (nx && end > nx.start + nx.voAt + 0.02) problems.push(`${s.id}: la voz se encima con la de ${nx.id}`); }
  const loud = lufs(out);
  // EVEN MIX: the 2 s windows of the film stay within 6 dB of each other (the fade-out excluded).
  const band = REF.loudnessBand(out, total);
  if (mode === "final" && band.spread > 6) problems.push(`la mezcla salta ${band.spread} dB entre ventanas de 2 s (máximo 6; la referencia ${L.read(slug, "reference")?.loudness?.spread ?? "—"}); revisa huecos de voz y el nivel de la música`);
  if (!silent && !(Math.abs(loud - -14) <= 1)) problems.push(`volumen ${loud} LUFS, se pide -14`);
  const soft = problems.filter((p) => /se congela|\((retime|splice)\)$/.test(p)); // approved edit decisions are notes, not failures
  const hard = problems.filter((p) => !soft.includes(p));
  if (config.captions && srt.length) fs.writeFileSync(path.join(d, "out", mode === "draft" ? `${slug}-DRAFT.srt` : `${slug}.srt`), srt.join("\n"));
  if (mode === "final") {
    const ledger = P.readJSON(path.join(d, "ledger.json"), []);
    const cost = (re) => +(ledger.filter((e) => e.ok && re.test(e.label || "")).reduce((n, e) => n + (e.credits || 0), 0) * 0.005).toFixed(2);
    const manifest = {
      film: P.rel(slug, out), sha: F.fileSha(out), at: now(), engine: P.readJSON(path.join(ROOT, "package.json")).version,
      product: brief?.product?.name, config, conceptId: plan.conceptId, frames, fps, size: `${W}x${H}`, loudness: loud,
      shots: parts.map(({ ps, n, used }) => {
        const s = P.shot(sl, ps.id), t = s.clips?.[s.clip];
        return { id: ps.id, role: ps.role, source: ps.source, start: ps.start, duration: ps.duration, frames: n, used, framePrompt: s.framePrompt || null, videoPrompt: t?.prompt || null, evals: t?.evals || null, claim: ps.claim || null, text: ps.text, vo: ps.vo || null, voFile: sl.launch?.vo?.[ps.id]?.file || null, actualUsd: cost(new RegExp(`^${ps.id} `)) };
      }),
      audio: { voice: sl.launch?.voice?.eleven || null, music: musicFile ? P.rel(slug, musicFile) : null, sfx: Object.keys(plan.sfx || {}) },
      spend: { actualUsd: +(P.ledgerTotal(slug) * 0.005).toFixed(2), approvedUsd: sl.budget?.approvedCredits != null ? +(sl.budget.approvedCredits * 0.005).toFixed(2) : null, note: "actual = credits charged by Kie and recorded in ledger.json; ElevenLabs is billed separately in characters" },
      warnings: soft,
    };
    P.writeJSON(path.join(d, "launch", "production-manifest.json"), manifest);
    P.updateShotlist(slug, (x) => {
      x.cut = { sha: F.fileSha(out), takes: F.takesSig(x), cuts: parts.slice(1).map((p) => +p.ps.start.toFixed(3)), at: now() };
      x.finalQc = { pass: !hard.length, problems: hard, warnings: soft, frames, duration: +(frames / fps).toFixed(3), loudness: loud, at: now() };
    });
  }
  console.log(`${P.rel(slug, out)} · ${frames} cuadros (${(frames / fps).toFixed(2)} s a ${fps} fps) · ${loud} LUFS${mode === "draft" ? " · DRAFT (no se entrega)" : ""}`);
  for (const p of problems) console.log(` - ${p}`);
  if (mode === "final") console.log(hard.length ? "QC DEL EDITOR: FALLA" : "QC DEL EDITOR: PASA. Siguiente: mira el final completo, escribe launch/quality-report.json con su sha y corre studio.mjs qc");
  return out;
}

const run = commands[cmd];
if (!run || !slug) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(run ? 1 : 0); }
try { await run(); } catch (e) { if (e instanceof F.FlowStop) { console.error(`ALTO: ${e.message}`); process.exit(2); } console.error(`ERROR: ${e.message}`); process.exit(1); }
