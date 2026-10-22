// The reference engine (2026-10-22): any video the creator likes, as a file or a link, becomes a measured profile, a
// frame-by-frame breakdown the creator approves, and a pattern in the bank that productions of that format calibrate to.
// Lessons from the Town reference are rules here: speech is always transcribed (never inferred from silence), every
// shot and every join gets its own 4 fps sheet, and nothing enters the bank without the creator's words.
// Nothing here calls a paid API: measuring is local (ffmpeg, whisper); the understanding is Claude's, written into
// breakdown.json and checked by breakdownRules.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { ROOT } from "./env.mjs";
import * as REF from "./reference.mjs";

export const REFS = path.join(ROOT, "refs");
export const FORMAT_IDS = ["sitcom", "micro-drama", "anime", "influencer", "ugc", "podcast", "cinematic", "fantasy", "other", "launch", "meditation"];
const ffErr = (args) => spawnSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
const ff = (args) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`ffmpeg: ${(r.stderr || "").slice(-300)}`); };
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n"); };
export const dirOf = (id) => path.join(REFS, id);
export const sourceOf = (id) => { const d = dirOf(id); const f = fs.existsSync(d) ? fs.readdirSync(d).find((x) => /^source\./.test(x)) : null; return f ? path.join(d, f) : null; };
export const metaOf = (id) => readJSON(path.join(dirOf(id), "meta.json"));
export const profileOf = (id) => readJSON(path.join(dirOf(id), "profile.json"));
export const breakdownOf = (id) => readJSON(path.join(dirOf(id), "breakdown.json"));
export const list = () => (fs.existsSync(REFS) ? fs.readdirSync(REFS).filter((id) => metaOf(id)) : []);

// ---- ingest: a local file is copied, a link is downloaded with yt-dlp (only links the creator gave)
const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ref";
export function ingest(src, { note = "" } = {}) {
  const isUrl = /^https?:\/\//i.test(src);
  if (!isUrl && !fs.existsSync(src)) throw new Error(`no existe ${src}`);
  let id = slugify(note || (isUrl ? new URL(src).hostname.replace(/^www\./, "") + "-" + Date.now().toString(36) : path.basename(src, path.extname(src))));
  for (let k = 2; fs.existsSync(dirOf(id)); k++) id = `${id.replace(/-\d+$/, "")}-${k}`;
  const d = dirOf(id); fs.mkdirSync(d, { recursive: true });
  const meta = { id, from: isUrl ? { url: src } : { file: path.basename(src) }, note, status: "measured-pending", at: new Date().toISOString() };
  if (isUrl) {
    const r = spawnSync("yt-dlp", ["-f", "mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best", "--merge-output-format", "mp4", "--no-playlist", "--write-info-json", "-o", path.join(d, "source.%(ext)s"), src], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0 || !sourceOf(id)) { fs.rmSync(d, { recursive: true, force: true }); throw new Error(`no se pudo bajar el link (yt-dlp): ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`); }
    const info = readJSON(path.join(d, "source.info.json"), {});
    meta.from = { url: src, title: info.title || null, uploader: info.uploader || info.channel || null, platform: info.extractor_key || null };
    fs.rmSync(path.join(d, "source.info.json"), { force: true });
  } else fs.copyFileSync(src, path.join(d, `source${path.extname(src).toLowerCase() || ".mp4"}`));
  writeJSON(path.join(d, "meta.json"), meta);
  return id;
}

