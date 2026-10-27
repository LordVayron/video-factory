// Flow v5 checks for scripts/check.mjs: every lock stays in place. Offline, no spend.
// A throwaway project is created under projects/ and removed at the end.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import * as PA from "../engine/lib/pacing.mjs";
import { creatorMessages } from "./hooks/creator.mjs";
import * as FZ from "../engine/lib/freeze.mjs";
import * as ST from "./hooks/stamp.mjs";
import * as F from "../engine/lib/flow.mjs";
import * as P from "../engine/lib/project.mjs";
import * as PR from "../engine/lib/pricing.mjs";
import * as MOD from "../engine/lib/models.mjs";
import * as TRx from "../engine/lib/transfer.mjs";
import * as MED from "../engine/lib/meditation.mjs";
import { decide } from "./hooks/guard.mjs";
import { videoOptions, recommend } from "../engine/lib/pricing.mjs";

export default function checkFlow(t, ROOT) {
  const engine = (f) => fs.readFileSync(path.join(ROOT, "engine", f), "utf8");
  const stops = (fn) => { try { fn(); return false; } catch (e) { return e instanceof F.FlowStop; } };
  // A stray control character inside a regex silently breaks an engine rule.
  t("no control characters in engine or script sources", !["engine", path.join("engine", "lib"), "scripts"].some((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(mjs|py)$/.test(f)).some((f) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(path.join(ROOT, d, f), "utf8")))));
  t("no --force anywhere in the engine", !["gen.mjs", "edit.mjs", "cut.mjs", "studio.mjs", "longform.mjs", "book.mjs"].some((f) => engine(f).includes('"--force"')));
  t("no command still uses the retired requirePhases gate", !fs.readdirSync(path.join(ROOT, "engine")).filter((f) => f.endsWith(".mjs")).some((f) => /requirePhases\(sl/.test(engine(f))));
  for (const [f, step] of [["gen.mjs", 'requireStep(sl, "film", "gen clip")'], ["gen.mjs", 'requireStep(sl, "board", "gen storyboard")'], ["edit.mjs", "requireStep(sl, draft"], ["cut.mjs", "requireStep(sl, draft"], ["radio.mjs", 'requireStep(sl, "radio"'], ["animatic.mjs", 'requireStep(sl, "board"'], ["longform.mjs", 'requireStep(sl, "edit"'], ["book.mjs", "F.requireStep(sl"]])
    t(`${f} is gated (${step.slice(0, 40)})`, engine(f).includes(step));
  t("job() refuses projects outside flow v5", engine("gen.mjs").includes("assertV5(sl0)"));
  t("a video with acting people names its need and the book waits for two models tested on it", PR.needsOf({ shots: [{ characters: ["a"] }], style: "painted" }, { kind: "custom" })[0] === "stylized-acting" && Object.keys(PR.testedModels({ shots: [{ id: "S1", clips: [{ test: true, model: "m1" }, { test: true, model: "m2" }] }] })).length === 2 && fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("compare at least two video models on one shot before the book") && !fs.readFileSync(path.join(ROOT, "engine", "lib", "pricing.mjs"), "utf8").includes("export const FIT "));
  t("the pick is the best model for the job, then the cheapest of the best; only good models are offered", (() => { const fits = { j: { a: [{ fit: 9 }], b: [{ fit: 8 }], c: [{ fit: 4 }] } }; const o = [{ key: "a", credits: 300, usd: 1.5 }, { key: "b", credits: 100, usd: 0.5 }, { key: "c", credits: 50, usd: 0.25 }, { key: "d", credits: 10, usd: 0.05 }]; const job = PR.forTheJob(o, ["j"], fits); return PR.recommend(o, { format: "launch", budget: { mode: "cheapest" }, needs: ["j"], fits })?.key === "b" && job.good.length === 2 && job.untested[0]?.key === "d" && job.poor[0]?.key === "c"; })());
  t("a launch film with music needs a music brief tied to the script", (() => { const src = fs.readFileSync(path.join(ROOT, "engine", "lib", "launch.mjs"), "utf8"); return src.includes("musicBrief: z.object") && src.includes("no musicBrief"); })());
  t("re-approving the book keeps the budget the creator already approved", engine("lib/flow.mjs").includes("next = Math.max(Math.ceil(spent + sl.bookEstimate), prev)"));
  t("two jobs started at once claim different file names (atomic .reserve)", engine("gen.mjs").includes('fs.openSync(b + ".reserve", "wx")') && engine("gen.mjs").includes('fs.rmSync(`${args.outBase}.reserve`'));
  t("motion transfer: Kling motion control and Wan Animate take a reference clip and a character image", (() => { const { MODELS } = MOD; const r = { video: "v", frame: "i", res: "720p", duration: 10 }; return MODELS["kling3-mc"].build(r).video_urls[0] === "v" && MODELS["kling3-mc"].build(r).input_urls[0] === "i" && MODELS["wan-replace"].build(r).video_url === "v" && MODELS["wan-move"].build(r).image_url === "i" && MODELS["kling3-mc"].cost(r) === 200 && engine("gen.mjs").includes("async transfer()"); })());
  {
    // Motion transfer, offline: the take is measured against the source, long clips are filmed in pieces and joined, the source audio goes back on.

    const wave = Array.from({ length: 120 }, (_, i) => Math.sin(i / 4) + 1.5);
    t("transfer: a take that moves like the source passes the motion match, an unrelated one fails", TRx.matchCurves(wave, wave).pass && !TRx.matchCurves(wave, wave.map((_, i) => Math.cos(i / 1.3) + 1.5)).pass);
    t("transfer: a take that runs late against the source is caught", (() => { const r = TRx.matchCurves(wave, [...Array(5).fill(1.5), ...wave].slice(0, 120)); return !r.pass && /late|early/.test(r.issues.join()); })());
    t("transfer: gestures in other places than in the source fail the zone match", (() => { const g = (sw) => Array.from({ length: 60 }, (_, i) => Array.from({ length: 16 }, (_, c) => (c === (sw ? 15 : 0) ? 5 + Math.sin(i / 3) * 4 : 1))); return TRx.zoneMatch(g(false), g(false)) > TRx.ZONE_MIN && TRx.zoneMatch(g(false), g(true)) < TRx.ZONE_MIN; })());
    t("transfer: object swap changes one thing and keeps the rest", /Change ONLY the jacket/.test(TRx.swapPrompt("the jacket", true)) && /Everything else stays exactly/.test(TRx.swapPrompt("the jacket", true)));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trx-"));
    try {
      const src = path.join(tmp, "src.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=14", "-f", "lavfi", "-i", "sine=frequency=440:duration=14", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
      const pcs = TRx.planPieces(src, 10);
      t("transfer: a clip over the model's limit is planned in overlapping pieces within the limit, covering the whole clip", pcs.length === 2 && pcs.every((p) => p.end - p.start <= 10.001) && pcs[0].start === 0 && Math.abs(pcs.at(-1).end - TRx.duration(src)) < 0.05 && pcs[1].start < pcs[0].end);
      const files = pcs.map((p, i) => TRx.cutPiece(src, p, path.join(tmp, `p${i}.mp4`)));
      const joined = TRx.joinPieces(files, pcs, path.join(tmp, "joined.mp4"));
      t("transfer: the joined pieces last as long as the source (no time lost or doubled at the joins)", Math.abs(TRx.duration(joined) - TRx.duration(src)) < 0.15);
      const withAudio = TRx.keepSourceAudio(joined, src, path.join(tmp, "final.mp4"));
      t("transfer: the source audio is laid back on the take", withAudio.audio && TRx.hasAudio(withAudio.out));
      t("transfer: the joined take still moves like the source", TRx.motionMatch(src, withAudio.out).pass);
      const dark = path.join(tmp, "dark.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", files[1], "-vf", "eq=brightness=-0.12:saturation=0.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", dark]);
      const bad = TRx.joinCheck([files[0], dark], pcs);
      t("transfer: a piece filmed with another look fails the join check", !bad.pass);
      const fixed = TRx.matchLook(dark, bad.raw[0].a, bad.raw[0].b, path.join(tmp, "fixed.mp4"));
      t("transfer: matching the piece's look to the previous one makes the join pass", TRx.joinCheck([files[0], fixed], pcs).pass && TRx.joinCheck(files, pcs).pass);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    t("transfer: edit models declare their clip and reference limits, and --char uses the approved standard sheet", MOD.MODELS["wan27-edit"].maxSecs === 10 && MOD.MODELS["wan27-edit"].maxRefs === 1 && engine("gen.mjs").includes("MS.sheetOf(c, styleId)") && engine("gen.mjs").includes("TR.motionMatch(clip, out)") && engine("gen.mjs").includes("TR.chainRef(") && engine("gen.mjs").includes("TR.joinCheck(takes, pieces)"));
  }
  t("job() refuses video spend without the locked budget", engine("gen.mjs").includes('if (cap == null && !["image", "voice"].includes(m.kind) && !test) throw'));
  t("a motion test before the book is capped and marked test in the ledger", /const TEST_CAP = \d+;/.test(engine("gen.mjs")) && engine("gen.mjs").includes("cap == null && test && testSpent()") && engine("gen.mjs").includes("...(test ? { test: true } : {})"));

  const slug = `_check-${process.pid}`, d = path.join(P.PROJECTS, slug);
  try {
    P.writeJSON(path.join(d, "shotlist.json"), { slug, title: "check", format: "influencer", ar: "9:16", lang: "en", style: "hyperreal", shots: [] });
    t("a project without flow v5 cannot run anything", stops(() => F.requireStep(P.loadShotlist(slug), "board")));
    P.updateShotlist(slug, (x) => { x.flow = { v: 5, archived: "test" }; });
    t("an archived project cannot run anything", stops(() => F.requireStep(P.loadShotlist(slug), "board")));
    P.updateShotlist(slug, (x) => { x.flow = { v: 5, approved: {}, overrides: [], log: [] }; x.intake = { series: "single", format: "influencer", start: "idea", platform: {}, cast: "none", budget: {}, refs: {} }; x.refsChoice = { ids: [], said: "check" }; }); // the bank may hold influencer references: this test chose none
    fs.writeFileSync(path.join(d, "concept.md"), "# c");
    t("filming waits for every step before it", stops(() => F.requireStep(P.loadShotlist(slug), "film")));
    t("an approval needs the creator's words", stops(() => F.approve(slug, "concept", "")));
    F.approve(slug, "concept", "check");
    t("an approval moves the flow forward", F.stepStatus(P.loadShotlist(slug), "concept").ok);
    fs.appendFileSync(path.join(d, "concept.md"), "\nchanged");
    t("changing an approved step reopens it", !F.stepStatus(P.loadShotlist(slug), "concept").ok);
    t("a clips project with zero shots has nothing filmed", !F.stepStatus(P.loadShotlist(slug), "film").ok);
    t("a take that failed an eval is not usable", !F.takeOk({ evals: { identity: { pass: true }, jumps: { internal: 1 }, dialogue: { pass: true } } }));
    t("a take the creator accepted in their words is usable", F.takeOk({ evals: { identity: { pass: false } }, accepted: { said: "yes" } }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  {
    const sc = { id: "A", shots: ["A1"], want: "" };
    const bad = F.sitcomScriptRules({ format: "sitcom", flow: { created: "2099-01-01" }, scenes: [sc], shots: [{ id: "A1", scene: "A", dialogue: [{ char: "b", text: "Step one, we take the money." }] }] });
    t("sitcom: a new script needs the lead's want, beats on every line, a punchline per scene and no step lists", bad.some((x) => /wants/.test(x)) && bad.some((x) => /setup, punch or tag/.test(x)) && bad.some((x) => /steps or phases/.test(x)) && bad.some((x) => /no punchline/.test(x)));
  }
  {
    const scene = { id: "A", shots: ["A1"], lighting: "neon night city" };
    const shots = [{ id: "A1", scene: "A", characters: ["a", "b", "c"], motion: "she leaps across the rooftop", dialogue: [] }];
    const drama = F.dramaRules({ format: "micro-drama", scenes: [scene], shots }), anime = F.dramaRules({ format: "anime", scenes: [scene], shots });
    t("anime keeps night, neon, crowds and action; micro-drama refuses them", drama.some((x) => /night light/.test(x)) && drama.some((x) => /fast motion/.test(x)) && !anime.some((x) => /night light|fast motion|characters in frame/.test(x)));
  }
  {
    const steady = Array.from({ length: 40 }, (_, k) => ({ w: "word", start: 0.3 + k * 0.38, end: 0.3 + k * 0.38 + 0.3 }));
    const slow = [{ w: "so", start: 2.4, end: 2.6 }, ...Array.from({ length: 10 }, (_, k) => ({ w: "word", start: 3 + k, end: 3.3 + k }))];
    t("talking short-form pacing: a steady take passes, a late, slow, stalling one fails", !PA.pacingFromWords(steady, "ugc", 15.5).length && PA.pacingFromWords(slow, "ugc", 14).length >= 3);
  }
  t("delivery of realistic synthetic people needs the AI label in the creator's words (studio.mjs disclose)", engine("studio.mjs").includes("record how the video is labelled as AI") && engine("studio.mjs").includes("aiDisclosure: sl.aiDisclosure"));
  {
    const md = (extra) => F.dramaRules({ format: "micro-drama", flow: { created: "2099-01-01" }, scenes: [{ id: "A", shots: ["A1"], ...extra.scene }], shots: [{ id: "A1", scene: "A", dialogue: [{ char: "a", text: "You lied to me." }] }], ...extra.sl });
    const bare = md({ scene: {}, sl: {} }), good = md({ scene: { powerShift: { from: "a", to: "b", line: "You lied to me." } }, sl: { cliffhanger: "reversal" } });
    t("micro-drama: a new episode needs a power shift per scene and a named cliffhanger", bare.some((x) => /power shift/.test(x)) && bare.some((x) => /cliffhanger/.test(x)) && !good.some((x) => /power shift|cliffhanger/.test(x)));
  }
  t("a plan changed after the approved book spends nothing until the creator approves the new live estimate (REPLAN STOP, approve-replan)", engine("gen.mjs").includes("REPLAN STOP") && engine("studio.mjs").includes("approve-replan") && engine("lib/flow.mjs").includes("sl.bookPlan = planSha(sl)"));
  t("no paid job is sent when the providers' live balance does not cover it (BALANCE STOP)", engine("gen.mjs").includes("BALANCE STOP") && engine("gen.mjs").includes("balancesCached()"));
  t("every filmed format compares two models before the book and puts the providers' new models to the creator (waive-compare, new-models)", engine("lib/flow.mjs").includes("compare at least two video models") && engine("lib/flow.mjs").includes("show the creator the new models on Kie") && engine("studio.mjs").includes('"new-models"()') && engine("studio.mjs").includes('"waive-compare"()'));
  t("a remake walks every step in order and spends nothing before a fresh model analysis and an approved estimate (remake, REMAKE STOP)", engine("studio.mjs").includes("remake() {") && engine("studio.mjs").includes("remakePricing") && engine("gen.mjs").includes("REMAKE STOP") && engine("studio.mjs").includes("after the remake started"));
  // The script reaches the video model word for word (a visual-only prompt lets the model improvise a paid take).
  t("job() stops a speaking video job whose prompt leaves out a line (DIALOGUE STOP)", engine("gen.mjs").includes("DIALOGUE STOP") && engine("gen.mjs").includes("P.linesMissing(req.prompt, req.lines)"));
  t("gen clip sends the clip prompt with the script and declares its lines", engine("gen.mjs").includes("prompt: fitPrompt([P.clipPrompt(sl, s), clipFixes].filter(Boolean).join(\" \"), getModel(model)), lines: s.dialogue || []"));
  t("a refilm carries the last failed take's notes and stops after two failures (CLIP STOP)", engine("gen.mjs").includes("CLIP STOP") && engine("gen.mjs").includes("previous take failed"));
  t("scene and shot video jobs declare their script lines", engine("gen.mjs").includes("lines: shots.flatMap((s) => s.dialogue || [])") && engine("gen.mjs").includes("lines: s.dialogue || [], frame, lastFrame"));
  t("the Production Book shows the prompt the model receives", engine("book.mjs").includes("P.clipPrompt(sl, s)"));
  t("gen clip keeps a paid take when an eval can't run (--eval re-runs it)", engine("gen.mjs").includes("--eval ${n}") && engine("gen.mjs").includes("evals: null"));
  t("a shot opening on the previous take reads its real last frame", engine("gen.mjs").includes('"-update", "1"'));
  {
    const cid = `_check-${process.pid}`, cdir = path.join(P.BIBLE, "characters", cid);
    P.writeJSON(path.join(cdir, "character.json"), { id: cid, name: "Checky", species: "human", look: "woman" });
    try {
      const sl = { lang: "en" }, line = { char: cid, text: "Okay, I swear this is my third bottle, and I'm obsessed." };
      const pr = P.clipPrompt(sl, { prompt: "Selfie in a bathroom.", dialogue: [line] });
      t("the clip prompt carries every line word for word", pr.includes(`"${line.text}"`) && !P.linesMissing(pr, [line]).length);
      t("the clip prompt asks for a natural pace", /natural pace/.test(pr));
      t("a prompt without the line is caught", P.linesMissing("Selfie in a bathroom.", [line]).length === 1);
      t("a prompt that already quotes the line is sent as written", P.clipPrompt(sl, { prompt: `She says "${line.text}"`, dialogue: [line] }) === `She says "${line.text}"`);
      t("a silent clip says nobody speaks", /No dialogue/.test(P.clipPrompt(sl, { prompt: "Bottle on a counter." })));
      // A real scene prompt is built (a runtime error here once stopped the book): the spec carries pose and must-nots.
      const dsl = { format: "micro-drama", lang: "en", style: "hyperreal", title: "t", scenes: [{ id: "A", shots: ["s1", "s2"], summary: "x", seats: { [cid]: { place: "beside the table", side: "right", pose: "standing", holding: "a glass" } } }], shots: [{ id: "s1", characters: [cid], framing: "wide shot of the table", duration: 2, dialogue: [line] }, { id: "s2", characters: [cid], framing: "close-up", duration: 2, dialogue: [] }] };
      let dp = "";
      try { dp = P.scenePrompt(dsl, dsl.scenes[0], []); } catch (e) { dp = `ERROR ${e.message}`; }
      let sp = ""; try { sp = P.shotPrompt(dsl, dsl.scenes[0], dsl.shots[0], 2500); } catch (e) { sp = `ERROR ${e.message}`; }
      t("a shot prompt for first-frame models fits the model's limit and keeps the line and the spec", sp.length <= 2500 && sp.includes(line.text) && /must_not/.test(sp));
      t("job() refuses a prompt longer than the model takes", engine("gen.mjs").includes("m.maxPrompt && typeof req.prompt") && fs.readFileSync(path.join(ROOT, "engine", "lib", "models.mjs"), "utf8").includes("maxPrompt: 2500"));
      t("a drama scene prompt builds, with each shot's spec, pose and must-not list", /Shot 1 SPEC/.test(dp) && /STANDING/.test(dp) && /sitting down/.test(dp) && dp.includes(line.text));
    } finally { fs.rmSync(cdir, { recursive: true, force: true }); }
  }

  // Pilot gate, format readiness and a reopened book that must not re-estimate filmed scenes.
  {
    const sc = { kind: "x", slug: "p", format: "micro-drama", scenes: [{ id: "A" }, { id: "B" }], flow: { v: 5, approved: {} } };
    t("pilot gate: only the first scene can be filmed before the creator approves the pilot", stops(() => F.requirePilot(sc, ["A", "B"])) && !stops(() => F.requirePilot(sc, ["A"])));
    t("pilot gate: an approved pilot opens the rest", !stops(() => F.requirePilot({ ...sc, flow: { v: 5, approved: { pilot: { said: "yes" } } } }, ["B"])));
    t("pilot gate is wired into gen scenes and gen clip", engine("gen.mjs").includes("requirePilot(sl, todo.map((sc) => sc.id))") && engine("gen.mjs").includes("requirePilot(sl, [id])"));
    t("a format its editor can't finish stops before prices and the book", !F.editReady({ format: "cinematic" }) && F.editReady({ format: "micro-drama" }) && F.editReady({ format: "sitcom" }) && F.editReady({ format: "ugc" }));
    t("the book estimates only what is still to film", engine("book.mjs").includes("filmed(sc) ? 0 :") && engine("book.mjs").includes("filmed(s) ? 0 :"));
    t("the dialogue check spells heard numbers (\"400\" = \"four hundred\")", fs.readFileSync(path.join(ROOT, "engine", "lib", "align.py"), "utf8").includes("def spell(n)"));
    t("the book can't be built if a character in a scene lacks its full-body (wardrobe) view", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("carries no full-body view"));
    t("scenes send each character's full-body view", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("(full body, exact wardrobe)"));
    t("the book shows every image each scene sends to the model", engine("book.mjs").includes("Image 1 · opening frame") && engine("book.mjs").includes("refThumb(r.file"));
    t("edit.mjs scores a drama: ducked score, swell into the freeze, ending sting", engine("edit.mjs").includes("5a. Drama sound design") && engine("edit.mjs").includes("if (sl.endCue)"));
    t("a drama can't reach the book without its score, a power-shift sting and an ending sting", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("SOUND NOT PLANNED"));
    t("a draft can cut only the filmed scenes (the pilot preview) and never writes the shotlist", engine("edit.mjs").includes("if (!partial) P.saveShotlist(slug, sl);"));
    t("the score is part of the book's locked budget", engine("book.mjs").includes("Score (Suno)"));
    t("a fixed intake budget is a hard cap on every paid job, before and after the book", engine("gen.mjs").includes("HARD CAP") && fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("passes the fixed cap") && engine("phase.mjs").includes("the project's fixed cap"));
    t("cast sheets and plates can be charged to the project", engine("cast.mjs").includes('...(project ? ["--project", project] : [])'));
    t("every non-sitcom shot gets a structured spec (who is in frame, everyone's pose and props, must-not list)", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("everyone_in_the_room") && fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("must_not"));
    t("outside the sitcom every pose is planned and only a move can change it", fs.readFileSync(path.join(ROOT, "engine", "lib", "state.mjs"), "utf8").includes("has no pose (seats.") && fs.readFileSync(path.join(ROOT, "engine", "lib", "state.mjs"), "utf8").includes("String(p.pose"));
    t("character sheets are drawn in a neutral reference pose", engine("cast.mjs").includes("Neutral reference pose in every panel"));
    t("a character can send a chosen sheet view as its reference (refView)", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("c.refView && v[c.refView]"));
    t("seated characters belong to the scene's cast", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("...Object.keys(sc.seats || {})"));
    {
      const D = { format: "micro-drama", scenes: [{ id: "A", shots: ["d1"], lighting: "night, candle light" }], shots: [{ id: "d1", characters: ["a", "b", "c"], duration: 2, motion: "She picks up the ring", dialogue: [{ char: "a", text: "one two three four five six seven eight nine ten" }] }] };
      const r = F.dramaRules(D).join(" | ");
      t("drama rules block dim light, 3 people in a shot, hand-object work and too many words", /low or night light/.test(r) && /3 characters/.test(r) && /hand-and-object/.test(r) && /words in/.test(r));
      const D2 = { format: "micro-drama", radio: { length: 120 }, scenes: [{ id: "A", shots: ["e1", "e2", "e3"], lighting: "soft daylight" }], shots: [{ id: "e1", characters: ["a"], framing: "wide establishing shot", duration: 4, image: "cinematic stunning room", dialogue: [] }, { id: "e2", characters: ["a"], framing: "close-up", duration: 4, motion: "She stares", dialogue: [] }, { id: "e3", characters: ["a"], framing: "low angle close-up", duration: 8, dialogue: [{ char: "a", text: "one two three" }] }] };
      const r2 = F.dramaRules(D2).join(" | ");
      t("drama rules block a late hook, an establishing opener, long reactions and shots, vague words, extreme angles, wrong length", /the first line comes/.test(r2) && /establishing shot/.test(r2) && /s reaction/.test(r2) && /talking shot/.test(r2) && /vague word/.test(r2) && /extreme angle/.test(r2) && /range 25-90/.test(r2));
      t("a drama's cast needs an approved look test before any storyboard or video", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("the look test is missing") && engine("studio.mjs").includes('"approve-look"()'));
      {
        // Each close-up of the same person must keep one background across scenes.
        const A = { format: "micro-drama", scenes: [{ id: "A", shots: ["x1", "x2"] }, { id: "B", shots: ["x3", "x4"] }], shots: [{ id: "x1", characters: ["a"], framing: "close-up on A" }, { id: "x2", characters: ["b"], framing: "close-up on B" }, { id: "x3", characters: ["a"], framing: "close-up on A" }, { id: "x4", characters: ["a", "b"], framing: "wide two-shot" }] };
        const need = P.anglesNeeded(A);
        t("everyone with close-ups in more than one scene needs one locked angle frame (not the sitcom)", need.length === 1 && need[0] === "a" && P.anglesNeeded({ ...A, format: "sitcom" }).length === 0);
        const flowSrc = fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8"), projSrc = fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8");
        t("the board step refuses missing angle frames and grids drawn before them", flowSrc.includes("has no locked angle frame") && flowSrc.includes("was made without the current angle frames") && engine("gen.mjs").includes("scx.gridAngles ="));
        t("angle frames reach every storyboard and scene with that person's close-up", projSrc.includes('role: "angle"') && projSrc.includes("locked camera angle for EVERY close-up"));
        t("the final QC compares every close-up's background across scenes", engine("studio.mjs").includes("backgroundCheck(file, sl, cast)"));
        t("a passing continuity take becomes the scene's chosen take", engine("continuity.mjs").includes("if (result.pass && (s.clip == null"));
        t("a voice reference that speaks the script is refused (VOICE REF STOP)", engine("gen.mjs").includes("VOICE REF STOP"));
        t("the radio cut refuses slow-motion tempo", engine("radio.mjs").includes("pace.tempo < 0.85"));
        t("a radio cut that reads too fast re-voices itself slower, step by step (ElevenLabs speed, multilingual v2)", engine("radio.mjs").includes("const SLOWER = [") && engine("radio.mjs").includes("autoStep: step + 1"));
        t("a background drift only in a silent tail is trimmed automatically and the take judged again", engine("continuity.mjs").includes("async function evalWithTailTrim") && engine("continuity.mjs").includes("start < lastWord + 0.8"));
        // Speaking rate: Wan 3.0 Prime measured at 191-204 wpm is not recommended for a drama while another model fits.

        const opts = [{ key: "wan3-prime", q: 8, credits: 600, usd: 3 }, { key: "sd2-fast", q: 7, credits: 590, usd: 2.95 }];
        t("a model measured speaking too fast is not recommended for a speaking format", PR.measuredWpm("wan3-prime") > 175 && PR.recommend(opts, { format: "micro-drama", budget: { mode: "fixed", usd: 5 }, maxWpm: 175 }).key === "sd2-fast" && PR.recommend(opts, { format: "micro-drama", budget: { mode: "fixed", usd: 5 } }).key === "wan3-prime");
        t("every cut records the model's speaking rate, and a fast pilot needs the creator's explicit yes (--ok-fast)", engine("edit.mjs").includes("recordSpeechRate(sl.defaults?.videoModel") && engine("studio.mjs").includes('argv.includes("--ok-fast")'));
        // Guided meditations: one universal engine; the intention sets pace, pauses, music and safety.

        const med = (o = {}) => ({ format: "meditation", longform: { intent: "sleep", premise: "Rain on a cabin window lets the day wash away.", demo: true, seconds: 25,
          scenes: [{ id: "A", picture: "a dark cozy room, rain streaks on a window, a warm lamp reflected in the glass, no people, no text", motion: "raindrops slide slowly down the glass, steady drizzle", premiseLink: "the rain that washes the day away" }],
          music: { prompt: "soft felt piano and warm pads, 62 bpm, instrumental, no vocals, no drums" },
          script: [{ text: "Listen to the rain...", pauseAfter: 3 }, { text: "Let your shoulders soften... your jaw... your hands.", pauseAfter: 3 }, { text: "There's nowhere you have to be.", pauseAfter: 4 }], ...o } });
        t("a well-planned sleep demo passes the meditation rules", MED.meditationRules(med()).length === 0);
        const bad = MED.meditationRules(med({ intent: "sleep", premise: "", scenes: [{ id: "A", picture: "a woman looking at the camera with a title", motion: "fast zoom in" }], music: { prompt: "epic drums with vocals, 120 bpm" }, script: [{ text: "Breathe.", pauseAfter: 1 }, { text: "Now.", pauseAfter: 1 }] })).join(" | ");
        t("meditation rules block a missing premise, faces or text, fast motion, wrong tempo, drums and vocals, short pauses", /premise/.test(bad) && /premiseLink/.test(bad) && /faces/.test(bad) && /breaks the loop/.test(bad) && /120 bpm/.test(bad) && /instrumental/.test(bad) && /1 s pause/.test(bad));
        t("the engine is universal: sleep, anxiety, higher self, manifestation, morning, self-love, breathwork, focus", ["sleep", "anxiety", "higher-self", "manifestation", "morning", "self-love", "breathwork", "focus"].every((k) => MED.INTENTS[k]?.wpm));
        t("a full sleep piece needs its safety line; a dark screen only on pieces that don't return", /safety line/.test(MED.meditationRules(med({ demo: false, minutes: 1 })).join()) && /dark screen/.test(MED.meditationRules(med({ intent: "morning", darkAfter: 20, music: { prompt: "light piano, 80 bpm, instrumental, no vocals" } })).join()));
        t("the creator's written meditation is locked word for word, and the creator's own image is not linted", /word for word/.test(MED.meditationRules(med({ scriptBy: "creator", scriptSource: "something else entirely" })).join()) && MED.meditationRules(med({ scriptBy: "creator", scriptSource: "Listen to the rain... Let your shoulders soften... your jaw... your hands. There's nowhere you have to be." })).length === 0 && MED.meditationRules(med({ scenes: [{ id: "A", picture: "a woman with a title", imageBy: "creator", motion: "mist drifts slowly", premiseLink: "the lake" }] })).length === 0);
        t("a written meditation is imported word for word, split at sentence ends with the intention's pauses", engine("longform.mjs").includes("function importScript()") && engine("longform.mjs").includes("the split changed the creator's words") && engine("longform.mjs").includes("function importImage()"));
        t("a loop is generated from its first frame only, measured for motion, and a frozen loop stops the build (LOOP STATIC)", !engine("gen.mjs").includes("frame: url, lastFrame: url") && engine("gen.mjs").includes("motionScore(clip)") && engine("longform.mjs").includes("LOOP STATIC") && MED.MIN_MOTION > 0);
        t("narration turns '...' into real breath breaks, longer for sleep", engine("gen.mjs").includes('<break time="${V.breath ?? (L.intent === "sleep" ? 1.3 : 0.8)}s" />'));
        t("the recorded narration is checked against the intention's pace", MED.voicePace([{ text: "one two three four five six seven eight nine ten", d: 3 }], "sleep").issues.length === 1 && MED.voicePace([{ text: "one two three four five", d: 3.3 }], "sleep").issues.length === 0);
        t("long-form builds have a demo mode, a dark screen and a YouTube package, and the script gate runs the meditation rules", engine("longform.mjs").includes("isDemo(L) ? 1.5 : 20") && engine("longform.mjs").includes("piece-black.ts") && engine("longform.mjs").includes("-youtube.md") && fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("meditationRules(sl).length"));
        // The angle cycle on a real filmed drama (its cast and set from the bible), no spend: an angle frame reaches
        // the scene's refs and prompt. Runs where that project exists (the private studio).
        const realDrama = path.join(ROOT, "projects", ["drama", 3].join(""), "shotlist.json");
        if (fs.existsSync(realDrama)) try {
          const sl3 = JSON.parse(fs.readFileSync(realDrama, "utf8"));
          const leads = P.anglesNeeded(sl3);
          const img = (id) => { const d = P.character(id).dir; return path.relative(ROOT, path.join(d, fs.readdirSync(d).find((f) => /\.(png|jpe?g)$/i.test(f)))).replace(/\\/g, "/"); };
          const withAngles = { ...sl3, angles: Object.fromEntries(leads.map((id) => [id, img(id)])) };
          const scB = withAngles.scenes.find((x) => x.id === "B"), refsB = P.sceneRefs(withAngles, scB);
          const promptB = P.scenePrompt(withAngles, scB, refsB);
          t("a real drama needs angle frames for both leads, and scene B's references and prompt carry them", leads.length === 2 && refsB.filter((r) => r.role === "angle").length === 2 && leads.every((id) => promptB.includes(`locked camera angle for EVERY close-up of ${P.character(id).name}`)) && P.anglePrompt(withAngles, leads[0]).includes("ONE frame"));
        } catch (e) { t(`angle cycle on a real drama (${e.message.slice(0, 80)})`, false); }
      }
      t("drama rules feed the board check, so a failing plan never reaches the book", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("bad.push(...dramaRules(sl))"));
      t("outside the sitcom the take's own (lip-synced) voice is kept by default", engine("edit.mjs").includes('sl.voiceUnify === true || (sl.voiceUnify !== false && sl.format === "sitcom")'));
    }
    t("edit.mjs keeps a drama's pauses and drops sitcom laugh rules for other formats", engine("edit.mjs").includes('sl.format !== "sitcom" ? [] :') && engine("edit.mjs").includes("rules.maxFirstLaugh != null"));
  }

  // Live price analysis comes before every Production Book, and its pick drives the estimate and the film.
  t("every recipe runs the live price analysis right before the book", ["sitcom", "influencer", "meditation"].every((f) => { const r = F.recipe({ format: f, intake: {} }); return r.indexOf("models") === r.indexOf("book") - 1; }));
  t("no model is hidden from the price analysis by rule", !fs.readFileSync(path.join(ROOT, "engine", "lib", "models.mjs"), "utf8").includes("hidden: true"));
  {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "engine", "prices.json"), "utf8"));
    const pick = (format, kind, baseline) => recommend(videoOptions(rows, { format, kind, seconds: 16, clips: 2 }), { format, budget: { mode: "cheapest" }, baseline })?.key;
    t("price analysis: photoreal influencer gets the top tier", pick("influencer", "clips", "veo") === "veo");
    t("price analysis: the sitcom keeps its cheap scene model", pick("sitcom", "scenes", "sd2-mini") === "sd2-mini");
    t("price analysis: scenes formats never get a model that can't film multi-shot scenes", videoOptions(rows, { format: "sitcom", kind: "scenes", seconds: 30 }).every((o) => !o.key.startsWith("veo")));
  }

  // The Claude Code guard (.claude/settings.json → scripts/hooks/guard.mjs).
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "settings.json"), "utf8"));
  t("the guard hook is configured", JSON.stringify(settings.hooks?.PreToolUse || []).includes("scripts/hooks/guard.mjs"));
  const runner = path.join(ROOT, ".cache", `_runner-${process.pid}.mjs`);
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(runner, ["import * as k from", '"../engine/lib/' + "kie.mjs\";", "await k.create" + 'Task("x", {});'].join(" "));
  const g = (tool, input) => !!decide({ tool_name: tool, tool_input: input });
  t("guard denies a one-off runner script that calls Kie", g("Bash", { command: `node "${runner}"` }));
  fs.rmSync(runner, { force: true });
  t("guard denies inline speech-to-speech", g("Bash", { command: "node --input-type=module -e \"import { sts } from './engine/lib/" + "eleven.mjs'; await sts({})\"" }));
  t("guard denies curl to Kie", g("PowerShell", { command: "curl https://api." + "kie.ai/api/v1/jobs/createTask" }));
  t("guard denies writing a runner outside the engine", g("Write", { file_path: path.join(ROOT, ".cache", "x.mjs"), content: 'import * as kie from "../engine/lib/' + 'kie.mjs"' }));
  t("guard allows a Python doc script that only names an engine module", !g("Write", { file_path: path.join(ROOT, ".cache", "docs.py"), content: "s = \"see lib/" + "identity.mjs\"" }));
  t("guard denies a Python script that calls Kie directly", g("Write", { file_path: path.join(ROOT, ".cache", "x.py"), content: "requests.post(\"https://api." + "kie.ai/x\")" }));
  // Spend rules that read the creator's own messages (every format).
  const said = (cmd, texts) => !!decide({ tool_name: "Bash", tool_input: { command: cmd } }, { messages: texts.map((text, k) => ({ text, at: String(k) })) });
  t("guard denies a shell loop around a paid engine command", said("for n in 1 2; do node engine/gen.mjs frame x S$n first --planned; done", ["go"]));
  t("guard allows a shell loop with no paid command", !said("for f in a b; do ffmpeg -i $f.png $f.jpg; done", ["go"]));
  t("guard ignores loop words inside heredocs and quotes", !said("node engine/gen.mjs credits; cat <<'EOF' > x.txt\nfor n in 1; do node engine/gen.mjs clip x; done\nEOF", ["go"]));
  t("guard denies a paid job when the creator's last message is a question", said("node engine/gen.mjs clip x --shot S1", ["sí", "why is it taking so long?"]) && said("node engine/gen.mjs clip x --shot S1", ["por qué gastaste tanto"])); // data: the creator's words
  t("guard allows a free command after a question", !said("node engine/gen.mjs credits", ["why is it taking so long?"]));
  t("guard denies --said words the creator never wrote", said('node engine/studio.mjs approve x book --said "sí, apruebo"', ["hola"])); // data: the creator's words
  t("guard allows --said quoted from the creator", !said('node engine/studio.mjs approve x book --said "Apruebo el book"', ["Apruebo el book, dale"]));
  t("guard denies --said passed as a variable", said('node engine/studio.mjs approve x book --said "$W"', ["Apruebo"]));
  t("guard denies a retry authorized by words that don't say yes", said('node engine/gen.mjs frame x S1 first --planned --said "create the damn video"', ["omg create the damn video"]));
  t("guard allows a retry the creator said yes to", !said('node engine/gen.mjs frame x S1 first --planned --said "Sí, reintenta"', ["Sí, reintenta el final"])); // data: the creator's words
  t("guard reads an accented yes as a yes", !said('node engine/gen.mjs clip x --shot S1 --said "sí"', ["sí"])); // data: the creator's words
  // ENGINE FREEZE and CANCELLED hold for every format.
  {
    const cur = FZ.engineSha();
    let stamped = null;
    t("engine freeze: a project with no engine recorded gets stamped, not stopped", FZ.freezeProblem({ slug: "x" }, { current: cur, stamp: (v) => (stamped = v) }) === null && stamped === cur);
    t("engine freeze: a paid job stops when the engine changed mid-production", /ENGINE FREEZE/.test(FZ.freezeProblem({ slug: "x", engine: { sha: "old" } }, { current: cur }) || ""));
    t("engine freeze: a delivered project is not frozen; a remake after delivery is", FZ.freezeProblem({ slug: "x", engine: { sha: "old" }, flow: { log: [{ event: "deliver", at: "2" }] } }, { current: cur }) === null && /ENGINE FREEZE/.test(FZ.freezeProblem({ slug: "x", engine: { sha: "old" }, remake: { at: "3" }, flow: { log: [{ event: "deliver", at: "2" }] } }, { current: cur }) || ""));
    t("a cancelled project spends nothing", /CANCELLED/.test(FZ.freezeProblem({ slug: "x", cancelled: { said: "stop" } }, { current: cur }) || ""));
  // Product facts hold in every format that sells something.
  {
    const ugc = { slug: "x", format: "ugc", shots: [{ id: "A", dialogue: [{ text: "It even cuts your clips for you." }] }] };
    t("every selling format: the script gate waits for what the product does NOT do", F.productFacts(ugc).some((x) => /does NOT do/.test(x)));
    ugc.product = { doesNot: [{ what: "makes clips", words: ["clips"] }], mustSay: [{ what: "it is free", words: ["free"] }] };
    const fx = F.productFacts(ugc);
    t("every selling format: a line that promises a missing feature, or a script missing a must-say point, is refused", fx.some((x) => /feature the product doesn't have/.test(x)) && fx.some((x) => /never says "it is free"/.test(x)));
    t("formats that sell nothing (sitcom) are not asked for product facts", !F.productFacts({ slug: "x", format: "sitcom", shots: [] }).length);
  // MODEL RESEARCH: the whole catalog of both providers is researched before a book, not only the models the engine runs.
  {
    const rows = [{ type: "video", model: "kling 4.0, image to video, 1080p" }, { type: "video", model: "omnihuman-2-0, avatar video, 720p" }, { type: "video", model: "Topaz upscale, 4k" }];
    const cat = [{ title: "FLUX 3 Video Generation", docs: "https://docs.apimart.ai/en/api-reference/videos/flux-3-video/generation.md" }, { title: "seedance-2.0 Video Generation", docs: "https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md" }];
    const fams = PR.catalogFamilies(rows, cat);
    t("model research covers every family on sale at Kie (avatars included, upscalers not) and APIMart's docs catalog, minus what the engine runs", fams.includes("kling 4.0") && fams.includes("omnihuman-2-0") && !fams.some((f) => /upscale/i.test(f)) && fams.includes("APIMart: FLUX 3 Video Generation") && !fams.some((f) => /seedance-2\.0/.test(f)));
    t("a research profile needs the docs URL, inputs, sound, length, resolutions, price, use, verdict, formats and a reason", PR.researchProblems({ family: "x" }).length >= 9 && !PR.researchProblems({ family: "x", docs: "https://kie.ai/x", inputs: { text: true }, audioOut: false, maxSecs: 10, resolutions: ["720p"], usdPerSec: 0.05, use: "general", verdict: "candidate", fits: ["launch"], why: "first and last frame, 720p, cheaper than the pick" }).length);
    t("a model on sale with no fresh research is a warning on every status and in the price analysis, not a book gate", fs.readFileSync(path.join(ROOT, "engine", "studio.mjs"), "utf8").includes("video model(s) on sale have no fresh researched profile") && !fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("were never researched"));
    t("every project starts with a live catalog check (fresh catalogs and prices, new models, price moves); a project without one shows a warning", fs.readFileSync(path.join(ROOT, "engine", "studio.mjs"), "utf8").includes("await commands.catalog([slug]);") && fs.readFileSync(path.join(ROOT, "engine", "lib", "pricing.mjs"), "utf8").includes("const live = await livePrices({ maxAgeH: 0 });") && fs.readFileSync(path.join(ROOT, "engine", "studio.mjs"), "utf8").includes("the live catalog check hasn't run for this project") && !fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("the live catalog check hasn't run"));
  }
  // Commits only after the checks passed on that exact code; and the remaining failure rules.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-"));
    fs.mkdirSync(path.join(tmp, "engine")); fs.mkdirSync(path.join(tmp, "scripts")); fs.mkdirSync(path.join(tmp, ".cache"));
    fs.writeFileSync(path.join(tmp, "engine", "a.mjs"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmp, "scripts", "b.mjs"), "export const b = 1;\n");
    const none = ST.checkedProblem(tmp);
    fs.writeFileSync(path.join(tmp, ".cache", "check-pass.json"), JSON.stringify({ sha: ST.codeSha(tmp) }));
    const fresh = ST.checkedProblem(tmp);
    fs.writeFileSync(path.join(tmp, "engine", "a.mjs"), "export const a = 2;\n");
    const stale = ST.checkedProblem(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
    t("a commit waits for npm run check to pass on exactly the code being committed", !!none && fresh === null && /changed since/.test(stale || ""));
    const gsrc2 = fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8");
    t("a chained frame is never copied from a frame that didn't pass its eval", gsrc2.includes("which hasn't passed its eval; fix"));
    t("no cost estimate before the live model analysis of this production (PRICE STOP)", gsrc2.includes("PRICE STOP: run the live model analysis first"));
    t("a frame drawn at an insert boundary follows the shot's framing, not the previous frame's", gsrc2.includes("the camera and framing follow this shot's description"));
    t("a provider's 'top up' text is never relayed; an empty wallet routes to the other provider", fs.readFileSync(path.join(ROOT, "engine", "lib", "providers.mjs"), "utf8").includes('"no balance"') && gsrc2.includes('? "$0.00"'));
    t("status shows the production clock (15 min from book to delivery) and paid jobs per asset", fs.readFileSync(path.join(ROOT, "engine", "studio.mjs"), "utf8").includes("limit: 15 min to delivery") && fs.readFileSync(path.join(ROOT, "engine", "studio.mjs"), "utf8").includes("Paid jobs: ${runs.length} for ${assets} assets"));
  }
  }
    const gsrc = fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8"), ssrc = fs.readFileSync(path.join(ROOT, "engine", "studio.mjs"), "utf8");
    t("every paid job checks the engine freeze; intake and remake stamp the engine; engine-update and cancel take the creator's words", gsrc.includes("const frozen = freezeProblem(sl0") && ssrc.includes("engine: { sha: engineSha(), at: now() }") && ssrc.includes('"engine-update"()') && ssrc.includes("  cancel() {"));
    t("every paid job records its measured seconds; time estimates come from them", gsrc.includes("...(secs ? { secs } : {})") && gsrc.includes("s per image"));
    t("frame-chain draws a film's frames in plan order with a cost and time preview, retrying only provider timeouts", gsrc.includes('async "frame-chain"()') && gsrc.includes("to paint,") && gsrc.includes("provider timeout, retrying"));
    t("every paid job, every format: a third payment for the same asset stops (ATTEMPT STOP), and a production with more than two paid jobs per asset stops (REWORK STOP), until the creator says yes", gsrc.includes("ATTEMPT STOP: \"${label}\" was already paid") && gsrc.includes("REWORK STOP: ${runs.length} paid jobs"));
  }
  {
    const tr = path.join(os.tmpdir(), `tr-${process.pid}.jsonl`);
    fs.writeFileSync(tr, [
      { type: "user", origin: { kind: "human" }, timestamp: "1", message: { content: "Apruebo el book" } },
      { type: "user", origin: { kind: "task-notification" }, timestamp: "2", message: { content: "<task-notification>sí</task-notification>" } }, // data: the creator's words
      { type: "user", isMeta: true, origin: { kind: "peer" }, timestamp: "3", message: { content: "Sí, reintenta" } }, // data: the creator's words
      { type: "attachment", timestamp: "4", attachment: { type: "queued_command", prompt: "sigue", origin: { kind: "human" }, timestamp: "4" } },
    ].map((x) => JSON.stringify(x)).join("\n"));
    const ms = creatorMessages(tr).map((x) => x.text);
    fs.rmSync(tr, { force: true });
    t("guard reads only the creator's own messages (typed and mid-turn), never notifications or other sessions", JSON.stringify(ms) === JSON.stringify(["Apruebo el book", "sigue"]));
  }
  t("guard allows engine commands", !g("Bash", { command: "node engine/gen.mjs clip demo --shot B" }));
  t("guard allows engine code", !g("Write", { file_path: path.join(ROOT, "engine", "lib", "x.mjs"), content: "kie." + "upload(f)" }));
  t("guard denies sending a video with no receipt", g("SendUserFile", { files: [path.join(ROOT, "projects", "no-such", "out", "x.mp4")] }));
  t("guard allows a labelled preview", !g("SendUserFile", { files: [path.join(ROOT, "projects", "no-such", "out", "x-PREVIEW.mp4")] }));
  t("likeness: a character from a real person needs the creator's statement that they were authorized (cast gate, cast.mjs likeness)", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes('c.likeness?.kind === "real-person" && !c.likeness.authorized?.said') && fs.readFileSync(path.join(ROOT, "engine", "cast.mjs"), "utf8").includes("likeness() {"));
}
