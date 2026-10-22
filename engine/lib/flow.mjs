// Flow v5 (2026-10-19). One ordered recipe of steps per format, the same for every project.
// Every engine command calls requireStep() before it runs: a step can't start until every step before it is done.
//  - the creator's steps are done only when approved with his own words recorded (studio.mjs approve --said "...").
//    An approval is tied to a fingerprint of what he approved; changing it afterwards reopens the step.
//  - Automatic steps are done only when their checks pass on the files as they are now.
//  - There is no legacy bypass and no --force. The one exception is `studio.mjs override`, which needs the creator's
//    words, is logged, and is printed in the Production Book.
// Why: a real project with no `phases` skipped every gate, nothing ran the continuity eval, and the
// creator caught a face change themselves.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as P from "./project.mjs";
import { meditationRules, intentOf } from "./meditation.mjs";
import { missingMarks, castOf } from "./identity.mjs";
import { planCheck } from "./state.mjs";
import * as L from "./launch.mjs";
import * as MS from "./modelsheet.mjs";

// What each format films and how. "scenes": multi-shot generations from storyboard grids (sitcom pipeline).
// "clips": one first/last-frame generation per shot (influencer, UGC, cinematic...). "longform": loops + narration.
export const FORMATS = {
  sitcom: { kind: "scenes", label: "Sitcom" },
  "micro-drama": { kind: "scenes", label: "Micro-drama", needsScore: true },
  anime: { kind: "scenes", label: "Anime", needsScore: true },
  influencer: { kind: "clips", label: "AI influencer" },
  ugc: { kind: "clips", label: "UGC / ad" },
  podcast: { kind: "clips", label: "Podcast clip" },
  cinematic: { kind: "clips", label: "Cinematic", editMissing: "a music score and sound design (cut.mjs mixes only the takes' sound and an ambience bed)" },
  fantasy: { kind: "clips", label: "Fantasy", editMissing: "a music score and sound design (cut.mjs mixes only the takes' sound and an ambience bed)" },
  other: { kind: "clips", label: "Other" },
  // Product launch films (2026-10-21): the creative director's brief, concepts, timecoded plan and style bible gate
  // every step (lib/launch.mjs); shots are generated, stills or deterministic cards; launch.mjs composites the film.
  launch: { kind: "clips", label: "Product launch film" },
  meditation: { kind: "longform", label: "Meditation / long-form" },
};

// The intake (Phase 0). Every answer is required; the project does not exist without all of them.
export const INTAKE = [
  { id: "series", q: "¿Video individual o serie?", options: ["single", "episode", "new"] },
  { id: "format", q: "¿Qué tipo de video?", options: Object.keys(FORMATS) },
  { id: "start", q: "¿Tienes una idea o empezamos desde cero?", options: ["script", "idea", "scratch"] },
  { id: "platform", q: "¿Dónde se publica y en qué medida?", fields: ["platform", "ar", "seconds", "lang"] },
  { id: "cast", q: "¿Quién sale en pantalla?", options: ["existing", "new", "self", "mixed", "none"] },
  { id: "budget", q: "¿Cuál es el techo de gasto?", fields: ["mode", "usd"] },
  { id: "refs", q: "¿Referencias o tono?", fields: ["text"] },
];

