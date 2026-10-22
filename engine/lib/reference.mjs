// A reference video's measurable profile (2026-10-21, a launch film: the Town reference was read with a silence detector
// only, called "music, no voice", and the film was planned with chopped lines; Town has 83 words of continuous
// narration). Speech is always transcribed with whisper, never inferred from loudness.
//   cuts and shot lengths · narration (words, wpm, words per second of film, coverage, longest gap) ·
//   loudness band in 2 s windows · brightness and saturation · motion
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./env.mjs";

const num = (s) => Number(s);
const ffErr = (args) => spawnSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;

export function words(file, lang = "en") {
  const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "words.py"), file, lang], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`words.py: ${(r.stderr || "").slice(-200)}`);
  return JSON.parse(r.stdout);
}

// Mean volume of each 2 s window (dB), for how even the mix is.
export function loudnessBand(file, dur) {
  const out = [];
  for (let t = 0; t + 1 < dur; t += 2) {
    const m = ffErr(["-ss", String(t), "-t", "2", "-i", file, "-af", "volumedetect", "-f", "null", "-"]).match(/mean_volume: (-?[\d.]+)/);
    if (m) out.push(num(m[1]));
  }
  // The last window holds the fade-out; it is left out of the spread.
  const body = out.slice(0, -1);
  return { windows: out, min: Math.min(...body), max: Math.max(...body), spread: +(Math.max(...body) - Math.min(...body)).toFixed(1) };
}

export function profile(file, { lang = "en" } = {}) {
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", file]).toString());
  const v = probe.streams.find((s) => s.codec_type === "video"), dur = num(probe.format.duration);
  // Cuts: a sensitive threshold (2026-10-22: at 10 two Town cuts between scenes of one palette were missed), then the
  // detections less than 0.35 s apart are one cut, placed on the frame that changed most (fast motion fires in bursts).
  const det = [...ffErr(["-i", file, "-vf", "scdet=threshold=7", "-an", "-f", "null", "-"]).matchAll(/lavfi\.scd\.score: ([\d.]+)[\s\S]*?lavfi\.scd\.time: ([\d.]+)/g)].map((m) => ({ s: num(m[1]), t: num(m[2]) }));
  const groups = []; for (const d of det) { const g = groups.at(-1); if (g && d.t - g.at(-1).t < 0.35) g.push(d); else groups.push([d]); }
  const cuts = groups.map((g) => g.reduce((a, b) => (b.s > a.s ? b : a)).t).filter((t) => t > 0.2 && t < dur - 0.2);
  const bounds = [0, ...cuts, dur], shots = bounds.slice(1).map((b, i) => +(b - bounds[i]).toFixed(2));
  const w = words(file, lang);
  let speech = 0, maxGap = 0;
  for (let i = 0; i < w.length; i++) { speech += w[i].end - w[i].start; if (i) maxGap = Math.max(maxGap, w[i].start - w[i - 1].end); }
  const spoken = w.length ? w.at(-1).end - w[0].start : 0;
  const stats = [...ffErr(["-i", file, "-vf", "fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG,metadata=print:key=lavfi.signalstats.SATAVG", "-f", "null", "-"]).matchAll(/(YAVG|SATAVG)=([\d.]+)/g)];
  const avg = (k) => { const xs = stats.filter((m) => m[1] === k).map((m) => num(m[2])); return +(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1); };
  const motion = [...ffErr(["-i", file, "-vf", "fps=6,scale=160:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]).matchAll(/YAVG=([\d.]+)/g)].map((m) => num(m[1]));
  return {
    file: path.basename(file), duration: +dur.toFixed(2), size: `${v.width}x${v.height}`, fps: v.r_frame_rate,
    cuts: cuts.map((c) => +c.toFixed(2)), shots, avgShot: +(dur / shots.length).toFixed(2),
    narration: { words: w.length, text: w.map((x) => x.w).join(" "), wpm: spoken ? Math.round((w.length / spoken) * 60) : 0, wordsPerSecondOfFilm: +(w.length / dur).toFixed(2), coverage: +(spoken / dur).toFixed(2), longestGap: +maxGap.toFixed(2), start: w[0]?.start ?? null, end: w.at(-1)?.end ?? null },
    loudness: loudnessBand(file, dur),
    picture: { brightness: avg("YAVG"), saturation: avg("SATAVG") },
    motion: { mean: +(motion.reduce((a, b) => a + b, 0) / Math.max(1, motion.length)).toFixed(1), peak: +Math.max(...motion).toFixed(1) },
  };
}
