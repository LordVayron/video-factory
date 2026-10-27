// Flow v5. One ordered recipe of steps per format, the same for every project.
// Every engine command calls requireStep() before it runs: a step can't start until every step before it is done.
//  - the creator's steps are done only when approved with their own words recorded (studio.mjs approve --said "...").
//    An approval is tied to a fingerprint of what they approved; changing it afterwards reopens the step.
//  - Automatic steps are done only when their checks pass on the files as they are now.
//  - There is no legacy bypass and no --force. The one exception is `studio.mjs override`, which needs the creator's
//    words, is logged, and is printed in the Production Book.
// Why: a project without the flow's state would skip every gate, and nothing would run the continuity eval.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as P from "./project.mjs";
import { meditationRules, intentOf } from "./meditation.mjs";
import { missingMarks, castOf } from "./identity.mjs";
import { planCheck } from "./state.mjs";
import * as L from "./launch.mjs";
import * as MS from "./modelsheet.mjs";
import * as RF from "./refs.mjs";
import * as PR from "./pricing.mjs";
import * as CAM from "./camera.mjs";

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
  // Product launch films: the creative director's brief, concepts, timecoded plan and style bible gate
  // every step (lib/launch.mjs); shots are generated, stills or deterministic cards; launch.mjs composites the film.
  launch: { kind: "clips", label: "Product launch film" },
  meditation: { kind: "longform", label: "Meditation / long-form" },
};

// The intake (Phase 0). Every answer is required; the project does not exist without all of them.
export const INTAKE = [
  { id: "series", q: "A single video or a series?", options: ["single", "episode", "new"] },
  { id: "format", q: "What kind of video?", options: Object.keys(FORMATS) },
  { id: "start", q: "Do you have an idea, or do we start from scratch?", options: ["script", "idea", "scratch"] },
  { id: "platform", q: "Where will it be published, and in what size?", fields: ["platform", "ar", "seconds", "lang"] },
  { id: "cast", q: "Who appears on screen?", options: ["existing", "new", "self", "mixed", "none"] },
  { id: "budget", q: "What is the spending cap?", fields: ["mode", "usd"] },
  { id: "refs", q: "References or tone?", fields: ["text"] },
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
  // The series bible without its own approval stamp (approving writes `approved` into series.json),
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
  if (a.series !== "single" && !sl.series) return no("the intake says series but the project has no series");
  return ok(`${FORMATS[sl.format]?.label} · ${a.series}`);
}

// CAMERA KIT: projects created with the camera step choose their kit in the creator's words (the format's
// recommended kit or any other, whole or in parts) when the style is photographic; every kit, part and move must be
// in the catalog, one move per shot, one bold move per film, no wide lens on a face.
export function cameraProblems(sl) {
  const st = (() => { try { return P.style(sl.style); } catch { return null; } })();
  const out = [...CAM.cameraRules(sl)];
  if (sl.cameraRequired && CAM.opticsFor({ camera: { kit: "film-cooke" } }, {}, st) && !sl.camera?.said?.trim()) out.push(`choose the camera kit in the creator's words (recommended for ${sl.format}: ${CAM.recommendedKit(sl.format) || "none"}): studio.mjs camera ${sl.slug} --kit <id> --said "..." (studio.mjs camera ${sl.slug} --list)`);
  return out;
}
function castCheck(sl) {
  const cam = cameraProblems(sl);
  if (sl.format !== "launch") { const r = castCheckChars(sl); return cam.length ? no([...(r.ok ? [] : [r.detail]), ...cam].join("; ")) : r; }
  // Launch films: the style bible is valid and its files exist, the narrator has a voice, any characters pass the
  // usual cast gate, and the visual identity is locked: one key image of the world, approved in the creator's words.
  const bad = [...L.styleRules(launchJSON(sl, "style"), { slug: sl.slug, cast: castIds(sl), plan: launchJSON(sl, "plan") }), ...cam];
  if (launchJSON(sl, "concepts")?.config?.voiceover && !sl.launch?.voice?.eleven) bad.push("the film has a voice-over and the narrator has no voice (sl.launch.voice.eleven)");
  if (castIds(sl).length) { const c = castCheckChars(sl); if (!c.ok) bad.push(c.detail); }
  if (!(sl.lookTest?.said && fs.existsSync(path.join(dir(sl), sl.lookTest.file || "-")))) bad.push('the visual identity is not locked yet: one key image of the world in the style (gen.mjs still --project), approved with studio.mjs approve-look <slug> --file <image> --said "..."');
  return bad.length ? no(bad.join("; ")) : ok(`style bible "${launchJSON(sl, "style").name}" locked`);
}

