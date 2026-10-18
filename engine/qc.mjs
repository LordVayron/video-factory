#!/usr/bin/env node
// Quality control: checkpoints between every paid step. Nothing moves forward until it passes.
//
//   node engine/qc.mjs frames <slug> [--shots s01,s02] [--judge kie]   CP2: build review sheets (keyframe next to its refs)
//   node engine/qc.mjs clips  <slug> [--shots ...]     [--judge kie]   CP3: free technical checks + review sheets
//   node engine/qc.mjs scenes <slug> [--shots A,B]                     scene clips: tech checks + continuity strip
//   node engine/qc.mjs score  <slug> <shot> frame|clip <idx> identity=9 anatomy=8 ... [--issues "a; b"] [--fix "note"]
//   node engine/qc.mjs final  <slug>                                   CP4: loudness, peaks, dead air, duration
//   node engine/qc.mjs report <slug>                                   pass/fail table for every shot
//
// Judge: by default the Claude Code session reviews the sheets (free) and records scores with "score".
// --judge kie scores automatically with Claude via Kie's Anthropic-compatible endpoint when it's up.
//
// Policy (shotlist "qc", defaults below): pass = every criterion >= minEach and average >= minAvg.
// Pass -> best passing take is auto-approved. Fail -> a reroll is queued with the judge's fix note;
// after maxRerolls fails, the reroll escalates to a stronger model; after that the shot is flagged for a human.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as P from "./lib/project.mjs";

const argv = process.argv.slice(2);
const [cmd, slug] = argv;
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

export const RUBRIC = {
  frame: {
    identity: "Each character matches its reference exactly (face, markings, wardrobe, accessories). No extra or missing characters.",
    anatomy: "Bodies are correct: no extra or fused limbs, paws or fingers, no melted faces, correct eyes.",
    set: "The location matches the set reference (walls, furniture, layout) and keeps screen geography.",
    framing: "Framing, lens and action match the shot list (e.g. a close-up is really a close-up; the key prop is visible).",
    look: "Reads as the target style (for 90s-broadcast: a real TV frame grab, not glossy, not CGI, no text or collage).",
  },
  clip: {
    identity: "Characters stay identical to the keyframe for the whole clip (no face or costume drift, no swaps).",
    anatomy: "No morphing, extra limbs, warping objects or melting faces at any point.",
    set: "The room stays the same room; the camera doesn't wander into an invented space; nothing new pops in.",
    action: "The described action actually happens, readably, within the clip.",
    look: "Keeps the target look and the keyframe's texture; no flicker, smearing or sudden quality drops.",
    speech: "If there is dialogue: the right character visibly speaks it; others stay quiet. (Score 10 if no dialogue.)",
  },
};
// A scene clip holds several shots generated together; continuity across its cuts is what matters most.
RUBRIC.scene = {
  ...RUBRIC.clip,
  continuity: "Across every cut, each character keeps the position, posture, props and screen side from the blocking; nobody teleports, swaps seats or reappears somewhere new; the room and its layout stay the same.",
  timing: "Each line lands on the right shot and character, in script order, with no garbled or missing words; the button lands at the end.",
};
// Style sheets add their own criteria (e.g. realism, onModel, lipsync, product) and thresholds.
const styleQc = (sl) => { try { return P.style(sl.style).qc || {}; } catch { return {}; } };
export const rubric = (sl, kind) => ({ ...RUBRIC[kind], ...(styleQc(sl).extra?.[kind === "scene" ? "clip" : kind] || {}) });
const policy = (sl) => {
  const sq = styleQc(sl);
  return { minEach: sq.minEach ?? 7, minAvg: sq.minAvg ?? 8, maxRerolls: 2, escalate: { frame: "gpt2.5", clip: "wan3-prime" }, ...(sl.qc || {}) };
};

// ffmpeg reports filter results on stderr, so return both streams.
const run = (bin, args) => { const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return (r.stdout || "") + (r.stderr || ""); };
const ff = (args) => run("ffmpeg", ["-hide_banner", "-y", ...args]);
const probe = (f, q) => (spawnSync("ffprobe", ["-v", "error", ...q, "-of", "csv=p=0", f], { encoding: "utf8" }).stdout || "").trim();
const qcDir = (s) => { const d = P.abs(s, "qc"); fs.mkdirSync(d, { recursive: true }); return d; };

