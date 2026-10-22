// Sitcom sound library shared by the radio cut and the auto edit.
// v2 (after ): laughs are generated as several takes of a real
// studio audience, the take with the most sitcom-like envelope (fast attack, smooth decay, no lone voices) is
// picked, a second take is layered under it so it sounds like a crowd, and it's band-limited like a TV mix.
// Timing: an audience reacts AFTER the punchword (~0.15 s), peaks, and the next line steps in on the decay.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./env.mjs";
import * as eleven from "./eleven.mjs";

const CROWD = "Authentic laugh track recorded at a 1990s American multi-camera sitcom taping: a live studio audience of about two hundred people laughing together in a TV studio, warm natural room sound, no music, no single voice standing out, no talking";
export const LAUGHS = {
  chuckle: { len: 1.4, react: 0.12, stepIn: 0.55, gainDb: -9, prompt: `${CROWD}. A light ripple of amused chuckles that rises fast and fades within a second and a half.` },
  laugh: { len: 2.2, react: 0.15, stepIn: 0.9, gainDb: -6, prompt: `${CROWD}. A solid, hearty group laugh that bursts right away and settles over two seconds.` },
  big: { len: 3.2, react: 0.15, stepIn: 2.6, gainDb: -4, prompt: `${CROWD}. A huge roaring laugh that bursts right away, with a few whoops and scattered applause, settling over three seconds.` },
};
export const STINGS = {
  sting: { len: 2.0, prompt: "short 1990s sitcom scene-transition sting, funky slap bass riff with a bright brass hit, two seconds" },
  outro: { len: 3.5, prompt: "cheesy upbeat 1990s sitcom end-credits saxophone riff with slap bass and drums, ends on a button, four seconds" },
};
const VERSION = "v2";
const TAKES = 3;

// Envelope score: how sitcom-like a laugh take is. Fast attack (peak early), smooth decay, little dead air.
function score(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 64 << 20 });
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2));
  const win = 400, env = [];
  for (let i = 0; i + win <= pcm.length; i += win) { let s = 0; for (let k = i; k < i + win; k++) s += pcm[k] * pcm[k]; env.push(Math.sqrt(s / win)); }
  const peak = Math.max(...env, 1);
  const start = env.findIndex((v) => v > peak * 0.1);
  const at = env.indexOf(peak);
  const attack = (at - Math.max(0, start)) * 0.05;               // seconds from onset to peak
  const body = env.slice(start).filter((v) => v > peak * 0.15).length * 0.05;
  const jumps = env.slice(start + 1).reduce((n, v, i) => n + (Math.abs(v - env[start + i]) > peak * 0.45 ? 1 : 0), 0); // lone shouts / glitches
  return { lead: Math.max(0, start) * 0.05, score: -attack * 2 + Math.min(body, 3) - jumps * 0.8 };
}

export async function libSound(name) {
  const kind = name.replace(/^laugh-/, "");
  const libDir = path.join(ROOT, "bible", "sfx", VERSION);
  fs.mkdirSync(libDir, { recursive: true });
  const out = path.join(libDir, `${name}.mp3`);
  if (fs.existsSync(out)) return out;
  const L = LAUGHS[kind];
  if (!L) {
    // Stings and music cues: one take, trimmed and faded.
    const spec = STINGS[name];
    const raw = path.join(libDir, `${name}-raw.mp3`);
    if (!fs.existsSync(raw)) await eleven.sfx({ text: spec.prompt, seconds: Math.max(1, Math.ceil(spec.len + 0.5)), out: raw });
    const fade = Math.min(0.6, spec.len / 3);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", `silenceremove=start_periods=1:start_threshold=-40dB,atrim=0:${spec.len},afade=t=out:st=${spec.len - fade}:d=${fade}`, out]);
    return out;
  }
  const takes = [];
  for (let k = 1; k <= TAKES; k++) {
    const raw = path.join(libDir, `${name}-take${k}.mp3`);
    if (!fs.existsSync(raw)) await eleven.sfx({ text: L.prompt, seconds: Math.ceil(L.len + 1.5), out: raw, influence: 0.6 });
    takes.push({ raw, ...score(raw) });
  }
  takes.sort((a, b) => b.score - a.score);
  const [main, under] = takes;
  const fade = Math.min(0.9, L.len * 0.4);
  // Main take from its onset; a second take 60 ms later, 5 dB down and slightly delayed in one channel, for a
  // wider crowd; TV band (120 Hz–9 kHz); short fade-in so the burst never clicks.
  const af = (i, lead) => `[${i}:a]atrim=start=${lead.toFixed(2)},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", main.raw, "-i", under.raw, "-filter_complex",
    `${af(0, main.lead)}[m];${af(1, under.lead)},adelay=60|85,volume=-5dB[u];[m][u]amix=inputs=2:duration=first:normalize=0,` +
    `highpass=f=120,lowpass=f=9000,atrim=0:${L.len},afade=t=in:d=0.03,afade=t=out:st=${(L.len - fade).toFixed(2)}:d=${fade.toFixed(2)},loudnorm=I=-16:TP=-2[a]`,
    "-map", "[a]", out]);
  return out;
}
