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
export const PlannedShot = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/), start: z.number().min(0), duration: z.number().positive(),
  role: z.enum(ROLES), beat: str, takeaway: str,
  source: z.enum(["generate", "still", "card"]),
  visual: str, subject: z.string().optional(), action: str, shotType: str, camera: str,
  composition: z.string().optional(), layers: z.string().optional(), continuity: z.array(z.string()).default([]),
  vo: z.string().optional(), voDirection: z.string().optional(), acting: z.string().optional(), visualHook: z.object({ what: z.string().min(10), at: z.number().min(0) }).optional(), voAt: z.number().min(0).default(0.15), text: z.array(Overlay).default([]), logo: z.boolean().default(false), logoAt: z.number().min(0).optional(), ui: z.string().optional(),
  sfx: z.array(Sfx).default([]), music: z.enum(["low", "mid", "high"]).default("mid"),
  // The transition into this shot from the previous one (xfade names; "cut" or none is a hard cut).
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
  musicBrief: z.object({ premise: z.string().min(3), emotion: z.string().min(3), context: z.string().min(3), narrator: z.string().optional(), approach: z.object({ instruments: z.string().min(3), tempo: z.string().min(1), energy: z.string().min(3), why: z.string().min(10) }), voiceRoom: z.string().optional(), turns: z.array(z.object({ at: z.number().min(0), line: z.string().optional(), music: z.string().min(3) })).default([]) }).optional(),
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
  environments: z.array(z.object({ id: z.string().regex(/^[\w-]+$/), name: str, layout: str, props: z.array(z.string()).default([]), ref: z.string().optional() })).min(1),
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
  // ONE CONTINUOUS STORY: two shots in the same place are one set. "exact" starts on the previous shot's drawn last
  // frame (gen.mjs frame copies it, free); "same-set" is drawn from the previous shot's frame, same framing.
  const envOf = (x) => new Set(x.assets.filter((a) => (style?.environments || []).some((e) => e.id === a)));
  for (const [i, s] of plan.shots.entries()) {
    if (!i) { if (s.chain && s.chain !== "cut") out.push(`${s.id}: the first shot has no previous shot to chain to`); continue; }
    const prev = plan.shots[i - 1], a = envOf(prev), through = prev.zoomInto || (s.transitionIn && s.transitionIn !== "cut"); // flying into a screen changes place
    const same = s.connect?.type === "same-place" || (!through && [...envOf(s)].some((e) => a.has(e)));
    if (same && !["exact", "same-set"].includes(s.chain)) out.push(`${s.id}: happens in the same place as ${prev.id}; chain it (chain "exact": starts on ${prev.id}'s last frame; "same-set": drawn from ${prev.id}'s frame, same set and framing)`);
    if (s.chain === "exact" && !prev.end?.trim()) out.push(`${s.id}: chain "exact" starts on ${prev.id}'s last frame, and ${prev.id} has no choreographed end (shot.end)`);
    if (s.chain === "exact" && s.transitionIn && s.transitionIn !== "cut") out.push(`${s.id}: chain "exact" is an invisible cut; it takes no transition`);
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
export function styleRules(raw, { slug, cast = [] } = {}) {
  const { data: st, problems } = parse(StyleBible, raw, "style-bible.json");
  if (!st) return problems;
  const out = [];
  const abs = (f) => (path.isAbsolute(f) ? f : path.join(P.projectDir(slug), f));
  if (st.brand.logo && slug && !fs.existsSync(abs(st.brand.logo))) out.push(`the logo ${st.brand.logo} doesn't exist`);
  if (st.text.fontFile && slug && !fs.existsSync(abs(st.text.fontFile))) out.push(`the font ${st.text.fontFile} doesn't exist`);
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
// cast: [{ name, look }] of the bible characters in the shot. Their locked look goes into the prompt with their sheet
// as the reference, and nobody else may appear (otherwise frames add strangers).
export function framePrompt(st, look, s, cast = []) {
  const pal = st.palette.join(", ");
  const who = cast.length ? `Characters, exactly as in the reference sheet${cast.length > 1 ? "s" : ""} (same faces, hair, clothes and colors): ${cast.map((c) => `${c.name}: ${c.look}`).join("; ")}. No other people and no animals anywhere in the frame.` : "No people and no animals anywhere in the frame.";
  return [look, s.prompt.trim().replace(/\.?$/, "."), who, `Art direction: ${st.artStyle}; ${st.line}; ${st.texture}; ${st.lighting}${st.colorTemp ? `, ${st.colorTemp}` : ""}; depth: ${st.depth}. Palette: ${pal}.`,
    s.composition ? `Composition: ${s.composition}.` : "", s.layers ? `Layers: ${s.layers}.` : "",
    `Never: ${[...st.negative, s.negative].filter(Boolean).join(", ")}.`, "No text, no letters, no numbers, no logos anywhere in the frame.",
    s.inserts?.length ? `Exactly ${s.inserts.length} screen${s.inserts.length > 1 ? "s" : ""}, each filled edge to edge with one flat solid bright green (#00FF00), no reflections, no glare, nothing drawn on ${s.inserts.length > 1 ? "them" : "it"}; nothing else in the picture is green.` : ""].filter(Boolean).join(" ");
}
// shot.acting: a performance direction for the people in the shot. The style's "small actions" rule makes people
// stiff, so with acting the people move fully and naturally while the set, objects and identities stay locked.
export function clipPromptOf(st, motionRule, s) {
  const acting = s.acting?.trim();
  return [s.motion.trim().replace(/\.?$/, "."), acting ? `Acting: ${acting.replace(/\.?$/, ".")} The people are fully alive, like real actors in a real conversation: expressive faces, real reactions to each other, natural breathing, weight shifts, head turns and hand gestures with intention; never a frozen pose or a mouth that only moves.` : "",
    s.end ? `The shot ends exactly on the last frame image: ${s.end.trim().replace(/\.?$/, ".")}` : "",
    `Camera: ${s.camera}.`, s.still?.length ? `These stay exactly as they are and do not move: ${s.still.join("; ")}.` : "",
    acting ? "The set, the frames and every object move only as described. Nobody and nothing appears, disappears, multiplies or slides out of the frame; no people, hands or creatures that are not described; faces, hair and clothes never change."
      : "Only what is described moves. Nobody and nothing appears, disappears, multiplies, sinks into the ground or slides out of the frame unless described; no people, hands or creatures that are not described.",
    acting ? "" : motionRule || "", `Keep the exact drawing style, line, palette and characters of the first frame; ${st.camera}.`,
    "No text, no letters, no logos. No cuts inside the shot. No dialogue: nobody speaks."].filter(Boolean).join(" ");
}
export function toShots(plan, st, styleDef, cast = []) {
  const chars = new Set(cast);
  const envRef = (s) => s.assets.map((a) => st.environments.find((e) => e.id === a)?.ref).filter(Boolean);
  return plan.shots.map((s) => ({
    id: s.id, source: s.source, role: s.role, summary: s.beat, planned: { start: s.start, duration: s.duration },
    duration: s.source === "generate" ? genSecs(s.duration) : s.duration,
    characters: s.assets.filter((a) => chars.has(a)),
    refs: envRef(s),
    ...(s.inserts.length ? { inserts: s.inserts } : {}),
    ...(s.source !== "card" ? { framePrompt: framePrompt(st, styleDef?.look || "", s, s.assets.filter((a) => chars.has(a)).map((id) => { const c = P.character(id); return { name: c.name, look: c.look }; })) } : {}),
    ...(s.source === "generate" ? { prompt: clipPromptOf(st, styleDef?.motion, s), audioMode: "silent" } : {}),
    // The last frame: the same scene and characters at the shot's end state (drawn with the first frame as reference).
    ...(s.source === "generate" && s.end && !/\blocked\b/i.test(s.camera) ? { lastPrompt: framePrompt(st, styleDef?.look || "", { ...s, prompt: `The same scene a few seconds later, the same framing${/push|pull/i.test(s.camera) ? ` after the camera's ${s.camera}` : ""}: ${s.end}` }, s.assets.filter((a) => chars.has(a)).map((id) => { const c = P.character(id); return { name: c.name, look: c.look }; })) } : {}),
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
