// Project, bible and ledger I/O, plus prompt assembly from the bible.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

export const PROJECTS = path.join(ROOT, "projects");
export const BIBLE = path.join(ROOT, "bible");

export const readJSON = (f, d) => {
  let raw;
  try { raw = fs.readFileSync(f, "utf8"); } catch (e) { if (e.code === "ENOENT") return d; throw e; }
  try { return JSON.parse(raw); } catch (e) { throw new Error(`corrupt JSON in ${path.relative(ROOT, f)}: ${e.message}`); }
};
// Write to a temp file and rename, so a crash mid-write never leaves a half-written ledger or shotlist.
export const writeJSON = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, f);
};

export function projectDir(slug) {
  const d = path.join(PROJECTS, slug);
  if (!fs.existsSync(path.join(d, "shotlist.json"))) throw new Error(`no project "${slug}" (missing ${d}\\shotlist.json)`);
  return d;
}
export const loadShotlist = (slug) => readJSON(path.join(projectDir(slug), "shotlist.json"));
export const saveShotlist = (slug, sl) => writeJSON(path.join(PROJECTS, slug, "shotlist.json"), sl);

// Re-read, mutate, write: keeps edits from the board and from parallel jobs from clobbering each other.
export function updateShotlist(slug, fn) {
  const sl = loadShotlist(slug);
  fn(sl);
  saveShotlist(slug, sl);
  return sl;
}

export function shot(sl, id) {
  const s = sl.shots.find((x) => x.id === id);
  if (!s) throw new Error(`no shot "${id}". Shots: ${sl.shots.map((x) => x.id).join(", ")}`);
  return s;
}

// ------------------------------------------------------------- ledger ----
export function ledger(slug, entry) {
  const f = slug ? path.join(PROJECTS, slug, "ledger.json") : path.join(ROOT, ".cache", "ledger-adhoc.json");
  const l = readJSON(f, []);
  l.push({ at: new Date().toISOString(), ...entry });
  writeJSON(f, l);
}
export function ledgerTotal(slug) {
  const l = readJSON(path.join(PROJECTS, slug, "ledger.json"), []);
  return l.reduce((n, e) => n + (e.ok ? e.credits || 0 : 0), 0);
}

// -------------------------------------------------------------- bible ----
export function character(id) {
  const d = path.join(BIBLE, "characters", id);
  const c = readJSON(path.join(d, "character.json"), null);
  if (!c) throw new Error(`no character "${id}" in bible/characters`);
  return { ...c, dir: d };
}
export function set(id) {
  const d = path.join(BIBLE, "sets", id);
  const s = readJSON(path.join(d, "set.json"), null);
  if (!s) throw new Error(`no set "${id}" in bible/sets`);
  return { ...s, dir: d };
}

// Style sheets live in bible/styles/<id>/style.json (legacy: bible/styles/<id>.json).
export function style(id) {
  if (!id) return { id: "none", look: "", negative: "", kind: "realistic" };
  const dir = path.join(BIBLE, "styles", id);
  const s = readJSON(path.join(dir, "style.json"), null) || readJSON(path.join(BIBLE, "styles", `${id}.json`), null);
  if (!s) throw new Error(`no style "${id}" in bible/styles (create one: node engine/style.mjs new ${id} --from <template>)`);
  return { kind: "realistic", ...s, look: s.look ?? s.style ?? "", dir };
}
export const styleOf = (sl, s) => style((s && s.style) || sl.style);

// A character's look in a given style: its approved in-style sheet split into angle views.
export function characterLook(c, styleId) {
  const lk = c.looks?.[styleId];
  return { status: lk?.status || "missing", views: lk?.views || {}, sheet: lk?.sheet, look: lk?.look || c.look, dir: c.dir };
}

const existing = (dir, files = []) => files.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));