function ssim(a, b) {
  const out = ff(["-i", a, "-i", b, "-lavfi", "[0]scale=180:320,format=gray[x];[1]scale=180:320,format=gray[y];[x][y]ssim", "-f", "null", "-"]);
  const m = out.match(/All:([0-9.]+)/);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------ CP3 tech ----
function techChecks(slug, sl, s, clip) {
  const f = P.abs(slug, clip.file);
  const dir = qcDir(slug);
  const tag = path.basename(clip.file, ".mp4");
  const dur = Number(probe(f, ["-show_entries", "format=duration"]));
  const [w, h] = probe(f, ["-select_streams", "v", "-show_entries", "stream=width,height"]).split(",").map(Number);
  const hasAudio = probe(f, ["-select_streams", "a", "-show_entries", "stream=index"]).length > 0;
  const vol = hasAudio ? Number((ff(["-i", f, "-af", "volumedetect", "-f", "null", "-"]).match(/mean_volume: (-?[0-9.]+)/) || [])[1]) : null;
  const freezes = [...ff(["-i", f, "-vf", "freezedetect=n=0.002:d=0.7", "-map", "0:v", "-f", "null", "-"]).matchAll(/freeze_duration: ([0-9.]+)/g)].map((m) => Number(m[1]));
  // scdet catches the hard cuts video models sometimes insert (select=scene>0.45 missed one at score ~0.3).
  const cutTimes = [...ff(["-i", f, "-vf", "scdet=threshold=10", "-f", "null", "-"]).matchAll(/lavfi\.scd\.time: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const cuts = cutTimes.length;
  const black = (ff(["-i", f, "-vf", "blackdetect=d=0.2:pix_th=0.08", "-f", "null", "-"]).match(/black_start/g) || []).length;
  const first = path.join(dir, `${tag}-first.png`), last = path.join(dir, `${tag}-last.png`);
  ff(["-i", f, "-frames:v", "1", first]);
  ff(["-sseof", "-0.1", "-i", f, "-frames:v", "1", last]);
  const drift = ssim(first, last);
  const kf = s.frames?.[s.frame ?? 0] ? P.abs(slug, s.frames[s.frame ?? 0].file) : null;
  const keyMatch = kf ? ssim(kf, first) : null;

  const locked = /locked|static/i.test(s.camera || "");
  const problems = [];
  if (Math.abs(dur - (s.duration || dur)) > 0.4) problems.push(`duration ${dur.toFixed(1)}s vs planned ${s.duration}s`);
  if (Math.min(w, h) < 700) problems.push(`low resolution ${w}x${h}`);
  if (freezes.some((d) => d > 0.7)) problems.push(`frozen video ${Math.max(...freezes).toFixed(1)}s`);
  const allowedCuts = s.expectedCuts ?? 0;
  if (cuts > allowedCuts + (allowedCuts ? 1 : 0)) problems.push(`${cuts} cut(s) (expected ${allowedCuts}) inside the clip at ${cutTimes.map((x) => x.toFixed(1) + "s").join(", ")} (trim before it or reroll)`);
  if (black) problems.push("black frames");
  if ((s.dialogue || []).length && (!hasAudio || vol < -35)) problems.push("dialogue expected but audio is near silent");
  // Drift is a warning: big subject motion also lowers it. The visual review confirms or clears it.
  const warnings = [];
  if (locked && drift != null && drift < 0.45) warnings.push(`possible camera/set drift (first→last similarity ${drift.toFixed(2)}) on a locked-off shot`);
  if (s.strictFrame && keyMatch != null && keyMatch < 0.6) problems.push(`clip doesn't start on the keyframe (similarity ${keyMatch.toFixed(2)})`);
  return { duration: +dur.toFixed(2), size: `${w}x${h}`, audio: hasAudio, meanDb: vol, freezes, cuts, cutTimes, black, drift, keyMatch, problems, warnings, pass: problems.length === 0 };
}

// A scene viewed as one item: all its lines, its first storyboard panel as the "keyframe".
function sceneItem(sl, sc) {
  const shots = P.sceneShots(sl, sc);
  return {
    id: sc.id, beat: "scene", framing: `${shots.length}-shot scene`, camera: "", isScene: true,
    duration: P.sceneSecs(shots),
    dialogue: shots.flatMap((s) => s.dialogue || []), characters: P.sceneCast(sl, sc),
    motion: `${sc.summary || ""} Blocking: ${sc.blocking}`, expectedCuts: shots.length - 1,
    frames: shots[0].board ? [{ file: shots[0].board.file }] : [], frame: 0, clips: sc.clips || [],
  };
}

// --------------------------------------------------------- review sheets ----
function frameSheet(slug, sl, s, i) {
  const out = path.join(qcDir(slug), `${s.id}-frame-${i}.jpg`);
  const st = P.style(sl.style);
  const ns = st.northStar && st.dir ? path.join(st.dir, st.northStar) : null;
  const imgs = [P.abs(slug, s.frames[i].file), ...P.shotRefs(sl, s, { withBoard: true }), ...(ns && fs.existsSync(ns) ? [ns] : [])];
  const inputs = imgs.flatMap((f) => ["-i", f]);
  const fc = imgs.map((_, k) => `[${k}]scale=-2:640,setsar=1[v${k}]`).join(";") + ";" + imgs.map((_, k) => `[v${k}]`).join("") + `hstack=${imgs.length}`;
  ff([...inputs, "-filter_complex", imgs.length > 1 ? fc : "[0]scale=-2:640", "-frames:v", "1", out]);
  return out;
}
function clipSheet(slug, s, ci) {
  const f = P.abs(slug, s.clips[ci].file);
  const out = path.join(qcDir(slug), `${s.id}-clip-${ci}.jpg`);
  const d = Number(probe(f, ["-show_entries", "format=duration"]));
  const kf = s.frames?.[s.frame ?? 0] ? P.abs(slug, s.frames[s.frame ?? 0].file) : null;
  const strip = path.join(qcDir(slug), `_strip.jpg`);
  const n = s.isScene ? Math.min(10, Math.max(6, (s.expectedCuts + 1) * 2)) : 6;
  ff(["-i", f, "-vf", `fps=${n}/${d},scale=-2:480,tile=${n}x1`, "-frames:v", "1", strip]);
  if (kf) ff(["-i", kf, "-i", strip, "-filter_complex", "[0]scale=-2:480[k];[k][1]hstack", "-frames:v", "1", out]);
  else fs.copyFileSync(strip, out);
  return out;
}

function brief(sl, s, kind) {
  const who = (s.characters || []).map((id) => { try { return P.character(id).name; } catch { return id; } }).join(", ");
  const lines = (s.dialogue || []).map((l) => `${l.char}: "${l.text}"`).join(" / ") || "none";
  return `${s.id} [${s.beat}] ${s.framing}, ${s.camera}. Characters: ${who || "none"}. ` +
    (kind === "frame" ? `Picture: ${s.image}` : `Action: ${s.motion} Dialogue: ${lines}`);
}

// ---------------------------------------------------------------- judge ----
async function kieJudge(sheet, kind, briefText, sl) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { z } = await import("zod");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const { kieKey } = await import("./lib/env.mjs");
  const R = rubric(sl, kind);
  const keys = Object.keys(R);
  const Score = z.object({ scores: z.object(Object.fromEntries(keys.map((k) => [k, z.number()]))), issues: z.array(z.string()), fix: z.string() });
  const client = new Anthropic({ baseURL: "https://api.kie.ai/claude", authToken: kieKey(), apiKey: null, maxRetries: 1 });
  const r = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(Score) },
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(sheet).toString("base64") } },
      { type: "text", text: `You are the quality-control judge for an AI-generated sitcom. ${kind === "frame" ? "Leftmost image is the keyframe; the others are the character and set references it must match." : "Leftmost image is the approved keyframe; the strip shows the clip at six moments."}\nShot: ${briefText}\nScore each criterion 1-10 strictly (7 = shippable, 9+ = indistinguishable from real footage):\n${keys.map((k) => `- ${k}: ${R[k]}`).join("\n")}\nList concrete visible issues, and write "fix": one director's note that would fix them in a reroll.` },
    ] }],
  });
  if (r.stop_reason === "refusal" || !r.parsed_output) throw new Error(`judge returned ${r.stop_reason}`);
  return r.parsed_output;
}

