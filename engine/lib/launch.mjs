// Product launch films: the creative director's plan, checked in code before any spend.
// Claude writes these files with the creator, in projects/<slug>/launch/; the rules below decide whether a gate can be
// approved (lib/flow.mjs). Nothing in this file spends.
//   brief.json        product facts with their sources, the interview, assumptions, the message map
//   concepts.json     the film config, three or more distinct concepts, the pick and why
//   shot-plan.json    the timecoded shots: role, beat, takeaway, picture, voice-over, on-screen text, claims, prompts
//   style-bible.json  the locked look: palette, line, texture, text treatment, characters, environments, brand
//   quality-report.json  editorial heuristic scores on the final (not evidence of performance)
// Why: a launch film is a story about one product for one audience. A pile of pretty clips with invented claims is
// the failure this vertical exists to prevent, so strategy, timing and claims are locked before the first image.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as P from "./project.mjs";
import { judgeJSON } from "./judge.mjs";

export const dirOf = (slug) => path.join(P.projectDir(slug), "launch");
export const FILES = { brief: "brief.json", concepts: "concepts.json", plan: "shot-plan.json", style: "style-bible.json", quality: "quality-report.json", reference: "reference.json" };
export const fileOf = (slug, k) => path.join(dirOf(slug), FILES[k]);
export const read = (slug, k) => P.readJSON(fileOf(slug, k), null);

// Release 1: what the editor finishes today. Anything else is refused at the intake, never offered half-working.
// 30 s, plus up to 5 s so the brand ending can breathe (the ending felt rushed).
// Styles: any bible style with a "launch" block (how real footage is graded into its world) or a custom style made
// from the creator's own references (launch.mjs style-from-refs). launch films opened past storybook.
export function launchStyles() {
  const dir = path.join(P.BIBLE, "styles");
  return fs.readdirSync(dir).filter((id) => { try { const s = JSON.parse(fs.readFileSync(path.join(dir, id, "style.json"), "utf8")); return !!s.launch; } catch { return false; } }).sort();
}
export const RELEASE = { seconds: [30, 30.5, 31, 31.5, 32, 32.5, 33, 33.5, 34, 34.5, 35], ar: ["16:9"], fps: [24], get styles() { return launchStyles(); } };
// A style made from the creator's references: the images exist (2 or more), the look is written out, the never-list
// is set, and it says how real footage is treated.
export function customStyleRules(st) {
  const out = [];
  if (st.kind !== "custom") return out;
  const refs = (st.refs || []).filter((f) => fs.existsSync(path.isAbsolute(f) ? f : path.join(st.dir || "", f)));
  if (refs.length < 2) out.push(`the ${st.id} style was made from references and has ${refs.length}; it needs at least 2 of the creator's images`);
  // The creator's images teach the style; models only get originals made for it (no existing characters to copy).
  const own = new Set(st.generated || []);
  const foreign = (st.refs || []).filter((f) => !own.has(f));
  if (foreign.length) out.push(`the ${st.id} style sends the creator's own images to the model (${foreign.join(", ")}); make 4-6 original references in the style and list them in style.generated`);
  if (own.size && own.size < 4) out.push(`the ${st.id} style has ${own.size} original references; make at least 4`);
  if ((st.look || "").trim().split(/\s+/).length < 12) out.push(`the ${st.id} style doesn't describe its look (at least 12 words: line, color, texture, light, depth)`);
  if (!(st.negative || "").trim()) out.push(`the ${st.id} style has no "never" list (negative)`);
  if (!st.launch) out.push(`the ${st.id} style doesn't say how real footage is blended in (launch.insertTreatment)`);
  if (!st.madeFrom?.said?.trim()) out.push(`the ${st.id} style lacks the creator's words asking for it`);
  return out;
}
export const MODES = ["story-driven", "explainer", "motion-graphics", "cinematic", "performance"];
export const ROLES = ["hook", "friction", "problem", "possibility", "interaction", "demo", "proof", "outcome", "brand", "cta"];
export const CONNECT = ["action", "object", "push-in", "pull-out", "same-place", "pov"];
export const TRANSITIONS = ["cut", "fade", "ripple", "dissolve", "fadeblack", "slideleft", "slideright", "slideup", "slidedown", "smoothleft", "smoothright", "circleopen", "circleclose", "wipeleft", "wiperight"];
const EMOTIONS = ["relief", "excitement", "confidence", "empowerment", "curiosity", "delight"];

// ---- contracts (zod at the boundary where Claude's writing becomes engine input)
const str = z.string().trim().min(2);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color en hex #RRGGBB");
const Source = z.object({ kind: z.enum(["url", "creator", "file"]), ref: str, retrievedAt: z.string().optional() });
const Capability = z.object({ id: z.string().regex(/^[\w-]+$/), claim: str, source: z.enum(["url", "creator", "file"]), evidence: z.string().optional() });
const Assumption = z.object({ field: str, value: str, confidence: z.enum(["high", "medium", "low"]), approved: z.boolean() });
export const MessageMap = z.object({
  icp: str, pain: str, consequence: str, promise: str, before: str, after: str,
  proof: str, proofCapability: z.string(), differentiator: z.string().optional(), differentiatorCapability: z.string().optional(),
  emotion: z.enum(EMOTIONS), cta: str,
});
export const ProductBrief = z.object({
  sources: z.array(Source).min(1),
  interview: z.array(z.object({ q: str, a: str })).default([]),
  product: z.object({ name: z.string().trim().min(1), description: z.string().trim().min(10), category: z.string().optional(), url: z.string().optional() }),
  icp: z.object({ role: str, context: z.string().optional(), pains: z.array(z.string()).optional(), objection: z.string().optional() }),
  currentAlternative: z.string().optional(),
  capabilities: z.array(Capability).min(1),
  // What the product does NOT do, from the creator: a script line that names one of these is a false claim.
  doesNot: z.array(z.object({ what: str, words: z.array(z.string().trim().min(2)).min(1) })).optional(),
  // The points the creator said every film must make (e.g. both of the product's main jobs), each with words to find in the VO.
  mustSay: z.array(z.object({ what: str, words: z.array(z.string().trim().min(2)).min(1) })).optional(),
  artifact: z.string().optional(),
  tone: z.string().optional(),
  cta: z.object({ label: str, destination: z.string().optional() }),
  constraints: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  assumptions: z.array(Assumption).default([]),
  message: MessageMap,
});
export const LaunchFilmConfig = z.object({
  intent: z.enum(["brand", "conversion"]),
  storyMode: z.enum(["auto", ...MODES]),
  visualStyle: z.string(),
  durationSeconds: z.number(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  fps: z.union([z.literal(24), z.literal(30)]),
  language: z.string(),
  voiceover: z.boolean(), captions: z.boolean(), music: z.boolean(),
  conceptCount: z.number().int().min(3).default(3),
});
export const CreativeConcept = z.object({
  id: z.string().regex(/^[\w-]+$/), storyMode: z.enum(MODES),
  audienceInsight: str, pain: str, promise: str, emotionalGoal: str,
  creativeThesis: str, visualMetaphor: str, metaphorMapsTo: str, productProof: str,
  openingHook: str, objection: str, storyArc: z.array(str).min(4), brandReveal: str, cta: z.string().optional(),
  risk: z.enum(["low", "medium", "high"]), effort: z.enum(["low", "medium", "high"]), rationale: str,
});
export const Concepts = z.object({ config: LaunchFilmConfig, concepts: z.array(CreativeConcept).min(3), selected: z.string(), modeRationale: str, picked: z.enum(["creator", "recommended"]) });
const Overlay = z.object({ text: z.string().trim().min(1), kind: z.enum(["title", "label", "cta", "ui"]), said: z.string().optional(), at: z.number().min(0).default(0), until: z.number().optional(), position: z.enum(["top", "center", "bottom", "lower-third"]).default("bottom") });
const Sfx = z.union([z.string(), z.object({ name: z.string(), at: z.number().min(0).default(0), db: z.number().default(-8), gain: z.number().optional() })]);
// Shot sizes, angles and the grammar of a cut live in the direction layer, shared by every vertical.
import { shotSize, newView } from "./direction.mjs";
export { shotSize, newView };
export const PlannedShot = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/), start: z.number().min(0), duration: z.number().positive(),
  role: z.enum(ROLES), beat: str, takeaway: str,
  source: z.enum(["generate", "still", "card"]),
  visual: str, subject: z.string().optional(), action: str, shotType: str, camera: str, angle: z.string().optional(),
  composition: z.string().optional(), layers: z.string().optional(), continuity: z.array(z.string()).default([]),
  vo: z.string().optional(), voDirection: z.string().optional(), acting: z.string().optional(), visualHook: z.object({ what: z.string().min(10), at: z.number().min(0) }).optional(), voAt: z.number().min(0).default(0.15), text: z.array(Overlay).default([]), logo: z.boolean().default(false), logoAt: z.number().min(0).optional(), ui: z.string().optional(),
  sfx: z.array(Sfx).default([]), music: z.enum(["low", "mid", "high"]).default("mid"),
  // The transition into this shot from the previous one (xfade names; "cut" or none is a hard cut).
  // What a set-map item shows in this shot's first frame (state) and last frame (endState), by item name.
  state: z.record(z.string(), z.string()).optional(), endState: z.record(z.string(), z.string()).optional(),
  chain: z.enum(["exact", "same-set", "cut"]).optional(), pause: z.number().min(0).max(2).optional(), transitionAsked: z.object({ said: z.string().trim().min(2) }).optional(),
  rippleAt: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(), zoomInto: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.1).max(0.9), secs: z.number().min(0.3).max(2).default(0.9), said: z.string().optional() }).optional(), transitionIn: z.enum(TRANSITIONS).optional(), transitionSecs: z.number().min(0.15).max(0.8).default(0.4), transitionOut: z.string().optional(),
  claim: z.string().optional(), brand: z.string().optional(),
  // Real footage played inside the shot's screens (drawn solid bright green), in reading order: the proof.
  // treatment "storybook" (default in illustrated styles) grades it into the film's world; "none" keeps it raw.
  inserts: z.array(z.object({ file: z.string(), from: z.number().min(0).default(0), label: z.string().optional(), treatment: z.enum(["storybook", "style", "none"]).optional(), onAt: z.number().min(0).optional() })).default([]),
  // How this shot follows the previous one: a good cut is motivated by an action, an object, or the same place seen
  // closer or wider, never an unmotivated jump to another place.
  connect: z.object({ type: z.enum(CONNECT), how: str }).optional(),
  assets: z.array(z.string()).default([]),
  prompt: z.string().default(""), negative: z.string().optional(), motion: z.string().optional(), compositing: z.string().optional(),
  // CHOREOGRAPHY (left alone, a video model invents things falling from nowhere, people popping in, objects
  // sinking). `end` is the shot's last moment, drawn as the last frame the video model
  // must land on; `still` lists what must not move, appear or disappear.
  end: z.string().optional(), still: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});
