// Motion transfer helpers: the take must move like the source clip (same motion at the same moment), keep the
// source audio, and clips longer than a model accepts are filmed in overlapping pieces and joined on the overlap.
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const FPS = 12; // motion is compared on a common 12 fps grid
export const duration = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
// Frame spacing that varies by more than a fifth of a frame: a variable frame rate recording.
export function isVariableRate(f) {
  const ts = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "packet=pts_time", "-of", "csv=p=0", f]).toString().trim().split(/\r?\n/).map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const d = ts.slice(1).map((t, i) => t - ts[i]).filter((x) => x > 0);
  if (d.length < 3) return false;
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  return Math.max(...d) - Math.min(...d) > avg * 0.2;
}
// The clip's displayed shape (a phone stores 1920x1080 with a 90° rotation for a vertical video) as the nearest
// standard ratio.
export function aspectOf(f) {
  const [w, h, rot = 0] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height:stream_side_data=rotation", "-of", "csv=p=0", f]).toString().trim().split(/[\s,]+/).map(Number);
  const r = Math.abs(rot) % 180 === 90 ? h / w : w / h;
  return [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4]].reduce((b, x) => (Math.abs(x[1] - r) < Math.abs(b[1] - r) ? x : b))[0];
}
export const hasAudio = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", f]).toString().trim() !== "";

