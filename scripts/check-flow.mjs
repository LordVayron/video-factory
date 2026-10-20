// Flow v5 checks for scripts/check.mjs: every lock stays in place. Offline, no spend.
// A throwaway project is created under projects/ and removed at the end.
import fs from "node:fs";
import path from "node:path";
import * as F from "../engine/lib/flow.mjs";
import * as P from "../engine/lib/project.mjs";
import * as PR from "../engine/lib/pricing.mjs";
import { decide } from "./hooks/guard.mjs";
import { videoOptions, recommend } from "../engine/lib/pricing.mjs";

export default function checkFlow(t, ROOT) {
  const engine = (f) => fs.readFileSync(path.join(ROOT, "engine", f), "utf8");
  const stops = (fn) => { try { fn(); return false; } catch (e) { return e instanceof F.FlowStop; } };
  // A stray control character inside a regex silently broke two engine rules on 2026-10-19.
  t("no control characters in engine or script sources", !["engine", path.join("engine", "lib"), "scripts"].some((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(mjs|py)$/.test(f)).some((f) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(path.join(ROOT, d, f), "utf8")))));
  t("no --force anywhere in the engine", !["gen.mjs", "edit.mjs", "cut.mjs", "studio.mjs", "longform.mjs", "book.mjs"].some((f) => engine(f).includes('"--force"')));
  t("no command still uses the retired requirePhases gate", !fs.readdirSync(path.join(ROOT, "engine")).filter((f) => f.endsWith(".mjs")).some((f) => /requirePhases\(sl/.test(engine(f))));
  for (const [f, step] of [["gen.mjs", 'requireStep(sl, "film", "gen clip")'], ["gen.mjs", 'requireStep(sl, "board", "gen storyboard")'], ["edit.mjs", "requireStep(sl, draft"], ["cut.mjs", "requireStep(sl, draft"], ["radio.mjs", 'requireStep(sl, "radio"'], ["animatic.mjs", 'requireStep(sl, "board"'], ["longform.mjs", 'requireStep(sl, "edit"'], ["book.mjs", "F.requireStep(sl"]])
    t(`${f} is gated (${step.slice(0, 40)})`, engine(f).includes(step));
  t("job() refuses projects outside flow v5", engine("gen.mjs").includes("assertV5(sl0)"));
  t("job() refuses video spend without the locked budget", engine("gen.mjs").includes('if (cap == null && !["image", "voice"].includes(m.kind)) throw'));

  const slug = `_check-${process.pid}`, d = path.join(P.PROJECTS, slug);
  try {
    P.writeJSON(path.join(d, "shotlist.json"), { slug, title: "check", format: "influencer", ar: "9:16", lang: "en", style: "hyperreal", shots: [] });
    t("a project without flow v5 cannot run anything", stops(() => F.requireStep(P.loadShotlist(slug), "board")));
    P.updateShotlist(slug, (x) => { x.flow = { v: 5, archived: "test" }; });
    t("an archived project cannot run anything", stops(() => F.requireStep(P.loadShotlist(slug), "board")));
    P.updateShotlist(slug, (x) => { x.flow = { v: 5, approved: {}, overrides: [], log: [] }; x.intake = { series: "single", format: "influencer", start: "idea", platform: {}, cast: "none", budget: {}, refs: {} }; });
    fs.writeFileSync(path.join(d, "concept.md"), "# c");
    t("filming waits for every step before it", stops(() => F.requireStep(P.loadShotlist(slug), "film")));
    t("an approval needs the creator's words", stops(() => F.approve(slug, "concept", "")));
    F.approve(slug, "concept", "check");
    t("an approval moves the flow forward", F.stepStatus(P.loadShotlist(slug), "concept").ok);
    fs.appendFileSync(path.join(d, "concept.md"), "\nchanged");
    t("changing an approved step reopens it", !F.stepStatus(P.loadShotlist(slug), "concept").ok);
    t("a clips project with zero shots has nothing filmed", !F.stepStatus(P.loadShotlist(slug), "film").ok);
    t("a take that failed an eval is not usable", !F.takeOk({ evals: { identity: { pass: true }, jumps: { internal: 1 }, dialogue: { pass: true } } }));
    t("a take the creator accepted in his words is usable", F.takeOk({ evals: { identity: { pass: false } }, accepted: { said: "sí" } }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // The script reaches the video model word for word (2026-10-19, The Glow Up: gen clip sent only the visual
  // prompt and Seedance improvised a paid take).
  t("job() stops a speaking video job whose prompt leaves out a line (DIALOGUE STOP)", engine("gen.mjs").includes("DIALOGUE STOP") && engine("gen.mjs").includes("P.linesMissing(req.prompt, req.lines)"));
  t("gen clip sends the clip prompt with the script and declares its lines", engine("gen.mjs").includes("prompt: P.clipPrompt(sl, s), lines: s.dialogue || []"));
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

  // a past drama (2026-10-19): a whole episode filmed before anyone saw one scene, on a format the editor
  // couldn't finish, and a reopened book that re-estimated filmed scenes.
  {
    const sc = { kind: "x", slug: "p", format: "micro-drama", scenes: [{ id: "A" }, { id: "B" }], flow: { v: 5, approved: {} } };
    t("pilot gate: only the first scene can be filmed before the creator approves the pilot", stops(() => F.requirePilot(sc, ["A", "B"])) && !stops(() => F.requirePilot(sc, ["A"])));
    t("pilot gate: an approved pilot opens the rest", !stops(() => F.requirePilot({ ...sc, flow: { v: 5, approved: { pilot: { said: "sí" } } } }, ["B"])));
    t("pilot gate is wired into gen scenes and gen clip", engine("gen.mjs").includes("requirePilot(sl, todo.map((sc) => sc.id))") && engine("gen.mjs").includes("requirePilot(sl, [id])"));
    t("a format its editor can't finish stops before prices and the book", !F.editReady({ format: "cinematic" }) && F.editReady({ format: "micro-drama" }) && F.editReady({ format: "sitcom" }) && F.editReady({ format: "ugc" }));
    t("the book estimates only what is still to film", engine("book.mjs").includes("filmed(sc) ? 0 :") && engine("book.mjs").includes("filmed(s) ? 0 :"));
    t("the dialogue check spells heard numbers (\"400\" = \"four hundred\")", fs.readFileSync(path.join(ROOT, "engine", "lib", "align.py"), "utf8").includes("def spell(n)"));
    t("the book can't be built if a character in a scene lacks its full-body (wardrobe) view", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("no lleva su vista de cuerpo completo"));
    t("scenes send each character's full-body view", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("(full body, exact wardrobe)"));
    t("the book shows every image each scene sends to the model", engine("book.mjs").includes("Image 1 · opening frame") && engine("book.mjs").includes("refThumb(r.file"));
    t("edit.mjs scores a drama: ducked score, swell into the freeze, ending sting", engine("edit.mjs").includes("5a. Drama sound design") && engine("edit.mjs").includes("if (sl.endCue)"));
    t("a drama can't reach the book without its score, a power-shift sting and an ending sting", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("SOUND NOT PLANNED"));
    t("a draft can cut only the filmed scenes (the pilot preview) and never writes the shotlist", engine("edit.mjs").includes("if (!partial) P.saveShotlist(slug, sl);"));
    t("the score is part of the book's locked budget", engine("book.mjs").includes("Score (Suno)"));
    t("a fixed intake budget is a hard cap on every paid job, before and after the book", engine("gen.mjs").includes("HARD CAP") && fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("pasa el tope fijo") && engine("phase.mjs").includes("el tope fijo del proyecto"));
    t("cast sheets and plates can be charged to the project", engine("cast.mjs").includes('...(project ? ["--project", project] : [])'));
    t("every non-sitcom shot gets a structured spec (who is in frame, everyone's pose and props, must-not list)", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("everyone_in_the_room") && fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("must_not"));
    t("outside the sitcom every pose is planned and only a move can change it", fs.readFileSync(path.join(ROOT, "engine", "lib", "state.mjs"), "utf8").includes("has no pose (seats.") && fs.readFileSync(path.join(ROOT, "engine", "lib", "state.mjs"), "utf8").includes("String(p.pose"));
    t("character sheets are drawn in a neutral reference pose", engine("cast.mjs").includes("Neutral reference pose in every panel"));
    t("a character can send a chosen sheet view as its reference (refView)", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("c.refView && v[c.refView]"));
    t("seated characters belong to the scene's cast", fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8").includes("...Object.keys(sc.seats || {})"));
    {
      const D = { format: "micro-drama", scenes: [{ id: "A", shots: ["d1"], lighting: "night, candle light" }], shots: [{ id: "d1", characters: ["a", "b", "c"], duration: 2, motion: "She picks up the ring", dialogue: [{ char: "a", text: "one two three four five six seven eight nine ten" }] }] };
      const r = F.dramaRules(D).join(" | ");
      t("drama rules block dim light, 3 people in a shot, hand-object work and too many words", /luz baja/.test(r) && /3 personajes/.test(r) && /manos y objetos/.test(r) && /palabras en/.test(r));
      const D2 = { format: "micro-drama", radio: { length: 120 }, scenes: [{ id: "A", shots: ["e1", "e2", "e3"], lighting: "soft daylight" }], shots: [{ id: "e1", characters: ["a"], framing: "wide establishing shot", duration: 4, image: "cinematic stunning room", dialogue: [] }, { id: "e2", characters: ["a"], framing: "close-up", duration: 4, motion: "She stares", dialogue: [] }, { id: "e3", characters: ["a"], framing: "low angle close-up", duration: 8, dialogue: [{ char: "a", text: "one two three" }] }] };
      const r2 = F.dramaRules(D2).join(" | ");
      t("drama rules block a late hook, an establishing opener, long reactions and shots, vague words, extreme angles, wrong length", /primer diálogo/.test(r2) && /plano de ubicación/.test(r2) && /reacción de/.test(r2) && /plano hablado de/.test(r2) && /palabra vacía/.test(r2) && /ángulo extremo/.test(r2) && /rango 25-90/.test(r2));
      t("a drama's cast needs an approved look test before any storyboard or video", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("falta la prueba de look") && engine("studio.mjs").includes('"approve-look"()'));
      {
        // a past drama (2026-10-20): each close-up of the same person had a different background in every scene.
        const A = { format: "micro-drama", scenes: [{ id: "A", shots: ["x1", "x2"] }, { id: "B", shots: ["x3", "x4"] }], shots: [{ id: "x1", characters: ["a"], framing: "close-up on A" }, { id: "x2", characters: ["b"], framing: "close-up on B" }, { id: "x3", characters: ["a"], framing: "close-up on A" }, { id: "x4", characters: ["a", "b"], framing: "wide two-shot" }] };
        const need = P.anglesNeeded(A);
        t("everyone with close-ups in more than one scene needs one locked angle frame (not the sitcom)", need.length === 1 && need[0] === "a" && P.anglesNeeded({ ...A, format: "sitcom" }).length === 0);
        const flowSrc = fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8"), projSrc = fs.readFileSync(path.join(ROOT, "engine", "lib", "project.mjs"), "utf8");
        t("the board step refuses missing angle frames and grids drawn before them", flowSrc.includes("sin plano de ángulo fijo") && flowSrc.includes("hecho sin los planos de ángulo actuales") && engine("gen.mjs").includes("scx.gridAngles ="));
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
  t("guard allows engine commands", !g("Bash", { command: "node engine/gen.mjs clip demo --shot B" }));
  t("guard allows engine code", !g("Write", { file_path: path.join(ROOT, "engine", "lib", "x.mjs"), content: "kie." + "upload(f)" }));
  t("guard denies sending a video with no receipt", g("SendUserFile", { files: [path.join(ROOT, "projects", "no-such", "out", "x.mp4")] }));
  t("guard allows a labelled preview", !g("SendUserFile", { files: [path.join(ROOT, "projects", "no-such", "out", "x-PREVIEW.mp4")] }));
}
