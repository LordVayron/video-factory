#!/usr/bin/env node
// AI Video Factory: generation CLI. Every paid job is written to the project's ledger.json.
//
//   node engine/gen.mjs credits                      balance of each provider (APIMart, Kie) in USD
//   node engine/gen.mjs prices [filter]              refresh live prices of both providers; who is cheaper per model
//   node engine/gen.mjs models                       list model keys with tier and use
//   node engine/gen.mjs estimate <slug>              cost of what is still to generate
//   node engine/gen.mjs still "<prompt>" <out.png> [--model gpt2.5] [--ref f]... [--ar 9:16] [--size 1K]
//   node engine/gen.mjs transfer --video <clip> (--char <id> --style <id> | --image <img>) --model <k> [--swap "<what>" [--with <img>]] [--stabilize] [--lipsync] [--res 720p] [--out f.mp4] [--project <slug>]   motion transfer / object swap (video to video), measured
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
import * as CAM from "./lib/camera.mjs";
import { MODELS, getModel, usd } from "./lib/models.mjs";
import * as P from "./lib/project.mjs";
import { missingMarks, castOf, identityCheck } from "./lib/identity.mjs";
import { jumpCheck, jumpLines } from "./lib/jumps.mjs";
import * as TR from "./lib/transfer.mjs";
import { evalFrame } from "./lib/frameeval.mjs";
import { freezeProblem, engineSha } from "./lib/freeze.mjs";
import * as MS from "./lib/modelsheet.mjs";
import { voiceProfile } from "./lib/voices.mjs";
import { motionScore, MIN_MOTION } from "./lib/meditation.mjs";
// Motion band per format for takes with people (mean frame difference at 320 px): below the floor a take reads frozen
// or slow, above the ceiling it shakes or morphs. Launch films act big; talking formats stay calm.
const MOTION_BAND = { launch: [1.5, 7], fantasy: [0.8, 7], cinematic: [0.3, 7], influencer: [0.3, 2], podcast: [0.3, 2], ugc: [0.3, 2.5] };
const motionBand = (sl) => MOTION_BAND[sl.format] || [0.3, 7];
import * as eleven from "./lib/eleven.mjs";
import { requireStep, requirePilot, assertV5, takeOk, evalsPass, kindOf, FlowStop, planSha } from "./lib/flow.mjs";
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
// audio runs past the video (a fixed -sseof -0.05 landed after the last frame and wrote nothing).
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
// an empty lock means "a task may be in flight" to recover() (two stale locks after a budget stop).
// Credits all motion tests of a project may spend before the Production Book is approved (1 credit = $0.005).
const TEST_CAP = 200;

async function job(args) {
  try { return await jobRun(args); } catch (e) {
    const lock = `${args.outBase}.lock`;
    if (/STOP/.test(e.message) && fs.existsSync(lock) && fs.statSync(lock).size === 0) fs.unlinkSync(lock);
    throw e;
  } finally {
    fs.rmSync(`${args.outBase}.reserve`, { force: true });
  }
}

// A model with a prompt limit gets the clip prompt without the set map (the first and last frames already fix the
// layout); the action, acting, end state and character marks always stay.
function fitPrompt(prompt, m) {
  if (!m?.maxPrompt || prompt.length <= m.maxPrompt) return prompt;
  return prompt.replace(/Fixed set map of [^]*?(?=(Acting:|The shot ends|Camera:))/g, "").replace(/\s+/g, " ").trim();
}

// Live balances, read at most once a minute per process.
let balCache = null;
async function balancesCached() {
  if (!balCache || Date.now() - balCache.at > 60000) balCache = { at: Date.now(), v: await PV.balances().catch(() => ({})) };
  return balCache.v;
}

