#!/usr/bin/env node
// Pipeline v4, step 6: the auto edit. Conforms the filmed scenes to the radio cut's rhythm:
// joins the approved takes, transcribes and aligns every script line, cuts any silence longer than the plan,
// lays the laughs on the exact end of their lines (the next line steps on the tail), captions, freeze frame +
// outro, style finish, loudness. Then the pacing QC from the vertical DNA runs on the real cut.
//
//   node engine/edit.mjs <slug> [--draft]   -> out/<slug>.mp4 (+ sl.finalQc with pacing); --draft -> out/<slug>-DRAFT.mp4, never deliverable
import { isNoise } from "./lib/noise.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import { LAUGHS, STINGS, libSound } from "./lib/laughs.mjs";
import { introVariant } from "./lib/intro.mjs";
import { cueFile } from "./lib/cues.mjs";
import { recordSpeechRate } from "./lib/pricing.mjs";
import * as eleven from "./lib/eleven.mjs";
import { voiceProfile } from "./lib/voices.mjs";
import { requireStep, FlowStop, fileSha, takesSig } from "./lib/flow.mjs";
process.on("uncaughtException", (e) => { console.error(e instanceof FlowStop ? `ALTO: ${e.message}` : e); process.exit(e instanceof FlowStop ? 2 : 1); });

const argv = process.argv.slice(2);
const slug = argv[0];
const draft = argv.includes("--draft");
if (!slug) { console.error("usage: edit.mjs <slug> [--draft]"); process.exit(1); }
const dir = P.projectDir(slug);
const sl = P.loadShotlist(slug);
// Flow v5: the final cut needs every take approved by its evals; a draft only needs the book approved.
requireStep(sl, draft ? "film" : "edit", draft ? "edit --draft" : "edit");
// --draft cuts only the scenes filmed so far: the pilot preview, with its score and stings, for the creator to judge
// before the rest is filmed (pilot gate). A partial draft never writes the shotlist.
// A scene counts as filmed only with a take on the project's current video model (after a model switch, the old
// model's takes of the other scenes are not part of the new pilot).
const current = (sc) => (sc.clips || []).some((c) => !sl.defaults?.videoModel || c.model === sl.defaults.videoModel);
const partial = draft && (sl.scenes || []).some((sc) => !current(sc));
if (partial) { sl.scenes = sl.scenes.filter(current); for (const sc of sl.scenes) sc.clips = sc.clips.filter((c) => !sl.defaults?.videoModel || c.model === sl.defaults.videoModel); const keep = new Set(sl.scenes.flatMap((sc) => sc.shots)); sl.shots = sl.shots.filter((s) => keep.has(s.id)); }
const W = sl.ar === "16:9" ? 1280 : 720, H = sl.ar === "16:9" ? 720 : 1280;
const tmp = path.join(dir, "out", "_edit");
fs.mkdirSync(tmp, { recursive: true });
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const pace = { gap: 0.25, ...(sl.pace || {}) };

