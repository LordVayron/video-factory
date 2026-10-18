#!/usr/bin/env node
// Pipeline v4, step 2: the table read / radio cut. Audio first: voices (direct ElevenLabs, free), laughs and
// stings cut at the vertical's pace. The radio cut decides every shot's duration before any picture exists,
// and the pacing QC runs on it.
//
//   node engine/radio.mjs <slug>      -> audio/radio-cut.mp3, shot durations + line timings in shotlist.json
//
// Shotlist line fields: { char, text, delivery, beat: 0.8 (planned pause before the line), laugh: "chuckle"|"laugh"|"big" }
// Shot without dialogue: { duration: 1.5 } (a reaction). Project pace: sl.pace = { gap, tempo, tail }.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as P from "./lib/project.mjs";
import * as eleven from "./lib/eleven.mjs";
import { LAUGHS, STINGS, libSound } from "./lib/laughs.mjs";
import { planCheck } from "./lib/state.mjs";
import { cueFile } from "./lib/cues.mjs";
import { voiceProfile } from "./lib/voices.mjs";
import { requireStep, FlowStop } from "./lib/flow.mjs";
process.on("uncaughtException", (e) => { console.error(e instanceof FlowStop ? `ALTO: ${e.message}` : e); process.exit(e instanceof FlowStop ? 2 : 1); });

const slug = process.argv[2];
if (!slug) { console.error("usage: radio.mjs <slug>"); process.exit(1); }
const dir = P.projectDir(slug);
const sl = P.loadShotlist(slug);
requireStep(sl, "radio", "radio");
const pace = { gap: 0.25, tempo: 1.0, lead: 0.12, tail: 0.6, ...(sl.pace || {}) };
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// 1. Voices, cached by text + delivery.
fs.mkdirSync(path.join(dir, "audio", "radio"), { recursive: true });
const lines = [];
for (const s of sl.shots) {
  for (const [i, l] of (s.dialogue || []).entries()) {
    const c = P.character(l.char);
    if (!c.voice?.eleven) throw new Error(`${c.name} has no voice.eleven`);
    const f = path.join(dir, "audio", "radio", `${s.id}-${i + 1}.mp3`);
    const key = `${l.delivery || ""}|${l.text}`;
    // The raw voice is cached by text + delivery (ElevenLabs call); the cleanup and tempo rerun every time.
    const raw = f + ".raw.mp3", cached = fs.existsSync(raw + ".txt") ? fs.readFileSync(raw + ".txt", "utf8") : null;
    if (!fs.existsSync(raw) || cached !== key) {
      // eleven_v3 reads a leading [tag] as performance direction, not as words.
      const vp = voiceProfile(sl, l.char); // the series voice profile: same voice, settings and seed every episode
      await eleven.tts({ text: l.delivery ? `[${l.delivery}] ${l.text}` : l.text, voice: vp.eleven, model: vp.ttsModel, settings: vp.tts, seed: vp.seed, out: raw });
      fs.writeFileSync(raw + ".txt", key);
    }
    // Leading/trailing air off, any pause inside the line capped at ~0.2 s (v3 likes long dramatic pauses), then tempo.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af",
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse," +
      "silenceremove=stop_periods=-1:stop_duration=0.25:stop_threshold=-42dB:stop_silence=0.18" +
      (pace.tempo !== 1 ? `,atempo=${pace.tempo}` : ""), f]);
    lines.push({ shot: s, i, l, file: f, len: dur(f) });
  }
}

// 2. Timeline. Lines follow each other with a short gap; a laugh starts on the last word and the next line
//    steps in while it decays; a planned beat is the only long pause.
let t = pace.lead;
const laughs = [];
const shotStart = {};
let prevShot = null;
for (const x of lines) {
  if (x.shot !== prevShot) {
    // Shots without dialogue between the previous line's shot and this one get their own reaction time.
    const idx = sl.shots.indexOf(x.shot), prevIdx = prevShot ? sl.shots.indexOf(prevShot) : -1;
    for (const s of sl.shots.slice(prevIdx + 1, idx)) { shotStart[s.id] = t; t += s.duration || 1.2; }
    shotStart[x.shot.id] = Math.max(0, t - pace.lead);
    prevShot = x.shot;
  }
  t += x.l.beat || 0;
  x.at = t;
  t += x.len;
  if (x.l.laugh) {
    const L = LAUGHS[x.l.laugh] || LAUGHS.laugh;
    const at = t + L.react; // the audience reacts just after the punchword
    laughs.push({ kind: x.l.laugh, at, len: L.len, gainDb: L.gainDb, shot: x.shot.id });
    t = at + L.stepIn;
  } else t += pace.gap;
}
// Trailing shots with no dialogue (the button reaction).
const lastIdx = sl.shots.indexOf(prevShot);
for (const s of sl.shots.slice(lastIdx + 1)) { shotStart[s.id] = t; t += s.duration || 1.5; }
const lastLaugh = laughs.at(-1);
const total = Math.max(t, lastLaugh ? lastLaugh.at + lastLaugh.len : 0);