// ---- measure: the Town profile plus per-shot timing and motion, the hook, pauses, the bed under the voice, sheets
export function measure(id, { lang = "en" } = {}) {
  const src = sourceOf(id); if (!src) throw new Error(`${id}: sin video`);
  const p = REF.profile(src, { lang });
  const [w, h] = p.size.split("x").map(Number);
  const bounds = [0, ...p.cuts, p.duration];
  const motion = [...ffErr(["-i", src, "-vf", "fps=6,scale=160:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]).matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const shots = bounds.slice(1).map((b, i) => {
    const a = bounds[i], seg = motion.slice(Math.floor(a * 6), Math.max(Math.floor(a * 6) + 1, Math.floor(b * 6)));
    return { n: i + 1, start: +a.toFixed(2), end: +b.toFixed(2), dur: +(b - a).toFixed(2), motion: +(seg.reduce((x, y) => x + y, 0) / Math.max(1, seg.length)).toFixed(1) };
  });
  const ws = REF.words(src, lang);
  const pauses = []; for (let i = 1; i < ws.length; i++) if (ws[i].start - ws[i - 1].end >= 0.6) pauses.push({ at: +ws[i - 1].end.toFixed(2), secs: +(ws[i].start - ws[i - 1].end).toFixed(2) });
  const hook = { firstWordAt: ws[0]?.start ?? null, text3s: ws.filter((x) => x.start < 3).map((x) => x.w).join(" "), words3s: ws.filter((x) => x.start < 3).length, cutsIn3s: p.cuts.filter((c) => c < 3).length };
  // The bed: the loudest part where nobody talks (music or ambience), measured in the longest pause or after the voice.
  const gap = [...pauses].sort((a, b) => b.secs - a.secs)[0] || (ws.length && p.duration - ws.at(-1).end > 0.8 ? { at: ws.at(-1).end, secs: p.duration - ws.at(-1).end } : null) || (!ws.length ? { at: 0, secs: Math.min(10, p.duration) } : null);
  const bedDb = gap ? Number((ffErr(["-ss", String(gap.at), "-t", String(Math.min(gap.secs, 5)), "-i", src, "-af", "volumedetect", "-f", "null", "-"]).match(/mean_volume: (-?[\d.]+)/) || [])[1] ?? -91) : null;
  // Sound and on-screen text, measured (2026-10-22: the creator wants none of it left to Claude's eyes and ears).
  const media = (mode) => { const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "ref_media.py"), mode, src], { encoding: "utf8", maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`ref_media.py ${mode}: ${(r.stderr || "").trim().split("\n").pop()}`); return JSON.parse(r.stdout); };
  const au = media("audio"), ocr = media("ocr");
  const inSpeech = (t) => ws.some((x) => t >= x.start - 0.12 && t <= x.end + 0.12);
  const sound = { tempo: au.tempo, envelope: au.envelope, sfx: au.events.filter((e) => !inSpeech(e.at) && e.jumpDb > 3) };
  const prof = { ...p, aspect: +(w / h).toFixed(3), orientation: w > h * 1.1 ? "landscape" : h > w * 1.1 ? "portrait" : "square", cutsPerMin: +((p.cuts.length / p.duration) * 60).toFixed(1), shotList: shots, hook, pauses, sound, onScreenText: ocr.text, bed: gap ? { db: bedDb, music: bedDb > -45, measuredAt: +gap.at.toFixed(2) } : null, lang, at: new Date().toISOString() };
  prof.guess = guessFormat(prof);
  writeJSON(path.join(dirOf(id), "profile.json"), prof);
  sheets(id, prof);
  const meta = metaOf(id); writeJSON(path.join(dirOf(id), "meta.json"), { ...meta, status: ["approved", "broken-down"].includes(meta.status) ? meta.status : "measured" }); // re-measuring never undoes the creator's approval
  return prof;
}

// One sheet per shot (4 fps; long shots sampled to 16 frames) and one per join (the last and first half second at
// 8 fps), plus an overview. 2026-10-21: a 2 fps thumbnail strip missed what a frame-by-frame look caught.
export function sheets(id, prof = profileOf(id)) {
  const src = sourceOf(id), d = path.join(dirOf(id), "sheets"); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true });
  const n = Math.min(60, Math.ceil(prof.duration * 2)), every = prof.duration / n;
  ff(["-i", src, "-vf", `fps=${(1 / every).toFixed(4)},scale=320:-2,tile=6x${Math.ceil(n / 6)}`, "-frames:v", "1", "-q:v", "4", path.join(d, "overview.jpg")]);
  for (const s of prof.shotList.slice(0, 80)) {
    const k = Math.min(16, Math.max(1, Math.ceil(s.dur * 4))), fps = (k / Math.max(s.dur, 0.25)).toFixed(3);
    ff(["-ss", String(s.start), "-t", String(Math.max(s.dur, 0.25)), "-i", src, "-vf", `fps=${fps},scale=360:-2,tile=4x${Math.ceil(k / 4)}`, "-frames:v", "1", "-q:v", "4", path.join(d, `shot-${String(s.n).padStart(2, "0")}.jpg`)]);
  }
  for (const c of prof.cuts.slice(0, 80).map((t, i) => ({ t, i: i + 1 }))) ff(["-ss", String(Math.max(0, c.t - 0.5)), "-t", "1", "-i", src, "-vf", "fps=8,scale=320:-2,tile=8x1", "-frames:v", "1", "-q:v", "4", path.join(d, `join-${String(c.i).padStart(2, "0")}.jpg`)]);
  return d;
}