// 1. Join the approved take of every scene (or the latest take with --draft).
const parts = [];
for (const sc of sl.scenes) {
  let ci = sc.clip;
  if (ci == null && draft && sc.clips?.length) ci = sc.clips.length - 1;
  if (ci == null) { console.error(`stop: scene ${sc.id} has no approved take (qc.mjs scenes, or --draft)`); process.exit(1); }
  // A take is usable when it passed its evals (qc.mjs score or continuity.mjs) or the creator accepted it in his words
  // (studio.mjs accept-take): the same rule as the flow's film step.
  const tk = sc.clips[ci];
  if (!draft && !(tk.qc?.pass || tk.continuity?.pass || tk.accepted?.said)) { console.error(`stop: scene ${sc.id} take ${ci + 1} hasn't passed QC (or been accepted by the creator)`); process.exit(1); }
  // Continuity eval is a hard gate: no take with a character in the wrong place gets cut in, unless the creator
  // accepted that exact take in his words (studio.mjs accept-take, printed in the book).
  if (!draft && !sc.clips[ci].continuity?.pass && !tk.accepted?.said) { console.error(`stop: scene ${sc.id} take ${ci + 1} ${sc.clips[ci].continuity ? "failed" : "has no"} continuity eval (node engine/continuity.mjs ${slug} --scene ${sc.id})`); process.exit(1); }
  const part = path.join(tmp, `${sc.id}.mp4`);
  // sc.cutOut = [[a, b], ...]: seconds of this take to drop (words the model improvised, a shot it invented), picture
  // and sound together, before alignment (2026-10-19, a past drama: an extra "And I'm ready?" and a repeated line).
  // sc.muteOut = [[a, b], ...]: silence the sound only, keeping the picture (a repeated line over a beat worth keeping).
  const tf = P.takeFilters(sc);
  ff(["-i", sc.clips[ci].file, "-vf", `${tf.vf}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,setsar=1,format=yuv420p`,
    "-af", `${tf.af}aresample=48000,aformat=channel_layouts=stereo`, "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "pcm_s16le", path.relative(dir, part).replace(/\.mp4$/, ".mov")]);
  parts.push(part.replace(/\.mp4$/, ".mov"));
}
// Cross-scene consistency: every approved take must be filmed against the same set plate (a past episode mixed two
// plates -> different angles and couch looks between scenes). Unknown (older) takes count as the first plate seen.
// Checked per set: a scene that deliberately uses another set (e.g. the same room by day) has its own plate.
{
  const used = sl.scenes.map((sc) => sc.clips?.[sc.clip ?? sc.clips.length - 1]?.plate || "?");
  const bySet = {};
  sl.scenes.forEach((sc, i) => { if (used[i] !== "?") (bySet[sc.set || sl.set] ||= new Set()).add(used[i]); });
  const mixed = Object.entries(bySet).filter(([, s]) => s.size > 1).map(([k]) => k);
  if (mixed.length) { console.error(`stop: takes of set ${mixed.join(", ")} were filmed against different plates (${sl.scenes.map((sc, i) => sc.id + "=" + used[i]).join(", ")}); refilm the odd ones out`); process.exit(1); }
}
fs.writeFileSync(path.join(tmp, "list.txt"), parts.map((p) => `file '${path.basename(p)}'`).join("\n"));
const cut = path.join(tmp, "cut.mov");
ff(["-f", "concat", "-safe", "0", "-i", path.relative(dir, path.join(tmp, "list.txt")), "-c", "copy", path.relative(dir, cut)]);
const cutLen = dur(cut);

// 2. Transcribe and align every script line.
const lines = sl.shots.flatMap((s) => (s.dialogue || []).map((l, i) => ({ id: `${s.id}-${i + 1}`, text: l.text, l, shot: s })));
fs.writeFileSync(path.join(tmp, "lines.json"), JSON.stringify(lines.map(({ id, text }) => ({ id, text }))));
const al = spawnSync("python", [path.join(ROOT, "engine", "lib", "align.py"), cut, path.join(tmp, "lines.json"), path.join(tmp, "align.json"), sl.lang === "es" ? "es" : "en"], { encoding: "utf8" });
if (al.status !== 0) { console.error(al.stderr.split("\n").filter((x) => !/warn|symlink|developer/i.test(x)).join("\n")); process.exit(1); }
const align = JSON.parse(fs.readFileSync(path.join(tmp, "align.json"), "utf8"));
lines.forEach((x, k) => Object.assign(x, align.lines[k]));
const found = lines.filter((x) => x.start != null);
// Vocalizations (an evil laugh, a howl) aren't words: never required in the transcript, but their time is kept.
const isVocal = (l) => l.vocal || /^(mwa|ha|awoo|woof|meow|grr|hm+|ah+|oh+)[-a-z! ]*$/i.test(l.text.trim());
const missing = lines.filter((x) => !isVocal(x.l) && (x.start == null || x.found < 0.6)).map((x) => `${x.id} "${x.text}"`);

// 3. Decide what to keep. Whisper's word starts swallow the silence before them, so every line is snapped to
//    the real audio (silencedetect), and pauses inside a line longer than 0.5 s are cut down too.
const sd = spawnSync("ffmpeg", ["-hide_banner", "-i", cut, "-af", "silencedetect=n=-38dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const silences = [];
for (const m of sd.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) silences.push([Number(m[1]), Number(m[2])]);
const inSilence = (t) => silences.find(([a, b]) => t >= a - 0.01 && t < b);
for (const x of found) {
  const s0 = inSilence(x.start); if (s0 && s0[1] < x.end) x.start = s0[1] - 0.04;
  const s1 = inSilence(x.end - 0.01); if (s1 && s1[0] > x.start) x.end = s1[0] + 0.06;
}
// Speech pieces: each line minus its long internal pauses; the gap after a piece is internal (0.3 s) or planned.
const pieces = [];
for (const [k, x] of found.entries()) {
  // Pauses inside a line are tightened only in the sitcom; a drama keeps the actor's breath (2026-10-19, The Secret
  // a past drama: the tight cut ran 200 wpm).
  const inner = sl.format !== "sitcom" ? [] : silences.filter(([a, b]) => a > x.start + 0.05 && b < x.end - 0.05 && b - a > 0.5);
  let a = x.start;
  for (const [s, e] of inner) { pieces.push({ a, b: s + 0.05, after: 0.3, x }); a = e - 0.05; }
  const next = found[k + 1];
  const between = lines.slice(lines.indexOf(x) + 1, next ? lines.indexOf(next) : lines.length).filter((y) => isVocal(y.l));
  // Shots between two lines that have no dialogue (an exit, a walk, a reaction) are action, never dead air:
  // their full planned length is kept (a past episode: an exit was trimmed into a glitch).
  const silentShots = next ? sl.shots.slice(sl.shots.indexOf(x.shot) + 1, sl.shots.indexOf(next.shot)).filter((s) => !(s.dialogue || []).length) : [];
  const silentTime = silentShots.reduce((n, s) => n + (s.duration || 1.5), 0);
  let planned = silentTime + between.length * 1.8 + (x.l.laugh ? (LAUGHS[x.l.laugh] || LAUGHS.laugh).react + (LAUGHS[x.l.laugh] || LAUGHS.laugh).stepIn : pace.gap) + (next?.l.beat || 0);
  // A silence where someone moves on screen (a leap, an exit) is action, not dead air: keep up to 2.5 s of it
  // after the last line of a shot with `moves`.
  // Outside the sitcom the filmed pause between two lines is the drama's tension: keep it up to 1.6 s, trim only
  // longer dead air (2026-10-19, a past drama: the tight cut removed 5 s and ran 219 wpm).
  if (sl.format !== "sitcom" && next) planned = Math.max(planned, Math.min(next.start - x.end, 1.6));
  const lastInShot = !next || next.shot !== x.shot;
  if (x.shot.moves && lastInShot && next) planned = Math.max(planned, Math.min(next.start - x.end, 2.5));
  pieces.push({ a, b: x.end, after: next ? planned : null, x });
}
const keep = [];
const lead = 0.1;
if (pieces.length) keep.push([Math.max(0, pieces[0].a - lead), pieces[0].a]);
for (const [k, p] of pieces.entries()) {
  const next = pieces[k + 1];
  if (!next) {
    // After the last line: room for the button laugh / reaction shot, never more than what was filmed.
    // sl.ending "smash" (the writing bible): cut to black right on the last hard consonant so the short loops.
    // Silent shots after the last line (a held reaction, the shocked face the episode ends on) keep their planned
    // length: they were cut to 1.2 s and the pilot lost a character's reaction (2026-10-19).
    const after = sl.shots.slice(sl.shots.indexOf(p.x.shot) + 1).filter((s) => !(s.dialogue || []).length).reduce((n, s) => n + (s.duration || 1.5), 0);
    // With silent shots after the last line, everything filmed up to the end is kept (a take can hold the speaker
    // before cutting to the reaction), at most the planned silence + 3 s.
    const tail = sl.ending === "smash" ? 0.16 : after ? Math.min(cutLen - p.b, after + 3) : Math.min(cutLen - p.b, p.x.l.laugh ? 1.8 : 1.2);
    keep.push([p.a, p.b + Math.max(0, tail)]);
    break;
  }
  const gap = next.a - p.b;
  if (gap <= p.after + 0.1) { keep.push([p.a, next.a]); continue; }
  // Too long: keep half the planned gap after this piece and half before the next; the silence between goes.
  const half = p.after / 2;
  keep.push([p.a, p.b + half], [next.a - half, next.a]);
}
if (process.env.EDIT_DEBUG) { console.log(JSON.stringify(pieces.map((p) => [p.x.id, +p.a.toFixed(2), +p.b.toFixed(2), p.after]))); console.log(JSON.stringify(keep.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]))); }
// Merge touching pieces.
const segs = [];
for (const [a, b] of keep) { if (b - a < 0.02) continue; const last = segs.at(-1); if (last && a - last[1] < 0.02) last[1] = Math.max(last[1], b); else segs.push([a, b]); }
const map = (t) => { let acc = 0; for (const [a, b] of segs) { if (t <= a) return acc; if (t <= b) return acc + (t - a); acc += b - a; } return acc; };
const tightLen = segs.reduce((n, [a, b]) => n + b - a, 0);

// 4. Render the tight cut (picture + native dialogue), with 8 ms fades at every join so cuts don't click.
const fg = segs.map(([a, b], k) => `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS[v${k}];[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st=${Math.max(0, b - a - 0.008).toFixed(3)}:d=0.008[a${k}]`);
fg.push(`${segs.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${segs.length}:v=1:a=1[v][a]`);
const tight = path.join(tmp, "tight.mov");
ff(["-i", path.relative(dir, cut), "-filter_complex", fg.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "pcm_s16le", path.relative(dir, tight)]);

// 4b. One voice per character (a past episode: every take re-invented the voices). Each spoken line in the tight cut is
//     re-voiced with ElevenLabs speech-to-speech in the character's official voice: same timing, so lip sync holds.
//     The original line audio is muted under it; room sound, laughs and cues are untouched. Off: sl.voiceUnify = false.
let voiced = tight;
// Outside the sitcom the take's own voice is kept by default (it is the one in sync with the lips; a re-voice
// drifted 1 s, a past drama): sl.voiceUnify = true opts in, and the lip-sync check below still guards it.
if (sl.voiceUnify === true || (sl.voiceUnify !== false && sl.format === "sitcom")) {
  const vdir = path.join(tmp, "voices");
  fs.mkdirSync(vdir, { recursive: true });
  const mapT = (t) => { let acc = 0; for (const [a, b] of segs) { if (t <= a) return acc; if (t <= b) return acc + (t - a); acc += b - a; } return acc; };
  const parts = [];
  const spoken = found.filter((x) => P.character(x.l.char).voice?.eleven);
  // One pitch per character: each take gives a character a different pitch and speech-to-speech keeps it
  // (in one pilot a voice ranged 152-234 Hz). Target = median pitch of the character's radio-cut (TTS) lines.
  const pitchOf = (files) => files.length ? JSON.parse(spawnSync("python", [path.join(ROOT, "engine", "lib", "pitch.py"), ...files], { encoding: "utf8" }).stdout || "{}") : {};
  const target = {};
  for (const ch of new Set(spoken.map((x) => x.l.char))) {
    const files = sl.shots.flatMap((s) => (s.dialogue || []).map((l, i) => ({ l, f: path.join(dir, "audio", "radio", `${s.id}-${i + 1}.mp3`) }))).filter((o) => o.l.char === ch && fs.existsSync(o.f)).map((o) => o.f);
    const hz = Object.values(pitchOf(files)).filter((v) => v > 0).sort((a, b) => a - b);
    target[ch] = voiceProfile(sl, ch).pitchHz || (hz.length ? hz[Math.floor(hz.length / 2)] : 0);
  }
  for (const x of spoken) {
    const a = Math.max(0, mapT(x.start) - 0.06), b = mapT(x.end) + 0.12;
    const src = path.join(vdir, `${x.id}.wav`);
    ff(["-ss", a.toFixed(3), "-t", (b - a).toFixed(3), "-i", path.relative(dir, tight), "-vn", "-ac", "1", "-ar", "44100", path.relative(dir, src)]);
    // The re-voiced file is cached by the content of the line it was made from: a new take (or a new cut) gets a
    // fresh re-voice. Keyed by line id alone, a re-run reused voices made from the old takes, out of sync with the
    // new picture, and the ducked original under them sounded like an echo (a past episode v2).
    const srcHash = createHash("sha1").update(fs.readFileSync(src)).digest("hex").slice(0, 10);
    const dst = path.join(vdir, `${x.id}-${x.l.char}-${srcHash}.mp3`);
    try {
      // Per-line override (whispers convert badly): sl.voiceOverride = { "s07-1": "radio" } uses the clean radio-cut
      // TTS line, fitted to the line's on-screen duration.
      if (sl.voiceOverride?.[x.id] === "radio" || /whisper/i.test(x.l.delivery || "")) {
        const rf = path.join(dir, "audio", "radio", `${x.id}.mp3`);
        const rd = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", rf]).toString());
        const want = Math.max(0.3, mapT(x.end) - mapT(x.start));
        const tempo = Math.max(0.6, Math.min(1.6, rd / want));
        ff(["-i", rf, "-af", `atempo=${tempo.toFixed(4)}`, "-ac", "1", "-ar", "44100", path.relative(dir, dst)]);
        parts.push({ a: Math.max(0, mapT(x.start)), b, file: dst, gain: 0, from: a });
        continue;
      }
      // Shift the line to the character's target pitch first (duration kept: asetrate + atempo), then re-voice.
      const hz = Object.values(pitchOf([src]))[0] || 0;
      const r = target[x.l.char] && hz ? Math.max(0.7, Math.min(1.45, target[x.l.char] / hz)) : 1;
      const norm = src.replace(/\.wav$/, "-pitch.wav");
      ff(["-i", path.relative(dir, src), "-af", Math.abs(r - 1) > 0.04 ? `asetrate=${Math.round(44100 * r)},aresample=44100,atempo=${(1 / r).toFixed(4)}` : "anull", path.relative(dir, norm)]);
      const vp = voiceProfile(sl, x.l.char);
      if (!fs.existsSync(dst)) await eleven.sts({ file: norm, voice: vp.eleven, settings: vp.sts, seed: vp.seed, out: dst });
      // Match the re-voiced line to the original line's loudness (they differed by up to 3.6 dB).
      const mv = (f) => Number((spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/mean_volume: (-?[\d.]+)/) || [0, -20])[1]);
      // Lip sync: line up the first sound of the new voice with the first sound of the original line.
      const onset = (f) => { const m = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "silencedetect=n=-35dB:d=0.02", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/silence_start: 0[\s\S]*?silence_end: ([\d.]+)/); return m ? Number(m[1]) : 0; };
      const shift = onset(src) - onset(dst);
      parts.push({ a: Math.max(0, a + shift), b, file: dst, gain: Math.max(-6, Math.min(6, mv(src) - mv(dst))), from: a });
    }
    catch (e) { console.error(`voice unify skipped for ${x.id}: ${e.message}`); }
  }
  if (parts.length) {
    const mute = parts.map((q) => `between(t,${q.a.toFixed(3)},${q.b.toFixed(3)})`).join("+");
    const ins = parts.flatMap((q) => ["-i", path.relative(dir, q.file)]);
    // The original is ducked (not muted) with soft ramps so the room tone never drops out; the new voice gets
    // 30 ms fades, the original line's loudness and a touch of the room's early reflections so it sits in the set.
    // The original line is fully muted under its re-voice (ramped over 50 ms). A ducked-but-audible original sat
    // ~30 dB under the new voice and the final loudness pass lifted it into a low echo (a past episode v2.1).
    const ramp = (q) => `max(0,1-min(1,max(0,min(t-${(Math.min(q.a, q.from) - 0.05).toFixed(3)},${(q.b + 0.05).toFixed(3)}-t)/0.05)))`;
    const duck = parts.map(ramp).reduce((acc, e) => acc ? `min(${acc},${e})` : e, "");
    const g = [`[0:a]volume='${duck}':eval=frame[base]`,
      ...parts.map((q, k) => `[${k + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${q.gain.toFixed(1)}dB,highpass=f=90,lowpass=f=9500,afade=t=in:d=0.03,areverse,afade=t=in:d=0.04,areverse,adelay=${Math.round(q.a * 1000)}|${Math.round(q.a * 1000)}[v${k}]`),
      `[base]${parts.map((_, k) => `[v${k}]`).join("")}amix=inputs=${parts.length + 1}:duration=first:normalize=0[a]`];
    voiced = path.join(tmp, "tight-voiced.mov");
    ff(["-i", path.relative(dir, tight), ...ins, "-filter_complex", g.join(";"), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "pcm_s16le", path.relative(dir, voiced)]);
    console.log(`voices unified: ${parts.length}/${spoken.length} lines`);
    // LIP-SYNC CHECK (2026-10-19, a past drama pilot: re-voiced lines landed up to 1.0 s after the lips moved). The
    // original and the re-voiced tracks are both transcribed; if any word starts more than 0.2 s apart, the re-voice
    // is dropped and the take's own voices are kept: a voice that doesn't match the mouth is worse than another timbre.
    const words = (f) => { const o = path.join(tmp, `sync-${path.basename(f)}.json`); const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "align.py"), f, path.join(tmp, "lines.json"), o, sl.lang === "es" ? "es" : "en"], { encoding: "utf8" }); return r.status === 0 ? JSON.parse(fs.readFileSync(o, "utf8")).words : null; };
    const wa = words(tight), wb = words(voiced);
    if (wa && wb) {
      const norm = (w) => w.w.toLowerCase().replace(/[^a-z0-9']/g, "");
      let drift = 0, j = 0;
      // A word missing from one track is skipped without consuming the rest (an unmatched "and" once hid a 1 s drift).
      for (const w of wa) { const k = wb.findIndex((x, i) => i >= j && norm(x) === norm(w)); if (k >= 0) { drift = Math.max(drift, Math.abs(wb[k].start - w.start)); j = k + 1; } }
      if (drift > 0.2) { console.log(`LIP-SYNC: re-voiced words drift up to ${drift.toFixed(2)} s from the lips; keeping the take's own voices`); voiced = tight; }
      else console.log(`lip-sync: re-voiced words within ${drift.toFixed(2)} s of the lips`);
    }
  }
}