function castCheckChars(sl) {
  if (kindOf(sl) === "longform") {
    const v = sl.longform?.voice;
    const speaks = (sl.longform?.script || []).some((s) => s.text?.trim());
    return speaks && !v?.eleven ? no("the narration has no voice (longform.voice.eleven)") : ok(speaks ? `voice ${v.eleven}` : "no voice");
  }
  const ids = castIds(sl);
  if (!ids.length) return sl.intake?.cast === "none" ? ok("no characters") : no("no character in the project (shotlist.cast)");
  const speaking = new Set((sl.shots || []).flatMap((s) => (s.dialogue || []).map((l) => l.char)));
  const bad = [];
  for (const id of ids) {
    let c;
    try { c = P.character(id); } catch { bad.push(`${id}: not in the bible`); continue; }
    if (!c.look?.trim()) bad.push(`${id}: no written look`);
    const approved = c.approved || P.characterLook(c, sl.style)?.status === "approved";
    if (!approved) bad.push(`${id}: sheet not approved (studio.mjs approve-character ${id} --said "...")`);
    if (speaking.has(id) && !c.voice?.eleven) bad.push(`${id}: speaks but has no voice`);
    // LIKENESS: a character made from a real person other than the creator goes ahead on the creator's
    // statement that the person authorized it, recorded in their words (cast.mjs likeness <id> --kind real-person --said).
    if (c.likeness?.kind === "real-person" && !c.likeness.authorized?.said?.trim()) bad.push(`${id}: based on a real person; the creator's statement that the person authorized it is missing (cast.mjs likeness ${id} --kind real-person --said "...")`);
    const d = path.join(P.BIBLE, "characters", id);
    if (![...(c.refs || []), ...(c.sheets || []), P.characterLook(c, sl.style)?.sheet, P.characterLook(c, sl.style)?.modelSheet].filter(Boolean).some((f) => fs.existsSync(path.join(d, f)))) bad.push(`${id}: no model sheet or reference`);
    // STANDARD SHEET: every project created from today, any vertical, needs one standard sheet per
    // character in the project's style (cast.mjs model-sheet), and a character is one character, never a group.
    if ((sl.flow?.created || "") >= "2026-10-21" && c.species !== "set") {
      if (MS.isGroup(c.look)) bad.push(`${id}: the look describes several characters; one sheet, one character (split them in the bible)`);
      else if (!MS.hasStandard(c, sl.style)) bad.push(`${id}: no standard sheet in the ${sl.style} style (cast.mjs model-sheet ${id} --style ${sl.style})`);
    }
  }
  // LOOK TEST (a realism problem must show up before the video money is spent). A drama's
  // cast is complete only when the creator approved, in their words, one still of the leads in the set at the episode's light,
  // before any storyboard or video: studio.mjs approve-look <slug> --file <image> --said "...".
  if (FORMATS[sl.format]?.needsScore && !(sl.lookTest?.said && fs.existsSync(path.join(dir(sl), sl.lookTest.file || "-")))) bad.push('the look test is missing: one still of the leads in the set at the episode\'s light (gen.mjs still --project), approved with studio.mjs approve-look <slug> --file <image> --said "..."');
  return bad.length ? no(bad.join("; ")) : ok(ids.join(", "));
}

function radioCheck(sl) {
  return sl.radio?.pass ? ok(`radio cut ${sl.radio.length ?? ""} s`) : no(sl.radio ? `ritmo: ${(sl.radio.problems || []).join("; ")}` : "no radio cut (radio.mjs)");
}

// DRAMA RULES (from AI micro-drama production research and the productions that came out realistic). What reliably
// works with today's
// video models, enforced before the book so no money goes to a plan that can't come out realistic:
//  - at most 2 characters in any shot, at most 3 shots per generation, one action per shot;
//  - lines fit their shot at ~3 words a second (lip sync breaks on long lines);
//  - no fine hand-object work or fast motion on screen (show the object already held; imply motion with cuts);
//  - bright, natural light (daylight, window light, bright practicals): night, candles, neon and low key read as
//    "AI" and "shady"; sl.lowLightOk (the creator's call) allows it.
const HANDS = /\b(slides?|sliding|places?|placing|picks? up|picking up|pours?|pouring|taps? (?:her|his|the) glass|hands? (?:her|him|it|over)|snatch|tears?|tearing|rips?|ripping|signs?|signing|writes?|writing|types?|typing|ties?|buttons?)\b/i;
const FAST = /\b(runs?|running|sprints?|jumps?|leaps?|slams?|fights?|punch|slaps?|throws?|falls?|chases?)\b(?! (?:the|a|an|this|that|his|her|their) (?:con|show|game|plan|company|business|risk|numbers))/i;
const DARK = /\b(night|candle|candlelit|neon|moonlit|dark room|low[- ]key|shadows?)\b/i;
// SITCOM SCRIPT RULES (from the writing bible): the opening states what the lead wants, every line is a setup, a
// punchline or a tag, every scene lands at least one punchline, and nobody lists steps or phases.
const LIST_WORDS = /\b(step|phase)\s+(one|two|three|four|1|2|3|4)\b/i;
export function sitcomScriptRules(sl) {
  if (sl.format !== "sitcom" || (sl.flow?.created || "") < "2026-10-26") return [];
  const out = [], scenes = sl.scenes || [];
  if (scenes.length && (scenes[0].want || "").trim().split(/\s+/).length < 5) out.push(`scene ${scenes[0].id}: the opening must state what the lead wants (scenes[0].want, one sentence)`);
  for (const sc of scenes) {
    const lines = P.sceneShots(sl, sc).flatMap((s) => (s.dialogue || []).map((l) => ({ ...l, shot: s.id })));
    for (const l of lines) {
      if (!["setup", "punch", "tag"].includes(l.beat)) out.push(`${l.shot}: "${String(l.text).slice(0, 40)}" is not marked setup, punch or tag (every line sets up or pays off)`);
      if (LIST_WORDS.test(l.text || "")) out.push(`${l.shot}: "${String(l.text).slice(0, 40)}" lists steps or phases; say it as a want instead`);
    }
    if (lines.length && !lines.some((l) => l.beat === "punch")) out.push(`scene ${sc.id}: no punchline`);
  }
  return out;
}

