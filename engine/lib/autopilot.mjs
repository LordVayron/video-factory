// Autopilot: `studio.mjs go <slug> --said "..."` runs every automatic step of the flow, in order, with the same engine
// commands a person would type (each one keeps its own gates, budget lock, ledger and evals), and stops only where the
// creator decides (concept, script, cast, the plan's animatic, the Production Book) or where a STOP needs their yes.
// Why: chaining 15 commands by hand stopped a production at every step and let steps run out of order.
import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT } from "./env.mjs";
import * as P from "./project.mjs";
import * as F from "./flow.mjs";
import { MODELS } from "./models.mjs";

const ENGINE = path.join(ROOT, "engine");

// One engine command, its output streamed and kept (the last lines explain a stop).
// FACTORY_AUTOPILOT_DRY=1 prints the commands instead of running them (tests and previews).
export function run(script, args, { quiet = false } = {}) {
  if (process.env.FACTORY_AUTOPILOT_DRY) { console.log(`[dry] node engine/${script} ${args.join(" ")}`); return Promise.resolve({ ok: true, out: "", code: 0, cmd: `${script} ${args.join(" ")}` }); }
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ENGINE, script), ...args], { cwd: ROOT, env: process.env });
    let out = "";
    const take = (d) => { out += d; if (!quiet) process.stdout.write(d); };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    p.on("close", (code) => resolve({ ok: code === 0, out, code, cmd: `${script} ${args.join(" ")}` }));
  });
}

// At most `n` commands at once (budget claims and the project mutex keep parallel jobs inside the cap).
async function pool(items, n, fn) {
  const res = [], q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) { const it = q.shift(); res.push(await fn(it)); } }));
  return res;
}

// Engine v6 projects film by sequences (continuous camera by default); older projects keep filming shot by shot.
const seqProject = (sl) => F.v6(sl);
const stopLine = (out) => (out.match(/[A-Z]+ STOP[^\n]*|FlowStop[^\n]*|Error[^\n]*/g) || []).at(-1) || out.trim().split("\n").at(-1) || "";

// The shot a motion test films: the hardest generated shot (most people, then longest).
export function testShot(sl) {
  const shots = (sl.shots || []).filter(F.films);
  return [...shots].sort((a, b) => (b.characters?.length || 0) - (a.characters?.length || 0) || (b.duration || 0) - (a.duration || 0))[0];
}

// The two models compared before the book: the analysis pick and the best other option that can film this format.
export function testModels(sl) {
  const pc = sl.priceCheck;
  if (!pc) return [];
  const can = (k) => !!MODELS[k] && (sl.format !== "launch" || MODELS[k].lastFrame);
  const second = (pc.options || []).find((o) => o.key !== pc.pick?.key && can(o.key));
  return [pc.pick?.key, second?.key].filter(Boolean);
}

// What the creator decides at a stop, in plain words for the agent to show them.
const DECIDE = {
  series: "the series bible",
  concept: "pick one of the concepts (launch: each concept card carries the full script and voice-over)",
  script: "approve the script (words and timing)",
  cast: "approve the look and the voice (style, characters, narrator, camera)",
  book: "publish the Production Book and approve it: the total with the reserve, the model (motion tests side by side) and any flagged frame",
  retro: "the retro",
};