// --------------------------------------------------------------- record ----
function verdict(sl, scores) {
  const pol = policy(sl);
  const vals = Object.values(scores);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { avg: +avg.toFixed(2), pass: vals.every((v) => v >= pol.minEach) && avg >= pol.minAvg };
}

// back = "frame" sends a failed clip back to the keyframe stage (the frame itself was the problem).
export function record(slug, shotId, kind, idx, scores, issues = [], fix = "", by = "claude-session", back = null) {
  let msg = "";
  P.updateShotlist(slug, (sl) => {
    const s = P.findItem(sl, shotId);
    const list = kind === "frame" ? s.frames : s.clips;
    const item = list[idx];
    const v = verdict(sl, scores);
    const tech = item.qc?.tech;
    const pass = v.pass && (kind === "frame" || !tech || tech.pass);
    item.qc = { ...(item.qc || {}), scores, avg: v.avg, pass, issues: [...issues, ...(tech?.problems || [])], fix, by, at: new Date().toISOString() };
    const pol = policy(sl);
    const field = kind === "frame" ? "frame" : "clip";
    if (pass) {
      // Auto-approve the best passing take.
      const best = list.reduce((b, it, k) => (it.qc?.pass && it.qc.avg > (list[b]?.qc?.avg ?? -1) ? k : b), idx);
      s[field] = best;
      s.qcFlag = null;
      msg = `${shotId} ${kind} ${idx}: PASS (avg ${v.avg}) → approved take ${best}`;
    } else {
      const fails = list.filter((it) => it.qc && !it.qc.pass).length;
      const stage = back === "frame" || kind === "frame" ? "frame" : "video";
      if (back === "frame") s.frame = null; // the old keyframe is rejected too
      if (list.some((it) => it.qc?.pass)) {
        msg = `${shotId} ${kind} ${idx}: FAIL (avg ${v.avg}), but a passing take already exists`;
      } else if (fails <= pol.maxRerolls) {
        // One pending reroll per stage: a newer verdict replaces the older request.
        s.queue = (s.queue || []).filter((q) => q.stage !== stage);
        s.queue.push({ stage, note: fix || issues.join("; ") });
        msg = `${shotId} ${kind} ${idx}: FAIL (avg ${v.avg}) → reroll queued (${fails}/${pol.maxRerolls})`;
      } else if (fails === pol.maxRerolls + 1) {
        s.queue = (s.queue || []).filter((q) => q.stage !== stage);
        s.queue.push({ stage, note: fix || issues.join("; "), model: pol.escalate[kind] });
        msg = `${shotId} ${kind} ${idx}: FAIL again → escalated reroll on ${pol.escalate[kind]}`;
      } else {
        s.qcFlag = `needs a human: ${fails} failed ${kind}s`;
        msg = `${shotId} ${kind} ${idx}: FAIL → flagged for review (${fails} failures)`;
      }
    }
  });
  return msg;
}