// Motion over time: the mean absolute change between consecutive frames (grey, 160x90), one value per frame.
// Camera moves, head turns and hands all show up in it; colors and style barely do, so a restyled take still compares.
export function motionCurve(file, { start = 0, len = null, grid = 1 } = {}) {
  const w = 160, h = 90;
  const args = ["-v", "error", "-ss", String(start), ...(len ? ["-t", String(len)] : []), "-i", file, "-vf", `fps=${FPS},scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"];
  const buf = execFileSync("ffmpeg", args, { maxBuffer: 1 << 28 });
  const n = Math.floor(buf.length / (w * h)), out = [];
  const gw = w / grid, gh = h / grid;
  for (let k = 1; k < n; k++) {
    const cells = Array(grid * grid).fill(0); const a = (k - 1) * w * h, b = k * w * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; cells[Math.floor(y / gh) * grid + Math.floor(x / gw)] += Math.abs(buf[b + i] - buf[a + i]); }
    out.push(grid === 1 ? cells[0] / (w * h) : cells.map((c) => c / (gw * gh)));
  }
  return out;
}

export const pearson = (x, y) => {
  const n = Math.min(x.length, y.length); if (n < 4) return 0;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
};
const shift = (x, lag) => (lag >= 0 ? x.slice(lag) : Array(-lag).fill(x[0]).concat(x));

// Does the take move like the source? Correlation of the two motion curves at the best lag within ±0.5 s.
export const MOTION_MIN = 0.6, LAG_MAX = 2; // lag in 1/12 s frames
export function matchCurves(s, t) {
  let best = { corr: -1, lag: 0 };
  for (let lag = -6; lag <= 6; lag++) { const c = pearson(shift(s, lag), t); if (c > best.corr) best = { corr: c, lag }; }
  const corr = +best.corr.toFixed(3), lagS = +(best.lag / FPS).toFixed(3);
  const issues = [];
  if (corr < MOTION_MIN) issues.push(`motion does not follow the source (match ${corr} < ${MOTION_MIN})`);
  else if (Math.abs(best.lag) > LAG_MAX) issues.push(`motion runs ${Math.abs(lagS)} s ${best.lag > 0 ? "early" : "late"} against the source`);
  return { pass: !issues.length, corr, lag: lagS, issues };
}
// Where it moves matters as much as when: the frame is split in a 4x4 grid and each cell's motion, minus the whole
// frame's (camera shake moves every cell alike), is compared. A take that copies the camera but invents its own
// gestures passes the whole-frame match and fails this one. The take must pass both.
const zoned = (g) => g.map((cells) => { const m = cells.reduce((a, b) => a + b, 0) / cells.length; return cells.map((c) => c - m); });
export function zoneMatch(sg, tg, lag = 0) {
  const s = zoned(lag >= 0 ? sg.slice(lag) : sg), t = zoned(lag >= 0 ? tg : tg.slice(-lag));
  const n = Math.min(s.length, t.length);
  return +pearson(s.slice(0, n).flat(), t.slice(0, n).flat()).toFixed(3);
}
export const ZONE_MIN = 0.45;
export function motionMatch(source, take, { start = 0 } = {}) {
  const len = duration(take);
  const r = matchCurves(motionCurve(source, { start, len }), motionCurve(take));
  const zone = zoneMatch(motionCurve(source, { start, len, grid: 4 }), motionCurve(take, { grid: 4 }), Math.round(r.lag * FPS));
  if (zone < ZONE_MIN) r.issues.push(`gestures land in other places than in the source (zone match ${zone} < ${ZONE_MIN})`);
  return { ...r, zone, pass: !r.issues.length };
}

// Pieces for a model that accepts at most maxSecs: each piece overlaps the next by `overlap` seconds and ends at
// the calmest moment near its limit, so the join lands where little moves.
export function planPieces(file, maxSecs, { overlap = 0.5, minPiece = 3, curve = null } = {}) {
  const len = duration(file);
  if (len <= maxSecs) return [{ start: 0, end: +len.toFixed(3) }];
  const m = curve || motionCurve(file), at = (t) => m[Math.min(m.length - 1, Math.max(0, Math.round(t * FPS)))] ?? 0;
  const pieces = []; let start = 0;
  while (len - start > maxSecs) {
    let best = start + maxSecs, low = Infinity;
    for (let t = start + Math.max(minPiece, maxSecs - 2.5); t <= start + maxSecs - 0.05; t += 1 / FPS) {
      const v = at(t - 0.25) + at(t) + at(t + 0.25);
      if (len - (t - overlap) >= minPiece && v < low) { low = v; best = t; }
    }
    pieces.push({ start: +start.toFixed(3), end: +best.toFixed(3) });
    start = best - overlap;
  }
  pieces.push({ start: +start.toFixed(3), end: +len.toFixed(3) });
  return pieces;
}

export function cutPiece(file, { start, end }, out) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(start), "-i", file, "-t", String(end - start), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", out]);
  return out;
}

// Joins the filmed pieces back on the source timeline: each overlap becomes a short cross-dissolve, so neither a
// cut nor a jump in time shows. Every piece is first fit to its exact source length and to the first piece's size.
export function joinPieces(files, pieces, out, { overlap = 0.5 } = {}) {
  if (files.length === 1) { fs.copyFileSync(files[0], out); return out; }
  const [W, H] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", files[0]]).toString().trim().split(",").map(Number);
  const ins = files.flatMap((f) => ["-i", f]);
  const fit = files.map((_, i) => `[${i}:v]fps=24,scale=${W}:${H},setsar=1,trim=duration=${(pieces[i].end - pieces[i].start).toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
  let chain = "[v0]", acc = pieces[0].end - pieces[0].start; const steps = [];
  for (let i = 1; i < files.length; i++) {
    const off = acc - overlap, tag = i === files.length - 1 ? "[vout]" : `[x${i}]`;
    steps.push(`${chain}[v${i}]xfade=transition=fade:duration=${overlap}:offset=${off.toFixed(3)}${tag}`);
    chain = tag; acc = off + (pieces[i].end - pieces[i].start);
  }
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...ins, "-filter_complex", [...fit, ...steps].join(";"), "-map", "[vout]", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("join failed: " + (r.stderr || "").slice(0, 300));
  return out;
}

// The look of a moment of a take: brightness, saturation and color averaged over a short window. A person moving
// barely changes these; a piece filmed with another look changes them at once, so a join that shows is caught here
// even when the motion across it is continuous.
export function lookAt(file, t, span = 0.3) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, t)), "-i", file, "-t", String(span), "-vf", "fps=10,scale=320:-2,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8" });
  const get = (k) => { const v = [...(r.stdout || "").matchAll(new RegExp(`${k}=([\\d.]+)`, "g"))].map((x) => Number(x[1])); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  return { y: get("YAVG"), u: get("UAVG"), v: get("VAVG"), sat: get("SATAVG") };
}
export const lookShift = (a, b) => +(Math.abs(a.y - b.y) + 2 * Math.abs(a.sat - b.sat) + Math.abs(a.u - b.u) + Math.abs(a.v - b.v)).toFixed(1);
// Inside one piece the look moves by under ~8 between moments 0.15 s apart; a join filmed with another look moved ~29.
export const LOOK_MAX = 15;
// Each join compared on the overlap, where both pieces show the same source moment.
export function joinCheck(takes, pieces, { overlap = 0.5 } = {}) {
  const joins = [];
  for (let i = 1; i < takes.length; i++) {
    const a = lookAt(takes[i - 1], pieces[i - 1].end - pieces[i - 1].start - overlap), b = lookAt(takes[i], 0);
    joins.push({ at: +(pieces[i].start + overlap / 2).toFixed(2), shift: lookShift(a, b), a, b });
  }
  const issues = joins.filter((j) => j.shift > LOOK_MAX).map((j) => `the join at ${j.at} s shows: the look jumps by ${j.shift} (> ${LOOK_MAX})`);
  return { pass: !issues.length, joins: joins.map(({ at, shift }) => ({ at, shift })), issues, raw: joins };
}
// Brings a piece's brightness and saturation to the previous piece's on their shared moment (free, before joining).
export function matchLook(file, target, from, out) {
  const br = Math.max(-0.3, Math.min(0.3, (target.y - from.y) / 255)), sat = Math.max(0.6, Math.min(1.6, from.sat ? target.sat / from.sat : 1));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `eq=brightness=${br.toFixed(4)}:saturation=${sat.toFixed(4)}`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", out]);
  return out;
}
// One reference image for a model that takes only one: the identity sheet (left) beside the previous piece's last
// shared frame (right), so the next piece inherits the exact look the film already has.
export function chainRef(sheet, prevTake, t, out) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", sheet, "-ss", String(Math.max(0, t)), "-i", prevTake, "-filter_complex", "[0]scale=-2:720[s];[1]scale=-2:720[f];[s][f]hstack=2", "-frames:v", "1", out]);
  return out;
}

// The source's own audio laid on the take, sample-exact: the performance keeps its voice and timing whatever the
// model did with sound.
export function keepSourceAudio(take, source, out, { start = 0 } = {}) {
  if (!hasAudio(source)) { fs.copyFileSync(take, out); return { out, audio: false }; }
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", take, "-ss", String(start), "-i", source, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
  return { out, audio: true };
}

// Object swap: change ONE thing and leave the rest of the footage as filmed.
export const swapPrompt = (target, withRef) =>
  `Change ONLY ${target} so it matches ${withRef ? "the reference image" : "this description"}. Everything else stays exactly as in the source video: the person, face, body, other clothes, hands, room, light, colors, camera, motion and timing. Do not restyle the video.`;