export function dramaRules(sl) {
  if (sl.format === "sitcom") return [];
  // Anime keeps only the generation limits (shots per generation, words per second): night, neon, crowds, fast action
  // and long held reactions are part of its look, not photoreal-drama risks.
  const real = sl.format !== "anime";
  const out = [];
  for (const sc of sl.scenes || []) {
    const shots = P.sceneShots(sl, sc);
    if (shots.length > 3) out.push(`scene ${sc.id}: ${shots.length} shots in one generation (max 3)`);
    if (real && !sl.lowLightOk && DARK.test(`${sc.lighting || ""} ${sc.summary || ""}`)) out.push(`scene ${sc.id}: low or night light (reads as "AI"); use bright natural light, or sl.lowLightOk with the creator's word`);
    for (const s of shots) {
      const inFrame = (s.inFrame || s.characters || []).length;
      if (real && inFrame > 2) out.push(`${s.id}: ${inFrame} characters in frame (max 2; use shot/reverse shot)`);
      const words = (s.dialogue || []).reduce((n, l) => n + l.text.split(/\s+/).length, 0);
      if (words > Math.max(4, Math.floor(P.shotSecs(s) * 3))) out.push(`${s.id}: ${words} words in ${P.shotSecs(s)} s (max ~3 per second)`);
      if (real && HANDS.test(s.motion || "")) out.push(`${s.id}: hand-and-object action ("${(s.motion.match(HANDS) || [])[0]}") often fails: show the object already in hand and cut`);
      if (real && FAST.test(s.motion || "")) out.push(`${s.id}: fast motion ("${(s.motion.match(FAST) || [])[0]}") often fails: suggest it with cuts`);
      // Cut rhythm: a spoken shot runs at most 6 s, a silent reaction at most 2.5 s (held to its peak, not past it).
      const speaks = (s.dialogue || []).length > 0;
      if (speaks && P.shotSecs(s) > 6) out.push(`${s.id}: ${P.shotSecs(s)} s talking shot (max 6; split it into shot/reverse shot)`);
      if (real && !speaks && P.shotSecs(s) > 2.5) out.push(`${s.id}: ${P.shotSecs(s)} s reaction (max 2.5; cut at the peak)`);
      // Empty mood words give the model nothing to film and push the glossy "AI" look.
      const vague = `${s.image || ""} ${s.motion || ""}`.match(VAGUE);
      if (vague) out.push(`${s.id}: vague word "${vague[0]}" in the description (use concrete verbs and details)`);
      // Eye-level camera on dialogue: extreme angles are where faces drift.
      if (speaks && EXTREME.test(`${s.framing || ""} ${s.camera || ""}`)) out.push(`${s.id}: extreme angle on a dialogue shot (keep the camera at eye level)`);
    }
    // Dialogue filmed one shot per generation re-invents the voice, light and gestures every shot.
    if (sl.filmBy === "shot" && !sl.filmByShotOk && shots.filter((s) => (s.dialogue || []).length).length > 1) out.push(`scene ${sc.id}: several dialogue shots filmed one at a time (voice and light change between shots); film it as one multi-shot generation`);
  }
  // The hook: the first line is heard by 3 s, and the episode never opens on an establishing shot.
  let t = 0;
  for (const s of (sl.scenes || []).flatMap((sc) => P.sceneShots(sl, sc))) { if ((s.dialogue || []).length) break; t += P.shotSecs(s); }
  if (t > 3) out.push(`the first line comes at ${t} s (the conflict must be heard within 3 s)`);
  const first = P.sceneShots(sl, (sl.scenes || [])[0] || { shots: [] })[0];
  if (first && /establishing/i.test(`${first.framing || ""} ${first.image || ""}`)) out.push(`${first.id}: the episode opens on an establishing shot (open on the conflict)`);
  // Length (measured on the radio cut): within 20% of the length the creator asked for in the intake, never under 15 s or
  // over 90 s (AI episodes hold up best short). Without an intake length: 25-90 s.
  const want = sl.intake?.platform?.seconds;
  const [lo, hi] = want ? [Math.max(15, want * 0.8), Math.min(90, want * 1.25)] : [25, 90];
  // Micro-drama structure (new projects): every scene shifts the power between the two people, a turn lands at least every
  // 30 s, and the episode ends on a named cliffhanger, not on a resolution.
  if (sl.format === "micro-drama" && (sl.flow?.created || "") >= "2026-10-26") {
    let at = 0, lastTurn = 0;
    for (const sc of sl.scenes || []) {
      const ps = sc.powerShift;
      if (!ps?.from || !ps?.to || !ps?.line) out.push(`scene ${sc.id}: no power shift (scene.powerShift { from, to, line }: who holds the power before and after, and the line that flips it)`);
      at += P.sceneShots(sl, sc).reduce((n, s) => n + P.shotSecs(s), 0);
      if (ps?.from) { if (at - lastTurn > 30) out.push(`scene ${sc.id}: ${Math.round(at - lastTurn)} s without a turn (max 30)`); lastTurn = at; }
    }
    if (!["partial-revelation", "reversal", "intrusion", "deadline"].includes(sl.cliffhanger)) out.push("the episode needs a cliffhanger ending (sl.cliffhanger: partial-revelation, reversal, intrusion or deadline)");
  }
  if (sl.radio?.length && (sl.radio.length < lo || sl.radio.length > hi)) out.push(`${sl.radio.length} s episode in the radio cut (range ${Math.round(lo)}-${Math.round(hi)} s${want ? `, asked for ${want} s` : ""})`);
  return out;
}
const VAGUE = /\b(cinematic|stunning|epic|8k|4k|masterpiece|breathtaking|gorgeous|award[- ]winning|ultra[- ]realistic|hyper[- ]detailed)\b/i;
const EXTREME = /\b(low[- ]angle|high[- ]angle|overhead|bird'?s[- ]eye|worm'?s[- ]eye|dutch)\b/i;

