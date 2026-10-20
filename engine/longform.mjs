#!/usr/bin/env node
// Long-form ambient video: guided meditation, sleep stories, focus/study music, ambient loops.
// A few seamless loop scenes cross-fade slowly for 10-120 minutes under a music bed and an optional voice-over
// with long pauses. Generation is paid and goes through gen.mjs (budget lock); everything here is free (ffmpeg).
//
//   node engine/longform.mjs new <slug> --title "..." [--minutes 20] [--lang en] [--ar 16:9]
//   node engine/longform.mjs estimate <slug>          cost of what is still to generate -> sl.bookEstimate
//   node engine/longform.mjs build <slug> [--draft] [--sample 90]   -> out/<slug>.mp4, out/<slug>.mp3, contact sheet, QC
//
// Paid steps (after `phase.mjs approve <slug> storyboard` locks the estimate):
//   node engine/gen.mjs loops <slug>       still + seamless loop clip per scene (motion "kenburns" = free zoom)
//   node engine/gen.mjs bed <slug>         Suno music takes
//   node engine/gen.mjs narration <slug>   ElevenLabs voice-over segments (ElevenLabs characters, not Kie credits)
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import * as P from "./lib/project.mjs";
import { getModel, usd } from "./lib/models.mjs";
import { requireStep, FlowStop, fileSha, takesSig } from "./lib/flow.mjs";
import { INTENTS, isDemo, voicePace, youtubePackage, motionScore, MIN_MOTION } from "./lib/meditation.mjs";

const argv = process.argv.slice(2);
const [cmd, slug] = argv;
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
const FPS = 24;

