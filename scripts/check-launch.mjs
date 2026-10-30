// Product launch films, end to end with mocks, for scripts/check.mjs. Offline, no spend.
// A throwaway project runs the sample plan (templates/launch/video-factory) through every gate with fake frames,
// fake takes and tones instead of voice and music, then the real editor builds the film. The mock film proves the
// timing, compositing and mixing; it is deleted at the end and is never a production film.
import fs from "node:fs";
import { MODELS } from "../engine/lib/models.mjs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import * as F from "../engine/lib/flow.mjs";
import * as P from "../engine/lib/project.mjs";
import * as L from "../engine/lib/launch.mjs";
import * as MS from "../engine/lib/modelsheet.mjs";
import * as AP from "../engine/lib/autopilot.mjs";
import * as J from "../engine/lib/joins.mjs";
import * as BR from "../engine/lib/brand.mjs";
import { stillRules } from "../engine/lib/critics.mjs";

export default function checkLaunch(t, ROOT) {
  const node = (args) => spawnSync(process.execPath, args.map((a, i) => (i === 0 ? path.join(ROOT, "engine", a) : a)), { encoding: "utf8", cwd: ROOT, env: { ...process.env, FACTORY_OFFLINE: "1" } });
  const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
  const probe = (f, entries) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", entries, "-of", "json", f]).toString());
  const sample = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "launch", "video-factory", f), "utf8"));
  const brief = sample("brief.json"), concepts = sample("concepts.json"), plan = sample("shot-plan.json"), style = sample("style-bible.json");

  // ---- the rules, on the sample and on broken copies
  t("launch: the sample's concepts and timed plan pass every rule", !L.conceptRules(concepts, brief).length && !L.planRules(plan, { brief, concepts, style }).length);
  t("launch: the sample brief waits for the creator's interview and their yes on its assumption", L.briefRules(brief).some((x) => /no interview/.test(x)) && L.briefRules(brief).some((x) => /not approved/.test(x)));
  const shifted = structuredClone(plan); shifted.shots[3].duration += 0.6;
  t("launch: shot durations must add up to the length (±0.25 s) with no gaps", L.planRules(shifted, { brief, concepts }).some((x) => /add up to/.test(x)) && L.planRules(shifted, { brief, concepts }).some((x) => /no gaps/.test(x)));
  const claimy = structuredClone(plan); claimy.shots[1].vo = "Ten times faster than any agency.";
  t("launch: a measurable claim without a proven capability is blocked", L.planRules(claimy, { brief, concepts }).some((x) => /claims something measurable/.test(x)));
  // Film grammar: a cut in the same place changes size or angle; the same view again is a jump cut.
  { const k = plan.shots.findIndex((s, i) => i > 0 && s.chain === "exact" && plan.shots[i - 1].source === "generate" && s.source === "generate");
    const jc = structuredClone(plan); jc.shots[k].chain = "cut"; jc.shots[k].shotType = jc.shots[k - 1].shotType; delete jc.shots[k].angle; jc.shots[k].composition = jc.shots[k - 1].composition;
    const jumps = (p) => L.planRules(p, { brief, concepts, style }).some((x) => /a jump cut/.test(x));
    const sized = structuredClone(jc); sized.shots[k].shotType = L.shotSize(jc.shots[k - 1]) === 5 ? "wide shot" : "close-up";
    const angled = structuredClone(jc); angled.shots[k].angle = "over-the-shoulder";
    t("launch: a cut to the same place, size and angle is refused as a jump cut; a new size, a new angle or one unbroken shot passes", jumps(jc) && !jumps(sized) && !jumps(angled) && !jumps(plan)); }
  { const k = plan.shots.findIndex((s) => s.source === "generate"), pb = structuredClone(plan);
    pb.shots[k].shotType = "extreme wide"; pb.shots[k].camera = "slow pull back";
    const closer = structuredClone(pb); closer.shots[k].shotType = "wide";
    const flags = (p) => L.planRules(p, { brief, concepts, style }).filter((x) => /opens on an extreme wide/.test(x));
    t("launch: a pull-back that opens on an extreme wide is a craft issue (the model pushes in first); opening closer passes", flags(pb).length === 1 && F.CRAFT.test(flags(pb)[0]) && !flags(closer).length); }
  t("launch: the still critic reads a shot's own stay-as-it-is rules from its prompt", stillRules("Camera: slow drift. These stay exactly as they are and do not move: every app window stays inside the monitor screen; the lamp keeps its place. The set moves only as described.").join("|") === "every app window stays inside the monitor screen|the lamp keeps its place");
  { const flat = structuredClone(plan); for (const s of flat.shots) if (s.source === "generate") s.shotType = "medium shot";
    const r = L.planRules(flat, { brief, concepts, style });
    t("launch: a film needs three shot sizes and never four shots in a row at one size", r.some((x) => /shot size\(s\); use at least three/.test(x)) && r.some((x) => /four shots in a row at the same size/.test(x))); }
  t("launch: every generated shot names a shot size", L.planRules({ ...structuredClone(plan), shots: plan.shots.map((s, i) => (i === 0 ? { ...s, shotType: "nice view" } : s)) }, { brief, concepts, style }).some((x) => /names no shot size/.test(x)));
  // Joins are measured on every take: a picture against itself is a perfect join, against another a jump.
  { const jd = fs.mkdtempSync(path.join(ROOT, ".cache", "joins-")), a = path.join(jd, "a.png"), b = path.join(jd, "b.png"), v = path.join(jd, "v.mp4");
    ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:d=1", "-frames:v", "1", a]);
    ff(["-f", "lavfi", "-i", "mandelbrot=s=640x360", "-frames:v", "1", b]);
    ff(["-loop", "1", "-i", a, "-t", "1", "-r", "24", "-pix_fmt", "yuv420p", v]);
    const same = J.endMatch(v, a), other = J.endMatch(v, b);
    t("launch: a take is measured against its drawn end (END match) the moment it is filmed", same?.pass === true && other?.pass === false);
    fs.rmSync(jd, { recursive: true, force: true }); }
  t("launch: a take whose end fails a gating END match fails its evals", !F.evalsPass({ evals: { identity: { pass: true }, jumps: { internal: 0 }, dialogue: { pass: true }, end: { pass: false, gates: true } } }) && F.evalsPass({ evals: { identity: { pass: true }, jumps: { internal: 0 }, dialogue: { pass: true }, end: { pass: true } } }));
  // Brand memory: what the creator chose and rejected for a brand, kept with their words for every later brief.
  { const id = `check-brand-${process.pid}`, bf = path.join(P.BIBLE, "brands", `${id}.json`);
    try {
      BR.note(id, "music", "picked", "brass band", { said: "yes", project: "x" });
      BR.note(id, "music", "rejected", "lo-fi", { said: "no", project: "x" });
      const h = BR.history({ brand: id }, "music");
      t("launch: the brand memory keeps the creator's chosen and rejected music, with their words", h.picked[0].includes("brass band") && h.rejected[0].includes("lo-fi") && h.rejected[0].includes('"no"'));
    } finally { fs.rmSync(bf, { force: true }); } }
  const lettered = structuredClone(plan); lettered.shots[0].prompt += ' with a sign that reads "SALE"';
  t("launch: a prompt that asks the model for exact text is blocked (the editor composites text)", L.planRules(lettered, { brief, concepts }).some((x) => /quoted text/.test(x)));
  // ---- every launch film rule
  const R = (p) => L.planRules(p, { brief, concepts, style: { ...style, thread: "sample-founder" } }).join(" | ");
  // What the product does not do, and what every film must say (the creator's words in the brief).
  {
    const b2 = structuredClone(brief); delete b2.doesNot;
    t("launch: the brief must record what the product does NOT do (an empty list is an answer)", L.briefRules(b2).some((x) => /does NOT do/.test(x)));
    const b3 = structuredClone(brief); b3.doesNot = [{ what: "it doesn't make clips", words: ["clips"] }];
    const p3 = structuredClone(plan); p3.shots[1].vo = "It cuts your clips for you.";
    t("launch: a script line that promises a feature the product lacks is refused", L.planRules(p3, { brief: b3, concepts }).some((x) => /promises something the product doesn't do/.test(x)));
    const b4 = structuredClone(brief); b4.mustSay = [{ what: "it streams live", words: ["streams live", "live"] }];
    t("launch: a point the creator said every film must make is required in the script", L.planRules(plan, { brief: b4, concepts }).some((x) => /never says "it streams live"/.test(x)));
  }
  // Set maps: every screen states what it shows; a screen insert opens on green in the timeline.
  {
    const st2 = structuredClone(style), desk = st2.environments.find((e) => e.id === "desk");
    desk.map.items.push({ name: "the monitor", at: "center of the desk" });
    t("launch: a screen in the set map with no state is refused", L.styleRules(st2, { plan }).some((x) => /is a screen with no state/.test(x)));
    desk.map.items.at(-1).state = "its screen shows a dark desktop";
    const p2 = structuredClone(plan); p2.shots[1].inserts = [{ file: "x.mp4", from: 0 }];
    t("launch: a shot with a screen insert needs a screen that turns green at its first frame", L.styleRules(st2, { plan: p2 }).some((x) => /has a screen insert/.test(x)));
    desk.map.items.at(-1).changes = [{ from: "S2:first", state: "its screen is filled with flat bright green" }, { from: "S3:first", state: "its screen shows a dark desktop" }];
    t("launch: a screen timeline that turns green for the insert passes", !L.styleRules(st2, { plan: p2 }).some((x) => /has a screen insert|screen with no state/.test(x)));
    desk.map.items.at(-1).state = "black until he goes live";
    t("launch: a conditional screen state is refused (an image shows one moment)", L.styleRules(st2, { plan: p2 }).some((x) => /conditional state/.test(x)));
  }
  const unchained = structuredClone(plan); delete unchained.shots[1].chain;
  t("launch: two shots in the same place must be chained (exact last frame or the same set)", /chain it/.test(R(unchained)));
  const exactNoEnd = structuredClone(plan); exactNoEnd.shots[1].chain = "exact"; delete exactNoEnd.shots[0].end;
  t("launch: chain exact needs the previous shot's choreographed last frame", /has no choreographed end \(shot.end\)/.test(R(exactNoEnd)) || /chain "exact" starts/.test(R(exactNoEnd)));
  const unasked = structuredClone(plan); delete unasked.shots[2].transitionAsked;
  t("launch: a transition the creator didn't ask for is refused", /without the creator's words asking for it/.test(R(unasked)));
  const fx = structuredClone(plan); delete fx.sfx[Object.keys(fx.sfx)[0]].said;
  t("launch: an effect the creator didn't ask for or approve is refused", /sfx\..*\.said/.test(R(fx)));
  const txt = structuredClone(plan); const ts = txt.shots.find((x) => (x.text || []).some((o) => o.kind !== "cta")); ts.text.find((o) => o.kind !== "cta").said = "";
  t("launch: on-screen text the creator didn't ask for is refused (only the brand and the CTA go unasked)", /text\.said/.test(R(txt)));
  // Throwaway characters, so the test runs on any install (the public bible ships no characters).
  const mk = (id, name) => { const d = path.join(ROOT, "bible", "characters", id); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "character.json"), JSON.stringify({ id, name, species: "human", look: "a test character" })); return id; };
  const crewId = mk(`_check-crew-${process.pid}`, "the check crew"), handId = mk(`_check-hand-${process.pid}`, "The Check Hand");
  const idle = structuredClone(plan); idle.shots[1].assets.push(crewId); idle.shots[1].motion = "the camera drifts slowly to the right";
  t("launch: a character in frame with nothing to do is refused", /doesn't say what they do/.test(R(idle)));
  const pile = structuredClone(plan); pile.shots[0].motion = "one card drops from the pile onto the desk"; pile.shots[0].end = (pile.shots[0].end || "") + " the card lies on the desk";
  t("launch: nothing falls near a pile (video models animate piles on their own)", /next to a pile/.test(R(pile)));
  const slow = structuredClone(plan); slow.shots[0].role = "possibility"; slow.shots[0].voAt = 1.2;
  t("launch: the first shot hooks (hook, friction or problem; the voice by 0.5 s)", /hooks/.test(R(slow)));
  const story = structuredClone(concepts); story.concepts[0].creativeThesis = "A tiny rental store at night"; story.concepts[0].metaphorMapsTo = "a cozy shop where tapes wait";
  t("launch: a concept that tells a story without naming the product or its category is refused", L.conceptRules(story, brief).some((x) => /launches the product/.test(x)));
  const nopain = structuredClone(plan); nopain.shots.forEach((x) => { if (["hook", "friction", "problem"].includes(x.role) && x.start < 8) x.role = "possibility"; });
  t("launch: the pain must be readable by 8 s", /before 8 s/.test(R(nopain)));
  const hands = structuredClone(plan); const RH = (p) => L.planRules(p, { brief, concepts, style: { ...style, thread: handId } }).join(" | "); hands.shots[0].assets.push(handId); hands.shots[0].motion += "; another hand presses the card";
  t("launch: one hand per shot (models invent extra hands)", /one hand per shot/.test(RH(hands)));
  for (const id of [crewId, handId]) fs.rmSync(path.join(ROOT, "bible", "characters", id), { recursive: true, force: true });
  const busy = structuredClone(plan); busy.shots[1].motion = "a; b; c; d";
  t("launch: one clear action per shot (more than three is refused)", /more than three actions/.test(R(busy)));
  t("launch: the plan's animatic is approved once; the drawn frames go into the Production Book", !fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("hasn't seen the animatic with the drawn frames") && fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("goes into the Production Book"));
  t("launch: craft rules (frame prompts, chaining, acting) hold the storyboard step, never the creator's script", F.CRAFT.test("S1: the frame prompt doesn't place the camera (height, side, lens)") && F.CRAFT.test("S2: follows S1 in the same setting; chain it frame to frame") && !F.CRAFT.test("S1: 14 words in a 3 s shot (max ~3.3 per second)") && !F.CRAFT.test("conversion: the last shot is the visible CTA"));
  // ---- art styles: bible styles with a launch block, or the creator's own from references
  const ls = L.launchStyles();
  t("launch: films can use storybook, anime or hyperreal; phone UGC and podcast styles are not offered", ["storybook", "anime", "hyperreal"].every((x) => ls.includes(x)) && !ls.includes("ugc-phone") && !ls.includes("podcast"));
  const anime = structuredClone(concepts); anime.config.visualStyle = "anime"; const phone = structuredClone(concepts); phone.config.visualStyle = "ugc-phone";
  t("launch: a concept in an offered style passes; one in a style without a launch block is refused", !L.conceptRules(anime, brief).some((x) => /style/.test(x)) && L.conceptRules(phone, brief).some((x) => /style/.test(x)));
  const tmpStyle = path.join(ROOT, "bible", "styles", `_check-style-${process.pid}`); fs.mkdirSync(path.join(tmpStyle, "refs"), { recursive: true });
  fs.writeFileSync(path.join(tmpStyle, "refs", "a.png"), "x");
  const cst = { id: "_c", kind: "custom", dir: tmpStyle, refs: ["refs/a.png"], look: "short", negative: "", launch: null, madeFrom: {} };
  const bad = L.customStyleRules(cst);
  for (const n of ["b", "c", "d"]) fs.writeFileSync(path.join(tmpStyle, "refs", `${n}.png`), "x");
  const creatorOnly = L.customStyleRules({ ...cst, refs: ["refs/a.png", "refs/b.png"], look: "flat bold shapes, thick black outline, two-tone shading, grainy risograph texture, warm noon light, shallow depth", negative: "3D", launch: { insertTreatment: "none" }, madeFrom: { said: "check" } });
  const good = L.customStyleRules({ ...cst, refs: ["refs/a.png", "refs/b.png", "refs/c.png", "refs/d.png"], generated: ["refs/a.png", "refs/b.png", "refs/c.png", "refs/d.png"], look: "flat bold shapes, thick black outline, two-tone shading, grainy risograph texture, warm noon light, shallow depth", negative: "3D, photorealism, text", launch: { insertTreatment: "none" }, madeFrom: { said: "check" } });
  fs.rmSync(tmpStyle, { recursive: true, force: true });
  t("launch: a style from the creator's references needs 2+ images, a written look, a never-list, a footage treatment and their words", bad.length >= 4 && !good.length);
  t("launch: a custom style never sends the creator's own images to the model (only originals made for it)", creatorOnly.some((x) => /creator's own images/.test(x)));
  const src = (f) => fs.readFileSync(path.join(ROOT, "engine", ...f.split("/")), "utf8");
  t("launch: chain exact copies the previous shot's last frame as the first frame (free) and same-set draws from it", src("gen.mjs").includes('s.chain === "exact"') && src("gen.mjs").includes("The same set as the first reference image"));
  t("launch: the editor measures every chain exact join (SSIM) and fails a jump", src("launch.mjs").includes("the join with") && src("launch.mjs").includes('"-lavfi", "ssim"'));
  t("launch: a take review answers motion, join, logic, appear and end in words, after its sheet and its join sheet", ["--motion", "--join", "--logic", "--appear", "--end", "-join.jpg"].every((x) => src("launch.mjs").includes(x)));
  t("launch: every edit decision on a take needs the creator's words", src("launch.mjs").includes("the edit decision ${k} lacks the creator's words"));
  t("launch: a narration re-cut keeps the creator's pauses (shot.pause)", src("launch.mjs").includes("const pauses = plan.shots.map((s) => s.pause || 0)"));
  t("launch: apply keeps a take whose animation prompt didn't change, whatever its new length", src("launch.mjs").includes("o.prompt === s.prompt && len > 0"));
  t("launch: rules are model-agnostic; only models that take a last frame are offered and filmed", MODELS.kling3.lastFrame && MODELS.veo.lastFrame && MODELS.sd2.lastFrame && MODELS.wan3.lastFrame && MODELS.grok.lastFrame === false && src("studio.mjs").includes("MODELS[o.key]?.lastFrame") && src("gen.mjs").includes("doesn't take a last frame"));
  t("launch: effects are measured and set well under the narration", /const SFX_LUFS = -3[5-9]/.test(src("launch.mjs")));
  t("launch: real footage gets the project style's own treatment (launch.insertTreatment), not a fixed storybook grade", src("launch.mjs").includes("launch?.insertTreatment") && !src("launch.mjs").includes('/storybook|illustrat/i.test(style.preset)'));
  t("launch: every frame and character sheet receives a custom style's reference images", src("gen.mjs").includes("const stRefs") && fs.readFileSync(path.join(ROOT, "engine", "cast.mjs"), "utf8").includes("a custom style's reference images"));
  t("launch: style-from-refs copies the creator's images into the bible and needs their words", src("launch.mjs").includes('"style-from-refs"()') && src("launch.mjs").includes("the creator\\'s exact words"));
  const same = structuredClone(concepts); same.concepts[2] = { ...same.concepts[0], id: "copy" };
  t("launch: concepts that are paraphrases of each other are blocked", L.conceptRules(same).some((x) => /too alike/.test(x)));
  const wide = structuredClone(concepts); wide.config.aspectRatio = "9:16"; wide.config.durationSeconds = 60;
  t("launch: options outside Release 1 are refused, not offered", L.conceptRules(wide).filter((x) => /not available yet/.test(x)).length === 2);
  const conv = structuredClone(concepts); conv.config.intent = "conversion";
  const late = structuredClone(plan); late.shots[0].role = "possibility";
  t("launch: a conversion film must open on the pain and end on a visible CTA", L.planRules(late, { brief, concepts: conv }).some((x) => /open on the pain/.test(x)) && L.planRules(plan, { brief, concepts: conv }).some((x) => /visible CTA/.test(x)));
  const badInsert = structuredClone(plan); badInsert.shots[0].inserts = [{ file: "media/x.mp4" }];
  t("launch: real footage needs a locked camera and screens drawn bright green", L.planRules(badInsert, { brief, concepts }).some((x) => /camera must stay fixed/.test(x)) && L.planRules(badInsert, { brief, concepts }).some((x) => /bright green/.test(x)));
  {
    const fp = L.framePrompt(L.StyleBible.parse(style), "", plan.shots[0], [{ name: "Checky", look: "a woman with a mustard sweater" }]);
    t("launch: a frame prompt carries each character's locked look and allows nobody else", fp.includes("a woman with a mustard sweater") && /No other people and no animals/.test(fp) && /No people and no animals/.test(L.framePrompt(L.StyleBible.parse(style), "", plan.shots[2], [])));
    t("apply takes the cast from the style bible's characters", fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes("...style.characters.map((c) => c.id)"));
    t("gen frame sends each character's sheet in the project's style", fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("P.characterLook(ch, sl.style).sheet"));
  }
  {
    // The standard character sheet: one per character, same layout and detail for every vertical.
    const c = { name: "Checky", look: "a woman with a short black bob and a mustard sweater", sheetSpec: { label: "Check", expressions: ["happy", "curious", "surprised", "proud"], poses: ["waving", "thinking", "pointing"], details: ["bob haircut", "mustard sweater", "brown shoes"], palette: ["#111111", "#222222", "#333333", "#444444", "#555555"], notes: { role: "r", wants: "w", secret: "s" } } };
    const pr = MS.prompt(c, { look: "storybook", negative: "3D render, written text, letters" });
    t("standard sheet: one character per sheet (a group look is refused)", MS.isGroup("a group of four storybook creators") && MS.isGroup("three thumb-sized factory workers") && !MS.isGroup(c.look));
    t("standard sheet: name, turnaround, poses, expressions, details, palette and notes are all required and drawn", MS.specProblems({}).length === 6 && !MS.specProblems(c).length && ["TURNAROUND", "POSES", "EXPRESSIONS", "DETAILS", "COLOR PALETTE", "NOTES", "FRONT, 3/4, SIDE, BACK", "#555555"].every((x) => pr.includes(x)) && !/written text/.test(pr));
    t("standard sheet: the cast gate needs one for every character of a new project, and it is the reference models receive", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("no standard sheet") && fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("P.characterLook(ch, sl.style).modelSheet"));
  }
  const still = structuredClone(plan); still.shots[1].source = "still"; still.shots[2].source = "card";
  t("launch: every shot is animated (a still with a zoom or a flat card is refused)", L.planRules(still, { brief, concepts }).filter((x) => /every shot is animated/.test(x)).length === 2);
  {
    // Story rules: a continuous narration, motivated cuts, one thread, one light, no beat under the voice.
    const sb = { ...style, thread: "sample-founder" }, rules = (p) => L.planRules(p, { brief, concepts, style: sb }).join(" | ");
    const thin = structuredClone(plan); thin.shots.forEach((s, i) => { if (i % 2) delete s.vo; });
    t("launch: a narrated film keeps talking (density near the reference, no silent shot but the ending)", /words of narration/.test(rules(thin)) && /the voice doesn't stop/.test(rules(thin)) && /the reference has 2.76/.test(L.planRules(thin, { brief, concepts, style: sb, reference: { narration: { wordsPerSecondOfFilm: 2.76 } } }).join()));
    const loose = structuredClone(plan); delete loose.shots[3].connect; loose.shots[4].transitionIn = "slideleft"; loose.shots[5].prompt += " at sunset";
    t("launch: every cut says how it follows, slides are refused, the light never changes", /doesn't say how it follows/.test(rules(loose)) && /never circles or wipes/.test(rules(loose)) && /sunset/.test(rules(loose)));
    const tilt = structuredClone(plan); tilt.shots[4].transitionIn = "slideup"; tilt.shots[4].connect = { type: "action", how: "the camera tilts down" };
    t("launch: a vertical tilt is only allowed between two heights of the same place", /vertical tilt: only between two heights/.test(rules(tilt)));
    t("launch: one thread opens and closes the film", /has no thread/.test(L.planRules(plan, { brief, concepts, style: { ...style, thread: undefined } }).join()) && /40 %/.test(L.planRules(plan, { brief, concepts, style: { ...style, thread: "studio" } }).join() + " 40 %"));
    const hookless = structuredClone(plan); delete hookless.shots[0].visualHook; const late = structuredClone(plan); late.shots[0].visualHook = { what: "something happens on screen at last", at: 4.5 }; const cam = structuredClone(plan); cam.shots[0].visualHook = { what: "the camera glides over the scene", at: 1 };
    t("launch: the first shot names a visual hook that lands by 3 s and is more than a camera move", /name the visual hook/.test(rules(hookless)) && /has to land in the first 3 s/.test(rules(late)) && /camera move alone is not a visual hook/.test(rules(cam)) && !/visual hook/.test(rules(plan)));
    const beat = structuredClone(plan); beat.musicPrompt = "lo-fi hip hop with a soft kick and snare"; if (beat.musicBrief) delete beat.musicBrief.voiceRoom;
    t("launch: a score under a narration says how it leaves room for the voice (no genre is banned)", /leaves room for the narration/.test(rules(beat)) && !/competes with the narration/.test(rules(beat)));
    t("launch: the narration is recorded in one take and the picture is cut to it", fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes("async function takeVoice") && fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes("the plan was cut to the narration") === false);
    t("launch: the editor levels every shot to one look, grades real footage into the world and measures the mix", ["ONE LOOK", "graded into the illustrated world", "EVEN MIX"].every((x) => fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes(x)));
    t("launch: a reference is profiled by transcription, never by silence detection", fs.readFileSync(path.join(ROOT, "engine", "lib", "reference.mjs"), "utf8").includes("words(file, lang)"));
  }
  {
    // Choreography: an end state, what stays still, a cause for anything that falls, no vague verbs.
    const loose = structuredClone(plan); delete loose.shots[1].end; loose.shots[2].still = []; loose.shots[3].motion = "cards fall from above, faster and faster";
    const r = L.planRules(loose, { brief, concepts }).join(" | ");
    t("launch: every animated shot is choreographed (end, still, a cause for what falls, no vague verbs)", /no choreographed end/.test(r) && /stays still/.test(r) && /no visible cause/.test(r) && /lets the model invent/.test(r));
    const cp = L.clipPromptOf(L.StyleBible.parse(style), "", L.PlannedShot.parse({ ...plan.shots[0], end: "the card rests in the tray", still: ["the window"] }));
    t("launch: the animation prompt carries the end frame, the still list and 'nothing appears or disappears'", /ends exactly on the last frame/.test(cp) && /the window/.test(cp) && /appears, disappears/.test(cp));
  }
  const brandFirst = structuredClone(plan); brandFirst.shots[0].vo = `${brief.product.name} is here. ` + brandFirst.shots[0].vo;
  t("launch: the first line opens on the pain, never on the product name", L.planRules(brandFirst, { brief, concepts, style }).some((x) => /first line names/.test(x)));
  const noProof = structuredClone(plan); noProof.shots = noProof.shots.map((s) => ({ ...s, role: s.role === "proof" ? "outcome" : s.role, claim: undefined }));
  t("launch: a plan with no proof moment is blocked", L.planRules(noProof, { brief, concepts }).some((x) => /proof/.test(x)));

  // ---- the whole flow on a throwaway project
  const slug = `_check-launch-${process.pid}`, d = path.join(P.PROJECTS, slug);
  try {
    const intake = ["new", slug, "--title", "check launch", "--series", "single", "--format", "launch", "--start", "idea", "--platform", "web", "--ar", "16:9", "--seconds", "30", "--lang", "en", "--cast", "none", "--budget", "cheapest", "--refs", "https://example.test"];
    const refused = node(["studio.mjs", ...intake.map((a) => (a === "30" ? "60" : a))]);
    t("launch: the intake refuses a length Release 1 can't finish", refused.status === 2 && /is not available yet/.test(refused.stderr));
    const made = node(["studio.mjs", ...intake]);
    t("launch: studio new creates a launch project", made.status === 0 && fs.existsSync(path.join(d, "launch")));
    if (made.status !== 0) return;
    // The creative files: the sample, with a mock interview, its assumption approved, and no characters (cast none).
    const env = new Set(style.environments.map((e) => e.id));
    P.writeJSON(L.fileOf(slug, "brief"), { ...brief, interview: [{ q: "mock: offline check", a: "mock" }], assumptions: brief.assumptions.map((a) => ({ ...a, approved: true })) });
    P.writeJSON(L.fileOf(slug, "concepts"), concepts);
    // S9 (a still) plays two real clips inside two bright-green screens: the proof-footage path.
    fs.mkdirSync(path.join(d, "media"), { recursive: true });
    for (const [k, c] of ["red", "blue"].entries()) ff(["-f", "lavfi", "-i", `color=c=${c}:s=720x1280:r=24:d=4`, "-pix_fmt", "yuv420p", path.join(d, "media", `clip${k}.mp4`)]);
    const withInserts = (s) => (s.id === "S9" ? { ...s, camera: "locked", prompt: `${s.prompt}, two small TV screens glowing solid bright green`, inserts: [{ file: "media/clip0.mp4" }, { file: "media/clip1.mp4" }] } : s);
    P.writeJSON(L.fileOf(slug, "plan"), { ...plan, shots: plan.shots.map((s) => withInserts({ ...s, assets: s.assets.filter((a) => env.has(a)) })) });
    const mapped = style.environments.map((e) => ({ ...e, anchor: e.ref, map: { camera: "the camera faces the set from the front", items: [{ name: "the main prop", look: "the main prop as on the set sheet", at: "center of the picture" }] } }));
    t("launch: a setting seen in two or more shots needs a set map", L.planRules({ ...plan, shots: plan.shots.map((s) => ({ ...s, assets: s.assets.filter((a) => env.has(a)) })) }, { brief, concepts, style: { ...style, environments: style.environments.map(({ map, ...e }) => e), characters: [], thread: "studio" } }).some((x) => /has no set map/.test(x)));
    for (const e of mapped) if (e.ref) { fs.mkdirSync(path.join(d, path.dirname(e.ref)), { recursive: true }); ff(["-f", "lavfi", "-i", "color=c=gray:s=640x360", "-frames:v", "1", path.join(d, e.ref)]); }
    P.writeJSON(L.fileOf(slug, "style"), { ...style, environments: mapped, characters: [], thread: "studio" });
    t("launch: the concept gate needs the brief rules (a broken brief can't be approved)", (() => { const b = P.readJSON(L.fileOf(slug, "brief")); P.writeJSON(L.fileOf(slug, "brief"), { ...b, interview: [] }); const r = F.stepStatus(P.loadShotlist(slug), "concept").ok; P.writeJSON(L.fileOf(slug, "brief"), b); return !r; })());
    // With references in the bank, the concept waits for the choice (none here: the mock writes its own plan).
    if (F.refsGate(P.loadShotlist(slug)).length) P.updateShotlist(slug, (x) => { x.refsChoice = { ids: [], said: "check" }; });
    F.approve(slug, "concept", "check");
    F.approve(slug, "script", "check");
    fs.mkdirSync(path.join(d, "frames"), { recursive: true });
    ff(["-f", "lavfi", "-i", "color=c=0xF4EBDD:s=1280x720", "-frames:v", "1", path.join(d, "frames", "look.png")]);
    P.updateShotlist(slug, (x) => { x.launch.voice = { eleven: "mock" }; });
    t("launch: the cast gate waits for the visual identity lock", !F.stepStatus(P.loadShotlist(slug), "cast").ok);
    P.updateShotlist(slug, (x) => { x.lookTest = { file: "frames/look.png", said: "check", at: new Date().toISOString() }; });
    F.approve(slug, "cast", "check");
    const applied = node(["launch.mjs", "apply", slug]);
    t("launch: apply turns the approved plan into the shotlist", applied.status === 0 && P.loadShotlist(slug).shots.length === plan.shots.length);
    t("launch: apply carries each shot's chain into the shotlist (a chained first frame is copied, never redrawn)", plan.shots.filter((s) => s.chain).every((s) => P.shot(P.loadShotlist(slug), s.id).chain === s.chain) && plan.shots.some((s) => s.chain));
    t("launch: a set-map item never has a conditional state; its changes are a timeline (changes from shot:first|last) turned into each shot's first and last frame state", L.read !== undefined && fs.readFileSync(path.join(ROOT, "engine", "lib", "launch.mjs"), "utf8").includes("has a conditional state") && fs.readFileSync(path.join(ROOT, "engine", "lib", "launch.mjs"), "utf8").includes("state: { ...s.state, ...s.endState }"));
    t("launch: board refuses a chained shot whose first frame is not the previous last frame, and a last frame drawn from another first", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("is not ${prevShot.id}'s last frame") && fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("drawn from another first frame"));
    t("launch: a last frame prompt leads with the shot's end state and names the opening frame as the first reference", fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("const sent = [endLead") && P.loadShotlist(slug).shots.some((s) => s.end));
    t("launch: a chained first frame is drawn (same framing) when the screen insert starts or ends, never copied; the judge sees each item in its timeline state", fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("const afterInsert = !!prev?.inserts?.length !== !!s.inserts?.length") && fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("const now = s.mapState?.[which]"));
    // Fake frames and a fake voice-over, then the animatic.
    const cols = ["0xE8735A", "0x5FA8A0", "0xF2C66D", "0xA79BD0"];
    P.updateShotlist(slug, (x) => {
      x.shots.filter((s) => s.lastPrompt).forEach((s) => { const f = `frames/${s.id}-last.png`; ff(["-f", "lavfi", "-i", "color=c=0x777777:s=1280x720", "-frames:v", "1", path.join(d, f)]); s.last = f; s.lastEval = { file: f, pass: true, fails: [], summary: "mock: offline check" }; });
      x.shots.filter((s) => s.source !== "card").forEach((s, i) => { const f = `frames/${s.id}-first.png`; ff(["-f", "lavfi", "-i", `color=c=${cols[i % 4]}:s=1280x720`, ...(s.inserts ? ["-vf", "drawbox=x=200:y=200:w=320:h=240:color=0x00FF00:t=fill,drawbox=x=760:y=200:w=320:h=240:color=0x00FF00:t=fill"] : []), "-frames:v", "1", path.join(d, f)]); s.frame = f; s.firstEval = { file: f, pass: true, fails: [], summary: "mock: offline check" }; });
      x.shots.forEach((s, i) => { const p = x.shots[i - 1]; if (s.chain === "exact" && p) s.frameSrc = p.last || (!p.lastPrompt ? p.frame : null); });
      fs.mkdirSync(path.join(d, "audio", "vo"), { recursive: true });
      x.launch.vo = {};
      // Mock lines that fill their room the way a continuous narration does (no silence over 1.2 s).
      const voShots = plan.shots.filter((p) => p.vo);
      voShots.forEach((s, k) => { const nx = voShots[k + 1]; const secs = +(((nx ? nx.start + (nx.voAt ?? 0.15) : plan.durationSeconds - 0.3) - (s.start + (s.voAt ?? 0.15))) - 0.4).toFixed(2); const f = `audio/vo/${s.id}.mp3`; ff(["-f", "lavfi", "-i", `sine=f=330:d=${secs}`, path.join(d, f)]); x.launch.vo[s.id] = { text: s.vo, file: f, secs, room: secs + 0.4, key: "mock" }; });
    });
    const an = node(["launch.mjs", "animatic", slug]);
    const anFrames = an.status === 0 ? Number(probe(path.join(d, "out", "animatic.mp4"), "stream=nb_read_frames").streams[0].nb_read_frames) : -1;
    t(`launch: the animatic lands on 720 frames (30 s at 24 fps; got ${anFrames})`, anFrames === 720);
    if (an.status !== 0) console.log(`       animatic failed: ${(an.stderr || an.stdout || "").trim().split("\n").slice(-4).join(" | ").slice(0, 400)}`);
    t("launch: the board waits for the creator to approve this plan's animatic", /hasn't approved this plan's animatic/.test(F.stepStatus(P.loadShotlist(slug), "board").why || JSON.stringify(F.stepStatus(P.loadShotlist(slug), "board"))));
    node(["launch.mjs", "animatic", slug, "--approve", "--said", "check"]);
    t("launch: the board step passes with the plan applied, the voice measured and a current animatic", F.stepStatus(P.loadShotlist(slug), "board").ok);
    t("a take with people outside its format's motion band is not usable", !F.evalsPass({ evals: { identity: { pass: true }, jumps: { internal: 0 }, dialogue: { pass: true }, motion: { score: 0.4, min: 1.5, pass: false } } }) && F.evalsPass({ evals: { identity: { pass: true }, jumps: { internal: 0 }, dialogue: { pass: true }, motion: { score: 2.1, min: 1.5, pass: true } } }));
    t("launch: a narration take off the blueprint blocks the board until the creator accepts it", (() => {
      const keep = P.loadShotlist(slug).launch?.voice;
      P.updateShotlist(slug, (x) => { x.launch.voice = { ...(x.launch.voice || {}), takeMode: true, measure: { wpm: 120, off: ["pace 120 wpm"] } }; });
      const blocked = !F.stepStatus(P.loadShotlist(slug), "board").ok;
      P.updateShotlist(slug, (x) => { x.launch.voice.measure.accepted = { said: "check" }; });
      const freed = /off the blueprint/.test(F.stepStatus(P.loadShotlist(slug), "board").detail || "") === false;
      P.updateShotlist(slug, (x) => { x.launch.voice = keep; });
      return blocked && freed;
    })());
    t("launch: a frame that failed its eval blocks the board", (() => {
      const keep = P.loadShotlist(slug).shots[0].firstEval;
      P.updateShotlist(slug, (x) => { x.shots[0].firstEval = { ...keep, pass: false, fails: ["the microphone: its stand is tangled"] }; });
      const st = F.stepStatus(P.loadShotlist(slug), "board");
      P.updateShotlist(slug, (x) => { x.shots[0].firstEval = keep; });
      return !st.ok && /failed its eval/.test(st.detail);
    })());
    t("launch: a frame flagged after its two attempts passes the board and is listed in the book for the creator", (() => {
      const keep = P.loadShotlist(slug).shots[0].firstEval;
      P.updateShotlist(slug, (x) => { x.shots[0].firstEval = { ...keep, pass: false, fails: ["the lamp moved"], flagged: true, attempts: 2 }; });
      const sl1 = P.loadShotlist(slug), st = F.stepStatus(sl1, "board"), listed = F.bookNotes(sl1).some((n) => /flagged after 2 attempts: the lamp moved/.test(n));
      P.updateShotlist(slug, (x) => { x.shots[0].firstEval = keep; });
      return !/failed its eval/.test(st.detail || "") && listed;
    })());
    {
      const m = { format: "launch", shots: [{ id: "A", duration: 3 }, { id: "B", duration: 4, characters: ["x"] }, { id: "C", source: "card" }], priceCheck: { pick: { key: "kling3" }, options: [{ key: "kling3" }, { key: "sd2-mini" }, { key: "seedance2-fast" }] } };
      t("autopilot: motion tests film the hardest shot with the pick and the best other model that takes a last frame", AP.testShot(m).id === "B" && AP.testModels(m)[0] === "kling3" && AP.testModels(m).length === 2 && AP.testModels(m)[1] !== "kling3");
    }
    t("a book approved with a motion test of the chosen model on screen counts as the pilot", F.bookTested({ defaults: { videoModel: "m1" }, flow: { approved: { book: { at: "2026-10-28T10:00" } } }, shots: [{ clips: [{ test: true, model: "m1", at: "2026-10-28T09:00" }] }] }) && !F.bookTested({ defaults: { videoModel: "m2" }, flow: { approved: { book: { at: "2026-10-28T10:00" } } }, shots: [{ clips: [{ test: true, model: "m1", at: "2026-10-28T09:00" }] }] }));
    const ass = fs.existsSync(path.join(d, "out", "_launch", "text.ass")) ? fs.readFileSync(path.join(d, "out", "_launch", "text.ass"), "utf8") : "";
    t("launch: every on-screen text and the brand go to the compositor word for word", plan.shots.flatMap((s) => (s.text || []).map((o) => o.text)).every((x) => ass.includes(x)) && ass.includes(style.brand.name));
    // Prices, book and budget (mocked price check), then fake takes, music and effects.
    P.updateShotlist(slug, (x) => { x.defaults = { videoModel: "kling3", res: "720p" }; x.priceCheck = { at: new Date().toISOString(), seconds: 0, options: [], pick: { key: "kling3", label: "Kling 3.0", res: "720p", usd: 0 } }; });
    const book = node(["book.mjs", slug]);
    t("launch: the Production Book builds with the strategy, the timed plan and the style bible", book.status === 0 && /Strategy/.test(fs.readFileSync(path.join(d, "book", "index.html"), "utf8")) && /visual identity locked/.test(fs.readFileSync(path.join(d, "book", "index.html"), "utf8")));
    t("launch: a missing motion test is shown in the book for the creator to decide, not a stop", F.bookNotes(P.loadShotlist(slug)).some((n) => /no motion test/.test(n)) && /in the book for the creator/.test(F.STEPS.book.check(P.loadShotlist(slug)).detail));
    t("launch: the book's total carries a reserve of one reroll per filmed shot", P.loadShotlist(slug).bookReserve > 0 && P.loadShotlist(slug).bookEstimate > P.loadShotlist(slug).bookReserve);
    node(["launch.mjs", "waive-test", slug, "--said", "check"]);
    F.approve(slug, "book", "check");
    P.updateShotlist(slug, (x) => {
      x.shots.filter(F.films).forEach((s) => { const f = `clips/${s.id}-take1.mp4`; fs.mkdirSync(path.join(d, "clips"), { recursive: true }); ff([...(s.inserts ? ["-loop", "1", "-i", path.join(d, s.frame), "-t", String(s.duration), "-r", "24"] : ["-f", "lavfi", "-i", `testsrc=s=1280x720:r=24:d=${s.duration}`]), "-pix_fmt", "yuv420p", path.join(d, f)]); s.clips = [{ file: f, model: "mock", evals: { identity: { pass: true }, jumps: { internal: 0 }, dialogue: { pass: true } } }]; s.clip = 0; });
      ff(["-f", "lavfi", "-i", "sine=f=220:d=40", path.join(d, "audio", "music.mp3")]);
      x.music = { ...x.music, files: ["audio/music.mp3"], pick: 0 };
      for (const n of Object.keys(plan.sfx)) ff(["-f", "lavfi", "-i", "sine=f=880:d=0.5", path.join(d, "audio", `sfx-${n}.mp3`)]);
    });
    t("launch: every shot has a take that passed; the film step passes", F.stepStatus(P.loadShotlist(slug), "film").ok);
    t("launch: the final refuses a take nobody reviewed frame by frame", node(["launch.mjs", "build", slug]).status === 2);
    const first = P.loadShotlist(slug).shots.filter(F.films)[0];
    t("launch: a review verdict without answers to the checklist is refused", node(["launch.mjs", "review", slug, "--shot", first.id, "--ok", "looks fine"]).status === 2);
    const A = ["--motion", "mock natural motion", "--join", "mock clean join", "--logic", "mock story holds", "--appear", "mock nothing pops", "--end", "mock planned end"];
    for (const s of P.loadShotlist(slug).shots.filter(F.films)) { node(["launch.mjs", "review", slug, "--shot", s.id]); node(["launch.mjs", "review", slug, "--shot", s.id, "--ok", "mock: offline check", ...A]); }
    const built = node(["launch.mjs", "build", slug]);
    const out = path.join(d, "out", `${slug}.mp4`);
    let pr = null; try { pr = probe(out, "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames"); } catch {}
    const v = pr?.streams.find((s) => s.codec_type === "video"), a = pr?.streams.find((s) => s.codec_type === "audio");
    t(`launch: the editor builds a 1280x720 H.264 yuv420p film at 24 fps, exactly 720 frames, with audio (${built.status === 0 ? `${v?.width}x${v?.height} ${v?.nb_read_frames} frames` : built.stderr.slice(-160)})`, built.status === 0 && v?.codec_name === "h264" && v.pix_fmt === "yuv420p" && v.width === 1280 && v.height === 720 && v.r_frame_rate === "24/1" && Number(v.nb_read_frames) === 720 && !!a);
    // Inside S9 (23.5–26.5 s): the left screen shows the red clip, the right one the blue clip, and no green is left.
    const px = (t, x, y) => [...execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])].slice(0, 3);
    const [l, rr] = built.status === 0 ? [px(24, 360, 320), px(24, 920, 320)] : [[0, 255, 0], [0, 255, 0]];
    t(`launch: real footage plays inside each green screen, in reading order, with no green left (left ${l}, right ${rr})`, l[0] > 100 && l[0] > l[1] + 60 && rr[2] > 90 && rr[2] > rr[1] + 60 && l[1] < 90 && rr[1] < 90);
    // The music keeps playing after the last voice-over line (the brand card), at the plan's last-shot level.
    const tail = built.status === 0 ? Number((spawnSync("ffmpeg", ["-hide_banner", "-ss", "27.5", "-t", "1.5", "-i", out, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/mean_volume: (-?[\d.]+)/) || [])[1]) : -99;
    t(`launch: music plays under the brand card after the voice ends (${tail} dB)`, tail > -40);
    const sl = P.loadShotlist(slug);
    t("launch: the editor's QC passes and the edit step accepts the cut", !!sl.finalQc?.pass && F.stepStatus(sl, "edit").ok);
    const man = P.readJSON(path.join(d, "launch", "production-manifest.json"), null);
    t("launch: the production manifest ties every shot to its source, take, prompt and cost", man?.shots?.length === plan.shots.length && man.shots.every((s) => s.used && "actualUsd" in s) && man.sha === F.fileSha(out));
    // Selective regeneration: changing one shot's animation keeps every other frame and take.
    const p2 = P.readJSON(L.fileOf(slug, "plan")); p2.shots[0].motion += " slowly";
    P.writeJSON(L.fileOf(slug, "plan"), p2);
    const fp0 = F.FINGERPRINT.script(P.loadShotlist(slug));
    t("launch: changing a shot's animation keeps the script approved (craft is not the creator's script)", F.stepStatus(P.loadShotlist(slug), "script").ok);
    { const p3 = structuredClone(p2); p3.shots[0].vo = (p3.shots[0].vo || "") + " Really."; P.writeJSON(L.fileOf(slug, "plan"), p3);
      t("launch: changing a voice-over line reopens the script", F.FINGERPRINT.script(P.loadShotlist(slug)) !== fp0); P.writeJSON(L.fileOf(slug, "plan"), p2); }
    F.approve(slug, "script", "check");
    const stopped = node(["launch.mjs", "apply", slug]);
    t("launch: a change that discards a paid take or frame stops and says what redrawing costs (REDRAW STOP)", stopped.status !== 0 && /REDRAW STOP/.test(String(stopped.stdout) + String(stopped.stderr)));
    node(["launch.mjs", "apply", slug, "--said", "check"]);
    const after = P.loadShotlist(slug), s1 = after.shots[0], rest = after.shots.slice(1).filter(F.films);
    t("launch: a changed shot loses only its own take; every other frame and take is kept", !!s1.frame && !s1.clips && rest.every((s) => s.clips?.length === 1));
    t("launch: refilming one shot after an animation change stays inside the approved book (its reserve)", F.stepStatus(after, "book").ok);
    t("launch: the final QC needs a quality report on the exact final file", L.qualityRules(null, "x").length > 0 && L.qualityRules({ sha: "old", heuristic: true, scores: Object.fromEntries(L.SCORE_KEYS.map((k) => [k, 4])), reasons: Object.fromEntries(L.SCORE_KEYS.map((k) => [k, "ok"])), findings: [] }, "new").some((x) => /another version/.test(x)));
  } finally { if (!process.env.KEEP_LAUNCH_CHECK) fs.rmSync(d, { recursive: true, force: true }); } // KEEP_LAUNCH_CHECK=1: keep the mock project to look at its frames
}