function boardCheck(sl) {
  const k = kindOf(sl), bad = [];
  if (k === "scenes") {
    for (const sc of sl.scenes || []) if (!exists(sl, sc.grid)) bad.push(`scene ${sc.id} has no storyboard`);
    // Storyboard panels are judged against the set plate and the character sheets (new projects only).
    if ((sl.flow?.created || "") >= "2026-10-26") for (const s of sl.shots || []) if (s.board?.file && s.board.eval?.pass !== true && !s.board.eval?.accepted) bad.push(`${s.id}: its storyboard panel ${s.board.eval ? `failed its eval: ${s.board.eval.fails.join("; ")}` : "was not judged"}`);
    // One locked close-up angle per person with singles in more than one scene, made before the grids
    // (otherwise a person's background changes from scene to scene).
    const angles = P.anglesNeeded(sl);
    for (const id of angles) if (!fs.existsSync(P.angleFile(sl, id) || "")) bad.push(`${P.character(id).name} has no locked angle frame for their close-ups (gen.mjs angles)`);
    if (angles.length && angles.every((id) => fs.existsSync(P.angleFile(sl, id) || "")))
      for (const sc of sl.scenes || []) if (sc.grid && sc.gridAngles !== JSON.stringify(sl.angles || {})) bad.push(`scene ${sc.id}'s storyboard was made without the current angle frames (gen.mjs storyboard --scenes ${sc.id})`);
    if (!(sl.scenes || []).length) bad.push("no scenes");
    const pc = planCheck(sl);
    if (pc.problems.length) bad.push(`plan de continuidad: ${pc.problems.join("; ")}`);
    for (const sc of sl.scenes || []) {
      // Marks are checked on the same cast job() checks at filming: the scene's cast plus anyone its prompt names.
      try { const pr = P.scenePrompt(sl, sc, P.sceneRefs(sl, sc)); const prText = typeof pr === "string" ? pr : JSON.stringify(pr); const miss = missingMarks(prText, [...new Set([...P.sceneCast(sl, sc), ...castOf(sl, prText)])]); if (miss.length) bad.push(`${sc.id}'s prompt is missing ${miss.join(", ")}`); } catch {}
      // REFERENCE CHECK (without references, wardrobe changes color between shots): every character in a scene must reach
      // the model with a face view AND a full-body view (the wardrobe), or the book can't be built.
      try {
        const refs = P.sceneRefs(sl, sc);
        for (const id of P.sceneCast(sl, sc)) {
          const mine = refs.filter((r) => r.id === id);
          if (!mine.length) bad.push(`scene ${sc.id}: ${id} carries no reference image`);
          else if (!mine.some((r) => /full body/.test(r.name))) bad.push(`scene ${sc.id}: ${id} carries no full-body view (wardrobe); make their sheet with cast.mjs sheet`);
        }
      } catch (e) { bad.push(`scene ${sc.id}: references: ${e.message}`); }
    }
    if (!fs.existsSync(path.join(dir(sl), "out", "animatic.mp4"))) bad.push("no animatic (animatic.mjs)");
    bad.push(...dramaRules(sl));
  } else if (k === "clips") {
    if (!(sl.shots || []).length) bad.push("no shots");
    if (sl.format === "launch") bad.push(...launchBoard(sl));
    for (const s of sl.shots || []) {
      if (s.source === "card") continue;
      const from = /^@(\w+):last$/.exec(s.frame || "");
      if (from) { const k = sl.shots.findIndex((x) => x.id === from[1]); if (k < 0 || k >= sl.shots.indexOf(s)) bad.push(`${s.id}: opens on ${from[1]}, which is not an earlier shot`); }
      else if (!exists(sl, s.frame)) bad.push(`${s.id}: no first frame`);
      if (s.last && !exists(sl, s.last)) bad.push(`${s.id}: the last frame ${s.last} is missing`);
      if (s.lastPrompt && !s.last) bad.push(`${s.id}: no choreographed last frame (gen.mjs frame ${sl.slug} ${s.id} last --planned)`);
      // A chained shot opens on the previous shot's own last frame (a copy), or the cut jumps; a last frame drawn from
      // another opening is stale.
      const prevShot = sl.shots[sl.shots.indexOf(s) - 1];
      if (sl.format === "launch" && s.chain === "exact" && prevShot && !!prevShot.inserts?.length === !!s.inserts?.length) {
        const src = prevShot.last || (!prevShot.lastPrompt ? prevShot.frame : null);
        if (!src || s.frameSrc !== src) bad.push(`${s.id}: chain "exact" but its first frame is not ${prevShot.id}'s last frame (gen.mjs frame ${sl.slug} ${s.id} first --planned copies it)`);
      }
      if (sl.format === "launch" && s.last && s.lastFrom && s.lastFrom !== s.frame) bad.push(`${s.id}: the last frame was drawn from another first frame; draw it again`);
      // Launch frames are judged against the set map and the sheets; a frame that failed (or was never judged) can't
      // reach the animatic, unless the creator accepted that exact frame.
      if (sl.format === "launch" || (kindOf(sl) === "clips" && s.characters?.length && (sl.flow?.created || "") >= "2026-10-26")) for (const [w, f] of [["first", s.frame], ["last", s.last]]) {
        if (!f || /^@/.test(f) || !exists(sl, f)) continue;
        if (w === "first" && s.chain === "exact" && s.frameSrc) continue; // a copy of a judged last frame
        const ev = s[`${w}Eval`];
        if (!ev || ev.file !== f) bad.push(`${s.id}: the ${w} frame was not judged (gen.mjs frame-eval ${sl.slug} ${s.id} ${w})`);
        else if (!ev.pass && !ev.accepted) bad.push(`${s.id}: the ${w} frame failed its eval: ${ev.fails.join("; ")}`);
      }
      if (!films(s)) continue;
      if (!s.prompt?.trim()) bad.push(`${s.id}: no prompt`);
      else {
        // The prompt checked is the one the model receives (P.clipPrompt: the shot's prompt plus its script).
        try {
          const pr = P.clipPrompt(sl, s);
          const miss = missingMarks(pr, s.characters || castIds(sl));
          if (miss.length) bad.push(`${s.id}: the prompt leaves out ${miss.join(", ")}`);
          const gone = P.linesMissing(pr, s.dialogue || []);
          if (gone.length) bad.push(`${s.id}: the prompt leaves out the dialogue ${gone.map((l) => `"${l.text}"`).join(", ")}`);
        } catch (e) { bad.push(`${s.id}: ${e.message}`); } // e.g. a character not in the bible yet: report it, don't crash status
      }
      if (!s.duration) bad.push(`${s.id}: no duration`);
    }
  }
  return bad.length ? no(bad.join("; ")) : ok("storyboard and prompts reviewed");
}