// Which angle views a shot needs, from its framing words.
function viewsFor(s, views) {
  const f = `${s.framing || ""} ${s.image || ""}`.toLowerCase();
  const want = /close-?up|\bcu\b|\bmcu\b/.test(f) ? ["front", "threeQuarter"]
    : /profile|side view/.test(f) ? ["profile", "front"]
    : /from behind|back view/.test(f) ? ["back", "threeQuarter"]
    : /wide|full|establishing/.test(f) ? ["full", "front"]
    : ["front", "threeQuarter"];
  return want.map((v) => views[v]).filter(Boolean);
}

// Reference images for a shot: its approved storyboard frame (composition), each character's
// in-style angle views, then the set plate.
export function shotRefs(sl, s, { withBoard = false } = {}) {
  const refs = [];
  const st = styleOf(sl, s);
  if (withBoard && s.board?.file) refs.push(abs(sl.slug, s.board.file));
  for (const id of s.characters || []) {
    const c = character(id);
    const lk = characterLook(c, st.id);
    const v = viewsFor(s, lk.views);
    // Fallbacks for characters without an in-style sheet yet (older projects).
    refs.push(...(v.length ? existing(c.dir, v) : existing(c.dir, c.refs || c.sheets || ["sheet.png"]).slice(0, 1)));
  }
  const setId = s.set || sl.set;
  const stSet = setId ? set(setId) : null;
  // A set's own useAsRef wins (a plate already in the target look); otherwise the style decides.
  if (stSet && (stSet.useAsRef ?? st.setRef !== false)) {
    refs.push(...existing(stSet.dir, s.plate ? [s.plate] : stSet.plates || []).slice(0, 1));
  }
  return refs;
}

// Image (keyframe) prompt: style look + framing + the shot's picture + who and where + style rules.
export function imagePrompt(sl, s, { withBoard = false } = {}) {
  const st = styleOf(sl, s);
  const cast = (s.characters || []).map((id) => {
    const c = character(id);
    return `${c.name}: ${characterLook(c, st.id).look}`;
  });
  const setId = s.set || sl.set;
  const where = setId ? set(setId).look : "";
  const realistic = st.kind === "realistic";
  return [
    st.look,
    withBoard && s.board?.file ? "The first reference is the approved storyboard frame: keep its exact composition, staging and framing." : "",
    `${s.framing || "medium shot"}, ${s.lens || "35mm lens"}.`,
    s.image,
    cast.length ? `Characters (same individuals as their reference images): ${cast.join(" | ")}.` : "",
    // Realistic styles: re-photograph characters inside the scene; never paste the reference in.
    cast.length && realistic ? "Photograph every character for real inside this scene: same light direction, softness and color as the room, real shadows, the same texture on fur, skin and fabric as the background, realistic size relative to the furniture. Do not paste or composite the reference photos." : "",
    cast.length && !realistic ? "Draw every character exactly on-model in this style: same proportions, line weight, colors and costume details as their references." : "",
    where ? `Location (match the set reference): ${where}.` : "",
    st.imageRules || "",
    `${sl.ar === "16:9" ? "Horizontal 16:9" : sl.ar === "1:1" ? "Square 1:1" : "Vertical 9:16"} frame, single image (not a collage). No text, no captions, no watermark.`,
    st.negative ? `Avoid: ${st.negative}.` : "",
  ].filter(Boolean).join(" ");
}

