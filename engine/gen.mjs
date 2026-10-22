#!/usr/bin/env node
// AI Video Factory: generation CLI. Every paid job is written to the project's ledger.json.
//
//   node engine/gen.mjs credits                      balance of each provider (APIMart, Kie) in USD
//   node engine/gen.mjs prices [filter]              refresh live prices of both providers; who is cheaper per model
//   node engine/gen.mjs models                       list model keys with tier and use
//   node engine/gen.mjs estimate <slug>              cost of what is still to generate
//   node engine/gen.mjs still "<prompt>" <out.png> [--model gpt2.5] [--ref f]... [--ar 9:16] [--size 1K]
//   node engine/gen.mjs sample <charId> [--lang en] [--text "..."]     voice sample used as voice ref
//   node engine/gen.mjs voice-design <charId> "<description>" [--text "..."]   ElevenLabs Voice Design previews (PREVIEW-design-N.mp3)
//   node engine/gen.mjs voice-pick <charId> <n>                         keep a designed preview as the character's voice
//   node engine/gen.mjs storyboard <slug> [--scenes A,B] [--note "..."]   one grid image per scene (all panels in one generation)
//   node engine/gen.mjs scenes <slug> [--scenes A,B] [--model wan3-prime] [--res 720p]   film each scene in ONE multi-shot generation
//   node engine/gen.mjs frames <slug> [--shots s01,s02] [--n 2] [--model gpt2.5]   phase 7 (or --looktest for the hero shot)
//   node engine/gen.mjs voice  <slug> [--shots ...]                     per-line TTS (timing + dub mode)
//   node engine/gen.mjs video  <slug> [--shots ...] [--model sd2-mini] [--res 480p]
//   node engine/gen.mjs bakeoff <slug> <shot> [--models a,b] [--res 1080p]   phase 6 look test (defaults: style candidates)
//   node engine/gen.mjs dub    <slug> <shot>                            lip-sync approved clip to TTS lines
//   node engine/gen.mjs talk   <image> <audio> <out.mp4> [--model infinitetalk] [--prompt "..."] [--res 480p]
//   node engine/gen.mjs frame  <slug> <shot> first|last "<prompt>" [--ref f]...   clips formats: a shot's first or last frame (board step)
//   node engine/gen.mjs clip   <slug> --shot <id> [--redo] [--eval n]   clips formats: film one shot from the shotlist; identity, jump and
//                                       dialogue evals run on the take and are stored on it (flow v5, film step)
//   node engine/gen.mjs music  <slug>
//   node engine/gen.mjs loops     <slug> [--scenes A,B] [--redo] [--new-image]   long-form: still + seamless loop clip per scene
//   node engine/gen.mjs bed       <slug> [--n 2] [--more]                        long-form: Suno music takes for the bed
//   node engine/gen.mjs narration <slug> [--redo]                                long-form: ElevenLabs voice-over segments
//   node engine/gen.mjs queue  <slug>                                   run rerolls requested on the board
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as kie from "./lib/kie.mjs";
import * as PV from "./lib/providers.mjs";
import { MODELS, getModel, usd } from "./lib/models.mjs";
import * as P from "./lib/project.mjs";
import { missingMarks, castOf, identityCheck } from "./lib/identity.mjs";
import { jumpCheck, jumpLines } from "./lib/jumps.mjs";
import { voiceProfile } from "./lib/voices.mjs";
import { motionScore, MIN_MOTION } from "./lib/meditation.mjs";
import * as eleven from "./lib/eleven.mjs";
import { requireStep, requirePilot, assertV5, takeOk, kindOf, FlowStop, planSha } from "./lib/flow.mjs";
import { dialogueCheck, isVocal } from "./lib/dialogue.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").startsWith("--"));
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flags = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));
const has = (n) => argv.includes(n);

const CONCURRENCY = 4;
async function pool(items, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => ({ error: e.message })); }
  });
  await Promise.all(workers);
  return out;
}

// The last decoded video frame of a clip. Seeks back 0.5 s and keeps overwriting one image, so it works when the
// audio runs past the video (a fixed -sseof -0.05 landed after the last frame and wrote nothing, 2026-10-19).
function lastFrame(video, out) {
  if (fs.existsSync(out)) fs.unlinkSync(out);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-sseof", "-0.5", "-i", video, "-map", "0:v:0", "-update", "1", "-q:v", "1", out]);
  if (!fs.existsSync(out)) throw new Error(`could not read the last frame of ${video}`);
  return out;
}

function mediaDuration(file) {
  try {
    return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
  } catch { return null; }
}

// Run one paid job: submit, wait, download, ledger. Returns local file path(s).
// Run one paid job: submit, wait, download, ledger, register in the shotlist.
// The task id is written to <outBase>.lock right after submit, so if the process
// dies mid-wait, "recover" (run automatically by frames/video/queue) collects the
// finished result instead of paying for it again.
// A job the engine refuses before anything reaches Kie (BUDGET / PROMPT / DIALOGUE STOP) leaves no lock behind:
// an empty lock means "a task may be in flight" to recover() (two stale locks after a budget stop, 2026-10-19).
async function job(args) {
  try { return await jobRun(args); } catch (e) {
    const lock = `${args.outBase}.lock`;
    if (/STOP/.test(e.message) && fs.existsSync(lock) && fs.statSync(lock).size === 0) fs.unlinkSync(lock);
    throw e;
  }
}