export const ShotPlan = z.object({
  conceptId: z.string(), durationSeconds: z.number(), fps: z.number(), shots: z.array(PlannedShot).min(1),
  musicPrompt: z.string().optional(),
  // The score is derived, never picked from a list: the premise, the emotion to evoke, the product or story
  // context and the narrator lead to an approach (instruments, tempo, energy) that says why it fits this film.
  musicBrief: z.object({ premise: z.string().min(3), emotion: z.string().min(3), context: z.string().min(3), narrator: z.string().optional(), style: z.string().optional(), approach: z.object({ instruments: z.string().min(3), tempo: z.string().min(1), energy: z.string().min(3), why: z.string().min(10) }), voiceRoom: z.string().optional(), turns: z.array(z.object({ at: z.number().min(0), line: z.string().optional(), music: z.string().min(3) })).default([]) }).optional(),
  // The creator can waive the thread closing the film, in their words (when an idle thread in the last shot makes no sense).
  threadCloseWaived: z.object({ said: z.string().trim().min(2), reason: z.string().trim().min(2) }).optional(),
  // A narrated film is cut to its narration: one take, every line placed where it falls in that take.
  narrationStart: z.number().min(0).default(0.2),
  sfx: z.record(z.string(), z.object({ prompt: str, seconds: z.number().positive(), said: z.string().optional() })).default({}),
});
export const StyleBible = z.object({
  name: str, preset: z.string(), artStyle: str, palette: z.array(hex).min(3), line: str, texture: str, lighting: str, colorTemp: z.string().optional(),
  depth: str, camera: str, transitions: z.string().optional(),
  text: z.object({ font: str, fontFile: z.string().optional(), color: hex, box: hex.optional(), accent: hex.optional(), uiBox: hex.optional() }),
  negative: z.array(z.string()).min(3),
  characters: z.array(z.object({ id: z.string(), role: str, scale: z.string().optional(), props: z.array(z.string()).default([]) })).default([]),
  // anchor: one approved frame that already follows the map; every frame of the setting gets it as its first reference.
  // map: where the camera stands and where every object sits on screen, so frames drawn one by one never move, mirror
  // or turn the set. It goes into every frame and clip prompt of a shot in this setting.
  environments: z.array(z.object({ id: z.string().regex(/^[\w-]+$/), name: str, layout: str, props: z.array(z.string()).default([]), ref: z.string().optional(), anchor: z.string().optional(),
    map: z.object({ camera: str, items: z.array(z.object({ name: str, look: z.string().optional(), at: str, facing: z.string().optional(), state: z.string().optional(),
      // When an item changes during the film: from that shot's first or last frame on, it shows this state.
      changes: z.array(z.object({ from: z.string().regex(/^\w+:(first|last)$/), state: str })).optional() })).min(1) }).optional() })).min(1),
  brand: z.object({ name: z.string().trim().min(1), logo: z.string().optional(), logoWidth: z.number().min(0.1).max(0.95).optional(), logoIn: z.number().min(0).max(3).optional(), logoY: z.number().min(0.2).max(0.8).optional(), safeMargin: z.number().min(0.03).max(0.15).default(0.06), uiLabels: z.array(z.string()).default([]) }),
  // One world and one thread (one place, and one recurring character or object leading every cut).
  world: z.string().optional(),
  thread: z.string().optional(),
  // The look every shot is graded to in the edit (mean brightness 0-255, mean saturation); omitted: the film's median.
  grade: z.union([z.literal(false), z.object({ brightness: z.number().min(60).max(235), saturation: z.number().min(4).max(60) })]).optional(),
  // World continuity: how a recurring thing always behaves (otherwise it can move one way in one shot and the
  // opposite way in the next). Every shot that shows the subject restates the rule in its prompt or motion.
  continuity: z.array(z.object({ subject: z.string(), rule: z.string() })).default([]),
});
const SCORE_KEYS = ["icpPain", "comprehension", "narrative", "continuity", "proof", "motion", "brand", "cta", "sound", "format"];
const Finding = z.object({ severity: z.enum(["info", "warning", "blocker"]), shotId: z.string().optional(), timestampSeconds: z.number().optional(), category: z.string(), detail: str, suggestedFix: z.string().optional() });
export const QualityReport = z.object({
  sha: z.string(), heuristic: z.literal(true),
  scores: z.object(Object.fromEntries(SCORE_KEYS.map((k) => [k, z.number().int().min(1).max(5)]))),
  reasons: z.record(z.string(), z.string()),
  findings: z.array(Finding).default([]),
});

// zod's issues as short Spanish lines with the field path.
const parse = (schema, v, name) => {
  if (v == null) return { data: null, problems: [`${name} is missing`] };
  const r = schema.safeParse(v);
  return r.success ? { data: r.data, problems: [] } : { data: null, problems: r.error.issues.slice(0, 8).map((i) => `${name}: ${i.path.join(".") || "(root)"} ${i.message}`) };
};