// Launch films before the book: the plan still passes, the shotlist is the plan applied (launch.mjs apply), every
// voice-over line was recorded and fits its shot, and the animatic was built from the current frames and voice.
function launchBoard(sl) {
  const plan = launchJSON(sl, "plan");
  const bad = L.planRules(plan, { brief: launchJSON(sl, "brief"), concepts: launchJSON(sl, "concepts"), style: launchJSON(sl, "style"), reference: launchJSON(sl, "reference") || RF.asReference(sl.refsChoice?.ids || []) });
  if (!plan) return bad;
  if (sl.launch?.applied !== sha(launchFile(sl, "plan"))) bad.push("the shotlist is not the current plan (launch.mjs apply)");
  // Every setting drawn in two or more shots has an anchor frame (a checked frame that follows its map), sent first to
  // every frame of that setting so the layout never drifts.
  const st0 = launchJSON(sl, "style");
  for (const e of st0?.environments || []) {
    const n = (plan.shots || []).filter((s) => s.source === "generate" && (s.assets || []).includes(e.id)).length;
    if (n >= 2 && e.map && (!e.anchor || !fs.existsSync(path.join(dir(sl), e.anchor)))) bad.push(`the setting ${e.id} has no anchor frame (draw its first frame, check it against the map, set environments[].anchor)`);
  }
  // The narration take is measured against the blueprint; off it, only the creator's words let it through.
  const vm = sl.launch?.voice?.measure;
  if (sl.launch?.voice?.takeMode && !vm) bad.push("the narration take was not measured (launch.mjs voice --take --recut)");
  else if (vm?.off?.length && !vm.accepted) bad.push(`the narration is off the blueprint: ${vm.off.join("; ")} (re-record, or launch.mjs voice-accept <slug> --said "...")`);
  for (const s of plan.shots || []) if (s.vo) {
    const v = sl.launch?.vo?.[s.id];
    if (!v || v.text !== s.vo || !fs.existsSync(path.join(dir(sl), v.file || "-"))) bad.push(`${s.id}: voice-over not recorded (launch.mjs voice)`);
    else if (v.secs > v.room + 0.05) bad.push(`${s.id}: the voice runs ${v.secs} s and only ${v.room} s fit; shorten the line`);
  }
  // The narration, measured on the recorded lines: no silence over 1.2 s between lines, and voice over most of the film.
  if (launchJSON(sl, "concepts")?.config?.voiceover) {
    const said = (plan.shots || []).filter((s) => s.vo && sl.launch?.vo?.[s.id]).map((s) => ({ id: s.id, a: s.start + (s.voAt ?? 0.15), b: s.start + (s.voAt ?? 0.15) + sl.launch.vo[s.id].secs }));
    for (let i = 1; i < said.length; i++) if (said[i].a - said[i - 1].b > 1.2) bad.push(`${said[i].id}: ${(said[i].a - said[i - 1].b).toFixed(1)} s of silence before its line (max 1.2 s; the narration doesn't stop)`);
    const cover = said.length ? (said.at(-1).b - said[0].a) / plan.durationSeconds : 0;
    if (said.length && cover < 0.75) bad.push(`the narration covers ${Math.round(cover * 100)} % of the film (min 75 %)`);
  }
  // Real footage inside a still: the files exist, and the frame has a green screen for each clip (detected by the
  // animatic on this exact frame).
  for (const s of sl.shots || []) if (s.inserts?.length) {
    for (const i of s.inserts) if (!fs.existsSync(path.isAbsolute(i.file) ? i.file : path.join(dir(sl), i.file))) bad.push(`${s.id}: the footage ${i.file} doesn't exist`);
    const sc = sl.launch?.screens?.[s.id];
    if (s.frame && sc?.frame === s.frame && sc.boxes.length < s.inserts.length) bad.push(`${s.id}: the frame has ${sc.boxes.length} green screens and carries ${s.inserts.length} clips; redraw the frame`);
  }
  const an = sl.launch?.animatic;
  if (!an || !fs.existsSync(path.join(dir(sl), "out", "animatic.mp4")) || an.sig !== launchSig(sl)) bad.push("no animatic of the current plan (launch.mjs animatic)");
  // The creator watched the storyboard animatic of this exact plan before any frame was paid for.
  if (sl.launch?.animaticApproved?.plan !== planSha(sl)) bad.push("the creator hasn't approved this plan's animatic (launch.mjs animatic <slug> --approve --said \"...\")");
  // ...and again once every frame is drawn: The creator sees every frame before prices and the book.
  else if ((sl.shots || []).every((s) => s.frame) && sl.launch?.animaticApproved?.sig !== launchSig(sl)) bad.push("the creator hasn't seen the animatic with the drawn frames (launch.mjs animatic <slug> --approve --said \"...\")");
  return bad;
}
// What the animatic shows: the plan, the frames and the recorded voice. Changing any of them asks for a new one.
export const launchSig = (sl) => sha([launchFile(sl, "plan"), launchFile(sl, "style"), (sl.shots || []).map((s) => [s.id, s.frame || null]), sl.launch?.vo || null, sl.launch?.screens || null]);
export const planSha = (sl) => sha(launchFile(sl, "plan"));

// FORMAT READINESS: a format whose editor can't finish it (a drama with no score, no stings, no swell) would be
// filmed anyway and come out as a dry, unusable cut. A format with `editMissing` stops here,
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
  if (!pc) return no("no live price analysis (studio.mjs prices)");
  if ((Date.now() - Date.parse(pc.at)) / 864e5 > 7) return no(`the price analysis is more than 7 days old (${pc.at.slice(0, 10)}); run it again`);
  const want = kindOf(sl) === "longform" ? sl.longform?.videoModel : sl.defaults?.videoModel;
  if (want !== pc.pick?.key) return no(`the project's model (${want}) is not the one picked in the analysis (${pc.pick?.key})`);
  return ok(`${pc.pick.label} ${pc.pick.res} · $${pc.pick.usd} live (${pc.at.slice(0, 10)})`);
}

function bookCheck(sl) {
  if (!fs.existsSync(path.join(dir(sl), "book", "index.html"))) return no("no Production Book (book.mjs)");
  // A launch film tests the chosen video model on one shot before the book: The creator picks the model
  // with the video in front of them, or waives the test in their words.
  if (sl.format === "launch" && !sl.launch?.motionTestWaived?.said && !(sl.shots || []).some((s) => (s.clips || []).some((c) => c.test && c.model === sl.defaults?.videoModel)))
    return no(`no motion test on ${sl.defaults?.videoModel || "the chosen model"} (gen.mjs clip <slug> --shot <id> --test --model <k> --said "...", or launch.mjs waive-test <slug> --said "...")`);
  // People acting and no model with evidence of doing that job well yet: two candidates are compared on it.
  // Every filmed format compares at least two video models on the same representative shot before the book (the best
  // fit and the cheapest good alternative), so the pick is seen, not assumed; only the creator's words skip it.
  const tested = Object.keys(PR.testedModels(sl));
  const films = kindOf(sl) !== "longform" || (sl.longform?.scenes || []).some((s) => s.motion !== "kenburns");
  const waived = sl.launch?.motionTestWaived?.said || sl.modelCompareWaived?.said;
  if (films && !waived && tested.length < 2)
    return no(`compare at least two video models on one shot before the book (tested: ${tested.join(", ") || "none"}; gen.mjs clip <slug> --shot <id> --test --model <k> --said "...", or studio.mjs waive-compare <slug> --said "...")`);
  // Models the providers sell that the engine doesn't run yet are put to the creator before every book.
  if (sl.priceCheck?.newOnKie?.length && sl.newModelsReviewed?.at !== sl.priceCheck.at)
    return no(`show the creator the new models on Kie (${sl.priceCheck.newOnKie.slice(0, 6).join(", ")}${sl.priceCheck.newOnKie.length > 6 ? "..." : ""}) and record their call (studio.mjs new-models <slug> --said "...")`);
  if (sl.bookEstimate == null) return no("the book has no cost estimate");
  return ok(`estimado ${sl.bookEstimate} cr`);
}