async function jobRun({ slug, modelKey, req, outBase, label, ext, register }) {
  const m = getModel(modelKey);
  let caps = () => {};
  // PROVIDERS (2026-10-22): cost() is the cheapest provider's live price (APIMart first, Kie second); the job goes there.
  let credits = m.cost(req);
  // BUDGET GUARD (the creator, 2026-10-13: "you burned my credits without permission"). Once the Production Book is
  // approved, its estimate is the hard ceiling. Any job that would push the project's spend past it is refused;
  // rerolls need a new approval: node engine/phase.mjs budget <slug> --add <credits> --note "approved by the creator".
  // Jobs in flight count against the cap too: pool() runs 4 at once, and without this every one of them
  // would see the same "spent" before any of them reached the ledger.
  if (slug) {
    const sl0 = P.loadShotlist(slug);
    assertV5(sl0);
    // HARD CAP (the creator, 2026-10-19: "no more than 5 dollars, not one cent more"): an intake with a fixed budget caps
    // every paid job of the project, images and sheets included, before and after the book.
    const hard = sl0.intake?.budget?.mode === "fixed" && sl0.intake.budget.usd ? sl0.intake.budget.usd / 0.005 : null;
    const cap = sl0.budget?.approvedCredits;
    if (cap == null && !["image", "voice"].includes(m.kind)) throw new FlowStop(`BUDGET STOP: "${label}" (${m.label}) needs the budget that approving the Production Book locks.`);
    // Checked again at the new price when a job moves from APIMart to Kie.
    caps = (cr, held = 0) => {
      if (hard != null && P.ledgerTotal(slug) + (inFlight.get(slug) || 0) - held + cr > hard + 0.01) throw new FlowStop(`BUDGET STOP: "${label}" would pass the project's hard cap of ${sl0.intake.budget.usd} (spent ${(P.ledgerTotal(slug) * 0.005).toFixed(2)}).`);
      if (cap != null) {
        const spent = P.ledgerTotal(slug) + (inFlight.get(slug) || 0) - held;
        if (spent + cr > cap + 0.5) throw new Error(`BUDGET STOP: "${label}" costs ${cr.toFixed(1)} cr; spent or in flight ${spent.toFixed(1)} of the ${cap} cr the creator approved. Ask the creator before spending more (phase.mjs budget ${slug} --add N).`);
      }
    };
    caps(credits);
    // PROMPT TOO LONG: a model with a prompt limit (Kling 3.0: 2,500 characters) is never sent a longer prompt.
    if (m.maxPrompt && typeof req.prompt === "string" && req.prompt.length > m.maxPrompt) throw new FlowStop(`PROMPT STOP: "${label}" is ${req.prompt.length} characters; ${m.label} takes ${m.maxPrompt}.`);
    // DIALOGUE STOP (2026-10-19, The Glow Up: the clip prompt carried no lines and Seedance improvised a paid take).
    // Every speaking video job declares its script lines (req.lines) and its prompt must carry each one word for word.
    if (m.kind === "video" && m.speaks && req.sound !== false) {
      if (!Array.isArray(req.lines)) throw new FlowStop(`DIALOGUE STOP: "${label}" doesn't declare its script lines (req.lines); every speaking video job must.`);
      const gone = P.linesMissing(req.prompt, req.lines);
      if (gone.length) throw new FlowStop(`DIALOGUE STOP: the prompt of "${label}" leaves out ${gone.map((l) => `"${l.text}"`).join("; ")}. The script goes to the model word for word.`);
    }
    // PROMPT CHECK (added after a character lost her freckles between two shots): a video prompt must carry every distinctive mark of the
    // characters in it (freckles, mole, glasses...). A model only keeps what the prompt says.
    if (m.kind === "video" && req.prompt && !req.allowMissingMarks) {
      const miss = missingMarks(req.prompt, req.cast || castOf(sl0, req.prompt));
      if (miss.length) throw new Error(`PROMPT STOP: "${label}" leaves out ${miss.join("; ")}. Put the marks from the character's look in the prompt.`);
    }
    inFlight.set(slug, (inFlight.get(slug) || 0) + credits);
  }
  process.stderr.write(`→ ${label}: ${m.label} ~${credits.toFixed(1)} cr (${usd(credits)})
`);
  const lock = outBase + ".lock";
  let taskId = null, keepLock = false, provider = null;
  try {
    const sent = await PV.submitBest(modelKey, req, {
      onSwitch: (o) => {
        caps(o.credits, credits);
        if (slug) inFlight.set(slug, (inFlight.get(slug) || 0) - credits + o.credits);
        credits = o.credits;
        process.stderr.write(`  → ${o.provider} ~${credits.toFixed(1)} cr (${usd(credits)})
`);
      },
    });
    ({ taskId, provider } = sent);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ taskId, provider, slug, modelKey, credits, label, outBase: path.relative(ROOT, outBase), ext, register }));
    const { urls, usd: charged } = await PV.wait(provider, taskId, { label });
    try {
      // The ledger keeps what the provider says it charged when it says (APIMart does), else the estimate.
      return await finish({ slug, modelKey, credits: charged != null ? charged / 0.005 : credits, label, outBase, ext, register, taskId, urls, provider });
    } catch (e) {
      // Kie already billed this task; keep the lock so "recover" downloads it instead of paying again.
      keepLock = true;
      throw e;
    }
  } catch (e) {
    // A timeout means the task may still finish (and bill): keep the lock for "recover".
    if (taskId && /timed out/i.test(e.message)) keepLock = true;
    P.ledger(slug, { ok: false, label, model: modelKey, provider, credits: 0, taskId, error: e.message.slice(0, 300) });
    throw e;
  } finally {
    if (slug) inFlight.set(slug, (inFlight.get(slug) || 0) - credits);
    if (!keepLock) fs.rmSync(lock, { force: true });
  }
}
const inFlight = new Map();

// Some models return extras (Suno returns cover art next to the audio): keep only the asked-for kind.
const KIND = { ".mp3": /\.(mp3|wav|m4a|ogg)(\?|$)/i, ".mp4": /\.(mp4|mov)(\?|$)/i, ".png": /\.(png|jpe?g|webp)(\?|$)/i };

async function finish({ slug, modelKey, credits, label, outBase, ext, register, taskId, urls, provider = "kie" }) {
  // APIMart links may carry no extension: filter by kind only when that keeps something.
  if (ext && KIND[ext]) { const k = urls.filter((u) => KIND[ext].test(new URL(u).pathname)); if (k.length) urls = k; else urls = urls.slice(0, 1); }
  const files = [];
  for (let k = 0; k < urls.length; k++) {
    const e = ext || path.extname(new URL(urls[k]).pathname) || ".bin";
    const f = urls.length > 1 ? `${outBase}-${k + 1}${e}` : `${outBase}${e}`;
    await PV.download(urls[k], f);
    files.push(f);
  }
  P.ledger(slug, { ok: true, label, model: modelKey, provider, credits: +(+credits).toFixed(2), taskId, files: files.map((f) => path.relative(ROOT, f)) });
  if (register) {
    P.updateShotlist(slug, (x) => {
      const t = P.findItem(x, register.shot);
      t[register.stage] = [...(t[register.stage] || []), ...files.map((f) => ({ file: P.rel(slug, f), ...register.entry }))];
    });
  }
  return files;
}

