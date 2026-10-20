// Live price analysis (flow v5, "models" step). Before every Production Book the engine reads Kie's live price
// feed, prices every video model it can run for THIS project's length and resolution, ranks them by quality,
// and recommends the best quality that fits the intake's budget mode. The pick is stored in sl.defaults, so the
// book's estimate and the filming use the same model. Families Kie lists that the engine doesn't run yet are
// reported, so a better or cheaper new model is never missed.
// the creator, 2026-10-19: "always analyze the live prices in Kie, always provide the best options for high quality
// while keeping the cost low". No model is excluded by rule; quality and price decide.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import * as kie from "./kie.mjs";
import { MODELS } from "./models.mjs";

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
};

// What each kind of format needs from the model: multi-shot scenes from references, first/last-frame clips, or loops.
const CAN = {
  scenes: ["sd2-mini", "sd2-fast", "sd2", "sd2.5", "wan3", "wan3-prime"],
  clips: ["veo", "veo-fast", "veo-lite", "kling3", "sd2-mini", "sd2-fast", "sd2", "sd2.5", "grok"],
  longform: ["sd2-mini", "sd2-fast", "sd2", "sd2.5", "kling3", "veo", "veo-fast", "veo-lite"],
};
// The lowest quality each format accepts. Photoreal talking humans need the top tier: in the 2026-10-19 A/B only
// Veo 3.1 Quality read as real.
const FLOOR = { influencer: 10, ugc: 8, cinematic: 8, fantasy: 7, podcast: 7, "micro-drama": 7, anime: 6, sitcom: 6, other: 7, meditation: 5 };
// Resolution each format delivers at (sitcom can film at 480p: the broadcast finish downsamples).
const RES = { sitcom: ["480p", "720p"], meditation: ["720p"] };

export async function livePrices({ maxAgeH = 6 } = {}) {
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
  const re = new RegExp(esc(L.re).replace("\\{res\\}", esc(res)) + "\\b", "i");
  return rows.find((r) => r.type === "video" && re.test(r.model)) || null;
}

// Every engine video model priced live for `seconds` of footage at the format's resolution(s).
export function videoOptions(rows, { format, kind, seconds, clips = 1 }) {
  const out = [];
  for (const res of RES[format] || ["720p"]) {
    for (const [key, m] of Object.entries(MODELS)) {
      if (m.kind !== "video" || !QUALITY[key] || !(CAN[kind] || CAN.clips).includes(key)) continue;
      const row = liveRow(rows, key, res);
      if (!row) continue;
      const per = LIVE[key].per;
      const credits = per === "second" ? row.credits * seconds : row.credits * Math.max(clips, Math.ceil(seconds / per));
      out.push({ key, label: m.label.replace(/ \(.*\)$/, ""), res, credits: +credits.toFixed(1), usd: +(credits * 0.005).toFixed(2), unit: `${row.credits} cr ${row.unit}`, live: row.model, ...QUALITY[key] });
    }
  }
  return out.sort((a, b) => b.q - a.q || a.credits - b.credits);
}

// What Kie sells that the engine can't run yet (one line per family), so new models get noticed.
export function newFamilies(rows) {
  const known = Object.values(LIVE).map((l) => l.re.split(",")[0].toLowerCase());
  const fam = new Set(rows.filter((r) => r.type === "video").map((r) => r.model.split(/[,(]/)[0].trim()));
  return [...fam].filter((f) => !known.some((k) => f.toLowerCase().includes(k.replace(/^google /, ""))) && !/upscal|avatar|infinitetalk|lip|motion control|extend|animate|speech to video/i.test(f)).sort();
}

// budget: { mode: "cheapest" | "fixed" | "max", usd }. baseline: the model the style was approved with; the
// "cheapest that keeps quality" pick never drops below its quality or the format's floor.
// Measured speaking rate of each model's native voices (2026-10-20: Wan 3.0 Prime read every drama line at
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

export function recommend(options, { format, budget, baseline, maxWpm = null }) {
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