// 5. Laughs on the end of their lines, outro on the freeze, captions from the real line timings.
const timed = found.map((x) => ({ ...x, a: map(x.start), b: map(x.end) }));
const laughs = timed.filter((x) => x.l.laugh).map((x) => ({ kind: x.l.laugh, ...(LAUGHS[x.l.laugh] || LAUGHS.laugh), at: x.b + (LAUGHS[x.l.laugh] || LAUGHS.laugh).react }));
// A laugh on a vocalization (after the howl) lands after the vocal block that follows the previous spoken line.
for (const [i, y] of lines.entries()) if (isVocal(y.l) && y.l.laugh) { const prev = [...timed].reverse().find((x) => lines.indexOf(lines.find((z) => z.id === x.id)) < i); if (prev) { const n = lines.slice(lines.indexOf(lines.find((z) => z.id === prev.id)) + 1, i + 1).length; laughs.push({ kind: y.l.laugh, ...(LAUGHS[y.l.laugh] || LAUGHS.laugh), at: prev.b + n * 1.8 }); } }
laughs.sort((a, b) => a.at - b.at);
const outroName = sl.ending === "smash" ? null : sl.tag?.sound;
const outro = outroName && STINGS[outroName];
const freeze = sl.ending === "smash" ? 0 : Math.max(sl.freezeEnd || 0, outro ? outro.len - 0.4 : 0);
const total = tightLen + freeze;
const ts = (x) => `0:${String(Math.floor(x / 60)).padStart(2, "0")}:${(x % 60).toFixed(2).padStart(5, "0")}`;
const cap = sl.captions || {};
fs.writeFileSync(path.join(tmp, "captions.ass"), `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Line,${cap.font || "Arial"},${cap.size || Math.round(W * 0.05)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,${Math.round(W * 0.006)},0,2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${Math.round(H * (cap.marginV ?? 0.16))},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
  captionEvents().map((e) => `Dialogue: 0,${ts(e.a)},${ts(e.b)},Line,,0,0,0,,${e.text}`).join("\n") + "\n");
// Captions are timed on the EDITED dialogue track itself: it is transcribed again (VAD on) and every caption and
// chunk break uses its word times, in the timeline the viewer sees. Timing from the raw cut, mapped through the
// trims, ran captions 0.5-2.4 s off (2026-10-19, a past drama). A line the final pass can't find keeps the cut's time.
function finalWords() {
  const out = path.join(tmp, "align-final.json");
  const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "align.py"), voiced, path.join(tmp, "lines.json"), out, sl.lang === "es" ? "es" : "en"], { encoding: "utf8" });
  return r.status === 0 ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
}
// A line stays from its first word until just after its last, never over the next line; lines longer than 6 words
// split into chunks at punctuation, each chunk starting on its own first word.
// Each line's span in the final timeline. A line the final pass can't match (misheard: "Go on, a character" -> "Don't worry,
// Natty") starts on the first word heard after the previous line, and keeps its cut length. Memoized (var: hoisted).
var SPANS, FIN;
function lineSpans() {
  if (SPANS) return SPANS;
  FIN = finalWords();
  SPANS = [];
  timed.forEach((x) => {
    const f = FIN?.lines?.find((l) => l.id === x.id);
    if (f && f.found >= 0.6 && f.start != null) return SPANS.push({ a: f.start, b: f.end });
    const prevB = SPANS.at(-1)?.b ?? 0, next = (FIN?.words || []).find((w) => w.start > prevB + 0.1);
    SPANS.push(next ? { a: next.start, b: next.start + (x.b - x.a) } : { a: x.a, b: x.b });
  });
  return SPANS;
}
function captionEvents() {
  const spans = lineSpans(), fin = FIN;
  const ev = [];
  timed.forEach((x, k) => {
    const { a: la, b: lb } = spans[k];
    const nextA = spans[k + 1]?.a ?? total;
    const stop = Math.min(nextA - 0.03, lb + 0.35);
    const tokens = x.text.split(/\s+/);
    const ws = (fin?.words || []).filter((w) => w.start >= la - 0.05 && w.end <= lb + 0.05);
    if (tokens.length <= 6 || ws.length < tokens.length * 0.7) { ev.push({ a: la, b: stop, text: x.text }); return; }
    const chunks = [];
    let cur = [];
    tokens.forEach((tok, i) => { cur.push(tok); if (cur.length >= 6 || (/[.,:;!?]$/.test(tok) && cur.length >= 2) || i === tokens.length - 1) { chunks.push(cur); cur = []; } });
    let wi = 0;
    chunks.forEach((c, ci) => {
      const a = ci === 0 ? la : ws[Math.min(wi, ws.length - 1)].start - 0.03;
      wi += c.length;
      const b = ci === chunks.length - 1 ? stop : Math.max(a + 0.4, ws[Math.min(wi, ws.length - 1)].start - 0.05);
      ev.push({ a, b, text: c.join(" ") });
    });
  });
  return ev;
}

const st = P.style(sl.style);
const FINISH = {
  broadcast: `scale=${W / 2}:${H / 2}:flags=area,gblur=sigma=0.6,chromashift=cbh=1:crh=0,eq=contrast=0.93:saturation=0.86:gamma=1.03,curves=all='0/0.05 0.5/0.52 1/0.97',colorbalance=rh=0.03:bh=-0.03:rs=0.01,split[g0][g1];[g1]gblur=sigma=14[g2];[g0][g2]blend=all_mode=screen:all_opacity=0.10,noise=alls=7:allf=t,scale=${W}:${H}:flags=bicubic,unsharp=5:5:0.25,crop=iw-32:ih-24:16:12,scale=${W}:${H}:flags=bicubic`,
  film: "eq=contrast=0.97:saturation=0.92,curves=all='0/0.02 0.85/0.83 1/0.96',noise=alls=4:allf=t,unsharp=3:3:0.2",
  phone: "eq=contrast=1.04:saturation=1.05,unsharp=5:5:0.5,noise=alls=5:allf=t",
  // natural: lifts the shadows and neutralizes the orange candle cast, toward daylight-balanced realism (2026-10-19).
  natural: "curves=all='0/0.05 0.35/0.42 0.7/0.76 1/1',colorbalance=rs=-0.06:gs=-0.01:bs=0.05:rm=-0.05:gm=0:bm=0.04:rh=-0.02:bh=0.02,eq=saturation=0.9:contrast=0.97,unsharp=3:3:0.25",
};
const finish = FINISH[sl.finish ?? st.finish];
const inputs = ["-i", path.relative(dir, voiced)];
const graph = [`[0:v]tpad=stop_mode=clone:stop_duration=${freeze.toFixed(2)}${finish ? "," + finish : ""},subtitles=out/_edit/captions.ass[v]`, `[0:a]apad=pad_dur=${freeze.toFixed(2)}[c0]`];
const layers = ["[c0]"];
const lay = (file, at, gainDb) => {
  const k = inputs.length / 2;
  inputs.push("-i", file);
  const ms = Math.round(Math.max(0, at) * 1000);
  graph.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gainDb}dB,adelay=${ms}|${ms}[o${k}]`);
  layers.push(`[o${k}]`);
};
for (const L of laughs) lay(await libSound(`laugh-${L.kind}`), L.at, L.gainDb);
// Cues use the same final-timeline line spans as the captions (a hit timed from the raw cut landed 4.5 s early).
// cue.at "end": a sting lands on the punchline, not before the line.
for (const [k, x] of timed.entries()) if (x.l.cue) { const c = await cueFile(dir, sl, x.l.cue); const sp = lineSpans()[k]; lay(c.file, c.at === "end" ? sp.b + 0.05 : sp.a - c.lead, c.gainDb); }
if (outro) lay(await libSound(outroName), tightLen - 0.3, -8);
// 5a. Drama sound design (2026-10-19, a past drama came out "dry, like a rehearsal"): the project's score
// (sl.music, generated with gen.mjs music) runs under the whole episode at sl.music.gainDb, ducks under every line,
// swells over the last sl.music.swell seconds into the freeze and fades out; sl.endCue lands a sting on the freeze.
// Stings on power shifts are line cues (line.cue, lib/cues.mjs, ElevenLabs SFX).
if (sl.music?.files?.length) {
  const mf = P.abs(slug, sl.music.files[sl.music.pick ?? 0]);
  const base = sl.music.gainDb ?? -17, duck = sl.music.duckDb ?? -9, sw = Math.max(0, tightLen - (sl.music.swell ?? 4));
  const under = timed.map((x) => `between(t,${(x.a - 0.15).toFixed(2)},${(x.b + 0.25).toFixed(2)})`).join("+") || "0";
  const k = inputs.length / 2;
  inputs.push("-i", path.relative(dir, mf));
  graph.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume='pow(10,(${base}+if(gt(${under},0),${duck},0)+if(gt(t,${sw.toFixed(2)}),9*min(1,(t-${sw.toFixed(2)})/2.5),0))/20)':eval=frame,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, total - 1.4).toFixed(2)}:d=1.4[o${k}]`);
  layers.push(`[o${k}]`);
}
if (sl.endCue) { const c = await cueFile(dir, sl, sl.endCue); lay(c.file, tightLen - 0.05, c.gainDb); }
// Loudness in two passes: measure, then one linear gain. Single-pass loudnorm is dynamic and lifts quiet layers
// (room tone, reverb tails) under the dialogue.
const mixGraph = graph.slice(1).concat(`${layers.join("")}amix=inputs=${layers.length}:duration=first:normalize=0[mx]`);
const meas = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...inputs, "-filter_complex", mixGraph.join(";") + ";[mx]loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[mo]", "-map", "[mo]", "-t", total.toFixed(2), "-f", "null", "-"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
const lj = JSON.parse((meas.match(/\{[^{}]*"input_i"[^{}]*\}/) || ["{}"])[0]);
const lnorm = lj.input_i ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${lj.input_i}:measured_TP=${lj.input_tp}:measured_LRA=${lj.input_lra}:measured_thresh=${lj.input_thresh}:offset=${lj.target_offset}:linear=true` : "loudnorm=I=-14:TP=-1.5:LRA=11";
graph.push(`${layers.join("")}amix=inputs=${layers.length}:duration=first:normalize=0,${lnorm},alimiter=limit=0.79:level=false,aresample=48000[a]`);
const final = path.join("out", draft ? `${slug}-DRAFT.mp4` : `${slug}.mp4`);
ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]", "-t", total.toFixed(2),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "21", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final]);