// -------------------------------------------------------------- commands ----
async function review(kind) {
  const sl = P.loadShotlist(slug);
  const want = flag("--shots")?.split(",");
  const judge = flag("--judge");
  const todo = [];
  const items = kind === "scene" ? (sl.scenes || []).map((sc) => sceneItem(sl, sc)) : sl.shots;
  for (const s of items.filter((x) => !want || want.includes(x.id))) {
    const list = (kind === "frame" ? s.frames : s.clips) || [];
    list.forEach((it, i) => { if (!it.qc?.scores || flag("--redo")) todo.push({ s, i }); });
  }
  if (!todo.length) return console.log(`no unreviewed ${kind}s`);
  const packet = [];
  for (const { s, i } of todo) {
    let tech = null;
    if (kind !== "frame") {
      tech = techChecks(slug, sl, s, s.clips[i]);
      P.updateShotlist(slug, (x) => { const c = P.findItem(x, s.id).clips[i]; c.qc = { ...(c.qc || {}), tech }; });
    }
    const sheet = kind === "frame" ? frameSheet(slug, sl, s, i) : clipSheet(slug, s, i);
    const b = brief(sl, s, kind);
    if (judge === "kie") {
      try {
        const j = await kieJudge(sheet, kind, b, sl);
        console.log(record(slug, s.id, kind, i, j.scores, j.issues, j.fix, "kie-claude"));
        continue;
      } catch (e) {
        console.error(`judge unavailable (${e.status || ""} ${String(e.message).slice(0, 80)}); leaving ${s.id} ${kind} ${i} for session review`);
      }
    }
    packet.push(`### ${s.id} ${kind} ${i}\nSheet: ${path.relative(P.abs(slug, ""), sheet).replace(/\\/g, "/")}\n${b}${tech ? `\nTech: ${tech.pass ? "pass" : "FAIL — " + tech.problems.join("; ")}${tech.warnings?.length ? " | CHECK: " + tech.warnings.join("; ") : ""} (drift ${tech.drift?.toFixed(2)}, keyframe match ${tech.keyMatch?.toFixed(2)}, ${tech.meanDb} dB)` : ""}`);
  }
  if (packet.length) {
    const R = rubric(sl, kind);
    const keys = Object.keys(R);
    const doc = `# QC ${kind}s — ${sl.title} (style: ${sl.style})\nSheets show: keyframe, storyboard frame, character views, set plate, then the style north star (the bar to match).\n\nScore 1–10 per criterion (7 = shippable, 9+ = looks like real footage). Pass = all ≥ ${policy(sl).minEach} and average ≥ ${policy(sl).minAvg}.\n${keys.map((k) => `- **${k}**: ${R[k]}`).join("\n")}\n\nRecord: node engine/qc.mjs score ${slug} <shot> ${kind} <idx> ${keys.map((k) => `${k}=N`).join(" ")} --issues "..." --fix "director's note"\n\n${packet.join("\n\n")}\n`;
    const f = path.join(qcDir(slug), `review-${kind}s.md`);
    fs.writeFileSync(f, doc);
    console.log(doc);
  }
}

