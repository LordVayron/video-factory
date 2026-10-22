// Jump check: a generated shot that should be ONE continuous camera move must have no cut or snap inside it.
// ffmpeg scdet scores every frame against the previous one. A real move scores under ~6; the jumps scored 9+.
// A jump in the last 0.7 s is an "end snap" (the model snapping onto its last frame): trim one frame before it.
// Any other jump is an "internal jump" (major): it reads as a jump cut and needs the creator's call or a reroll.
// Tuned on real takes: end snaps and internal jumps scored 9 to 10.5, clean moves stayed under 4. Free: no judge call.
import { execFileSync, spawnSync } from "node:child_process";

const probe = (f, entries) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", entries, "-of", "csv=p=0", f]).toString().trim();

export function jumpCheck(file, { threshold = 8, endWindow = 0.7 } = {}) {
  const len = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  const [n, d = 1] = probe(file, "stream=r_frame_rate").split("/").map(Number);
  const frame = 1 / (n / d || 24);
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", `scdet=threshold=${threshold}`, "-f", "null", "-"], { encoding: "utf8" });
  const hits = [...(r.stderr || "").matchAll(/lavfi\.scd\.score: ([\d.]+), lavfi\.scd\.time: ([\d.]+)/g)]
    .map((m) => ({ t: Number(m[2]), score: Number(m[1]) }))
    .filter((h) => h.t > 1.5 * frame); // the first frame always scores against nothing
  // Jumps on neighbouring frames are one event (a snap often spreads over two frames): keep the first.
  const events = hits.reduce((a, h) => (a.length && h.t - a.at(-1).last < 2.5 * frame ? (a.at(-1).last = h.t, a.at(-1).score = Math.max(a.at(-1).score, h.score), a) : [...a, { ...h, last: h.t }]), []);
  const jumps = events.map(({ t, score }) => {
    const end = t >= len - endWindow;
    return { t: +t.toFixed(3), score, kind: end ? "end snap" : "internal jump", severity: end ? "minor" : "major" };
  });
  const snap = jumps.find((j) => j.kind === "end snap");
  const trimAt = snap ? +(snap.t - frame).toFixed(3) : null;
  const issues = jumps.filter((j) => j.severity === "major").map((j) => `JUMP at ${j.t.toFixed(3)} s inside the shot (score ${j.score})`);
  const notes = snap ? [`end snap at ${snap.t.toFixed(3)} s: trim the shot at ${trimAt.toFixed(3)} s`] : [];
  return { pass: !issues.length, jumps, trimAt, issues, notes, threshold, at: new Date().toISOString() };
}

export const jumpLines = (r) => [
  ...r.jumps.map((j) => `JUMP at ${j.t.toFixed(3)} s: ${j.kind} (score ${j.score}${j.severity === "major" ? ", MAJOR" : ""})`),
  r.trimAt != null ? `suggested trim: keep 0–${r.trimAt.toFixed(3)} s` : null,
  r.jumps.length ? null : "no jumps: one continuous shot",
].filter(Boolean);
