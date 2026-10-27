// Pacing QC for talking short-form (influencer, UGC, podcast clips): the voice starts at once, runs at the format's
// pace, never stalls, and dead air stays a small share of the runtime. Measured on the final with word timestamps.
import { words } from "./reference.mjs";

// wpm band, first word (s), longest silence between words (s), dead air (share of runtime in gaps over 0.3 s).
export const PACE = {
  influencer: { wpm: [140, 175], firstWord: 1.5, maxGap: 0.8, deadAir: 0.1 },
  ugc: { wpm: [150, 180], firstWord: 1.0, maxGap: 0.8, deadAir: 0.05 },
  podcast: { wpm: [140, 170], firstWord: 1.5, maxGap: 1.0, deadAir: 0.1 },
};

export function pacingIssues(file, format, duration, lang = "en") {
  if (!PACE[format]) return [];
  return pacingFromWords(words(file, lang === "es" ? "es" : "en"), format, duration);
}

// ws: [{ w, start, end }] word timestamps of the final.
export function pacingFromWords(words0, format, duration) {
  const P = PACE[format];
  if (!P) return [];
  const ws = words0.filter((w) => w.w && w.w.trim());
  if (ws.length < 3) return ["almost nothing is said; a talking format needs its voice from the start"];
  const out = [];
  const span = ws.at(-1).end - ws[0].start;
  const wpm = Math.round((ws.length / Math.max(0.1, span)) * 60);
  const gaps = ws.slice(1).map((w, k) => w.start - ws[k].end);
  const maxGap = Math.max(0, ...gaps);
  const dead = (gaps.filter((g) => g > 0.3).reduce((a, b) => a + b, 0) + ws[0].start + Math.max(0, duration - ws.at(-1).end)) / Math.max(0.1, duration);
  if (ws[0].start > P.firstWord) out.push(`the first word comes at ${ws[0].start.toFixed(1)} s (${format}: by ${P.firstWord} s)`);
  if (wpm < P.wpm[0] || wpm > P.wpm[1]) out.push(`pace ${wpm} wpm (${format}: ${P.wpm[0]}-${P.wpm[1]})`);
  if (maxGap > P.maxGap) out.push(`a ${maxGap.toFixed(1)} s silence between words (${format}: max ${P.maxGap} s)`);
  if (dead > P.deadAir) out.push(`${Math.round(dead * 100)} % dead air (${format}: max ${Math.round(P.deadAir * 100)} %)`);
  return out;
}
