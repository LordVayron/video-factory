#!/usr/bin/env node
// Phase 5 deliverable: the storyboard as a flipbook. Each board is held for its shot's length,
// with temporary voices (direct ElevenLabs, free), the project's SFX layers and captions.
// No credits used. Approve the whole thing before any production money is spent.
//
//   node engine/animatic.mjs <slug>      -> out/animatic.mp4 + out/storyboard.jpg
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "./lib/project.mjs";
import * as eleven from "./lib/eleven.mjs";

const slug = process.argv[2];
if (!slug) { console.error("usage: animatic.mjs <slug>"); process.exit(1); }
const dir = P.projectDir(slug);
const sl = P.loadShotlist(slug);
const W = sl.ar === "16:9" ? 1280 : 720, H = sl.ar === "16:9" ? 720 : 1280;
const tmp = path.join(dir, "out", "_animatic");
fs.mkdirSync(path.join(dir, "audio", "temp"), { recursive: true });
fs.mkdirSync(tmp, { recursive: true });
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

const missing = sl.shots.filter((s) => !s.board?.file).map((s) => s.id);
if (missing.length) { console.error(`no storyboard frame for: ${missing.join(", ")} (node engine/gen.mjs storyboard ${slug})`); process.exit(1); }

// Pipeline v4: when a radio cut exists, the animatic is the boards cut exactly to it (its timing is the plan).
if (sl.radio?.file && fs.existsSync(path.join(dir, sl.radio.file))) {
  const list = [];
  for (const s of sl.shots) {
    const out = path.join(tmp, `${s.id}.mp4`);
    const len = s.duration + (s === sl.shots.at(-1) ? (sl.freezeEnd || 0) + 3 : 0);
    ff(["-loop", "1", "-t", String(len), "-i", s.board.file, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,format=yuv420p`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", out]);
    list.push(`file '${path.basename(out)}'`);
  }
  fs.writeFileSync(path.join(tmp, "list.txt"), list.join("\n"));
  const ts = (x) => `0:${String(Math.floor(x / 60)).padStart(2, "0")}:${(x % 60).toFixed(2).padStart(5, "0")}`;
  const ev = [];
  sl.shots.forEach((s) => (s.dialogue || []).forEach((l, i, arr) => {
    const a = s.radio.start + (l.at ?? 0), b = i < arr.length - 1 ? s.radio.start + arr[i + 1].at - 0.05 : s.radio.end;
    ev.push(`Dialogue: 0,${ts(a)},${ts(Math.max(b, a + 0.6))},Line,,0,0,0,,${l.text}`);
  }));
  fs.writeFileSync(path.join(tmp, "cap.ass"), `[Script Info]
PlayResX: ${W}
PlayResY: ${H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Line,Arial,${Math.round(W * 0.05)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,${Math.round(W * 0.006)},0,2,40,40,${Math.round(H * 0.16)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join("\n")}
`);
  const outFile = path.join("out", "animatic.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", path.relative(dir, path.join(tmp, "list.txt")), "-i", sl.radio.file, "-map", "0:v", "-map", "1:a",
    "-vf", "subtitles=out/_animatic/cap.ass", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", outFile]);
  console.log(`${path.join(dir, outFile)}
${sl.shots.length} shots · ${dur(path.join(dir, outFile)).toFixed(1)}s · radio cut timing · no credits used`);
  process.exit(0);
}

// 1. Temp voices, cached by text.
const parts = [];
for (const s of sl.shots) {
  const lines = [];
  for (const [i, l] of (s.dialogue || []).entries()) {
    const c = P.character(l.char);
    const f = path.join(dir, "audio", "temp", `${s.id}-${i + 1}.mp3`);
    const key = f + ".txt";
    if (!fs.existsSync(f) || fs.readFileSync(key, "utf8") !== l.text) {
      try {
        if (!c.voice?.eleven) throw new Error("no voice.eleven");
        await eleven.tts({ text: l.text, voice: c.voice.eleven, out: f });
        fs.writeFileSync(key, l.text);
      } catch (e) { console.error(`temp voice skipped for ${s.id} line ${i + 1}: ${e.message.slice(0, 80)}`); continue; }
    }
    lines.push({ file: f, len: dur(f), text: l.text });
  }
  const speech = lines.reduce((n, x) => n + x.len + 0.15, 0);
  parts.push({ s, lines, len: Math.max(s.duration || 3, speech + 0.4) });
}

// 2. Each board held for its length, voices laid in from 0.2s.
const list = [];
for (const [k, { s, lines, len }] of parts.entries()) {
  const out = path.join(tmp, `${s.id}.mp4`);
  const inputs = ["-loop", "1", "-t", String(len), "-i", s.board.file];
  let graph = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,format=yuv420p[v]`;
  if (lines.length) {
    let at = 0.2;
    lines.forEach((l, i) => {
      inputs.push("-i", l.file);
      const ms = Math.round(at * 1000);
      graph += `;[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`;
      at += l.len + 0.15;
    });
    graph += `;${lines.map((_, i) => `[a${i}]`).join("")}amix=inputs=${lines.length}:normalize=0,apad[a]`;
  } else {
    inputs.push("-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=48000:cl=stereo");
    graph += ";[1:a]anull[a]";
  }
  ff([...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", String(len), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "23", "-c:a", "aac", out]);
  list.push(`file '${path.basename(out)}'`);
  parts[k].start = parts.slice(0, k).reduce((n, p) => n + p.len, 0);
}
fs.writeFileSync(path.join(tmp, "list.txt"), list.join("\n"));
const cut = path.join(tmp, "cut.mp4");
ff(["-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-c", "copy", cut]);

// 3. Captions with the shot id, and the SFX layers.
const ts = (x) => `0:${String(Math.floor(x / 60)).padStart(2, "0")}:${(x % 60).toFixed(2).padStart(5, "0")}`;
const ev = parts.flatMap((p) => [
  `Dialogue: 0,${ts(p.start)},${ts(p.start + p.len)},Id,,0,0,0,,${p.s.id} · ${p.s.beat || ""}`,
  ...p.lines.length ? [`Dialogue: 0,${ts(p.start + 0.2)},${ts(p.start + p.len)},Line,,0,0,0,,${p.lines.map((l) => l.text).join(" ")}`] : [],
]);
fs.writeFileSync(path.join(tmp, "caps.ass"), `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Id,Arial,${Math.round(W * 0.035)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,6,0,7,20,20,20,1\nStyle: Line,Arial,${Math.round(W * 0.045)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,2,40,40,${Math.round(H * 0.12)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev.join("\n")}\n`);
const starts = Object.fromEntries(parts.map((p) => [p.s.id, p.start]));
const ovs = (sl.overlays || []).map((o) => ({ ...o, file: o.file || `audio/sfx-${o.sfx}.mp3` })).filter((o) => starts[o.shot] != null && fs.existsSync(path.join(dir, o.file)));
const inputs = ["-i", cut, ...ovs.flatMap((o) => ["-i", o.file])];
const total = parts.reduce((n, p) => n + p.len, 0);
let g = `[0:v]subtitles=out/_animatic/caps.ass[v];[0:a]anull[c0]`;
ovs.forEach((o, k) => { const ms = Math.round((starts[o.shot] + (o.at || 0)) * 1000); g += `;[${k + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${o.gainDb ?? 0}dB,adelay=${ms}|${ms}[o${k}]`; });
g += `;[c0]${ovs.map((_, k) => `[o${k}]`).join("")}amix=inputs=${ovs.length + 1}:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5[a]`;
const outFile = path.join("out", "animatic.mp4");
ff([...inputs, "-filter_complex", g, "-map", "[v]", "-map", "[a]", "-t", String(total), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "22", "-c:a", "aac", "-movflags", "+faststart", outFile]);

// 4. Storyboard contact sheet (reading order: left to right, top to bottom).
const cols = Math.min(4, sl.shots.length), rows = Math.ceil(sl.shots.length / cols);
const thumbs = sl.shots.map((s) => ["-i", s.board.file]).flat();
const pad = cols * rows - sl.shots.length;
const tg = sl.shots.map((_, k) => `[${k}]scale=${Math.round(W / 2)}:${Math.round(H / 2)}:force_original_aspect_ratio=increase,crop=${Math.round(W / 2)}:${Math.round(H / 2)},pad=iw+8:ih+8:4:4:white[t${k}]`).join(";")
  + (pad ? `;${Array.from({ length: pad }, (_, k) => `color=white:s=${Math.round(W / 2) + 8}x${Math.round(H / 2) + 8}:d=1[e${k}]`).join(";")}` : "")
  + `;${sl.shots.map((_, k) => `[t${k}]`).join("")}${Array.from({ length: pad }, (_, k) => `[e${k}]`).join("")}xstack=inputs=${cols * rows}:layout=${Array.from({ length: cols * rows }, (_, k) => `${(k % cols) ? Array.from({ length: k % cols }, () => "w0").join("+") : "0"}_${Math.floor(k / cols) ? Array.from({ length: Math.floor(k / cols) }, () => "h0").join("+") : "0"}`).join("|")}`;
ff([...thumbs, "-filter_complex", tg, "-frames:v", "1", path.join("out", "storyboard.jpg")]);
console.log(`${path.join(dir, outFile)}\n${path.join(dir, "out", "storyboard.jpg")}\n${parts.length} shots · ${total.toFixed(1)}s · no credits used`);
