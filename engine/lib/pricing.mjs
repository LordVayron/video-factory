// Live price analysis (flow v5, "models" step). Before every Production Book the engine reads Kie's live price
// feed, prices every video model it can run for THIS project's length and resolution, ranks them by quality,
// and recommends the best quality that fits the intake's budget mode. The pick is stored in sl.defaults, so the
// book's estimate and the filming use the same model. Families Kie lists that the engine doesn't run yet are
// reported, so a better or cheaper new model is never missed.
// No model is excluded by rule; quality and price decide.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import * as kie from "./kie.mjs";
import * as apimart from "./apimart.mjs";
import { MODELS, apimartSpec, APIMART_PRICES } from "./models.mjs";

const FILE = path.join(ROOT, "engine", "prices.json");

// How each engine model appears in the live feed. {res} is replaced by the project's resolution.
// per: "second" (credits per second) or a clip length in seconds (credits per clip of that length).
const LIVE = {
  "sd2-mini": { re: "seedance-2-mini, {res} no video", per: "second" },
  "sd2-fast": { re: "seedance-2 fast, {res} no video input", per: "second" },
  sd2: { re: "seedance-2, {res} no video input", per: "second" },
  "sd2.5": { re: "seedance-2-5, {res} no video", per: "second" },
  wan3: { re: "wan 3.0 video, {res}, video", per: "second" },
  "wan3-prime": { re: "wan3.0 video prime, {res}, video", per: "second" },
  "veo-lite": { re: "veo 3.1, image-to-video, Lite-{res}", per: 8 },
  "veo-fast": { re: "veo 3.1, image-to-video, Fast-{res}", per: 8 },
  veo: { re: "veo 3.1, image-to-video, Quality-{res}", per: 8 },
  grok: { re: "grok-imagine, image-to-video, {res}", per: "second" },
  kling3: { re: "Kling 3.0, video, with audio-{res}", per: "second" },
  pixverse6: { re: "pixverse-v6, transition, {res}(no audio)", per: "second" },
  "minimax-h3": { re: "MiniMax H3, image to video, 768p", per: "second" },
};

// Quality on a 10-point scale, from the studio's own A/B tests where there is one, and what each is best at.
export const QUALITY = {
  veo: { q: 10, note: "most realistic talking humans, native voice and lip sync (A/B winner 2026-10-19); can burn captions or jump inside a shot (evals catch both)" },
  "sd2.5": { q: 9, note: "newest Seedance, multi-shot scenes with references" },
  sd2: { q: 8, note: "multi-shot scenes, strong identity with references" },
  kling3: { q: 8, note: "start and end frame, elements; good motion (A/B: less realistic skin than Veo Quality)" },
  "wan3-prime": { q: 8, note: "refs and voice refs, up to 30 s" },
  "veo-fast": { q: 7, note: "Veo look at a quarter of the price; softer detail (A/B)" },
  "sd2-fast": { q: 7, note: "Seedance 2 at lower cost" },
  wan3: { q: 7, note: "refs and voice refs, up to 30 s" },
  "veo-lite": { q: 6, note: "cheapest Veo; visibly weaker faces (A/B)" },
  "sd2-mini": { q: 6, note: "the sitcom's model: cheap multi-shot scenes; fine at 480p broadcast look" },
  grok: { q: 5, note: "very cheap, audio always on" },
  pixverse6: { q: 6, note: "first+last frame transition, billed per exact second, very cheap; quality to be measured" },
  "minimax-h3": { q: 6, note: "first+last frame, cheap, audio always on (dropped in the edit); quality to be measured" },
};

