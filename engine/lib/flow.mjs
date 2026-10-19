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
import { missingMarks } from "./identity.mjs";
import { planCheck } from "./state.mjs";

// What each format films and how. "scenes": multi-shot generations from storyboard grids (sitcom pipeline).
// "clips": one first/last-frame generation per shot (influencer, UGC, cinematic...). "longform": loops + narration.
export const FORMATS = {
  sitcom: { kind: "scenes", label: "Sitcom" },
  "micro-drama": { kind: "scenes", label: "Micro-drama" },
  anime: { kind: "scenes", label: "Anime" },
  influencer: { kind: "clips", label: "AI influencer" },
  ugc: { kind: "clips", label: "UGC / ad" },
  podcast: { kind: "clips", label: "Podcast clip" },
  cinematic: { kind: "clips", label: "Cinematic" },
  fantasy: { kind: "clips", label: "Fantasy" },
  other: { kind: "clips", label: "Other" },
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

export function castIds(sl) {
  const ids = [...(sl.cast || []), ...(sl.shots || []).flatMap((s) => s.characters || [])];
  return [...new Set(ids)];
}

// Fingerprints: what an approval covers. Keys written by filming and evals are left out, so filming
// does not reopen the plan; changing the script, the shots or the prompts does.
const RUNTIME = new Set(["clips", "clip", "qc", "continuity", "identity", "jumps", "evals", "queue", "queueNote", "plate"]);
const strip = (o) => JSON.parse(JSON.stringify(o ?? null, (k, v) => (RUNTIME.has(k) ? undefined : v)));
export const FINGERPRINT = {
  series: (sl) => sha(sl.series ? (() => { try { return fs.readFileSync(path.join(P.PROJECTS, "..", "series", sl.series, "series.json"), "utf8"); } catch { return null; } })() : null),
  concept: (sl) => sha(fs.existsSync(path.join(dir(sl), "concept.md")) ? fs.readFileSync(path.join(dir(sl), "concept.md"), "utf8") : null),
  script: (sl) => sha(kindOf(sl) === "longform" ? sl.longform?.script : (sl.shots || []).map((s) => (s.dialogue || []).map((l) => [l.char, l.text]))),
  cast: (sl) => sha(castIds(sl).map((id) => [id, P.character(id).look, P.character(id).voice?.eleven ?? null])),
  book: (sl) => sha({ shots: strip(sl.shots), scenes: strip(sl.scenes), longform: strip(sl.longform), estimate: sl.bookEstimate, model: sl.defaults?.videoModel, res: sl.defaults?.res }),
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
    if (![...(c.refs || []), ...(c.sheets || []), P.characterLook(c, sl.style)?.sheet].filter(Boolean).some((f) => fs.existsSync(path.join(d, f)))) bad.push(`${id}: sin model sheet ni referencia`);
  }
  return bad.length ? no(bad.join("; ")) : ok(ids.join(", "));
}

function radioCheck(sl) {
  return sl.radio?.pass ? ok(`radio cut ${sl.radio.length ?? ""} s`) : no(sl.radio ? `ritmo: ${(sl.radio.problems || []).join("; ")}` : "sin radio cut (radio.mjs)");
}