const T0 = Date.now();
const ff = (args) => { if (process.env.LF_TIMING) console.error(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ffmpeg ${args.filter((a) => /^-(i|filter_complex|af|vf)$/.test(a) ? false : true).slice(-1)[0]}`); return ffRun(args); };
const ffRun = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 1 << 26 });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

const TEMPLATE = (title, minutes, lang, ar) => ({
  slug, title, format: "longform", lang, ar, phases: {}, shots: [],
  longform: {
    minutes,
    intent: "", // sleep | anxiety | higher-self | manifestation | morning | self-love | breathwork | focus (lib/meditation.mjs)
    premise: "", // the meditation in one sentence; every scene shows a part of it (premiseLink)
    demo: false, seconds: 25, // demo: a 15-30 s preview (landing, Shorts, trailer) with a short lead-in and fades
    look: "Soft painterly light, calm muted palette, gentle depth, high detail.",
    imageModel: "gpt2.5", imageSize: "2K", videoModel: "sd2-mini", res: "720p", output: "1080p",
    crossfade: 8,
    scenes: [
      { id: "A", picture: "A misty pine forest at dawn, sun rays through the trees, a still lake in the foreground", motion: "mist drifts slowly between the trees, tiny ripples on the lake, light rays shimmer softly", seconds: 8 },
      { id: "B", picture: "A quiet mountain lake at blue hour, stars appearing, reflections on the water", motion: "stars twinkle, the water surface moves very gently", seconds: 8 },
      { id: "C", picture: "A warm candle-lit stone room with a window onto falling snow", motion: "the candle flames flicker softly, snow falls slowly outside the window", motion_alt: "kenburns", seconds: 8 },
    ],
    music: { prompt: "ambient meditation, soft warm pads, distant piano, 60 bpm, no drums, no vocals, peaceful, slowly evolving", tracks: 2, db: -20 },
    voice: { eleven: "", model: "eleven_multilingual_v2", settings: { stability: 0.75, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 0.88 } },
    leadIn: 20, tail: 30, lufs: -16,
    script: [
      { text: "Welcome. Find a comfortable position, and let your eyes gently close.", pauseAfter: 6 },
      { text: "Breathe in slowly through your nose... and let it go.", pauseAfter: 10 },
    ],
  },
});

// Output frame size from aspect and the requested output height.
function frameSize(L, ar, draft) {
  const h = draft ? 360 : { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 }[L.output || "1080p"] || 1080;
  const [a, b] = (ar || "16:9").split(":").map(Number);
  const even = (n) => Math.round(n / 2) * 2;
  return a >= b ? { W: even((h * a) / b), H: h } : { W: h, H: even((h * b) / a) };
}

let CRF = 20;
const crfOf = () => CRF;
// Every piece of picture is encoded with the same x264 settings, so pieces can be joined by stream copy.
// A 60-minute video then encodes only its loop units and transitions; the long stretches are copies.
const venc = (draft) => ["-c:v", "libx264", "-preset", draft ? "ultrafast" : "medium", "-crf", draft ? "30" : String(crfOf()), "-tune", "film",
  "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2), "-keyint_min", String(FPS * 2),
  "-sc_threshold", "0", "-x264-params", "repeat-headers=1", "-an", "-f", "mpegts"];
const frames = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", f], { encoding: "utf8" }).trim().split(/\s+/)[0]);

// One seamless loop unit per scene, at the output size.
//  - clip: the model was asked for first frame = last frame; to hide any residual seam, the last `d` seconds are
//    cross-faded into the head (output length L - d, and its last frame is exactly its first).
//  - kenburns: a slow sinusoidal zoom on the still; one full period, so the end meets the start.
function loopUnit(sc, dir, W, H, draft) {
  // Cached per source clip: a re-made loop must never be built from the old unit (2026-10-20, Midnight Lake).
  const src = path.basename(sc.motion === "kenburns" ? sc.image || "still" : sc.clip || sc.image || "still").replace(/\.\w+$/, "");
  const out = path.join(dir, `unit-${sc.id}-${src}-${W}x${H}${draft ? "-draft" : ""}.ts`);
  if (fs.existsSync(out) && !has("--rebuild")) return out;
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1`;
  const clip = sc.clip && fs.existsSync(P.abs(slug, sc.clip)) ? P.abs(slug, sc.clip) : null;
  if (clip && sc.motion !== "kenburns") {
    const L = dur(clip), d = Math.min(2, L / 4); // a free-moving clip needs a longer cross-fade to hide its seam
    ff(["-i", clip, "-filter_complex",
      `[0:v]fps=${FPS},${cover},split[a][b];[a]trim=${d}:${L},setpts=PTS-STARTPTS[main];[b]trim=0:${d},setpts=PTS-STARTPTS[head];` +
      `[main][head]xfade=transition=fade:duration=${d}:offset=${(L - 2 * d).toFixed(3)}[v]`,
      "-map", "[v]", ...venc(draft), out]);
    return out;
  }
  const still = sc.image && fs.existsSync(P.abs(slug, sc.image)) ? P.abs(slug, sc.image) : null;
  if (!still) throw new Error(`scene ${sc.id} has no clip and no image yet: node engine/gen.mjs loops ${slug}`);
  const N = (sc.period || 30) * FPS;
  ff(["-loop", "1", "-i", still, "-filter_complex",
    `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W * 2}:${H * 2},` +
    `zoompan=z='1.05+0.05*sin(2*PI*on/${N})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[v]`,
    "-map", "[v]", "-frames:v", String(N), ...venc(draft), out]);
  return out;
}

// Plan the picture in frames. Scene k plays its unit from frame `s` (0, or x after a transition) for `vis` frames;
// every scene but the last ends at unit frame n - x, where the cross-fade into the next scene's head begins.
function picturePlan(units, totalF, x, weights) {
  const n = units.map(frames);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const K = units.length, plan = [];
  let used = 0;
  for (let k = 0; k < K; k++) {
    const s = k === 0 ? 0 : x;
    if (k === K - 1) { plan.push({ k, s, vis: totalF - used }); break; }
    const target = Math.round(((totalF - x * (K - 1)) * weights[k]) / wsum);
    const base = (n[k] - x - s + n[k]) % n[k] || n[k];            // frames from s to the first n-x point
    const m = Math.max(0, Math.round((target - base) / n[k]));
    const vis = base + m * n[k];
    plan.push({ k, s, vis });
    used += vis + x;
  }
  return { n, plan };
}

// Continuous play of unit k from frame s for vis frames, as pieces: whole units (copied) and partial ranges.
function pieces(n, s, vis) {
  const out = [];
  let pos = s, left = vis;
  while (left > 0) {
    const run = Math.min(n - pos, left);
    out.push(pos === 0 && run === n ? { full: true } : { a: pos, b: pos + run });
    left -= run;
    pos = (pos + run) % n;
  }
  return out;
}

function renderPicture(units, totalF, x, weights, dir, draft, fades = { in: 3, out: 6 }) {
  const { n, plan } = picturePlan(units, totalF, x, weights);
  const list = [];
  let idx = 0;
  const part = (args) => { const f = path.join(dir, `piece-${String(idx++).padStart(4, "0")}.ts`); ff([...args, ...venc(draft), f]); return f; };
  const fadeIn = `fade=t=in:d=${fades.in}`;
  plan.forEach(({ k, s, vis }, i) => {
    const ps = pieces(n[k], s, vis);
    let t = 0;
    ps.forEach((p, j) => {
      const len = p.full ? n[k] : p.b - p.a;
      const first = i === 0 && j === 0, last = i === plan.length - 1 && j === ps.length - 1;
      const fx = [first ? fadeIn : null, last ? `fade=t=out:st=${Math.max(0, len / FPS - fades.out).toFixed(3)}:d=${Math.min(fades.out, len / FPS).toFixed(3)}` : null].filter(Boolean);
      if (p.full && !fx.length) list.push(units[k]);
      else list.push(part(["-i", units[k], "-vf", [p.full ? null : `trim=start_frame=${p.a}:end_frame=${p.b}`, "setpts=PTS-STARTPTS", ...fx].filter(Boolean).join(",")]));
      t += len;
    });
    if (i < plan.length - 1) {
      const kk = plan[i + 1].k;
      list.push(part(["-i", units[k], "-i", units[kk], "-filter_complex",
        `[0:v]trim=start_frame=${n[k] - x}:end_frame=${n[k]},setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=${x},setpts=PTS-STARTPTS[b];` +
        `[a][b]xfade=transition=fade:duration=${(x / FPS).toFixed(4)}:offset=0,trim=end_frame=${x}[v]`, "-map", "[v]"]));
    }
  });
  const lst = path.join(dir, "pieces.txt");
  fs.writeFileSync(lst, list.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  return lst;
}

// Narration timeline: lead-in, each segment followed by its pause, then the tail. Returns the vo track and cues.
function voiceTrack(L, dir, maxLen) {
  const segs = (L.script || []).map((s, i) => ({ ...s, file: P.abs(slug, `audio/vo/${String(i + 1).padStart(3, "0")}.mp3`) }))
    .filter((s) => s.text?.trim());
  const missing = segs.filter((s) => !fs.existsSync(s.file));
  if (missing.length) throw new Error(`${missing.length} narration segment(s) missing: node engine/gen.mjs narration ${slug}`);
  // A demo starts speaking by ~2 s (the first 3 s decide a preview); a full piece lets the music settle first.
  const lead = L.leadIn ?? (isDemo(L) ? 1.5 : 20);
  if (!segs.length) return { file: null, end: lead, cues: [] };
  // Place every segment (a --sample stops once the timeline passes maxLen).
  let t = lead;
  const used = [];
  for (const s of segs) {
    if (maxLen && t >= maxLen) break;
    const d = dur(s.file), pause = s.pauseAfter ?? 4;
    used.push({ ...s, at: t, d, pause });
    t += d + pause;
  }
  const sil = (sec, lbl) => `anullsrc=r=44100:cl=mono,atrim=0:${sec.toFixed(3)}[${lbl}]`;
  const parts = [sil(lead, "s0")], labels = ["[s0]"];
  used.forEach((s, i) => {
    parts.push(`[${i}:a]aresample=44100,aformat=channel_layouts=mono,afade=t=in:d=0.05[v${i}]`, sil(s.pause, `p${i}`));
    labels.push(`[v${i}]`, `[p${i}]`);
  });
  const out = path.join(dir, "vo.wav");
  ff([...used.flatMap((s) => ["-i", s.file]), "-filter_complex",
    `${parts.join(";")};${labels.join("")}concat=n=${labels.length}:v=0:a=1[vo]`, "-map", "[vo]", out]);
  return { file: out, end: t, cues: used.map((s) => ({ at: +s.at.toFixed(2), d: +s.d.toFixed(2), text: s.text })) };
}

// Music bed: every take, chained with long cross-fades; looped by the final mix if it is shorter than the video.
function musicBed(L, dir) {
  const files = (L.music?.files || []).map((f) => P.abs(slug, f)).filter((f) => fs.existsSync(f));
  const order = L.music?.order ? L.music.order.map((k) => files[k]).filter(Boolean) : files;
  if (!order.length) return null;
  const out = path.join(dir, "bed.wav");
  if (order.length === 1) { ff(["-i", order[0], "-ar", "44100", "-ac", "2", out]); return out; }
  const x = 8;
  let chain = "[0:a]aresample=44100[m0]", last = "m0";
  for (let k = 1; k < order.length; k++) { chain += `;[${k}:a]aresample=44100[i${k}];[${last}][i${k}]acrossfade=d=${x}:c1=tri:c2=tri[m${k}]`; last = `m${k}`; }
  ff([...order.flatMap((f) => ["-i", f]), "-filter_complex", chain, "-map", `[${last}]`, "-ac", "2", out]);
  return out;
}

function build() {
  const sl = P.loadShotlist(slug);
  const L = sl.longform;
  if (!L) throw new Error(`${slug} is not a long-form project (no "longform" block)`);
  requireStep(sl, "edit", "longform build");
  const draft = has("--draft");
  const sample = Number(flag("--sample", 0)) || 0;
  const { W, H } = frameSize(L, sl.ar, draft);
  CRF = L.crf ?? 20;   // ambient footage is soft; 20 keeps 1080p around 3-4 Mbps
  const dir = P.abs(slug, "out/_longform");
  fs.mkdirSync(dir, { recursive: true });

  const vo = voiceTrack(L, dir, sample || 0);
  const demo = isDemo(L);
  const natural = vo.end + (L.tail ?? (demo ? 4 : 30));
  const total = sample || (demo ? Math.max(natural, L.seconds || 0) : Math.max(natural, (L.minutes || 0) * 60));
  const fades = demo ? { in: 1.5, out: 3, audioIn: 1.5, audioOut: 3 } : { in: 3, out: 6, audioIn: 4, audioOut: 10 };
  // Dark screen (sleep): the picture fades to black at darkAfter minutes and stays black; the sound carries on.
  const darkAt = !sample && !demo && L.darkAfter != null ? Math.min(total, L.darkAfter * 60) : null;
  const bed = musicBed(L, dir);
  if (!bed && !vo.file) throw new Error("nothing to hear: generate the music bed (gen.mjs bed) and/or the narration");

  // Picture: scenes share the running time in order (or by `weight`), joined with slow cross-fades.
  const scenes = L.scenes || [];
  if (!scenes.length) throw new Error("longform.scenes is empty");
  // A loop that doesn't move reads as a still picture (2026-10-20, Midnight Lake: motion 0.09 shipped as a draft).
  for (const sc of scenes) {
    if (sc.motion === "kenburns" || !sc.clip || sc.staticOk) continue;
    const m = sc.motionScore ?? motionScore(P.abs(slug, sc.clip));
    if (m < MIN_MOTION) throw new FlowStop(`LOOP STATIC: la escena ${sc.id} casi no se mueve (${m}, mínimo ${MIN_MOTION}); se ve como una foto. Rehaz el loop (gen.mjs loops ${slug} --redo con el sí del creador) o sc.staticOk con sus palabras`);
  }
  const units = scenes.map((sc) => loopUnit(sc, dir, W, H, draft));
  const totalF = Math.round((darkAt ?? total) * FPS);
  const minUnit = Math.min(...units.map(frames));
  const x = Math.max(FPS, Math.min(Math.round((L.crossfade ?? 8) * FPS), Math.floor(minUnit / 2), Math.floor(totalF / scenes.length / 3)));
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("piece-"))) fs.rmSync(path.join(dir, f));
  const pieceList = renderPicture(units, totalF, x, scenes.map((s) => s.weight || 1), dir, draft, darkAt != null ? { in: fades.in, out: 30 } : fades);
  if (darkAt != null && total - darkAt > 0.5) {
    const black = path.join(dir, "piece-black.ts");
    ff(["-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${FPS}:d=${(total - darkAt).toFixed(3)}`, ...venc(draft), black]);
    fs.appendFileSync(pieceList, `\nfile '${black.replace(/\\/g, "/")}'`);
  }
  const picture = path.join(dir, "picture.ts");
  ff(["-f", "concat", "-safe", "0", "-i", pieceList, "-c", "copy", picture]);

  // Sound: the bed sits low and ducks gently under the voice; one loudness pass at the end.
  const ain = [];
  let achain = "";
  const musicDb = L.music?.db ?? -20;
  if (bed) { ain.push("-stream_loop", "-1", "-i", bed); }
  if (vo.file) { ain.push("-i", vo.file); }
  const mIdx = bed ? 0 : null, vIdx = vo.file ? (bed ? 1 : 0) : null;
  if (bed && vo.file) {
    achain = `[${vIdx}:a]apad,atrim=0:${total},aformat=channel_layouts=stereo,asplit[vo][sc];` +
      `[${mIdx}:a]atrim=0:${total},asetpts=PTS-STARTPTS,volume=${musicDb}dB[m];` +
      `[m][sc]sidechaincompress=threshold=0.015:ratio=4:attack=300:release=2000:makeup=1[md];` +
      `[vo][md]amix=inputs=2:normalize=0[mix];`;
  } else if (bed) {
    achain = `[${mIdx}:a]atrim=0:${total},asetpts=PTS-STARTPTS,volume=${musicDb}dB[mix];`;
  } else {
    achain = `[${vIdx}:a]apad,atrim=0:${total},aformat=channel_layouts=stereo[mix];`;
  }
  achain += `[mix]afade=t=in:d=${fades.audioIn},afade=t=out:st=${(total - fades.audioOut).toFixed(3)}:d=${fades.audioOut},aresample=48000[aout]`;
  const mixWav = path.join(dir, "mix.wav");
  ff([...ain, "-filter_complex", achain, "-map", "[aout]", "-t", total.toFixed(3), mixWav]);
  // Loudness: measure the mix, then one linear gain plus a true-peak limiter (keeps the dynamics a meditation needs,
  // and is several times faster than loudnorm on an hour of audio).
  const target = L.lufs ?? -16;
  const measured = loudness(mixWav).lufs;
  let audio = mixWav;
  if (Number.isFinite(measured) && Math.abs(measured - target) > 0.5) {
    audio = path.join(dir, "mix-gain.wav");
    ff(["-i", mixWav, "-af", `volume=${(target - measured).toFixed(2)}dB,alimiter=limit=0.79:attack=5:release=200:level=false`, audio]);
  }

  const name = sample ? `${slug}-sample` : draft ? `${slug}-draft` : slug;
  const out = P.abs(slug, `out/${name}.mp4`);
  console.log(`built ${name}: ${(total / 60).toFixed(1)} min, ${scenes.length} scene(s), ${W}x${H}${bed ? ", music" : ""}${vo.file ? `, ${vo.cues.length} narration segments` : ""}`);
  ff(["-i", picture, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", total.toFixed(3), "-movflags", "+faststart", out]);

  // Audio-only copy (podcast apps, Spotify, Insight Timer) and a contact sheet (one frame per ~minute).
  const mp3 = out.replace(/\.mp4$/, ".mp3");
  ff(["-i", audio, "-c:a", "libmp3lame", "-b:a", "192k", mp3]);
  // One seek per tile instead of decoding the whole video (minutes saved on a 60-minute file).
  const sheet = out.replace(/\.mp4$/, "-sheet.jpg");
  const tiles = Array.from({ length: 24 }, (_, i) => ((i + 0.5) * total) / 24);
  const shots = tiles.map((t, i) => { const f = path.join(dir, `sheet-${String(i).padStart(2, "0")}.jpg`); ff(["-ss", t.toFixed(2), "-i", out, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", f]); return f; });
  ff(["-framerate", "1", "-i", path.join(dir, "sheet-%02d.jpg"), "-vf", "tile=6x4:padding=4:margin=4", "-frames:v", "1", "-q:v", "4", sheet]);
  shots.forEach((f) => fs.rmSync(f, { force: true }));

  const qc = finalQc(out, audio, total, L, !!bed);
  // The recorded voice against the intention's pace (2026-10-20: universal meditation engine).
  const pace = voicePace(vo.cues, L.intent);
  qc.wpm = pace.wpm;
  qc.issues.push(...pace.issues);
  if (demo && (total < 15 || total > 30)) qc.issues.push(`demo de ${total.toFixed(1)} s; un demo va de 15 a 30 s`);
  qc.pass = !qc.issues.length;
  if (!sample && !draft) fs.writeFileSync(out.replace(/\.mp4$/, "-youtube.md"), youtubePackage(sl, vo.cues));
  if (!sample && !draft) P.updateShotlist(slug, (x) => { x.finalQc = qc; x.longform.cues = vo.cues; x.cut = { sha: fileSha(out), takes: takesSig(x), at: qc.at }; });
  console.log(`${path.relative(process.cwd(), out)}\n${path.relative(process.cwd(), mp3)}\n${path.relative(process.cwd(), sheet)}`);
  console.log(`QC ${qc.pass ? "PASS" : "FAIL"}: ${qc.minutes} min, ${qc.lufs} LUFS (target ${L.lufs ?? -16}), true peak ${qc.peak} dB, ${qc.silences.length} dead-air gap(s)${qc.wpm ? `, voice ${qc.wpm} wpm` : ""}${qc.issues.length ? "\n  - " + qc.issues.join("\n  - ") : ""}`);
}

// Duration, loudness, true peak, and dead air (with a music bed there should never be 6 s of near silence).
function loudness(file) {
  const e = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 }).stderr;
  const lufs = Number((e.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  const peak = Number((e.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  return { lufs, peak };
}

// Audio checks run on the final WAV (decoding a 1080p video just to read its audio is slow).
function finalQc(file, wav, want, L, hasBed) {
  const { lufs, peak } = loudness(wav);
  const s = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-af", "silencedetect=n=-55dB:d=6", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 }).stderr;
  const silences = [...s.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 5 && t < want - 12);
  const got = dur(file);
  const issues = [];
  if (Math.abs(got - want) > 2) issues.push(`duration ${got.toFixed(1)} s, planned ${want.toFixed(1)} s`);
  if (!(Math.abs(lufs - (L.lufs ?? -16)) <= 2)) issues.push(`loudness ${lufs} LUFS`);
  if (peak > -1) issues.push(`true peak ${peak} dB (clipping risk)`);
  if (hasBed && silences.length) issues.push(`dead air at ${silences.map((t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`).join(", ")}`);
  return { pass: !issues.length, minutes: +(got / 60).toFixed(2), lufs, peak, silences, issues, at: new Date().toISOString() };
}

function estimate() {
  const sl = P.loadShotlist(slug);
  requireStep(sl, "book", "longform estimate");
  const L = sl.longform;
  let cr = 0;
  const rows = [];
  for (const sc of L.scenes || []) {
    if (!sc.image) { const c = getModel(L.imageModel || "gpt2.5").cost({ size: L.imageSize || "2K" }); cr += c; rows.push([`${sc.id} still`, c]); }
    if (sc.motion !== "kenburns" && !sc.clip) { const c = getModel(L.videoModel || "sd2-mini").cost({ res: L.res || "720p", duration: sc.seconds || 8 }); cr += c; rows.push([`${sc.id} loop ${sc.seconds || 8}s`, c]); }
  }
  const haveTakes = (L.music?.files || []).length;
  const runs = Math.max(0, (L.music?.tracks || 2) - Math.floor(haveTakes / 2));
  if (runs) { const c = runs * getModel("suno").cost({}); cr += c; rows.push([`music ${runs} generation(s)`, c]); }
  const chars = (L.script || []).reduce((n, s) => n + (s.text || "").length, 0);
  for (const [k, c] of rows) console.log(`${k.padEnd(28)} ${c.toFixed(1).padStart(6)} cr  ${usd(c)}`);
  console.log(`${"total Kie".padEnd(28)} ${cr.toFixed(1).padStart(6)} cr  ${usd(cr)}`);
  console.log(`narration: ${chars} ElevenLabs characters (billed by ElevenLabs)`);
  const spoken = (L.script || []).reduce((n, s) => n + (s.text || "").split(/\s+/).length, 0);
  console.log(`script: ${(L.script || []).length} segments, ~${spoken} words; planned length ${L.minutes || "auto"} min`);
  P.updateShotlist(slug, (x) => { x.bookEstimate = Math.ceil(cr); });
  console.log(`\nbookEstimate = ${Math.ceil(cr)} cr. Next: node engine/book.mjs ${slug}, publish it, and after the creator approves: node engine/studio.mjs approve ${slug} book --said '...'`);
}

function create() {
  if (!slug) throw new Error('usage: new <slug> --title "..." [--minutes 20] [--lang en] [--ar 16:9]');
  const dir = path.join(P.PROJECTS, slug);
  if (fs.existsSync(path.join(dir, "shotlist.json"))) throw new Error(`project ${slug} exists`);
  const sl = TEMPLATE(flag("--title", slug), Number(flag("--minutes", 20)), flag("--lang", "en"), flag("--ar", "16:9"));
  P.writeJSON(path.join(dir, "shotlist.json"), sl);
  fs.writeFileSync(path.join(dir, "concept.md"), `# Concept: ${sl.title}\n\n- **Format:** long-form (${sl.longform.minutes} min, ${sl.ar})\n- **Language:** ${sl.lang}\n\n## Intention\n(what the listener should feel by the end)\n\n## Arc\n(arrival, settling, the journey, return)\n\n## Look and sound\n`);
  console.log(`created projects/${slug}/ (shotlist.json with a long-form template, concept.md).\nEdit longform.scenes, music, voice and script, then: node engine/longform.mjs estimate ${slug}`);
}

// The creator's own material (2026-10-20, Creador: "que yo pueda darte una idea, o la meditación escrita completa, y la
// imagen; tú te encargas de la música y el resto"). A written meditation is kept word for word: it is only split
// into breath-sized segments at sentence ends, and the pauses come from its own marks or from the intention.
//   node engine/longform.mjs script <slug> --file meditation.txt     marks: a blank line = a longer pause; [pause 12] = 12 s
//   node engine/longform.mjs image <slug> --file picture.png [--scene A]   the creator's picture becomes the loop's still
function importScript() {
  const file = flag("--file");
  if (!slug || !file || !fs.existsSync(file)) throw new Error("usage: script <slug> --file meditation.txt");
  const sl = P.loadShotlist(slug), L = sl.longform;
  const I = INTENTS[L?.intent];
  if (!I) throw new FlowStop(`pon primero longform.intent (${Object.keys(INTENTS).join(", ")}): las pausas salen de la intención`);
  const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  const mid = Math.round((I.pause[0] + I.pause[1]) / 2);
  const segs = [];
  for (const para of raw.split(/\n\s*\n/)) {
    // sentences, then join short ones up to ~25 words so each segment is one or two breaths
    const parts = para.replace(/\s*\n\s*/g, " ").split(/(\[pause\s+\d+(?:\.\d+)?\s*s?\])/i).filter((x) => x.trim());
    let cur = "";
    const push = (pause) => { if (cur.trim()) segs.push({ text: cur.trim(), pauseAfter: pause }); cur = ""; };
    for (const part of parts) {
      const m = part.match(/^\[pause\s+(\d+(?:\.\d+)?)/i);
      if (m) { if (cur.trim()) push(Number(m[1])); else if (segs.length) segs.at(-1).pauseAfter = Number(m[1]); continue; }
      for (const s of part.match(/[^.!?…]+(?:[.!?…]+|$)/g) || []) {
        if ((cur + " " + s).trim().split(/\s+/).length > 25 && cur.trim()) push(I.pause[0]);
        cur += " " + s.trim();
      }
    }
    push(mid);
  }
  if (segs.length) segs.at(-1).pauseAfter = Math.max(segs.at(-1).pauseAfter, 4);
  const norm = (t) => t.replace(/\[pause[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
  if (norm(segs.map((s) => s.text).join(" ")) !== norm(raw)) throw new Error("the split changed the creator's words; nothing written");
  P.updateShotlist(slug, (x) => { x.longform.script = segs; x.longform.scriptBy = "creator"; x.longform.scriptSource = norm(raw); });
  const words = segs.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  console.log(`${segs.length} segments, ${words} words, kept word for word (scriptBy: creator). Pauses from ${path.basename(file)} or ${I.label} (${I.pause[0]}-${I.pause[1]} s).`);
}

function importImage() {
  const file = flag("--file"), id = flag("--scene", "A");
  if (!slug || !file || !fs.existsSync(file)) throw new Error("usage: image <slug> --file picture.png [--scene A]");
  const sl = P.loadShotlist(slug);
  const sc = (sl.longform?.scenes || []).find((s) => s.id === id);
  if (!sc) throw new Error(`no scene ${id} in longform.scenes`);
  const dst = P.abs(slug, `loops/${id}-creator${path.extname(file).toLowerCase() || ".png"}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(file, dst);
  P.updateShotlist(slug, (x) => { const s = x.longform.scenes.find((y) => y.id === id); s.image = P.rel(slug, dst); s.imageBy = "creator"; });
  console.log(`scene ${id}: the creator's image is the loop's still (${P.rel(slug, dst)}); write its motion and premiseLink, then gen.mjs loops animates it`);
}

const commands = { new: create, estimate, build, script: importScript, image: importImage };
try {
  if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
  commands[cmd]();
} catch (e) { console.error(e instanceof FlowStop ? `ALTO: ${e.message}` : `ERROR: ${e.message}`); process.exit(1); }