// A take of a clips project is usable only when every eval on it passed.
// motion: measured on launch takes with people; a take that barely moves reads slow and lifeless.
export const evalsPass = (t) => !!t && t.evals?.identity?.pass === true && t.evals?.jumps?.internal === 0 && t.evals?.dialogue?.pass === true && t.evals?.motion?.pass !== false;
// A take that failed an eval is usable only when the creator accepted that exact take (studio.mjs accept-take).
export const takeOk = (t) => evalsPass(t) || !!t?.accepted?.said;

function filmCheck(sl) {
  const k = kindOf(sl), bad = [];
  if (k === "scenes") {
    if (!(sl.scenes || []).length) bad.push("no scenes");
    for (const sc of sl.scenes || []) {
      const t = sc.clips?.[sc.clip];
      if (!t) bad.push(`scene ${sc.id} has no chosen take`);
      else if (!t.qc?.pass) bad.push(`scene ${sc.id}: QC failed`);
      else if (!t.continuity?.pass) bad.push(`scene ${sc.id}: continuity failed`);
    }
  } else if (k === "clips") {
    if (!(sl.shots || []).length) bad.push("no shots");
    for (const s of (sl.shots || []).filter(films)) if (!takeOk(s.clips?.[s.clip])) bad.push(`${s.id}: no take passes identity, jumps and dialogue`);
    if (sl.format === "launch") {
      const plan = launchJSON(sl, "plan");
      if (launchJSON(sl, "concepts")?.config?.music && !(sl.music?.files || []).length) bad.push("no music (gen.mjs music)");
      for (const n of Object.keys(plan?.sfx || {})) if (!fs.existsSync(path.join(dir(sl), "audio", `sfx-${n}.mp3`))) bad.push(`the ${n} effect is missing (gen.mjs sfx)`);
    }
  } else {
    const L = sl.longform || {};
    if ((L.script || []).some((s, i) => s.text?.trim() && !fs.existsSync(path.join(dir(sl), "audio", "vo", `${String(i + 1).padStart(3, "0")}.mp3`)))) bad.push("narration incomplete");
    if (L.music?.prompt && !(L.music.files || []).length) bad.push("no music");
    for (const sc of L.scenes || []) if (!exists(sl, sc.image) || (sc.motion !== "kenburns" && !exists(sl, sc.clip))) bad.push(`scene ${sc.id} has no loop`);
  }
  return bad.length ? no(bad.join("; ")) : ok("every take passes its evals");
}

export const takesSig = (sl) => sha(kindOf(sl) === "scenes" ? (sl.scenes || []).map((sc) => sc.clips?.[sc.clip]?.file) : kindOf(sl) === "clips" ? (sl.shots || []).map((s) => s.clips?.[s.clip]?.file) : (sl.longform?.scenes || []).map((s) => s.clip || s.image));

function editCheck(sl) {
  const f = finalFile(sl);
  if (!fs.existsSync(f)) return no(`no final cut (${kindOf(sl) === "scenes" ? "edit.mjs" : sl.format === "launch" ? "launch.mjs build" : kindOf(sl) === "clips" ? "cut.mjs" : "longform.mjs build"})`);
  if (sl.cut?.sha !== fileSha(f)) return no("the final cut wasn't made by the engine, or changed afterwards");
  if (sl.cut?.takes !== takesSig(sl)) return no("the cut uses takes other than the approved ones; cut again");
  return ok(path.basename(f));
}

function qcCheck(sl) {
  const q = sl.finalQc5;
  if (!q) return no("no final QC (studio.mjs qc)");
  if (q.sha !== fileSha(finalFile(sl))) return no("the QC is for another version of the final; run it again");
  return q.pass ? ok("final QC passed") : no(`final QC: ${q.issues.join("; ")}`);
}

function deliverCheck(sl) {
  const f = path.join(dir(sl), "delivery.json");
  if (!fs.existsSync(f)) return no("no delivery receipt (studio.mjs deliver)");
  const r = P.readJSON(f);
  return r.sha === fileSha(finalFile(sl)) ? ok(`entregado ${r.at.slice(0, 10)}`) : no("the receipt doesn't match the final file");
}

const approvedNow = (sl, id) => {
  const a = sl.flow?.approved?.[id];
  if (!a) return no("waiting for the creator's approval");
  if (FINGERPRINT[id] && a.fp !== FINGERPRINT[id](sl)) return no("changed after it was approved; it needs a new approval");
  return ok(`approved: "${a.said}"`);
};
const both = (...rs) => rs.find((r) => !r.ok) || ok(rs.map((r) => r.detail).filter(Boolean).join(" · "));

function launchConcept(sl) {
  const c = launchJSON(sl, "concepts");
  const bad = [...L.briefRules(launchJSON(sl, "brief")), ...L.conceptRules(c, launchJSON(sl, "brief"))];
  return bad.length ? no(bad.join("; ")) : ok(`concept ${c.selected} of ${c.concepts.length}`);
}
function launchScript(sl) {
  const plan = launchJSON(sl, "plan");
  const bad = L.planRules(plan, { brief: launchJSON(sl, "brief"), concepts: launchJSON(sl, "concepts"), style: launchJSON(sl, "style"), reference: launchJSON(sl, "reference") || RF.asReference(sl.refsChoice?.ids || []) });
  return bad.length ? no(bad.join("; ")) : ok(`${plan.shots.length} shots · ${plan.durationSeconds} s`);
}