// A first guess from the numbers alone; Claude confirms it from the sheets, and the creator decides when they disagree.
export function guessFormat(p) {
  const why = [], wide = p.orientation === "landscape", tall = p.orientation === "portrait";
  if (p.duration > 300 || (wide && p.narration.wpm < 120 && p.motion.mean < 3 && p.cutsPerMin < 4)) return { format: "meditation", confidence: 0.8, why: ["largo o muy lento, poco movimiento, pocos cortes"] };
  // A loud bed under the dialogue and an intro before the first line read as a sitcom (laugh track, theme).
  if (p.bed?.db > -18 && (p.hook.firstWordAt ?? 0) > 1.5 && p.shotList.length > 5) return { format: "sitcom", confidence: 0.6, why: ["fondo fuerte bajo los diálogos (risas o tema) y una entrada antes de la primera línea"] };
  if (wide && p.duration <= 120 && p.narration.coverage >= 0.6 && p.cutsPerMin >= 10) return { format: "launch", confidence: 0.7, why: ["horizontal, corto, narración continua, cortes frecuentes"] };
  if (tall && p.narration.coverage >= 0.55 && p.cutsPerMin < 14 && p.duration <= 90) { why.push("vertical, una voz casi todo el tiempo, pocos cortes"); return { format: "ugc", confidence: 0.5, why: [...why, "puede ser UGC o influencer: se confirma mirando si hay producto"] }; }
  if (tall && p.cutsPerMin >= 14) return { format: "micro-drama", confidence: 0.5, why: ["vertical y con muchos cortes: drama o ritmo de edición rápida"] };
  if (wide && p.cutsPerMin >= 6) return { format: "cinematic", confidence: 0.4, why: ["horizontal con cortes: cine, sitcom o lanzamiento"] };
  return { format: "other", confidence: 0.3, why: ["los números no bastan; se decide mirando"] };
}

// ---- the breakdown Claude writes after looking at every sheet (contract + rules)
const s2 = z.string().trim().min(2);
export const Breakdown = z.object({
  format: z.enum(FORMAT_IDS), formatWhy: s2,
  summary: s2,
  hook: z.object({ type: z.enum(["question", "result-first", "pattern-interrupt", "bold-claim", "pain", "curiosity", "visual-gag", "direct-address", "other"]), seconds: z.number().min(0).max(10), text: z.string(), why: s2 }),
  structure: z.array(z.object({ beat: s2, from: z.number().min(0), to: z.number().min(0) })).min(2),
  shots: z.array(z.object({ n: z.number().int().min(1), what: s2, framing: s2, camera: s2, action: s2, transitionOut: z.object({ type: z.enum(["cut", "match-cut", "jump-cut", "action", "object", "whip", "zoom", "fade", "dissolve", "wipe", "graphic", "none"]), how: z.string() }).optional() })).min(1),
  voice: z.object({ who: s2, delivery: s2 }),
  music: z.object({ present: z.boolean(), style: z.string().default(""), role: z.string().default("") }),
  sfx: z.array(z.object({ at: z.number().min(0), what: s2 })).default([]),
  onScreenText: z.object({ style: z.string().default(""), examples: z.array(z.string()).default([]) }).default({ style: "", examples: [] }),
  look: s2,
  takeaways: z.array(s2).min(3),
  neverCopy: z.array(s2).min(1),
});
export function breakdownRules(raw, prof) {
  const r = Breakdown.safeParse(raw);
  if (!r.success) return r.error.issues.map((i) => `breakdown: ${i.path.join(".") || "(raíz)"}: ${i.message}`);
  const b = r.data, out = [];
  if (prof) {
    const n = Math.min(80, prof.shotList.length);
    const seen = new Set(b.shots.map((s) => s.n));
    for (let k = 1; k <= n; k++) if (!seen.has(k)) out.push(`toma ${k} sin describir (cada toma medida tiene su entrada, mirando shot-${String(k).padStart(2, "0")}.jpg)`);
    for (const s of b.shots) if (s.n < Math.min(n, prof.shotList.length) && !s.transitionOut?.how?.trim()) out.push(`toma ${s.n}: sin decir cómo se une con la siguiente (transitionOut.how, mirando join-${String(s.n).padStart(2, "0")}.jpg)`);
    for (const x of b.structure) if (x.to <= x.from || x.to > prof.duration + 0.5) out.push(`el beat "${x.beat}" va de ${x.from} a ${x.to} s y el video dura ${prof.duration} s`);
    if (prof.narration.words && !b.voice.who) out.push("el video tiene voz y el desglose no dice de quién es");
    if (prof.onScreenText?.length && !b.onScreenText.style.trim()) out.push(`se leyó texto en pantalla (${prof.onScreenText.slice(0, 3).map((x) => `"${x.text}" a ${x.from} s`).join(", ")}) y el desglose no describe su estilo (onScreenText.style)`);
    if (prof.sound?.sfx?.length && !b.sfx.length) out.push(`se midieron ${prof.sound.sfx.length} golpes de sonido fuera de la voz (${prof.sound.sfx.slice(0, 4).map((e) => `${e.at} s`).join(", ")}) y el desglose no lista efectos (sfx)`);
    if (b.music.present !== !!prof.bed?.music && prof.bed) out.push(`el desglose dice música ${b.music.present ? "sí" : "no"} y lo medido bajo la voz dice ${prof.bed.music ? "sí" : "no"} (${prof.bed.db} dB); míralo de nuevo`);
  }
  return out;
}