// ---- brief: facts with sources, assumptions only with the creator's yes
export function briefRules(raw) {
  const { data: b, problems } = parse(ProductBrief, raw, "brief.json");
  if (!b) return problems;
  const out = [];
  const caps = new Set(b.capabilities.map((c) => c.id));
  for (const a of b.assumptions) if (!a.approved) out.push(`assumption not approved by the creator: ${a.field} = "${a.value}"`);
  if (b.capabilities.some((c) => c.source === "url") && !b.sources.some((s) => s.kind === "url")) out.push("capabilities come from a URL, but the brief doesn't record the URL as a source");
  for (const s of b.sources) if (s.kind === "url" && !s.retrievedAt) out.push(`the source ${s.ref} has no read date (retrievedAt)`);
  if (!caps.has(b.message.proofCapability)) out.push(`the proof (message.proofCapability "${b.message.proofCapability}") is not a capability in the brief`);
  if (b.message.differentiator && !caps.has(b.message.differentiatorCapability || "-")) out.push("the differentiator doesn't point to a verified capability (message.differentiatorCapability); remove it or verify it");
  // One audience: a film for everyone speaks to no one.
  if (/\b(everyone|anyone|everybody|all (?:businesses|teams|people)|todos|cualquiera|todo el mundo)\b/i.test(b.message.icp)) out.push(`the ICP "${b.message.icp}" is not a single one; choose one concrete ideal customer`);
  if (!b.doesNot) out.push("the brief doesn't record what the product does NOT do (doesNot); ask the creator, so the script can't promise a feature it lacks (an empty list is an answer)");
  if (!b.interview.length && !b.sources.some((s) => s.kind === "creator")) out.push("no interview: confirm at least the ICP, the pain and the CTA with the creator (brief.interview)");
  return out;
}