// who: "creator" = his approval, "auto" = checks only.
// The reference bank: when the creator has approved references for a format, the concept gate waits until
// they choose which to use (or none), in their words; the script gate refuses lines that repeat a chosen reference's.
export function refsGate(sl) {
  const ids = RF.approved(sl.format);
  if (!ids.length || sl.refsChoice || sl.flow?.approved?.concept) return []; // a concept approved before the bank had refs stands
  return [`there are ${ids.length} approved ${sl.format} reference(s) (${ids.join(", ")}): choose which to use, or none, in the creator's words (studio.mjs refs <slug> --use id,id --said "..." | --none --said "...")`];
}
export function projectText(sl) {
  if (sl.format === "launch") return (launchJSON(sl, "plan")?.shots || []).map((s) => s.vo || "").join(" ");
  if (kindOf(sl) === "longform") return (sl.longform?.script || []).map((l) => l.text || l).join(" ");
  return (sl.shots || []).flatMap((s) => (s.dialogue || []).map((l) => l.text)).join(" ");
}
// Every format that sells a product records, in the creator's words, what it does NOT do and what every video must
// say; the script gate refuses a line that promises a missing feature or a script that leaves out a must-say point.
export const SELLS = new Set(["launch", "ugc", "influencer"]);
export function productFacts(sl) {
  const f = sl.format === "launch" ? launchJSON(sl, "brief") || {} : sl.product || {};
  const out = [], text = projectText(sl);
  if (SELLS.has(sl.format) && sl.format !== "launch" && !sl.product?.doesNot) out.push(`this ${sl.format} video sells a product but doesn't record what it does NOT do (studio.mjs product ${sl.slug} --does-not "what:word,word" --said "...")`);
  for (const d of sl.format === "launch" ? [] : f.doesNot || []) { const w = d.words.find((x) => L.wordIn(x, text)); if (w) out.push(`the script says "${w}", a feature the product doesn't have (${d.what})`); }
  for (const m of sl.format === "launch" ? [] : f.mustSay || []) if (!m.words.some((w) => L.wordIn(w, text))) out.push(`the script never says "${m.what}"`);
  return out;
}
export function copyGate(sl) {
  const facts = productFacts(sl);
  if (facts.length) return facts;
  const ids = sl.refsChoice?.ids || [];
  return ids.length ? RF.copyOverlap(projectText(sl), ids).filter((x) => x.share > RF.COPY_MAX).map((x) => `the script repeats ${Math.round(x.share * 100)} % of reference ${x.ref}'s phrases (max ${Math.round(RF.COPY_MAX * 100)} %): a reference teaches, it isn't copied`) : [];
}
const withRefs = (check, extra) => (sl) => { const r = check(sl); if (!r.ok) return r; const bad = extra(sl); return bad.length ? no(bad.join("; ")) : r; };

export const STEPS = {
  intake: { name: "Intake", who: "auto", check: intakeCheck, next: "studio.mjs new (the 7 questions)" },
  series: { name: "Series bible", who: "creator", check: (sl) => (fs.existsSync(path.join(P.PROJECTS, "..", "series", sl.series || "-", "series.json")) ? ok() : no("no series.json")), next: "studio.mjs series new, luego approve series" },
  concept: { name: "Concepto", who: "creator", check: withRefs((sl) => (!fs.existsSync(path.join(dir(sl), "concept.md")) ? no("no concept.md") : sl.format === "launch" ? launchConcept(sl) : ok()), refsGate), next: "write concept.md (launch: also launch/brief.json and launch/concepts.json; launch.mjs check), then approve concept" },
  // Meditations: the intention's rules (pace, pauses, voice share, music tempo, picture, safety) block the script
  // gate (one universal engine for guided meditations, the intention only changes the numbers).
  script: { name: "Guion", who: "creator", check: withRefs((sl) => (kindOf(sl) === "longform" ? (!((sl.longform?.script || []).length || sl.longform?.voiceFree) ? no("no script") : meditationRules(sl).length ? no(meditationRules(sl).join("; ")) : ok(intentOf(sl).label)) : sl.format === "launch" ? launchScript(sl) : !(sl.shots || []).length ? no("no shots or dialogue") : sitcomScriptRules(sl).length ? no(sitcomScriptRules(sl).join("; ")) : ok()), copyGate), next: "write the script in the shotlist, then approve script" },
  cast: { name: "Casting y sets", who: "creator", check: castCheck, next: "cast.mjs sheet / approve-character, luego approve cast" },
  radio: { name: "Radio cut", who: "auto", check: radioCheck, next: "radio.mjs" },
  board: { name: "Storyboard and prompts", who: "auto", check: boardCheck, next: "gen.mjs storyboard + animatic.mjs (scenes) or gen.mjs frame (clips)" },
  models: { name: "Precios en vivo", who: "auto", check: modelsCheck, next: "studio.mjs prices <slug> (analyzes live prices and picks the best model for quality and cost; --pick <model> if the creator chooses another)" },
  book: { name: "Production Book", who: "creator", check: bookCheck, next: "book.mjs, publish it, then approve book (locks the budget)" },
  film: { name: "Filming", who: "auto", check: filmCheck, next: "gen.mjs scenes | clip --shot | narration/bed/loops" },
  edit: { name: "Edit", who: "auto", check: editCheck, next: "edit.mjs | cut.mjs | longform.mjs build" },
  qc: { name: "Final QC", who: "auto", check: qcCheck, next: "studio.mjs qc" },
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
  if (!sl?.flow?.v) throw new FlowStop(`${sl?.slug || "this project"} is not a flow v5 project. Create it with: node engine/studio.mjs new`);
  if (sl.flow.archived) throw new FlowStop(`${sl.slug} is archived (read-only): ${sl.flow.archived}`);
}