function boardCheck(sl) {
  const k = kindOf(sl), bad = [];
  if (k === "scenes") {
    for (const sc of sl.scenes || []) if (!exists(sl, sc.grid)) bad.push(`escena ${sc.id} sin storyboard`);
    if (!(sl.scenes || []).length) bad.push("sin escenas");
    const pc = planCheck(sl);
    if (pc.problems.length) bad.push(`plan de continuidad: ${pc.problems.join("; ")}`);
    for (const sc of sl.scenes || []) {
      try { const pr = P.scenePrompt(sl, sc, P.sceneRefs(sl, sc)); const miss = missingMarks(typeof pr === "string" ? pr : JSON.stringify(pr), P.sceneCast(sl, sc)); if (miss.length) bad.push(`prompt de ${sc.id} sin ${miss.join(", ")}`); } catch {}
    }
    if (!fs.existsSync(path.join(dir(sl), "out", "animatic.mp4"))) bad.push("sin animatic (animatic.mjs)");
  } else if (k === "clips") {
    if (!(sl.shots || []).length) bad.push("sin shots");
    for (const s of sl.shots || []) {
      const from = /^@(\w+):last$/.exec(s.frame || "");
      if (from) { const k = sl.shots.findIndex((x) => x.id === from[1]); if (k < 0 || k >= sl.shots.indexOf(s)) bad.push(`${s.id}: abre en ${from[1]}, que no es un shot anterior`); }
      else if (!exists(sl, s.frame)) bad.push(`${s.id}: sin cuadro inicial`);
      if (s.last && !exists(sl, s.last)) bad.push(`${s.id}: falta el cuadro final ${s.last}`);
      if (!s.prompt?.trim()) bad.push(`${s.id}: sin prompt`);
      else { const miss = missingMarks(s.prompt, s.characters || castIds(sl)); if (miss.length) bad.push(`${s.id}: el prompt omite ${miss.join(", ")}`); }
      if (!s.duration) bad.push(`${s.id}: sin duración`);
    }
  }
  return bad.length ? no(bad.join("; ")) : ok("storyboard y prompts revisados");
}

// Live price analysis: fresh (7 days at most) and its pick is the model the book estimates and the film uses.
function modelsCheck(sl) {
  const pc = sl.priceCheck;
  if (!pc) return no("sin análisis de precios en vivo (studio.mjs prices)");
  if ((Date.now() - Date.parse(pc.at)) / 864e5 > 7) return no(`el análisis de precios tiene más de 7 días (${pc.at.slice(0, 10)}); vuelve a correrlo`);
  const want = kindOf(sl) === "longform" ? sl.longform?.videoModel : sl.defaults?.videoModel;
  if (want !== pc.pick?.key) return no(`el modelo del proyecto (${want}) no es el elegido en el análisis (${pc.pick?.key})`);
  return ok(`${pc.pick.label} ${pc.pick.res} · $${pc.pick.usd} en vivo (${pc.at.slice(0, 10)})`);
}

function bookCheck(sl) {
  if (!fs.existsSync(path.join(dir(sl), "book", "index.html"))) return no("sin Production Book (book.mjs)");
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
    for (const s of sl.shots || []) if (!takeOk(s.clips?.[s.clip])) bad.push(`${s.id}: sin toma que pase identidad, saltos y diálogo`);
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
  if (!fs.existsSync(f)) return no(`sin corte final (${kindOf(sl) === "scenes" ? "edit.mjs" : kindOf(sl) === "clips" ? "cut.mjs" : "longform.mjs build"})`);
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

// who: "creator" = his approval, "auto" = checks only.
export const STEPS = {
  intake: { name: "Intake", who: "auto", check: intakeCheck, next: "studio.mjs new (las 7 preguntas)" },
  series: { name: "Biblia de la serie", who: "creator", check: (sl) => (fs.existsSync(path.join(P.PROJECTS, "..", "series", sl.series || "-", "series.json")) ? ok() : no("sin series.json")), next: "studio.mjs series new, luego approve series" },
  concept: { name: "Concepto", who: "creator", check: (sl) => (fs.existsSync(path.join(dir(sl), "concept.md")) ? ok() : no("sin concept.md")), next: "escribe concept.md, luego approve concept" },
  script: { name: "Guion", who: "creator", check: (sl) => (kindOf(sl) === "longform" ? ((sl.longform?.script || []).length || sl.longform?.voiceFree ? ok() : no("sin guion")) : (sl.shots || []).length ? ok() : no("sin shots ni diálogo")), next: "escribe el guion en la shotlist, luego approve script" },
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
  const c = S.check(sl);
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
