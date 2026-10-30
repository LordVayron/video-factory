// Engine v6 direction layer and sequence critics, for scripts/check.mjs. Offline, no spend.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as D from "../engine/lib/direction.mjs";
import * as C from "../engine/lib/critics.mjs";
import { recommend } from "../engine/lib/pricing.mjs";
import { MODELS } from "../engine/lib/models.mjs";

export default function checkDirection(t, ROOT) {
  const shots = [
    { id: "A", place: "desk", shotType: "wide", camera: "static", duration: 2.5, start: 0, action: "He sits down" },
    { id: "B", place: "desk", shotType: "close-up", camera: "slow push-in", duration: 2, start: 2.5, action: "He frowns" },
    { id: "C", place: "desk", shotType: "medium", angle: "over-the-shoulder", camera: "locked", duration: 3, start: 4.5, action: "The screen lights up" },
    { id: "D", place: "street", shotType: "wide", camera: "pull back", duration: 6, start: 7.5 },
    { id: "E", place: "street", shotType: "wide", camera: "pull back", duration: 5, start: 13.5, unbroken: true },
    { id: "K", source: "card", duration: 2, start: 18.5 },
  ];
  const byId = Object.fromEntries(shots.map((s) => [s.id, s]));

  t("v6: shot sizes read from plain words (wide, close-up, insert, graphic card)", D.shotSize({ shotType: "wide" }) === 1 && D.shotSize({ shotType: "close-up on the phone" }) === 5 && D.shotSize({ shotType: "insert of the screen" }) === 6 && D.shotSize({ shotType: "graphic card" }) === 7 && D.shotSize({ shotType: "nice view" }) == null);
  t("v6: a cut in one place needs a new size or angle; the same view again is a jump cut", D.grammar(shots).length === 0 && D.grammar([shots[0], { ...shots[1], shotType: "wide" }]).some((x) => /jump cut/.test(x)));
  const seqs = D.planSequences(shots, { maxSecs: 10, mode: "cuts" });
  const cam = D.planSequences(shots, { maxSecs: 10 });
  t("v6: continuous camera is the standard: a scene is one take with no cuts, split at its planned beats", D.DEFAULT_MODE === "camera" && cam[0].mode === "camera" && cam[0].shots.join() === "A,B,C" && D.cutsOf(cam[0], byId).length === 0 && JSON.stringify(D.beatsOf(cam[0], byId)) === "[0,2.5,4.5]");
  const camPrompt = D.sequencePrompt(cam[0], byId);
  t("v6: a camera sequence prompt moves the camera between the views without a cut, and keeps words off screens", /ONE continuous shot/.test(camPrompt) && /camera moves smoothly, without a cut, to a close-up view/.test(camPrompt) && /never readable words/.test(camPrompt));
  t("v6: a scene in one place becomes one sequence; a new place starts another; cards go to the editor", seqs[0].shots.join() === "A,B,C" && seqs[1].shots.join() === "D" && seqs.at(-1).editor === true);
  t("v6: a sequence over the model's length splits, and the part of an unbroken shot continues the previous take", seqs[2].shots.join() === "E" && seqs[2].continues === seqs[1].id);
  t("v6: without a model that cuts inside one call, every shot is its own sequence", D.planSequences(shots, { maxSecs: 10, mode: "cuts", multiShot: false }).filter((q) => !q.editor).length === 5);
  t("v6: a sequence's cuts are timed from its start", JSON.stringify(D.cutsOf(seqs[0], byId)) === "[2.5,4.5]");
  const prompt = D.sequencePrompt(seqs[0], byId, { cast: ["Leo: curly hair"] });
  t("v6: the sequence prompt names every shot with its time, size, angle and move, and the hard cuts", /in 3 shots with 2 hard cuts/.test(prompt) && /Shot 2 \(2\.5-4\.5 s, hard cut in\): close-up/.test(prompt) && /over-the-shoulder/.test(prompt) && /No other cuts/.test(prompt));

  // Keyframes: one drawn frame opens each scene; at most two scenes in a row continue a take, then a fresh keyframe.
  { const room = Array.from({ length: 12 }, (_, i) => ({ id: `R${i + 1}`, place: "room", shotType: ["medium", "close-up", "wide"][i % 3], duration: 2.6 }));
    const q = D.planSequences(room, { maxSecs: 7 });
    t("v6: one keyframe opens a scene; two scenes at most continue a take before a fresh keyframe", JSON.stringify([...D.keyShots(q)]) === JSON.stringify(["R1", "R7"]) && q.filter((x) => x.continues).every((x) => x.depth <= D.MAX_CONTINUE)); }
  // The cut critic on a real three-part clip: cuts at 2 s and 4 s.
  const d = fs.mkdtempSync(path.join(ROOT, ".cache", "direction-")), v = path.join(d, "seq.mp4");
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=2:r=24", "-f", "lavfi", "-i", "mandelbrot=s=640x360:r=24", "-f", "lavfi", "-i", "smptebars=s=640x360:d=2:r=24",
      "-filter_complex", "[1]trim=duration=2,setpts=PTS-STARTPTS[m];[0][m][2]concat=n=3:v=1[v]", "-map", "[v]", "-pix_fmt", "yuv420p", v]);
    const good = C.cutsMatch(v, [2, 4]), extra = C.cutsMatch(v, [2]), missing = C.cutsMatch(v, [2, 4, 5]);
    t("v6: the cut critic passes the planned cuts and fails a missing or an unplanned cut", good.pass && !extra.pass && extra.unplanned.length === 1 && !missing.pass && missing.missing[0] === 5);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // Model choice: a film with cuts inside a scene prefers a model that cuts inside one generation.
  const ms = Object.keys(MODELS).find((k) => MODELS[k].multiShot), single = Object.keys(MODELS).find((k) => MODELS[k].kind === "video" && !MODELS[k].multiShot && MODELS[k].lastFrame);
  const opts = [{ key: single, credits: 10, quality: 8, provider: "kie" }, { key: ms, credits: 30, quality: 8, provider: "kie" }];
  const pick = (cuts) => recommend(opts, { format: "launch", budget: { mode: "max" }, cuts })?.key;
  t("v6: the model pick prefers a multi-shot model when scenes have cuts", pick(true) === ms);
}