// The gate every command calls. `step` is the step the command belongs to.
export function requireStep(sl, step, what = step) {
  assertV5(sl);
  const r = recipe(sl);
  if (!r.includes(step)) throw new FlowStop(`"${what}" is not part of the ${FORMATS[sl.format]?.label || sl.format} recipe`);
  for (const id of r.slice(0, r.indexOf(step))) {
    const s = stepStatus(sl, id);
    if (!s.ok) throw new FlowStop(`"${what}" belongs to the "${STEPS[step].name}" step, but "${STEPS[id].name}" comes first: ${s.detail}.\nNext: ${STEPS[id].next}\nStatus: node engine/studio.mjs status ${sl.slug}`);
  }
  // Every paid step after the book needs the budget the book locked.
  if (r.indexOf(step) >= r.indexOf("film") && sl.budget?.approvedCredits == null) throw new FlowStop(`"${what}": no approved budget (it is set when the Production Book is approved)`);
}

// PILOT GATE (filming every scene at once on an untried model shows timing, sound and wardrobe problems only after
// every credit is spent). After the book, only the
// first scene (scenes formats) or first shot (clips formats) can be filmed. The creator watches it and approves it in his
// words (studio.mjs approve-pilot) before anything else is filmed. A bad pilot costs one scene, not the episode.
// Clips formats: the first shot that is filmed (a launch film can open on a still or a card, which never is).
export const pilotId = (sl) => (kindOf(sl) === "scenes" ? sl.scenes?.[0]?.id : kindOf(sl) === "clips" ? (sl.shots || []).find(films)?.id : null);
export function requirePilot(sl, ids) {
  // The pilot is approved for one video model: switching models (Wan to Kling) re-arms the gate.
  const ok = sl.flow?.approved?.pilot && (sl.flow.approved.pilot.model ?? null) === (sl.defaults?.videoModel ?? null);
  if (kindOf(sl) === "longform" || ok) return;
  const p = pilotId(sl), rest = ids.filter((i) => i !== p);
  if (rest.length) throw new FlowStop(`PILOT STOP: film the pilot first (${p}), show it to the creator and record their yes: studio.mjs approve-pilot ${sl.slug} --said "..." . Only then ${rest.join(", ")}.`);
}
export function approvePilot(slug, said) {
  if (!said?.trim()) throw new FlowStop('approve-pilot needs the creator\'s exact words: --said "..."');
  return P.updateShotlist(slug, (sl) => {
    assertV5(sl);
    const id = pilotId(sl), item = (sl.scenes || []).find((x) => x.id === id) || (sl.shots || []).find((x) => x.id === id);
    if (!item?.clips?.length) throw new FlowStop(`the pilot ${id} isn't filmed yet`);
    sl.flow.approved ||= {};
    sl.flow.approved.pilot = { said: said.trim(), at: new Date().toISOString(), item: id, take: (item.clip ?? item.clips.length - 1) + 1, model: sl.defaults?.videoModel ?? null };
    sl.flow.log = [...(sl.flow.log || []), { at: new Date().toISOString(), event: `approve pilot ${id}`, said: said.trim() }];
  });
}

export function approve(slug, id, said, extra = {}) {
  if (!said?.trim()) throw new FlowStop('approve needs the creator\'s exact words: --said "..."');
  return P.updateShotlist(slug, (sl) => {
    assertV5(sl);
    const S = STEPS[id];
    if (!S || S.who !== "creator") throw new FlowStop(`"${id}" is not a step the creator approves (${Object.keys(STEPS).filter((k) => STEPS[k].who === "creator").join(", ")})`);
    const r = recipe(sl);
    if (!r.includes(id)) throw new FlowStop(`"${id}" is not in this project's recipe`);
    for (const p of r.slice(0, r.indexOf(id))) { const s = stepStatus(sl, p); if (!s.ok) throw new FlowStop(`before approving "${S.name}", "${STEPS[p].name}" is missing: ${s.detail}`); }
    const c = S.check(sl);
    if (!c.ok) throw new FlowStop(`"${S.name}" is not ready to approve: ${c.detail}`);
    sl.flow.approved ||= {};
    sl.flow.approved[id] = { said: said.trim(), at: new Date().toISOString(), fp: FINGERPRINT[id] ? FINGERPRINT[id](sl) : null, ...extra };
    sl.flow.log = [...(sl.flow.log || []), { at: new Date().toISOString(), event: `approve ${id}`, said: said.trim() }];
    if (id === "book") {
      const spent = P.ledgerTotal(slug);
      const hard = sl.intake?.budget?.mode === "fixed" && sl.intake.budget.usd ? sl.intake.budget.usd / 0.005 : null;
      if (hard != null && spent + sl.bookEstimate > hard) throw new FlowStop(`the book (spent ${(spent * 0.005).toFixed(2)} + estimate ${(sl.bookEstimate * 0.005).toFixed(2)}) passes the fixed cap of ${sl.intake.budget.usd}: lower the model, the resolution or the length`);
      // A re-approved book never takes back headroom the creator already approved (top-ups or an earlier book).
      const prev = sl.budget?.approvedCredits ?? 0, next = Math.max(Math.ceil(spent + sl.bookEstimate), prev);
      sl.budget = { approvedCredits: next, approvedAt: new Date().toISOString(), history: [...(sl.budget?.history || []), { add: next - prev, note: `Production Book approved: "${said.trim()}"` }] };
      // The plan this book priced: a later plan change stops paid jobs until the creator approves the new estimate.
      if (sl.format === "launch") sl.bookPlan = planSha(sl);
    }
  });
}

export function override(slug, step, said, reason) {
  if (!said?.trim() || !reason?.trim()) throw new FlowStop('override needs --said "the creator\'s exact words" and --reason "why"');
  return P.updateShotlist(slug, (sl) => {
    assertV5(sl);
    if (!STEPS[step]) throw new FlowStop(`unknown step: ${step}`);
    const o = { step, said: said.trim(), reason: reason.trim(), at: new Date().toISOString(), fp: FINGERPRINT[step] ? FINGERPRINT[step](sl) : "manual" };
    sl.flow.overrides = [...(sl.flow.overrides || []), o];
    sl.flow.log = [...(sl.flow.log || []), { at: o.at, event: `override ${step}`, said: o.said, reason: o.reason }];
  });
}