// What each kind of format needs from the model: multi-shot scenes from references, first/last-frame clips, or loops.
const CAN = {
  scenes: ["sd2-mini", "sd2-fast", "sd2", "sd2.5", "wan3", "wan3-prime"],
  clips: ["veo", "veo-fast", "veo-lite", "kling3", "sd2-mini", "sd2-fast", "sd2", "sd2.5", "grok", "wan3", "wan3-prime", "pixverse6", "minimax-h3"],
  longform: ["sd2-mini", "sd2-fast", "sd2", "sd2.5", "kling3", "veo", "veo-fast", "veo-lite", "wan3", "pixverse6", "minimax-h3"],
};
// The lowest quality each format accepts. Photoreal talking humans need the top tier: in A/B tests only
// Veo 3.1 Quality read as real.
const FLOOR = { influencer: 10, ugc: 8, cinematic: 8, fantasy: 7, podcast: 7, "micro-drama": 7, anime: 6, sitcom: 6, other: 7, meditation: 5, launch: 7 };
// Resolution each format delivers at (sitcom can film at 480p: the broadcast finish downsamples).
const RES = { sitcom: ["480p", "720p"], meditation: ["720p"] };

// APIMart's live prices: one public request per model the engine maps there. Written next to Kie's feed;
// models.mjs prices every job from it, so the cheapest provider is chosen per model.
export async function apimartPrices({ maxAgeH = 6 } = {}) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(APIMART_PRICES, "utf8")); } catch {}
  if (cached && (Date.now() - Date.parse(cached.at)) / 36e5 <= maxAgeH) return { ...cached, fetched: false };
  const ids = [...new Set(Object.keys(MODELS).map(apimartSpec).filter(Boolean).map((a) => a.model))];
  const models = {}, missing = [];
  await Promise.all(ids.map(async (id) => { try { models[id] = await apimart.fetchPrice(id); } catch { missing.push(id); } }));
  if (!Object.keys(models).length) {
    if (cached) return { ...cached, fetched: false, warning: "APIMart prices unreachable; using the last ones" };
    return { at: null, models: {}, fetched: false, warning: "APIMart prices unreachable" };
  }
  const out = { at: new Date().toISOString(), models: { ...(cached?.models || {}), ...models } };
  fs.writeFileSync(APIMART_PRICES, JSON.stringify(out, null, 1) + "\n");
  return { ...out, fetched: true, missing };
}