// Motion prompt: camera + action + the exact spoken lines ("the prompt is the script").
export function motionPrompt(sl, s, { voiceRefs = [], refMode = false } = {}) {
  const st = styleOf(sl, s);
  const lang = sl.lang === "es" ? "Mexican Spanish" : "English";
  const parts = [
    refMode ? "@image1 is the opening frame: start exactly on it. The other images are character and set references." : "",
    s.camera ? `Camera: ${s.camera}.` : "Camera: locked off.",
    // Video models drift and invent new rooms unless told very plainly to keep the camera still.
    !s.camera || /locked|static|tripod/i.test(s.camera)
      ? "The camera is on a locked tripod and does not move at all: no pan, no zoom, no push-in, no dolly. The background and room stay exactly as in the first frame for the whole shot; nothing new enters the frame unless described."
      : "Keep the same location as the first frame; reveal nothing that isn't already in the set.",
    s.motion,
  ];
  const lines = s.dialogue || [];
  if (lines.length) {
    parts.push(`Dialogue, spoken in ${lang}, lip-synced:`);
    for (const l of lines) {
      const c = character(l.char);
      const vi = voiceRefs.indexOf(l.char);
      const voice = vi >= 0 ? ` (voice of @audio${vi + 1})` : c.voiceDesc ? ` (${c.voiceDesc})` : "";
      parts.push(`${c.name}${voice}${l.delivery ? `, ${l.delivery}` : ""}: "${l.text}"`);
    }
  } else if (s.audioMode !== "silent") parts.push("No dialogue.");
  if (s.sfx) parts.push(`Sound: ${s.sfx}.`);
  if (st.motion) parts.push(st.motion);
  parts.push("Keep faces, wardrobe and set identical to the references. No subtitles, no on-screen text, no music.");
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------- scenes ----
// A scene = several shots generated together. Storyboard: one grid image per scene (all panels
// in one generation, so blocking and identity stay locked). Video: one multi-shot generation per
// scene, so the model keeps positions, props and screen sides across its own cuts.
export function scene(sl, id) {
  const sc = (sl.scenes || []).find((x) => x.id === id);
  if (!sc) throw new Error(`no scene "${id}". Scenes: ${(sl.scenes || []).map((x) => x.id).join(", ")}`);
  return sc;
}
export const findItem = (sl, id) => (sl.scenes || []).find((x) => x.id === id) || shot(sl, id);
export const sceneShots = (sl, sc) => sc.shots.map((id) => shot(sl, id));
export const sceneCast = (sl, sc) => [...new Set(sceneShots(sl, sc).flatMap((s) => s.characters || []))];

// Grid layout for n vertical panels and the nearest image aspect ratio the image models support.
// A shot's length in the video prompt: the radio cut's duration in half seconds, 1–8 s.
export const shotSecs = (s) => Math.max(1, Math.min(8, Math.round((s.duration || 3) * 2) / 2));
// A scene's generation length: whole seconds, at least 4 (Seedance) and at most 15.
export const sceneSecs = (shots) => Math.max(4, Math.min(15, Math.ceil(shots.reduce((n, s) => n + shotSecs(s), 0))));

export function gridLayout(n) {
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const ratio = (cols * 9) / (rows * 16);
  const options = { "9:16": 9 / 16, "3:4": 3 / 4, "4:5": 4 / 5, "1:1": 1, "5:4": 5 / 4, "4:3": 4 / 3, "3:2": 3 / 2, "16:9": 16 / 9 };
  const ar = Object.entries(options).sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0][0];
  return { cols, rows, ar };
}
const POS = (k, cols, rows) => {
  const r = Math.floor(k / cols), c = k % cols;
  const vr = rows === 1 ? "" : r === 0 ? "top" : r === rows - 1 ? "bottom" : "middle";
  const hc = cols === 1 ? "" : c === 0 ? "left" : c === cols - 1 ? "right" : "center";
  return [vr, hc].filter(Boolean).join("-") || "single";
};

// The references a scene uses, in order. Image 1.. = character views, then the set plate.
export function sceneRefs(sl, sc) {
  const st = styleOf(sl);
  const out = [];
  for (const id of sceneCast(sl, sc)) {
    const c = character(id);
    const v = characterLook(c, st.id).views;
    const f = [v.front, v.threeQuarter].filter(Boolean).map((x) => path.join(c.dir, x)).find((x) => fs.existsSync(x))
      || existing(c.dir, c.refs || c.sheets || ["sheet.png"])[0];
    if (f) out.push({ role: "character", id, name: c.name, look: characterLook(c, st.id).look, file: f });
  }
  const setId = sc.set || sl.set;
  if (setId) {
    const s = set(setId);
    const plate = existing(s.dir, s.plates || [])[0];
    if (plate) out.push({ role: "set", id: setId, name: s.name || setId, look: s.look, file: plate });
  }
  return out;
}