// The steps of one pass. Returns { done, stop, why } or null to go on.
async function step(slug, said, log) {
  const sl = P.loadShotlist(slug);
  const st = F.status(sl);
  const cur = st.current;
  if (!cur) return { done: true };
  if (cur.who === "creator") {
    if (cur.id === "retro" && F.stepStatus(sl, "deliver").ok) return { done: true, delivered: true };
    if (cur.id === "book" && !/no Production Book|no cost estimate/.test(cur.detail)) return { stop: "creator", why: DECIDE.book, step: cur.id };
    if (cur.id !== "book") return { stop: "creator", why: `${DECIDE[cur.id] || cur.name}: ${cur.detail}`, step: cur.id };
  }
  const d = cur.detail || "";
  const k = F.kindOf(sl);
  const go = async (script, args, opts) => { log.push(`${script} ${args.join(" ")}`); return run(script, args, opts); };
  const need = (r) => (r.ok ? null : { stop: "engine", why: stopLine(r.out), cmd: r.cmd, step: cur.id });

  switch (cur.id) {
    case "board": {
      if (sl.format === "launch") {
        // Craft problems in the plan are the agent's to fix (they reopen no approval); nothing is drawn until they are.
        if (F.CRAFT.test(d)) return { stop: "engine", why: `fix the plan's craft, then run go again (no approval needed): ${d.split("; ").filter((x) => F.CRAFT.test(x)).join("; ")}`, step: "board", agent: true };
        if (/not the current plan \(launch\.mjs apply\)/.test(d)) return need(await go("launch.mjs", ["apply", slug]));
        if (/voice-over not recorded|voice runs .* fit/.test(d)) return need(await go("launch.mjs", ["voice", slug]));
        if (/no animatic of the current plan/.test(d)) return need(await go("launch.mjs", ["animatic", slug]));
        if (/hasn't approved this plan's animatic/.test(d)) return { stop: "creator", why: `watch the animatic (out/animatic.mp4: the plan's timing and voice) and approve it once: launch.mjs animatic ${slug} --approve --said "..."`, step: "animatic" };
      }
      if (/frame|first frame|last frame/.test(d) && k === "clips") {
        const r = need(await go("gen.mjs", ["frame-chain", slug]));
        if (r) return r;
        if (sl.format === "launch") return need(await go("launch.mjs", ["animatic", slug], { quiet: true }));
        return null;
      }
      if (k === "scenes" && /storyboard|grid|animatic/.test(d)) { const r = need(await go("gen.mjs", ["storyboard", slug])); return r || need(await go("animatic.mjs", [slug])); }
      return { stop: "engine", why: d, step: cur.id };
    }
    case "radio": return need(await go("radio.mjs", [slug]));
    case "models": {
      const r = need(await go("studio.mjs", ["prices", slug]));
      if (r) return r;
      // Motion tests before the book: the pick and the runner-up on the hardest shot, inside the test allowance.
      const s1 = P.loadShotlist(slug);
      if (k === "clips" && !s1.launch?.motionTestWaived && !s1.modelCompareWaived) {
        const shot = testShot(s1), tested = Object.keys((await import("./pricing.mjs")).testedModels(s1));
        const todo = testModels(s1).filter((m) => !tested.includes(m));
        if (shot && todo.length) {
          // A model that cuts inside one generation is tested on the scene with the most cuts (v6 sequence test);
          // the others on the hardest single shot.
          if (seqProject(s1)) await go("gen.mjs", ["sequences", slug], { quiet: true });
          const seqTest = () => [...(P.loadShotlist(slug).sequences || [])].filter((q) => !q.editor).sort((a, b) => b.shots.length - a.shots.length)[0];
          const res = await pool(todo, 2, (m) => (seqProject(s1) && seqTest()?.shots.length > 1
            ? go("gen.mjs", ["sequence", slug, "--seq", seqTest().id, "--test", "--model", m, "--said", said])
            : go("gen.mjs", ["clip", slug, "--shot", shot.id, "--test", "--model", m, "--said", said])));
          const bad = res.find((x) => !x.ok);
          // A test that can't run (allowance spent, model refused) is reported in the book, not a reason to stop.
          if (bad) log.push(`motion test not filmed: ${stopLine(bad.out)}`);
        }
      }
      return null;
    }
    case "book": return need(await go("book.mjs", [slug]));
    case "film": {
      if (k === "scenes") return need(await go("gen.mjs", ["scenes", slug]));
      if (k === "longform") {
        for (const c of ["narration", "bed", "loops"]) { const r = need(await go("gen.mjs", [c, slug])); if (r) return r; }
        return null;
      }
      const todo = (sl.shots || []).filter((s) => F.films(s) && !F.takeOk(s.clips?.[s.clip]));
      const pilot = F.pilotId(sl);
      const pilotOk = sl.flow?.approved?.pilot && (sl.flow.approved.pilot.model ?? null) === (sl.defaults?.videoModel ?? null);
      // The pilot first when the book had no motion test of this model (requirePilot stops the rest until approved).
      if (!pilotOk && !F.bookTested(sl) && todo.some((s) => s.id === pilot)) {
        const r = await go("gen.mjs", ["clip", slug, "--shot", pilot]);
        return { stop: "creator", why: r.ok ? `watch the pilot ${pilot} and approve it: studio.mjs approve-pilot ${slug} --said "..."` : stopLine(r.out), step: "pilot" };
      }
      // ENGINE V6: with a model that cuts inside one generation, each scene is filmed as one sequence (cuts designed in
      // the prompt), sequences that continue another in order, the rest at once; a passing sequence becomes its shots'
      // takes. Without such a model, the shots are filmed one by one below.
      if (seqProject(sl)) {
        const rp = need(await go("gen.mjs", ["sequences", slug], { quiet: true }));
        if (rp) return rp;
        const seqs = (P.loadShotlist(slug).sequences || []).filter((q) => !q.editor);
        const chains = [];
        for (const q of seqs) { if (q.continues && chains.length && chains.at(-1).at(-1).id === q.continues) chains.at(-1).push(q); else chains.push([q]); }
        const okSeq = (id) => { const q = P.loadShotlist(slug).sequences.find((x) => x.id === id); return !!(q?.clips?.[q.clip]?.evals?.pass); };
        const res = (await pool(chains.filter((c) => c.some((q) => !okSeq(q.id))), 4, async (chain) => {
          const out = [];
          for (const q of chain) {
            if (okSeq(q.id)) continue;
            let r = await go("gen.mjs", ["sequence", slug, "--seq", q.id]);
            // The previous take drifted at its end: draw this scene's own keyframe (judged) and film it from there.
            const rekey = /REKEY: \S+ needs a fresh keyframe.*gen\.mjs frame \S+ (\S+) first/.exec(r.out || "");
            if (!r.ok && rekey) { const fr = await go("gen.mjs", ["frame", slug, rekey[1], "first", "--planned"]); if (fr.ok) r = await go("gen.mjs", ["sequence", slug, "--seq", q.id]); }
            if (r.ok && !okSeq(q.id)) r = await go("gen.mjs", ["sequence", slug, "--seq", q.id, "--redo"]);
            const ok = r.ok && okSeq(q.id);
            out.push({ id: q.id, ok, why: r.ok ? "the sequence fails its critics after one reroll" : stopLine(r.out) });
            if (!ok) break;
          }
          return out;
        })).flat();
        const bad = res.filter((x) => !x.ok);
        const s2 = P.loadShotlist(slug);
        if (Object.keys(s2.sfx || {}).length) { const r = await go("gen.mjs", ["sfx", slug]); if (!r.ok) bad.push({ id: "sfx", why: stopLine(r.out) }); }
        if (s2.music?.prompt && !(s2.music.files || []).length) { const r = await go("gen.mjs", ["music", slug, "--said", said]); if (!r.ok) bad.push({ id: "music", why: stopLine(r.out) }); }
        if (bad.length) return { stop: "engine", why: `${bad.length} item(s) need the creator: ${bad.map((b) => `${b.id}: ${b.why}`).join(" | ")}`, step: "film" };
        return null;
      }
      // Unbroken shots ("exact") open on the previous take's real last frame, so each run of them is filmed in order;
      // independent runs go at once (4 in flight). A failed take is refilmed once inside the book's reserve; a run
      // stops at its first shot that still fails, and every failure is reported together, never one stop per shot.
      const runs = [];
      for (const s of (sl.shots || []).filter(F.films)) {
        if (s.chain === "exact" && runs.length && runs.at(-1).at(-1).id === sl.shots[sl.shots.indexOf(s) - 1]?.id) runs.at(-1).push(s);
        else runs.push([s]);
      }
      const todoIds = new Set(todo.map((s) => s.id));
      const one = async (s) => {
        let r = await go("gen.mjs", ["clip", slug, "--shot", s.id]);
        const t = P.shot(P.loadShotlist(slug), s.id);
        if (r.ok && !F.takeOk(t.clips?.[t.clip])) r = await go("gen.mjs", ["clip", slug, "--shot", s.id, "--redo"]);
        const t2 = P.shot(P.loadShotlist(slug), s.id);
        return { id: s.id, ok: r.ok && F.takeOk(t2.clips?.[t2.clip]), why: r.ok ? "the take fails its evals after one reroll" : stopLine(r.out) };
      };
      const res = (await pool(runs.filter((run) => run.some((s) => todoIds.has(s.id))), 4, async (run) => {
        const out = [];
        for (const s of run) {
          if (!todoIds.has(s.id)) continue;
          const r = await one(s);
          out.push(r);
          if (!r.ok) break; // the next shot of the run would open on a failed take
        }
        return out;
      })).flat();
      const bad = res.filter((x) => !x.ok);
      // Sound is made while the takes are judged; a launch film's score is derived from the final cut later.
      const s2 = P.loadShotlist(slug);
      if (Object.keys(s2.sfx || {}).length) { const r = await go("gen.mjs", ["sfx", slug]); if (!r.ok) bad.push({ id: "sfx", why: stopLine(r.out) }); }
      if (s2.music?.prompt && !(s2.music.files || []).length) { const r = await go("gen.mjs", ["music", slug]); if (!r.ok) bad.push({ id: "music", why: stopLine(r.out) }); }
      if (bad.length) return { stop: "engine", why: `${bad.length} item(s) need the creator: ${bad.map((b) => `${b.id}: ${b.why}`).join(" | ")} (accept a take: studio.mjs accept-take, or a reroll with their yes)`, step: "film" };
      return null;
    }
    case "edit": if (sl.format === "launch") {
      // Music made late (a film step closed by an override) and the takes' frame-by-frame reviews come before the cut.
      const conf = (() => { try { return P.readJSON(path.join(P.projectDir(slug), "launch", "concepts.json")); } catch { return null; } })();
      if (conf?.config?.music && sl.music?.prompt && !(sl.music.files || []).length) { const r = need(await go("gen.mjs", ["music", slug, "--said", said])); if (r) return r; }
      const unreviewed = (sl.shots || []).filter((s) => F.films(s) && !(s.clips?.[s.clip]?.review?.ok && s.clips[s.clip].review.file === s.clips[s.clip].file)).map((s) => s.id);
      if (unreviewed.length) return { stop: "engine", agent: true, step: "edit", why: `review every take frame by frame before the cut (launch.mjs review ${slug} --shot <id>, then --ok with every point answered): ${unreviewed.join(", ")}` };
    }
      return need(await go(sl.format === "launch" ? "launch.mjs" : k === "scenes" ? "edit.mjs" : k === "longform" ? "longform.mjs" : "cut.mjs", sl.format === "launch" ? ["build", slug] : k === "longform" ? ["build", slug] : [slug]));
    case "qc": return need(await go("studio.mjs", ["qc", slug]));
    case "deliver": return need(await go("studio.mjs", ["deliver", slug]));
    default: return { stop: "engine", why: `${cur.name}: ${d}`, step: cur.id };
  }
}

// Runs passes until a stop, the delivery, or a pass that changes nothing (never loops on the same failure).
export async function autopilot(slug, said, { maxPasses = 40 } = {}) {
  const log = [], t0 = Date.now();
  let last = null;
  for (let i = 0; i < maxPasses; i++) {
    const before = F.status(P.loadShotlist(slug)).current;
    const sig = before ? `${before.id}|${before.detail}` : "done";
    if (sig === last) return { stop: "engine", why: `no progress on "${before.name}": ${before.detail}`, step: before.id, log, secs: (Date.now() - t0) / 1000 };
    last = sig;
    const r = await step(slug, said, log);
    if (r) return { ...r, log, secs: (Date.now() - t0) / 1000 };
  }
  return { stop: "engine", why: "too many passes", log, secs: (Date.now() - t0) / 1000 };
}