export async function livePrices({ maxAgeH = 6 } = {}) {
  await apimartPrices({ maxAgeH }).catch(() => null);
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const age = cached ? (Date.now() - fs.statSync(FILE).mtimeMs) / 36e5 : Infinity;
  if (age <= maxAgeH) return { rows: cached, fetched: false, ageH: age };
  try {
    const rows = await kie.fetchPrices();
    fs.writeFileSync(FILE, JSON.stringify(rows, null, 1));
    return { rows, fetched: true, ageH: 0 };
  } catch (e) {
    if (!cached) throw new Error(`no live prices and no cached feed: ${e.message}`);
    return { rows: cached, fetched: false, ageH: age, warning: `live feed unreachable (${e.message.slice(0, 80)}); using prices ${age.toFixed(0)} h old` };
  }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function liveRow(rows, key, res) {
  const L = LIVE[key];
  if (!L) return null;
  // No word boundary after a closing ")" (it can never match one).
  const re = new RegExp(esc(L.re).replace("\\{res\\}", esc(res)) + (/\w$/.test(L.re) ? "\\b" : ""), "i");
  return rows.find((r) => r.type === "video" && re.test(r.model)) || null;
}

// Every engine video model priced live for `seconds` of footage at the format's resolution(s).
export function videoOptions(rows, { format, kind, seconds, clips = 1 }) {
  const out = [];
  for (const res of RES[format] || ["720p"]) {
    for (const [key, m] of Object.entries(MODELS)) {
      if (m.kind !== "video" || !QUALITY[key] || !(CAN[kind] || CAN.clips).includes(key)) continue;
      const row = liveRow(rows, key, res);
      const offers = [];
      if (row) {
        const per = LIVE[key].per;
        offers.push({ provider: "kie", credits: per === "second" ? row.credits * seconds : row.credits * Math.max(clips, Math.ceil(seconds / per)), unit: `${row.credits} cr ${row.unit}`, live: row.model });
      }
      const ap = apimartOffer(key, { res, seconds, clips });
      if (ap) offers.push(ap);
      if (!offers.length) continue;
      // APIMart is the main provider: it wins a tie within 2 %.
      const best = offers.sort((a, b) => (a.provider === "apimart" ? a.credits / 1.02 : a.credits) - (b.provider === "apimart" ? b.credits / 1.02 : b.credits))[0];
      const other = offers.find((o) => o !== best);
      out.push({ key, label: m.label.replace(/ \(.*\)$/, ""), res, provider: best.provider, credits: +best.credits.toFixed(1), usd: +(best.credits * 0.005).toFixed(2), unit: best.unit, live: best.live, ...(other ? { alt: { provider: other.provider, usd: +(other.credits * 0.005).toFixed(2) } } : {}), ...QUALITY[key] });
    }
  }
  return out.sort((a, b) => b.q - a.q || a.credits - b.credits);
}

// APIMart's price for `seconds` of footage of one engine model, split into clips the way the model films them.
function apimartOffer(key, { res, seconds, clips }) {
  const a = apimartSpec(key);
  if (!a || process.env.VF_PROVIDER === "kie") return null;
  let p = null;
  try { p = JSON.parse(fs.readFileSync(APIMART_PRICES, "utf8")).models?.[a.model]; } catch {}
  if (!p) return null;
  const n = Math.max(clips, 1), per = seconds / n;
  const req = { res, duration: /^veo/.test(key) ? 8 : per, sound: true };
  if (a.supports && !a.supports(req)) return null;
  const n2 = /^veo/.test(key) ? Math.max(clips, Math.ceil(seconds / 8)) : n;
  const usd = a.usd(p, req) * n2;
  if (!Number.isFinite(usd)) return null;
  return { provider: "apimart", credits: usd / 0.005, unit: `APIMart ${a.model}`, live: a.model };
}

// What Kie sells that the engine can't run yet (one line per family), so new models get noticed.
// Every Kie video family the engine doesn't run, avatars and lip-sync included (research decides what they're for).
export function allNewFamilies(rows) {
  const known = Object.values(LIVE).map((l) => l.re.split(",")[0].toLowerCase());
  const fam = new Set(rows.filter((r) => r.type === "video").map((r) => r.model.split(/[,(]/)[0].trim()));
  return [...fam].filter((f) => !known.some((k) => f.toLowerCase().includes(k.replace(/^google /, ""))) && !/upscal/i.test(f)).sort();
}
export function newFamilies(rows) {
  const known = Object.values(LIVE).map((l) => l.re.split(",")[0].toLowerCase());
  const fam = new Set(rows.filter((r) => r.type === "video").map((r) => r.model.split(/[,(]/)[0].trim()));
  return [...fam].filter((f) => !known.some((k) => f.toLowerCase().includes(k.replace(/^google /, ""))) && !/upscal|avatar|infinitetalk|lip|motion control|extend|animate|speech to video/i.test(f)).sort();
}

// MODEL RESEARCH: every video model the providers sell is researched from its documentation before any production
// picks a model, whether or not the engine runs it yet; a pick limited to the models the engine already knows missed
// newer, better ones. One profile per family in engine/data/model-research.json, refreshed every RESEARCH_DAYS.
const RESEARCH = path.join(ROOT, "engine", "data", "model-research.json");
export const RESEARCH_DAYS = 60;
export const readResearch = () => { try { return JSON.parse(fs.readFileSync(RESEARCH, "utf8")); } catch { return {}; } };
const USES = ["general", "avatar", "lip-sync", "edit", "extend", "upscale", "effects"];
export function researchProblems(p) {
  const out = [];
  if (!p?.family) return ["no family"];
  if (!/^https?:\/\//.test(p.docs || "")) out.push(`${p.family}: the documentation URL it was read from (docs)`);
  if (!p.inputs || typeof p.inputs !== "object") out.push(`${p.family}: inputs (text, firstFrame, lastFrame, refImages, refVideo, audio)`);
  if (typeof p.audioOut !== "boolean") out.push(`${p.family}: audioOut (does it make sound)`);
  if (!(p.maxSecs > 0)) out.push(`${p.family}: maxSecs`);
  if (!Array.isArray(p.resolutions) || !p.resolutions.length) out.push(`${p.family}: resolutions`);
  if (!(p.usdPerSec >= 0)) out.push(`${p.family}: usdPerSec (the live price)`);
  if (!USES.includes(p.use)) out.push(`${p.family}: use (${USES.join(", ")})`);
  if (!["candidate", "not-for"].includes(p.verdict)) out.push(`${p.family}: verdict (candidate or not-for)`);
  if (!Array.isArray(p.fits)) out.push(`${p.family}: fits (the formats it can serve; empty when not-for)`);
  if (!p.why?.trim() || p.why.trim().length < 20) out.push(`${p.family}: why (the reason for the verdict, from the docs)`);
  return out;
}
export function recordResearch(profiles) {
  const all = readResearch(), bad = profiles.flatMap(researchProblems);
  if (bad.length) throw new Error(`model research incomplete: ${bad.join("; ")}`);
  for (const p of profiles) all[p.family] = { ...p, checkedAt: new Date().toISOString().slice(0, 10) };
  fs.mkdirSync(path.dirname(RESEARCH), { recursive: true });
  fs.writeFileSync(RESEARCH, JSON.stringify(all, null, 2) + "\n");
  return Object.keys(all).length;
}
// APIMart's whole video catalog, from its docs index (cached a day).
const CATALOG = path.join(ROOT, "engine", "data", "apimart-catalog.json");
export async function apimartCatalog({ maxAgeH = 24 } = {}) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(CATALOG, "utf8")); } catch {}
  if (cached && (Date.now() - Date.parse(cached.at)) / 36e5 <= maxAgeH) return cached.models;
  try {
    const models = await apimart.catalog();
    fs.mkdirSync(path.dirname(CATALOG), { recursive: true });
    fs.writeFileSync(CATALOG, JSON.stringify({ at: new Date().toISOString(), models }, null, 1) + "\n");
    return models;
  } catch { return cached?.models || []; }
}
// The APIMart pages the engine already runs on APIMart.
const APIMART_RUN = /videos\/(seedance-2-0|seedance-2-5|wan3\.0-video|veo3|grok-imagine|kling-v3)\/generation\.md$/;
// Every video family on sale at either provider that the engine doesn't run: Kie's price list and APIMart's docs.
export function catalogFamilies(rows, cat = []) {
  const kie = allNewFamilies(rows);
  const am = cat.filter((c) => !APIMART_RUN.test(c.docs)).map((c) => `APIMart: ${c.title}`);
  return [...new Set([...kie, ...am])];
}
// Families on sale that have no fresh profile.
export function researchGaps(rows, cat = []) {
  const r = readResearch();
  return catalogFamilies(rows, cat).filter((f) => !r[f] || Date.now() - Date.parse(r[f].checkedAt) > RESEARCH_DAYS * 864e5);
}
// LIVE CATALOG CHECK, at the start of every project: both catalogs and every price fetched fresh (no cache). It
// reports models that appeared since the last research (they block the book until researched) and every price that
// moved, and updates the researched prices, so a production never starts on a stale picture of the market.
const perSecond = (d, key) => (key && (d.resolution_paid_prices?.[key] ?? d.billing_tier_paid_prices?.[key])) ?? d.paid_price ?? Math.min(...Object.values(d.resolution_paid_prices || { x: Infinity }));
export async function liveCatalogCheck() {
  let before = [];
  try { before = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const live = await livePrices({ maxAgeH: 0 });
  const cat = await apimartCatalog({ maxAgeH: 0 });
  const research = readResearch(), changes = [];
  // Prices of the models the engine runs (Kie's feed, line by line).
  const was = new Map(before.filter((r) => r.type === "video").map((r) => [r.model, r.usd]));
  for (const r of live.rows.filter((x) => x.type === "video")) if (was.has(r.model) && Math.abs(was.get(r.model) - r.usd) > 0.0005) changes.push({ model: r.model, was: was.get(r.model), now: r.usd, unit: r.unit });
  // Prices of the researched families.
  for (const [fam, p] of Object.entries(research)) {
    let now = null;
    if (p.apimartId) { try { now = perSecond(await apimart.fetchPrice(p.apimartId), p.priceKey); } catch {} }
    else if (!fam.startsWith("APIMart: ")) {
      const rs = live.rows.filter((x) => x.type === "video" && x.model.split(/[,(]/)[0].trim() === fam && /second/.test(x.unit));
      if (rs.length) now = Math.min(...rs.map((x) => x.usd));
    }
    if (now != null && isFinite(now) && Math.abs(now - p.usdPerSec) > 0.0005) { changes.push({ model: fam, was: p.usdPerSec, now, unit: "per second" }); research[fam] = { ...p, usdPerSec: now, priceAt: new Date().toISOString().slice(0, 10) }; }
  }
  if (changes.some((c) => research[c.model])) fs.writeFileSync(RESEARCH, JSON.stringify(research, null, 2) + "\n");
  return { at: new Date().toISOString(), fetched: live.fetched, warning: live.warning || null, catalog: cat.length, newModels: researchGaps(live.rows, cat), priceChanges: changes };
}

// Researched families the engine doesn't run yet that could serve this format.
export function researchCandidates(rows, format, cat = []) {
  const r = readResearch();
  return catalogFamilies(rows, cat).map((f) => r[f]).filter((p) => p && p.verdict === "candidate" && (p.fits || []).includes(format));
}

// budget: { mode: "cheapest" | "fixed" | "max", usd }. baseline: the model the style was approved with; the
// "cheapest that keeps quality" pick never drops below its quality or the format's floor.
// Measured speaking rate of each model's native voices (Wan 3.0 Prime read every drama line at
// 191-204 wpm though the prompt asked for 140-160, and lip-synced speech can't be slowed in the edit).
const RATES = path.join(ROOT, "engine", "data", "speech-rates.json");
const readRates = () => { try { return JSON.parse(fs.readFileSync(RATES, "utf8")); } catch { return {}; } };
export function measuredWpm(key) {
  const xs = (readRates()[key] || []).map((r) => r.wpm).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}
export function recordSpeechRate(key, wpm, slug) {
  if (!key || !wpm) return;
  const all = readRates();
  all[key] = [...(all[key] || []).filter((r) => r.slug !== slug), { slug, wpm, at: new Date().toISOString().slice(0, 10) }];
  fs.mkdirSync(path.dirname(RATES), { recursive: true });
  fs.writeFileSync(RATES, JSON.stringify(all, null, 2) + "\n");
}

// What the video asks of the model, beyond general quality. A general score hides the job, so each need keeps the
// evidence of every side-by-side test on it (engine/data/model-fit.json, one entry per project that tested it).
// The recommendation is the best model for the job first and the cheapest of the best second; the options shown
// are only those that did the job well, plus the untested ones to try.
export const NEEDS = {
  "stylized-acting": "illustrated or painted characters that act: real reactions, gestures and faces, without new people appearing",
  "photoreal-humans": "photoreal people who read as real on camera",
};
// The needs of a project: its style (photoreal or not) and whether people act in its shots.
export function needsOf(sl, style) {
  const people = (sl.shots || []).some((s) => (s.characters || []).length || s.acting);
  if (!people) return [];
  const photo = /hyperreal|photo/i.test(`${style?.id || sl.style || ""} ${style?.kind || ""}`);
  return [photo ? "photoreal-humans" : "stylized-acting"];
}
const FITS = path.join(ROOT, "engine", "data", "model-fit.json");
const readFits = () => { try { return JSON.parse(fs.readFileSync(FITS, "utf8")); } catch { return {}; } };
// Fit 0-10 of a model for the video's needs: the median of its tests on each need, the weakest need deciding.
export function fitOf(key, needs, fits = readFits()) {
  const per = needs.map((n) => { const xs = (fits[n]?.[key] || []).map((e) => e.fit).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; });
  return per.some((x) => x == null) ? null : Math.min(...per);
}
export const evidenceOf = (key, needs, fits = readFits()) => needs.flatMap((n) => fits[n]?.[key] || []);
// A test seen and scored (after the frame-by-frame review) becomes evidence for that need.
export function recordFit(need, key, fit, note, slug) {
  const all = readFits();
  all[need] ||= {};
  all[need][key] = [...(all[need][key] || []).filter((e) => e.slug !== slug), { fit, slug, at: new Date().toISOString().slice(0, 10), note }];
  fs.mkdirSync(path.dirname(FITS), { recursive: true });
  fs.writeFileSync(FITS, JSON.stringify(all, null, 2) + "\n");
}
// Good for the job: fit 7 or more. Untested: no evidence yet (shown to be tested, never recommended over a good one).
export const GOOD_FIT = 7;
export function forTheJob(options, needs, fits = readFits()) {
  if (!needs.length) return { good: options, untested: [], poor: [] };
  const good = [], untested = [], poor = [];
  for (const o of options) { const f = fitOf(o.key, needs, fits); (f == null ? untested : f >= GOOD_FIT ? good : poor).push({ ...o, fit: f }); }
  return { good, untested, poor };
}

// The models this project has tested on a shot (motion tests), with the take each one made.
export function testedModels(sl) {
  const out = {};
  for (const s of sl.shots || []) for (const c of s.clips || []) if (c.test && c.model) (out[c.model] ||= []).push({ shot: s.id, file: c.file });
  return out;
}

export function recommend(options, { format, budget, baseline, maxWpm = null, needs = [], fits }) {
  // First the best for the job, then the cheapest of the best: among models good for the need, those within one
  // point of the best fit, cheapest first (budget "max" takes the best fit).
  if (needs.length) {
    const { good } = forTheJob(options, needs, fits);
    if (good.length) {
      const top = Math.max(...good.map((o) => o.fit)), tier = good.filter((o) => o.fit >= top - 1);
      return budget?.mode === "max" ? tier.sort((a, b) => b.fit - a.fit || a.credits - b.credits)[0] : tier.sort((a, b) => a.credits - b.credits)[0];
    }
  }
  const floor = Math.max(FLOOR[format] ?? 7, QUALITY[baseline]?.q ?? 0);
  const byCost = (a, b) => a.credits - b.credits;
  // A model measured speaking faster than the format allows is never recommended while another one fits.
  const paced = maxWpm ? options.filter((o) => !(measuredWpm(o.key) > maxWpm)) : options;
  if (paced.length) options = paced;
  const good = options.filter((o) => o.q >= floor);
  if (!good.length) return [...options].sort((a, b) => b.q - a.q || a.credits - b.credits)[0] || null;
  if (budget?.mode === "max") return [...options].sort((a, b) => b.q - a.q || a.credits - b.credits)[0];
  if (budget?.mode === "fixed" && budget.usd) return [...good].sort((a, b) => b.q - a.q || a.credits - b.credits).find((o) => o.usd <= budget.usd * 0.8) || [...good].sort(byCost)[0];
  return [...good].sort(byCost)[0];
}