export function boardGridPrompt(sl, sc, refs) {
  const st = styleOf(sl);
  const shots = sceneShots(sl, sc);
  const { cols, rows } = gridLayout(shots.length);
  const lock = refs.map((r, i) => r.role === "set" ? `the location is reference image ${i + 1} (${r.look})` : `${r.name} is reference image ${i + 1} (${r.look})`).join("; ");
  return [
    st.look,
    `A film storyboard sheet: a ${cols}x${rows} grid of ${shots.length} consecutive frames from ONE continuous scene, read left to right, top to bottom.`,
    `Identity and place locks for every panel: ${lock}.`,
    `Blocking that never changes between panels: ${sc.blocking}.`,
    seatLock(sc),
    sc.lighting ? `Lighting lock for every panel, overriding any other light description: ${sc.lighting}.` : "",
    "Every panel has the same characters, wardrobe, set, lighting and screen sides; characters only move when the panel says so.",
    ...shots.map((s, k) => `Panel ${k + 1} (${POS(k, cols, rows)}): ${s.framing || "medium shot"}, ${s.lens || "35mm lens"}. ${s.image} ${partnerNote(sc, s, sl)} ${moveNote(s)}`),
    st.kind === "realistic" ? "Each panel looks like a real frame grab: subjects lit by the room's light, real shadows, real sizes; nothing pasted in." : "Characters on-model in every panel.",
    st.imageRules || "",
    "Each panel is a vertical 9:16 frame. Thin white gutters between panels. No text, no numbers, no captions, no speech bubbles.",
  ].filter(Boolean).join(" ");
}

// Wan 3.0 multi-shot prompt (Alibaba's formula: overall + numbered, timestamped shots + locks).
// Removes the style's own light words ("flat bright overhead soundstage lighting") when a scene locks its lighting.
const stripLight = (look) => look.replace(/[^,.:]*\b(lighting|lit|daylight|sunlight)\b[^,.]*[,.]?/gi, "").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ");

// Seat lock + dirty singles (without it, characters drift to the floor and singles show an empty cushion).
// sc.seats = { cat: { place: "the LEFT cushion of the plaid couch", side: "left" }, ... }
// Where everyone is at the START of a shot: scene seats, then every earlier shot's moves (see lib/state.mjs).
export function placesAt(sl, shotId) {
  let st = {};
  for (const sc of sl.scenes || []) {
    st = { ...st, ...(sc.seats || {}) };
    for (const sid of sc.shots) {
      if (sid === shotId) return st;
      const s = sl.shots.find((x) => x.id === sid);
      for (const [id, m] of Object.entries(s?.moves || {})) st = { ...st, [id]: { place: m.to, side: m.side || st[id]?.side } };
    }
  }
  return st;
}
const onCouch = (p) => /couch|sofa/i.test(p?.place || "");
export function seatLock(sc) {
  if (!sc.seats) return "";
  return "PLACE LOCK for every shot, wides included, unless a shot below says someone moves: " + Object.entries(sc.seats).map(([id, s]) =>
    onCouch(s) ? `${character(id).name} sits ON ${s.place} (frame ${s.side.toUpperCase()}), body on the seat, never on the floor, never standing` : `${character(id).name} is at ${s.place} (frame ${String(s.side).toUpperCase()})`).join("; ") + ".";
}
// Dirty singles: a single on someone sharing the couch keeps the partner's edge in frame, on the partner's side.
export function partnerNote(sc, s, sl) {
  if ((s.characters || []).length !== 1) return "";
  const st = sl ? placesAt(sl, s.id) : sc.seats || {};
  const me = s.characters[0];
  if (!onCouch(st[me])) return "";
  const others = Object.entries(st).filter(([id, p]) => id !== me && onCouch(p));
  if (!others.length) return `${character(me).name} is alone on the couch now.`;
  return "Dirty single: " + others.map(([id, o]) => `the soft edge of ${character(id).name} (fur, ear or shoulder) stays visible at the very ${String(o.side).toUpperCase()} edge of the frame, still sitting on the couch`).join("; ") + "; the seat beside " + character(me).name + " is never empty.";
}
// A shot's own moves, written into its action so the model shows the movement.
export const moveNote = (s) => Object.entries(s.moves || {}).map(([id, m]) => `${character(id).name} ${m.how}, ending on ${m.to}.`).join(" ");