export const kindOf = (sl) => FORMATS[sl.format]?.kind || "scenes";
const sha = (v) => crypto.createHash("sha1").update(typeof v === "string" ? v : JSON.stringify(v ?? null)).digest("hex").slice(0, 12);
export const fileSha = (f) => (fs.existsSync(f) ? crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex") : null);
const dir = (sl) => P.projectDir(sl.slug);
const exists = (sl, f) => !!f && fs.existsSync(path.isAbsolute(f) ? f : path.join(dir(sl), f));
export const finalFile = (sl) => path.join(dir(sl), "out", `${sl.slug}.mp4`);
// Launch films mix generated shots with stills and cards the editor draws: only "generate" shots are filmed.
export const films = (s) => !s.source || s.source === "generate";
const launchFile = (sl, k) => { const f = path.join(dir(sl), "launch", L.FILES[k]); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null; };
const launchJSON = (sl, k) => { const t = launchFile(sl, k); try { return t ? JSON.parse(t) : null; } catch { return null; } };

export function castIds(sl) {
  // A launch film's shots are generated from the plan (launch.mjs apply), so the cast is the project's list (the style
  // bible's characters); a stale shotlist from before a cast change must not count.
  if (sl.format === "launch") return [...new Set(sl.cast || [])];
  const ids = [...(sl.cast || []), ...(sl.shots || []).flatMap((s) => s.characters || [])];
  return [...new Set(ids)];
}

// Fingerprints: what an approval covers. Keys written by filming and evals are left out, so filming
// does not reopen the plan; changing the script, the shots or the prompts does.
const RUNTIME = new Set(["cleanPatch", "clips", "clip", "qc", "continuity", "identity", "jumps", "evals", "queue", "queueNote", "qcFlag", "plate", "cutOut", "retime", "splice", "in", "muteOut", "cues", "motionScore"]); // cutOut: an edit decision on a filmed take, not a change to the approved plan
const strip = (o) => JSON.parse(JSON.stringify(o ?? null, (k, v) => (RUNTIME.has(k) ? undefined : v)));
export const FINGERPRINT = {
  // The series bible without its own approval stamp (approving writes `approved` into series.json, 2026-10-19),
  // the voice profiles (approved at the cast gate) and the episode list (grows every episode).
  series: (sl) => sha(sl.series ? (() => { try { const { approved, voices, episodes, ...bible } = JSON.parse(fs.readFileSync(path.join(P.PROJECTS, "..", "series", sl.series, "series.json"), "utf8")); return JSON.stringify(bible); } catch { return null; } })() : null),
  // A launch film's concept is its brief and concepts too; its script is the whole timecoded plan (voice-over and
  // on-screen text are the script); its cast includes the style bible and the narrator's voice.
  concept: (sl) => sha([fs.existsSync(path.join(dir(sl), "concept.md")) ? fs.readFileSync(path.join(dir(sl), "concept.md"), "utf8") : null, ...(sl.format === "launch" ? [launchFile(sl, "brief"), launchFile(sl, "concepts")] : [])]),
  script: (sl) => sha(sl.format === "launch" ? launchFile(sl, "plan") : kindOf(sl) === "longform" ? sl.longform?.script : (sl.shots || []).map((s) => (s.dialogue || []).map((l) => [l.char, l.text]))),
  cast: (sl) => sha([castIds(sl).map((id) => [id, P.character(id).look, P.character(id).voice?.eleven ?? null]), ...(sl.format === "launch" ? [launchFile(sl, "style"), sl.launch?.voice ?? null] : [])]),
  book: (sl) => sha({ shots: strip(sl.shots), scenes: strip(sl.scenes), longform: strip(sl.longform), estimate: sl.bookEstimate, model: sl.defaults?.videoModel, res: sl.defaults?.res, ...(sl.angles ? { angles: sl.angles } : {}), ...(sl.format === "launch" ? { plan: launchFile(sl, "plan"), style: launchFile(sl, "style") } : {}) }),
  retro: () => "retro",
};

// ---- checks for each step: { ok, detail }
const ok = (detail = "") => ({ ok: true, detail });
const no = (detail) => ({ ok: false, detail });

function intakeCheck(sl) {
  const a = sl.intake || {};
  const missing = INTAKE.filter((q) => a[q.id] == null).map((q) => q.id);
  if (missing.length) return no(`intake incompleto: ${missing.join(", ")}`);
  if (a.series !== "single" && !sl.series) return no("el intake dice serie pero el proyecto no tiene serie");
  return ok(`${FORMATS[sl.format]?.label} · ${a.series}`);
}

function castCheck(sl) {
  if (sl.format !== "launch") return castCheckChars(sl);
  // Launch films: the style bible is valid and its files exist, the narrator has a voice, any characters pass the
  // usual cast gate, and the visual identity is locked: one key image of the world, approved in the creator's words.
  const bad = [...L.styleRules(launchJSON(sl, "style"), { slug: sl.slug, cast: castIds(sl) })];
  if (launchJSON(sl, "concepts")?.config?.voiceover && !sl.launch?.voice?.eleven) bad.push("la película lleva voz en off y el narrador no tiene voz (sl.launch.voice.eleven)");
  if (castIds(sl).length) { const c = castCheckChars(sl); if (!c.ok) bad.push(c.detail); }
  if (!(sl.lookTest?.said && fs.existsSync(path.join(dir(sl), sl.lookTest.file || "-")))) bad.push('falta fijar la identidad visual: una imagen clave del mundo en el estilo (gen.mjs still --project), aprobada con studio.mjs approve-look <slug> --file <imagen> --said "..."');
  return bad.length ? no(bad.join("; ")) : ok(`style bible "${launchJSON(sl, "style").name}" fijado`);
}

function castCheckChars(sl) {
  if (kindOf(sl) === "longform") {
    const v = sl.longform?.voice;
    const speaks = (sl.longform?.script || []).some((s) => s.text?.trim());
    return speaks && !v?.eleven ? no("falta la voz de la narración (longform.voice.eleven)") : ok(speaks ? `voz ${v.eleven}` : "sin voz");
  }
  const ids = castIds(sl);
  if (!ids.length) return sl.intake?.cast === "none" ? ok("sin personajes") : no("ningún personaje en el proyecto (shotlist.cast)");
  const speaking = new Set((sl.shots || []).flatMap((s) => (s.dialogue || []).map((l) => l.char)));
  const bad = [];
  for (const id of ids) {
    let c;
    try { c = P.character(id); } catch { bad.push(`${id}: no existe en la biblia`); continue; }
    if (!c.look?.trim()) bad.push(`${id}: sin look escrito`);
    const approved = c.approved || P.characterLook(c, sl.style)?.status === "approved";
    if (!approved) bad.push(`${id}: ficha sin aprobar (studio.mjs approve-character ${id} --said "...")`);
    if (speaking.has(id) && !c.voice?.eleven) bad.push(`${id}: habla y no tiene voz`);
    const d = path.join(P.BIBLE, "characters", id);
    if (![...(c.refs || []), ...(c.sheets || []), P.characterLook(c, sl.style)?.sheet, P.characterLook(c, sl.style)?.modelSheet].filter(Boolean).some((f) => fs.existsSync(path.join(d, f)))) bad.push(`${id}: sin model sheet ni referencia`);
    // STANDARD SHEET (the creator, 2026-10-21): every project created from today, any vertical, needs one standard sheet per
    // character in the project's style (cast.mjs model-sheet), and a character is one character, never a group.
    if ((sl.flow?.created || "") >= "2026-10-21" && c.species !== "set") {
      if (MS.isGroup(c.look)) bad.push(`${id}: su look describe a varios personajes; una ficha, un personaje (sepáralos en la biblia)`);
      else if (!MS.hasStandard(c, sl.style)) bad.push(`${id}: sin ficha estándar en el estilo ${sl.style} (cast.mjs model-sheet ${id} --style ${sl.style})`);
    }
  }
  // LOOK TEST (2026-10-19, a past drama: the realism problem was only seen after the video money was spent). A drama's
  // cast is complete only when the creator approved, in his words, one still of the leads in the set at the episode's light,
  // before any storyboard or video: studio.mjs approve-look <slug> --file <image> --said "...".
  if (FORMATS[sl.format]?.needsScore && !(sl.lookTest?.said && fs.existsSync(path.join(dir(sl), sl.lookTest.file || "-")))) bad.push('falta la prueba de look: una foto de los protagonistas en el set con la luz del episodio (gen.mjs still --project), aprobada con studio.mjs approve-look <slug> --file <imagen> --said "..."');
  return bad.length ? no(bad.join("; ")) : ok(ids.join(", "));
}

function radioCheck(sl) {
  return sl.radio?.pass ? ok(`radio cut ${sl.radio.length ?? ""} s`) : no(sl.radio ? `ritmo: ${(sl.radio.problems || []).join("; ")}` : "sin radio cut (radio.mjs)");
}

// DRAMA RULES (2026-10-19, after a past drama and a past drama: two rejected episodes; rules from AI micro-drama
// production research and our own realistic wins, The Glow Up and Two Suitcases). What reliably works with today's
// video models, enforced before the book so no money goes to a plan that can't come out realistic:
//  - at most 2 characters in any shot, at most 3 shots per generation, one action per shot;
//  - lines fit their shot at ~3 words a second (lip sync breaks on long lines);
//  - no fine hand-object work or fast motion on screen (show the object already held; imply motion with cuts);
//  - bright, natural light (daylight, window light, bright practicals): night, candles, neon and low key read as
//    "AI" and "shady"; sl.lowLightOk (the creator's call) allows it.
const HANDS = /\b(slides?|sliding|places?|placing|picks? up|picking up|pours?|pouring|taps? (?:her|his|the) glass|hands? (?:her|him|it|over)|snatch|tears?|tearing|rips?|ripping|signs?|signing|writes?|writing|types?|typing|ties?|buttons?)\b/i;
const FAST = /\b(runs?|running|sprints?|jumps?|leaps?|slams?|fights?|punch|slaps?|throws?|falls?|chases?)\b(?! (?:the|a|an|this|that|his|her|their) (?:con|show|game|plan|company|business|risk|numbers))/i;
const DARK = /\b(night|candle|candlelit|neon|moonlit|dark room|low[- ]key|shadows?)\b/i;
export function dramaRules(sl) {
  if (sl.format === "sitcom") return [];
  const out = [];
  for (const sc of sl.scenes || []) {
    const shots = P.sceneShots(sl, sc);
    if (shots.length > 3) out.push(`escena ${sc.id}: ${shots.length} planos en una generación (máximo 3)`);
    if (!sl.lowLightOk && DARK.test(`${sc.lighting || ""} ${sc.summary || ""}`)) out.push(`escena ${sc.id}: luz baja o de noche (se ve "IA"); usa luz natural brillante, o sl.lowLightOk con la palabra del creador`);
    for (const s of shots) {
      const inFrame = (s.inFrame || s.characters || []).length;
      if (inFrame > 2) out.push(`${s.id}: ${inFrame} personajes en cuadro (máximo 2; usa plano/contraplano)`);
      const words = (s.dialogue || []).reduce((n, l) => n + l.text.split(/\s+/).length, 0);
      if (words > Math.max(4, Math.floor(P.shotSecs(s) * 3))) out.push(`${s.id}: ${words} palabras en ${P.shotSecs(s)} s (máximo ~3 por segundo)`);
      if (HANDS.test(s.motion || "")) out.push(`${s.id}: acción con manos y objetos ("${(s.motion.match(HANDS) || [])[0]}"), falla seguido: muestra el objeto ya en la mano y corta`);
      if (FAST.test(s.motion || "")) out.push(`${s.id}: movimiento rápido ("${(s.motion.match(FAST) || [])[0]}"), falla seguido: sugiérelo con cortes`);
      // Cut rhythm: a spoken shot runs at most 6 s, a silent reaction at most 2.5 s (held to its peak, not past it).
      const speaks = (s.dialogue || []).length > 0;
      if (speaks && P.shotSecs(s) > 6) out.push(`${s.id}: plano hablado de ${P.shotSecs(s)} s (máximo 6; divídelo en plano/contraplano)`);
      if (!speaks && P.shotSecs(s) > 2.5) out.push(`${s.id}: reacción de ${P.shotSecs(s)} s (máximo 2.5; corta en el pico)`);
      // Empty mood words give the model nothing to film and push the glossy "AI" look.
      const vague = `${s.image || ""} ${s.motion || ""}`.match(VAGUE);
      if (vague) out.push(`${s.id}: palabra vacía "${vague[0]}" en la descripción (usa verbos y detalles concretos)`);
      // Eye-level camera on dialogue: extreme angles are where faces drift.
      if (speaks && EXTREME.test(`${s.framing || ""} ${s.camera || ""}`)) out.push(`${s.id}: ángulo extremo en un plano con diálogo (mantén la cámara a la altura de los ojos)`);
    }
    // Dialogue filmed one shot per generation re-invents the voice, light and gestures every shot (a past drama with Kling).
    if (sl.filmBy === "shot" && !sl.filmByShotOk && shots.filter((s) => (s.dialogue || []).length).length > 1) out.push(`escena ${sc.id}: varios planos con diálogo filmados uno por uno (la voz y la luz cambian entre planos); fílmala como una sola generación multi-plano`);
  }
  // The hook: the first line is heard by 3 s, and the episode never opens on an establishing shot.
  let t = 0;
  for (const s of (sl.scenes || []).flatMap((sc) => P.sceneShots(sl, sc))) { if ((s.dialogue || []).length) break; t += P.shotSecs(s); }
  if (t > 3) out.push(`el primer diálogo llega a los ${t} s (el conflicto tiene que oírse antes de 3 s)`);
  const first = P.sceneShots(sl, (sl.scenes || [])[0] || { shots: [] })[0];
  if (first && /establishing/i.test(`${first.framing || ""} ${first.image || ""}`)) out.push(`${first.id}: el episodio abre con un plano de ubicación (abre en el conflicto)`);
  // Length (measured on the radio cut): within 20% of the length the creator asked for in the intake, never under 15 s or
  // over 90 s (AI episodes hold up best short). Without an intake length: 25-90 s.
  const want = sl.intake?.platform?.seconds;
  const [lo, hi] = want ? [Math.max(15, want * 0.8), Math.min(90, want * 1.25)] : [25, 90];
  if (sl.radio?.length && (sl.radio.length < lo || sl.radio.length > hi)) out.push(`episodio de ${sl.radio.length} s en el radio cut (rango ${Math.round(lo)}-${Math.round(hi)} s${want ? `, pedido ${want} s` : ""})`);
  return out;
}
const VAGUE = /\b(cinematic|stunning|epic|8k|4k|masterpiece|breathtaking|gorgeous|award[- ]winning|ultra[- ]realistic|hyper[- ]detailed)\b/i;
const EXTREME = /\b(low[- ]angle|high[- ]angle|overhead|bird'?s[- ]eye|worm'?s[- ]eye|dutch)\b/i;

function boardCheck(sl) {
  const k = kindOf(sl), bad = [];
  if (k === "scenes") {
    for (const sc of sl.scenes || []) if (!exists(sl, sc.grid)) bad.push(`escena ${sc.id} sin storyboard`);
    // One locked close-up angle per person with singles in more than one scene, made before the grids
    // (2026-10-20, a past drama: the doctor's background changed in every scene).
    const angles = P.anglesNeeded(sl);
    for (const id of angles) if (!fs.existsSync(P.angleFile(sl, id) || "")) bad.push(`${P.character(id).name} sin plano de ángulo fijo para sus close-ups (gen.mjs angles)`);
    if (angles.length && angles.every((id) => fs.existsSync(P.angleFile(sl, id) || "")))
      for (const sc of sl.scenes || []) if (sc.grid && sc.gridAngles !== JSON.stringify(sl.angles || {})) bad.push(`storyboard de la escena ${sc.id} hecho sin los planos de ángulo actuales (gen.mjs storyboard --scenes ${sc.id})`);
    if (!(sl.scenes || []).length) bad.push("sin escenas");
    const pc = planCheck(sl);
    if (pc.problems.length) bad.push(`plan de continuidad: ${pc.problems.join("; ")}`);
    for (const sc of sl.scenes || []) {
      // Marks are checked on the same cast job() checks at filming: the scene's cast plus anyone its prompt names.
      try { const pr = P.scenePrompt(sl, sc, P.sceneRefs(sl, sc)); const prText = typeof pr === "string" ? pr : JSON.stringify(pr); const miss = missingMarks(prText, [...new Set([...P.sceneCast(sl, sc), ...castOf(sl, prText)])]); if (miss.length) bad.push(`prompt de ${sc.id} sin ${miss.join(", ")}`); } catch {}
      // REFERENCE CHECK (2026-10-19, a character's gown changed color twice, $2.52): every character in a scene must reach
      // the model with a face view AND a full-body view (the wardrobe), or the book can't be built.
      try {
        const refs = P.sceneRefs(sl, sc);
        for (const id of P.sceneCast(sl, sc)) {
          const mine = refs.filter((r) => r.id === id);
          if (!mine.length) bad.push(`escena ${sc.id}: ${id} no lleva ninguna imagen de referencia`);
          else if (!mine.some((r) => /full body/.test(r.name))) bad.push(`escena ${sc.id}: ${id} no lleva su vista de cuerpo completo (vestuario); genera su hoja con cast.mjs sheet`);
        }
      } catch (e) { bad.push(`escena ${sc.id}: referencias: ${e.message}`); }
    }
    if (!fs.existsSync(path.join(dir(sl), "out", "animatic.mp4"))) bad.push("sin animatic (animatic.mjs)");
    bad.push(...dramaRules(sl));
  } else if (k === "clips") {
    if (!(sl.shots || []).length) bad.push("sin shots");
    if (sl.format === "launch") bad.push(...launchBoard(sl));
    for (const s of sl.shots || []) {
      if (s.source === "card") continue;
      const from = /^@(\w+):last$/.exec(s.frame || "");
      if (from) { const k = sl.shots.findIndex((x) => x.id === from[1]); if (k < 0 || k >= sl.shots.indexOf(s)) bad.push(`${s.id}: abre en ${from[1]}, que no es un shot anterior`); }
      else if (!exists(sl, s.frame)) bad.push(`${s.id}: sin cuadro inicial`);
      if (s.last && !exists(sl, s.last)) bad.push(`${s.id}: falta el cuadro final ${s.last}`);
      if (s.lastPrompt && !s.last) bad.push(`${s.id}: sin cuadro final coreografiado (gen.mjs frame ${sl.slug} ${s.id} last --planned)`);
      if (!films(s)) continue;
      if (!s.prompt?.trim()) bad.push(`${s.id}: sin prompt`);
      else {
        // The prompt checked is the one the model receives (P.clipPrompt: the shot's prompt plus its script).
        try {
          const pr = P.clipPrompt(sl, s);
          const miss = missingMarks(pr, s.characters || castIds(sl));
          if (miss.length) bad.push(`${s.id}: el prompt omite ${miss.join(", ")}`);
          const gone = P.linesMissing(pr, s.dialogue || []);
          if (gone.length) bad.push(`${s.id}: el prompt omite el diálogo ${gone.map((l) => `"${l.text}"`).join(", ")}`);
        } catch (e) { bad.push(`${s.id}: ${e.message}`); } // e.g. a character not in the bible yet: report it, don't crash status
      }
      if (!s.duration) bad.push(`${s.id}: sin duración`);
    }
  }
  return bad.length ? no(bad.join("; ")) : ok("storyboard y prompts revisados");
}

// Launch films before the book: the plan still passes, the shotlist is the plan applied (launch.mjs apply), every
// voice-over line was recorded and fits its shot, and the animatic was built from the current frames and voice.
function launchBoard(sl) {
  const plan = launchJSON(sl, "plan");
  const bad = L.planRules(plan, { brief: launchJSON(sl, "brief"), concepts: launchJSON(sl, "concepts"), style: launchJSON(sl, "style"), reference: launchJSON(sl, "reference") });
  if (!plan) return bad;
  if (sl.launch?.applied !== sha(launchFile(sl, "plan"))) bad.push("la shotlist no es el plan actual (launch.mjs apply)");
  for (const s of plan.shots || []) if (s.vo) {
    const v = sl.launch?.vo?.[s.id];
    if (!v || v.text !== s.vo || !fs.existsSync(path.join(dir(sl), v.file || "-"))) bad.push(`${s.id}: voz en off sin grabar (launch.mjs voice)`);
    else if (v.secs > v.room + 0.05) bad.push(`${s.id}: la voz dura ${v.secs} s y solo cabe en ${v.room} s; acorta la línea`);
  }
  // The narration, measured on the recorded lines: no silence over 1.2 s between lines, and voice over most of the film.
  if (launchJSON(sl, "concepts")?.config?.voiceover) {
    const said = (plan.shots || []).filter((s) => s.vo && sl.launch?.vo?.[s.id]).map((s) => ({ id: s.id, a: s.start + (s.voAt ?? 0.15), b: s.start + (s.voAt ?? 0.15) + sl.launch.vo[s.id].secs }));
    for (let i = 1; i < said.length; i++) if (said[i].a - said[i - 1].b > 1.2) bad.push(`${said[i].id}: ${(said[i].a - said[i - 1].b).toFixed(1)} s de silencio antes de su línea (máximo 1.2 s; la narración no se detiene)`);
    const cover = said.length ? (said.at(-1).b - said[0].a) / plan.durationSeconds : 0;
    if (said.length && cover < 0.75) bad.push(`la narración cubre ${Math.round(cover * 100)} % de la película (mínimo 75 %; Town: 98 %)`);
  }
  // Real footage inside a still: the files exist, and the frame has a green screen for each clip (detected by the
  // animatic on this exact frame).
  for (const s of sl.shots || []) if (s.inserts?.length) {
    for (const i of s.inserts) if (!fs.existsSync(path.isAbsolute(i.file) ? i.file : path.join(dir(sl), i.file))) bad.push(`${s.id}: no existe el footage ${i.file}`);
    const sc = sl.launch?.screens?.[s.id];
    if (s.frame && sc?.frame === s.frame && sc.boxes.length < s.inserts.length) bad.push(`${s.id}: el cuadro tiene ${sc.boxes.length} pantallas verdes y lleva ${s.inserts.length} clips; rehaz el cuadro`);
  }
  const an = sl.launch?.animatic;
  if (!an || !fs.existsSync(path.join(dir(sl), "out", "animatic.mp4")) || an.sig !== launchSig(sl)) bad.push("sin animatic del plan actual (launch.mjs animatic)");
  // The creator watched the storyboard animatic of this exact plan before any frame was paid for (2026-10-22).
  if (sl.launch?.animaticApproved?.plan !== planSha(sl)) bad.push("el creador no aprobó el animatic de este plan (launch.mjs animatic <slug> --approve --said \"...\")");
  // ...and again once every frame is drawn: the creator sees every frame before prices and the book.
  else if ((sl.shots || []).every((s) => s.frame) && sl.launch?.animaticApproved?.sig !== launchSig(sl)) bad.push("el creador no ha visto el animatic con los cuadros dibujados (launch.mjs animatic <slug> --approve --said \"...\")");
  return bad;
}
// What the animatic shows: the plan, the frames and the recorded voice. Changing any of them asks for a new one.
export const launchSig = (sl) => sha([launchFile(sl, "plan"), launchFile(sl, "style"), (sl.shots || []).map((s) => [s.id, s.frame || null]), sl.launch?.vo || null, sl.launch?.screens || null]);
export const planSha = (sl) => sha(launchFile(sl, "plan"));

// FORMAT READINESS (2026-10-19, a past drama): a format whose editor can't finish it (a drama with no score,
// no stings, no swell) was filmed anyway and came out as a dry, unusable cut. A format with `editMissing` stops here,
// before the prices and the book, until the editor can do it. No spend on a video the engine can't finish.
export const editReady = (sl) => !FORMATS[sl.format]?.editMissing;

// Live price analysis: fresh (7 days at most) and its pick is the model the book estimates and the film uses.
function modelsCheck(sl) {
  if (!editReady(sl)) return no(`FORMAT NOT READY: the ${FORMATS[sl.format].label} editor can't make ${FORMATS[sl.format].editMissing}. Build that in the engine before any spend.`);
  // A drama is planned with its sound before any spend: the score prompt, at least one sting on a power shift
  // (line.cue) and the ending sting on the freeze (sl.endCue).
  if (FORMATS[sl.format]?.needsScore) {
    const cues = (sl.shots || []).flatMap((s) => (s.dialogue || []).filter((l) => l.cue));
    const miss = [!sl.music?.prompt && "the score (sl.music.prompt)", !cues.length && "a sting on a power shift (line.cue + sl.cues)", !(sl.endCue && sl.cues?.[sl.endCue]) && "the ending sting (sl.endCue)"].filter(Boolean);
    if (miss.length) return no(`SOUND NOT PLANNED: ${miss.join(", ")}`);
  }
  const pc = sl.priceCheck;
  if (!pc) return no("sin análisis de precios en vivo (studio.mjs prices)");
  if ((Date.now() - Date.parse(pc.at)) / 864e5 > 7) return no(`el análisis de precios tiene más de 7 días (${pc.at.slice(0, 10)}); vuelve a correrlo`);
  const want = kindOf(sl) === "longform" ? sl.longform?.videoModel : sl.defaults?.videoModel;
  if (want !== pc.pick?.key) return no(`el modelo del proyecto (${want}) no es el elegido en el análisis (${pc.pick?.key})`);
  return ok(`${pc.pick.label} ${pc.pick.res} · $${pc.pick.usd} en vivo (${pc.at.slice(0, 10)})`);
}

function bookCheck(sl) {
  if (!fs.existsSync(path.join(dir(sl), "book", "index.html"))) return no("sin Production Book (book.mjs)");
  // A launch film tests the chosen video model on one shot before the book (2026-10-22): the creator picks the model
  // with the video in front of them, or waives the test in their words.
  if (sl.format === "launch" && !sl.launch?.motionTestWaived?.said && !(sl.shots || []).some((s) => (s.clips || []).some((c) => c.test && c.model === sl.defaults?.videoModel)))
    return no(`sin prueba de movimiento con ${sl.defaults?.videoModel || "el modelo elegido"} (gen.mjs clip <slug> --shot <id> --test --model <k> --said "...", o launch.mjs waive-test <slug> --said "...")`);
  if (sl.bookEstimate == null) return no("el book no tiene estimado de costo");
  return ok(`estimado ${sl.bookEstimate} cr`);
}

// A take of a clips project is usable only when every eval on it passed.
export const evalsPass = (t) => !!t && t.evals?.identity?.pass === true && t.evals?.jumps?.internal === 0 && t.evals?.dialogue?.pass === true;
// A take that failed an eval is usable only when the creator accepted that exact take (studio.mjs accept-take).
export const takeOk = (t) => evalsPass(t) || !!t?.accepted?.said;

function filmCheck(sl) {
  const k = kindOf(sl), bad = [];
  if (k === "scenes") {
    if (!(sl.scenes || []).length) bad.push("sin escenas");
    for (const sc of sl.scenes || []) {
      const t = sc.clips?.[sc.clip];
      if (!t) bad.push(`escena ${sc.id} sin toma elegida`);
      else if (!t.qc?.pass) bad.push(`escena ${sc.id}: QC no pasó`);
      else if (!t.continuity?.pass) bad.push(`escena ${sc.id}: continuidad no pasó`);
    }
  } else if (k === "clips") {
    if (!(sl.shots || []).length) bad.push("sin shots");
    for (const s of (sl.shots || []).filter(films)) if (!takeOk(s.clips?.[s.clip])) bad.push(`${s.id}: sin toma que pase identidad, saltos y diálogo`);
    if (sl.format === "launch") {
      const plan = launchJSON(sl, "plan");
      if (launchJSON(sl, "concepts")?.config?.music && !(sl.music?.files || []).length) bad.push("sin música (gen.mjs music)");
      for (const n of Object.keys(plan?.sfx || {})) if (!fs.existsSync(path.join(dir(sl), "audio", `sfx-${n}.mp3`))) bad.push(`sin el efecto ${n} (gen.mjs sfx)`);
    }
  } else {
    const L = sl.longform || {};
    if ((L.script || []).some((s, i) => s.text?.trim() && !fs.existsSync(path.join(dir(sl), "audio", "vo", `${String(i + 1).padStart(3, "0")}.mp3`)))) bad.push("narración incompleta");
    if (L.music?.prompt && !(L.music.files || []).length) bad.push("sin música");
    for (const sc of L.scenes || []) if (!exists(sl, sc.image) || (sc.motion !== "kenburns" && !exists(sl, sc.clip))) bad.push(`escena ${sc.id} sin loop`);
  }
  return bad.length ? no(bad.join("; ")) : ok("todas las tomas pasan sus evals");
}

export const takesSig = (sl) => sha(kindOf(sl) === "scenes" ? (sl.scenes || []).map((sc) => sc.clips?.[sc.clip]?.file) : kindOf(sl) === "clips" ? (sl.shots || []).map((s) => s.clips?.[s.clip]?.file) : (sl.longform?.scenes || []).map((s) => s.clip || s.image));

function editCheck(sl) {
  const f = finalFile(sl);
  if (!fs.existsSync(f)) return no(`sin corte final (${kindOf(sl) === "scenes" ? "edit.mjs" : sl.format === "launch" ? "launch.mjs build" : kindOf(sl) === "clips" ? "cut.mjs" : "longform.mjs build"})`);
  if (sl.cut?.sha !== fileSha(f)) return no("el corte final no lo hizo el motor o cambió después");
  if (sl.cut?.takes !== takesSig(sl)) return no("el corte usa tomas distintas de las aprobadas; vuelve a cortar");
  return ok(path.basename(f));
}

function qcCheck(sl) {
  const q = sl.finalQc5;
  if (!q) return no("sin QC del final (studio.mjs qc)");
  if (q.sha !== fileSha(finalFile(sl))) return no("el QC es de otra versión del final; vuelve a correrlo");
  return q.pass ? ok("QC del final pasó") : no(`QC del final: ${q.issues.join("; ")}`);
}

function deliverCheck(sl) {
  const f = path.join(dir(sl), "delivery.json");
  if (!fs.existsSync(f)) return no("sin recibo de entrega (studio.mjs deliver)");
  const r = P.readJSON(f);
  return r.sha === fileSha(finalFile(sl)) ? ok(`entregado ${r.at.slice(0, 10)}`) : no("el recibo no coincide con el archivo final");
}

const approvedNow = (sl, id) => {
  const a = sl.flow?.approved?.[id];
  if (!a) return no("espera la aprobación del creador");
  if (FINGERPRINT[id] && a.fp !== FINGERPRINT[id](sl)) return no("cambió después de aprobarse; necesita aprobarse de nuevo");
  return ok(`aprobado: "${a.said}"`);
};
const both = (...rs) => rs.find((r) => !r.ok) || ok(rs.map((r) => r.detail).filter(Boolean).join(" · "));

function launchConcept(sl) {
  const c = launchJSON(sl, "concepts");
  const bad = [...L.briefRules(launchJSON(sl, "brief")), ...L.conceptRules(c, launchJSON(sl, "brief"))];
  return bad.length ? no(bad.join("; ")) : ok(`concepto ${c.selected} de ${c.concepts.length}`);
}
function launchScript(sl) {
  const plan = launchJSON(sl, "plan");
  const bad = L.planRules(plan, { brief: launchJSON(sl, "brief"), concepts: launchJSON(sl, "concepts"), style: launchJSON(sl, "style"), reference: launchJSON(sl, "reference") });
  return bad.length ? no(bad.join("; ")) : ok(`${plan.shots.length} tomas · ${plan.durationSeconds} s`);
}

// who: "creator" = his approval, "auto" = checks only.
export const STEPS = {
  intake: { name: "Intake", who: "auto", check: intakeCheck, next: "studio.mjs new (las 7 preguntas)" },
  series: { name: "Biblia de la serie", who: "creator", check: (sl) => (fs.existsSync(path.join(P.PROJECTS, "..", "series", sl.series || "-", "series.json")) ? ok() : no("sin series.json")), next: "studio.mjs series new, luego approve series" },
  concept: { name: "Concepto", who: "creator", check: (sl) => (!fs.existsSync(path.join(dir(sl), "concept.md")) ? no("sin concept.md") : sl.format === "launch" ? launchConcept(sl) : ok()), next: "escribe concept.md (launch: también launch/brief.json y launch/concepts.json; launch.mjs check), luego approve concept" },
  // Meditations: the intention's rules (pace, pauses, voice share, music tempo, picture, safety) block the script
  // gate (2026-10-20: one universal engine for guided meditations, the intention only changes the numbers).
  script: { name: "Guion", who: "creator", check: (sl) => (kindOf(sl) === "longform" ? (!((sl.longform?.script || []).length || sl.longform?.voiceFree) ? no("sin guion") : meditationRules(sl).length ? no(meditationRules(sl).join("; ")) : ok(intentOf(sl).label)) : sl.format === "launch" ? launchScript(sl) : (sl.shots || []).length ? ok() : no("sin shots ni diálogo")), next: "escribe el guion en la shotlist, luego approve script" },
  cast: { name: "Casting y sets", who: "creator", check: castCheck, next: "cast.mjs sheet / approve-character, luego approve cast" },
  radio: { name: "Radio cut", who: "auto", check: radioCheck, next: "radio.mjs" },
  board: { name: "Storyboard y prompts", who: "auto", check: boardCheck, next: "gen.mjs storyboard + animatic.mjs (escenas) o gen.mjs frame (clips)" },
  models: { name: "Precios en vivo", who: "auto", check: modelsCheck, next: "studio.mjs prices <slug> (analiza Kie en vivo y elige el mejor modelo para la calidad y el costo; --pick <modelo> si el creador elige otro)" },
  book: { name: "Production Book", who: "creator", check: bookCheck, next: "book.mjs, publicarlo, luego approve book (bloquea el presupuesto)" },
  film: { name: "Filmación", who: "auto", check: filmCheck, next: "gen.mjs scenes | clip --shot | narration/bed/loops" },
  edit: { name: "Edición", who: "auto", check: editCheck, next: "edit.mjs | cut.mjs | longform.mjs build" },
  qc: { name: "QC del final", who: "auto", check: qcCheck, next: "studio.mjs qc" },
  deliver: { name: "Entrega", who: "auto", check: deliverCheck, next: "studio.mjs deliver" },
  retro: { name: "Retro", who: "creator", check: () => ok(), next: "studio.mjs approve retro --said \"...\" --notes \"...\"" },
};

export function recipe(sl) {
  const k = kindOf(sl);
  return [
    "intake",
    ...(sl.intake?.series === "new" ? ["series"] : []),
    "concept", "script", "cast",
    ...(k === "scenes" ? ["radio"] : []),
    ...(k === "longform" ? [] : ["board"]),
    "models", "book", "film", "edit", "qc", "deliver", "retro",
  ];
}

export function stepStatus(sl, id) {
  const S = STEPS[id];
  const ov = sl.flow?.overrides?.find((o) => o.step === id && o.fp === (FINGERPRINT[id] ? FINGERPRINT[id](sl) : o.fp));
  if (ov) return { ok: true, detail: `OVERRIDE: "${ov.said}" (${ov.reason})`, override: true };
  // A check that throws (a cast member not in the bible yet, a missing file) is a step that isn't ready, not a crash.
  let c;
  try { c = S.check(sl); } catch (e) { c = no(e.message); }
  return S.who === "creator" ? both(c, approvedNow(sl, id)) : c;
}

export function status(sl) {
  const steps = recipe(sl).map((id) => ({ id, ...STEPS[id], ...stepStatus(sl, id) }));
  const current = steps.find((s) => !s.ok) || null;
  return { steps, current };
}

export class FlowStop extends Error {}

export function assertV5(sl) {
  if (!sl?.flow?.v) throw new FlowStop(`${sl?.slug || "este proyecto"} no es un proyecto del flujo v5. Créalo con: node engine/studio.mjs new`);
  if (sl.flow.archived) throw new FlowStop(`${sl.slug} está archivado (solo lectura): ${sl.flow.archived}`);
}

// The gate every command calls. `step` is the step the command belongs to.
export function requireStep(sl, step, what = step) {
  assertV5(sl);
  const r = recipe(sl);
  if (!r.includes(step)) throw new FlowStop(`"${what}" no forma parte de la receta de ${FORMATS[sl.format]?.label || sl.format}`);
  for (const id of r.slice(0, r.indexOf(step))) {
    const s = stepStatus(sl, id);
    if (!s.ok) throw new FlowStop(`"${what}" pertenece al paso "${STEPS[step].name}", pero antes falta "${STEPS[id].name}": ${s.detail}.\nSiguiente: ${STEPS[id].next}\nEstado: node engine/studio.mjs status ${sl.slug}`);
  }
  // Every paid step after the book needs the budget the book locked.
  if (r.indexOf(step) >= r.indexOf("film") && sl.budget?.approvedCredits == null) throw new FlowStop(`"${what}": no hay presupuesto aprobado (se fija al aprobar el Production Book)`);
}

// PILOT GATE (2026-10-19, a past drama: six scenes were filmed at once on a model never used in production;
// the timing, the sound and a wardrobe bug only showed up after every credit was spent). After the book, only the
// first scene (scenes formats) or first shot (clips formats) can be filmed. the creator watches it and approves it in his
// words (studio.mjs approve-pilot) before anything else is filmed. A bad pilot costs one scene, not the episode.
// Clips formats: the first shot that is filmed (a launch film can open on a still or a card, which never is).
export const pilotId = (sl) => (kindOf(sl) === "scenes" ? sl.scenes?.[0]?.id : kindOf(sl) === "clips" ? (sl.shots || []).find(films)?.id : null);
export function requirePilot(sl, ids) {
  // The pilot is approved for one video model: switching models (Wan to Kling) re-arms the gate.
  const ok = sl.flow?.approved?.pilot && (sl.flow.approved.pilot.model ?? null) === (sl.defaults?.videoModel ?? null);
  if (kindOf(sl) === "longform" || ok) return;
  const p = pilotId(sl), rest = ids.filter((i) => i !== p);
  if (rest.length) throw new FlowStop(`PILOT STOP: film the pilot first (${p}), show it to the creator and record his yes: studio.mjs approve-pilot ${sl.slug} --said "..." . Only then ${rest.join(", ")}.`);
}
export function approvePilot(slug, said) {
  if (!said?.trim()) throw new FlowStop('approve-pilot necesita las palabras exactas del creador: --said "..."');
  return P.updateShotlist(slug, (sl) => {
    assertV5(sl);
    const id = pilotId(sl), item = (sl.scenes || []).find((x) => x.id === id) || (sl.shots || []).find((x) => x.id === id);
    if (!item?.clips?.length) throw new FlowStop(`el piloto ${id} todavía no está filmado`);
    sl.flow.approved ||= {};
    sl.flow.approved.pilot = { said: said.trim(), at: new Date().toISOString(), item: id, take: (item.clip ?? item.clips.length - 1) + 1, model: sl.defaults?.videoModel ?? null };
    sl.flow.log = [...(sl.flow.log || []), { at: new Date().toISOString(), event: `approve pilot ${id}`, said: said.trim() }];
  });
}

export function approve(slug, id, said, extra = {}) {
  if (!said?.trim()) throw new FlowStop('approve necesita las palabras exactas del creador: --said "..."');
  return P.updateShotlist(slug, (sl) => {
    assertV5(sl);
    const S = STEPS[id];
    if (!S || S.who !== "creator") throw new FlowStop(`"${id}" no es un paso que el creador aprueba (${Object.keys(STEPS).filter((k) => STEPS[k].who === "creator").join(", ")})`);
    const r = recipe(sl);
    if (!r.includes(id)) throw new FlowStop(`"${id}" no está en la receta de este proyecto`);
    for (const p of r.slice(0, r.indexOf(id))) { const s = stepStatus(sl, p); if (!s.ok) throw new FlowStop(`antes de aprobar "${S.name}" falta "${STEPS[p].name}": ${s.detail}`); }
    const c = S.check(sl);
    if (!c.ok) throw new FlowStop(`"${S.name}" no está listo para aprobarse: ${c.detail}`);
    sl.flow.approved ||= {};
    sl.flow.approved[id] = { said: said.trim(), at: new Date().toISOString(), fp: FINGERPRINT[id] ? FINGERPRINT[id](sl) : null, ...extra };
    sl.flow.log = [...(sl.flow.log || []), { at: new Date().toISOString(), event: `approve ${id}`, said: said.trim() }];
    if (id === "book") {
      const spent = P.ledgerTotal(slug);
      const hard = sl.intake?.budget?.mode === "fixed" && sl.intake.budget.usd ? sl.intake.budget.usd / 0.005 : null;
      if (hard != null && spent + sl.bookEstimate > hard) throw new FlowStop(`el book (gastado ${(spent * 0.005).toFixed(2)} + estimado ${(sl.bookEstimate * 0.005).toFixed(2)}) pasa el tope fijo de ${sl.intake.budget.usd}: baja el modelo, la resolución o la duración`);
      sl.budget = { approvedCredits: Math.ceil(spent + sl.bookEstimate), approvedAt: new Date().toISOString(), history: [{ add: sl.bookEstimate, note: `Production Book aprobado: "${said.trim()}"` }] };
    }
  });
}

export function override(slug, step, said, reason) {
  if (!said?.trim() || !reason?.trim()) throw new FlowStop('override necesita --said "palabras exactas del creador" y --reason "por qué"');
  return P.updateShotlist(slug, (sl) => {
    assertV5(sl);
    if (!STEPS[step]) throw new FlowStop(`paso desconocido: ${step}`);
    const o = { step, said: said.trim(), reason: reason.trim(), at: new Date().toISOString(), fp: FINGERPRINT[step] ? FINGERPRINT[step](sl) : "manual" };
    sl.flow.overrides = [...(sl.flow.overrides || []), o];
    sl.flow.log = [...(sl.flow.log || []), { at: o.at, event: `override ${step}`, said: o.said, reason: o.reason }];
  });
}