async function jobRun({ slug, modelKey, req, outBase, label, ext, register, test = false }) {
  const m = getModel(modelKey);
  let caps = () => {}, others = 0, claimFile = null;
  // PROVIDERS: cost() is the cheapest provider's live price (APIMart first, Kie second); the job goes there.
  let credits = m.cost(req);
  // BUDGET GUARD. Once the Production Book is
  // approved, its estimate is the hard ceiling. Any job that would push the project's spend past it is refused;
  // rerolls need a new approval: node engine/phase.mjs budget <slug> --add <credits> --note "approved by the creator".
  // Jobs in flight count against the cap too: pool() runs 4 at once, and without this every one of them
  // would see the same "spent" before any of them reached the ledger.
  // Jobs of other processes count too (several gen.mjs runs at once): each job holds a claim file while it runs,
  // and the check plus the claim happen under one project mutex, so two processes can't both pass the same cap.
  if (slug) { const unlock = await budgetMutex(slug); try {
    others = othersInFlight(slug);
    const sl0 = P.loadShotlist(slug);
    assertV5(sl0);
    const frozen = freezeProblem(sl0, { stamp: (sha) => P.updateShotlist(slug, (x) => { x.engine = { sha, at: new Date().toISOString() }; }) });
    if (frozen) throw new FlowStop(frozen);
    // ATTEMPT STOP (every format): the same asset paid a third time, or a production redoing more than it makes,
    // waits for the creator's yes (--said). Unbounded retries turned 20 frames into 148.
    if (!test) {
      const since = sl0.remake?.at || sl0.flow?.created || "";
      const runs = P.readJSON(path.join(P.PROJECTS, slug, "ledger.json"), []).filter((e) => e.ok && !e.test && (e.at || "") > since);
      const same = runs.filter((e) => e.label === label).length, assets = new Set(runs.map((e) => e.label)).size;
      if (same >= 2 && !has("--said")) throw new FlowStop(`ATTEMPT STOP: "${label}" was already paid ${same} times. Find why it fails before paying again; a third attempt needs the creator's yes (--said "...").`);
      if (same >= 1 && runs.length >= 10 && runs.length > 2 * assets && !has("--said")) throw new FlowStop(`REWORK STOP: ${runs.length} paid jobs for ${assets} assets in this production (more than two per asset). Stop and report to the creator what keeps failing; continue only with their yes (--said "...").`);
    }
    // HARD CAP: an intake with a fixed budget caps
    // every paid job of the project, images and sheets included, before and after the book.
    const hard = sl0.intake?.budget?.mode === "fixed" && sl0.intake.budget.usd ? sl0.intake.budget.usd / 0.005 : null;
    const cap = sl0.budget?.approvedCredits;
    // A motion test comes before the book (the book needs it), so it can't wait for the book's budget: with the
    // creator's words (clip --test --said) tests get their own small allowance, TEST_CAP credits for all of them.
    const testSpent = () => P.readJSON(path.join(P.PROJECTS, slug, "ledger.json"), []).reduce((n, e) => n + (e.ok && e.test ? e.credits || 0 : 0), 0);
    if (cap == null && !["image", "voice"].includes(m.kind) && !test) throw new FlowStop(`BUDGET STOP: "${label}" (${m.label}) needs the budget that approving the Production Book locks.`);
    // Checked again at the new price when a job moves from APIMart to Kie.
    caps = (cr, held = 0) => {
      if (hard != null && P.ledgerTotal(slug) + (inFlight.get(slug) || 0) + others - held + cr > hard + 0.01) throw new FlowStop(`BUDGET STOP: "${label}" would pass the project's hard cap of ${sl0.intake.budget.usd} (spent ${(P.ledgerTotal(slug) * 0.005).toFixed(2)}).`);
      // sl.testCap { usd, said }: the creator can raise this project's test allowance in their own words.
      const tcap = sl0.testCap?.said && sl0.testCap?.usd ? sl0.testCap.usd / 0.005 : TEST_CAP;
      if (cap == null && test && testSpent() + (inFlight.get(slug) || 0) + others - held + cr > tcap + 0.01) throw new FlowStop(`BUDGET STOP: "${label}" would pass the ${(tcap * 0.005).toFixed(2)} USD allowed for motion tests before the book (spent ${(testSpent() * 0.005).toFixed(2)}).`);
      if (cap != null) {
        const spent = P.ledgerTotal(slug) + (inFlight.get(slug) || 0) + others - held;
        if (spent + cr > cap + 0.5) throw new Error(`BUDGET STOP: "${label}" costs ${cr.toFixed(1)} cr; spent or in flight ${spent.toFixed(1)} of the ${cap} cr the creator approved. Ask the creator before spending more (phase.mjs budget ${slug} --add N).`);
      }
    };
    caps(credits);
    // REPLAN STOP: once a book was approved, a changed plan spends nothing (not even an image) until the creator saw the
    // new live prices and estimate and approved them for this exact plan (studio.mjs approve-replan).
    // REMAKE STOP: a remake spends nothing until the model analysis ran again and the creator approved its estimate.
    if (sl0.remake && !test && !(sl0.priceCheck?.at > sl0.remake.at && sl0.replanApproved?.at > sl0.remake.at)) throw new FlowStop(`REMAKE STOP: remake v${sl0.remake.n} runs the model analysis and gets the estimate approved before any paid job (studio.mjs prices ${slug}, gen.mjs estimate ${slug}, studio.mjs approve-replan ${slug} --usd N --said "...").`);
    if (sl0.format === "launch" && sl0.flow?.approved?.book && !test) {
      const cur = planSha(sl0), booked = sl0.bookPlan;
      if (booked && booked !== cur && sl0.replanApproved?.plan !== cur) throw new FlowStop(`REPLAN STOP: the plan changed after the approved Production Book. Run studio.mjs prices ${slug}, show the creator the new estimate (gen.mjs estimate ${slug}) and record their yes (studio.mjs approve-replan ${slug} --usd N --said "...") before any paid job.`);
    }
    // BALANCE STOP: the providers' live balance must cover the job before it is sent; an empty wallet is reported,
    // never discovered by burning the last credits.
    if (!process.env.FACTORY_OFFLINE) {
      const bal = await balancesCached();
      const usdNeed = credits * 0.005, have = Math.max(...Object.values(bal).map((v) => (typeof v === "number" ? v : 0)), 0);
      if (have < usdNeed) throw new FlowStop(`BALANCE STOP: "${label}" costs about $${usdNeed.toFixed(2)} and the providers hold $${have.toFixed(2)}. Tell the creator; nothing was spent.`);
    }
    // PROMPT TOO LONG: a model with a prompt limit (Kling 3.0: 2,500 characters) is never sent a longer prompt.
    if (m.maxPrompt && typeof req.prompt === "string" && req.prompt.length > m.maxPrompt) throw new FlowStop(`PROMPT STOP: "${label}" is ${req.prompt.length} characters; ${m.label} takes ${m.maxPrompt}.`);
    // DIALOGUE STOP (a clip prompt without the lines lets the model improvise a paid take).
    // Every speaking video job declares its script lines (req.lines) and its prompt must carry each one word for word.
    if (m.kind === "video" && m.speaks && req.sound !== false) {
      if (!Array.isArray(req.lines)) throw new FlowStop(`DIALOGUE STOP: "${label}" doesn't declare its script lines (req.lines); every speaking video job must.`);
      const gone = P.linesMissing(req.prompt, req.lines);
      if (gone.length) throw new FlowStop(`DIALOGUE STOP: the prompt of "${label}" leaves out ${gone.map((l) => `"${l.text}"`).join("; ")}. The script goes to the model word for word.`);
    }
    // PROMPT CHECK: a video prompt must carry every distinctive mark of the
    // characters in it (freckles, mole, glasses...). A model only keeps what the prompt says.
    if (m.kind === "video" && req.prompt && !req.allowMissingMarks) {
      const miss = missingMarks(req.prompt, req.cast || castOf(sl0, req.prompt));
      if (miss.length) throw new Error(`PROMPT STOP: "${label}" leaves out ${miss.join("; ")}. Put the marks from the character's look in the prompt.`);
    }
    inFlight.set(slug, (inFlight.get(slug) || 0) + credits);
    claimFile = writeClaim(slug, credits);
  } finally { unlock(); } }
  process.stderr.write(`→ ${label}: ${m.label} ~${credits.toFixed(1)} cr (${usd(credits)})
`);
  const lock = outBase + ".lock";
  // Measured wall time per job: time estimates come from it, never from a guess.
  const t0 = Date.now();
  let taskId = null, keepLock = false, provider = null;
  try {
    const sent = await PV.submitBest(modelKey, req, {
      onSwitch: (o) => {
        caps(o.credits, credits);
        if (slug) inFlight.set(slug, (inFlight.get(slug) || 0) - credits + o.credits);
        credits = o.credits;
        if (claimFile) fs.writeFileSync(claimFile, JSON.stringify({ pid: process.pid, credits, at: Date.now() }));
        process.stderr.write(`  → ${o.provider} ~${credits.toFixed(1)} cr (${usd(credits)})
`);
      },
    });
    ({ taskId, provider } = sent);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, taskId, provider, slug, modelKey, credits, label, outBase: path.relative(ROOT, outBase), ext, register, ...(test ? { test: true } : {}) }));
    const { urls, usd: charged } = await PV.wait(provider, taskId, { label });
    try {
      // The ledger keeps what the provider says it charged when it says (APIMart does), else the estimate.
      return await finish({ secs: Math.round((Date.now() - t0) / 1000), slug, modelKey, credits: charged != null ? charged / 0.005 : credits, label, outBase, ext, register, taskId, urls, provider, test });
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
    if (claimFile) fs.rmSync(claimFile, { force: true });
  }
}
const inFlight = new Map();

