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

// The script travels word for word in every speaking prompt (2026-10-19, The Glow Up: gen clip sent only the
// visual prompt, so Seedance improvised its lines and a paid take was lost). Match ignores case, spacing,
// quote styles and escapes, so a line inside a JSON prompt still counts.
const normLine = (t) => String(t || "").toLowerCase().replace(/\\/g, "").replace(/[“”"‘’`']/g, "'").replace(/…/g, "...").replace(/\s+/g, " ").trim();
export const linesMissing = (prompt, lines = []) => {
  const p = normLine(typeof prompt === "string" ? prompt : JSON.stringify(prompt));
  return lines.filter((l) => l.text?.trim() && !p.includes(normLine(l.text)));
};

// Clips formats: the shot's prompt plus every spoken line of the script, verbatim and at a natural pace
// (Creador: "que no hable tan rápido"). A prompt that already quotes every line is sent as written.
export function clipPrompt(sl, s) {
  const base = (s.prompt || "").trim();
  const lines = (s.dialogue || []).filter((l) => l.text?.trim());
  if (!lines.length) return s.audioMode === "silent" || /no dialogue/i.test(base) ? base : `${base} No dialogue: nobody speaks.`;
  if (!linesMissing(base, lines).length) return base;
  const lang = sl.lang === "es" ? "Mexican Spanish" : "English";
  const said = lines.map((l) => `${character(l.char).name}${l.delivery ? ` (${l.delivery})` : ""}: "${l.text}"`).join(" ");
  return `${base} Dialogue, spoken in ${lang}, lip-synced, at a calm natural pace (about 140-160 words per minute) with small natural pauses, never rushed. Say exactly these words, word for word, nothing added, nothing left out, no improvising: ${said}`;
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
// The prompt for one shot of a scene filmed shot by shot (first-frame models with a prompt limit: Kling 3.0 takes
// 2,500 characters, 2026-10-19). Compact but complete: the first frame, every character's look with its marks, the
// scene light, the shot's structured spec (place, pose, props, action, dialogue word for word, must-nots), the pace.
export function shotPrompt(sl, sc, s, max = 2500) {
  const st = styleOf(sl), cast = sceneCast(sl, sc);
  const full = scenePrompt(sl, { ...sc, shots: [s.id] }, []);
  const spec = (full.match(/Shot 1 SPEC (\{.*\}) Lines, word for word:/) || [])[1] || "";
  const parts = [
    "Image 1 is the first frame: start exactly on it and keep its composition, faces, wardrobe, set and light.",
    `Characters: ${cast.map((id) => `${character(id).name}: ${characterLook(character(id), st.id).look}.`).join(" ")}`,
    `Shot: ${spec}`,
    "Spoken at a calm, natural pace with natural pauses. No subtitles, no on-screen text, no music.",
    sc.lighting ? `Light: ${sc.lighting}.` : "",
    `Look: ${String(st.look || "").split(". ")[0]}.`,
  ];
  let out = "";
  for (const p of parts.filter(Boolean)) if ((out + " " + p).trim().length <= max) out = (out + " " + p).trim();
  return out;
}

// The edit's fixes on a filmed take, as ffmpeg filter prefixes shared by edit.mjs and continuity.mjs (so a take is
// judged exactly as it is cut): sc.cutOut drops picture and sound, sc.muteOut silences sound only. Times are in the
// original take; the mute runs before the cut.
export function takeFilters(sc) {
  const rng = (r) => (r || []).map(([a, b]) => `between(t,${a},${b})`).join("+");
  const outs = rng(sc.cutOut), mutes = rng(sc.muteOut);
  return {
    vf: outs ? `select='not(${outs})',setpts=N/FRAME_RATE/TB,` : "",
    af: `${mutes ? `volume=0:enable='${mutes}',` : ""}${outs ? `aselect='not(${outs})',asetpts=N/SR/TB,` : ""}`,
  };
}
// Everyone in the scene: the characters of its shots AND everyone seated in it (sc.seats). A seated character is in
// frame in wide shots, so the model needs their marks and references (2026-10-19, a past drama: scene A named a character in
// its blocking without her references; the prompt check stopped it before any spend).
export const sceneCast = (sl, sc) => [...new Set([...sceneShots(sl, sc).flatMap((s) => s.characters || []), ...Object.keys(sc.seats || {})])];

// Grid layout for n vertical panels and the nearest image aspect ratio the image models support.
// A shot's length in the video prompt: the radio cut's duration in half seconds, 1–8 s.
export const shotSecs = (s) => Math.max(1, Math.min(8, Math.round((s.duration || 3) * 2) / 2));
// A shot's generation length when a scene is filmed shot by shot (sl.filmBy "shot"): whole seconds, never below
// the model's minimum (Veo 4 s, Kling 3 s).
export const shotGenSecs = (s, modelKey) => Math.max(String(modelKey || "").startsWith("veo") ? 4 : 3, Math.ceil(shotSecs(s)));
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
// Coverage angles (2026-10-20, a past drama "Not the Father"): every scene opened on a panel from its own storyboard grid, each
// grid drawn on its own, and the reverse angle was invented by the video model, so the doctor's close-up had a window
// in scene A, a wall of frames in B and a chair and plant in C. Outside the sitcom, every person with close-ups in
// more than one scene gets ONE locked angle frame (gen.mjs angles): the exact framing and background of all their
// close-ups, sent to every storyboard and every scene that has one of their singles.
export const singleOf = (s) => (s.characters || []).length === 1 && /close|single|\bcu\b/i.test(s.framing || "") && !/wide|two-shot|group/i.test(s.framing || "") ? s.characters[0] : null;
export function anglesNeeded(sl) {
  if (sl.format === "sitcom" || !(sl.scenes || []).length) return [];
  const scenesOf = {};
  for (const sc of sl.scenes) for (const s of sceneShots(sl, sc)) { const id = singleOf(s); if (id) (scenesOf[id] ||= new Set()).add(sc.id); }
  return Object.keys(scenesOf).filter((id) => scenesOf[id].size > 1);
}
export const angleFile = (sl, id) => sl.angles?.[id] && path.join(ROOT, sl.angles[id]);
export function anglePrompt(sl, id) {
  const st = styleOf(sl);
  const s = sl.shots.find((x) => singleOf(x) === id);
  const sc = sl.scenes.find((x) => x.shots.includes(s.id));
  const c = character(id);
  return [
    st.look,
    `ONE frame, the locked camera angle for every close-up of ${c.name} in this film: ${s.framing || "close-up"}, ${s.lens || "50mm lens"}, eye level, camera on a tripod.`,
    `${c.name}: ${characterLook(c, st.id).look}. Neutral, attentive expression, mouth closed, hands still.`,
    `The room: ${sc.blocking}`,
    seatLock(sc),
    sc.lighting ? `Lighting: ${sc.lighting}.` : "",
    partnerNote(sc, s, sl),
    "Everything behind the person is the background of every close-up of them in every scene, so make it simple, readable and specific: one wall, the window if it faces that way, at most one or two objects. Real footage look, natural skin, no text.",
  ].filter(Boolean).join("\n");
}

export function sceneRefs(sl, sc) {
  const st = styleOf(sl);
  const out = [];
  for (const id of sceneCast(sl, sc)) {
    const c = character(id);
    const v = characterLook(c, st.id).views;
    // c.refView: the sheet view sent as the face reference (one with a neutral pose: a hand on the chin in the front
    // view was copied into a shot of a past drama).
    const f = [c.refView && v[c.refView], v.front, v.threeQuarter].filter(Boolean).map((x) => path.join(c.dir, x)).find((x) => fs.existsSync(x))
      || existing(c.dir, c.refs || c.sheets || ["sheet.png"])[0];
    if (f) out.push({ role: "character", id, name: c.name, look: characterLook(c, st.id).look, file: f });
    // The full-body view too, so the wardrobe is locked when a scene opens on someone else (2026-10-19: a character's
    // black gown turned wine, then ivory, in a scene that opened on a character's close-up and only had her face).
    const full = v.full && path.join(c.dir, v.full);
    if (full && fs.existsSync(full) && full !== f) out.push({ role: "character", id, name: `${c.name} (full body, exact wardrobe)`, look: characterLook(c, st.id).look, file: full });
  }
  const singles = new Set(sceneShots(sl, sc).map(singleOf).filter(Boolean));
  for (const id of anglesNeeded(sl)) {
    const f = angleFile(sl, id);
    if (singles.has(id) && f && fs.existsSync(f)) out.push({ role: "angle", id, name: `${character(id).name}'s close-up angle`, file: f });
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
  const lock = refs.map((r, i) => r.role === "set" ? `the location is reference image ${i + 1} (${r.look})` : r.role === "angle" ? `every close-up of ${character(r.id).name} copies reference image ${i + 1} exactly: same framing size and the same background` : `${r.name} is reference image ${i + 1} (${r.look})`).join("; ");
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

// Seat lock + dirty singles (a sidekick once ended up on the floor; singles showed an empty cushion).
// sc.seats = { milo: { place: "the LEFT cushion of the plaid couch", side: "left" }, ... }
// Where everyone is at the START of a shot: scene seats, then every earlier shot's moves (see lib/state.mjs).
export function placesAt(sl, shotId) {
  let st = {};
  for (const sc of sl.scenes || []) {
    st = { ...st, ...(sc.seats || {}) };
    for (const sid of sc.shots) {
      if (sid === shotId) return st;
      const s = sl.shots.find((x) => x.id === sid);
      for (const [id, m] of Object.entries(s?.moves || {})) st = { ...st, [id]: { ...st[id], place: m.to ?? st[id]?.place, side: m.side || st[id]?.side, ...(m.pose ? { pose: m.pose } : {}), ...(m.holding !== undefined ? { holding: m.holding } : {}) } };
    }
  }
  return st;
}
const onCouch = (p) => /couch|sofa/i.test(p?.place || "");
export function seatLock(sc) {
  if (!sc.seats) return "";
  return "PLACE LOCK for every shot, wides included, unless a shot below says someone moves: " + Object.entries(sc.seats).map(([id, s]) =>
    onCouch(s) ? `${character(id).name} sits ON ${s.place} (frame ${s.side.toUpperCase()}), body on the seat, never on the floor, never standing` : `${character(id).name} is ${/^(at|on|in|beside|by|near|under|behind|next)\b/i.test(s.place) ? "" : "at "}${s.place} (frame ${String(s.side).toUpperCase()})${s.pose ? `, ${String(s.pose).toUpperCase()}` : ""}${s.holding ? `, holding ${s.holding}` : ""}`).join("; ") + ".";
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
  // With no character reference images (models that take only a first frame: Kling 3.0, Veo), every character in the
  // scene is described in words, marks included, so the look and the marks still reach the model.
  const bind = refs.map((r, i) => r.role === "set" ? `Location: Image ${i + 2}.` : r.role === "angle" ? `Image ${i + 2} is the locked camera angle for EVERY close-up of ${character(r.id).name}: the same framing size, eye level and the exact same background (wall, window, frames, plants, furniture); never show anything else behind ${character(r.id).name}.` : `${r.name}: Image ${i + 2} (${r.look}).`).join(" ")
    + (refs.some((r) => r.role === "character") ? "" : " " + sceneCast(sl, sc).map((id) => `${character(id).name}: ${characterLook(character(id), styleOf(sl).id).look}.`).join(" "));
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
    // Every format but the sitcom gets a structured spec per shot (2026-10-19, a past drama pilot: a character toasted an empty
    // table and sat down between two shots of the same moment): who is in frame, the exact place, pose and props of
    // everyone in the room at that moment, the action, the dialogue, and what must not happen.
    if (sl.format !== "sitcom") {
      const st0 = placesAt(sl, s.id), cast = sceneCast(sl, sc);
      const all = cast.map((id) => character(id).name);
      const inFrame = (s.inFrame || (/wide|two-shot|group|establishing|table|three|full/i.test(s.framing || "") ? cast : s.characters || [])).map((id) => character(id).name);
      const where = Object.fromEntries(cast.map((id) => { const p = st0[id] || {}; return [character(id).name, [p.pose && String(p.pose).toUpperCase(), p.place && (/^(at|on|in|beside|by|near|under|behind|next)\b/i.test(p.place) ? p.place : `at ${p.place}`), p.side && `frame ${String(p.side).toUpperCase()}`, p.holding && `holding ${p.holding}`].filter(Boolean).join(", ")]; }));
      const mustNot = [
        ...cast.flatMap((id) => { const p = st0[id] || {}; const n = character(id).name; return /stand/i.test(p.pose || "") && !s.moves?.[id] ? [`${n} sitting down`] : /seat|sit/i.test(p.pose || "") && !s.moves?.[id] ? [`${n} standing up`] : []; }),
        "anyone resting a chin or cheek on a hand, or touching their face, unless the action says so",
        "a character not listed here appearing, or a listed character missing from a wide shot",
        "any change of outfit, hair, jewelry or props", "on-screen text or subtitles",
        // 2026-10-20, a past drama pilot: on a "fixed camera" close-up Wan pulled back mid-shot and a ceiling and a second
        // wall frame appeared (Creador: "asegúrate de que haya consistencia en los backgrounds y en los sets").
        "the camera zooming, pulling back or drifting, or the background changing (a ceiling, extra wall frames, a different window) during the shot or from earlier shots of the same person",
      ];
      const spec = { shot: k + 1, time: head.slice(head.indexOf("[") + 1, head.indexOf("]")), cut: k ? (s.continuous ? "no cut: same framing as the previous shot" : "hard cut") : "opens on Image 1", framing: s.framing || "medium shot", lens: s.lens || "35mm lens", camera: cam, in_frame: inFrame.length ? inFrame : all, everyone_in_the_room: where, action: [s.motion, moveNote(s)].filter(Boolean).join(" "), dialogue: (s.dialogue || []).length ? s.dialogue.map((l) => ({ speaker: character(l.char).name, delivery: l.delivery || "", says_exactly: l.text, lip_sync: true })) : "none", sound: s.sfx || undefined, must_not: mustNot };
      return `Shot ${k + 1} SPEC ${JSON.stringify(spec)} Lines, word for word: ${lines || "No dialogue."}`;
    }
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
    // Wan rushed every line of a past drama (191 wpm, 2026-10-19): the pace is part of every scene prompt.
    sl.format === "sitcom" ? "" : "Every line is spoken at a calm, natural pace, about 140-160 words per minute, with a short natural pause between lines and a held beat on every reaction; never rushed, never overlapping.",
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