// Collect results of jobs whose process died before downloading them.
async function recover(slug) {
  for (const sub of ["frames", "clips"]) {
    const dir = P.abs(slug, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".lock"))) {
      const lockPath = path.join(dir, f);
      let j = null;
      try { j = JSON.parse(fs.readFileSync(lockPath, "utf8") || "null"); } catch {}
      if (!j?.taskId) { fs.rmSync(lockPath, { force: true }); continue; }
      try {
        const { urls, usd: charged } = await PV.wait(j.provider || "kie", j.taskId, { label: `recover ${j.label}`, timeoutMs: 10 * 60 * 1000 });
        const files = await finish({ ...j, ...(charged != null ? { credits: charged / 0.005 } : {}), provider: j.provider || "kie", outBase: path.join(ROOT, j.outBase), urls });
        console.error(`recovered ${j.label}: ${files.map((x) => path.basename(x)).join(", ")}`);
      } catch (e) {
        console.error(`could not recover ${j.label}: ${e.message.slice(0, 120)}`);
        // Still running on Kie's side, or the download failed: leave the lock for the next recover.
        if (/timed out|download/i.test(e.message)) continue;
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
}

// One spoken line -> mp3. Kie's ElevenLabs first (cheapest, big preset library);
// if it fails, the direct ElevenLabs API with the character's own-account voice.
async function speak({ slug, c, lang, text, outBase, label, tts = {} }) {
  const kieVoice = c.voice?.[lang] || c.voice?.id;
  if (kieVoice && c.voice?.provider !== "elevenlabs") {
    try {
      return (await job({ slug, modelKey: "el-v3", req: { lines: [{ text, voice: kieVoice }] }, outBase, label, ext: ".mp3" }))[0];
    } catch (e) {
      if (!c.voice?.eleven) throw e;
      process.stderr.write(`  ${label}: Kie voice failed (${e.message.slice(0, 80)}); using direct ElevenLabs
`);
    }
  }
  const out = await eleven.tts({ text, voice: c.voice.eleven, out: outBase + ".mp3", ...tts });
  P.ledger(slug, { ok: true, label, model: "elevenlabs-direct", credits: 0, chars: text.length, files: [path.relative(ROOT, out)] });
  return out;
}

// Models and sizes: project overrides first, then the style sheet's (look-tested) defaults.
function pick(sl) {
  const m = P.style(sl.style).models || {};
  const d = sl.defaults || {};
  return {
    storyboard: d.storyboardModel || m.storyboard || "gpt2.5",
    image: d.imageModel || m.keyframe || "gpt2.5",
    imageSize: d.imageSize || m.imageSize || "1K",
    video: d.videoModel || m.video || "sd2-mini",
    res: d.res || m.res || "720p",
    variants: d.variants || 2,
  };
}

const pickShots = (sl) => {
  const want = flag("--shots");
  return want ? want.split(",").map((id) => P.shot(sl, id.trim())) : sl.shots;
};
const nextName = (dir, base, ext) => {
  let k = 1;
  const taken = (b) => fs.existsSync(b + ext) || fs.existsSync(b + "-1" + ext) || fs.existsSync(b + ".lock");
  while (taken(path.join(dir, `${base}-${k}`))) k++;
  return path.join(dir, `${base}-${k}`);
};

// --------------------------------------------------------------- commands
const commands = {
  async recover() {
    await recover(pos[0]);
  },

  async credits() {
    const b = await PV.balances();
    for (const [k, v] of Object.entries(b)) console.log(`${k.padEnd(8)} ${typeof v === "number" ? "$" + v.toFixed(2) : v}`);
    if (!Object.keys(b).length) console.log("no provider key (APIMART_API_KEY or KIE_API_TOKEN in .env)");
  },

  async prices() {
    const all = await kie.fetchPrices();
    fs.writeFileSync(path.join(ROOT, "engine", "prices.json"), JSON.stringify(all, null, 1));
    const f = pos[0] ? new RegExp(pos[0], "i") : /seedance|veo|kling 3|grok-imagine|nano|seedream 5|infinitalk|infinitetalk|avatar|lip sync|elevenlabs|suno, generate music|topaz video/i;
    for (const r of all.filter((r) => f.test(r.model))) console.log(`${String(r.credits).padStart(7)} cr  $${String(r.usd).padEnd(7)} ${r.unit.padEnd(20)} ${r.model}`);
    console.log(`\n${all.length} Kie prices saved to engine/prices.json`);
    const { apimartPrices } = await import("./lib/pricing.mjs");
    const ap = await apimartPrices({ maxAgeH: 0 });
    console.log(`${Object.keys(ap.models).length} APIMart prices saved to engine/prices-apimart.json${ap.warning ? " (" + ap.warning + ")" : ""}\n\nWho runs each model (5 s at 720p with sound; APIMart wins ties):`);
    const { offers } = await import("./lib/models.mjs");
    for (const k of Object.keys(MODELS).filter((k) => ["video", "image"].includes(MODELS[k].kind))) {
      const o = offers(k, { res: "720p", duration: 5, sound: true, ar: "9:16" });
      console.log(`  ${k.padEnd(11)} ${o.map((x) => `${x.provider} $${(x.credits * 0.005).toFixed(3)}`).join("  vs  ")}`);
    }
  },

  async models() {
    for (const [k, m] of Object.entries(MODELS).filter(([, m]) => !m.hidden)) console.log(`${k.padEnd(13)} ${m.kind.padEnd(6)} ${m.tier.padEnd(9)} ${m.label}`);
  },

  async estimate() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    const pk = pick(sl);
    const vm = pk.video, im = pk.image, res = pk.res;
    // Scene projects: one storyboard grid + one multi-shot video per scene; no per-shot keyframes.
    if (sl.scenes?.length) {
      let cr = 0;
      for (const sc of sl.scenes) {
        const secs = P.sceneSecs(P.sceneShots(sl, sc));
        const grid = sc.grid ? 0 : getModel(P.style(sl.style).models?.storyboardGrid || "gpt2.5").cost({ size: "4K" });
        const video = sc.clips?.length ? 0 : getModel(sc.videoModel || vm).cost({ res, duration: secs });
        cr += grid + video;
        console.log(`scene ${sc.id.padEnd(3)} ${String(secs).padStart(3)}s  grid ${grid.toFixed(0).padStart(4)}  video ${video.toFixed(0).padStart(5)} cr  (${sc.videoModel || vm} ${res})`);
      }
      console.log(`
Still to spend ≈ ${cr.toFixed(0)} credits (${usd(cr)}) before rerolls. Spent so far: ${P.ledgerTotal(slug).toFixed(0)} cr (${usd(P.ledgerTotal(slug))}).`);
      return;
    }
    let cr = 0, rows = [];
    for (const s of sl.shots) {
      const fr = (s.board || !sl.phases ? 0 : getModel(pk.storyboard).cost({})) + (s.frames?.length ? 0 : getModel(im).cost({ size: pk.imageSize }) * pk.variants);
      const vd = s.clips?.length ? 0 : getModel(s.videoModel || vm).cost({ res, duration: s.duration, sound: s.audioMode !== "silent" });
      cr += fr + vd;
      rows.push(`${s.id.padEnd(5)} frames ${fr.toFixed(1).padStart(6)}  video ${vd.toFixed(1).padStart(6)}  (${s.videoModel || vm} ${res} ${s.duration}s)`);
    }
    console.log(rows.join("\n"));
    console.log(`\nStill to spend ≈ ${cr.toFixed(0)} credits (${usd(cr)}) before rerolls. Spent so far: ${P.ledgerTotal(slug).toFixed(0)} cr (${usd(P.ledgerTotal(slug))}).`);
  },

  async still() {
    const [prompt, out] = pos;
    if (!prompt || !out) throw new Error('usage: still "<prompt>" <out.png> [--model gpt2.5] [--ref f]...');
    const refs = await Promise.all(flags("--ref").map(PV.asUrl));
    const outBase = out.replace(/\.(png|jpe?g)$/i, "");
    const files = await job({ slug: flag("--project"), modelKey: flag("--model", "gpt2.5"), req: { prompt, refs, ar: flag("--ar", "9:16"), size: flag("--size", "1K") }, outBase, label: path.basename(out), ext: ".png" });
    console.log(files.join("\n"));
  },

  async sample() {
    const id = pos[0];
    const lang = flag("--lang", "en");
    const c = P.character(id);
    const text = flag("--text") || c.voice?.sampleText?.[lang];
    if (!text) throw new Error(`no sample text: pass --text or set voice.sampleText.${lang} in character.json`);
    // --model / --speed: hear the voice as the film will use it (e.g. a launch film's narrator on multilingual v2).
    const tts = { ...(flag("--model") ? { model: flag("--model") } : {}), ...(flag("--speed") || flag("--stability") ? { settings: { stability: Number(flag("--stability", 0.5)), similarity_boost: 0.8, style: flag("--stability") ? 0 : 0.15, use_speaker_boost: true, ...(flag("--speed") ? { speed: Number(flag("--speed")) } : {}) } } : {}) };
    const files = [await speak({ slug: null, c, lang, text, outBase: path.join(c.dir, `voice-${lang}`), label: `${id} voice sample`, tts })];
    const cj = path.join(c.dir, "character.json");
    const data = JSON.parse(fs.readFileSync(cj, "utf8"));
    data.voice = { ...data.voice, sample: { ...(data.voice?.sample || {}), [lang]: path.basename(files[0]) }, sampleText: { ...(data.voice?.sampleText || {}), [lang]: text } };
    fs.writeFileSync(cj, JSON.stringify(data, null, 2));
    console.log(files[0], `${mediaDuration(files[0])?.toFixed(1)}s`);
  },

  // Voice Design (ElevenLabs): previews of a new voice from a description, saved as PREVIEW-design-N.mp3 in the
  // character's folder; `voice-pick <char> <n>` keeps one on the account and makes it the character's voice.
  async "voice-design"() {
    const [id, description] = pos;
    if (!id || !description) throw new Error('usage: voice-design <charId> "<description>" [--text "..."]');
    const c = P.character(id);
    const previews = await eleven.designVoice({ description, text: flag("--text"), outBase: path.join(c.dir, "PREVIEW-design") });
    const cj = path.join(c.dir, "character.json");
    const data = JSON.parse(fs.readFileSync(cj, "utf8"));
    data.voiceDesign = { description, at: new Date().toISOString(), previews: previews.map((p) => ({ file: path.basename(p.file), id: p.id })) };
    fs.writeFileSync(cj, JSON.stringify(data, null, 2));
    P.ledger(null, { ok: true, label: `${id} voice design`, model: "elevenlabs-ttv", credits: 0, chars: (flag("--text") || "").length, files: previews.map((p) => path.relative(ROOT, p.file)) });
    for (const [i, p] of previews.entries()) console.log(`${i + 1}. ${p.file} ${mediaDuration(p.file)?.toFixed(1)}s`);
    console.log(`Pick one: node engine/gen.mjs voice-pick ${id} <n>`);
  },

  async "voice-pick"() {
    const [id, n] = pos;
    const c = P.character(id);
    const cj = path.join(c.dir, "character.json");
    const data = JSON.parse(fs.readFileSync(cj, "utf8"));
    const p = data.voiceDesign?.previews?.[Number(n) - 1];
    if (!p) throw new Error(`no design preview ${n} for ${id}; run voice-design first`);
    const voiceId = await eleven.saveDesignedVoice({ name: `${c.name} (Video Factory)`, description: data.voiceDesign.description, generatedId: p.id });
    data.voice = { provider: "elevenlabs", eleven: voiceId, designed: p.file };
    fs.writeFileSync(cj, JSON.stringify(data, null, 2));
    console.log(`${c.name}: voice ${voiceId} (from ${p.file}). Next: node engine/gen.mjs sample ${id} --text "..."`);
  },

  async frames() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    // Gate: production keyframes need an approved storyboard and a look-tested style.
    // --looktest makes the hero keyframe for the look test itself.
    requireStep(sl, "film", "gen frames");
    const pk = pick(sl);
    const todo = pickShots(sl).filter((s) => has("--redo") || flag("--shots") || !s.frames?.length);
    report(await renderFrames(slug, sl, todo, Number(flag("--n", pk.variants)), flag("--model", pk.image), { size: pk.imageSize, withBoard: true }));
  },

  // Storyboard: one grid image per scene (Higgsfield Popcorn style). All panels come from the same
  // generation, so identity, set and blocking stay locked; the grid is then split into panels.
  async storyboard() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    requireStep(sl, "board", "gen storyboard");
    if (!sl.scenes?.length) throw new Error('add "scenes": [{ id, summary, blocking, shots: [...] }] to shotlist.json first');
    const want = flag("--scenes")?.split(",");
    const todo = sl.scenes.filter((sc) => (want ? want.includes(sc.id) : P.sceneShots(sl, sc).some((s) => !s.board)));
    const dir = P.abs(slug, "boards");
    fs.mkdirSync(dir, { recursive: true });
    const st = P.style(sl.style);
    report(await pool(todo, async (sc) => {
      const refs = P.sceneRefs(sl, sc);
      const urls = await Promise.all(refs.map((r) => PV.asUrl(r.file)));
      const { cols, rows, ar } = P.gridLayout(sc.shots.length);
      const note = flag("--note") ? ` Director's note: ${flag("--note")}` : sc.queueNote ? ` Director's note: ${sc.queueNote}` : "";
      const outBase = nextName(dir, `${sc.id}-grid`, ".png");
      fs.writeFileSync(outBase + ".lock", "");
      const files = await job({ slug, modelKey: flag("--model", st.models?.storyboardGrid || "gpt2.5"), req: { prompt: P.boardGridPrompt(sl, sc, refs) + note, refs: urls, ar, size: flag("--size", "4K") }, outBase, label: `${sc.id} storyboard grid`, ext: ".png" });
      const panels = splitGrid(files[0], cols, rows, sc.shots.length, dir, path.basename(outBase));
      P.updateShotlist(slug, (x) => {
        const scx = P.scene(x, sc.id);
        scx.grids = [...(scx.grids || []), P.rel(slug, files[0])];
        scx.grid = P.rel(slug, files[0]);
        scx.gridAngles = JSON.stringify(x.angles || {}); // the board step refuses grids drawn before the current angle frames
        sc.shots.forEach((id, k) => { const s = P.shot(x, id); s.boards = [...(s.boards || []), P.rel(slug, panels[k])]; s.board = { file: P.rel(slug, panels[k]), model: "grid", grid: P.rel(slug, files[0]) }; });
      });
      return files;
    }));
    console.log(`\nNext: node engine/animatic.mjs ${slug}, then approve: node engine/phase.mjs approve ${slug} storyboard`);
  },

  // Coverage angles: one locked close-up frame per person who has close-ups in more than one scene (non-sitcom).
  // Made before the storyboards; every grid and every scene with that person's single gets it as a reference.
  //   node engine/gen.mjs angles <slug> [--only <char>] [--redo]
  async angles() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    requireStep(sl, "board", "gen angles");
    const want = flag("--only")?.split(",");
    const todo = P.anglesNeeded(sl).filter((id) => (want ? want.includes(id) : argv.includes("--redo") || !fs.existsSync(P.angleFile(sl, id) || "")));
    if (!todo.length) return console.log(`angles: nothing to do (${P.anglesNeeded(sl).join(", ") || "no person has close-ups in more than one scene"})`);
    const dir = P.abs(slug, "frames");
    fs.mkdirSync(dir, { recursive: true });
    report(await pool(todo, async (id) => {
      const c = P.character(id);
      const sc = sl.scenes.find((x) => P.sceneShots(sl, x).some((s) => P.singleOf(s) === id));
      const refs = P.sceneRefs(sl, sc).filter((r) => r.role === "set" || r.id === id);
      const urls = await Promise.all(refs.map((r) => PV.asUrl(r.file)));
      const lock = refs.map((r, i) => r.role === "set" ? `The room is reference image ${i + 1}.` : `${r.name} is reference image ${i + 1}.`).join(" ");
      const outBase = nextName(dir, `angle-${id}`, ".png");
      fs.writeFileSync(outBase + ".lock", "");
      const files = await job({ slug, modelKey: "gpt2.5", req: { prompt: `${lock}\n${P.anglePrompt(sl, id)}`, refs: urls, ar: "9:16", size: "2K" }, outBase, label: `${c.name} coverage angle`, ext: ".png" });
      P.updateShotlist(slug, (x) => { x.angles = { ...(x.angles || {}), [id]: path.relative(ROOT, files[0]).replace(/\\/g, "/") }; });
      return files;
    }));
    console.log(`
Show the creator each angle frame, then redraw the storyboards: node engine/gen.mjs storyboard ${slug} --scenes ${sl.scenes.map((x) => x.id).join(",")}`);
  },

  // Production: each scene in ONE multi-shot generation (Wan 3.0 formula), opening on its first storyboard panel.
  async scenes() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen scenes");
    const pk = pick(sl);
    const want = flag("--scenes")?.split(",");
    const todo = (sl.scenes || []).filter((sc) => (want ? want.includes(sc.id) : !sc.clips?.length));
    requirePilot(sl, todo.map((sc) => sc.id));
    // sl.filmBy "shot": a scene is filmed one shot per generation (models without multi-shot scenes: Kling 3.0, Veo),
    // each from its own storyboard panel, then joined into one scene take, so the evals and the edit are unchanged.
    const render = sl.filmBy === "shot" ? renderSceneByShots : renderScene;
    report(await pool(todo, (sc) => render(slug, sl, sc, flag("--model", sc.videoModel || pk.video), flag("--res", pk.res))));
  },

  async voice() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen voice");
    const dir = P.abs(slug, "audio");
    const items = pickShots(sl).flatMap((s) => (s.dialogue || []).map((l, i) => ({ s, l, i })));
    const results = await pool(items, async ({ s, l, i }) => {
      const c = P.character(l.char);
      const text = `${l.tags ? l.tags + " " : ""}${l.text}`;
      const files = [await speak({ slug, c, lang: sl.lang || "en", text, outBase: path.join(dir, `${s.id}-${i + 1}`), label: `${s.id} line ${i + 1}` })];
      const dur = mediaDuration(files[0]);
      P.updateShotlist(slug, (x) => { const t = P.shot(x, s.id); t.dialogue[i].audio = P.rel(slug, files[0]); t.dialogue[i].seconds = dur; });
      return files;
    });
    report(results);
  },

  async video() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen video");
    const pk = pick(sl);
    const todo = pickShots(sl).filter((s) => has("--redo") || flag("--shots") || !s.clips?.length);
    const results = await pool(todo, (s) => renderShot(slug, sl, s, flag("--model", s.videoModel || pk.video), flag("--res", pk.res)));
    report(results);
  },

  async bakeoff() {
    const [slug, id] = pos;
    const sl = P.loadShotlist(slug);
    const s = P.shot(sl, id);
    requireStep(sl, "film", "gen bakeoff");
    const st = P.style(sl.style);
    const keys = (flag("--models") || (st.candidates?.video || ["wan3", "kling3"]).join(",")).split(",");
    const res = flag("--res", pick(sl).res);
    const est = keys.reduce((n, k) => n + getModel(k).cost({ res, duration: s.duration }), 0);
    console.error(`Bake-off on ${id}: ${keys.join(", ")} at ${res} ≈ ${est.toFixed(0)} cr (${usd(est)})`);
    report(await pool(keys, (k) => renderShot(slug, sl, s, k, res, { tag: "bakeoff" })));
  },

  async dub() {
    const [slug, id] = pos;
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen dub");
    const s = P.shot(sl, id);
    if (s.clip == null) throw new Error(`${id}: approve a clip first`);
    const lines = (s.dialogue || []).filter((l) => l.audio).map((l) => P.abs(slug, l.audio));
    if (!lines.length) throw new Error(`${id}: run "voice" first`);
    const joined = P.abs(slug, `audio/${id}-dub.mp3`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...lines.flatMap((f) => ["-i", f]), "-filter_complex", `concat=n=${lines.length}:v=0:a=1`, joined]);
    const clip = P.abs(slug, s.clips[s.clip].file);
    const outBase = nextName(P.abs(slug, "clips"), `${id}-dub`, ".mp4");
    const files = await job({ slug, modelKey: "lipsync", req: { video: await PV.upload(clip), audio: await PV.upload(joined), duration: mediaDuration(joined) }, outBase, label: `${id} dub`, ext: ".mp4" });
    P.updateShotlist(slug, (x) => { const t = P.shot(x, id); t.clips.push({ file: P.rel(slug, files[0]), model: "lipsync", dub: true }); });
    console.log(files[0]);
  },

  // Clips formats, board step: a shot's first or last frame with GPT Image 2.5, references from the cast's sheets.
  // A shot can instead open on the previous shot's last frame: set "frame": "@A:last" in the shotlist.
  // Launch films: --planned uses the frame prompt launch.mjs apply built from the plan and the style bible, and the
  // shot's environment key art (shot.refs) goes with it as a reference.
  async frame() {
    const [slug, id, which] = pos;
    const sl = P.loadShotlist(slug || "-");
    const s0 = sl.shots?.find((x) => x.id === id);
    const prompt = pos[3] || (has("--planned") ? (which === "last" ? s0?.lastPrompt : s0?.framePrompt) : null);
    if (!slug || !id || !["first", "last"].includes(which) || !prompt) throw new Error('usage: frame <slug> <shot> first|last "<prompt>" | --planned [--ref file]...');
    requireStep(sl, "board", "gen frame");
    const s = P.shot(sl, id);
    if (s.source === "card") throw new FlowStop(`${id} is a card: the editor draws it, it has no generated frame`);
    // Launch films (2026-10-22): no frame is paid for before the creator approved the storyboard animatic of this plan.
    if (sl.format === "launch" && has("--planned") && sl.launch?.animaticApproved?.plan !== planSha(sl)) throw new FlowStop(`${id}: el creador no ha aprobado el animatic de este plan (launch.mjs animatic ${slug} --approve --said "...")`);
    // chain "exact": the first frame IS the previous shot's drawn last frame (copied, free), so the cut disappears.
    const i0 = sl.shots.indexOf(s), prev = sl.shots[i0 - 1];
    if (sl.format === "launch" && which === "first" && s.chain === "exact") {
      if (!prev?.last) throw new FlowStop(`${id} empieza en el último cuadro de ${prev?.id}; dibuja primero ese cuadro (gen.mjs frame ${slug} ${prev?.id} last --planned)`);
      const out = nextName(P.abs(slug, "frames"), `${id}-first`, ".png");
      fs.copyFileSync(P.abs(slug, prev.last), out);
      P.updateShotlist(slug, (x) => { const t = P.shot(x, id); t.frame = P.rel(slug, out); t.firstPrompt = prompt; t.frameFrom = `${prev.id}:last`; });
      return console.log(`${out} (el último cuadro de ${prev.id}, sin costo)`);
    }
    // chain "same-set": drawn from the previous shot's frame with the same framing (GPT Image reframes unless told).
    const setRef = sl.format === "launch" && which === "first" && s.chain === "same-set" && (prev?.last || prev?.frame) ? [P.abs(slug, prev.last || prev.frame)] : [];
    const miss = missingMarks(prompt, s.characters || castOf(sl, prompt));
    if (miss.length) throw new FlowStop(`PROMPT STOP: the ${which} frame of ${id} leaves out ${miss.join("; ")}`);
    // Each character's sheet in the project's style first (cast.mjs sheet --style writes looks.<style>.sheet; 2026-10-21,
    // a launch film: only refs/sheets were read, so no storybook sheet reached the model and six frames drew strangers).
    // A last frame is drawn from the shot's own first frame, so it is the same scene at its end state.
    const stRefs = (() => { try { const st = P.style(sl.style); return (st.refs || []).map((f) => path.join(st.dir, f)); } catch { return []; } })(); // a style made from the creator's references
    const refs = await Promise.all([...setRef, ...(which === "last" && s.frame ? [P.abs(slug, s.frame)] : []), ...flags("--ref"), ...stRefs, ...(s.refs || []).map((f) => P.abs(slug, f)), ...(s.characters || []).flatMap((c) => { const ch = P.character(c); return [P.characterLook(ch, sl.style).modelSheet, P.characterLook(ch, sl.style).sheet, ...(ch.refs || []), ...(ch.sheets || [])].filter(Boolean).slice(0, 1).map((f) => path.join(ch.dir, f)); })].map(PV.asUrl));
    const sent = setRef.length ? `The same set as the first reference image, with exactly the same framing, camera position and zoom; every object stays where it is unless described: ${prompt}` : prompt;
    const [out] = await job({ slug, modelKey: "gpt2.5", req: { prompt: sent, refs, ar: sl.ar || "9:16", size: flag("--size", "2K") }, outBase: nextName(P.abs(slug, "frames"), `${id}-${which}`, ".png"), label: `${id} ${which} frame`, ext: ".png" });
    P.updateShotlist(slug, (x) => { const t = P.shot(x, id); t[which === "first" ? "frame" : "last"] = P.rel(slug, out); t[`${which}Prompt`] = prompt; });
    console.log(out);
  },

  // Clips formats, film step: one first/last-frame generation for a shot of the shotlist, through job()
  // (budget lock, prompt and dialogue checks, ledger, lock file). The prompt is P.clipPrompt: the shot's prompt plus
  // its script word for word. Then every eval runs on the take and is stored on it: identity (face and marks against
  // the locked anchor), jumps (cuts or snaps inside the shot), dialogue. The take is recorded before the evals run,
  // so a paid take is never lost when an eval can't run (the Kie judge can be down, 2026-10-19): `--eval <n>`
  // re-runs the evals on take n for free. A take that fails is never used by cut.mjs.
  async clip() {
    const slug = pos[0], id = flag("--shot");
    if (!slug || !id) throw new Error("usage: clip <slug> --shot <id> [--redo] [--eval <take n>] [--test --model <k> --said \"...\"]");
    await recover(slug);
    const sl = P.loadShotlist(slug);
    // --test: a motion test of one shot in a given model before the book (2026-10-21, a launch film v4: Kling failed the
    // same conveyor twice). Only with the creator's words and inside a budget they unlocked; the take is marked a test.
    const test = has("--test") && !flag("--eval");
    if (test && (!flag("--model") || !flag("--said"))) throw new FlowStop('clip --test needs --model <k> and --said "the creator exact words"');
    if (test) requireStep(sl, "board", "gen clip --test");
    else requireStep(sl, "film", "gen clip");
    if (kindOf(sl) !== "clips") throw new FlowStop(`gen clip is for clips formats; ${sl.format} films with ${kindOf(sl) === "scenes" ? "gen scenes" : "gen loops"}`);
    const s = P.shot(sl, id);
    if (s.source && s.source !== "generate") throw new FlowStop(`${id} is a ${s.source}: launch.mjs build draws it, nothing to film`);
    const cast = s.characters || castOf(sl, s.prompt);
    const model = test ? flag("--model") : s.model || sl.defaults?.videoModel || "veo";
    // A launch film never uses a take's own sound (voice-over, music and effects are mixed by launch.mjs).
    const silent = sl.format === "launch";
    // Its shots are choreographed to a drawn last frame: the video model must take one (any model that does).
    if (silent && !getModel(model).lastFrame) throw new FlowStop(`${model} no acepta cuadro final; un launch film necesita un modelo con cuadro inicial y final (studio.mjs prices los muestra)`);
    let n;
    if (flag("--eval")) {
      n = Number(flag("--eval"));
      if (!s.clips?.[n - 1]) throw new Error(`${id} has no take ${flag("--eval")}`);
    } else {
      if (!test) requirePilot(sl, [id]);
      if (!test && s.clip != null && takeOk(s.clips?.[s.clip]) && !has("--redo")) return console.log(`${id} already has a take that passes every eval (use --redo for another, inside the budget)`);
      let first = s.frame;
      const m = /^@(\w+):last$/.exec(first || "");
      if (m) {
        const prev = P.shot(sl, m[1]), t = prev.clips?.[prev.clip];
        if (!takeOk(t)) throw new FlowStop(`${id} opens on ${m[1]}'s last frame, and ${m[1]} has no passing take yet`);
        first = P.abs(slug, `frames/${id}-from-${m[1]}.png`);
        fs.mkdirSync(path.dirname(first), { recursive: true });
        lastFrame(P.abs(slug, t.file), first);
      } else first = P.abs(slug, first);
      const req = {
        prompt: P.clipPrompt(sl, s), lines: s.dialogue || [], cast, ar: sl.ar || "9:16", res: s.res || sl.defaults?.res || "720p", duration: test && flag("--secs") ? Number(flag("--secs")) : s.duration,
        frame: await PV.upload(first), lastFrame: s.last ? await PV.upload(P.abs(slug, s.last)) : undefined, ...(silent ? { sound: false } : {}),
      };
      const [out] = await job({ slug, modelKey: model, req, outBase: nextName(P.abs(slug, "clips"), `${id}-take`, ".mp4"), label: `${id} take`, ext: ".mp4" });
      console.log("filmed", P.rel(slug, out));
      P.updateShotlist(slug, (x) => {
        const t = P.shot(x, id);
        t.clips = [...(t.clips || []), { file: P.rel(slug, out), model, prompt: req.prompt, at: new Date().toISOString(), evals: null, ...(test ? { test: { said: flag("--said") } } : {}) }];
        n = t.clips.length;
      });
    }
    const file = P.abs(slug, P.shot(P.loadShotlist(slug), id).clips[n - 1].file);
    let evals;
    try {
      const identity = await identityCheck(file, cast);
      const jr = jumpCheck(file);
      const lines = (s.dialogue || []).filter((l) => !isVocal(l)).map((l, i) => ({ id: `${id}-${i + 1}`, text: l.text }));
      const dialogue = silent ? { pass: true, issues: [], note: "launch film: the take is silent; the voice-over is checked in the final QC" } : dialogueCheck(file, lines, sl.lang);
      evals = { identity: { pass: identity.pass, issues: identity.issues, notes: identity.notes }, jumps: { internal: jr.jumps.filter((j) => j.kind === "internal jump").length, list: jr.jumps, trimAt: jr.trimAt ?? null }, dialogue };
      console.log([
        identity.pass ? "IDENTITY PASS" : `IDENTITY FAIL\n - ${identity.issues.join("\n - ")}`,
        ...jumpLines(jr), evals.jumps.internal ? "JUMPS FAIL: an internal jump reads as a jump cut; the creator decides (studio.mjs override, or a reroll with his sí)" : "JUMPS PASS",
        dialogue.pass ? "DIALOGUE PASS" : `DIALOGUE FAIL\n - ${dialogue.issues.join("\n - ")}`,
      ].join("\n"));
    } catch (e) {
      evals = { error: e.message.slice(0, 300) };
      console.log(`EVALS DID NOT RUN on take ${n}: ${evals.error}\nThe paid take is kept. Re-run the evals for free: node engine/gen.mjs clip ${slug} --shot ${id} --eval ${n}`);
    }
    let ok = false;
    P.updateShotlist(slug, (x) => {
      const t = P.shot(x, id), take = t.clips[n - 1];
      take.evals = evals;
      ok = takeOk(take);
      if (ok && !take.test && (t.clip == null || !takeOk(t.clips[t.clip]))) t.clip = n - 1; // a motion test is never the chosen take
    });
    if (!evals.error) console.log(ok ? `${id}: take ${n} approved by the evals` : `${id}: take ${n} fails; one reroll fits only inside the locked budget, otherwise ask the creator`);
  },

  async talk() {
    const [image, audio, out] = pos;
    if (!out) throw new Error("usage: talk <image> <audio> <out.mp4>");
    const files = await job({ slug: flag("--project"), modelKey: flag("--model", "infinitetalk"), req: { frame: await PV.asUrl(image), audio: await PV.asUrl(audio), prompt: flag("--prompt"), res: flag("--res", "480p"), duration: mediaDuration(audio) }, outBase: out.replace(/\.mp4$/i, ""), label: path.basename(out), ext: ".mp4" });
    console.log(files[0]);
  },

  // Sound effects from shotlist "sfx": { name: { prompt, seconds } } -> audio/sfx-<name>.mp3.
  // Placed in the edit by "overlays": [{ sfx, shot, at, gainDb }] (see assemble.mjs).
  async sfx() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen sfx");
    const want = flag("--only");
    const items = Object.entries(sl.sfx || {}).filter(([n]) => (want ? want.split(",").includes(n) : !fs.existsSync(P.abs(slug, `audio/sfx-${n}.mp3`)) || has("--redo")));
    if (!items.length) return console.log("all sound effects exist (use --redo or --only name)");
    report(await pool(items, async ([name, s]) => {
      const out = await eleven.sfx({ text: s.prompt, seconds: s.seconds, out: P.abs(slug, `audio/sfx-${name}.mp3`) });
      P.ledger(slug, { ok: true, label: `sfx ${name}`, model: "elevenlabs-sfx", credits: 0, files: [path.relative(ROOT, out)] });
      return [out];
    }));
  },

  async music() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen music");
    if (!sl.music?.prompt) throw new Error("set music.prompt in shotlist.json");
    const total = sl.shots.reduce((n, s) => n + (s.duration || 5), 0);
    const files = await job({ slug, modelKey: "suno", req: { prompt: sl.music.prompt, title: sl.title, duration: total + 4 }, outBase: P.abs(slug, "audio/music"), label: "music", ext: ".mp3" });
    P.updateShotlist(slug, (x) => { x.music.files = files.map((f) => P.rel(slug, f)); x.music.pick ??= 0; });
    console.log(files.join("\n"));
  },

  // ---- Long-form (meditation, sleep, ambient): see engine/longform.mjs and the meditation-longform DNA.
  // Each scene: one GPT Image 2.5 still, then (unless motion is "kenburns") one clip whose first AND last frame
  // are that still, so it loops without a visible seam. Everything goes through job(), so the budget lock holds.
  async loops() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen loops");
    const L = sl.longform || {};
    const want = flag("--scenes")?.split(",");
    const todo = (L.scenes || []).filter((s) => (want ? want.includes(s.id) : !s.clip || has("--redo")));
    if (!todo.length) return console.log("every loop scene has its clip (use --scenes A,B or --redo)");
    const imgModel = L.imageModel || "gpt2.5", vidModel = L.videoModel || "sd2-mini", res = L.res || "720p";
    report(await pool(todo, async (sc) => {
      let still = sc.image && fs.existsSync(P.abs(slug, sc.image)) && !has("--new-image") ? P.abs(slug, sc.image) : null;
      if (!still) {
        const prompt = `${sc.picture}. ${L.look || ""} Wide ${sl.ar || "16:9"} composition, no people looking at camera, no text, no logos.`.trim();
        [still] = await job({ slug, modelKey: imgModel, req: { prompt, ar: sl.ar || "16:9", size: L.imageSize || "2K" }, outBase: nextName(P.abs(slug, "loops"), `${sc.id}-still`, ".png"), label: `${sc.id} still`, ext: ".png" });
        P.updateShotlist(slug, (x) => { x.longform.scenes.find((s) => s.id === sc.id).image = P.rel(slug, still); });
      }
      if (sc.motion === "kenburns") return [still];
      const url = await PV.upload(still);
      // First frame only: asked for the same first and last frame, Kling returned a frozen picture (2026-10-20,
      // Midnight Lake, motion 0.09). The seam is hidden by longform.mjs, which cross-fades the tail into the head.
      const prompt = `${sc.motion}. Clearly visible, slow, continuous ambient motion through the whole clip, from the first second to the last; the camera stays still; nothing enters or leaves the frame; no cuts.`;
      const [clip] = await job({ slug, modelKey: vidModel, req: { prompt, frame: url, ar: sl.ar || "16:9", res, duration: sc.seconds || 8, sound: false }, outBase: nextName(P.abs(slug, "loops"), `${sc.id}-loop`, ".mp4"), label: `${sc.id} loop`, ext: ".mp4" });
      const motion = motionScore(clip);
      console.log(motion < MIN_MOTION ? `LOOP STATIC: ${sc.id} moves ${motion} (minimum ${MIN_MOTION}); it reads as a still picture, the build refuses it` : `${sc.id} loop motion ${motion}: pass`);
      P.updateShotlist(slug, (x) => { const s = x.longform.scenes.find((y) => y.id === sc.id); s.clip = P.rel(slug, clip); s.motionScore = motion; });
      return [still, clip];
    }));
    console.log(`\nNext: node engine/longform.mjs build ${slug} --draft`);
  },

  // Music bed: Suno instrumental, `music.tracks` generations (each returns two takes), chained by longform.mjs.
  async bed() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen bed");
    const M = sl.longform?.music;
    if (!M?.prompt) throw new Error("set longform.music.prompt in shotlist.json");
    const n = Number(flag("--n", M.tracks || 2));
    const have = (M.files || []).length;
    if (have >= n * 2 && !has("--more")) return console.log(`${have} music takes already (use --more for another generation)`);
    const runs = Array.from({ length: has("--more") ? 1 : Math.max(1, n - Math.floor(have / 2)) }, (_, k) => k);
    report(await pool(runs, async () => {
      const files = await job({ slug, modelKey: "suno", req: { prompt: M.prompt, title: sl.title, duration: 240 }, outBase: nextName(P.abs(slug, "audio"), "music", ".mp3"), label: "music bed", ext: ".mp3" });
      P.updateShotlist(slug, (x) => { x.longform.music.files = [...(x.longform.music.files || []), ...files.map((f) => P.rel(slug, f))]; });
      return files;
    }));
  },

  // Narration: one ElevenLabs file per script segment (billed in ElevenLabs characters, not Kie credits).
  async narration() {
    const slug = pos[0];
    const sl = P.loadShotlist(slug);
    requireStep(sl, "film", "gen narration");
    const L = sl.longform || {};
    const V = L.voice || {};
    if (!V.eleven) throw new Error("set longform.voice.eleven (an ElevenLabs voice id) in shotlist.json");
    const segs = (L.script || []).map((s, i) => ({ ...s, i, out: P.abs(slug, `audio/vo/${String(i + 1).padStart(3, "0")}.mp3`) }));
    const todo = segs.filter((s) => s.text?.trim() && (!fs.existsSync(s.out) || has("--redo")));
    const chars = todo.reduce((n, s) => n + s.text.length, 0);
    if (!todo.length) return console.log("all narration segments exist (use --redo)");
    console.log(`→ narration: ${todo.length} segments, ${chars} ElevenLabs characters`);
    const settings = V.settings || { stability: 0.75, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 0.9 };
    report(await pool(todo, async (s) => {
      // "..." in a meditation script is a breath inside the line: ElevenLabs v2 ignores it, so it becomes a real
      // break (2026-10-20, Midnight Lake: the narration ran 167 wpm on a sleep piece that asks for 80-100).
      const spoken = (V.model || "eleven_multilingual_v2") === "eleven_v3" ? s.text : s.text.replace(/\s*(\.\.\.|…)\s*/g, `... <break time="${V.breath ?? (L.intent === "sleep" ? 1.3 : 0.8)}s" /> `).trim();
      await eleven.tts({ text: spoken, voice: V.eleven, model: V.model || "eleven_multilingual_v2", settings, seed: V.seed ?? null, out: s.out });
      P.ledger(slug, { ok: true, label: `narration ${s.i + 1}`, model: "elevenlabs-direct", credits: 0, chars: s.text.length, files: [path.relative(ROOT, s.out)] });
      return [s.out];
    }));
  },

  // Board "reroll" requests: { stage: "frame"|"video", note, model?, res? }
  async queue() {
    const slug = pos[0];
    await recover(slug);
    const sl = P.loadShotlist(slug);
    const q = [...sl.shots, ...(sl.scenes || [])].filter((s) => s.queue?.length);
    if (!q.length) return console.log("queue empty");
    for (const s of q) {
      for (const item of s.queue) {
        s.queueNote = item.note;
        const pk = pick(sl);
        if (s.shots && item.stage === "frame") { argv.push("--scenes", s.id, "--note", item.note || ""); await commands.storyboard(); argv.splice(-4); continue; }
        if (s.shots) { await renderScene(slug, P.loadShotlist(slug), { ...P.scene(P.loadShotlist(slug), s.id), queueNote: item.note }, item.model || s.videoModel || pk.video, item.res || pk.res); continue; }
        if (item.stage === "frame") await renderFrames(slug, sl, [s], 1, item.model || pk.image, { size: pk.imageSize, withBoard: true });
        else await renderShot(slug, P.loadShotlist(slug), { ...P.shot(P.loadShotlist(slug), s.id), queueNote: item.note }, item.model || s.videoModel || pk.video, item.res || pk.res);
      }
      P.updateShotlist(slug, (x) => { P.findItem(x, s.id).queue = []; });
    }
  },
};