// Cross-process budget claims: projects/<slug>/.inflight/<pid>-<n>.json while a paid job runs. A claim of a dead
// process is dropped; a task that timed out keeps its .lock, which counts until recover() collects it.
const inflightDir = (slug) => path.join(P.PROJECTS, slug, ".inflight");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function budgetMutex(slug) {
  fs.mkdirSync(inflightDir(slug), { recursive: true });
  const mx = path.join(inflightDir(slug), "mutex");
  for (let t = 0; ; t++) {
    try { fs.writeFileSync(mx, String(process.pid), { flag: "wx" }); return () => fs.rmSync(mx, { force: true }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    try { const owner = +fs.readFileSync(mx, "utf8"); if (!alive(owner) || Date.now() - fs.statSync(mx).mtimeMs > 60e3) fs.rmSync(mx, { force: true }); } catch {}
    if (t > 600) throw new Error(`budget mutex of ${slug} is held; nothing was spent`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
function othersInFlight(slug) {
  let n = 0;
  for (const f of fs.readdirSync(inflightDir(slug)).filter((x) => x.endsWith(".json"))) {
    const file = path.join(inflightDir(slug), f);
    try { const c = JSON.parse(fs.readFileSync(file, "utf8")); if (c.pid === process.pid) continue; if (!alive(c.pid)) { fs.rmSync(file, { force: true }); continue; } n += c.credits || 0; } catch {}
  }
  for (const sub of ["frames", "clips", "audio"]) {
    const dir = P.abs(slug, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".lock"))) {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8") || "null"); if (j?.taskId && j.pid !== process.pid && !(j.pid && alive(j.pid))) n += j.credits || 0; } catch {}
    }
  }
  return n;
}
let claimN = 0;
function writeClaim(slug, credits) {
  const f = path.join(inflightDir(slug), `${process.pid}-${claimN++}.json`);
  fs.writeFileSync(f, JSON.stringify({ pid: process.pid, credits, at: Date.now() }));
  return f;
}

// Some models return extras (Suno returns cover art next to the audio): keep only the asked-for kind.
const KIND = { ".mp3": /\.(mp3|wav|m4a|ogg)(\?|$)/i, ".mp4": /\.(mp4|mov)(\?|$)/i, ".png": /\.(png|jpe?g|webp)(\?|$)/i };

async function finish({ slug, modelKey, credits, label, outBase, ext, register, taskId, urls, provider = "kie", test = false, secs }) {
  // APIMart links may carry no extension: filter by kind only when that keeps something.
  if (ext && KIND[ext]) { const k = urls.filter((u) => KIND[ext].test(new URL(u).pathname)); if (k.length) urls = k; else urls = urls.slice(0, 1); }
  const files = [];
  for (let k = 0; k < urls.length; k++) {
    const e = ext || path.extname(new URL(urls[k]).pathname) || ".bin";
    const f = urls.length > 1 ? `${outBase}-${k + 1}${e}` : `${outBase}${e}`;
    await PV.download(urls[k], f);
    files.push(f);
  }
  P.ledger(slug, { ok: true, label, model: modelKey, provider, credits: +(+credits).toFixed(2), taskId, ...(secs ? { secs } : {}), ...(test ? { test: true } : {}), files: files.map((f) => path.relative(ROOT, f)) });
  if (register) {
    P.updateShotlist(slug, (x) => {
      const t = P.findItem(x, register.shot);
      t[register.stage] = [...(t[register.stage] || []), ...files.map((f) => ({ file: P.rel(slug, f), ...register.entry }))];
    });
  }
  return files;
}

// Launch frames: judged against the set map, the props/set sheets, the anchor frame and the character sheets.
// The result is stored on the shot; the board step refuses a failed or unjudged frame.
async function frameEvalOf(slug, id, which) {
  const sl = P.loadShotlist(slug), s = P.shot(sl, id), f = which === "first" ? s.frame : s.last;
  if (!f || /^@/.test(f)) throw new FlowStop(`${id} has no ${which} frame to judge`);
  const bible = P.readJSON(path.join(P.projectDir(slug), "launch", "style-bible.json"), {}) || {}; // clips formats have no set bible: faces and physics only
  const envs = (bible.environments || []).filter((e) => (s.refs || []).includes(e.ref) || (s.refs || []).includes(e.anchor));
  // The judge sees each item in the state it has in this frame (the set map's timeline), not its opening state.
  const now = s.mapState?.[which] || {};
  const maps = envs.filter((e) => e.map).map((e) => e.map).filter((m, i, all) => all.indexOf(m) === i)
    .map((m) => ({ ...m, items: m.items.map(({ changes, ...i }) => ({ ...i, ...(now[i.name] ? { state: now[i.name] } : {}) })) }));
  const cast = (s.characters || []).map((c) => P.character(c));
  const refs = [
    ...cast.map((c) => ({ label: `character sheet of ${c.name}`, file: path.join(c.dir, P.characterLook(c, sl.style)?.modelSheet || "") })),
    ...envs.flatMap((e) => [e.anchor && { label: `anchor frame of ${e.name} (the layout and orientation every frame keeps)`, file: P.abs(slug, e.anchor) }, e.ref && { label: `sheet of ${e.name}`, file: P.abs(slug, e.ref) }]).filter(Boolean),
  ].filter((r, i, all) => all.findIndex((x) => x.file === r.file) === i);
  const expect = which === "first" ? s.firstPrompt || s.framePrompt : s.lastUsedPrompt || s.lastPrompt;
  const ev = await evalFrame({ frame: P.abs(slug, f), refs, maps, cast: cast.map((c) => ({ name: c.name, look: c.look })), expect: (expect || "").slice(0, 1500) });
  P.updateShotlist(slug, (x) => {
    const t = P.shot(x, id);
    t[`${which}Eval`] = { file: f, pass: ev.pass, fails: ev.fails, summary: ev.summary, model: ev.model, at: new Date().toISOString() };
    // Notes of why a frame failed feed the next attempt; a pass clears them.
    t.frameNotes = ev.pass ? (t.frameNotes || []).filter((n) => n.which !== which) : [...(t.frameNotes || []), { which, file: f, fails: ev.fails }];
  });
  console.log(ev.pass ? `frame eval ${id} ${which}: pass (${ev.summary})` : `FRAME STOP ${id} ${which}: ${ev.fails.join("; ")}`);
  return ev;
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
      // A job another live process is waiting on is its own; recovering it here would double the wait.
      if (j.pid && j.pid !== process.pid && alive(j.pid)) continue;
      // An old lock gets one short look: every paid command runs recover(), and a long wait per dead task
      // stalled each frame by minutes. A task still unfinished hours later is dropped (the ledger holds its failure).
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      try {
        const { urls, usd: charged } = await PV.wait(j.provider || "kie", j.taskId, { label: `recover ${j.label}`, timeoutMs: age > 30 * 60e3 ? 20e3 : 10 * 60 * 1000 });
        const files = await finish({ ...j, ...(charged != null ? { credits: charged / 0.005 } : {}), provider: j.provider || "kie", outBase: path.join(ROOT, j.outBase), urls });
        console.error(`recovered ${j.label}: ${files.map((x) => path.basename(x)).join(", ")}`);
      } catch (e) {
        console.error(`could not recover ${j.label}: ${e.message.slice(0, 120)}`);
        // Still running on Kie's side, or the download failed: leave the lock for the next recover.
        if (/timed out|download/i.test(e.message) && age < 3 * 36e5) continue;
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
// Two jobs started at the same moment would see the same free number, so a name is claimed atomically with a
// .reserve file (only one process can create it); job() removes the claim when the job ends.
const nextName = (dir, base, ext) => {
  fs.mkdirSync(dir, { recursive: true });
  const taken = (b) => fs.existsSync(b + ext) || fs.existsSync(b + "-1" + ext) || fs.existsSync(b + ".lock");
  for (let k = 1; ; k++) {
    const b = path.join(dir, `${base}-${k}`);
    if (taken(b)) continue;
    // A claim left by a job that died (older than 6 h, nothing written) is free again.
    try { const r = b + ".reserve"; if (fs.existsSync(r) && Date.now() - fs.statSync(r).mtimeMs > 6 * 36e5) fs.rmSync(r, { force: true }); } catch {}
    try { fs.closeSync(fs.openSync(b + ".reserve", "wx")); return b; } catch (e) { if (e.code !== "EEXIST") throw e; }
  }
};

// --------------------------------------------------------------- commands
const commands = {
  async recover() {
    await recover(pos[0]);
  },

  async credits() {
    const b = await PV.balances();
    // An empty wallet reads $0.00: a provider's "please top up" text is never relayed (jobs route to the other provider).
    for (const [k, v] of Object.entries(b)) console.log(`${k.padEnd(8)} ${typeof v === "number" ? "$" + v.toFixed(2) : /insufficient balance|top up/i.test(String(v)) ? "$0.00" : v}`);
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
    // PRICE STOP: no cost is quoted before the live model analysis ran for this production (every format).
    const pc = sl.priceCheck?.at || "", fresh = pc && Date.now() - Date.parse(pc) < 7 * 864e5 && pc > (sl.remake?.at || "");
    if (!fresh) throw new FlowStop(`PRICE STOP: run the live model analysis first (studio.mjs prices ${slug}); a cost quoted before it is a guess.`);
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
    const [prompt0, out] = pos;
    if (!prompt0 || !out) throw new Error('usage: still "<prompt>" <out.png> [--model gpt2.5] [--ref f]... [--kit <camera kit>]');
    // --kit: the still is shot with a camera kit's optics (camera tests, look tests).
    const kit = flag("--kit");
    if (kit && !CAM.KITS[kit]) throw new Error(`unknown camera kit "${kit}" (${Object.keys(CAM.KITS).join(", ")})`);
    const prompt = kit ? `${prompt0} ${CAM.opticsFor({ camera: { kit } }, {}, { kind: "realistic", id: "still" })}` : prompt0;
    const refs = await Promise.all(flags("--ref").map(PV.asUrl));
    const outBase = out.replace(/\.(png|jpe?g)$/i, "");
    const files = await job({ slug: flag("--project"), modelKey: flag("--model", "gpt2.5"), req: { prompt, refs, ar: flag("--ar", "9:16"), size: flag("--size", "1K") }, outBase, label: path.basename(out), ext: ".png" });
    console.log(files.join("\n"));
  },

  // Lip sync on a finished take: only the mouth is redrawn onto the given audio (the source's voice), then that
  // audio is laid back on sample-exact.
  //   lips --video <take> --audio <file with the voice> [--out f.mp4] [--project <slug>]
  async lips() {
    const video = flag("--video"), audioSrc = flag("--audio");
    if (!video || !audioSrc) throw new Error("usage: lips --video <take> --audio <file with the voice> [--out f.mp4] [--project <slug>]");
    for (const f of [video, audioSrc]) if (!fs.existsSync(f)) throw new Error(`not found: ${f}`);
    if (!TR.hasAudio(audioSrc)) throw new Error(`${audioSrc} has no audio`);
    const out = path.resolve(flag("--out") || video.replace(/\.mp4$/i, "-lips.mp4"));
    // The lip-sync model takes the voice alone, up to 10 MB: it goes up as mp3, not inside the source video.
    const voice = out.replace(/\.mp4$/i, "-voice.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", audioSrc, "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", voice]);
    const files = await job({ slug: flag("--project"), modelKey: "lipsync", req: { video: await PV.upload(video), audio: await PV.upload(voice), duration: mediaDuration(video) }, outBase: out.replace(/\.mp4$/i, "-raw"), label: "lip sync", ext: ".mp4" });
    TR.keepSourceAudio(files[0], audioSrc, out);
    console.log(out);
  },
  // Motion transfer and object swap (video to video): the source clip's acting, camera and timing kept, the person
  // replaced by a character (or ONE thing swapped), the source audio laid back on, every take measured.
  //   transfer --video <clip> (--char <id> --style <id> | --image <img> [--refs a,b]) --model <k>
  //            [--swap "<what>" [--with <img>]] [--stabilize] [--res 720p] [--prompt ".."] [--out f.mp4] [--project <slug>] [--test]
  // --char uses the character's approved standard sheet (cast.mjs model-sheet, drawn from their photos with --ref).
  async transfer() {
    const video = flag("--video"), key = flag("--model"), swap = flag("--swap");
    if (!video || !key) throw new Error('usage: transfer --video <clip> (--char <id> --style <id> | --image <img>) --model <k> [--swap "<what>" [--with <img>]] [--stabilize] [--res 720p] [--out file.mp4] [--project <slug>]');
    let image = flag("--image");
    const charId = flag("--char");
    if (charId) {
      const styleId = flag("--style"); if (!styleId) throw new Error("--char needs --style <id> (the look whose sheet holds the identity)");
      const c = P.character(charId), sheet = MS.sheetOf(c, styleId);
      if (!sheet || !fs.existsSync(path.join(c.dir, sheet))) throw new Error(`${charId} has no ${styleId} sheet. Draw it from the character's photos first: node engine/cast.mjs model-sheet ${charId} --style ${styleId} --ref <photo> [--ref <photo>]...`);
      if (c.looks?.[styleId]?.status !== "approved") throw new Error(`${charId}'s ${styleId} sheet is not approved yet: node engine/cast.mjs approve ${charId} --style ${styleId} ...`);
      image = path.join(c.dir, sheet);
    }
    if (swap) image = flag("--with") || image;
    if (!image && !swap) throw new Error("give the identity: --char <id> --style <id>, or --image <img>");
    // More angles of the same character hold identity better than one image; extra ones go in --refs a.png,b.png.
    let extra = (flag("--refs") || "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const f of [video, image, ...extra].filter(Boolean)) if (!fs.existsSync(f)) throw new Error(`not found: ${f}`);
    const m = getModel(key);
    const seedance = /^sd2/.test(key);
    if (m.kind !== "transfer" && !seedance) throw new Error(`${key} is not a motion-transfer model (a model with kind "transfer", or a Seedance 2 model)`);
    if (m.maxRefs === 1 && extra.length) { console.log(`  ${key} takes one reference image: ${extra.length} extra dropped. Put every angle on one sheet (--char) instead.`); extra = []; }
    if (swap && m.transfer !== "edit" && !seedance) throw new Error(`object swap needs an edit model (transfer: "edit"); ${key} redraws the whole frame`);
    const secs = mediaDuration(video), res = flag("--res", "720p");
    if (!(secs >= 3 && secs <= 60)) throw new Error(`the source clip must last 3-60 s (it lasts ${secs.toFixed(1)} s)`);
    const work = path.join(ROOT, ".cache", "transfer-tests"); fs.mkdirSync(work, { recursive: true });
    const base = path.basename(video, path.extname(video));
    let clip = path.resolve(video);
    // Phones record at a variable frame rate (frames 1/30 to 1/20 s apart); a model that spaces frames evenly then
    // drifts the lips against the voice. Every clip goes out at a constant 30 fps first, audio untouched.
    if (TR.isVariableRate(clip)) {
      const cfr = path.join(work, `${base}-cfr.mp4`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", clip, "-vf", "fps=30", "-fps_mode", "cfr", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy", cfr]);
      clip = cfr;
    }
    // A shaky handheld clip makes the model chase the shake instead of the acting: --stabilize smooths the camera first.
    if (has("--stabilize")) {
      const st = path.join(work, `${base}-stable.mp4`);
      spawnSync("ffmpeg", ["-v", "error", "-y", "-i", clip, "-vf", "vidstabdetect=shakiness=8:result='vidstab.trf'", "-f", "null", "-"], { cwd: work });
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", clip, "-vf", "vidstabtransform=input='vidstab.trf':smoothing=30:zoom=4,unsharp=5:5:0.6", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", st], { cwd: work });
      if (r.status !== 0 || !fs.existsSync(st)) throw new Error("stabilize failed: " + String(r.stderr || "").slice(0, 300));
      clip = st;
    }
    // A clip longer than the model accepts is filmed in overlapping pieces cut at calm moments, then joined.
    // The take keeps the clip's shape: a vertical phone clip stays vertical (displayed size, rotation included).
    const clipAr = TR.aspectOf(clip);
    const maxSecs = Math.min(m.maxSecs || 30, seedance ? 15 : 30);
    const pieces = TR.planPieces(clip, maxSecs);
    if (pieces.length > 1) console.log(`  ${secs.toFixed(1)} s is over ${key}'s ${maxSecs} s: ${pieces.length} pieces ${pieces.map((p) => `${p.start}-${p.end} s`).join(", ")}, joined on 0.5 s overlaps`);
    const iUrl = image ? await PV.upload(image) : null;
    const xUrls = []; for (const x of extra) xUrls.push(await PV.upload(x));
    const imgTags = [iUrl, ...xUrls].filter(Boolean).map((_, i) => `@Image${i + 1}`).join(", ");
    const keep = "Keep the reference video's exact motion, acting, facial expressions, timing, camera movement and framing.";
    const ask = flag("--prompt");
    const prompt = swap ? `${TR.swapPrompt(swap, !!flag("--with"))}${ask ? " " + ask : ""}`
      : seedance ? `Edit @Video1, do not regenerate it: ${ask || `replace the person with the character shown in ${imgTags}.`} ${keep} Every gesture happens at the same moment as in @Video1. The character's face, hair and clothes stay exactly as in ${imgTags}.`
      : m.transfer === "edit" ? `Edit Video 1, do not regenerate it: ${ask || "replace the person with the character in the reference image."} ${keep} Every gesture happens at the same moment as in the source. The character's face, hair and clothes stay exactly as in the reference image.`
      : ask ? `${ask} ${keep}` : keep;
    const out = path.resolve(flag("--out") || path.join(work, `${base}-${key}.mp4`));
    const takes = [];
    for (const [k, pc] of pieces.entries()) {
      let src = pieces.length > 1 ? TR.cutPiece(clip, pc, path.join(work, `${base}-piece${k + 1}.mp4`)) : clip;
      const len = pc.end - pc.start, maxMB = m.maxVideoMB || 50;
      // A piece heavier than the model accepts is re-encoded (same frames and timing, lighter) before upload.
      if (fs.statSync(src).size > maxMB * 0.95 * 1e6) {
        const light = path.join(work, `${base}-piece${k + 1}-light.mp4`);
        const kbps = Math.floor((maxMB * 0.85 * 8e3) / Math.max(1, len)) - 96;
        spawnSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-c:v", "libx264", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", light]);
        src = light;
      }
      const vUrl = await PV.upload(src);
      // After the first piece, the identity reference also carries the film's look so far: the previous piece's
      // frame at the shared moment, beside the sheet (one image) or as an extra reference.
      let pUrl = iUrl, pRefs = [iUrl, ...xUrls].filter(Boolean), pPrompt = prompt;
      if (k > 0 && image && !swap) {
        const tPrev = pieces[k - 1].end - pieces[k - 1].start - 0.5;
        if (m.maxRefs === 1) {
          pUrl = await PV.upload(TR.chainRef(image, takes[k - 1], tPrev, path.join(work, `${base}-chainref${k + 1}.png`)));
          pRefs = [pUrl];
          pPrompt += " The reference image holds the character sheet on the left and, on the right, the previous moment of this same video: match that frame's look, colors, lighting and the character exactly (same side of the hair streak, same clothes, same room).";
        } else {
          const fr = path.join(work, `${base}-prev${k + 1}.png`);
          execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(tPrev), "-i", takes[k - 1], "-frames:v", "1", fr]);
          pRefs = [...pRefs, await PV.upload(fr)];
          pPrompt += " The last reference image is the previous moment of this same video: match its look, colors, lighting and the character exactly.";
        }
      }
      const req = seedance
        ? { prompt: pPrompt, refs: pRefs, refVideo: [vUrl], ar: flag("--ar") || clipAr, res, duration: Math.min(15, Math.max(4, Math.round(len))), sound: false }
        : { prompt: pPrompt, frame: pUrl, refs: pRefs, video: vUrl, res, ar: flag("--ar") || clipAr, duration: len };
      const ob = pieces.length > 1 ? out.replace(/\.mp4$/i, `-piece${k + 1}`) : out.replace(/\.mp4$/i, "-silent");
      const files = await job({ slug: flag("--project"), modelKey: key, req, outBase: ob, label: `transfer ${key}${pieces.length > 1 ? ` piece ${k + 1}/${pieces.length}` : ""}`, ext: ".mp4", ...(flag("--project") && has("--test") ? { test: true } : {}) });
      let take = files[0];
      // Each piece's brightness and saturation brought to the previous piece's on their shared moment (free).
      if (k > 0) {
        const tPrev = pieces[k - 1].end - pieces[k - 1].start - 0.5;
        take = TR.matchLook(take, TR.lookAt(takes[k - 1], tPrev), TR.lookAt(take, 0), take.replace(/\.mp4$/i, "-matched.mp4"));
      }
      takes.push(take);
    }
    const joins = pieces.length > 1 ? TR.joinCheck(takes, pieces) : null;
    const joined = pieces.length > 1 ? TR.joinPieces(takes, pieces, out.replace(/\.mp4$/i, "-silent.mp4")) : takes[0];
    // The source's own audio goes back on, sample-exact, whatever the model did with sound.
    let { audio } = TR.keepSourceAudio(joined, clip, out);
    // --lipsync: an edit model redraws the mouth without hearing the voice, so the lips can drift off the words; a
    // video-to-video lip-sync pass redraws only the mouth onto the source audio.
    if (has("--lipsync") && audio) {
      const voice = out.replace(/\.mp4$/i, "-voice.mp3");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", clip, "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "192k", voice]);
      const synced = await job({ slug: flag("--project"), modelKey: "lipsync", req: { video: await PV.upload(joined), audio: await PV.upload(voice), duration: mediaDuration(out) }, outBase: out.replace(/\.mp4$/i, "-lips"), label: `transfer lip sync`, ext: ".mp4", ...(flag("--project") && has("--test") ? { test: true } : {}) });
      TR.keepSourceAudio(synced[0], clip, out);
    }
    // Every take is measured: motion against the source (when and where it moves), identity against the sheet.
    const report = { source: clip, model: key, pieces, audio, motion: TR.motionMatch(clip, out), ...(joins ? { joins: { pass: joins.pass, joins: joins.joins, issues: joins.issues } } : {}), at: new Date().toISOString() };
    if (charId && !swap) { try { report.identity = await identityCheck(out, [charId]); } catch (e) { report.identity = { pass: false, issues: [`identity check could not run: ${e.message.slice(0, 120)}`] }; } }
    report.pass = report.motion.pass && (report.identity?.pass ?? true) && (report.joins?.pass ?? true);
    fs.writeFileSync(out.replace(/\.mp4$/i, ".eval.json"), JSON.stringify(report, null, 2));
    console.log(out);
    console.log(`  motion: ${report.motion.pass ? "PASS" : "FAIL"} (timing ${report.motion.corr}, zones ${report.motion.zone}, lag ${report.motion.lag} s)${report.motion.issues.length ? " - " + report.motion.issues.join("; ") : ""}`);
    if (report.identity) console.log(`  identity: ${report.identity.pass ? "PASS" : "FAIL"}${report.identity.issues?.length ? " - " + report.identity.issues.join("; ") : ""}`);
    if (report.joins) console.log(`  joins: ${report.joins.pass ? "PASS" : "FAIL"} (${report.joins.joins.map((j) => `${j.at} s look shift ${j.shift}`).join(", ")})${report.joins.issues.length ? " - " + report.joins.issues.join("; ") : ""}`);
    console.log(`  audio: ${audio ? "source audio kept" : "the source has no audio"}`);
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
      // Every panel is judged against the set plate and the character sheets before the scene is filmed.
      for (const [k, id] of sc.shots.entries()) {
        const shot = P.shot(sl, id);
        const ev = await evalFrame({ frame: panels[k], refs: refs.map((r) => ({ label: r.role === "set" ? "set plate" : r.role === "angle" ? `locked close-up angle of ${r.id}` : `character sheet of ${r.name}`, file: r.file })), cast: refs.filter((r) => r.role !== "set" && r.role !== "angle").map((r) => ({ name: r.name, look: r.look })), expect: `${shot.framing || ""} ${shot.image || ""}`.trim() }).catch((e) => ({ pass: false, fails: [`the judge could not run: ${e.message.slice(0, 120)}`], summary: "" }));
        P.updateShotlist(slug, (x) => { P.shot(x, id).board.eval = { pass: ev.pass, fails: ev.fails, summary: ev.summary }; });
        console.log(ev.pass ? `panel ${id}: pass` : `PANEL STOP ${id}: ${ev.fails.join("; ")}`);
      }
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
    // Launch films: no frame is paid for before the creator approved the storyboard animatic of this plan.
    if (sl.format === "launch" && has("--planned") && sl.launch?.animaticApproved?.plan !== planSha(sl)) throw new FlowStop(`${id}: the creator hasn't approved this plan's animatic (launch.mjs animatic ${slug} --approve --said "...")`);
    // chain "exact": the first frame IS the previous shot's drawn last frame (copied, free), so the cut disappears.
    const i0 = sl.shots.indexOf(s), prev = sl.shots[i0 - 1];
    // After a shot with a green screen insert, a copy would open on the green: that first frame is drawn from it instead.
    const afterInsert = !!prev?.inserts?.length !== !!s.inserts?.length;
    if (sl.format === "launch" && which === "first" && s.chain === "exact" && !afterInsert) {
      // A locked shot has no separate last frame: its first frame is also how it ends.
      const src = prev?.last || (prev?.frame && !prev?.lastPrompt ? prev.frame : null);
      if (!src) throw new FlowStop(`${id} starts on ${prev?.id}'s last frame; draw that frame first (gen.mjs frame ${slug} ${prev?.id} last --planned)`);
      if (s.frameSrc === src && s.frame && fs.existsSync(P.abs(slug, s.frame))) return console.log(`${P.abs(slug, s.frame)} (already ${prev.id}'s last frame)`);
      // Never chain from a frame that didn't pass: a copy of a stale or rejected frame spreads its error down the film.
      const srcEv = src === prev.last ? prev.lastEval : prev.firstEval;
      const srcOk = (src === prev.frame && prev.frameSrc) || (srcEv?.file === src && (srcEv.pass || srcEv.accepted));
      if (!srcOk) throw new FlowStop(`${id} starts on ${prev.id}'s ${src === prev.last ? "last" : "first"} frame, which hasn't passed its eval; fix ${prev.id} first`);
      const base = nextName(P.abs(slug, "frames"), `${id}-first`, ".png"), out = base + ".png";
      fs.copyFileSync(P.abs(slug, src), out);
      fs.rmSync(base + ".reserve", { force: true });
      P.updateShotlist(slug, (x) => { const t = P.shot(x, id); t.frame = P.rel(slug, out); t.firstPrompt = prompt; t.frameFrom = `${prev.id}:last`; t.frameSrc = src; if (t.last && t.lastFrom !== t.frame) { delete t.last; delete t.lastEval; delete t.lastFrom; } });
      return console.log(`${out} (${prev.id}'s last frame, free)`);
    }
    // chain "same-set": drawn from the previous shot's frame with the same framing (GPT Image reframes unless told).
    const setRef = sl.format === "launch" && which === "first" && (s.chain === "same-set" || (s.chain === "exact" && afterInsert)) && (prev?.last || prev?.frame) ? [P.abs(slug, prev.last || prev.frame)] : [];
    const miss = missingMarks(prompt, s.characters || castOf(sl, prompt));
    if (miss.length) throw new FlowStop(`PROMPT STOP: the ${which} frame of ${id} leaves out ${miss.join("; ")}`);
    // Each character's sheet in the project's style first (cast.mjs sheet --style writes looks.<style>.sheet;
    // reading only refs/sheets would leave the style's sheet out, and frames would draw strangers).
    // A last frame is drawn from the shot's own first frame, so it is the same scene at its end state.
    const stRefs = (() => { try { const st = P.style(sl.style); return (st.refs || []).map((f) => path.join(st.dir, f)); } catch { return []; } })(); // a style made from the creator's references
    const refs = await Promise.all([...setRef, ...(which === "last" && s.frame ? [P.abs(slug, s.frame)] : []), ...flags("--ref"), ...stRefs, ...(s.refs || []).map((f) => P.abs(slug, f)), ...(s.characters || []).flatMap((c) => { const ch = P.character(c); return [P.characterLook(ch, sl.style).modelSheet, P.characterLook(ch, sl.style).sheet, ...(ch.refs || []), ...(ch.sheets || [])].filter(Boolean).slice(0, 1).map((f) => path.join(ch.dir, f)); })].map(PV.asUrl));
    const optics = (() => { try { return CAM.opticsFor(sl, s, P.style(sl.style)); } catch { return ""; } })();
    // A frame that failed its eval is never redrawn blind: the judge's notes become corrections in the next prompt,
    // and after two failed attempts the engine stops until the creator decides (no endless rerolls).
    const notes = (s.frameNotes || []).filter((n) => n.which === which);
    if (sl.format === "launch" && notes.length >= 2 && !flag("--said")) throw new FlowStop(`FRAME STOP: ${id} ${which} failed its eval twice (${notes.map((n) => n.fails.join("; ")).join(" | ")}); change the plan or retry only with the creator's words (--said "...")`);
    const fixes = notes.length ? `Corrections, because the previous attempt failed: ${notes.at(-1).fails.join("; ")}. Fix every one of these.` : "";
    // A last frame drawn from the opening frame copies its poses unless the change leads the prompt: the end state
    // goes first, with what must change and what must stay.
    const endLead = which === "last" && s.end && s.frame ? `The first reference image is this shot's OPENING frame. Draw the END of the same shot, a few seconds later: ${s.end}. The people's poses, gestures, expressions and every screen's content change to this end state and must not copy the opening frame; make every change large and unmistakable (a lean back puts the back against the chair's backrest, clearly farther from the desk); the set, the camera position, the props and their places stay exactly the same.` : "";
    // At an insert boundary the shot may reframe (a push-in to the screen): the previous frame fixes the set and the moment, the shot's own camera sets the framing.
    const sent = [endLead, setRef.length ? (afterInsert ? `The same set and the same moment as the first reference image, every object where it is unless described; the camera and framing follow this shot's description, not the reference: ${prompt}` : `The same set as the first reference image, with exactly the same framing, camera position and zoom; every object stays where it is unless described: ${prompt}`) : prompt, fixes, optics].filter(Boolean).join(" ");
    const [out] = await job({ slug, modelKey: "gpt2.5", req: { prompt: sent, refs, ar: sl.ar || "9:16", size: flag("--size", "2K") }, outBase: nextName(P.abs(slug, "frames"), `${id}-${which}`, ".png"), label: `${id} ${which} frame`, ext: ".png" });
    P.updateShotlist(slug, (x) => { const t = P.shot(x, id); t[which === "first" ? "frame" : "last"] = P.rel(slug, out); t[which === "first" ? "firstPrompt" : "lastUsedPrompt"] = prompt; if (which === "last") { t.lastPlanned = s0?.lastPrompt; t.lastFrom = t.frame; } else { delete t.frameSrc; if (t.last && t.lastFrom !== t.frame) { delete t.last; delete t.lastEval; delete t.lastFrom; } } });
    console.log(out);
    // Every frame of a clips format is judged (launch films also against the set map and sheets).
    if (kindOf(sl) === "clips" && (s.characters?.length || sl.format === "launch")) await frameEvalOf(slug, id, which);
  },

  // A frame the eval failed, used anyway in the creator's words (the failure stays recorded next to the acceptance).
  // Every planned frame of a clips film in one command, in chain order (a shot opens on the previous shot's end, so
  // the order is the plan's): first it prints how many images it will paint, what they cost and how long they take
  // (measured), then it draws, judges and retries provider timeouts. It stops at the first frame that can't pass,
  // and never draws a shot whose previous shot is missing. Shell loops around paid commands are refused by the guard.
  async "frame-chain"() {
    const slug = pos[0];
    if (!slug) throw new Error("usage: frame-chain <slug>");
    await recover(slug);
    let sl = P.loadShotlist(slug);
    requireStep(sl, "board", "gen frame-chain");
    const copyable = (s, prev) => sl.format === "launch" && s.chain === "exact" && prev && !!prev.inserts?.length === !!s.inserts?.length;
    const todo = [];
    sl.shots.forEach((s, i) => {
      if (s.source === "card") return;
      const evOk = (w) => { const f = w === "first" ? s.frame : s.last, ev = s[`${w}Eval`]; return f && (w === "first" && s.frameSrc ? true : ev?.file === f && (ev.pass || ev.accepted)); };
      if (s.framePrompt && !evOk("first")) todo.push({ id: s.id, which: "first", free: copyable(s, sl.shots[i - 1]) });
      if (s.lastPrompt && !evOk("last")) todo.push({ id: s.id, which: "last", free: false });
    });
    if (!todo.length) return console.log("every planned frame is drawn and passed");
    const paid = todo.filter((t) => !t.free).length, img = getModel("gpt2.5"), each = img.cost({ size: "2K" });
    const secs = P.readJSON(path.join(P.PROJECTS, slug, "ledger.json"), []).filter((e) => e.ok && e.model === "gpt2.5" && e.secs).map((e) => e.secs).sort((a, b) => a - b);
    const med = secs.length ? secs[Math.floor(secs.length / 2)] : 180;
    console.log(`frame-chain ${slug}: ${todo.length} frames (${paid} to paint, ${todo.length - paid} copied free), ~${usd(paid * each)}, ~${Math.ceil((paid * (med + 45)) / 60)} min (measured ${med} s per image${secs.length ? "" : ", no measurement yet: assumed"} + ~45 s judge). A rejected frame repaints once, then stops.`);
    for (const t of todo) {
      for (let attempt = 1; ; attempt++) {
        pos.splice(0, pos.length, slug, t.id, t.which);
        if (!argv.includes("--planned")) argv.push("--planned");
        try { await commands.frame(); }
        catch (e) {
          if (/timed out|upstream|ECONNRESET|fetch failed/i.test(e.message) && attempt < 3) { console.error(`  ${t.id} ${t.which}: provider timeout, retrying`); await recover(slug); continue; }
          throw e;
        }
        sl = P.loadShotlist(slug);
        const s = P.shot(sl, t.id), f = t.which === "first" ? s.frame : s.last, ev = s[`${t.which}Eval`];
        if (t.which === "first" && s.frameSrc && s.frame) break;
        if (ev?.file === f && (ev.pass || ev.accepted)) break;
        // The frame command stops by itself after two failed evals (FRAME STOP); the loop never goes past it.
      }
    }
    console.log(`frame-chain ${slug}: done`);
  },

  async "frame-accept"() {
    const [slug, id, which] = pos, said = flag("--said");
    if (!slug || !id || !["first", "last"].includes(which) || !said) throw new Error('usage: frame-accept <slug> <shot> first|last --said "the creator exact words"');
    P.updateShotlist(slug, (x) => { const ev = P.shot(x, id)[`${which}Eval`]; if (!ev) throw new FlowStop(`${id} ${which} has no eval to accept`); ev.accepted = { said, at: new Date().toISOString() }; });
    console.log(`${id} ${which} frame accepted in the creator's words`);
  },

  // The frame eval again on a frame already drawn (free of image cost; the judge reads it).
  async "frame-eval"() {
    const [slug, id, which] = pos;
    if (!slug || !id || !["first", "last"].includes(which)) throw new Error("usage: frame-eval <slug> <shot> first|last");
    await frameEvalOf(slug, id, which);
  },

  // Clips formats, film step: one first/last-frame generation for a shot of the shotlist, through job()
  // (budget lock, prompt and dialogue checks, ledger, lock file). The prompt is P.clipPrompt: the shot's prompt plus
  // its script word for word. Then every eval runs on the take and is stored on it: identity (face and marks against
  // the locked anchor), jumps (cuts or snaps inside the shot), dialogue. The take is recorded before the evals run,
  // so a paid take is never lost when an eval can't run (the Kie judge can be down): `--eval <n>`
  // re-runs the evals on take n for free. A take that fails is never used by cut.mjs.
  async clip() {
    const slug = pos[0], id = flag("--shot");
    if (!slug || !id) throw new Error("usage: clip <slug> --shot <id> [--redo] [--eval <take n>] [--test --model <k> --said \"...\"]");
    await recover(slug);
    const sl = P.loadShotlist(slug);
    // --test: a motion test of one shot in a given model before the book (a model can fail the same motion
    // repeatedly). Only with the creator's words and inside a budget they unlocked; the take is marked a test.
    const test = has("--test") && !flag("--eval");
    if (test && (!flag("--model") || !flag("--said"))) throw new FlowStop('clip --test needs --model <k> and --said "the creator exact words"');
    if (test) requireStep(sl, "board", "gen clip --test");
    else requireStep(sl, "film", "gen clip");
    if (kindOf(sl) !== "clips") throw new FlowStop(`gen clip is for clips formats; ${sl.format} films with ${kindOf(sl) === "scenes" ? "gen scenes" : "gen loops"}`);
    const s = P.shot(sl, id);
    if (s.source && s.source !== "generate") throw new FlowStop(`${id} is a ${s.source}: launch.mjs build draws it, nothing to film`);
    const cast = s.characters || castOf(sl, s.prompt);
    const model = test ? flag("--model") : s.model || sl.defaults?.videoModel || "veo";
    // A take is never refilmed blind: the last failed take's notes (evals or the frame-by-frame review) go into the
    // next prompt, and after two failed takes the engine stops until the creator decides.
    const failed = (s.clips || []).filter((c) => !c.test && (c.review?.ok === false || (c.evals && !evalsPass(c))));
    if (!test && failed.length >= 2 && !flag("--said")) throw new FlowStop(`CLIP STOP: ${id} failed twice; change the plan or refilm only with the creator's words (--said "...")`);
    const lastFail = failed.at(-1);
    const clipFixes = lastFail ? `Corrections, because the previous take failed: ${[...(lastFail.evals?.identity?.issues || []), ...(lastFail.evals?.motion && !lastFail.evals.motion.pass ? ["the motion was too slow and small: make every action bigger, livelier and clearly visible"] : []), ...(lastFail.review?.ok === false ? [lastFail.review.notes] : [])].filter(Boolean).join("; ")}.` : "";
    // A launch film never uses a take's own sound (voice-over, music and effects are mixed by launch.mjs).
    const silent = sl.format === "launch";
    // Its shots are choreographed to a drawn last frame: the video model must take one (any model that does).
    if (silent && !getModel(model).lastFrame) throw new FlowStop(`${model} doesn't take a last frame; a launch film needs a model with a first and a last frame (studio.mjs prices lists them)`);
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
        prompt: fitPrompt([P.clipPrompt(sl, s), clipFixes].filter(Boolean).join(" "), getModel(model)), lines: s.dialogue || [], cast, ar: sl.ar || "9:16", res: s.res || sl.defaults?.res || "720p", duration: test && flag("--secs") ? Number(flag("--secs")) : s.duration,
        frame: await PV.upload(first), lastFrame: s.last ? await PV.upload(P.abs(slug, s.last)) : undefined, ...(silent ? { sound: false } : {}),
      };
      const [out] = await job({ slug, modelKey: model, req, outBase: nextName(P.abs(slug, "clips"), `${id}-take`, ".mp4"), label: `${id} ${test ? "motion test" : "take"}`, ext: ".mp4", test });
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
      // Every take with people is measured against its format's motion band (approved launch shots measured 1.6-3.4,
      // slow ones 0.4-1.0; calm talking takes sit around 0.4-1.0 and are right for talking formats).
      if (cast.length) {
        const score = motionScore(file), [lo, hi] = motionBand(sl);
        evals.motion = { score, min: lo, max: hi, pass: score >= lo && score <= hi };
        console.log(evals.motion.pass ? `MOTION PASS (${score}, band ${lo}-${hi})` : `MOTION FAIL: ${score} outside ${lo}-${hi} for ${sl.format}; ${score < lo ? "the take reads slow or frozen: push the acting and the camera move" : "the take shakes or morphs: calm the move"}. Refilm (one retry, the creator's yes) or accept it in their words`);
      }
      console.log([
        identity.pass ? "IDENTITY PASS" : `IDENTITY FAIL\n - ${identity.issues.join("\n - ")}`,
        ...jumpLines(jr), evals.jumps.internal ? "JUMPS FAIL: an internal jump reads as a jump cut; the creator decides (studio.mjs override, or a reroll with their yes)" : "JUMPS PASS",
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
    // Launch films: the score is derived from the final film, not from an early draft. The brief must name the visual
    // style and the narrator actually chosen, and every turn must land on a line of the recorded narration.
    let turns = [];
    if (sl.format === "launch") {
      const plan = P.readJSON(path.join(P.projectDir(slug), "launch", "shot-plan.json"));
      const b = plan.musicBrief, bad = [];
      if (!b) bad.push("no musicBrief");
      else {
        if (!b.style) bad.push("musicBrief.style: describe the approved visual style the score must match");
        if (!b.narrator || !/voice|narrat/i.test(b.narrator)) bad.push("musicBrief.narrator: describe the recorded narrator (timbre, energy, pace)");
        const starts = plan.shots.filter((s) => s.vo).map((s) => ({ line: s.vo, at: s.start + (s.voAt || 0) }));
        for (const t of b.turns || []) {
          const ln = starts.find((x) => t.line && x.line.toLowerCase().startsWith(t.line.toLowerCase().slice(0, 18)));
          if (!t.line || !ln) bad.push(`turn at ${t.at} s names no recorded line (turn.line must quote the start of one)`);
          else if (Math.abs(ln.at - t.at) > 0.6) bad.push(`turn "${t.line}" is at ${t.at} s but the line starts at ${ln.at.toFixed(2)} s in the narration`);
        }
        if ((b.turns || []).length < 2) bad.push("musicBrief.turns: at least two turns tied to narration lines");
      }
      if (bad.length) throw new FlowStop(`MUSIC STOP: ${bad.join("; ")}`);
      turns = b.turns;
    }
    const total = sl.shots.reduce((n, s) => n + (s.duration || 5), 0);
    const files = await job({ slug, modelKey: "suno", req: { prompt: sl.music.prompt, title: sl.title, duration: total + 4 }, outBase: P.abs(slug, "audio/music"), label: "music", ext: ".mp3" });
    // Every version is measured before anyone hears it: tempo, and the loudness change across each turn.
    const db = (f, a, b) => { const r = spawnSync("ffmpeg", ["-v", "info", "-ss", String(Math.max(0, a)), "-t", String(Math.max(0.3, b - a)), "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }); return +(/mean_volume: (-?[\d.]+)/.exec(r.stderr)?.[1] ?? NaN); };
    const report = files.map((f) => {
      const tm = JSON.parse(spawnSync("python", [path.join(ROOT, "engine", "lib", "ref_media.py"), "audio", f], { encoding: "utf8" }).stdout || "{}").tempo;
      const lifts = turns.map((t) => ({ at: t.at, line: t.line, change: +(db(f, t.at, t.at + 2) - db(f, t.at - 2, t.at)).toFixed(1) }));
      return { file: P.rel(slug, f), bpm: tm?.bpm ?? null, steady: tm?.steady ?? null, lifts };
    });
    P.updateShotlist(slug, (x) => { x.music.files = files.map((f) => P.rel(slug, f)); x.music.pick ??= 0; x.music.report = report; });
    for (const r of report) console.log(`${r.file}: ${r.bpm ?? "?"} bpm${r.steady === false ? " (unsteady)" : ""}; turns ${r.lifts.map((l) => `${l.at}s ${l.change >= 0 ? "+" : ""}${l.change} dB`).join(", ") || "none"}`);
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
      // First frame only: asked for the same first and last frame, the model returns a frozen picture.
      // The seam is hidden by longform.mjs, which cross-fades the tail into the head.
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
      // break (otherwise a sleep piece is read far faster than its 80-100 wpm).
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
  // A voice reference must never speak the script: the video model repeats what it hears, and a sample that says
  // another character's line ends up spoken in the take.
  // The sample is transcribed once (cached next to it) and checked against every line of the project.
  const norm = (t) => ` ${String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const scriptLines = sl.shots.flatMap((s) => (s.dialogue || []).map((l) => l.text)).filter((t) => t.trim().split(/\s+/).length >= 2);
  for (const v of found) {
    const txt = v.file + ".transcript.txt";
    if (!fs.existsSync(txt) || fs.statSync(txt).mtimeMs < fs.statSync(v.file).mtimeMs) {
      const py = "import sys; from faster_whisper import WhisperModel; m = WhisperModel('base', device='cpu', compute_type='int8'); print(' '.join(s.text for s in m.transcribe(sys.argv[1], language=sys.argv[2])[0]))";
      const r = spawnSync("python", ["-c", py, v.file, lang], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`VOICE REF STOP: couldn't transcribe ${v.char}'s sample to check it doesn't speak the script`);
      fs.writeFileSync(txt, r.stdout.trim());
    }
    const heard = norm(fs.readFileSync(txt, "utf8"));
    const said = scriptLines.find((t) => heard.includes(norm(t)));
    if (said) throw new Error(`VOICE REF STOP: ${P.character(v.char).name}'s voice sample says the script line "${said}"; the model would repeat it. Remake the sample with neutral text: node engine/gen.mjs sample ${v.char} --text "..."`);
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
