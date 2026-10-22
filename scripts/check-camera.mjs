// Offline checks of the camera kits: optics reach the stills and are held in the video prompts, moves reach the
// video, illustrated styles and the broadcast sitcom take no optics, the creator picks any kit (whole, in parts or per
// shot) in their words, and the rules catch unknown gear, stacked or repeated bold moves and a wide lens on a face.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as C from "../engine/lib/camera.mjs";
import * as P from "../engine/lib/project.mjs";
import * as F from "../engine/lib/flow.mjs";

export default function (t, ROOT) {
  const real = { kind: "realistic", id: "hyperreal" };
  const sl = { format: "micro-drama", style: "hyperreal", ar: "16:9", camera: { kit: "film-cooke", said: "check" }, shots: [] };
  const s = { id: "s1", framing: "medium shot", image: "a woman at a cafe window", motion: "she lifts her cup", move: "push-in", audioMode: "silent" };
  t("camera: a kit's optics describe body, lens, focal length and aperture for a still", /35mm motion picture film/.test(C.opticsFor(sl, s, real)) && /Cooke S4/.test(C.opticsFor(sl, s, real)) && /50mm/.test(C.opticsFor(sl, s, real)) && /f\/2\.8/.test(C.opticsFor(sl, s, real)));
  t("camera: illustrated styles, the broadcast sitcom and projects without a kit take no optics", C.opticsFor(sl, s, { kind: "illustrated" }) === "" && C.opticsFor(sl, s, { kind: "realistic", id: "retro-sitcom" }) === "" && C.opticsFor({ shots: [] }, s, real) === "");
  t("camera: the creator can change one part for the film, or a whole kit on one shot", C.rigOf({ camera: { kit: "film-cooke", lens: "anamorphic" } }).lens === "anamorphic" && C.rigOf(sl, { rig: { kit: "vintage-16" } }).body === "film-16" && C.rigOf(sl, { rig: { focal: 85 } }).focal === 85);
  const img = P.imagePrompt(sl, s);
  t("camera: the frame prompt carries the optics and drops the default lens that would contradict them", /Cooke S4/.test(img) && !/35mm lens\./.test(img) && /35mm lens/.test(P.imagePrompt({ ...sl, camera: undefined }, s)));
  const mot = P.motionPrompt(sl, s);
  t("camera: the video prompt carries the shot's move and holds the optics", /slowly dollies in/.test(mot) && /Keep the look of 35mm motion picture film/.test(mot));
  const clip = P.clipPrompt(sl, { ...s, prompt: "She lifts her cup and smiles.", dialogue: [{ char: "x", text: "" }] });
  t("camera: a clip prompt (clips formats) carries the move and the optics hold", /slowly dollies in/.test(clip) && /Keep the look/.test(clip));
  t("camera: unknown kits, parts and moves are refused", C.cameraRules({ camera: { kit: "nope" }, shots: [] }).length && C.cameraRules({ camera: { kit: "film-cooke", lens: "nope" }, shots: [] }).length && C.cameraRules({ shots: [{ id: "a", move: "spin" }] }).length);
  t("camera: one bold move per film unless the creator says so", C.cameraRules({ shots: [{ id: "a", move: "crash-zoom" }, { id: "b", move: "whip-pan" }] }).length === 1 && !C.cameraRules({ camera: { boldOk: { said: "yes" } }, shots: [{ id: "a", move: "crash-zoom" }, { id: "b", move: "whip-pan" }] }).length);
  t("camera: a wide lens on a face and two moves in one shot are refused (the creator can still ask for the lens)", C.cameraRules({ camera: { kit: "film-cooke", focal: 14 }, shots: [{ id: "a", framing: "close-up", characters: ["x"] }] }).length && !C.cameraRules({ camera: { kit: "film-cooke", focal: 14 }, shots: [{ id: "a", framing: "close-up", characters: ["x"], cameraOk: { said: "yes" } }] }).length && C.cameraRules({ shots: [{ id: "a", camera: "push in and then pan left" }] }).length);
  t("camera: every format with a photographic look has a recommended kit, and every kit is in the catalog", ["micro-drama", "cinematic", "fantasy", "ugc", "influencer", "launch", "podcast", "meditation"].every((f) => C.KITS[C.recommendedKit(f)]) && C.recommendedKit("sitcom") === null);
  t("camera: a new project waits for the creator's kit choice at the cast gate", F.cameraProblems({ cameraRequired: true, style: "hyperreal", format: "ugc", slug: "x", shots: [] }).some((x) => /choose the camera kit/.test(x)) && !F.cameraProblems({ cameraRequired: true, style: "hyperreal", format: "ugc", slug: "x", camera: { kit: "phone", said: "yes" }, shots: [] }).length && !F.cameraProblems({ cameraRequired: true, style: "storybook", format: "launch", slug: "x", shots: [] }).length);
  // The command records the choice in the creator's words on a throwaway project.
  const slug = `_check-camera-${process.pid}`, d = path.join(P.PROJECTS, slug);
  try {
    P.writeJSON(path.join(d, "shotlist.json"), { slug, format: "ugc", style: "hyperreal", shots: [], flow: { v: 5, approved: {}, overrides: [], log: [] }, cameraRequired: true });
    const node = (a) => spawnSync(process.execPath, [path.join(ROOT, "engine", "studio.mjs"), ...a], { encoding: "utf8", cwd: ROOT });
    const noWords = node(["camera", slug, "--kit", "phone"]);
    const ok = node(["camera", slug, "--kit", "film-cooke", "--lens", "anamorphic", "--said", "check"]);
    const saved = P.loadShotlist(slug).camera;
    t("camera: studio.mjs camera records the kit (and any part changed) only with the creator's words", noWords.status !== 0 && ok.status === 0 && saved.kit === "film-cooke" && saved.lens === "anamorphic" && saved.said === "check");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