// 3. Shot durations from the timeline (what the video model is asked for), line timings relative to the shot.
const order = sl.shots.map((s) => s.id);
for (const [k, s] of sl.shots.entries()) {
  const start = shotStart[s.id];
  const end = k < order.length - 1 ? shotStart[order[k + 1]] : total;
  s.duration = Math.round((end - start) * 10) / 10;
  s.radio = { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}
for (const x of lines) x.l.at = Math.round((x.at - shotStart[x.shot.id]) * 100) / 100;

// 4. Mix the radio cut.
const inputs = [], graph = [];
const lay = (file, at, gainDb = 0) => {
  const k = inputs.length / 2;
  inputs.push("-i", file);
  const ms = Math.max(0, Math.round(at * 1000));
  graph.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gainDb}dB,adelay=${ms}|${ms}[x${k}]`);
};
for (const x of lines) lay(x.file, x.at, 0);
for (const L of laughs) lay(await libSound(`laugh-${L.kind}`), L.at, L.gainDb);
for (const x of lines) if (x.l.cue) { const c = await cueFile(dir, sl, x.l.cue); lay(c.file, x.at - c.lead, c.gainDb); }
const tagSound = sl.tag?.sound;
if (tagSound && STINGS[tagSound]) lay(await libSound(tagSound), total - 0.2, -8);
const end = total + (tagSound ? STINGS[tagSound].len : 0);
const n = inputs.length / 2;
graph.push(`${Array.from({ length: n }, (_, k) => `[x${k}]`).join("")}amix=inputs=${n}:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5,atrim=0:${end.toFixed(2)}[a]`);
ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "3", path.join("audio", "radio-cut.mp3")]);

// 5. Pacing QC on the radio cut (the DNA numbers).
const words = lines.reduce((nw, x) => nw + x.l.text.split(/\s+/).filter(Boolean).length, 0);
const speech = lines.reduce((s, x) => s + x.len, 0);
let maxGap = 0, dead = 0;
// A shot with no dialogue and a planned duration is a visual beat (an exit, a physical gag): the picture carries
// it, so it is not dead air. Keep those shots short; the DNA's limit is a silence with no visual change.
const actionBeats = sl.shots.filter((s) => !(s.dialogue || []).length && shotStart[s.id] != null).map((s) => [shotStart[s.id], shotStart[s.id] + (s.duration || 1.2)]);
const busy = [...lines.map((x) => [x.at, x.at + x.len]), ...laughs.map((L) => [L.at, L.at + L.len]), ...actionBeats].sort((a, b) => a[0] - b[0]);
let cursor = 0;
// Turn-taking gaps (< 0.4 s) are rhythm, not dead air; only longer silences count.
for (const [a, b] of busy) { if (a > cursor) { const g = a - cursor; const planned = lines.find((x) => Math.abs(x.at - a) < 0.01)?.l.beat || 0; if (g - planned >= 0.4) dead += g - planned; maxGap = Math.max(maxGap, g - planned); } cursor = Math.max(cursor, b); }
const pacing = {
  length: Math.round(total * 10) / 10,
  wpm: Math.round(words / (speech / 60)),
  wordsPerSec: Math.round((words / total) * 100) / 100,
  maxUnplannedGap: Math.round(maxGap * 100) / 100,
  deadAirPct: Math.round((dead / total) * 1000) / 10,
  laughs: laughs.length,
  firstLaugh: laughs[0] ? Math.round(laughs[0].at * 10) / 10 : null,
  secondsPerLaugh: laughs.length ? Math.round((total / laughs.length) * 10) / 10 : null,
};
const rules = sl.paceRules || { minWpm: 140, maxGap: 0.6, maxDeadPct: 8, maxFirstLaugh: 6, maxSecondsPerLaugh: 7.5 };
const problems = [...planCheck(sl).problems.map((x) => `continuity plan: ${x}`)];
if (pacing.wpm < rules.minWpm) problems.push(`delivery ${pacing.wpm} wpm < ${rules.minWpm} (raise pace.tempo)`);
if (pacing.maxUnplannedGap > rules.maxGap) problems.push(`gap ${pacing.maxUnplannedGap}s > ${rules.maxGap}s`);
if (pacing.deadAirPct > rules.maxDeadPct) problems.push(`dead air ${pacing.deadAirPct}% > ${rules.maxDeadPct}%`);
if (pacing.firstLaugh == null || pacing.firstLaugh > rules.maxFirstLaugh) problems.push(`first laugh at ${pacing.firstLaugh}s > ${rules.maxFirstLaugh}s`);
if (pacing.secondsPerLaugh == null || pacing.secondsPerLaugh > rules.maxSecondsPerLaugh) problems.push(`a laugh every ${pacing.secondsPerLaugh}s > ${rules.maxSecondsPerLaugh}s`);
sl.radio = { file: "audio/radio-cut.mp3", ...pacing, laughTimes: laughs.map((L) => ({ kind: L.kind, at: Math.round(L.at * 100) / 100, shot: L.shot })), problems, pass: !problems.length, at: new Date().toISOString() };
P.saveShotlist(slug, sl);

console.log(path.join(dir, "audio", "radio-cut.mp3"));
console.log(sl.shots.map((s) => `${s.id} ${s.duration}s`).join(" · "));
console.log(JSON.stringify(pacing));
console.log(problems.length ? `PACING FAIL: ${problems.join("; ")}` : "pacing: pass");