// ---- concepts: three meaningfully different angles, one picked
const words = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3));
const overlap = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
export function conceptRules(raw, brief) {
  const { data: c, problems } = parse(Concepts, raw, "concepts.json");
  if (!c) return problems;
  const out = [], cfg = c.config;
  if (!RELEASE.seconds.includes(cfg.durationSeconds)) out.push(`length ${cfg.durationSeconds} s: not available yet (Release 1: ${RELEASE.seconds.join(", ")} s)`);
  if (!RELEASE.ar.includes(cfg.aspectRatio)) out.push(`format ${cfg.aspectRatio}: not available yet (Release 1: ${RELEASE.ar.join(", ")})`);
  if (!RELEASE.fps.includes(cfg.fps)) out.push(`${cfg.fps} fps: not available yet (Release 1: ${RELEASE.fps.join(", ")})`);
  if (!RELEASE.styles.includes(cfg.visualStyle)) out.push(`style "${cfg.visualStyle}": not available yet (Release 1: ${RELEASE.styles.join(", ")})`);
  if (c.concepts.length < cfg.conceptCount) out.push(`${c.concepts.length} conceptos; se pidieron ${cfg.conceptCount}`);
  const ids = c.concepts.map((x) => x.id);
  if (new Set(ids).size !== ids.length) out.push("two concepts with the same id");
  for (let i = 0; i < c.concepts.length; i++) for (let j = i + 1; j < c.concepts.length; j++) {
    const a = c.concepts[i], b = c.concepts[j];
    if (overlap(a.visualMetaphor, b.visualMetaphor) > 0.5 || overlap(a.creativeThesis, b.creativeThesis) > 0.6) out.push(`concepts ${a.id} and ${b.id} are too alike (same metaphor or thesis); they must be different angles, not paraphrases`);
  }
  if (!ids.includes(c.selected)) out.push(`the selected concept "${c.selected}" doesn't exist`);
  // A concept launches the product (a rental store, a night crew and a pop-up book told stories and were
  // rejected as "not launch videos"): its thesis or its metaphor's mapping names the product or its category.
  const pn = brief?.product?.name?.toLowerCase(), cat = (brief?.product?.category || "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (pn) for (const x of c.concepts) { const t = `${x.creativeThesis} ${x.metaphorMapsTo}`.toLowerCase(); if (!t.includes(pn) && !cat.some((w) => t.includes(w))) out.push(`${x.id}: the thesis and the metaphor name neither the product ("${brief.product.name}") nor its category; a concept launches the product, it doesn't only tell a story`); }
  return out;
}

// ---- shot plan: timing, story, claims, text
const CLAIMY = /\d|%|\b(faster|fastest|best|#1|number one|only|guarantee[sd]?|proven|saves?|saved|instant(?:ly)?|never|always|x times|veces|más rápido|mejor|único|garantiza|ahorra|al instante|nunca|siempre)\b/i;
const wc = (s) => (String(s || "").trim().match(/\S+/g) || []).length;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
export const planEnd = (plan) => plan.shots.reduce((n, s) => Math.max(n, s.start + s.duration), 0);

export function planRules(rawPlan, { brief, concepts, style, reference } = {}) {
  const { data: plan, problems } = parse(ShotPlan, rawPlan, "shot-plan.json");
  if (!plan) return problems;
  const out = [];
  const cfg = concepts?.config, msg = brief?.message;
  const caps = new Set((brief?.capabilities || []).map((c) => c.id));
  const dur = cfg?.durationSeconds ?? plan.durationSeconds;
  if (concepts && plan.conceptId !== concepts.selected) out.push(`the plan is for concept ${plan.conceptId}, but the selected one is ${concepts.selected}`);
  if (plan.durationSeconds !== dur) out.push(`the plan says ${plan.durationSeconds} s and the film was asked for at ${dur} s`);
  if (cfg && plan.fps !== cfg.fps) out.push(`the plan says ${plan.fps} fps and the film was asked for at ${cfg.fps}`);
  // Timing: contiguous, positive, and the sum within ±0.25 s of the length (the edit then lands it to the frame).
  let t = 0;
  for (const s of plan.shots) {
    if (!near(s.start, t, 0.05)) out.push(`${s.id}: starts at ${s.start} s and the previous one ends at ${+t.toFixed(2)} s (no gaps or overlaps)`);
    if (s.duration < 1) out.push(`${s.id}: lasts ${s.duration} s (min 1 s; shorter doesn't read)`);
    if (s.duration > 8) out.push(`${s.id}: lasts ${s.duration} s (max 8 s per shot; split it)`);
    t = s.start + s.duration;
  }
  const sum = plan.shots.reduce((n, s) => n + s.duration, 0);
  if (!near(sum, dur, 0.25)) out.push(`the shots add up to ${+sum.toFixed(2)} s and the film lasts ${dur} s (tolerance ±0.25 s)`);
  const ids = plan.shots.map((s) => s.id);
  if (new Set(ids).size !== ids.length) out.push("two shots with the same id");
  // Beats: about 8-12 for 30 s, most of them in the 2-5 s band (the reference rhythm), adjusted by length.
  const [lo, hi] = [Math.round(dur / 5), Math.round(dur / 2.2)];
  if (plan.shots.length < lo || plan.shots.length > hi) out.push(`${plan.shots.length} shots for ${dur} s (range ${lo}-${hi})`);
  const band = plan.shots.filter((s) => s.duration >= 1.5 && s.duration <= 5.5).length;
  if (band < Math.ceil(plan.shots.length * 0.6)) out.push(`only ${band} of ${plan.shots.length} shots last 2 to 5 s; the reference rhythm needs most of them in that band`);
  // Voice-over: short lines that fit their shot, about 45-65 words for 30 s, measured later on the real audio.
  const voWords = plan.shots.reduce((n, s) => n + wc(s.vo), 0);
  if (cfg && !cfg.voiceover && voWords) out.push("the plan has a voice-over and the film was asked for without one");
  if (cfg?.voiceover && !voWords) out.push("the film was asked for with a voice-over and the plan has no lines");
  // NARRATION SPINE (a strong reference runs about 2.8 words per second of film, voice over nearly all of it, no gap
  // over 1 s; one-line fragments feel disconnected). A narrated film is carried by one
  // continuous narration: every shot but the brand ending speaks, and the density sits near the reference's.
  if (cfg?.voiceover) {
    const cinematic = concepts?.concepts?.find((c) => c.id === plan.conceptId)?.storyMode === "cinematic";
    const ref = reference?.narration?.wordsPerSecondOfFilm;
    const [lo, hi] = ref ? [ref * 0.75, ref * 1.2] : cinematic ? [1.0, 2.0] : [2.0, 3.0];
    const wps = voWords / dur;
    if (wps < lo || wps > hi) out.push(`${voWords} words of narration in ${dur} s (${wps.toFixed(2)} per second; the range is ${lo.toFixed(2)}-${hi.toFixed(2)}${ref ? `, the reference has ${ref}` : ""})`);
    for (const s of plan.shots.slice(0, -1)) if (!s.vo) out.push(`${s.id}: no narration; in a narrated film the voice doesn't stop (only the brand ending may be silent)`);
    for (const s of plan.shots) if (s.vo && wc(s.vo) > Math.floor(s.duration * 3.3) + 2) out.push(`${s.id}: ${wc(s.vo)} words in a ${s.duration} s shot (max ~3.3 per second)`);
  }
  // Every cut has a reason, inside one world, along one thread, under one light.
  for (const [i, s] of plan.shots.entries()) {
    if (!i) continue;
    const prev = plan.shots[i - 1];
    if (!s.connect) { out.push(`${s.id}: doesn't say how it follows ${prev.id} (connect: action, object, push-in, pull-out, same-place or pov, and how)`); continue; }
    const envs = (x) => new Set(x.assets.filter((a) => (style?.environments || []).some((e) => e.id === a)));
    const a = envs(prev), b = envs(s);
    if (s.connect.type === "same-place" && a.size && b.size && ![...b].some((e) => a.has(e))) out.push(`${s.id}: says "same-place" but changes setting; join the places with action, object, push-in, pull-out or pov`);
  }
  // slideup / slidedown read as one camera tilt between two heights of the same place (a board and the desk below
  // it); circles, wipes and sideways slides stay out of this style.
  for (const s of plan.shots) if (s.transitionIn && !["cut", "fade", "ripple", "slideup", "slidedown"].includes(s.transitionIn)) out.push(`${s.id}: transition "${s.transitionIn}"; this style cuts on action, with a short dissolve (≤ 0.35 s) or a vertical tilt between two heights of the same place (slideup/slidedown), never circles or wipes`);
  for (const s of plan.shots) if (["slideup", "slidedown"].includes(s.transitionIn) && s.connect?.type !== "same-place") out.push(`${s.id}: ${s.transitionIn} is a vertical tilt: only between two heights of the same place (connect same-place)`);
  // zoomInto: the camera flies into a screen at the end of a shot and the next shot is what the screen showed.
  for (const [i, s] of plan.shots.entries()) if (s.zoomInto && !["fade", "ripple"].includes(plan.shots[i + 1]?.transitionIn)) out.push(`${s.id}: zoomInto enters the screen; the next shot must come in with a fade`);
  for (const s of plan.shots) if (s.transitionIn === "fade" && s.transitionSecs > 0.35) out.push(`${s.id}: ${s.transitionSecs} s dissolve (max 0.35 s)`);
  if (style) {
    if (!style.thread) out.push("the style bible has no thread (thread: the character or object that leads the cuts, such as the user's hand)");
    else {
      const has = plan.shots.map((s) => s.assets.includes(style.thread));
      const third = Math.ceil(has.length / 3);
      if (has.filter(Boolean).length < Math.ceil(has.length * 0.4)) out.push(`the thread ${style.thread} appears in ${has.filter(Boolean).length} of ${has.length} shots (min 40 %)`);
      if (!has.slice(0, third).some(Boolean) || (!has.slice(-third).some(Boolean) && !plan.threadCloseWaived)) out.push(`the thread ${style.thread} must open and close the film (first and last third)`);
    }
    const TIME = /\b(dawn|sunrise|morning|noon|midday|afternoon|golden hour|late afternoon|sunset|dusk|evening|twilight|night|moonlit)\b/gi;
    const flat = (x) => String(x).toLowerCase().replace(/-/g, " ");
    const allowed = new Set((flat(style.lighting).match(TIME) || []).map(flat));
    for (const s of plan.shots) for (const w of flat(`${s.prompt} ${s.motion || ""}`).match(TIME) || []) if (!allowed.has(w) && ![...allowed].some((x) => x.includes(w))) out.push(`${s.id}: "${w}" changes the time of day; the whole film keeps the style bible's light (${style.lighting})`);
  }
  for (const c of style?.continuity || []) for (const s of plan.shots) {
    const text = `${s.prompt} ${s.motion || ""}`.toLowerCase();
    if (text.includes(c.subject.toLowerCase()) && !text.includes(c.rule.toLowerCase())) out.push(`${s.id}: muestra "${c.subject}" y no repite su regla de continuidad ("${c.rule}")`);
  }
  // A setting seen in two or more generated shots needs a set map: frames drawn one by one otherwise move objects
  // between shots, turn devices around or mirror the whole set.
  for (const e of style?.environments || []) {
    const n = plan.shots.filter((s) => s.source === "generate" && s.assets.includes(e.id)).length;
    if (n >= 2 && !e.map) out.push(`the setting ${e.id} appears in ${n} shots and has no set map (environments[].map: the camera side and where every object sits on screen)`);
    // An object placed without its look is redrawn differently in every frame, even with a props sheet attached.
    for (const i of e.map?.items || []) if (n >= 2 && !i.look) out.push(`the setting ${e.id}: "${i.name}" has no look in the set map (copy its exact design from the props or set sheet)`);
    // Every setting seen in two or more shots has its own sheet (angles, floor plan, or the props with their states):
    // without one, each frame redesigns the place.
    if (n >= 2 && !e.ref) out.push(`the setting ${e.id} appears in ${n} shots and has no sheet (environments[].ref: a set or props sheet made for this film)`);
  }
  for (const [k, s] of plan.shots.entries()) {
    if (s.source !== "generate") continue;
    const people = (style?.characters || []).some((c) => s.assets.includes(c.id));
    // Granular prompts: the frame prompt names the camera and the framing and runs long enough to leave nothing to chance.
    const words = s.prompt.trim().split(/\s+/).length;
    if (words < 60) out.push(`${s.id}: the frame prompt has ${words} words; write it granular (at least 60: camera height, side and lens, framing, every object's place and state, pose, exclusions)`);
    if (!/\b(camera|lens|\d+\s?mm)\b/i.test(s.prompt)) out.push(`${s.id}: the frame prompt doesn't place the camera (height, side, lens)`);
    // Characters act: a shot with people carries a performance direction, or the model gives stiff, slow motion.
    if (people && (!s.acting || s.acting.trim().split(/\s+/).length < 8)) out.push(`${s.id}: a shot with people needs an acting direction (shot.acting, at least 8 words: gestures, expression, weight shifts, energy)`);
    // One fluid piece: two shots in a row in the same setting join frame to frame (chain "exact"), unless the
    // creator asked for a transition in words.
    const prev = plan.shots[k - 1];
    const shared = prev && prev.source === "generate" && s.assets.some((a) => (style?.environments || []).some((e) => e.id === a) && prev.assets.includes(a));
    if (shared && s.chain !== "exact" && !s.transitionAsked) out.push(`${s.id}: follows ${prev.id} in the same setting; chain it frame to frame (chain "exact": it starts on ${prev.id}'s last frame) so the cut disappears`);
    if (shared && s.chain === "exact" && !prev.end) out.push(`${prev.id}: ${s.id} starts on its last frame, so ${prev.id} needs a choreographed end (shot.end)`);
  }
  // Rhythm: the film cuts as often as the chosen reference (average shot no longer than 1.5x the reference's); fewer,
  // longer shots read slow even when each one moves.
  if (reference?.avgShot) {
    const gen = plan.shots.filter((s) => s.source !== "card");
    const avgShot = gen.reduce((n, s) => n + s.duration, 0) / Math.max(1, gen.length);
    if (avgShot > reference.avgShot * 1.5) out.push(`shots average ${avgShot.toFixed(2)} s; the reference averages ${reference.avgShot} s, so keep them under ${(reference.avgShot * 1.5).toFixed(2)} s (split long beats into more chained shots)`);
  }
  // Copy structure (the reference method): the first line names the viewer's pain without the product, the product is
  // named before the middle of the film, and the last line carries the brand or the call to action.
  const pname = (brief?.product?.name || "").toLowerCase();
  const spoken = plan.shots.filter((s) => s.vo);
  if (pname && spoken.length >= 3) {
    if (spoken[0].vo.toLowerCase().includes(pname)) out.push(`${spoken[0].id}: the first line names ${brief.product.name}; open on the viewer's pain, the product comes after`);
    const first = spoken.find((s) => s.vo.toLowerCase().includes(pname));
    const total = plan.durationSeconds || plan.shots.reduce((n, s) => n + s.duration, 0);
    if (!first || first.start > total / 2) out.push(`${brief.product.name} is not named before the middle of the film (${(total / 2).toFixed(1)} s)`);
    const last = spoken.at(-1).vo.toLowerCase(), cta = (brief.cta?.label || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (!last.includes(pname) && !cta.some((w) => last.includes(w))) out.push(`${spoken.at(-1).id}: the last line carries neither ${brief.product.name} nor the call to action`);
  }
  // The narration reads at an 8th-grade level or below (Flesch-Kincaid), so it sounds like a person talking.
  const voText = plan.shots.map((s) => s.vo || "").join(" ").trim();
  if (voText) {
    const sents = Math.max(1, (voText.match(/[.!?]+(\s|$)/g) || []).length), wordsV = voText.split(/\s+/).filter(Boolean);
    const syl = (w) => { const x = w.toLowerCase().replace(/[^a-z]/g, ""); if (!x) return 0; const m = x.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1); };
    const grade = 0.39 * (wordsV.length / sents) + 11.8 * (wordsV.reduce((n, w) => n + syl(w), 0) / wordsV.length) - 15.59;
    if (grade > 8.5) out.push(`the narration reads at grade ${grade.toFixed(1)}; rewrite it at an 8th-grade level or below (short sentences, everyday words)`);
  }
  // The style bible sets the brightness every shot is graded to (dark frames read cheap and lose the characters).
  if (style && !(style.grade && style.grade.brightness >= 85)) out.push("the style bible has no brightness floor (grade.brightness, 85 or more)");
  // The brand ending breathes: at least 3.5 s on screen.
  const end = plan.shots.at(-1);
  if (end.role === "brand" && end.duration < 3.5) out.push(`${end.id}: the brand ending lasts ${end.duration.toFixed(2)} s (min 3.5 s so it can breathe)`);
  // A score under a narration says how it leaves room for the voice; what that takes depends on the film.
  if (cfg?.voiceover && cfg?.music && plan.musicBrief && !plan.musicBrief.voiceRoom?.trim()) out.push("musicBrief.voiceRoom: say how the music leaves room for the narration (density, register, dynamics under the lines)");
  // Exact text is composited by the engine, never drawn by the video or image model.
  for (const s of plan.shots) {
    if (/"[^"]{2,}"|“[^”]{2,}”/.test(s.prompt)) out.push(`${s.id}: the prompt asks for quoted text; the engine composites exact text (shot.text), not the model`);
    if (/\b(logo|lettering|caption|subtitle|headline|the words|that reads|reading)\b/i.test(s.prompt)) out.push(`${s.id}: the prompt asks the model for letters or a logo; they go in shot.text / shot.logo`);
    if (s.source !== "card" && !s.prompt.trim()) out.push(`${s.id}: no image prompt`);
    if (s.source === "generate" && !s.motion?.trim()) out.push(`${s.id}: no animation direction (shot.motion)`);
    if (s.source === "generate") {
      // The animation is choreographed here, never left to the video model: a physical action with a cause, an end
      // state drawn as the last frame, and what stays still.
      const locked = /\blocked\b/i.test(s.camera);
      if (!locked && wc(s.end) < 8) out.push(`${s.id}: no choreographed end (shot.end: what the last frame shows, at least 8 words)`);
      if (!s.still.length) out.push(`${s.id}: doesn't say what stays still (shot.still)`);
      const m = s.motion || "";
      const vague = m.match(/\b(comes? alive|bustles?|bustling|magically|magic|sparkles?|swirls?|faster and faster|keeps? (?:fluttering|falling|coming)|out of nowhere)\b/i);
      if (vague) out.push(`${s.id}: "${vague[0]}" lets the model invent; describe the exact physical action`);
      if (/\b(from above|from the top of the frame|from the sky)\b/i.test(m) && !/\b(hand|held|holding)\b/i.test(m)) out.push(`${s.id}: something falls "from above" with no visible cause; say what moves it`);
      if (/\b(falls?|drops?|rolls?|slides?|flutters?|tumbles?|pours?|tips?)\b/i.test(m) && !/\b(into|onto|on|in|inside|lands?)\b/i.test(s.end || "")) out.push(`${s.id}: something falls or rolls and the end doesn't say where it lands (into/onto ...)`);
    }
    // EVERYTHING MOVES: no still with a zoom, no flat card. Every shot is an animated generation;
    // exact text and the logo are composited over moving picture.
    if (s.source !== "generate") out.push(`${s.id}: is "${s.source}"; in a launch film every shot is animated (source generate), never a zoomed still or a flat card`);
    if (s.inserts.length && !/\b(locked|static camera|camera (?:does not|doesn't|never) move|tripod)\b/i.test(`${s.camera} ${s.motion || ""}`)) out.push(`${s.id}: carries real footage inside screens; the camera must stay fixed (camera "locked") so the clips stay inside the screens`);
    if (s.inserts.length && !/\b(?:solid |pure )?bright green\b/i.test(s.prompt)) out.push(`${s.id}: carries real footage; the prompt must ask for the screens in solid bright green (the clip goes there)`);
    for (const o of s.text) {
      const n = wc(o.text), max = o.kind === "ui" ? 14 : 8;
      if (n > max) out.push(`${s.id}: the text "${o.text}" has ${n} words (max ${max} for ${o.kind})`);
      const on = Math.min(o.until ?? s.duration, s.duration) - o.at;
      if (on < 0.6 + 0.25 * n) out.push(`${s.id}: "${o.text}" stays ${+on.toFixed(2)} s on screen (it needs ${+(0.6 + 0.25 * n).toFixed(2)} s to be read)`);
    }
    // Claims: a number, a superlative or a promise of speed needs a capability from the brief behind it.
    const said = [s.vo, ...s.text.map((o) => o.text)].filter(Boolean).join(" ");
    if (s.claim && brief && !caps.has(s.claim)) out.push(`${s.id}: the claim points to "${s.claim}", which is not a capability in the brief`);
    // A feature the product doesn't have is never said or shown.
    for (const d of brief?.doesNot || []) { const w = d.words.find((x) => wordIn(x, `${said} ${s.prompt || ""}`)); if (w) out.push(`${s.id}: "${w}" promises something the product doesn't do (${d.what})`); }
    if (CLAIMY.test(said) && !s.claim) out.push(`${s.id}: "${said.slice(0, 60)}" claims something measurable; point it to a verified capability (shot.claim) or remove it`);
    // Continuity: every drawn shot lives in an environment of the style bible, and its assets exist there.
    if (style && s.source !== "card") {
      const known = new Set([...(style.characters || []).map((c) => c.id), ...(style.environments || []).map((e) => e.id)]);
      for (const a of s.assets) if (!known.has(a)) out.push(`${s.id}: the asset "${a}" is not in the style bible`);
      if (!s.assets.some((a) => (style.environments || []).some((e) => e.id === a))) out.push(`${s.id}: doesn't say which style bible setting it happens in (assets)`);
    }
  }
  // Story by intent. Brand: curiosity → friction → possibility → behavior → better reality → branded ending.
  // Conversion: pain → consequence → solution → demo → proof → a direct next step.
  const roles = plan.shots.map((s) => s.role), last = plan.shots.at(-1), first = plan.shots[0];
  const proofShot = plan.shots.find((s) => s.role === "proof" || s.claim === msg?.proofCapability);
  if (!proofShot) out.push("no shot shows the proof (role proof, or shot.claim = message.proofCapability)");
  else if (msg && proofShot.claim !== msg.proofCapability) out.push(`the proof shot ${proofShot.id} doesn't point to the proof capability (${msg.proofCapability})`);
  // Every point the creator said the film must make is said: a main job left out undersells the product.
  const allVo = plan.shots.map((s) => [s.vo, ...(s.text || []).map((o) => o.text)].filter(Boolean).join(" ")).join(" ");
  for (const m of brief?.mustSay || []) if (!m.words.some((w) => wordIn(w, allVo))) out.push(`the script never says "${m.what}" (the creator wants it in every film; none of: ${m.words.join(", ")})`);
  if (!roles.some((r) => ["interaction", "demo"].includes(r))) out.push("no shot shows the product in action (role interaction or demo)");
  const name = brief?.product?.name || style?.brand?.name;
  const named = (s) => s.logo || (name && s.text.some((o) => o.text.toLowerCase().includes(name.toLowerCase())));
  const tail = plan.shots.filter((s) => s.start + s.duration > dur - 4.01);
  if (!tail.some(named)) out.push(`the brand doesn't appear in the last 4 s (logo or "${name || "the name"}" on screen)`);
  if (cfg?.intent === "conversion" || concepts?.concepts?.find((c) => c.id === plan.conceptId)?.storyMode === "performance") {
    if (!["hook", "problem", "friction"].includes(first.role)) out.push(`conversion: the first shot must open on the pain (role hook, problem or friction), not on ${first.role}`);
    if (!(first.vo || first.text.length) && !(plan.shots[1] && plan.shots[1].start < 3 && (plan.shots[1].vo || plan.shots[1].text.length))) out.push("conversion: the pain must be said or read within 3 s");
    const cta = brief?.cta?.label;
    if (!(last.role === "cta" && last.text.some((o) => o.kind === "cta" && (!cta || o.text.toLowerCase().includes(cta.toLowerCase()))))) out.push(`conversion: the last shot is the visible CTA ("${cta || "CTA"}" as text of kind cta)`);
  } else if (!["brand", "cta"].includes(last.role)) out.push(`brand: the film ends on the brand (role brand or cta), not on ${last.role}`);
  // Outcome before the brand, proof before the outcome: show the result before explaining it is fine, but the
  // ending pays it off.
  const at = (r) => roles.lastIndexOf(r);
  if (at("outcome") > -1 && at("brand") > -1 && at("outcome") > at("brand")) out.push("the outcome comes after the brand; the brand closes");
  if (cfg?.music && !plan.musicPrompt?.trim()) out.push("the film has music and the plan has no musicPrompt");
  if (cfg?.music && !plan.musicBrief) out.push("the film has music and no musicBrief: analyze the premise, the emotion to evoke, the context and the narrator, derive the approach (instruments, tempo, energy and why), and tie its turns to the script before the musicPrompt");
  else if (cfg?.music && plan.musicBrief.turns.length < 2) out.push("musicBrief.turns: tie at least two turns of the music to the script's lines (at = seconds)");
  else if (cfg?.music) for (const t of plan.musicBrief.turns) if (t.at > plan.durationSeconds) out.push(`musicBrief: a turn at ${t.at} s is past the film's end`);
  // Every launch film rule is checked here, for any video model.
  // FILM GRAMMAR. Two shots in the same place either continue one unbroken shot (chain "exact": the next take opens
  // on the previous take's real last frame) or cut to a visibly different view (another shot size or camera angle;
  // "same-set" keeps the set and takes the new framing). The same place, size and angle again is a jump cut.
  const envOf = (x) => new Set(x.assets.filter((a) => (style?.environments || []).some((e) => e.id === a)));
  const gen = plan.shots.filter((s) => s.source === "generate");
  for (const s of gen) if (shotSize(s) == null) out.push(`${s.id}: shotType "${s.shotType}" names no shot size (extreme wide, wide, medium wide, medium, medium close-up, close-up, extreme close-up or insert)`);
  for (const [i, s] of plan.shots.entries()) {
    if (!i) { if (s.chain && s.chain !== "cut") out.push(`${s.id}: the first shot has no previous shot to chain to`); continue; }
    const prev = plan.shots[i - 1], a = envOf(prev), through = prev.zoomInto || (s.transitionIn && s.transitionIn !== "cut"); // flying into a screen changes place
    const same = s.connect?.type === "same-place" || (!through && [...envOf(s)].some((e) => a.has(e)));
    if (same && s.chain !== "exact" && s.source === "generate" && prev.source === "generate" && !newView(prev, s)) out.push(`${s.id}: the same place, shot size and camera angle as ${prev.id}: a jump cut. Cut to another size (at least one step: wide, medium, close-up, insert) or another angle, or continue ${prev.id} in one unbroken shot (chain "exact")`);
    if (s.chain === "exact" && !prev.end?.trim()) out.push(`${s.id}: chain "exact" starts on ${prev.id}'s last frame, and ${prev.id} has no choreographed end (shot.end)`);
    if (s.chain === "exact" && s.transitionIn && s.transitionIn !== "cut") out.push(`${s.id}: chain "exact" is an invisible cut; it takes no transition`);
  }
  // A pull-back needs room: opening on an extreme wide, the video model first pushes in to have somewhere to pull back from.
  for (const s of gen) if (/\bpull(?:s|ing)?[- ]?(?:back|out)\b|\bdolly[- ]out\b|\bzoom[- ]out\b/i.test(s.camera || "") && shotSize(s) === 0) out.push(`${s.id}: a "${s.camera}" that opens on an extreme wide: the model pushes in first to have somewhere to pull back from. Open closer (wide or tighter, on the subject) and let the move end on the extreme wide, or use another move`);
  // Variety: a film is built from different views. Three or more shot sizes once it has six generated shots, and never
  // more than three shots in a row at one size (a long unbroken shot has to move the camera to change its size).
  if (gen.length >= 6 && new Set(gen.map(shotSize).filter((x) => x != null)).size < 3) out.push(`the film uses ${new Set(gen.map(shotSize).filter((x) => x != null)).size} shot size(s); use at least three (wide, medium, close-up, insert) so the cuts read as editing, not repetition`);
  for (let i = 3; i < plan.shots.length; i++) {
    const run = plan.shots.slice(i - 3, i + 1);
    if (run.every((x) => x.source === "generate") && new Set(run.map(shotSize)).size === 1) out.push(`${run.map((x) => x.id).join(", ")}: four shots in a row at the same size; change the size (a cut, or a camera move inside an unbroken shot)`);
  }
  // NO TRANSITION, ZOOM, EFFECT OR TEXT THE CREATOR DID NOT ASK FOR (a slide-up nobody asked for was rejected).
  for (const s of plan.shots) if (s.transitionIn && s.transitionIn !== "cut" && !s.transitionAsked?.said?.trim()) out.push(`${s.id}: transition "${s.transitionIn}" without the creator's words asking for it (transitionAsked.said)`);
  for (const s of plan.shots) if (s.zoomInto && !s.zoomInto.said?.trim()) out.push(`${s.id}: zoomInto without the creator's words asking for it (zoomInto.said)`);
  for (const [n, d] of Object.entries(plan.sfx || {})) if (!d.said?.trim()) out.push(`effect "${n}" without the creator's words asking for or approving it (sfx.${n}.said)`);
  for (const s of plan.shots) for (const o of s.text) if (o.kind !== "cta" && !o.said?.trim()) out.push(`${s.id}: the creator didn't ask for the text "${o.text}" (text.said); unasked, only the brand and the CTA go on screen`);
  // NOTHING IDLES: every character in an animated shot does something named in its motion.
  for (const s of plan.shots) if (s.source === "generate" && !/\blocked\b/i.test(s.camera || "")) for (const a of s.assets) {
    let c; try { c = P.character(a); } catch { continue; }
    if (c.species === "set") continue;
    const names = [c.name, ...(c.aliases || []), /hand/i.test(`${a} ${c.name}`) ? "hand" : null].filter(Boolean).map((x) => x.toLowerCase());
    if (!names.some((n) => (s.motion || "").toLowerCase().includes(n))) out.push(`${s.id}: ${c.name} is in frame and the animation doesn't say what they do (nothing stays still without a reason; name it in shot.motion)`);
  }
  // NOTHING FALLS NEAR A PILE: video models animate piles on their own (cards turned see-through, tapes jumped out).
  for (const s of plan.shots) if (/\b(falls?|drops?|tumbles?|spills?|slides? down)\b/i.test(s.motion || "") && /\b(pile|stack|heap|full of|crowded)\b/i.test(`${s.prompt} ${s.motion || ""}`)) out.push(`${s.id}: something falls next to a pile; video models animate piles on their own; remove the fall or the pile`);
  // THE PAIN IS READABLE BY 8 S (a metaphor so clever the viewer can't tell the problem fails).
  if (!plan.shots.some((s) => s.start < 8 && ["hook", "friction", "problem"].includes(s.role))) out.push("no shot shows the pain before 8 s (role hook, friction or problem)");
  // ONE HAND PER SHOT and ONE ACTION PER SHOT (extra hands appeared; four characters moving at once looked rushed).
  const handThread = /hand/i.test(style?.thread || "");
  for (const s of plan.shots) if (handThread && s.assets.includes(style.thread) && /\b(two hands|another hand|second hand|other hand|two arms)\b/i.test(`${s.prompt} ${s.motion || ""}`)) out.push(`${s.id}: one hand per shot; models invent extra hands`);
  const acts = (m) => m.split(/;|\bthen\b/i).map((x) => x.trim()).filter((x) => x && !/^the camera\b/i.test(x) && !/\b(move|moves) gently|at a natural pace|stays? (still|in place)\b/i.test(x));
  for (const s of plan.shots) if (s.source === "generate" && acts(s.motion || "").length > 3) out.push(`${s.id}: more than three actions in one shot; one defined action per shot (split it)`);
  // THE FIRST SECOND HOOKS.
  const f0 = plan.shots[0];
  // The eye decides before the ear: the opening shows something happen in the first 3 s (an action, a change,
  // a surprise on screen), not only a camera moving over a scene.
  if (f0 && !f0.visualHook) out.push(`${f0.id}: name the visual hook (visualHook: what happens on screen, at ≤ 3 s) that makes people look`);
  else if (f0 && f0.visualHook.at > 3) out.push(`${f0.id}: the visual hook lands at ${f0.visualHook.at} s; it has to land in the first 3 s`);
  else if (f0 && /^\s*(the )?camera\b/i.test(f0.visualHook.what) && !/\b(and|while|as)\b/i.test(f0.visualHook.what)) out.push(`${f0.id}: a camera move alone is not a visual hook; something in the picture has to happen`);
  if (f0 && !["hook", "friction", "problem"].includes(f0.role)) out.push(`${f0.id}: the first shot hooks (role hook, friction or problem), not ${f0.role}`);
  if (f0?.vo && f0.voAt > 0.5) out.push(`${f0.id}: the voice comes in at ${f0.voAt} s; the first second hooks (max 0.5 s)`);
  for (const s of plan.shots) for (const x of s.sfx) { const n = typeof x === "string" ? x : x.name; if (!plan.sfx[n]) out.push(`${s.id}: the effect "${n}" is not defined in plan.sfx`); }
  return out;
}

// ---- style bible: locked look, real files
export function styleRules(raw, { slug, cast = [], plan = null } = {}) {
  const { data: st, problems } = parse(StyleBible, raw, "style-bible.json");
  if (!st) return problems;
  const out = [];
  const abs = (f) => (path.isAbsolute(f) ? f : path.join(P.projectDir(slug), f));
  if (st.brand.logo && slug && !fs.existsSync(abs(st.brand.logo))) out.push(`the logo ${st.brand.logo} doesn't exist`);
  if (st.text.fontFile && slug && !fs.existsSync(abs(st.text.fontFile))) out.push(`the font ${st.text.fontFile} doesn't exist`);
  // An image model draws one moment: a conditional state ("black until he goes live") gets drawn as its first half.
  for (const e of st.environments) for (const i of e.map?.items || []) if (/\b(until|only after|once he|once she|when he|when she|after he|after she|before he|before she)\b/i.test(i.state || "")) out.push(`${e.id} map: "${i.name}" has a conditional state ("${i.state}"); write what it shows in one frame and put changes in shot.state / shot.endState`);
  for (const e of st.environments) for (const i of e.map?.items || []) for (const c of i.changes || []) if (plan && !plan.shots.some((x) => x.id === c.from.split(":")[0])) out.push(`${e.id} map: "${i.name}" changes at ${c.from}, which is not a shot of the plan`);
  // Every screen in a set says what it shows: a screen without a state was drawn as anything, and the judge rejected it.
  const SCREEN = /\b(monitor|screen|phone|tablet|laptop|tv|television|display|computer)\b/i;
  for (const e of st.environments) for (const i of e.map?.items || []) if (SCREEN.test(i.name) && !i.state?.trim()) out.push(`${e.id} map: "${i.name}" is a screen with no state; say what it shows in the first shot and add changes for every shot where it shows something else`);
  // A shot with a screen insert opens on the green; the timeline must say so, or the frame is drawn with the old screen.
  if (plan) {
    const order = plan.shots.map((x) => x.id);
    const stateAt = (i, id) => { let v = i.state || ""; for (const c of i.changes || []) { const [cid, w] = c.from.split(":"), j = order.indexOf(cid), k = order.indexOf(id); if (j < k || (j === k && w === "first")) v = c.state; } return v; };
    for (const s of plan.shots.filter((x) => x.inserts?.length)) for (const e of st.environments.filter((x) => (s.assets || []).includes(x.id) && x.map)) {
      const screens = e.map.items.filter((i) => SCREEN.test(i.name));
      if (screens.length && !screens.some((i) => /green/i.test(s.state?.[i.name] || stateAt(i, s.id)))) out.push(`${s.id} has a screen insert, but no screen of ${e.id} is green at its first frame; add a change to green from ${s.id}:first (and back after the insert)`);
    }
  }
  for (const e of st.environments) if (e.anchor && slug && !fs.existsSync(abs(e.anchor))) out.push(`the anchor frame of ${e.id} doesn't exist: ${e.anchor}`);
  for (const e of st.environments) if (e.ref && slug && !fs.existsSync(abs(e.ref))) out.push(`the setting image ${e.id} doesn't exist: ${e.ref}`);
  // The style bible's preset is a style launch films can use, and a custom one passes its own rules.
  if (!launchStyles().includes(st.preset)) out.push(`the style "${st.preset}" is not available for launch films (${launchStyles().join(", ")}, or your own with launch.mjs style-from-refs)`);
  else { try { out.push(...customStyleRules(P.style(st.preset))); } catch (e) { out.push(e.message); } }
  for (const c of st.characters) {
    try { P.character(c.id); } catch { out.push(`the character ${c.id} is not in the bible (bible/characters/${c.id}); create it with cast.mjs`); }
    if (cast.length && !cast.includes(c.id)) out.push(`the character ${c.id} is in the style bible but not in the project's cast`);
  }
  return out;
}

// ---- the plan becomes the shotlist the engine films (lib/flow.mjs, gen.mjs frame/clip)
// generate: a first frame + an animated clip. still: a first frame moved by the editor (slow push). card: a
// deterministic graphic (brand, UI, CTA) the editor draws. Generated shots are filmed a little longer than planned;
// the edit cuts each one to its exact frame count.
const genSecs = (d) => Math.min(8, Math.max(4, Math.ceil(d + 0.5)));
// The set map of every setting in the shot, written the same way into each frame and clip prompt.
// A whole word or phrase in a text (letter boundaries, so accented words match too).
export const wordIn = (w, text) => new RegExp(`(?<!\\p{L})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "iu").test(text);

export function setMapText(st, s) {
  const maps = (st.environments || []).filter((e) => e.map && (s.assets || []).includes(e.id));
  return maps.map((e) => `Fixed set map of ${e.name}, identical in every shot and never mirrored or flipped: ${e.map.camera}. ${e.map.items.map((i) => `${i.name}${i.look ? ` (${i.look}, exactly as on the props sheet)` : ""}: ${i.at}${i.facing ? `, facing ${i.facing}` : ""}${(s.state?.[i.name] ?? i.state) ? `, ${s.state?.[i.name] ?? i.state}` : ""}`).join("; ")}.${Object.keys(s.endState || {}).length && s.withEnd ? ` By the end of the shot: ${Object.entries(s.endState).map(([k, v]) => `${k}: ${v}`).join("; ")}.` : ""}`).join(" ");
}
// cast: [{ name, look }] of the bible characters in the shot. Their locked look goes into the prompt with their sheet
// as the reference, and nobody else may appear (otherwise frames add strangers).
export function framePrompt(st, look, s, cast = []) {
  const pal = st.palette.join(", ");
  const who = cast.length ? `Characters, exactly as in the reference sheet${cast.length > 1 ? "s" : ""} (same faces, hair, clothes and colors): ${cast.map((c) => `${c.name}: ${c.look}`).join("; ")}. No other people and no animals anywhere in the frame.` : "No people and no animals anywhere in the frame.";
  return [look, s.prompt.trim().replace(/\.?$/, "."), setMapText(st, s), who, `Art direction: ${st.artStyle}; ${st.line}; ${st.texture}; ${st.lighting}${st.colorTemp ? `, ${st.colorTemp}` : ""}; depth: ${st.depth}. Palette: ${pal}.`,
    s.composition ? `Composition: ${s.composition}.` : "", s.layers ? `Layers: ${s.layers}.` : "",
    `Never: ${[...st.negative, s.negative].filter(Boolean).join(", ")}.`, "No text, no letters, no numbers, no logos anywhere in the frame.",
    s.inserts?.length ? `Exactly ${s.inserts.length} screen${s.inserts.length > 1 ? "s" : ""}, each filled edge to edge with one flat solid bright green (#00FF00), no reflections, no glare, nothing drawn on ${s.inserts.length > 1 ? "them" : "it"}; nothing else in the picture is green: every other screen (phones, tablets, other monitors) stays exactly as described, dark or showing its own picture, never green.` : ""].filter(Boolean).join(" ");
}
// shot.acting: a performance direction for the people in the shot. The style's "small actions" rule makes people
// stiff, so with acting the people move fully and naturally while the set, objects and identities stay locked.
export function clipPromptOf(st, motionRule, s) {
  const acting = s.acting?.trim();
  return [s.motion.trim().replace(/\.?$/, "."), setMapText(st, { ...s, withEnd: true }), acting ? `Acting: ${acting.replace(/\.?$/, ".")} The people are fully alive, like real actors in a real conversation: expressive faces, real reactions to each other, natural breathing, weight shifts, head turns and hand gestures with intention; never a frozen pose or a mouth that only moves.` : "",
    s.end ? `The shot ends exactly on the last frame image: ${s.end.trim().replace(/\.?$/, ".")}` : "",
    `Camera: ${s.camera}.`, s.still?.length ? `These stay exactly as they are and do not move: ${s.still.join("; ")}.` : "",
    acting ? "The set, the frames and every object move only as described. Nobody and nothing appears, disappears, multiplies or slides out of the frame; no people, hands or creatures that are not described; faces, hair and clothes never change."
      : "Only what is described moves. Nobody and nothing appears, disappears, multiplies, sinks into the ground or slides out of the frame unless described; no people, hands or creatures that are not described.",
    acting ? "" : motionRule || "", `Keep the exact drawing style, line, palette and characters of the first frame; ${st.camera}.`,
    "No text, no letters, no logos. No cuts inside the shot. No dialogue: nobody speaks."].filter(Boolean).join(" ");
}
export function toShots(plan, st, styleDef, cast = []) {
  const chars = new Set(cast);
  const envRef = (s) => s.assets.flatMap((a) => { const e = st.environments.find((x) => x.id === a); return [e?.anchor, e?.ref]; }).filter((f, i, all) => f && all.indexOf(f) === i);
  // The set map's timeline: each item's state at this shot's first and last frame (a shot's own state wins).
  const order = plan.shots.map((x) => x.id);
  const timed = (s) => {
    const k = order.indexOf(s.id), at = {}, end = {};
    for (const e of st.environments || []) if ((s.assets || []).includes(e.id)) for (const i of e.map?.items || []) for (const c of i.changes || []) {
      const [id, w] = c.from.split(":"), j = order.indexOf(id);
      if (j < k || (j === k && w === "first")) at[i.name] = c.state;
      if (j <= k) end[i.name] = c.state;
    }
    return { ...s, state: { ...at, ...s.state }, endState: { ...Object.fromEntries(Object.entries(end).filter(([n, v]) => at[n] !== v)), ...s.endState }, mapState: { first: { ...at, ...s.state }, last: { ...end, ...s.state, ...s.endState } } };
  };
  return plan.shots.map(timed).map((s) => ({
    id: s.id, source: s.source, role: s.role, summary: s.beat, planned: { start: s.start, duration: s.duration },
    // The chain decides how the first frame is made (copied from the previous last frame, or drawn from it).
    ...(s.chain ? { chain: s.chain } : {}),
    ...(s.end ? { end: s.end } : {}),
    // Each set-map item's state at this shot's first and last frame, for the frame judge.
    mapState: s.mapState,
    duration: s.source === "generate" ? genSecs(s.duration) : s.duration,
    characters: s.assets.filter((a) => chars.has(a)),
    refs: envRef(s),
    ...(s.inserts.length ? { inserts: s.inserts } : {}),
    ...(s.source !== "card" ? { framePrompt: framePrompt(st, styleDef?.look || "", s, s.assets.filter((a) => chars.has(a)).map((id) => { const c = P.character(id); return { name: c.name, look: c.look }; })) } : {}),
    ...(s.source === "generate" ? { prompt: clipPromptOf(st, styleDef?.motion, s), audioMode: "silent" } : {}),
    // The last frame: the same scene and characters at the shot's end state (drawn with the first frame as reference).
    ...(s.source === "generate" && s.end && !/\blocked\b/i.test(s.camera) ? { lastPrompt: framePrompt(st, styleDef?.look || "", { ...s, state: { ...s.state, ...s.endState }, prompt: `The same scene a few seconds later, the same framing${/push|pull/i.test(s.camera) ? ` after the camera's ${s.camera}` : ""}: ${s.end}` }, s.assets.filter((a) => chars.has(a)).map((id) => { const c = P.character(id); return { name: c.name, look: c.look }; })) } : {}),
    dialogue: [],
  }));
}

// ---- final QC: the composited text, read back from the frames (the engine draws it; this proves it landed)
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export async function textCheck(file, overlays) {
  if (!overlays.length) return { pass: true, issues: [], read: [] };
  const { execFileSync } = await import("node:child_process");
  const grab = (t) => execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");
  const { json } = await judgeJSON([
    { type: "text", text: `These are ${overlays.length} frames of a video. Each one should show overlaid text. For each frame, transcribe exactly the overlaid text you can read (titles, labels, buttons, a call to action), character by character, and say whether it is fully legible. JSON only: {"frames":[{"frame":1,"text":"...","legible":true}]}` },
    ...overlays.flatMap((o, k) => [{ type: "text", text: `Frame ${k + 1}` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: grab(o.t) } }]),
  ], { maxTokens: 3000 });
  const issues = [], read = [];
  overlays.forEach((o, k) => {
    const r = (json.frames || []).find((x) => x.frame === k + 1) || {};
    read.push({ t: o.t, want: o.text, got: r.text || "", legible: !!r.legible });
    if (!norm(r.text).includes(norm(o.text))) issues.push(`text at ${o.t.toFixed(2)} s: asked for "${o.text}", reads "${r.text || "nothing"}"`);
    else if (r.legible === false) issues.push(`texto en ${o.t.toFixed(2)} s: "${o.text}" no se lee bien`);
  });
  return { pass: !issues.length, issues, read };
}

// ---- quality report: editorial heuristics, tied to the exact final file
export function qualityRules(raw, sha) {
  const { data: q, problems } = parse(QualityReport, raw, "quality-report.json");
  if (!q) return problems;
  const out = [];
  if (q.sha !== sha) out.push("the quality report is for another version of the final; watch the final and write it again");
  for (const k of SCORE_KEYS) if (!q.reasons[k]?.trim()) out.push(`quality report: the reason for ${k} is missing`);
  for (const k of SCORE_KEYS) if (q.scores[k] <= 2) out.push(`quality report: ${k} ${q.scores[k]}/5 (${q.reasons[k] || "no reason"})`);
  for (const f of q.findings.filter((x) => x.severity === "blocker")) out.push(`bloqueo${f.timestampSeconds != null ? ` en ${f.timestampSeconds} s` : ""}${f.shotId ? ` (${f.shotId})` : ""}: ${f.detail}`);
  return out;
}
export { SCORE_KEYS };