// ---- approval and the bank
export function approve(id, { said, formatSaid } = {}) {
  if (!said?.trim()) throw new Error('aprobar una referencia necesita --said "palabras exactas del creador"');
  const prof = profileOf(id), b = breakdownOf(id);
  if (!prof || !b) throw new Error(`${id}: falta medir o escribir el desglose`);
  const bad = breakdownRules(b, prof); if (bad.length) throw new Error(bad.join("; "));
  // The format is the creator's call whenever the numbers and the look disagree, or the numbers were unsure.
  if ((prof.guess.format !== b.format || prof.guess.confidence < 0.7) && !formatSaid?.trim()) throw new Error(`${id}: el formato "${b.format}" necesita la confirmación del creador (los números sugerían ${prof.guess.format} con ${Math.round(prof.guess.confidence * 100)} %): --format-said "..."`);
  const meta = metaOf(id);
  writeJSON(path.join(dirOf(id), "meta.json"), { ...meta, status: "approved", format: b.format, approved: { said, formatSaid: formatSaid || null, at: new Date().toISOString() } });
  return b.format;
}
export const approved = (format) => list().filter((id) => metaOf(id)?.status === "approved" && (!format || metaOf(id).format === format));
const range = (xs) => (xs.length ? [+Math.min(...xs).toFixed(2), +Math.max(...xs).toFixed(2)] : null);
export function bank(format) {
  const ids = approved(format), ps = ids.map(profileOf), bs = ids.map(breakdownOf);
  return {
    format, refs: ids, count: ids.length,
    ranges: { duration: range(ps.map((p) => p.duration)), avgShot: range(ps.map((p) => p.avgShot)), cutsPerMin: range(ps.map((p) => p.cutsPerMin)), wpm: range(ps.filter((p) => p.narration.words).map((p) => p.narration.wpm)), wordsPerSecondOfFilm: range(ps.map((p) => p.narration.wordsPerSecondOfFilm)), coverage: range(ps.map((p) => p.narration.coverage)), firstWordAt: range(ps.filter((p) => p.hook.firstWordAt != null).map((p) => p.hook.firstWordAt)), loudnessSpread: range(ps.map((p) => p.loudness.spread)) },
    hooks: bs.map((b, i) => ({ ref: ids[i], type: b.hook.type, seconds: b.hook.seconds })),
    takeaways: bs.flatMap((b, i) => b.takeaways.map((t) => ({ ref: ids[i], t }))),
  };
}
// The reference shape planRules already reads (launch films): the average of the chosen references.
export function asReference(ids) {
  const ps = ids.map(profileOf).filter(Boolean); if (!ps.length) return null;
  const avg = (f) => +(ps.reduce((n, p) => n + f(p), 0) / ps.length).toFixed(2);
  return { fromRefs: ids, duration: avg((p) => p.duration), avgShot: avg((p) => p.avgShot), narration: { words: Math.round(avg((p) => p.narration.words)), wpm: Math.round(avg((p) => p.narration.wpm)), wordsPerSecondOfFilm: avg((p) => p.narration.wordsPerSecondOfFilm), coverage: avg((p) => p.narration.coverage), longestGap: avg((p) => p.narration.longestGap) }, loudness: { spread: avg((p) => p.loudness.spread) }, picture: { brightness: avg((p) => p.picture.brightness), saturation: avg((p) => p.picture.saturation) } };
}

// ---- originality: our words never repeat a reference's (share of our 4-word runs found in its transcript)
const grams = (t, n = 4) => { const w = (t || "").toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean); const g = new Set(); for (let i = 0; i + n <= w.length; i++) g.add(w.slice(i, i + n).join(" ")); return g; };
export const COPY_MAX = 0.2;
export function copyOverlap(text, ids) {
  const ours = grams(text); if (!ours.size) return [];
  return ids.map((id) => { const theirs = grams(profileOf(id)?.narration?.text || ""); let hit = 0; for (const g of ours) if (theirs.has(g)) hit++; return { ref: id, share: +(hit / ours.size).toFixed(2) }; });
}
