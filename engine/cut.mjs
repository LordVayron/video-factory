#!/usr/bin/env node
// Editor for clips formats (influencer, UGC, podcast, cinematic, fantasy, other): flow v5, edit step.
// A plain cut of each shot's approved take, in shotlist order. Nothing creative is added here: no captions,
// no zoom or crop, no music. Those are the creator's calls and come from the shotlist only after he says yes.
//  - Picture: each take at its native framing, scaled to 720p, trimmed to [in, out]; a take that ends on an
//    end snap (lib/jumps.mjs) is cut one frame before it.
//  - Sound: the take's own audio, or (shot.revoice) its line re-voiced into the character's official voice with
//    ElevenLabs speech-to-speech (timing kept, so lip sync holds), gain-matched to the native shots, over
//    shot.bed or sl.bed (ambience the re-voice strips out).
//  - One two-pass linear loudness pass to -14 LUFS. H.264 yuv420p, AAC.
// Takes are used only if every eval passed (gen.mjs clip). --draft cuts the latest takes into out/<slug>-DRAFT.mp4,
// which can never be delivered.
//
//   node engine/cut.mjs <slug> [--draft]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as P from "./lib/project.mjs";
import * as eleven from "./lib/eleven.mjs";
import { requireStep, FlowStop, fileSha, takesSig, takeOk, kindOf } from "./lib/flow.mjs";

const argv = process.argv.slice(2);
const slug = argv[0], draft = argv.includes("--draft");
if (!slug) { console.error("usage: cut.mjs <slug> [--draft]"); process.exit(1); }
try {
  const sl = P.loadShotlist(slug);
  requireStep(sl, draft ? "film" : "edit", draft ? "cut --draft" : "cut");
  if (kindOf(sl) !== "clips") throw new FlowStop(`cut.mjs is for clips formats; ${sl.format} uses ${kindOf(sl) === "scenes" ? "edit.mjs" : "longform.mjs build"}`);
  await cut(sl);
} catch (e) { console.error(e instanceof FlowStop ? `ALTO: ${e.message}` : `ERROR: ${e.message}`); process.exit(e instanceof FlowStop ? 2 : 1); }

async function cut(sl) {
  const dir = P.projectDir(slug), tmp = path.join(dir, "out", "_cut");
  fs.mkdirSync(tmp, { recursive: true });
  const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { cwd: dir });
  const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
  const lufs = (f) => Number((spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  const [W, H] = sl.ar === "16:9" ? [1280, 720] : [720, 1280];
  const fps = sl.fps || 24;

  // 1. Which take, from where to where.
  const parts = sl.shots.map((s) => {
    let ci = s.clip;
    if (ci == null && draft) ci = (s.clips || []).length - 1;
    const t = s.clips?.[ci];
    if (!t) throw new FlowStop(`${s.id} has no take`);
    if (!draft && !takeOk(t)) throw new FlowStop(`${s.id}: its take did not pass every eval`);
    const file = P.abs(slug, t.file);
    const end = Math.min(s.out ?? Infinity, t.evals?.jumps?.trimAt ?? Infinity, s.duration ?? Infinity, dur(file));
    return { s, t, file, a: s.in ?? 0, b: end };
  });

  // 2. Sound per shot.
  const native = parts.filter((p) => !p.s.revoice);
  const ref = native.length ? (() => { const f = path.join(tmp, "ref.wav"); ff(["-i", native[0].file, "-t", String(native[0].b - native[0].a), "-ss", String(native[0].a), "-vn", "-ac", "1", f]); return lufs(f); })() : -18;
  for (const [i, p] of parts.entries()) {
    const len = p.b - p.a;
    p.wav = path.join(tmp, `${i}-${p.s.id}.wav`);
    if (!p.s.revoice) { ff(["-ss", String(p.a), "-t", len.toFixed(3), "-i", p.file, "-vn", "-af", "aresample=48000", "-ac", "2", p.wav]); continue; }
    const who = (p.s.dialogue || [])[0]?.char || (p.s.characters || [])[0];
    const voice = P.character(who).voice?.eleven;
    if (!voice) throw new FlowStop(`${p.s.id}: revoice needs ${who}'s ElevenLabs voice`);
    const raw = path.join(tmp, `${i}-${p.s.id}-raw.wav`);
    ff(["-ss", String(p.a), "-t", len.toFixed(3), "-i", p.file, "-vn", "-ac", "1", "-ar", "44100", raw]);
    // Speech-to-speech cached by the source audio's hash, so a re-cut never re-bills the same line.
    const key = crypto.createHash("sha1").update(fs.readFileSync(raw)).update(voice).digest("hex").slice(0, 12);
    const sts = path.join(tmp, `sts-${key}.mp3`);
    if (!fs.existsSync(sts)) {
      await eleven.sts({ file: raw, voice, out: sts, settings: { stability: 0.55, similarity_boost: 0.92, style: 0, use_speaker_boost: true } });
      P.ledger(slug, { ok: true, label: `${p.s.id} revoice`, model: "elevenlabs-sts", credits: 0, files: [P.rel(slug, sts)] });
    }
    const gain = (ref - lufs(sts)).toFixed(2);
    const bed = p.s.bed || sl.bed;
    if (bed) ff(["-i", sts, "-i", P.abs(slug, bed.file || bed), "-filter_complex", `[0:a]aresample=48000,volume=${gain}dB,apad,atrim=0:${len.toFixed(3)}[v];[1:a]aresample=48000,volume=${bed.db ?? -26}dB,afade=t=in:d=0.15,apad,atrim=0:${len.toFixed(3)}[b];[v][b]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[o]`, "-map", "[o]", p.wav]);
    else ff(["-i", sts, "-af", `aresample=48000,volume=${gain}dB,apad,atrim=0:${len.toFixed(3)}`, "-ac", "2", p.wav]);
  }

  // 3. Picture and sound joined, then one loudness pass.
  const n = parts.length;
  const graph = parts.map((p, i) => `[${i}:v]trim=${p.a}:${p.b},setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`)
    .concat(`${parts.map((_, i) => `[v${i}][${n + i}:a]`).join("")}concat=n=${n}:v=1:a=1[v][a]`).join(";");
  const mov = path.join(tmp, "cut.mov");
  ff([...parts.flatMap((p) => ["-i", p.file]), ...parts.flatMap((p) => ["-i", p.wav]), "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", mov]);
  const m = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", mov, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(m.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  const ln = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const out = path.join(dir, "out", draft ? `${slug}-DRAFT.mp4` : `${slug}.mp4`);
  ff(["-i", mov, "-c:v", "copy", "-af", `${ln},aresample=48000`, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  // The cut points, so the final QC knows where the edit cuts on purpose.
  const cuts = parts.reduce((a, p) => [...a, (a.at(-1) ?? 0) + (p.b - p.a)], []).slice(0, -1).map((t) => +t.toFixed(3));
  if (!draft) P.updateShotlist(slug, (x) => { x.cut = { sha: fileSha(out), takes: takesSig(x), cuts, at: new Date().toISOString() }; });
  console.log(`${P.rel(slug, out)} · ${parts.map((p) => `${p.s.id} ${(p.b - p.a).toFixed(2)} s${p.s.revoice ? " (re-voiced)" : ""}`).join(" + ")} · ${lufs(out)} LUFS${draft ? " · DRAFT (not deliverable)" : ""}`);
}