// Split a storyboard grid into vertical 9:16 panels (gutters trimmed, centre-cropped).
function splitGrid(file, cols, rows, n, dir, base) {
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",").map(Number);
  const cw = Math.floor(w / cols), ch = Math.floor(h / rows), inset = Math.round(Math.min(cw, ch) * 0.02);
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = (k % cols) * cw + inset, y = Math.floor(k / cols) * ch + inset;
    const f = path.join(dir, `${base}-p${k + 1}.png`);
    // Cut the cell, then trim any uniform border the model drew (margins, frame lines, gutters).
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", `crop=${cw - 2 * inset}:${ch - 2 * inset}:${x}:${y}`, f]);
    execFileSync("python", [path.join(ROOT, "engine", "lib", "trim_panel.py"), f, f]);
    out.push(f);
  }
  return out;
}

// Voice references for Wan: up to 3 speakers, combined length under 15s.
function voiceRefFiles(sl, speakers, slug) {
  const lang = sl.lang || "en";
  // The series voice profile's official sample wins over the bible's, so the video model hears the same voice every episode.
  const found = speakers.map((id) => { const c = P.character(id); const sp = voiceProfile(sl, id).sample; const f = sp && fs.existsSync(sp) ? sp : c.voice?.sample?.[lang] && path.join(c.dir, c.voice.sample[lang]); return f && fs.existsSync(f) ? { char: id, file: f } : null; }).filter(Boolean).slice(0, 3);
  // A voice reference must never speak the script: Wan repeats what it hears (2026-10-20, a past drama scene B: the patient's
  // sample said "I know... You will. You're the father." and the take said those lines instead of the doctor's).
  // The sample is transcribed once (cached next to it) and checked against every line of the project.
  const norm = (t) => ` ${String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const scriptLines = sl.shots.flatMap((s) => (s.dialogue || []).map((l) => l.text)).filter((t) => t.trim().split(/\s+/).length >= 2);
  for (const v of found) {
    const txt = v.file + ".transcript.txt";
    if (!fs.existsSync(txt) || fs.statSync(txt).mtimeMs < fs.statSync(v.file).mtimeMs) {
      const py = "import sys; from faster_whisper import WhisperModel; m = WhisperModel('base', device='cpu', compute_type='int8'); print(' '.join(s.text for s in m.transcribe(sys.argv[1], language=sys.argv[2])[0]))";
      const r = spawnSync("python", ["-c", py, v.file, lang], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`VOICE REF STOP: no pude transcribir la muestra de ${v.char} para revisar que no diga el guion`);
      fs.writeFileSync(txt, r.stdout.trim());
    }
    const heard = norm(fs.readFileSync(txt, "utf8"));
    const said = scriptLines.find((t) => heard.includes(norm(t)));
    if (said) throw new Error(`VOICE REF STOP: la muestra de voz de ${P.character(v.char).name} dice la línea del guion "${said}"; el modelo la repetiría. Rehaz la muestra con texto neutro: node engine/gen.mjs sample ${v.char} --text "..."`);
  }
  const each = found.length ? Math.floor((14 / found.length) * 10) / 10 : 0;
  return found.map((v) => {
    const out = P.abs(slug, `audio/voice-ref-${v.char}-${lang}.mp3`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", v.file, "-t", String(Math.max(2, each)), out]);
    return { ...v, file: out };
  });
}

const shotGenSecs = P.shotGenSecs;

async function renderSceneByShots(slug, sl, sc, modelKey, res) {
  const shots = P.sceneShots(sl, sc), dir = P.abs(slug, "clips");
  fs.mkdirSync(path.join(dir, "shots"), { recursive: true });
  const files = [];
  for (const s of shots) {
    const panel = s.board?.file;
    if (!panel) throw new Error(`${s.id}: no storyboard panel; run storyboard first`);
    // The shot's own structured spec, built exactly like a scene prompt of one shot (place, pose, props, must-nots).
    const prompt = P.shotPrompt(sl, sc, s, getModel(modelKey).maxPrompt || 4000);
    const duration = shotGenSecs(s, modelKey);
    const outBase = nextName(path.join(dir, "shots"), `${s.id}-${modelKey}`, ".mp4");
    const [f] = await job({ slug, modelKey, req: { prompt, lines: s.dialogue || [], cast: P.sceneCast(sl, sc), frame: await PV.upload(P.abs(slug, panel)), res, ar: sl.ar, duration, sound: true }, outBase, label: `${s.id} ${modelKey} ${res} ${duration}s`, ext: ".mp4" });
    files.push(f);
  }
  // Join the shots into one scene take (same size, fps and audio), registered like a multi-shot take.
  const out = nextName(dir, `${sc.id}-${modelKey}`, ".mp4") + ".mp4";
  const [W, H] = sl.ar === "16:9" ? [1280, 720] : [720, 1280];
  const graph = files.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,setsar=1,format=yuv420p[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(";") + ";" + files.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${files.length}:v=1:a=1[v][a]`;
  execFileSync("ffmpeg", ["-v", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-c:a", "aac", "-b:a", "192k", out]);
  const plate = path.basename(P.sceneRefs(sl, sc).find((r) => r.role === "set")?.file || "");
  P.updateShotlist(slug, (x) => { const t = (x.scenes || []).find((y) => y.id === sc.id); t.clips = [...(t.clips || []), { file: P.rel(slug, out), model: modelKey, res, scene: true, byShot: true, shots: files.map((f) => P.rel(slug, f)), plate }]; });
  return [out];
}

async function renderScene(slug, sl, sc, modelKey, res) {
  const shots = P.sceneShots(sl, sc);
  const first = shots[0].board?.file;
  if (!first) throw new Error(`${sc.id}: no storyboard panel for ${shots[0].id}; run storyboard first`);
  const refs = P.sceneRefs(sl, sc);
  const frame = await PV.upload(P.abs(slug, first));
  const refUrls = await Promise.all(refs.map((r) => PV.asUrl(r.file)));
  const speakers = [...new Set(shots.flatMap((s) => (s.dialogue || []).map((l) => l.char)))];
  const samples = voiceRefFiles(sl, speakers, slug);
  const refAudio = await Promise.all(samples.map((v) => PV.upload(v.file)));
  let prompt = P.scenePrompt(sl, sc, refs, { voiceRefs: samples.map((v) => v.char) });
  if (sc.queueNote) prompt += `\nDirector's note: ${sc.queueNote}`;
  const duration = P.sceneSecs(shots);
  const dir = P.abs(slug, "clips");
  fs.mkdirSync(dir, { recursive: true });
  const outBase = nextName(dir, `${sc.id}-${modelKey}`, ".mp4");
  fs.writeFileSync(outBase + ".lock", "");
  return job({ slug, modelKey, req: { prompt, lines: shots.flatMap((s) => s.dialogue || []), frame, refs: refUrls, refAudio, res, ar: sl.ar, duration, sound: true }, outBase, label: `scene ${sc.id} ${modelKey} ${res} ${duration}s`, ext: ".mp4",
    // The set plate used is stamped on the take: edit.mjs refuses to cut together takes filmed against different plates.
    register: { shot: sc.id, stage: "clips", entry: { model: modelKey, res, prompt, scene: true, plate: path.basename(refs.find((r) => r.role === "set")?.file || "") } } });
}

async function renderFrames(slug, sl, shots, n, modelKey, { size = "1K", withBoard = false } = {}) {
  const dir = P.abs(slug, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const refCache = {};
  return pool(shots.flatMap((s) => Array.from({ length: n }, () => s)), async (s) => {
    refCache[s.id] ??= Promise.all(P.shotRefs(sl, s, { withBoard }).map(PV.asUrl));
    const refs = await refCache[s.id];
    const note = s.queueNote ? ` Director's note: ${s.queueNote}` : "";
    const outBase = nextName(dir, s.id, ".png");
    fs.writeFileSync(outBase + ".lock", ""); // reserve the name; job() fills in the task id
    return job({ slug, modelKey, req: { prompt: P.imagePrompt(sl, s, { withBoard }) + note, refs, ar: sl.ar, size }, outBase, label: `${s.id} frame`, ext: ".png",
      register: { shot: s.id, stage: "frames", entry: { model: modelKey } } });
  });
}

async function renderShot(slug, sl, s, modelKey, res, { tag } = {}) {
  const m = getModel(modelKey);
  const fi = s.frame ?? null;
  if (fi == null || !s.frames?.[fi]) throw new Error(`${s.id}: approve a frame on the board first`);
  // QC gate (checkpoint 2): no video money is spent on a keyframe that hasn't passed review.
  if (!s.frames[fi].qc?.pass) {
    throw new Error(`${s.id}: keyframe ${fi} hasn't passed QC. Run: node engine/qc.mjs frames ${slug} --shots ${s.id}`);
  }
  const frame = await PV.upload(P.abs(slug, s.frames[fi].file));
  const seedance = modelKey.startsWith("sd2") || modelKey.startsWith("wan3");
  const samples = s.audioMode === "native" && m.refAudio ? P.voiceSamples(sl, s) : [];
  const refs = seedance && !s.strictFrame ? await Promise.all(P.shotRefs(sl, s).slice(0, 8).map(PV.asUrl)) : [];
  const refAudio = await Promise.all(samples.map((v) => PV.upload(v.file)));
  const refMode = seedance && (refs.length > 0 || refAudio.length > 0);
  let prompt = P.motionPrompt(sl, s, { voiceRefs: samples.map((v) => v.char), refMode });
  if (s.queueNote) prompt += ` Director's note: ${s.queueNote}`;
  // End-frame lock: pinning the last frame stops the model from wandering into an invented room.
  const lastFrame = s.endFrame ? await PV.upload(P.abs(slug, s.endFrame)) : undefined;
  const req = { prompt, lines: s.dialogue || [], frame, lastFrame, refs: lastFrame ? [] : refs, refAudio: lastFrame ? [] : refAudio, res, ar: sl.ar, duration: s.duration, sound: s.audioMode !== "silent" };
  const dir = P.abs(slug, "clips");
  fs.mkdirSync(dir, { recursive: true });
  const outBase = nextName(dir, `${s.id}${tag ? "-" + tag : ""}-${modelKey}`, ".mp4");
  fs.writeFileSync(outBase + ".lock", "");
  return job({ slug, modelKey, req, outBase, label: `${s.id} ${modelKey} ${res}`, ext: ".mp4",
    register: { shot: s.id, stage: "clips", entry: { model: modelKey, res, prompt, ...(tag ? { tag } : {}) } } });
}

function report(results) {
  const errs = results.filter((r) => r?.error);
  results.filter((r) => !r?.error).flat().forEach((f) => console.log(f));
  errs.forEach((e) => console.error("ERROR:", e.error));
  if (errs.length) process.exitCode = 1;
}

try {
  if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 18).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
  await commands[cmd]();
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