// 5b. Series intro: the show's cold-open titles, dissolving into the first scene (the street sound and theme
//     tail fade under the first line). Pacing QC below measures the episode itself, without the intro.
let introLen = 0;
if (sl.series) {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, "series", sl.series, "series.json"), "utf8"));
  const variant = introVariant(sl);
  const intro = path.join(ROOT, "series", sl.series, "intro", variant, "intro.mp4");
  if (fs.existsSync(intro)) {
    const x = S.intro.transition?.seconds ?? 0.4;
    introLen = dur(intro);
    const body = path.join(tmp, "body.mp4");
    fs.renameSync(path.join(dir, final), body);
    // Picture: titles dissolve into scene 1. Sound: street bed + the theme stem (which ducks and fades out
    // over the first seconds of dialogue) laid under the episode's own audio, which starts at the dissolve.
    const iDir = path.join(ROOT, "series", sl.series, "intro", variant);
    const ms = Math.round((introLen - x) * 1000);
    ff(["-i", intro, "-i", path.relative(dir, body), "-i", path.join(iDir, "bed.wav"), "-i", path.join(iDir, "theme-stem.wav"), "-filter_complex",
      `[0:v]settb=AVTB,fps=30,format=yuv420p[i];[1:v]settb=AVTB,fps=30,format=yuv420p[e];[i][e]xfade=transition=${S.intro.transition?.type === "fade" ? "fade" : "dissolve"}:duration=${x}:offset=${(introLen - x).toFixed(2)}[v];` +
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[ep];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[bed];[3:a]aformat=sample_rates=48000:channel_layouts=stereo[mus];` +
      `[ep][bed][mus]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.79:level=false[a]`,
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "21", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final]);
    introLen -= x;
  }
}

// 6. Final QC: loudness, line coverage, and the DNA pacing on the real cut.
const lo = spawnSync("ffmpeg", ["-hide_banner", "-i", path.join(dir, final), "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const loud = Number((lo.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
const peak = Number((lo.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
const nWords = timed.reduce((n, x) => n + x.text.split(/\s+/).length, 0);
const speech = timed.reduce((n, x) => n + (x.b - x.a), 0);
// Delivery speed: the median of each line's own rate (one line holding a pause, or a muted repeat, no longer swings
// the whole episode between 119 and 219 wpm). The sitcom keeps its total-over-speech measure.
const lineRates = timed.filter((x) => x.b - x.a >= 0.6).map((x) => x.text.split(/\s+/).length / ((x.b - x.a) / 60)).sort((p, q) => p - q);
const medianWpm = lineRates.length ? Math.round(lineRates[Math.floor(lineRates.length / 2)]) : 0;
let maxGap = 0, dead = 0, cursor = timed[0]?.a ?? 0;
const busy = [...timed.map((x) => [x.a, x.b]), ...laughs.map((L) => [L.at, L.at + L.len])].sort((p, q) => p[0] - q[0]);
// A planned beat is a writing choice, not dead air; only the unplanned part of a silence counts.
for (const [a, b] of busy) { if (a > cursor) { const g = a - cursor; const endLine = timed.find((x) => Math.abs(x.b - cursor) < 0.05);
  const silentAfter = endLine ? sl.shots.slice(sl.shots.indexOf(endLine.shot) + 1).filter((s, i, arr) => !(s.dialogue || []).length && arr.slice(0, i).every((z) => !(z.dialogue || []).length)).reduce((n, s) => n + (s.duration || 1.5), 0) : 0;
  const action = silentAfter + (endLine?.shot.moves ? 2.5 : 0) + (endLine ? lines.slice(lines.indexOf(lines.find((y) => y.id === endLine.id)) + 1).filter((y, i, arr) => isVocal(y.l) && arr.slice(0, i).every((z) => isVocal(z.l))).length * 1.8 : 0); // on-screen movement, not dead air
  const beat = (timed.find((x) => Math.abs(x.a - a) < 0.05)?.l.beat || 0) + action; if (g - beat >= 0.4) dead += g - beat; maxGap = Math.max(maxGap, g - beat); } cursor = Math.max(cursor, b); }
// Laugh rules are the sitcom's; any other format is held to a natural 130-165 wpm (same split as radio.mjs).
const rules = sl.paceRules || (sl.format === "sitcom"
  ? { minWpm: 140, maxGap: 0.6, maxDeadPct: 8, maxFirstLaugh: 6, maxSecondsPerLaugh: 7.5 }
  : { minWpm: 130, maxWpm: 175, maxGap: 1.7, maxDeadPct: 18 }); // the edit keeps filmed pauses up to 1.6 s outside the sitcom
const pacing = {
  length: Math.round(total * 10) / 10, wpm: sl.format === "sitcom" ? Math.round(nWords / (speech / 60)) : medianWpm, maxUnplannedGap: Math.round(maxGap * 100) / 100,
  deadAirPct: Math.round((dead / tightLen) * 1000) / 10, laughs: laughs.length, firstLaugh: laughs[0] ? Math.round(laughs[0].at * 10) / 10 : null,
  secondsPerLaugh: laughs.length ? Math.round((tightLen / laughs.length) * 10) / 10 : null, trimmed: Math.round((cutLen - tightLen) * 10) / 10,
};
const problems = [];
if (missing.length) problems.push(`lines missing or garbled: ${missing.join("; ")}`);
const noiseW = isNoise;
const reps = (align.repeats || []).filter((w) => !noiseW(w));
if (reps.length) problems.push(`repeated words in the dialogue: ${reps.join(", ")}`);
if (pacing.wpm < rules.minWpm) problems.push(`delivery ${pacing.wpm} wpm < ${rules.minWpm}`);
if (pacing.maxUnplannedGap > rules.maxGap) problems.push(`gap ${pacing.maxUnplannedGap}s > ${rules.maxGap}s`);
if (pacing.deadAirPct > rules.maxDeadPct) problems.push(`dead air ${pacing.deadAirPct}% > ${rules.maxDeadPct}%`);
if (rules.maxFirstLaugh != null && (pacing.firstLaugh == null || pacing.firstLaugh > rules.maxFirstLaugh)) problems.push(`first laugh at ${pacing.firstLaugh}s`);
if (rules.maxWpm && pacing.wpm > rules.maxWpm) problems.push(`delivery ${pacing.wpm} wpm > ${rules.maxWpm}`);
if (loud < -15.5 || loud > -12.5) problems.push(`loudness ${loud} LUFS`);
if (peak > -1) problems.push(`true peak ${peak} dB`);
const fq = { loudness: loud, truePeak: peak, duration: Math.round((total + introLen) * 10) / 10, intro: Math.round(introLen * 10) / 10, pacing, lines: lines.map((x) => ({ id: x.id, found: x.found, start: x.start })), problems, pass: !problems.length, at: new Date().toISOString() };
// Only a real cut counts: it is fingerprinted, so the QC and the delivery receipt can prove it is this file.
if (!draft) { sl.finalQc = fq; sl.cut = { sha: fileSha(path.join(dir, final)), takes: takesSig(sl), at: fq.at }; }
// The model's measured speaking rate feeds the live price analysis, and the draft's QC is what approve-pilot reads,
// so a fast pilot is stopped before the rest is filmed (2026-10-20, a past drama: 204 wpm seen only after all scenes).
if (sl.format !== "sitcom" && pacing.wpm) recordSpeechRate(sl.defaults?.videoModel, pacing.wpm, slug);
if (draft) fs.writeFileSync(path.join(dir, "out", "draft-qc.json"), JSON.stringify({ model: sl.defaults?.videoModel || null, wpm: pacing.wpm, maxWpm: rules.maxWpm || null, problems, at: fq.at }, null, 2));
if (!partial) P.saveShotlist(slug, sl);
const size = fs.statSync(path.join(dir, final)).size;
console.log(path.join(dir, final));
console.log(`${(size / 1e6).toFixed(1)} MB · ${pacing.length}s (trimmed ${pacing.trimmed}s of air) · ${pacing.wpm} wpm · ${laughs.length} laughs · first at ${pacing.firstLaugh}s · ${loud} LUFS · peak ${peak} dB`);
console.log(problems.length ? `FINAL QC FAIL: ${problems.join(" | ")}` : "final QC: pass");