const commands = {
  frames: () => review("frame"),
  clips: () => review("clip"),
  scenes: () => review("scene"),
  score() {
    const [, , shotId, kind, idx, ...rest] = argv;
    const scores = Object.fromEntries(rest.filter((a) => /^\w+=\d+(\.\d+)?$/.test(a)).map((a) => { const [k, v] = a.split("="); return [k, Number(v)]; }));
    if (!RUBRIC[kind]) throw new Error("kind must be frame, clip or scene");
    const missing = Object.keys(rubric(P.loadShotlist(slug), kind)).filter((k) => !(k in scores));
    if (missing.length) throw new Error(`need ${kind} scores for: ${missing.join(", ")}`);
    console.log(record(slug, shotId, kind, Number(idx), scores, (flag("--issues") || "").split(";").map((x) => x.trim()).filter(Boolean), flag("--fix") || "", "claude-session", flag("--back")));
  },
  final() {
    const f = P.abs(slug, `out/${slug}.mp4`);
    if (!fs.existsSync(f)) throw new Error("assemble first");
    const sl = P.loadShotlist(slug);
    const loud = ff(["-i", f, "-af", "ebur128=peak=true", "-f", "null", "-"]);
    const I = Number((loud.match(/I:\s+(-?[0-9.]+) LUFS/g) || []).pop()?.match(/-?[0-9.]+/)[0]);
    const peak = Number((loud.match(/Peak:\s+(-?[0-9.]+) dBFS/g) || []).pop()?.match(/-?[0-9.]+/)[0]);
    const gaps = [...ff(["-i", f, "-af", "silencedetect=n=-45dB:d=0.8", "-f", "null", "-"]).matchAll(/silence_duration: ([0-9.]+)/g)].map((m) => Number(m[1]));
    const dur = Number(probe(f, ["-show_entries", "format=duration"]));
    const planned = sl.shots.reduce((n, s) => n + (s.trim ? (s.trim[1] ?? s.duration) - s.trim[0] : s.duration), 0) + (Number(sl.freezeEnd) || 0);
    const unapproved = (sl.scenes?.length ? sl.scenes : sl.shots).filter((s) => s.clip == null || !s.clips?.[s.clip]?.qc?.pass).map((s) => s.id);
    const problems = [];
    if (!(I >= -16 && I <= -12)) problems.push(`loudness ${I} LUFS (target -14 ±2)`);
    if (peak > -1) problems.push(`true peak ${peak} dBFS (keep under -1)`);
    if (gaps.length) problems.push(`dead air: ${gaps.map((g) => g.toFixed(1) + "s").join(", ")}`);
    if (Math.abs(dur - planned) > 1) problems.push(`duration ${dur.toFixed(1)}s vs planned ${planned.toFixed(1)}s`);
    if (unapproved.length) problems.push(`${sl.scenes?.length ? "scenes" : "shots"} without a passing clip: ${unapproved.join(", ")}`);
    const res = { loudness: I, truePeak: peak, deadAir: gaps, duration: +dur.toFixed(2), problems, pass: problems.length === 0 };
    P.updateShotlist(slug, (x) => { x.finalQc = { ...res, at: new Date().toISOString() }; });
    console.log(JSON.stringify(res, null, 2));
  },
  report() {
    const sl = P.loadShotlist(slug);
    for (const s of sl.shots) {
      const fr = s.frames?.[s.frame ?? -1]?.qc, cl = s.clips?.[s.clip ?? -1]?.qc;
      const tag = (q) => (!q?.scores ? "unreviewed" : `${q.pass ? "PASS" : "FAIL"} ${q.avg}`);
      console.log(`${s.id.padEnd(5)} frame ${tag(fr).padEnd(11)} clip ${tag(cl).padEnd(11)} ${s.queue?.length ? `queued ${s.queue.length} ` : ""}${s.qcFlag || ""}`);
    }
    if (sl.finalQc) console.log(`final: ${sl.finalQc.pass ? "PASS" : "FAIL — " + sl.finalQc.problems.join("; ")}`);
  },
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!commands[cmd] || !slug) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(1); }
    await commands[cmd]();
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
