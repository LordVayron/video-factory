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

export default function checkLaunch(t, ROOT) {
  const node = (args) => spawnSync(process.execPath, args.map((a, i) => (i === 0 ? path.join(ROOT, "engine", a) : a)), { encoding: "utf8", cwd: ROOT });
  const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
  const probe = (f, entries) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", entries, "-of", "json", f]).toString());
  const sample = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "launch", "video-factory", f), "utf8"));
  const brief = sample("brief.json"), concepts = sample("concepts.json"), plan = sample("shot-plan.json"), style = sample("style-bible.json");

  // ---- the rules, on the sample and on broken copies
  t("launch: the sample's concepts and timed plan pass every rule", !L.conceptRules(concepts, brief).length && !L.planRules(plan, { brief, concepts, style }).length);
  t("launch: the sample brief waits for the creator's interview and his yes on its assumption", L.briefRules(brief).some((x) => /entrevista/.test(x)) && L.briefRules(brief).some((x) => /sin aprobar/.test(x)));
  const shifted = structuredClone(plan); shifted.shots[3].duration += 0.6;
  t("launch: shot durations must add up to the length (±0.25 s) with no gaps", L.planRules(shifted, { brief, concepts }).some((x) => /suman/.test(x)) && L.planRules(shifted, { brief, concepts }).some((x) => /sin huecos/.test(x)));
  const claimy = structuredClone(plan); claimy.shots[1].vo = "Ten times faster than any agency.";
  t("launch: a measurable claim without a proven capability is blocked", L.planRules(claimy, { brief, concepts }).some((x) => /afirma algo medible/.test(x)));
  const lettered = structuredClone(plan); lettered.shots[0].prompt += ' with a sign that reads "SALE"';
  t("launch: a prompt that asks the model for exact text is blocked (the editor composites text)", L.planRules(lettered, { brief, concepts }).some((x) => /entre comillas/.test(x)));
  // ---- every launch film rule
  const R = (p) => L.planRules(p, { brief, concepts, style: { ...style, thread: "sample-founder" } }).join(" | ");
  const unchained = structuredClone(plan); delete unchained.shots[1].chain;
  t("launch: two shots in the same place must be chained (exact last frame or the same set)", /encadénala/.test(R(unchained)));
  const exactNoEnd = structuredClone(plan); exactNoEnd.shots[1].chain = "exact"; delete exactNoEnd.shots[0].end;
  t("launch: chain exact needs the previous shot's choreographed last frame", /no tiene final coreografiado \(shot.end\)/.test(R(exactNoEnd)) || /chain "exact" empieza/.test(R(exactNoEnd)));
  const unasked = structuredClone(plan); delete unasked.shots[2].transitionAsked;
  t("launch: a transition the creator didn't ask for is refused", /sin las palabras del creador que la piden/.test(R(unasked)));
  const fx = structuredClone(plan); delete fx.sfx[Object.keys(fx.sfx)[0]].said;
  t("launch: an effect the creator didn't ask for or approve is refused", /sfx\..*\.said/.test(R(fx)));
  const txt = structuredClone(plan); const ts = txt.shots.find((x) => (x.text || []).some((o) => o.kind !== "cta")); ts.text.find((o) => o.kind !== "cta").said = "";
  t("launch: on-screen text the creator didn't ask for is refused (only the brand and the CTA go unasked)", /text\.said/.test(R(txt)));
  // Throwaway characters, so the test runs on any install (the public bible ships no characters).
  const mk = (id, name) => { const d = path.join(ROOT, "bible", "characters", id); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "character.json"), JSON.stringify({ id, name, species: "human", look: "a test character" })); return id; };
  const crewId = mk(`_check-crew-${process.pid}`, "the check crew"), handId = mk(`_check-hand-${process.pid}`, "The Check Hand");
  const idle = structuredClone(plan); idle.shots[1].assets.push(crewId); idle.shots[1].motion = "the camera drifts slowly to the right";
  t("launch: a character in frame with nothing to do is refused", /no dice qué hace/.test(R(idle)));
  const pile = structuredClone(plan); pile.shots[0].motion = "one card drops from the pile onto the desk"; pile.shots[0].end = (pile.shots[0].end || "") + " the card lies on the desk";
  t("launch: nothing falls near a pile (video models animate piles on their own)", /junto a una pila/.test(R(pile)));
  const slow = structuredClone(plan); slow.shots[0].role = "possibility"; slow.shots[0].voAt = 1.2;
  t("launch: the first shot hooks (hook, friction or problem; the voice by 0.5 s)", /engancha/.test(R(slow)));
  const story = structuredClone(concepts); story.concepts[0].creativeThesis = "A tiny rental store at night"; story.concepts[0].metaphorMapsTo = "a cozy shop where tapes wait";
  t("launch: a concept that tells a story without naming the product or its category is refused", L.conceptRules(story, brief).some((x) => /lanza el producto/.test(x)));
  const nopain = structuredClone(plan); nopain.shots.forEach((x) => { if (["hook", "friction", "problem"].includes(x.role) && x.start < 8) x.role = "possibility"; });
  t("launch: the pain must be readable by 8 s", /antes de los 8 s/.test(R(nopain)));
  const hands = structuredClone(plan); const RH = (p) => L.planRules(p, { brief, concepts, style: { ...style, thread: handId } }).join(" | "); hands.shots[0].assets.push(handId); hands.shots[0].motion += "; another hand presses the card";
  t("launch: one hand per shot (models invent extra hands)", /una sola mano/.test(RH(hands)));
  for (const id of [crewId, handId]) fs.rmSync(path.join(ROOT, "bible", "characters", id), { recursive: true, force: true });
  const busy = structuredClone(plan); busy.shots[1].motion = "a; b; c; d";
  t("launch: one clear action per shot (more than three is refused)", /más de tres acciones/.test(R(busy)));
  t("launch: the board asks for the animatic again once every frame is drawn", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("no ha visto el animatic con los cuadros dibujados"));
  // ---- art styles: bible styles with a launch block, or the creator's own from references
  const ls = L.launchStyles();
  t("launch: films can use storybook, anime or hyperreal; phone UGC and podcast styles are not offered", ["storybook", "anime", "hyperreal"].every((x) => ls.includes(x)) && !ls.includes("ugc-phone") && !ls.includes("podcast"));
  const anime = structuredClone(concepts); anime.config.visualStyle = "anime"; const phone = structuredClone(concepts); phone.config.visualStyle = "ugc-phone";
  t("launch: a concept in an offered style passes; one in a style without a launch block is refused", !L.conceptRules(anime, brief).some((x) => /estilo/.test(x)) && L.conceptRules(phone, brief).some((x) => /estilo/.test(x)));
  const tmpStyle = path.join(ROOT, "bible", "styles", `_check-style-${process.pid}`); fs.mkdirSync(path.join(tmpStyle, "refs"), { recursive: true });
  fs.writeFileSync(path.join(tmpStyle, "refs", "a.png"), "x");
  const cst = { id: "_c", kind: "custom", dir: tmpStyle, refs: ["refs/a.png"], look: "short", negative: "", launch: null, madeFrom: {} };
  const bad = L.customStyleRules(cst);
  fs.writeFileSync(path.join(tmpStyle, "refs", "b.png"), "x");
  const good = L.customStyleRules({ ...cst, refs: ["refs/a.png", "refs/b.png"], look: "flat bold shapes, thick black outline, two-tone shading, grainy risograph texture, warm noon light, shallow depth", negative: "3D, photorealism, text", launch: { insertTreatment: "none" }, madeFrom: { said: "check" } });
  fs.rmSync(tmpStyle, { recursive: true, force: true });
  t("launch: a style from the creator's references needs 2+ images, a written look, a never-list, a footage treatment and their words", bad.length >= 4 && !good.length);
  const src = (f) => fs.readFileSync(path.join(ROOT, "engine", ...f.split("/")), "utf8");
  t("launch: chain exact copies the previous shot's last frame as the first frame (free) and same-set draws from it", src("gen.mjs").includes('s.chain === "exact"') && src("gen.mjs").includes("The same set as the first reference image"));
  t("launch: the editor measures every chain exact join (SSIM) and fails a jump", src("launch.mjs").includes("la unión con") && src("launch.mjs").includes('"-lavfi", "ssim"'));
  t("launch: a take review answers motion, join, logic, appear and end in words, after its sheet and its join sheet", ["--motion", "--join", "--logic", "--appear", "--end", "-join.jpg"].every((x) => src("launch.mjs").includes(x)));
  t("launch: every edit decision on a take needs the creator's words", src("launch.mjs").includes("la decisión de edición ${k} no tiene las palabras del creador"));
  t("launch: a narration re-cut keeps the creator's pauses (shot.pause)", src("launch.mjs").includes("const pauses = plan.shots.map((s) => s.pause || 0)"));
  t("launch: apply keeps a take whose animation prompt didn't change, whatever its new length", src("launch.mjs").includes("o.prompt === s.prompt && len > 0"));
  t("launch: rules are model-agnostic; only models that take a last frame are offered and filmed", MODELS.kling3.lastFrame && MODELS.veo.lastFrame && MODELS.sd2.lastFrame && MODELS.wan3.lastFrame && MODELS.grok.lastFrame === false && src("studio.mjs").includes("MODELS[o.key]?.lastFrame") && src("gen.mjs").includes("no acepta cuadro final"));
  t("launch: effects are measured and set well under the narration", /const SFX_LUFS = -3[5-9]/.test(src("launch.mjs")));
  t("launch: real footage gets the project style's own treatment (launch.insertTreatment), not a fixed storybook grade", src("launch.mjs").includes("launch?.insertTreatment") && !src("launch.mjs").includes('/storybook|illustrat/i.test(style.preset)'));
  t("launch: every frame and character sheet receives a custom style's reference images", src("gen.mjs").includes("const stRefs") && fs.readFileSync(path.join(ROOT, "engine", "cast.mjs"), "utf8").includes("a custom style's reference images"));
  t("launch: style-from-refs copies the creator's images into the bible and needs their words", src("launch.mjs").includes('"style-from-refs"()') && src("launch.mjs").includes('--said "palabras exactas del creador"'));
  const same = structuredClone(concepts); same.concepts[2] = { ...same.concepts[0], id: "copy" };
  t("launch: concepts that are paraphrases of each other are blocked", L.conceptRules(same).some((x) => /se parecen/.test(x)));
  const wide = structuredClone(concepts); wide.config.aspectRatio = "9:16"; wide.config.durationSeconds = 60;
  t("launch: options outside Release 1 are refused, not offered", L.conceptRules(wide).filter((x) => /todavía no disponible/.test(x)).length === 2);
  const conv = structuredClone(concepts); conv.config.intent = "conversion";
  const late = structuredClone(plan); late.shots[0].role = "possibility";
  t("launch: a conversion film must open on the pain and end on a visible CTA", L.planRules(late, { brief, concepts: conv }).some((x) => /abrir en el dolor/.test(x)) && L.planRules(plan, { brief, concepts: conv }).some((x) => /CTA visible/.test(x)));
  const badInsert = structuredClone(plan); badInsert.shots[0].inserts = [{ file: "media/x.mp4" }];
  t("launch: real footage needs a locked camera and screens drawn bright green", L.planRules(badInsert, { brief, concepts }).some((x) => /cámara tiene que quedar fija/.test(x)) && L.planRules(badInsert, { brief, concepts }).some((x) => /verde brillante/.test(x)));
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
    t("standard sheet: the cast gate needs one for every character of a new project, and it is the reference models receive", fs.readFileSync(path.join(ROOT, "engine", "lib", "flow.mjs"), "utf8").includes("sin ficha estándar") && fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("P.characterLook(ch, sl.style).modelSheet"));
  }
  const still = structuredClone(plan); still.shots[1].source = "still"; still.shots[2].source = "card";
  t("launch: every shot is animated (a still with a zoom or a flat card is refused)", L.planRules(still, { brief, concepts }).filter((x) => /todas las tomas van animadas/.test(x)).length === 2);
  {
    // Story rules: a continuous narration, motivated cuts, one thread, one light, no beat under the voice.
    const sb = { ...style, thread: "sample-founder" }, rules = (p) => L.planRules(p, { brief, concepts, style: sb }).join(" | ");
    const thin = structuredClone(plan); thin.shots.forEach((s, i) => { if (i % 2) delete s.vo; });
    t("launch: a narrated film keeps talking (density near the reference, no silent shot but the ending)", /palabras de narración/.test(rules(thin)) && /la voz no se detiene/.test(rules(thin)) && /la referencia tiene 2.76/.test(L.planRules(thin, { brief, concepts, style: sb, reference: { narration: { wordsPerSecondOfFilm: 2.76 } } }).join()));
    const loose = structuredClone(plan); delete loose.shots[3].connect; loose.shots[4].transitionIn = "slideleft"; loose.shots[5].prompt += " at sunset";
    t("launch: every cut says how it follows, slides are refused, the light never changes", /no dice cómo sigue/.test(rules(loose)) && /no con círculos ni barridos/.test(rules(loose)) && /sunset/.test(rules(loose)));
    const tilt = structuredClone(plan); tilt.shots[4].transitionIn = "slideup"; tilt.shots[4].connect = { type: "action", how: "the camera tilts down" };
    t("launch: a vertical tilt is only allowed between two heights of the same place", /paneo vertical: solo entre dos alturas/.test(rules(tilt)));
    t("launch: one thread opens and closes the film", /hilo conductor/.test(L.planRules(plan, { brief, concepts, style: { ...style, thread: undefined } }).join()) && /40 %/.test(L.planRules(plan, { brief, concepts, style: { ...style, thread: "studio" } }).join() + " 40 %"));
    const beat = structuredClone(plan); beat.musicPrompt = "lo-fi hip hop with a soft kick and snare";
    t("launch: no beat under a narration", /compite con la narración/.test(rules(beat)));
    t("launch: the narration is recorded in one take and the picture is cut to it", fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes("async function takeVoice") && fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes("the plan was cut to the narration") === false);
    t("launch: the editor levels every shot to one look, grades real footage into the world and measures the mix", ["ONE LOOK", "graded into the illustrated world", "EVEN MIX"].every((x) => fs.readFileSync(path.join(ROOT, "engine", "launch.mjs"), "utf8").includes(x)));
    t("launch: a reference is profiled by transcription, never by silence detection", fs.readFileSync(path.join(ROOT, "engine", "lib", "reference.mjs"), "utf8").includes("words(file, lang)"));
  }
  {
    // Choreography: an end state, what stays still, a cause for anything that falls, no vague verbs.
    const loose = structuredClone(plan); delete loose.shots[1].end; loose.shots[2].still = []; loose.shots[3].motion = "cards fall from above, faster and faster";
    const r = L.planRules(loose, { brief, concepts }).join(" | ");
    t("launch: every animated shot is choreographed (end, still, a cause for what falls, no vague verbs)", /sin final coreografiado/.test(r) && /se queda quieto/.test(r) && /sin causa visible/.test(r) && /deja que el modelo invente/.test(r));
    const cp = L.clipPromptOf(L.StyleBible.parse(style), "", L.PlannedShot.parse({ ...plan.shots[0], end: "the card rests in the tray", still: ["the window"] }));
    t("launch: the animation prompt carries the end frame, the still list and 'nothing appears or disappears'", /ends exactly on the last frame/.test(cp) && /the window/.test(cp) && /appears, disappears/.test(cp));
  }
  const noProof = structuredClone(plan); noProof.shots = noProof.shots.map((s) => ({ ...s, role: s.role === "proof" ? "outcome" : s.role, claim: undefined }));
  t("launch: a plan with no proof moment is blocked", L.planRules(noProof, { brief, concepts }).some((x) => /prueba/.test(x)));

  // ---- the whole flow on a throwaway project
  const slug = `_check-launch-${process.pid}`, d = path.join(P.PROJECTS, slug);
  try {
    const intake = ["new", slug, "--title", "check launch", "--series", "single", "--format", "launch", "--start", "idea", "--platform", "web", "--ar", "16:9", "--seconds", "30", "--lang", "en", "--cast", "none", "--budget", "cheapest", "--refs", "https://example.test"];
    const refused = node(["studio.mjs", ...intake.map((a) => (a === "30" ? "60" : a))]);
    t("launch: the intake refuses a length Release 1 can't finish", refused.status === 2 && /todavía no está disponible/.test(refused.stderr));
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
    P.writeJSON(L.fileOf(slug, "style"), { ...style, characters: [], thread: "studio" });
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
    // Fake frames and a fake voice-over, then the animatic.
    const cols = ["0xE8735A", "0x5FA8A0", "0xF2C66D", "0xA79BD0"];
    P.updateShotlist(slug, (x) => {
      x.shots.filter((s) => s.lastPrompt).forEach((s) => { const f = `frames/${s.id}-last.png`; ff(["-f", "lavfi", "-i", "color=c=0x777777:s=1280x720", "-frames:v", "1", path.join(d, f)]); s.last = f; });
      x.shots.filter((s) => s.source !== "card").forEach((s, i) => { const f = `frames/${s.id}-first.png`; ff(["-f", "lavfi", "-i", `color=c=${cols[i % 4]}:s=1280x720`, ...(s.inserts ? ["-vf", "drawbox=x=200:y=200:w=320:h=240:color=0x00FF00:t=fill,drawbox=x=760:y=200:w=320:h=240:color=0x00FF00:t=fill"] : []), "-frames:v", "1", path.join(d, f)]); s.frame = f; });
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
    t("launch: the board waits for the creator to approve this plan's animatic", /no aprobó el animatic/.test(F.stepStatus(P.loadShotlist(slug), "board").why || JSON.stringify(F.stepStatus(P.loadShotlist(slug), "board"))));
    node(["launch.mjs", "animatic", slug, "--approve", "--said", "check"]);
    t("launch: the board step passes with the plan applied, the voice measured and a current animatic", F.stepStatus(P.loadShotlist(slug), "board").ok);
    const ass = fs.existsSync(path.join(d, "out", "_launch", "text.ass")) ? fs.readFileSync(path.join(d, "out", "_launch", "text.ass"), "utf8") : "";
    t("launch: every on-screen text and the brand go to the compositor word for word", plan.shots.flatMap((s) => (s.text || []).map((o) => o.text)).every((x) => ass.includes(x)) && ass.includes(style.brand.name));
    // Prices, book and budget (mocked price check), then fake takes, music and effects.
    P.updateShotlist(slug, (x) => { x.defaults = { videoModel: "kling3", res: "720p" }; x.priceCheck = { at: new Date().toISOString(), seconds: 0, options: [], pick: { key: "kling3", label: "Kling 3.0", res: "720p", usd: 0 } }; });
    const book = node(["book.mjs", slug]);
    t("launch: the Production Book builds with the strategy, the timed plan and the style bible", book.status === 0 && /Strategy/.test(fs.readFileSync(path.join(d, "book", "index.html"), "utf8")) && /visual identity locked/.test(fs.readFileSync(path.join(d, "book", "index.html"), "utf8")));
    t("launch: the book waits for a motion test on the chosen video model (or the creator's waiver)", /prueba de movimiento/.test(JSON.stringify(F.stepStatus(P.loadShotlist(slug), "book"))));
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
    t(`launch: real footage plays inside each green screen, in reading order, with no green left (left ${l}, right ${rr})`, l[0] > 150 && l[1] < 90 && rr[2] > 150 && rr[1] < 90);
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
    t("launch: changing the plan after approval reopens the script gate, and apply waits for it", !F.stepStatus(P.loadShotlist(slug), "script").ok && node(["launch.mjs", "apply", slug]).status === 2);
    F.approve(slug, "script", "check");
    node(["launch.mjs", "apply", slug]);
    const after = P.loadShotlist(slug), s1 = after.shots[0], rest = after.shots.slice(1).filter(F.films);
    t("launch: a changed shot loses only its own take; every other frame and take is kept", !!s1.frame && !s1.clips && rest.every((s) => s.clips?.length === 1));
    t("launch: the new take is the only video left to estimate (the book reopens)", !F.stepStatus(after, "book").ok);
    t("launch: the final QC needs a quality report on the exact final file", L.qualityRules(null, "x").length > 0 && L.qualityRules({ sha: "old", heuristic: true, scores: Object.fromEntries(L.SCORE_KEYS.map((k) => [k, 4])), reasons: Object.fromEntries(L.SCORE_KEYS.map((k) => [k, "ok"])), findings: [] }, "new").some((x) => /otra versión/.test(x)));
  } finally { if (!process.env.KEEP_LAUNCH_CHECK) fs.rmSync(d, { recursive: true, force: true }); } // KEEP_LAUNCH_CHECK=1: keep the mock project to look at its frames
}