export function scenePrompt(sl, sc, refs, { voiceRefs = [] } = {}) {
  const st = styleOf(sl);
  const lang = sl.lang === "es" ? "Mexican Spanish" : "English";
  const shots = sceneShots(sl, sc);
  // Image 1 is the opening storyboard panel; reference images follow from Image 2.
  const bind = refs.map((r, i) => r.role === "set" ? `Location: Image ${i + 2}.` : `${r.name}: Image ${i + 2} (${r.look}).`).join(" ");
  const voices = voiceRefs.map((v, i) => `${character(v).name}'s voice timbre: reference Audio ${i + 1}.`).join(" ");
  let t = 0;
  const body = shots.map((s, k) => {
    const d = shotSecs(s);
    const head = `Shot ${k + 1} [${t}-${t + d}s]:`;
    t += d;
    const cam = s.camera && !/locked|static|tripod/i.test(s.camera) ? s.camera : "fixed camera on a tripod, no camera movement";
    const lines = (s.dialogue || []).map((l) => `${character(l.char).name}${l.delivery ? ` (${l.delivery})` : ""} says: "${l.text}" Lip sync.`).join(" ");
    // Per-shot light reminder: close-ups are where Wan drifts back to the style's default daylight.
    const light = sc.lighting ? `Same lighting as Shot 1${/night/i.test(sc.lighting) ? "; any window in frame shows dark night outside, never daylight" : ""}.` : "";
    // shot.continuous: no cut — the camera keeps rolling on the previous framing (stops the model inventing a new angle).
    return [head, k ? (s.continuous ? "NO CUT: the camera keeps rolling on exactly the same framing and angle as the previous shot." : "Hard cut.") : "", `${s.framing || "medium shot"}, ${s.lens || "35mm lens"}, ${cam}.`, partnerNote(sc, s, sl), s.motion, moveNote(s), lines || "No dialogue.", light, s.sfx ? `Sound: ${s.sfx}.` : ""].filter(Boolean).join(" ");
  });
  return [
    // A scene lighting lock removes the style's own light words (e.g. "flat bright overhead soundstage lighting") so they can't compete.
    `Overall: ${sc.summary || sl.title}. ${sc.lighting ? stripLight(st.look) : st.look}`,
    `Image 1 is the opening frame of Shot 1: match its composition, blocking and lighting exactly. ${bind}`,
    `Continuity locks for the whole scene: ${sc.blocking}. Characters keep their positions, posture, props and screen sides across every cut unless a shot says they move.`,
    // A scene's own lighting beats the style's default light (e.g. night in a "bright sitcom" style).
    seatLock(sc),
    sc.lighting ? `LIGHTING LOCK, overrides any other light description: ${sc.lighting}. The lighting, time of day and color temperature are identical in every shot of this scene.` : "",
    voices,
    `All dialogue is spoken in ${lang}.`,
    ...body,
    st.motion || "",
    sc.lighting ? `Reminder: ${sc.lighting}; the light never changes.` : "",
    "No character position changes. No costume changes. No scale drift. No lighting or time-of-day changes. No new people or animals. No subtitles, no on-screen text. No background music.",
  ].filter(Boolean).join("\n");
}

export function voiceSamples(sl, s) {
  const lang = sl.lang || "en";
  const out = [];
  for (const l of s.dialogue || []) {
    if (out.find((o) => o.char === l.char)) continue;
    const c = character(l.char);
    const f = c.voice?.sample?.[lang] && path.join(c.dir, c.voice.sample[lang]);
    if (f && fs.existsSync(f)) out.push({ char: l.char, file: f });
  }
  return out.slice(0, 3);
}

export const rel = (slug, f) => path.relative(path.join(PROJECTS, slug), f).replace(/\\/g, "/");
export const abs = (slug, f) => path.join(PROJECTS, slug, f);
